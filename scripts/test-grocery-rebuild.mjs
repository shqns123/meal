import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const sourceRoot = process.cwd();
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meal-grocery-rebuild-"));
const dateMs = (date) => Date.parse(`${date}T00:00:00+09:00`);
try {
  fs.mkdirSync(path.join(temporaryRoot, "data"));
  const mealPath = path.join(temporaryRoot, "data", "mealplan.db");
  const catalogPath = path.join(temporaryRoot, "data", "10000recipe-catalog.db");
  const meal = new DatabaseSync(mealPath);
  meal.exec(`
    CREATE TABLE "FamilyMember" ("id" TEXT PRIMARY KEY,"role" TEXT,"allergies" TEXT);
    CREATE TABLE "FamilySchedule" ("date" INTEGER,"memberId" TEXT,"isWorking" INTEGER,"eatsAtCompany" INTEGER,"isAway" INTEGER,"lunchNotAtHome" INTEGER,"dinnerNotAtHome" INTEGER);
    CREATE TABLE "MealPlan" ("id" TEXT PRIMARY KEY,"date" INTEGER,"mainDish" TEXT,"soupDish" TEXT,"sideDishes" TEXT,"lunchPlan" TEXT,"dinnerDiningOut" INTEGER,"adultServings" INTEGER,"childServings" INTEGER,"babyMenu" TEXT);
    CREATE TABLE "Recipe" ("id" TEXT PRIMARY KEY,"title" TEXT,"category" TEXT,"plannedDates" TEXT,"weekKeys" TEXT,"instructions" TEXT,"needsReview" INTEGER,"sourceUrl" TEXT,"sourceTitle" TEXT,"sourceCheckedAt" INTEGER);
    CREATE TABLE "Ingredient" ("id" TEXT PRIMARY KEY,"recipeId" TEXT,"name" TEXT,"amount" TEXT,"category" TEXT);
    CREATE TABLE "PantryItem" ("name" TEXT,"quantity" REAL,"unit" TEXT,"expiresAt" INTEGER);
    CREATE TABLE "ShoppingWeek" ("id" TEXT PRIMARY KEY,"startDate" INTEGER,"endDate" INTEGER,"createdAt" INTEGER);
    CREATE TABLE "ShoppingItem" ("id" TEXT PRIMARY KEY,"name" TEXT,"quantity" REAL,"unit" TEXT,"quantityNote" TEXT,"category" TEXT,"ownedQuantity" REAL,"usePlan" TEXT,"purchased" INTEGER,"weekId" TEXT,UNIQUE("weekId","name","unit"));
    CREATE TABLE "AgentJob" ("id" TEXT PRIMARY KEY,"requestId" TEXT,"weekStart" INTEGER,"action" TEXT,"status" TEXT,"inputPath" TEXT,"createdAt" INTEGER,"completedAt" INTEGER,"summary" TEXT,"error" TEXT);
    CREATE TABLE "HiddenRecipeCard" ("id" TEXT PRIMARY KEY,"title" TEXT,"date" TEXT,"createdAt" INTEGER);
  `);
  meal.prepare('INSERT INTO "MealPlan" ("id","date","mainDish","sideDishes","dinnerDiningOut","adultServings","childServings") VALUES (?,?,?,?,0,2,1)')
    .run("day-1", dateMs("2026-10-04"), "테스트볶음", '["테스트반찬"]');
  meal.prepare('INSERT INTO "MealPlan" ("id","date","mainDish","sideDishes","dinnerDiningOut","adultServings","childServings") VALUES (?,?,?,?,0,2,1)')
    .run("day-2", dateMs("2026-10-05"), null, '["테스트반찬"]');
  meal.prepare('INSERT INTO "FamilyMember" ("id","role","allergies") VALUES (?,?,?)').run("child-1", "child", "");
  meal.prepare('INSERT INTO "FamilySchedule" ("date","memberId","isAway") VALUES (?,?,1)')
    .run(dateMs("2026-10-05"), "child-1");
  meal.prepare('INSERT INTO "HiddenRecipeCard" ("id","title","date","createdAt") VALUES (?,?,?,?)')
    .run("hidden-1", "테스트반찬", "2026-10-04", Date.now());
  meal.prepare('INSERT INTO "PantryItem" ("name","quantity","unit") VALUES (?,?,?)').run("돼지고기", 50, "g");
  meal.prepare('INSERT INTO "PantryItem" ("name","quantity","unit") VALUES (?,?,?)').run("쌀", 300, "g");
  meal.prepare('INSERT INTO "ShoppingWeek" ("id","startDate","endDate","createdAt") VALUES (?,?,?,?)')
    .run("week-1", dateMs("2026-10-04"), dateMs("2026-10-10"), Date.now());
  meal.prepare('INSERT INTO "ShoppingItem" ("id","name","quantity","unit","category","ownedQuantity","usePlan","purchased","weekId") VALUES (?,?,?,?,?,?,?,?,?)')
    .run("manual-1", "사과", 2, "개", "과일", 0, "직접 추가", 1, "week-1");
  meal.close();
  const catalog = new DatabaseSync(catalogPath);
  catalog.exec('CREATE TABLE "RecipeCatalogRecipe" ("variantName" TEXT,"servingsText" TEXT,"sourceUrl" TEXT,"ingredientGroups" TEXT)');
  catalog.prepare('INSERT INTO "RecipeCatalogRecipe" ("variantName","servingsText","sourceUrl","ingredientGroups") VALUES (?,?,?,?)')
    .run("테스트볶음", "6인분", "https://www.10000recipe.com/recipe/1234567", JSON.stringify([{ group: "재료", items: ["돼지고기 600g", "양파 2개", "대파 1뿌리", "소금 약간", "쌀 600g", "물 600ml"] }]));
  catalog.prepare('INSERT INTO "RecipeCatalogRecipe" ("variantName","servingsText","sourceUrl","ingredientGroups") VALUES (?,?,?,?)')
    .run("테스트반찬", "6인분", "https://www.10000recipe.com/recipe/1234568", JSON.stringify([{ group: "재료", items: ["당근 600g"] }]));
  catalog.close();
  const run = () => spawnSync(process.execPath, [path.join(sourceRoot, "scripts", "mealctl.mjs"), "rebuild-shopping", "--week", "2026-10-04"], {
    cwd: sourceRoot, encoding: "utf8",
    env: { ...process.env, MEAL_PLAN_ROOT: temporaryRoot, MEAL_DB_PATH: mealPath, MEAL_CATALOG_DB_PATH: catalogPath },
  });
  const first = run();
  assert.equal(first.status, 0, first.stderr);
  const updated = new DatabaseSync(mealPath);
  const pork = updated.prepare('SELECT "quantity","ownedQuantity" FROM "ShoppingItem" WHERE "name"=?').get("돼지고기");
  assert.equal(pork.quantity, 250); // 600g × (2 + 0.5) / 6, without subtracting pantry
  assert.equal(pork.ownedQuantity, 50);
  assert.equal(updated.prepare('SELECT "quantity" FROM "ShoppingItem" WHERE "name"=?').get("쌀").quantity, 250);
  assert.equal(updated.prepare('SELECT "quantity" FROM "ShoppingItem" WHERE "name"=?').get("물").quantity, 250);
  assert.equal(updated.prepare('SELECT "quantity" FROM "ShoppingItem" WHERE "name"=?').get("양파").quantity, 0.83);
  assert.equal(updated.prepare('SELECT "quantity" FROM "ShoppingItem" WHERE "name"=?').get("당근").quantity, 450); // 이어 먹는 이틀: 2.5 + 2인분
  assert.equal(updated.prepare('SELECT "quantity" FROM "ShoppingItem" WHERE "name"=?').get("대파").quantity, 0.42);
  assert.match(updated.prepare('SELECT "quantityNote" FROM "ShoppingItem" WHERE "name"=?').get("소금").quantityNote, /원문: 약간/);
  assert.equal(updated.prepare('SELECT "purchased" FROM "ShoppingItem" WHERE "name"=?').get("사과").purchased, 1);
  updated.close();
  const ambiguous = new DatabaseSync(catalogPath);
  ambiguous.prepare('UPDATE "RecipeCatalogRecipe" SET "servingsText"=?').run("6인분 이상");
  ambiguous.close();
  const second = run();
  assert.equal(second.status, 0, second.stderr);
  assert.ok(JSON.parse(second.stdout).reviewItems >= 4);
  const retained = new DatabaseSync(mealPath, { readOnly: true });
  assert.match(retained.prepare('SELECT "quantityNote" FROM "ShoppingItem" WHERE "name"=?').get("돼지고기").quantityNote, /6인분 이상/);
  retained.close();
  console.log("grocery rebuild tests passed");
} finally {
  const resolvedRoot = fs.realpathSync(temporaryRoot);
  const resolvedTemp = fs.realpathSync(os.tmpdir());
  if (!resolvedRoot.startsWith(`${resolvedTemp}${path.sep}`) || !path.basename(resolvedRoot).startsWith("meal-grocery-rebuild-"))
    throw new Error("Refusing to remove an unexpected test directory");
  fs.rmSync(resolvedRoot, { recursive: true, force: true });
}
