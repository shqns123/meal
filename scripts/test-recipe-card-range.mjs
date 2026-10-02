import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const sourceRoot = process.cwd();
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meal-recipe-cards-"));
const dateMs = (date) => Date.parse(`${date}T00:00:00+09:00`);
try {
  fs.mkdirSync(path.join(temporaryRoot, "data"));
  const mealPath = path.join(temporaryRoot, "data", "mealplan.db");
  const catalogPath = path.join(temporaryRoot, "data", "10000recipe-catalog.db");
  const meal = new DatabaseSync(mealPath);
  meal.exec(`
    CREATE TABLE "Recipe" ("id" TEXT PRIMARY KEY,"title" TEXT,"category" TEXT,"plannedDates" TEXT,"weekKeys" TEXT,"instructions" TEXT,"needsReview" INTEGER,"sourceUrl" TEXT,"sourceTitle" TEXT,"sourceCheckedAt" INTEGER,"updatedAt" INTEGER);
    CREATE TABLE "Ingredient" ("id" TEXT PRIMARY KEY,"recipeId" TEXT,"name" TEXT,"amount" TEXT,"category" TEXT);
    CREATE TABLE "MealPlan" ("id" TEXT PRIMARY KEY,"date" INTEGER,"mainDish" TEXT,"soupDish" TEXT,"sideDishes" TEXT,"lunchPlan" TEXT,"dinnerDiningOut" INTEGER,"recipeId" TEXT,"updatedAt" INTEGER);
    CREATE TABLE "PantryItem" ("name" TEXT,"quantity" REAL,"unit" TEXT,"expiresAt" INTEGER);
    CREATE TABLE "FamilyMember" ("allergies" TEXT);
    CREATE TABLE "ShoppingWeek" ("id" TEXT PRIMARY KEY,"startDate" INTEGER,"endDate" INTEGER,"createdAt" INTEGER);
    CREATE TABLE "ShoppingItem" ("id" TEXT PRIMARY KEY,"name" TEXT,"quantity" REAL,"unit" TEXT,"quantityNote" TEXT,"category" TEXT,"ownedQuantity" REAL,"usePlan" TEXT,"purchased" INTEGER,"weekId" TEXT);
    CREATE TABLE "HiddenRecipeCard" ("id" TEXT PRIMARY KEY,"title" TEXT NOT NULL,"date" TEXT NOT NULL,"createdAt" INTEGER NOT NULL,UNIQUE("title","date"));
  `);
  const addMeal = meal.prepare('INSERT INTO "MealPlan" ("id","date","mainDish","sideDishes","dinnerDiningOut","recipeId") VALUES (?,?,?,?,0,?)');
  addMeal.run("meal-1", dateMs("2026-10-04"), "테스트주찬", '["테스트부찬"]', "recipe-1");
  addMeal.run("meal-2", dateMs("2026-10-05"), "테스트주찬", "[]", "recipe-1");
  meal.prepare('INSERT INTO "Recipe" ("id","title","category","plannedDates","weekKeys","instructions","needsReview") VALUES (?,?,?,?,?,?,0)')
    .run("recipe-1", "테스트주찬", "주찬", '["2026-10-04","2026-10-05"]', '["2026-10-04"]', '["1. 조리한다."]');
  meal.prepare('INSERT INTO "Ingredient" ("id","recipeId","name","amount","category") VALUES (?,?,?,?,?)')
    .run("ingredient-1", "recipe-1", "감자", "100g", "채소");
  meal.close();
  const catalog = new DatabaseSync(catalogPath);
  catalog.exec('CREATE TABLE "RecipeCatalogRecipe" ("id" TEXT PRIMARY KEY,"variantName" TEXT NOT NULL)');
  catalog.prepare('INSERT INTO "RecipeCatalogRecipe" ("id","variantName") VALUES (?,?)').run("catalog-1", "테스트부찬");
  catalog.close();
  const input = path.join(temporaryRoot, "selected.json");
  const payload = { startDate: "2026-10-04", endDate: "2026-10-04", cards: [
    { id: "recipe-1", title: "테스트주찬", plannedDates: ["2026-10-04"] },
    { id: "catalog-catalog-1", title: "테스트부찬", plannedDates: ["2026-10-04"] },
  ] };
  fs.writeFileSync(input, JSON.stringify(payload));
  const run = () => spawnSync(process.execPath, [path.join(sourceRoot, "scripts", "mealctl.mjs"), "delete-recipe-cards", "--input", input], {
    cwd: sourceRoot, encoding: "utf8",
    env: { ...process.env, MEAL_PLAN_ROOT: temporaryRoot, MEAL_DB_PATH: mealPath, MEAL_CATALOG_DB_PATH: catalogPath },
  });
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.deleted, 2);
  assert.deepEqual(output.shoppingWeeks, ["2026-10-04"]);
  assert.ok(fs.existsSync(output.backup));
  const updated = new DatabaseSync(mealPath, { readOnly: true });
  assert.equal(updated.prepare('SELECT "plannedDates" FROM "Recipe" WHERE "id"=?').get("recipe-1").plannedDates, '["2026-10-05"]');
  assert.equal(updated.prepare('SELECT "recipeId" FROM "MealPlan" WHERE "id"=?').get("meal-1").recipeId, null);
  assert.equal(updated.prepare('SELECT COUNT(*) AS n FROM "HiddenRecipeCard"').get().n, 2);
  updated.close();
  const stale = run();
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /저장 날짜가 변경/);
  console.log("Recipe card range deletion tests passed.");
} finally {
  const resolvedRoot = fs.realpathSync(temporaryRoot);
  const resolvedTemp = fs.realpathSync(os.tmpdir());
  if (!resolvedRoot.startsWith(`${resolvedTemp}${path.sep}`))
    throw new Error(`정리 경로가 임시 디렉터리 밖입니다: ${resolvedRoot}`);
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}
