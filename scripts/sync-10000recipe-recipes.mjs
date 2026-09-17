#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  parsePrintRecipe,
  parseSearchResults,
  recipeTitleScore,
} from "../lib/10000recipe-catalog-recipes.mjs";
import { catalogRecipeOverrides } from "../lib/catalog-recipe-overrides.mjs";

const root = process.cwd();
const catalogPath = process.env.MEAL_CATALOG_DB_PATH ?? path.join(root, "data", "10000recipe-catalog.db");
const mealPath = process.env.MEAL_DB_PATH ?? path.join(root, "data", "mealplan.db");
const args = Object.fromEntries(process.argv.slice(2).flatMap((value, index, all) =>
  value.startsWith("--") ? [[value.slice(2), all[index + 1]?.startsWith("--") ? "true" : all[index + 1]]] : []));
const concurrency = Math.max(1, Math.min(8, Number.parseInt(args.concurrency ?? "3", 10) || 3));
const limit = args.limit ? Math.max(0, Number.parseInt(args.limit, 10) || 0) : Number.POSITIVE_INFINITY;
const minimumScore = Math.max(75, Math.min(100, Number.parseInt(args["minimum-score"] ?? "90", 10) || 90));
const checkedAt = Date.now();

if (!fs.existsSync(catalogPath)) throw new Error(`카탈로그 DB가 없습니다: ${catalogPath}`);

function schema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS "RecipeCatalogRecipe" (
      "id" TEXT PRIMARY KEY,
      "variantName" TEXT NOT NULL UNIQUE,
      "sourceUrl" TEXT NOT NULL,
      "sourceTitle" TEXT NOT NULL,
      "sourceAuthor" TEXT,
      "servingsText" TEXT,
      "durationText" TEXT,
      "difficulty" TEXT,
      "ingredientGroups" TEXT NOT NULL,
      "instructions" TEXT NOT NULL,
      "sourceOrigin" TEXT NOT NULL,
      "matchScore" INTEGER NOT NULL,
      "sourceCheckedAt" INTEGER NOT NULL,
      "fetchedAt" INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS "RecipeCatalogRecipe_sourceUrl" ON "RecipeCatalogRecipe"("sourceUrl");
    CREATE TABLE IF NOT EXISTS "RecipeCatalogRecipeFailure" (
      "variantName" TEXT PRIMARY KEY,
      "reason" TEXT NOT NULL,
      "attemptCount" INTEGER NOT NULL DEFAULT 1,
      "lastCheckedAt" INTEGER NOT NULL
    );
  `);
}

function backupCatalog() {
  const backupDir = path.join(root, "data", "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `10000recipe-catalog-recipes-${stamp}.db`);
  fs.copyFileSync(catalogPath, backupPath);
  return backupPath;
}

function isVerifiedSource(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && ["www.10000recipe.com", "m.10000recipe.com"].includes(url.hostname.toLowerCase())
      && /^\/recipe\/\d+\/?$/.test(url.pathname);
  } catch { return false; }
}

function parseJson(value, fallback = []) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : fallback;
  } catch { return fallback; }
}

function importExistingRecipes(catalog) {
  if (!fs.existsSync(mealPath)) return 0;
  const meal = new DatabaseSync(mealPath, { readOnly: true });
  const insert = catalog.prepare(`
    INSERT OR IGNORE INTO "RecipeCatalogRecipe"
      ("id","variantName","sourceUrl","sourceTitle","sourceAuthor","servingsText","durationText","difficulty","ingredientGroups","instructions","sourceOrigin","matchScore","sourceCheckedAt","fetchedAt")
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const variantNames = new Set(catalog.prepare('SELECT DISTINCT "name" FROM "RecipeCatalogVariant"').all().map((row) => row.name));
  const recipes = meal.prepare(`
    SELECT * FROM "Recipe"
    WHERE "needsReview"=0 AND "sourceUrl" IS NOT NULL AND "sourceTitle" IS NOT NULL
    ORDER BY COALESCE("sourceCheckedAt",0) DESC, "updatedAt" DESC`).all();
  const findIngredients = meal.prepare('SELECT "name","amount","category" FROM "Ingredient" WHERE "recipeId"=? ORDER BY "id"');
  let added = 0;
  try {
    catalog.exec("BEGIN IMMEDIATE");
    for (const recipe of recipes) {
      if (!variantNames.has(recipe.title) || !isVerifiedSource(recipe.sourceUrl)) continue;
      const grouped = new Map();
      for (const item of findIngredients.all(recipe.id)) {
        const group = String(item.category || "재료").trim() || "재료";
        const values = grouped.get(group) ?? [];
        values.push(`${String(item.name).trim()} ${String(item.amount).trim()}`.trim());
        grouped.set(group, values);
      }
      const ingredients = [...grouped].map(([group, items]) => ({ group, items }));
      const instructions = parseJson(recipe.instructions);
      if (!ingredients.length || !instructions.length) continue;
      const result = insert.run(
        crypto.randomUUID(), recipe.title, recipe.sourceUrl, recipe.sourceTitle,
        recipe.sourceAuthor ?? null, `${recipe.adultServings + recipe.childServings}인분`,
        `${recipe.prepMinutes + recipe.cookMinutes}분`, null,
        JSON.stringify(ingredients), JSON.stringify(instructions), "MEAL_DB", 100,
        recipe.sourceCheckedAt ?? checkedAt, checkedAt,
      );
      added += result.changes;
    }
    catalog.exec("COMMIT");
  } catch (error) {
    try { catalog.exec("ROLLBACK"); } catch {}
    throw error;
  } finally {
    meal.close();
  }
  return added;
}

async function fetchText(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "TableForUs/1.0 (personal meal planner; recipe source verification)" },
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) return await response.text();
      lastError = new Error(`HTTP ${response.status}`);
      if (response.status < 500 && response.status !== 429) break;
      const retryAfter = Number.parseInt(response.headers.get("retry-after") ?? "0", 10);
      await new Promise((resolve) => setTimeout(resolve, Math.max(retryAfter * 1000, attempt * 750)));
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 750));
    }
  }
  throw lastError ?? new Error("요청 실패");
}

async function fetchRecipe(target) {
  const overrideId = catalogRecipeOverrides.get(target.variantName);
  if (overrideId) {
    const sourceUrl = `https://www.10000recipe.com/recipe/${overrideId}`;
    const printUrl = `https://www.10000recipe.com/recipe/print.html?seq=${overrideId}`;
    const parsed = parsePrintRecipe(await fetchText(printUrl), sourceUrl);
    return { ...parsed, matchScore: 100 };
  }
  const searchHtml = await fetchText(target.searchUrl);
  const candidates = parseSearchResults(searchHtml);
  const matches = candidates.map((candidate) => ({
    ...candidate,
    matchScore: recipeTitleScore(target.variantName, candidate.title),
  })).filter((candidate) => candidate.matchScore >= minimumScore);
  if (!matches.length) {
    const examples = candidates.slice(0, 3).map((item) => item.title).join(" | ");
    throw new Error(`일치하는 개별 레시피 없음${examples ? ` (검색 상위: ${examples})` : ""}`);
  }
  const parseErrors = [];
  for (const selected of matches.slice(0, 8)) {
    try {
      const printUrl = `https://www.10000recipe.com/recipe/print.html?seq=${selected.recipeId}`;
      const parsed = parsePrintRecipe(await fetchText(printUrl), selected.sourceUrl);
      return { ...parsed, matchScore: selected.matchScore };
    } catch (error) {
      parseErrors.push(`${selected.recipeId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`일치 후보의 본문 확인 실패 (${parseErrors.join("; ")})`);
}

async function main() {
  const backup = backupCatalog();
  const catalog = new DatabaseSync(catalogPath);
  schema(catalog);
  const importedExisting = importExistingRecipes(catalog);
  const targets = catalog.prepare(`
    SELECT v."name" AS "variantName", MIN(v."searchUrl") AS "searchUrl"
    FROM "RecipeCatalogVariant" v
    LEFT JOIN "RecipeCatalogRecipe" r ON r."variantName"=v."name"
    WHERE r."variantName" IS NULL
    GROUP BY v."name"
    ORDER BY v."name"`).all().slice(0, limit);
  const insert = catalog.prepare(`
    INSERT OR IGNORE INTO "RecipeCatalogRecipe"
      ("id","variantName","sourceUrl","sourceTitle","sourceAuthor","servingsText","durationText","difficulty","ingredientGroups","instructions","sourceOrigin","matchScore","sourceCheckedAt","fetchedAt")
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const removeFailure = catalog.prepare('DELETE FROM "RecipeCatalogRecipeFailure" WHERE "variantName"=?');
  const recordFailure = catalog.prepare(`
    INSERT INTO "RecipeCatalogRecipeFailure" ("variantName","reason","attemptCount","lastCheckedAt") VALUES (?,?,1,?)
    ON CONFLICT("variantName") DO UPDATE SET "reason"=excluded."reason","attemptCount"="attemptCount"+1,"lastCheckedAt"=excluded."lastCheckedAt"`);
  let cursor = 0;
  let added = 0;
  let failed = 0;
  const startedAt = Date.now();
  const workers = Array.from({ length: Math.min(concurrency, targets.length) }, async () => {
    while (cursor < targets.length) {
      const index = cursor;
      cursor += 1;
      const target = targets[index];
      try {
        const recipe = await fetchRecipe(target);
        insert.run(
          crypto.randomUUID(), target.variantName, recipe.sourceUrl, recipe.sourceTitle,
          recipe.sourceAuthor || null, recipe.servingsText || null, recipe.durationText || null,
          recipe.difficulty || null, JSON.stringify(recipe.ingredientGroups),
          JSON.stringify(recipe.instructions), "10000RECIPE_SEARCH", recipe.matchScore,
          checkedAt, Date.now(),
        );
        removeFailure.run(target.variantName);
        added += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        recordFailure.run(target.variantName, message.slice(0, 1000), Date.now());
        failed += 1;
      }
      const done = added + failed;
      if (done % 25 === 0 || done === targets.length) {
        console.log(JSON.stringify({ progress: done, total: targets.length, added, failed,
          elapsedSeconds: Math.round((Date.now() - startedAt) / 1000) }));
      }
    }
  });
  await Promise.all(workers);
  const summary = {
    catalogPath,
    backup,
    distinctVariants: catalog.prepare('SELECT COUNT(DISTINCT "name") AS n FROM "RecipeCatalogVariant"').get().n,
    variantRows: catalog.prepare('SELECT COUNT(*) AS n FROM "RecipeCatalogVariant"').get().n,
    importedExisting,
    attempted: targets.length,
    added,
    failed,
    storedRecipes: catalog.prepare('SELECT COUNT(*) AS n FROM "RecipeCatalogRecipe"').get().n,
    coveredVariantRows: catalog.prepare('SELECT COUNT(*) AS n FROM "RecipeCatalogVariant" v JOIN "RecipeCatalogRecipe" r ON r."variantName"=v."name"').get().n,
    unresolved: catalog.prepare(`SELECT COUNT(*) AS n FROM (SELECT DISTINCT v."name" FROM "RecipeCatalogVariant" v LEFT JOIN "RecipeCatalogRecipe" r ON r."variantName"=v."name" WHERE r."variantName" IS NULL)`).get().n,
  };
  catalog.close();
  console.log(JSON.stringify(summary, null, 2));
}

await main();
