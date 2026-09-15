import { NextResponse } from "next/server";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { prisma } from "@/lib/prisma";
import { CATEGORIES, dishCategory, dishName, validatePreference } from "@/lib/dish-preference-rules.mjs";

export const runtime = "nodejs";

type CatalogMatch = { sourceCategory: string; baseMenu: string; isBaseMenu: boolean; cookingMethods: string[]; ingredientCategories: string[] };
const catalogRoles: Record<string, string> = {
  "메인반찬": "주찬", "밑반찬": "부찬", "국/탕": "국/탕/찌개", "찌개": "국/탕/찌개",
  "면/만두": "한그릇", "밥/죽/떡": "한그릇",
};

function catalogMatches() {
  const matches = new Map<string, CatalogMatch[]>();
  const catalogPath = process.env.MEAL_CATALOG_DB_PATH ?? join(process.env.MEAL_PLAN_ROOT || process.cwd(), "data", "10000recipe-catalog.db");
  if (!existsSync(catalogPath)) {
    console.warn(`메뉴 카탈로그 파일이 없습니다: ${catalogPath}`);
    return { matches, available: false };
  }
  let catalog: DatabaseSync;
  try { catalog = new DatabaseSync(catalogPath, { readOnly: true }); }
  catch (error) {
    console.error(`메뉴 카탈로그를 열지 못했습니다: ${catalogPath}`, error);
    return { matches: new Map<string, CatalogMatch[]>(), available: false };
  }
  try {
    const rows = catalog.prepare(`SELECT m."sourceCategory",m."name" AS "baseMenu",m."cookingMethods",m."ingredientCategories",v."name" AS "variantName"
      FROM "RecipeCatalogMenu" m LEFT JOIN "RecipeCatalogVariant" v ON v."menuId"=m."id"`).all() as {
      sourceCategory: string; baseMenu: string; cookingMethods: string; ingredientCategories: string; variantName: string | null
    }[];
    for (const row of rows) {
      const role = catalogRoles[row.sourceCategory];
      if (!role) continue;
      const cookingMethods = JSON.parse(row.cookingMethods) as string[];
      const ingredientCategories = JSON.parse(row.ingredientCategories) as string[];
      for (const [name, isBaseMenu] of [[row.baseMenu, true], [row.variantName, false]] as [string | null, boolean][]) {
        if (!name) continue;
        const key = `${role}|${dishName(name)}`;
        const entries = matches.get(key) ?? [];
        if (!entries.some(entry => entry.sourceCategory === row.sourceCategory && entry.baseMenu === row.baseMenu && entry.isBaseMenu === isBaseMenu))
          entries.push({ sourceCategory: row.sourceCategory, baseMenu: row.baseMenu, isBaseMenu, cookingMethods, ingredientCategories });
        matches.set(key, entries);
      }
    }
    return { matches, available: true };
  } catch (error) {
    console.error(`메뉴 카탈로그 내용을 읽지 못했습니다: ${catalogPath}`, error);
    return { matches: new Map<string, CatalogMatch[]>(), available: false };
  } finally {
    catalog.close();
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const targetName = url.searchParams.get("name");
  const targetCategory = url.searchParams.get("category");
  if (targetName && targetCategory && CATEGORIES.includes(dishCategory(targetCategory))) {
    const dish = await prisma.dish.findUnique({ where: { name_category: { name: dishName(targetName), category: dishCategory(targetCategory) } }, include: { preferences: true } });
    return NextResponse.json({ dishes: dish ? [dish] : [], family: [], catalogAvailable: true });
  }
  const [dishes, recipes, meals, family] = await Promise.all([
    prisma.dish.findMany({ include: { preferences: true }, orderBy: { name: "asc" } }),
    prisma.recipe.findMany({ select: { title: true, category: true } }),
    prisma.mealPlan.findMany({ select: { mainDish: true, soupDish: true, mealStyle: true, sideDishes: true, lunchPlan: true, babyMenu: true } }),
    prisma.familyMember.findMany({ select: { name: true, role: true } }),
  ]);
  const catalog = catalogMatches();
  const candidates = new Map<string, {name: string; category: string; preferences: typeof dishes[number]["preferences"]}>();
  function add(name: string | null, category: string) {
    const title = dishName(name);
    const kind = dishCategory(category);
    if (!title || ["회사 식사", "외식", "미식사", "없음"].includes(title) || !CATEGORIES.includes(kind)) return;
    const key = `${kind}|${title}`;
    if (!candidates.has(key)) candidates.set(key, { name: title, category: kind, preferences: [] });
  }
  for (const dish of dishes) candidates.set(`${dish.category}|${dish.name}`, dish);
  for (const key of catalog.matches.keys()) {
    const [category, ...nameParts] = key.split("|");
    add(nameParts.join("|"), category);
  }
  for (const recipe of recipes) add(recipe.title, recipe.category);
  for (const meal of meals) {
    add(meal.mainDish, ["NOODLE_DUMPLING", "RICE_PORRIDGE_TTEOK"].includes(meal.mealStyle) ? "한그릇" : "주찬");
    add(meal.soupDish, "국/탕/찌개"); add(meal.lunchPlan, "점심"); add(meal.babyMenu, "아기");
    let sides: unknown;
    try { sides = JSON.parse(meal.sideDishes); } catch { sides = meal.sideDishes.split(","); }
    if (Array.isArray(sides)) for (const side of sides) if (typeof side === "string") add(side, "부찬");
  }
  return NextResponse.json({ dishes: [...candidates.values()]
    .map(dish => ({ ...dish, catalogMatches: catalog.matches.get(`${dish.category}|${dish.name}`) ?? [] }))
    .sort((a,b) => a.name.localeCompare(b.name, "ko")), family, catalogAvailable: catalog.available });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!Array.isArray(body?.updates) || !body.updates.length || body.updates.length > 200) throw new Error("저장할 메뉴를 1~200개 선택해 주세요.");
    const updates = body.updates.map((item: unknown) => validatePreference(item));
    const family = await prisma.familyMember.findMany({ select: {role: true} });
    if (updates.some((item: {scope: string}) => item.scope !== "family" && !family.some(m => m.role === item.scope))) throw new Error("등록된 가족을 선택해 주세요.");
    const source = body.source === "day-detail" ? "day-detail" : "menu-settings";
    await prisma.$transaction(async tx => {
      for (const input of updates) {
        const dish = await tx.dish.upsert({ where: {name_category: { name: input.name, category: input.category }}, create: { name: input.name, category: input.category }, update: {} });
        const patch = { ...(input.usage !== undefined ? {usage: input.usage} : {}), ...(input.familiarity !== undefined ? {familiarity: input.familiarity} : {}), ...(input.note !== undefined ? {note: input.note} : {}), source, confirmedAt: new Date() };
        await tx.dishPreference.upsert({ where: {dishId_scope: {dishId: dish.id, scope: input.scope}}, create: {dishId: dish.id, scope: input.scope, ...patch}, update: patch });
      }
    });
    return NextResponse.json({ success: true, count: updates.length, message: `${updates.length}개 메뉴의 취향을 저장했습니다. 기존 식단은 유지하고 이후 생성·재구성부터 반영합니다.` });
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "메뉴 취향을 저장하지 못했습니다."}, {status: 400});
  }
}
