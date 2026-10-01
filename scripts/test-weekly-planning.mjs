import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const project = path.resolve(import.meta.dirname, "..");
const sourceDb = path.join(project, "data", "mealplan.db");
const sourceCatalog = path.join(project, "data", "10000recipe-catalog.db");
if (!fs.existsSync(sourceDb) || !fs.existsSync(sourceCatalog)) {
  console.log("weekly planning integration skipped: local SQLite data unavailable");
  process.exit(0);
}
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "meal-week-test-"));
const dbPath = path.join(temporary, "mealplan.db");
fs.copyFileSync(sourceDb, dbPath);
const env = { ...process.env, MEAL_PLAN_ROOT: temporary, MEAL_DB_PATH: dbPath,
  MEAL_CATALOG_DB_PATH: sourceCatalog };
function ctl(...args) {
  const result = spawnSync(process.execPath, [path.join(project, "scripts", "mealctl.mjs"), ...args],
    { cwd: project, env, encoding: "utf8", timeout: 120_000 });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}
function addDays(date, amount) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric",
  month: "2-digit", day: "2-digit" }).format(new Date());
const weekStart = addDays(today, 7 - new Date(`${today}T00:00:00Z`).getUTCDay());
const cutoff = Date.parse(`${weekStart}T00:00:00+09:00`);
try {
  const seed = new DatabaseSync(dbPath);
  if (!seed.prepare('SELECT 1 FROM "MealPlan" WHERE "date">=? LIMIT 1').get(cutoff))
    seed.prepare('INSERT INTO "MealPlan" ("id","date","monthKey","mealType","lunchPlan","mainDish","soupDish","mealStyle","sideDishes","babyMenu","cookingNote","changeReason","adultServings","childServings","dinnerDiningOut","createdAt","updatedAt") SELECT ?,?,?,"mealType","lunchPlan","mainDish","soupDish","mealStyle","sideDishes","babyMenu","cookingNote","changeReason","adultServings","childServings","dinnerDiningOut","createdAt","updatedAt" FROM "MealPlan" ORDER BY "date" DESC LIMIT 1')
      .run("test-future-plan", cutoff, weekStart.slice(0, 7));
  seed.close();
  const before = new DatabaseSync(dbPath, { readOnly: true });
  const preserved = before.prepare('SELECT COUNT(*) AS count FROM "MealPlan" WHERE "date"<?')
    .get(cutoff).count;
  before.close();
  const pruned = ctl("prune-future-meals", "--from", weekStart, "--confirm", "true");
  assert.ok(pruned.deletedMeals > 0);
  assert.ok(fs.existsSync(pruned.backup));
  let payload = ctl("generate-catalog-week", "--week", weekStart, "--salt", "integration");
  const reviewDb = new DatabaseSync(dbPath);
  reviewDb.prepare('INSERT INTO "WeeklyReview" ("id","weekStart","referenceDate","wantedFoods","avoidFoods","note","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)')
    .run("test-weekly-review", cutoff, cutoff, "카레", "", null, Date.now(), Date.now());
  reviewDb.close();
  const staleInput = path.join(temporary, "stale-week.json");
  fs.writeFileSync(staleInput, JSON.stringify(payload));
  const staleWeek = spawnSync(process.execPath,
    [path.join(project, "scripts", "mealctl.mjs"), "publish-new-week", "--input", staleInput, "--week", weekStart],
    { cwd: project, env, encoding: "utf8", timeout: 120_000 });
  assert.notEqual(staleWeek.status, 0, "a changed weekly review must invalidate an older generated week");
  payload = ctl("generate-catalog-week", "--week", weekStart, "--salt", "integration");
  assert.deepEqual(payload.mealChanges.map((change) => change.date),
    Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)));
  assert.ok(payload.mealChanges.every((change) => change.main && change.sides.length === 2
    && change.sides[0] !== change.sides[1]));
  const input = path.join(temporary, "week.json");
  fs.writeFileSync(input, JSON.stringify(payload));
  assert.equal(ctl("validate-new-week", "--input", input, "--week", weekStart).valid, true);
  const published = ctl("publish-new-week", "--input", input, "--week", weekStart);
  assert.equal(published.mealChanges, 7);
  const snapshot = ctl("context", "--week", weekStart);
  const staleRegeneration = { ...payload, expectedRevisions: Object.fromEntries(snapshot.meals.map((meal) => [meal.date, meal.revision])) };
  const revisionDb = new DatabaseSync(dbPath);
  revisionDb.prepare('UPDATE "MealPlan" SET "updatedAt"="updatedAt"+1000 WHERE "date"=?')
    .run(Date.parse(`${payload.mealChanges[0].date}T00:00:00+09:00`));
  revisionDb.close();
  fs.writeFileSync(input, JSON.stringify(staleRegeneration));
  const staleDays = spawnSync(process.execPath,
    [path.join(project, "scripts", "mealctl.mjs"), "publish-days", "--input", input],
    { cwd: project, env, encoding: "utf8", timeout: 120_000 });
  assert.notEqual(staleDays.status, 0, "a changed meal must invalidate an older regeneration");
  const invalid = { ...payload, mealChanges: [{ ...payload.mealChanges[0], sides: [""] }] };
  fs.writeFileSync(input, JSON.stringify(invalid));
  const rejected = spawnSync(process.execPath,
    [path.join(project, "scripts", "mealctl.mjs"), "publish-days", "--input", input],
    { cwd: project, env, encoding: "utf8", timeout: 120_000 });
  assert.equal(rejected.status, 2, "invalid sides must be rejected before changing stored meals");
  assert.match(rejected.stdout, /exactly two named side dishes/);
  const unchanged = new DatabaseSync(dbPath, { readOnly: true });
  assert.equal(unchanged.prepare('SELECT "mainDish" FROM "MealPlan" WHERE "date"=?')
    .get(Date.parse(`${payload.mealChanges[0].date}T00:00:00+09:00`)).mainDish, payload.mealChanges[0].main);
  unchanged.close();
  fs.writeFileSync(input, JSON.stringify(payload));
  const duplicate = spawnSync(process.execPath,
    [path.join(project, "scripts", "mealctl.mjs"), "publish-new-week", "--input", input, "--week", weekStart],
    { cwd: project, env, encoding: "utf8", timeout: 120_000 });
  assert.notEqual(duplicate.status, 0, "a scheduled retry must not overwrite an existing week");
  const dated = payload.mealChanges.slice(0, 2);
  const fixture = new DatabaseSync(dbPath);
  for (const [index, change] of dated.entries()) {
    const id = `test-recipe-${index}`;
    const title = index === 0 ? change.main : change.sides[0];
    fixture.prepare('INSERT INTO "Recipe" ("id","title","category","plannedDates","weekKeys","instructions","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?)')
      .run(id, title, index === 0 ? "주찬" : "부찬", JSON.stringify([change.date]), JSON.stringify([weekStart]), "test", Date.now(), Date.now());
    fixture.prepare('INSERT INTO "Ingredient" ("id","name","amount","category","recipeId") VALUES (?,?,?,?,?)')
      .run(`test-ingredient-${index}`, `테스트재료${index}`, "2g", "기타", id);
    if (index === 0) fixture.prepare('UPDATE "MealPlan" SET "recipeId"=? WHERE "date"=?')
      .run(id, Date.parse(`${change.date}T00:00:00+09:00`));
  }
  fixture.close();
  fs.writeFileSync(input, JSON.stringify(payload));
  ctl("publish-days", "--input", input);
  const retained = new DatabaseSync(dbPath);
  assert.equal(retained.prepare('SELECT COUNT(*) AS count FROM "Recipe" WHERE "id" LIKE ?').get("test-recipe-%").count, 2,
    "publishing unchanged meals must retain their recipes");
  assert.equal(retained.prepare('SELECT "recipeId" FROM "MealPlan" WHERE "date"=?')
    .get(Date.parse(`${dated[0].date}T00:00:00+09:00`)).recipeId, "test-recipe-0");
  const weekId = retained.prepare('SELECT "id" FROM "ShoppingWeek" WHERE "startDate"=?').get(cutoff).id;
  retained.prepare('UPDATE "ShoppingItem" SET "purchased"=1 WHERE "weekId"=? AND "name"=?').run(weekId, "테스트재료1");
  retained.prepare('INSERT INTO "ShoppingItem" ("id","name","quantity","unit","category","ownedQuantity","usePlan","purchased","weekId") VALUES (?,?,?,?,?,?,?,?,?)')
    .run("test-manual", "테스트직접추가", 1, "개", "기타", 0, "직접 추가", 1, weekId);
  retained.close();
  const alternateMain = payload.mealChanges.find((change) => change.main !== dated[0].main)?.main;
  assert.ok(alternateMain);
  const changed = { ...payload, mealChanges: [{ ...dated[0], main: alternateMain }] };
  fs.writeFileSync(input, JSON.stringify(changed));
  ctl("publish-days", "--input", input);
  const checked = new DatabaseSync(dbPath, { readOnly: true });
  assert.equal(checked.prepare('SELECT COUNT(*) AS count FROM "Recipe" WHERE "id"=?').get("test-recipe-0").count, 0);
  assert.equal(checked.prepare('SELECT COUNT(*) AS count FROM "Recipe" WHERE "id"=?').get("test-recipe-1").count, 1);
  assert.equal(checked.prepare('SELECT "purchased" FROM "ShoppingItem" WHERE "weekId"=? AND "name"=?')
    .get(weekId, "테스트재료1").purchased, 1);
  assert.equal(checked.prepare('SELECT "purchased" FROM "ShoppingItem" WHERE "id"=?').get("test-manual").purchased, 1);
  checked.close();
  const regenerated = ctl("generate-catalog-week", "--week", weekStart, "--salt", "regenerate");
  fs.writeFileSync(input, JSON.stringify(regenerated));
  assert.equal(ctl("publish-days", "--input", input).mealChanges, 7,
    "regenerating an existing week must publish all seven dates");
  const dayBefore = new DatabaseSync(dbPath, { readOnly: true });
  const firstDateMs = Date.parse(`${dated[0].date}T00:00:00+09:00`);
  const originalDay = dayBefore.prepare('SELECT "soupDish","mealStyle","sideDishes" FROM "MealPlan" WHERE "date"=?').get(firstDateMs);
  dayBefore.close();
  const mainOnly = ctl("generate-catalog-day", "--date", dated[0].date, "--slot", "main", "--salt", "main-only");
  assert.equal(mainOnly.mealChanges[0].soup, originalDay.soupDish);
  assert.equal(mainOnly.mealChanges[0].mealStyle, originalDay.mealStyle);
  assert.deepEqual(mainOnly.mealChanges[0].sides, JSON.parse(originalDay.sideDishes));
  mainOnly.expectedRevisions = { [dated[0].date]: -1 };
  fs.writeFileSync(input, JSON.stringify(mainOnly));
  const staleDay = spawnSync(process.execPath,
    [path.join(project, "scripts", "mealctl.mjs"), "publish-day", "--input", input, "--week", weekStart, "--date", dated[0].date],
    { cwd: project, env, encoding: "utf8", timeout: 120_000 });
  assert.notEqual(staleDay.status, 0, "daily publication must reject a changed meal revision");
  mainOnly.expectedRevisions = { [dated[0].date]: ctl("context", "--week", weekStart).meals.find((meal) => meal.date === dated[0].date).revision };
  fs.writeFileSync(input, JSON.stringify(mainOnly));
  ctl("publish-day", "--input", input, "--week", weekStart, "--date", dated[0].date);
  const invalidDate = spawnSync(process.execPath,
    [path.join(project, "scripts", "mealctl.mjs"), "generate-catalog-day", "--date", "2026-02-31"],
    { cwd: project, env, encoding: "utf8", timeout: 120_000 });
  assert.notEqual(invalidDate.status, 0, "an impossible date must be rejected instead of normalized");
  const after = new DatabaseSync(dbPath, { readOnly: true });
  assert.equal(after.prepare('SELECT COUNT(*) AS count FROM "MealPlan" WHERE "date"<?')
    .get(cutoff).count, preserved);
  assert.equal(after.prepare('SELECT COUNT(*) AS count FROM "MealPlan" WHERE "date">=? AND "date"<?')
    .get(cutoff, Date.parse(`${addDays(weekStart, 7)}T00:00:00+09:00`)).count, 7);
  after.close();
  for (const offset of [7, 14, 21, 28]) {
    const week = addDays(weekStart, offset);
    const next = ctl("generate-catalog-week", "--week", week, "--salt", "integration");
    assert.ok(next.mealChanges.every((change) => change.sides.length === 2
      && change.sides[0] !== change.sides[1]), `${week} must have two distinct sides each day`);
    fs.writeFileSync(input, JSON.stringify(next));
    assert.equal(ctl("validate-new-week", "--input", input, "--week", week).valid, true);
    ctl("publish-new-week", "--input", input, "--week", week);
  }
  let boundaryWeek = addDays(weekStart, 35);
  while (boundaryWeek.slice(0, 7) === addDays(boundaryWeek, 6).slice(0, 7))
    boundaryWeek = addDays(boundaryWeek, 7);
  const crossMonth = ctl("generate-catalog-week", "--week", boundaryWeek, "--salt", "cross-month");
  fs.writeFileSync(input, JSON.stringify(crossMonth));
  assert.equal(ctl("validate-new-week", "--input", input, "--week", boundaryWeek).valid, true);
  ctl("publish-new-week", "--input", input, "--week", boundaryWeek);
  const boundary = new DatabaseSync(dbPath, { readOnly: true });
  assert.deepEqual(boundary.prepare('SELECT DISTINCT "monthKey" FROM "MealPlan" WHERE "date">=? AND "date"<? ORDER BY "monthKey"')
    .all(Date.parse(`${boundaryWeek}T00:00:00+09:00`), Date.parse(`${addDays(boundaryWeek, 7)}T00:00:00+09:00`))
    .map((row) => row.monthKey), [boundaryWeek.slice(0, 7), addDays(boundaryWeek, 6).slice(0, 7)]);
  boundary.close();
  console.log("weekly planning integration checks passed");
} finally {
  fs.rmSync(temporary, { recursive: true, force: true });
}
