#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const catalogPath = path.join(root, "data", "10000recipe-catalog.db");
const categories = [
  { id: "56", name: "메인반찬" },
  { id: "63", name: "밑반찬" },
  { id: "54", name: "국/탕" },
  { id: "55", name: "찌개" },
  { id: "53", name: "면/만두" },
  { id: "52", name: "밥/죽/떡" },
];
const cookingMethods = [
  { id: "6", name: "볶음" }, { id: "1", name: "끓이기" }, { id: "7", name: "부침" },
  { id: "36", name: "조림" }, { id: "41", name: "무침" }, { id: "42", name: "비빔" },
  { id: "8", name: "찜" }, { id: "10", name: "절임" }, { id: "9", name: "튀김" },
  { id: "38", name: "삶기" }, { id: "67", name: "굽기" }, { id: "39", name: "데치기" },
  { id: "37", name: "회" }, { id: "11", name: "기타" },
];
// 만개의레시피의 재료별 필터(cat3)는 실제 레시피 재료표가 아니라
// 넓은 재료 계열이다. 카탈로그에서 주재료 순환을 판단하는 태그로만 쓴다.
const ingredientCategories = [
  { id: "70", name: "소고기" }, { id: "71", name: "돼지고기" }, { id: "72", name: "닭고기" },
  { id: "23", name: "육류" }, { id: "28", name: "채소류" }, { id: "24", name: "해물류" },
  { id: "50", name: "달걀/유제품" }, { id: "33", name: "가공식품류" }, { id: "47", name: "쌀" },
  { id: "32", name: "밀가루" }, { id: "25", name: "건어물류" }, { id: "31", name: "버섯류" },
  { id: "48", name: "과일류" }, { id: "27", name: "콩/견과류" }, { id: "26", name: "곡류" }, { id: "34", name: "기타" },
];

function decodeHtml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function menuTags(html, category) {
  const heading = `<a href="/recipe/list.html?cat4=${category.id}">${category.name}</a>`;
  const start = html.indexOf(heading);
  if (start < 0) throw new Error(`${category.name} 메뉴 영역을 찾지 못했습니다.`);
  const listStart = html.indexOf('<ul class="tag_cont"', start);
  const listEnd = html.indexOf("</ul>", listStart);
  if (listStart < 0 || listEnd < 0) throw new Error(`${category.name} 메뉴 목록 형식이 바뀌었습니다.`);
  const fragment = html.slice(listStart, listEnd);
  const matches = [...fragment.matchAll(/<a href="\/recipe\/list\.html\?q=([^"]+)">([\s\S]*?)<\/a>/g)];
  const menus = matches.map((match) => ({
    name: decodeHtml(match[2]),
    searchUrl: `https://www.10000recipe.com/recipe/list.html?q=${match[1]}`,
  })).filter((menu) => menu.name);
  if (!menus.length) throw new Error(`${category.name}에서 가져올 메뉴가 없습니다.`);
  return menus;
}

async function fetchMenus(category) {
  const url = `https://www.10000recipe.com/recipe/list.html?cat4=${category.id}`;
  const response = await fetch(url, {
    headers: { "User-Agent": "TableForUs/1.0 (personal meal planner)" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${category.name} 요청 실패: ${response.status}`);
  return menuTags(await response.text(), category);
}

function methodMenuNames(html, method) {
  const list = html.match(/<ul class="tag_cont"[\s\S]*?<\/ul>/)?.[0];
  if (!list) throw new Error(`${method.name} 메뉴 목록을 찾지 못했습니다.`);
  return [...list.matchAll(/<a href="\/recipe\/list\.html\?q=([^"]+)">([\s\S]*?)<\/a>/g)]
    .map((match) => decodeHtml(match[2].replace(/<[^>]+>/g, "")))
    .filter(Boolean);
}
async function fetchFilteredMenus({ sourceCategory, filter, queryKey }) {
  const response = await fetch(`https://www.10000recipe.com/recipe/list.html?cat4=${sourceCategory.id}&${queryKey}=${filter.id}`, {
    headers: { "User-Agent": "TableForUs/1.0 (personal meal planner)" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${sourceCategory.name} + ${filter.name} 요청 실패: ${response.status}`);
  return methodMenuNames(await response.text(), filter);
}

function relatedMenuTags(html, menu) {
  const list = html.match(/<ul class="tag_cont"[\s\S]*?<\/ul>/)?.[0];
  if (!list) throw new Error(`${menu.name}의 관련 메뉴 목록을 찾지 못했습니다.`);
  const matches = [...list.matchAll(/<a href="\/recipe\/list\.html\?q=([^"]+)">([\s\S]*?)<\/a>/g)];
  const variants = matches.map((match, index) => ({
    id: crypto.randomUUID(),
    menuId: menu.id,
    name: decodeHtml(match[2].replace(/<[^>]+>/g, "")),
    searchUrl: `https://www.10000recipe.com/recipe/list.html?q=${match[1]}`,
    position: index + 1,
  })).filter((variant) => variant.name)
    .filter((variant, index, all) => all.findIndex((candidate) => candidate.name === variant.name) === index);
  if (!variants.length) throw new Error(`${menu.name}의 관련 메뉴가 없습니다.`);
  return variants;
}

async function fetchVariants(menu) {
  const response = await fetch(menu.searchUrl, {
    headers: { "User-Agent": "TableForUs/1.0 (personal meal planner)" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${menu.name} 관련 메뉴 요청 실패: ${response.status}`);
  return relatedMenuTags(await response.text(), menu);
}

async function mapConcurrent(items, limit, work) {
  const results = Array(items.length);
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      try { results[current] = { value: await work(items[current]) }; }
      catch (error) { results[current] = { error: error instanceof Error ? error.message : String(error) }; }
    }
  }));
  return results;
}

const imported = await Promise.all(categories.map(async (category) => ({
  category,
  menus: await fetchMenus(category),
})));
// 단독 방법별·재료별 화면의 상단 30개는 전체 분류의 인기 메뉴다.
// 종류별(cat4)을 먼저 선택한 화면을 기준으로 기본메뉴 태그를 수집한다.
const filterRequests = categories.flatMap((sourceCategory) => [
  ...cookingMethods.map((filter) => ({ sourceCategory, filter, queryKey: "cat1" })),
  ...ingredientCategories.map((filter) => ({ sourceCategory, filter, queryKey: "cat3" })),
]);
const filterResults = await mapConcurrent(filterRequests, 4, fetchFilteredMenus);
const filterFailures = filterResults.flatMap((result, index) => result.error
  ? [`${filterRequests[index].sourceCategory.name} + ${filterRequests[index].filter.name}: ${result.error}`]
  : []);
if (filterFailures.length) throw new Error(`필터 수집 실패: ${filterFailures.join("; ")}`);
const importedFilters = filterRequests.map((request, index) => ({ ...request, menus: filterResults[index].value }));
const methodsByMenuName = new Map();
for (const { sourceCategory, filter, menus: methodMenus } of importedFilters.filter((item) => item.queryKey === "cat1")) {
  for (const name of methodMenus) {
    const key = `${sourceCategory.name}|${name.replace(/\s+/g, " ").trim()}`;
    const values = methodsByMenuName.get(key) ?? [];
    values.push(filter.name);
    methodsByMenuName.set(key, values);
  }
}
const ingredientsByMenuName = new Map();
for (const { sourceCategory, filter, menus: ingredientMenus } of importedFilters.filter((item) => item.queryKey === "cat3")) {
  for (const name of ingredientMenus) {
    const key = `${sourceCategory.name}|${name.replace(/\s+/g, " ").trim()}`;
    const values = ingredientsByMenuName.get(key) ?? [];
    values.push(filter.name);
    ingredientsByMenuName.set(key, values);
  }
}
const menus = imported.flatMap(({ category, menus }) => menus.map((menu) => ({
  id: crypto.randomUUID(),
  sourceCategory: category.name,
  ...(() => {
    const key = `${category.name}|${menu.name.replace(/\s+/g, " ").trim()}`;
    const sourceMethods = methodsByMenuName.get(key);
    const sourceIngredients = ingredientsByMenuName.get(key);
    return {
      cookingMethods: sourceMethods ?? [],
      cookingMethodOrigin: sourceMethods ? "SOURCE_FILTER" : "UNRESOLVED",
      ingredientCategories: sourceIngredients ?? [],
      ingredientCategoryOrigin: sourceIngredients ? "SOURCE_FILTER" : "UNRESOLVED",
    };
  })(),
  ...menu,
})));
const variantResults = await mapConcurrent(menus, 3, fetchVariants);
const variants = variantResults.flatMap((result) => result.value ?? []);
const failures = variantResults.flatMap((result, index) => result.error ? [{ name: menus[index].name, error: result.error }] : []);

fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
const db = new DatabaseSync(catalogPath);
// Related menu tags are refreshed as a set on every import. Recreate derived
// tables so older catalog files also receive the current shape.
db.exec('DROP TABLE IF EXISTS "RecipeCatalogVariant"');
db.exec('DROP TABLE IF EXISTS "RecipeCatalogMenu"');
db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = DELETE;
  CREATE TABLE IF NOT EXISTS "RecipeCatalogMenu" (
    "id" TEXT PRIMARY KEY,
    "sourceCategory" TEXT NOT NULL,
    "cookingMethods" TEXT NOT NULL,
    "cookingMethodOrigin" TEXT NOT NULL,
    "ingredientCategories" TEXT NOT NULL,
    "ingredientCategoryOrigin" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "searchUrl" TEXT NOT NULL,
    "fetchedAt" INTEGER NOT NULL,
    UNIQUE("sourceCategory", "name")
  );
  CREATE INDEX IF NOT EXISTS "RecipeCatalogMenu_sourceCategory" ON "RecipeCatalogMenu"("sourceCategory");
  CREATE TABLE IF NOT EXISTS "RecipeCatalogVariant" (
    "id" TEXT PRIMARY KEY,
    "menuId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "searchUrl" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "fetchedAt" INTEGER NOT NULL,
    FOREIGN KEY("menuId") REFERENCES "RecipeCatalogMenu"("id") ON DELETE CASCADE,
    UNIQUE("menuId", "name")
  );
  CREATE INDEX IF NOT EXISTS "RecipeCatalogVariant_menuId" ON "RecipeCatalogVariant"("menuId");
`);

const fetchedAt = Date.now();
const insert = db.prepare(`INSERT INTO "RecipeCatalogMenu" ("id","sourceCategory","cookingMethods","cookingMethodOrigin","ingredientCategories","ingredientCategoryOrigin","name","searchUrl","fetchedAt") VALUES (?,?,?,?,?,?,?,?,?)`);
const insertVariant = db.prepare(`INSERT INTO "RecipeCatalogVariant" ("id","menuId","name","searchUrl","position","fetchedAt") VALUES (?,?,?,?,?,?)`);
db.exec("BEGIN IMMEDIATE");
try {
  for (const menu of menus)
    insert.run(menu.id, menu.sourceCategory, JSON.stringify(menu.cookingMethods), menu.cookingMethodOrigin, JSON.stringify(menu.ingredientCategories), menu.ingredientCategoryOrigin, menu.name, menu.searchUrl, fetchedAt);
  for (const variant of variants)
    insertVariant.run(variant.id, variant.menuId, variant.name, variant.searchUrl, variant.position, fetchedAt);
  db.exec("COMMIT");
} catch (error) {
  try { db.exec("ROLLBACK"); } catch {}
  throw error;
} finally {
  db.close();
}

console.log(JSON.stringify({
  catalogPath,
  categories: imported.map(({ category, menus }) => ({ category: category.name, count: menus.length })),
  methodFilterPages: importedFilters.filter((item) => item.queryKey === "cat1").length,
  ingredientFilterPages: importedFilters.filter((item) => item.queryKey === "cat3").length,
  unresolvedIngredientCategories: menus.filter((menu) => menu.ingredientCategoryOrigin === "UNRESOLVED").map((menu) => `${menu.sourceCategory}|${menu.name}`),
  unresolvedCookingMethods: menus.filter((menu) => menu.cookingMethodOrigin === "UNRESOLVED").map((menu) => `${menu.sourceCategory}|${menu.name}`),
  variants: variants.length,
  failures,
}, null, 2));
