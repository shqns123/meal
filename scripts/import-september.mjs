import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";

const projectRoot = process.cwd();
const sourcePath = process.argv[2] ?? "Z:\\hermes\\data\\meal_plan_web\\web\\meal-september.js";
const dbPath = path.join(projectRoot, "data", "mealplan.db");

if (!fs.existsSync(sourcePath)) throw new Error(`Legacy meal file not found: ${sourcePath}`);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const sandbox = { window: { MEAL_ARCHIVES: {} } };
vm.runInNewContext(fs.readFileSync(sourcePath, "utf8"), sandbox, { filename: sourcePath });
const archive = sandbox.window.MEAL_ARCHIVES["2026-09"];
if (!archive) throw new Error("2026-09 archive was not found in the legacy file.");

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE; PRAGMA busy_timeout = 5000;");
db.exec(`
CREATE TABLE IF NOT EXISTS "FamilyMember" (
  "id" TEXT PRIMARY KEY NOT NULL, "name" TEXT NOT NULL, "role" TEXT NOT NULL,
  "birthDate" DATETIME, "color" TEXT NOT NULL DEFAULT '#e6f3fe', "dietaryNotes" TEXT,
  "allergies" TEXT NOT NULL DEFAULT '', "chewingAbility" TEXT, "spiceTolerance" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "Recipe" (
  "id" TEXT PRIMARY KEY NOT NULL, "title" TEXT NOT NULL, "description" TEXT,
  "prepMinutes" INTEGER NOT NULL DEFAULT 15, "cookMinutes" INTEGER NOT NULL DEFAULT 20,
  "adultServings" INTEGER NOT NULL DEFAULT 2, "childServings" INTEGER NOT NULL DEFAULT 1,
  "tags" TEXT NOT NULL DEFAULT '', "category" TEXT NOT NULL DEFAULT '주찬',
  "plannedDates" TEXT NOT NULL DEFAULT '', "weekKeys" TEXT NOT NULL DEFAULT '',
  "instructions" TEXT NOT NULL DEFAULT '', "babySplitStep" TEXT, "storageMethod" TEXT,
  "consumeWithin" TEXT, "sourceUrl" TEXT, "sourceTitle" TEXT, "sourceAuthor" TEXT,
  "sourceDomain" TEXT, "sourceCheckedAt" DATETIME, "needsReview" BOOLEAN NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
);
CREATE TABLE IF NOT EXISTS "Ingredient" (
  "id" TEXT PRIMARY KEY NOT NULL, "name" TEXT NOT NULL, "amount" TEXT NOT NULL,
  "category" TEXT NOT NULL, "recipeId" TEXT NOT NULL,
  CONSTRAINT "Ingredient_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "MealPlan" (
  "id" TEXT PRIMARY KEY NOT NULL, "date" DATETIME NOT NULL, "monthKey" TEXT NOT NULL,
  "mealType" TEXT NOT NULL, "lunchPlan" TEXT, "mainDish" TEXT, "sideDishes" TEXT NOT NULL DEFAULT '',
  "babyMenu" TEXT, "cookingNote" TEXT, "changeReason" TEXT,
  "adultServings" INTEGER NOT NULL DEFAULT 2, "childServings" INTEGER NOT NULL DEFAULT 1,
  "recipeId" TEXT, "memberId" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "MealPlan_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "Recipe" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "MealPlan_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "FamilyMember" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS "MealPlan_monthKey_date_idx" ON "MealPlan"("monthKey", "date");
CREATE INDEX IF NOT EXISTS "MealPlan_date_mealType_idx" ON "MealPlan"("date", "mealType");
CREATE TABLE IF NOT EXISTS "FamilySchedule" (
  "id" TEXT PRIMARY KEY NOT NULL, "date" DATETIME NOT NULL, "memberId" TEXT NOT NULL,
  "isWorking" BOOLEAN NOT NULL DEFAULT 0, "eatsAtCompany" BOOLEAN NOT NULL DEFAULT 0,
  "isAway" BOOLEAN NOT NULL DEFAULT 0, "note" TEXT,
  CONSTRAINT "FamilySchedule_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "FamilyMember" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "FamilySchedule_date_memberId_key" ON "FamilySchedule"("date", "memberId");
CREATE TABLE IF NOT EXISTS "PantryItem" (
  "id" TEXT PRIMARY KEY NOT NULL, "name" TEXT NOT NULL, "quantity" REAL NOT NULL,
  "unit" TEXT NOT NULL, "category" TEXT NOT NULL, "expiresAt" DATETIME, "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "PantryItem_name_key" ON "PantryItem"("name");
CREATE TABLE IF NOT EXISTS "ShoppingWeek" (
  "id" TEXT PRIMARY KEY NOT NULL, "startDate" DATETIME NOT NULL, "endDate" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "ShoppingWeek_startDate_key" ON "ShoppingWeek"("startDate");
CREATE TABLE IF NOT EXISTS "ShoppingItem" (
  "id" TEXT PRIMARY KEY NOT NULL, "name" TEXT NOT NULL, "quantity" REAL NOT NULL,
  "unit" TEXT NOT NULL, "category" TEXT NOT NULL, "ownedQuantity" REAL NOT NULL DEFAULT 0,
  "usePlan" TEXT NOT NULL, "purchased" BOOLEAN NOT NULL DEFAULT 0, "weekId" TEXT NOT NULL,
  CONSTRAINT "ShoppingItem_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "ShoppingWeek" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "ShoppingItem_weekId_name_key" ON "ShoppingItem"("weekId", "name");
CREATE TABLE IF NOT EXISTS "BudgetPeriod" (
  "id" TEXT PRIMARY KEY NOT NULL, "startDate" DATETIME NOT NULL, "endDate" DATETIME NOT NULL,
  "monthlyLimit" INTEGER NOT NULL DEFAULT 700000, "weeklyMinimum" INTEGER NOT NULL DEFAULT 100000,
  "weeklyMaximum" INTEGER NOT NULL DEFAULT 120000, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "BudgetPeriod_startDate_key" ON "BudgetPeriod"("startDate");
CREATE TABLE IF NOT EXISTS "Expense" (
  "id" TEXT PRIMARY KEY NOT NULL, "date" DATETIME NOT NULL, "amount" INTEGER NOT NULL,
  "category" TEXT NOT NULL, "description" TEXT, "periodId" TEXT NOT NULL,
  CONSTRAINT "Expense_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "BudgetPeriod" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE IF NOT EXISTS "AgentJob" (
  "id" TEXT PRIMARY KEY NOT NULL, "weekStart" DATETIME NOT NULL, "action" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RUNNING', "inputPath" TEXT, "summary" TEXT, "error" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" DATETIME
);
CREATE INDEX IF NOT EXISTS "AgentJob_weekStart_createdAt_idx" ON "AgentJob"("weekStart", "createdAt");
`);

const existing = db.prepare('SELECT COUNT(*) AS count FROM "MealPlan" WHERE "monthKey" = ?').get("2026-09");
if (existing.count > 0) throw new Error("2026-09 already exists in SQLite; import stopped without overwriting it.");

const now = Date.now();
const toMillis = (date) => Date.parse(`${date}T00:00:00+09:00`);
const members = [["member-father", "아빠", "father"], ["member-mother", "엄마", "mother"], ["member-child", "아기", "child"]];
const insertMember = db.prepare('INSERT OR IGNORE INTO "FamilyMember" ("id","name","role","createdAt") VALUES (?,?,?,?)');
for (const member of members) insertMember.run(...member, now);

const recipeByTitle = new Map();
const insertRecipe = db.prepare(`INSERT INTO "Recipe" (
  "id","title","description","adultServings","childServings","tags","category","plannedDates","weekKeys",
  "instructions","babySplitStep","storageMethod","consumeWithin","needsReview","createdAt","updatedAt"
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const insertIngredient = db.prepare('INSERT INTO "Ingredient" ("id","name","amount","category","recipeId") VALUES (?,?,?,?,?)');
archive.recipes.forEach((recipe, index) => {
  const recipeId = `recipe-2026-09-${String(index + 1).padStart(2, "0")}`;
  recipeByTitle.set(recipe.title, recipeId);
  insertRecipe.run(recipeId, recipe.title, "이전 앱에서 가져온 레시피이며 번호가 있는 조리 순서는 보완이 필요합니다.", 2, 1, "이전 앱", recipe.category ?? "주찬", recipe.date, JSON.stringify(recipe.weeks ?? []), "", recipe.baby ?? null, recipe.storage ?? null, recipe.storage ?? null, 1, now, now);
  const ingredientGroups = [[recipe.ingredients, "재료"], [recipe.seasoning, "양념"]];
  let ingredientIndex = 0;
  for (const [text, category] of ingredientGroups) {
    for (const item of String(text ?? "").split(",").map((value) => value.trim()).filter(Boolean)) {
      ingredientIndex += 1;
      insertIngredient.run(`${recipeId}-ingredient-${ingredientIndex}`, item, item, category, recipeId);
    }
  }
});

const corrections = {
  "2026-09-08": { main: "대구살채소찜", baby: "대구살채소찜(간 전)", reason: "같은 달의 대구살구이 반복을 피하도록 조리법 변경" },
};
const insertMeal = db.prepare(`INSERT INTO "MealPlan" (
  "id","date","monthKey","mealType","lunchPlan","mainDish","sideDishes","babyMenu","cookingNote","changeReason",
  "adultServings","childServings","recipeId","createdAt","updatedAt"
) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
for (const [date, meal] of Object.entries(archive.meals)) {
  const detail = archive.monthlyDetails[date];
  const correction = corrections[date];
  const main = correction?.main ?? detail.main;
  const baby = correction?.baby ?? detail.baby;
  insertMeal.run(`meal-${date}-dinner`, toMillis(date), "2026-09", "DINNER", meal.lunch, main, JSON.stringify(detail.sides), baby, meal.note ?? null, correction?.reason ?? null, 2, 1, recipeByTitle.get(main) ?? null, now, now);
}

const insertSchedule = db.prepare('INSERT INTO "FamilySchedule" ("id","date","memberId","isWorking","eatsAtCompany","isAway","note") VALUES (?,?,?,?,?,?,?)');
for (const day of ["05", "12", "19", "26"]) {
  insertSchedule.run(`schedule-father-2026-09-${day}`, toMillis(`2026-09-${day}`), "member-father", 1, 1, 0, "기존 9월 식단에 기록된 주말 출근 및 회사 점심");
}

db.prepare(`INSERT INTO "BudgetPeriod" ("id","startDate","endDate","monthlyLimit","weeklyMinimum","weeklyMaximum","createdAt") VALUES (?,?,?,?,?,?,?)`)
  .run("budget-2026-09-05", toMillis("2026-09-05"), toMillis("2026-10-04"), 700000, 100000, 120000, now);
for (const start of ["2026-08-30", "2026-09-06", "2026-09-13", "2026-09-20", "2026-09-27"]) {
  const end = new Date(toMillis(start)); end.setUTCDate(end.getUTCDate() + 6);
  db.prepare('INSERT INTO "ShoppingWeek" ("id","startDate","endDate","createdAt") VALUES (?,?,?,?)').run(`shopping-week-${start}`, toMillis(start), end.getTime(), now);
}

console.log(JSON.stringify({ database: dbPath, month: "2026-09", meals: Object.keys(archive.meals).length, recipes: archive.recipes.length, schedules: 4, shoppingItems: 0, correctionCount: Object.keys(corrections).length }, null, 2));
db.close();
