#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.env.MEAL_PLAN_ROOT ?? process.cwd();
const dbPath = process.env.MEAL_DB_PATH ?? path.join(root, "data", "mealplan.db");
const command = process.argv[2];
const flags = parseFlags(process.argv.slice(3));

if (!command || !["context", "validate-week", "publish-week", "publish-recipes", "validate-day", "publish-day", "rebuild-shopping", "reply-chat", "record-review"].includes(command)) usage();
if (!fs.existsSync(dbPath)) fail(`Database not found: ${dbPath}`);

const db = new DatabaseSync(dbPath);
db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE; PRAGMA busy_timeout = 5000;");

function parseFlags(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!key?.startsWith("--") || args[index + 1] === undefined) usage();
    parsed[key.slice(2)] = args[index + 1];
  }
  return parsed;
}

function usage() {
  console.error(`Usage:
  node scripts/mealctl.mjs context --week YYYY-MM-DD
  node scripts/mealctl.mjs validate-week --input /path/week.json [--week YYYY-MM-DD]
  node scripts/mealctl.mjs publish-week --input /path/week.json --week YYYY-MM-DD
  node scripts/mealctl.mjs publish-recipes --input /path/week.json --week YYYY-MM-DD
  node scripts/mealctl.mjs validate-day --input /path/day.json --week YYYY-MM-DD --date YYYY-MM-DD
  node scripts/mealctl.mjs publish-day --input /path/day.json --week YYYY-MM-DD --date YYYY-MM-DD
  node scripts/mealctl.mjs rebuild-shopping --week YYYY-MM-DD
  node scripts/mealctl.mjs reply-chat --id REQUEST_ID --input /path/chat-response.json
  node scripts/mealctl.mjs record-review --week YYYY-MM-DD --summary "reason"`);
  process.exit(1);
}

function fail(message) { console.error(message); process.exit(1); }
function printJson(value) { console.log(JSON.stringify(value, null, 2)); }
function requireWeek(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) fail("--week must be YYYY-MM-DD.");
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.getUTCDay() !== 0) fail("--week must be a Sunday.");
  return value;
}
function toMillis(date) { return Date.parse(`${date}T00:00:00+09:00`); }
function addDays(date, days) { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
function formatKst(value) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)); }
function parseJsonList(value) { try { return JSON.parse(value || "[]"); } catch { return String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean); } }
function readPayload(inputPath) {
  if (!inputPath) fail("--input is required.");
  if (!fs.existsSync(inputPath)) fail(`Input file not found: ${inputPath}`);
  try { return JSON.parse(fs.readFileSync(inputPath, "utf8")); } catch (error) { fail(`Invalid JSON: ${error.message}`); }
}

function loadContext(weekStart) {
  const weekEnd = addDays(weekStart, 6);
  const startMs = toMillis(weekStart);
  const endExclusiveMs = toMillis(addDays(weekStart, 7));
  const mealRows = db.prepare('SELECT * FROM "MealPlan" WHERE "date" >= ? AND "date" < ? ORDER BY "date"').all(startMs, endExclusiveMs);
  const schedules = db.prepare(`SELECT s.*, m.name AS memberName, m.role AS memberRole FROM "FamilySchedule" s JOIN "FamilyMember" m ON m.id=s.memberId WHERE s.date>=? AND s.date<? ORDER BY s.date`).all(startMs, endExclusiveMs);
  const pantry = db.prepare('SELECT * FROM "PantryItem" ORDER BY CASE WHEN "expiresAt" IS NULL THEN 1 ELSE 0 END, "expiresAt", "name"').all();
  const budgetPeriods = db.prepare('SELECT * FROM "BudgetPeriod" WHERE "endDate" >= ? AND "startDate" < ? ORDER BY "startDate"').all(startMs, endExclusiveMs);
  const weeklyReview = db.prepare('SELECT * FROM "WeeklyReview" WHERE "weekStart"=?').get(startMs) ?? null;
  const existingRecipes = db.prepare('SELECT "id","title","category","plannedDates","sourceUrl","sourceTitle","sourceAuthor","sourceDomain","sourceCheckedAt","needsReview" FROM "Recipe" WHERE "weekKeys" LIKE ? ORDER BY "plannedDates","title"').all(`%${weekStart}%`);
  const recipeLibrary = db.prepare('SELECT "id","title","category","sourceUrl","sourceTitle","sourceAuthor","sourceDomain","sourceCheckedAt" FROM "Recipe" WHERE "needsReview"=0 AND "sourceUrl" IS NOT NULL ORDER BY "title"').all();
  return {
    schemaVersion: "meal-week.v1",
    weekStart,
    weekEnd,
    timezone: "Asia/Seoul",
    rules: { agents: path.join(root, "AGENTS.md"), meal: path.join(root, "MEAL.md") },
    family: db.prepare('SELECT "id","name","role","allergies","chewingAbility","spiceTolerance","dietaryNotes" FROM "FamilyMember" ORDER BY "role"').all(),
    schedules: schedules.map((item) => ({ ...item, date: formatKst(item.date) })),
    meals: mealRows.map((meal) => ({ date: formatKst(meal.date), lunch: meal.lunchPlan, main: meal.mainDish, sides: parseJsonList(meal.sideDishes), baby: meal.babyMenu, note: meal.cookingNote })),
    pantry,
    budgetPeriods,
    weeklyReview: weeklyReview ? { ...weeklyReview, weekStart: formatKst(weeklyReview.weekStart), referenceDate: weeklyReview.referenceDate ? formatKst(weeklyReview.referenceDate) : weekStart } : null,
    existingRecipes,
    recipeLibrary,
    outputContract: {
      weekStart: "YYYY-MM-DD (Sunday)",
      changeReason: "string",
      mealChanges: [{ date: "YYYY-MM-DD", main: "string", sides: ["side 1", "side 2"], lunch: "optional string", baby: "optional string", note: "optional string" }],
      recipes: [{ title: "string", category: "주찬|반찬|점심", plannedDates: ["YYYY-MM-DD"], prepMinutes: 15, cookMinutes: 20, adultServings: 2, childServings: 1, ingredients: [{ name: "string", quantity: 100, unit: "g|ml|개|팩|모", category: "string" }], instructions: ["1. ...", "2. ..."], babySplitStep: "string", storageMethod: "string", consumeWithin: "string", sourceUrl: "https://verified-blog-post", sourceTitle: "verified page title", sourceAuthor: "author or null", sourceCheckedAt: "YYYY-MM-DD" }],
    },
  };
}

const banned = ["브로콜리", "파프리카", "피망"];
const basicStock = new Set(["쌀", "밥", "김치", "깍두기", "소금", "설탕", "간장", "식초", "고춧가루", "고추장", "된장", "참기름", "식용유", "다진 마늘", "후추"]);
const allowedBlogHosts = new Set(["blog.naver.com", "m.blog.naver.com"]);

function validatePayload(payload, weekStart, scopeDate = null) {
  const errors = [];
  const warnings = ["가격 데이터가 없어 주간 예산 상한은 자동 검증하지 못합니다."];
  if (payload?.schemaVersion && payload.schemaVersion !== "meal-week.v1") errors.push("schemaVersion must be meal-week.v1.");
  if (payload?.weekStart !== weekStart) errors.push(`weekStart must be ${weekStart}.`);
  if (!String(payload?.changeReason ?? "").trim()) errors.push("changeReason is required.");
  if (!Array.isArray(payload?.recipes) || payload.recipes.length === 0) errors.push("recipes must contain at least one recipe.");

  const startMs = toMillis(weekStart);
  const endExclusiveMs = toMillis(addDays(weekStart, 7));
  const plans = db.prepare('SELECT "id","date","lunchPlan","mainDish","sideDishes","babyMenu","cookingNote" FROM "MealPlan" WHERE "date">=? AND "date"<? ORDER BY "date"').all(startMs, endExclusiveMs);
  const plansByDate = new Map(plans.map((plan) => [formatKst(plan.date), plan]));
  const changedDates = new Set();
  if (payload.mealChanges !== undefined && !Array.isArray(payload.mealChanges)) errors.push("mealChanges must be an array when provided.");
  for (const [index, change] of (payload.mealChanges ?? []).entries()) {
    const at = `mealChanges[${index}]`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(change.date ?? "") || change.date < weekStart || change.date > addDays(weekStart, 6)) errors.push(`${at}.date must be inside the selected week.`);
    if (changedDates.has(change.date)) errors.push(`${at}.date is duplicated.`);
    changedDates.add(change.date);
    const plan = plansByDate.get(change.date);
    if (!plan) errors.push(`${at}.date does not have an existing meal plan.`);
    if (!String(change.main ?? "").trim()) errors.push(`${at}.main is required.`);
    if (!Array.isArray(change.sides) || change.sides.length !== 2 || change.sides.some((side) => !String(side).trim())) errors.push(`${at}.sides must contain exactly two named side dishes.`);
    if (Array.isArray(change.sides) && new Set(change.sides.map(normalizeName)).size !== change.sides.length) errors.push(`${at}.sides must not contain duplicates.`);
    const text = JSON.stringify(change);
    for (const item of banned) if (text.includes(item)) errors.push(`${at} contains banned ingredient: ${item}`);
    if (plan) {
      plan.mainDish = String(change.main ?? "").trim();
      plan.sideDishes = JSON.stringify(change.sides ?? []);
      if (Object.hasOwn(change, "lunch")) plan.lunchPlan = change.lunch ?? null;
      if (Object.hasOwn(change, "baby")) plan.babyMenu = change.baby ?? null;
      if (Object.hasOwn(change, "note")) plan.cookingNote = change.note ?? null;
    }
  }
  if (scopeDate && (changedDates.size !== 1 || !changedDates.has(scopeDate))) errors.push(`mealChanges must contain exactly ${scopeDate} for a daily update.`);
  const coverage = new Set();
  const unitsByIngredient = new Map();

  for (const [index, recipe] of (payload.recipes ?? []).entries()) {
    const at = `recipes[${index}]`;
    if (!String(recipe.title ?? "").trim()) errors.push(`${at}.title is required.`);
    if (!["주찬", "반찬", "점심"].includes(recipe.category)) errors.push(`${at}.category must be 주찬, 반찬, or 점심.`);
    if (!Number.isInteger(recipe.prepMinutes) || recipe.prepMinutes < 0) errors.push(`${at}.prepMinutes must be a non-negative integer.`);
    if (!Number.isInteger(recipe.cookMinutes) || recipe.cookMinutes < 1) errors.push(`${at}.cookMinutes must be a positive integer.`);
    if (recipe.tags !== undefined && !Array.isArray(recipe.tags)) errors.push(`${at}.tags must be an array when provided.`);
    if (!Array.isArray(recipe.plannedDates) || recipe.plannedDates.length === 0) errors.push(`${at}.plannedDates is required.`);
    for (const date of recipe.plannedDates ?? []) {
      if (date < weekStart || date > addDays(weekStart, 6)) errors.push(`${at}.plannedDates contains a date outside the selected week: ${date}`);
      if (scopeDate && date !== scopeDate) errors.push(`${at}.plannedDates must contain only ${scopeDate} for a daily update.`);
      coverage.add(`${date}|${recipe.title}`);
    }
    if (!Number.isInteger(recipe.adultServings) || recipe.adultServings < 0) errors.push(`${at}.adultServings must be a non-negative integer.`);
    if (!Number.isInteger(recipe.childServings) || recipe.childServings < 0) errors.push(`${at}.childServings must be a non-negative integer.`);
    if (!Array.isArray(recipe.ingredients) || recipe.ingredients.length === 0) errors.push(`${at}.ingredients is required.`);
    for (const [ingredientIndex, ingredient] of (recipe.ingredients ?? []).entries()) {
      const ingredientAt = `${at}.ingredients[${ingredientIndex}]`;
      if (!String(ingredient.name ?? "").trim()) errors.push(`${ingredientAt}.name is required.`);
      if (!(Number(ingredient.quantity) > 0)) errors.push(`${ingredientAt}.quantity must be greater than zero.`);
      if (!String(ingredient.unit ?? "").trim()) errors.push(`${ingredientAt}.unit is required.`);
      const normalized = normalizeName(ingredient.name);
      const units = unitsByIngredient.get(normalized) ?? new Set(); units.add(ingredient.unit); unitsByIngredient.set(normalized, units);
    }
    if (!Array.isArray(recipe.instructions) || recipe.instructions.length < 2) errors.push(`${at}.instructions must contain at least two numbered steps.`);
    else recipe.instructions.forEach((step, stepIndex) => { if (!new RegExp(`^${stepIndex + 1}[.)]\\s`).test(String(step).trim())) errors.push(`${at}.instructions[${stepIndex}] must start with ${stepIndex + 1}. or ${stepIndex + 1}).`); });
    if (!String(recipe.babySplitStep ?? "").trim()) errors.push(`${at}.babySplitStep is required.`);
    if (!String(recipe.storageMethod ?? "").trim()) errors.push(`${at}.storageMethod is required.`);
    if (!String(recipe.consumeWithin ?? "").trim()) errors.push(`${at}.consumeWithin is required.`);
    if (["주찬", "반찬"].includes(recipe.category) || recipe.sourceUrl) validateBlogSource(recipe, at, errors);
    const text = JSON.stringify(recipe);
    for (const item of banned) if (text.includes(item)) errors.push(`${at} contains banned ingredient: ${item}`);
  }
  for (const [name, units] of unitsByIngredient) if (units.size > 1) errors.push(`Ingredient '${name}' uses incompatible units: ${[...units].join(", ")}.`);

  for (const plan of plans) {
    const date = formatKst(plan.date);
    if (scopeDate && date !== scopeDate) continue;
    for (const dish of [plan.mainDish, ...parseJsonList(plan.sideDishes)].filter(Boolean)) if (!coverage.has(`${date}|${dish}`)) errors.push(`Missing recipe coverage for ${date}: ${dish}`);
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    if ([0, 6].includes(day) && plan.lunchPlan && !plan.lunchPlan.includes("회사 식사")) {
      const hasLunch = (payload.recipes ?? []).some((recipe) => recipe.category === "점심" && recipe.plannedDates?.includes(date));
      if (!hasLunch) errors.push(`Missing lunch recipe for ${date}: ${plan.lunchPlan}`);
    }
  }
  const shopping = errors.length ? [] : calculateShopping(payload.recipes, weekStart);
  return { valid: errors.length === 0, weekStart, errors, warnings, counts: { meals: plans.length, mealChanges: payload.mealChanges?.length ?? 0, recipes: payload.recipes?.length ?? 0, shoppingItems: shopping.length }, shoppingPreview: shopping };
}

function validateDay(payload, weekStart, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < weekStart || date > addDays(weekStart, 6)) fail("--date must be inside the selected week.");
  return validatePayload(payload, weekStart, date);
}

function normalizeName(value) { return String(value).trim().replace(/\s+/g, " "); }
function validateBlogSource(recipe, at, errors) {
  if (!String(recipe.sourceUrl ?? "").trim()) { errors.push(`${at}.sourceUrl is required for 주찬 and 반찬.`); return; }
  try {
    const source = new URL(recipe.sourceUrl);
    const host = source.hostname.toLowerCase();
    if (source.protocol !== "https:") errors.push(`${at}.sourceUrl must use https.`);
    if (!allowedBlogHosts.has(host) && !host.endsWith(".tistory.com")) errors.push(`${at}.sourceUrl must be a Naver Blog or Tistory post.`);
  } catch { errors.push(`${at}.sourceUrl must be a valid URL.`); }
  if (!String(recipe.sourceTitle ?? "").trim()) errors.push(`${at}.sourceTitle is required.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(recipe.sourceCheckedAt ?? "")) errors.push(`${at}.sourceCheckedAt must be YYYY-MM-DD.`);
}
function calculateShopping(recipes, weekStart) {
  const pantryRows = db.prepare('SELECT "name","quantity","unit" FROM "PantryItem"').all();
  const pantry = new Map(pantryRows.map((item) => [`${normalizeName(item.name)}|${item.unit}`, item.quantity]));
  const totals = new Map();
  for (const recipe of recipes) for (const ingredient of recipe.ingredients) {
    const name = normalizeName(ingredient.name);
    if (basicStock.has(name)) continue;
    const key = `${name}|${ingredient.unit}`;
    const current = totals.get(key) ?? { name, quantity: 0, unit: ingredient.unit, category: ingredient.category ?? "기타", uses: [] };
    current.quantity += Number(ingredient.quantity);
    for (const date of recipe.plannedDates) current.uses.push(`${date.slice(5)} ${recipe.title}`);
    totals.set(key, current);
  }
  return [...totals.entries()].map(([key, item]) => {
    const ownedQuantity = Math.min(Number(pantry.get(key) ?? 0), item.quantity);
    return { ...item, quantity: round(item.quantity - ownedQuantity), requiredQuantity: round(item.quantity), ownedQuantity: round(ownedQuantity), usePlan: [...new Set(item.uses)].sort().join(" · "), purchased: false, weekStart };
  }).filter((item) => item.quantity > 0).sort((a, b) => a.usePlan.localeCompare(b.usePlan, "ko") || a.name.localeCompare(b.name, "ko"));
}
function round(value) { return Math.round((value + Number.EPSILON) * 100) / 100; }

function insertRecipes(recipes, weekStart, prefix, now) {
  const insertRecipe = db.prepare(`INSERT INTO "Recipe" ("id","title","description","prepMinutes","cookMinutes","adultServings","childServings","tags","category","plannedDates","weekKeys","instructions","babySplitStep","storageMethod","consumeWithin","sourceUrl","sourceTitle","sourceAuthor","sourceDomain","sourceCheckedAt","needsReview","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertIngredient = db.prepare('INSERT INTO "Ingredient" ("id","name","amount","category","recipeId") VALUES (?,?,?,?,?)');
  const recipeIds = new Map();
  for (const recipe of recipes) {
    const id = `${prefix}${crypto.createHash("sha1").update(`${recipe.category}|${recipe.title}|${recipe.plannedDates.join(",")}`).digest("hex").slice(0, 12)}`;
    recipeIds.set(recipe.title, id);
    const sourceDomain = recipe.sourceUrl ? new URL(recipe.sourceUrl).hostname.toLowerCase() : null;
    insertRecipe.run(id, recipe.title, recipe.description ?? null, recipe.prepMinutes, recipe.cookMinutes, recipe.adultServings, recipe.childServings, (recipe.tags ?? []).join(","), recipe.category, JSON.stringify(recipe.plannedDates), JSON.stringify([weekStart]), JSON.stringify(recipe.instructions), recipe.babySplitStep, recipe.storageMethod, recipe.consumeWithin, recipe.sourceUrl ?? null, recipe.sourceTitle ?? null, recipe.sourceAuthor ?? null, sourceDomain, recipe.sourceCheckedAt ? toMillis(recipe.sourceCheckedAt) : null, 0, now, now);
    recipe.ingredients.forEach((ingredient, index) => insertIngredient.run(`${id}-ingredient-${index + 1}`, ingredient.name, `${ingredient.quantity}${ingredient.unit}`, ingredient.category ?? "기타", id));
  }
  return recipeIds;
}

function storedRecipes(weekStart, { skipInvalid = false } = {}) {
  const rows = db.prepare('SELECT r."id",r."title",r."category",r."plannedDates",i."name",i."amount",i."category" AS "ingredientCategory" FROM "Recipe" r LEFT JOIN "Ingredient" i ON i."recipeId"=r."id" WHERE r."weekKeys" LIKE ? ORDER BY r."title"').all(`%${weekStart}%`);
  const recipes = new Map();
  for (const row of rows) {
    const recipe = recipes.get(row.id) ?? { id: row.id, title: row.title, category: row.category, plannedDates: parseJsonList(row.plannedDates), ingredients: [], invalidIngredient: false };
    if (row.name) {
      const match = String(row.amount ?? "").match(/^([0-9]+(?:\.[0-9]+)?)(.+)$/);
      if (!match) recipe.invalidIngredient = true;
      else recipe.ingredients.push({ name: row.name, quantity: Number(match[1]), unit: match[2], category: row.ingredientCategory ?? "기타" });
    }
    recipes.set(row.id, recipe);
  }
  return [...recipes.values()].filter((recipe) => !skipInvalid || !recipe.invalidIngredient);
}

function missingStoredCoverage(weekStart) {
  const startMs = toMillis(weekStart), endMs = toMillis(addDays(weekStart, 7));
  const plans = db.prepare('SELECT "date","lunchPlan","mainDish","sideDishes" FROM "MealPlan" WHERE "date">=? AND "date"<? ORDER BY "date"').all(startMs, endMs);
  const coverage = new Set();
  const allRecipes = storedRecipes(weekStart);
  const recipes = allRecipes.filter((recipe) => !recipe.invalidIngredient);
  for (const recipe of recipes) for (const date of recipe.plannedDates) coverage.add(`${date}|${recipe.title}`);
  const missing = [];
  for (const plan of plans) {
    const date = formatKst(plan.date);
    for (const dish of [plan.mainDish, ...parseJsonList(plan.sideDishes)].filter(Boolean)) if (!coverage.has(`${date}|${dish}`)) missing.push(`${date}: ${dish}`);
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    if ([0, 6].includes(day) && plan.lunchPlan && !plan.lunchPlan.includes("회사 식사") && !recipes.some((recipe) => recipe.category === "점심" && recipe.plannedDates.includes(date))) missing.push(`${date}: ${plan.lunchPlan} (점심)`);
  }
  for (const recipe of allRecipes.filter((recipe) => recipe.invalidIngredient)) for (const date of recipe.plannedDates) missing.push(`${date}: ${recipe.title} (재료 수량 형식 오류)`);
  return missing;
}

function writeShopping(weekStart, recipes, now) {
  const shopping = calculateShopping(recipes, weekStart);
  const weekEnd = addDays(weekStart, 6);
  db.prepare('INSERT OR IGNORE INTO "ShoppingWeek" ("id","startDate","endDate","createdAt") VALUES (?,?,?,?)').run(`shopping-week-${weekStart}`, toMillis(weekStart), toMillis(weekEnd), now);
  const weekRow = db.prepare('SELECT "id" FROM "ShoppingWeek" WHERE "startDate"=?').get(toMillis(weekStart));
  const purchased = new Map(db.prepare('SELECT "name","purchased" FROM "ShoppingItem" WHERE "weekId"=?').all(weekRow.id).map((item) => [item.name, item.purchased]));
  db.prepare('DELETE FROM "ShoppingItem" WHERE "weekId"=?').run(weekRow.id);
  const insertShopping = db.prepare('INSERT INTO "ShoppingItem" ("id","name","quantity","unit","category","ownedQuantity","usePlan","purchased","weekId") VALUES (?,?,?,?,?,?,?,?,?)');
  for (const item of shopping) insertShopping.run(`${weekRow.id}-${crypto.createHash("sha1").update(`${item.name}|${item.unit}`).digest("hex").slice(0, 10)}`, item.name, item.quantity, item.unit, item.category, item.ownedQuantity, item.usePlan, purchased.get(item.name) ?? 0, weekRow.id);
  return shopping;
}

function publishWeek(payload, weekStart, rebuildShopping = true) {
  const validation = validatePayload(payload, weekStart);
  if (!validation.valid) { printJson(validation); process.exitCode = 2; return; }
  const jobId = `agent-job-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const now = Date.now();
  const action = payload.mealChanges?.length ? "UPDATE_AND_PUBLISH_WEEK" : rebuildShopping ? "PUBLISH_WEEK" : "PUBLISH_RECIPES";
  db.prepare('INSERT INTO "AgentJob" ("id","weekStart","action","status","inputPath","createdAt") VALUES (?,?,?,?,?,?)').run(jobId, toMillis(weekStart), action, "RUNNING", path.resolve(flags.input), now);
  const backupDir = path.join(root, "data", "backups"); fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `mealplan-${new Date().toISOString().replace(/[:.]/g, "-")}.db`); fs.copyFileSync(dbPath, backupPath);
  const prefix = `generated-${weekStart}-`;
  try {
    db.exec("BEGIN IMMEDIATE");
    const findPlan = db.prepare('SELECT "id","lunchPlan","mainDish","sideDishes","babyMenu","cookingNote" FROM "MealPlan" WHERE "date"=?');
    const updatePlan = db.prepare('UPDATE "MealPlan" SET "lunchPlan"=?,"mainDish"=?,"sideDishes"=?,"babyMenu"=?,"cookingNote"=?,"changeReason"=?,"recipeId"=NULL,"updatedAt"=? WHERE "id"=?');
    for (const change of payload.mealChanges ?? []) {
      const current = findPlan.get(toMillis(change.date));
      updatePlan.run(Object.hasOwn(change, "lunch") ? change.lunch ?? null : current.lunchPlan, change.main, JSON.stringify(change.sides), Object.hasOwn(change, "baby") ? change.baby ?? null : current.babyMenu, Object.hasOwn(change, "note") ? change.note ?? null : current.cookingNote, payload.changeReason, now, current.id);
    }
    // A weekly regeneration is an authoritative replacement for that week.
    // Older data did not always use the generated ID prefix, so scope cleanup by
    // the persisted week key rather than leaving stale recipes visible.
    db.prepare('UPDATE "MealPlan" SET "recipeId"=NULL WHERE "recipeId" IN (SELECT "id" FROM "Recipe" WHERE "weekKeys" LIKE ?)').run(`%${weekStart}%`);
    db.prepare('DELETE FROM "Recipe" WHERE "weekKeys" LIKE ?').run(`%${weekStart}%`);
    const insertRecipe = db.prepare(`INSERT INTO "Recipe" ("id","title","description","prepMinutes","cookMinutes","adultServings","childServings","tags","category","plannedDates","weekKeys","instructions","babySplitStep","storageMethod","consumeWithin","sourceUrl","sourceTitle","sourceAuthor","sourceDomain","sourceCheckedAt","needsReview","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insertIngredient = db.prepare('INSERT INTO "Ingredient" ("id","name","amount","category","recipeId") VALUES (?,?,?,?,?)');
    const recipeIds = new Map();
    for (const recipe of payload.recipes) {
      const id = `${prefix}${crypto.createHash("sha1").update(`${recipe.category}|${recipe.title}`).digest("hex").slice(0, 12)}`;
      recipeIds.set(recipe.title, id);
      const sourceDomain = recipe.sourceUrl ? new URL(recipe.sourceUrl).hostname.toLowerCase() : null;
      insertRecipe.run(id, recipe.title, recipe.description ?? null, recipe.prepMinutes, recipe.cookMinutes, recipe.adultServings, recipe.childServings, (recipe.tags ?? []).join(","), recipe.category, JSON.stringify(recipe.plannedDates), JSON.stringify([weekStart]), JSON.stringify(recipe.instructions), recipe.babySplitStep, recipe.storageMethod, recipe.consumeWithin, recipe.sourceUrl ?? null, recipe.sourceTitle ?? null, recipe.sourceAuthor ?? null, sourceDomain, recipe.sourceCheckedAt ? toMillis(recipe.sourceCheckedAt) : null, 0, now, now);
      recipe.ingredients.forEach((ingredient, index) => insertIngredient.run(`${id}-ingredient-${index + 1}`, ingredient.name, `${ingredient.quantity}${ingredient.unit}`, ingredient.category ?? "기타", id));
    }
    const startMs = toMillis(weekStart), endMs = toMillis(addDays(weekStart, 7));
    const planRows = db.prepare('SELECT "id","mainDish" FROM "MealPlan" WHERE "date">=? AND "date"<?').all(startMs, endMs);
    const linkRecipe = db.prepare('UPDATE "MealPlan" SET "recipeId"=?, "updatedAt"=? WHERE "id"=?');
    for (const plan of planRows) if (recipeIds.has(plan.mainDish)) linkRecipe.run(recipeIds.get(plan.mainDish), now, plan.id);
    let shoppingItems = 0;
    if (rebuildShopping) shoppingItems = writeShopping(weekStart, payload.recipes, now).length;
    const summary = JSON.stringify({ mealChanges: payload.mealChanges?.length ?? 0, recipes: payload.recipes.length, shoppingItems, backup: backupPath });
    db.prepare('UPDATE "AgentJob" SET "status"=?,"summary"=?,"completedAt"=? WHERE "id"=?').run("COMPLETED", summary, Date.now(), jobId);
    db.exec("COMMIT");
    printJson({ success: true, jobId, weekStart, backup: backupPath, mealChanges: payload.mealChanges?.length ?? 0, recipes: payload.recipes.length, shoppingItems });
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    db.prepare('UPDATE "AgentJob" SET "status"=?,"error"=?,"completedAt"=? WHERE "id"=?').run("FAILED", String(error.message ?? error), Date.now(), jobId);
    throw error;
  }
}

function publishDay(payload, weekStart, date) {
  const validation = validateDay(payload, weekStart, date);
  if (!validation.valid) { printJson(validation); process.exitCode = 2; return; }
  const jobId = `agent-day-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const now = Date.now();
  db.prepare('INSERT INTO "AgentJob" ("id","weekStart","action","status","inputPath","createdAt") VALUES (?,?,?,?,?,?)').run(jobId, toMillis(weekStart), "UPDATE_DAY", "RUNNING", path.resolve(flags.input), now);
  const backupDir = path.join(root, "data", "backups"); fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `mealplan-${new Date().toISOString().replace(/[:.]/g, "-")}.db`); fs.copyFileSync(dbPath, backupPath);
  try {
    db.exec("BEGIN IMMEDIATE");
    const change = payload.mealChanges[0];
    const current = db.prepare('SELECT "id","lunchPlan","babyMenu","cookingNote" FROM "MealPlan" WHERE "date"=?').get(toMillis(date));
    db.prepare('UPDATE "MealPlan" SET "lunchPlan"=?,"mainDish"=?,"sideDishes"=?,"babyMenu"=?,"cookingNote"=?,"changeReason"=?,"recipeId"=NULL,"updatedAt"=? WHERE "id"=?').run(Object.hasOwn(change, "lunch") ? change.lunch ?? null : current.lunchPlan, change.main, JSON.stringify(change.sides), Object.hasOwn(change, "baby") ? change.baby ?? null : current.babyMenu, Object.hasOwn(change, "note") ? change.note ?? null : current.cookingNote, payload.changeReason, now, current.id);

    const oldRecipes = db.prepare('SELECT "id","plannedDates" FROM "Recipe" WHERE "weekKeys" LIKE ? AND "plannedDates" LIKE ?').all(`%${weekStart}%`, `%${date}%`);
    const unlink = db.prepare('UPDATE "MealPlan" SET "recipeId"=NULL WHERE "recipeId"=?');
    const trimDates = db.prepare('UPDATE "Recipe" SET "plannedDates"=?,"updatedAt"=? WHERE "id"=?');
    const deleteRecipe = db.prepare('DELETE FROM "Recipe" WHERE "id"=?');
    for (const recipe of oldRecipes) {
      const dates = parseJsonList(recipe.plannedDates).filter((value) => value !== date);
      unlink.run(recipe.id);
      if (dates.length) trimDates.run(JSON.stringify(dates), now, recipe.id);
      else deleteRecipe.run(recipe.id);
    }
    const recipeIds = insertRecipes(payload.recipes, weekStart, `generated-${weekStart}-${date}-`, now);
    const mainRecipeId = recipeIds.get(change.main);
    if (mainRecipeId) db.prepare('UPDATE "MealPlan" SET "recipeId"=?,"updatedAt"=? WHERE "id"=?').run(mainRecipeId, now, current.id);
    const skippedLegacyRecipes = storedRecipes(weekStart).filter((recipe) => recipe.invalidIngredient).map((recipe) => recipe.title);
    const shopping = writeShopping(weekStart, storedRecipes(weekStart, { skipInvalid: true }), now);
    const summary = JSON.stringify({ mealChanges: 1, recipes: payload.recipes.length, shoppingItems: shopping.length, skippedLegacyRecipes, backup: backupPath });
    db.prepare('UPDATE "AgentJob" SET "status"=?,"summary"=?,"completedAt"=? WHERE "id"=?').run("COMPLETED", summary, Date.now(), jobId);
    db.exec("COMMIT");
    printJson({ success: true, jobId, weekStart, date, backup: backupPath, mealChanges: 1, recipes: payload.recipes.length, shoppingItems: shopping.length, skippedLegacyRecipes });
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    db.prepare('UPDATE "AgentJob" SET "status"=?,"error"=?,"completedAt"=? WHERE "id"=?').run("FAILED", String(error.message ?? error), Date.now(), jobId);
    throw error;
  }
}

function rebuildShopping(weekStart) {
  const jobId = `agent-shopping-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const now = Date.now();
  db.prepare('INSERT INTO "AgentJob" ("id","weekStart","action","status","createdAt") VALUES (?,?,?,?,?)').run(jobId, toMillis(weekStart), "REBUILD_SHOPPING", "RUNNING", now);
  const missing = missingStoredCoverage(weekStart);
  if (missing.length) {
    const error = `레시피가 아직 준비되지 않은 메뉴가 있습니다: ${missing.join(", ")}`;
    db.prepare('UPDATE "AgentJob" SET "status"=?,"error"=?,"completedAt"=? WHERE "id"=?').run("FAILED", error, Date.now(), jobId);
    printJson({ success: false, jobId, weekStart, missing });
    process.exitCode = 2;
    return;
  }
  const backupDir = path.join(root, "data", "backups"); fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `mealplan-${new Date().toISOString().replace(/[:.]/g, "-")}.db`); fs.copyFileSync(dbPath, backupPath);
  try {
    db.exec("BEGIN IMMEDIATE");
    const shopping = writeShopping(weekStart, storedRecipes(weekStart), now);
    db.prepare('UPDATE "AgentJob" SET "status"=?,"summary"=?,"completedAt"=? WHERE "id"=?').run("COMPLETED", JSON.stringify({ shoppingItems: shopping.length, backup: backupPath }), Date.now(), jobId);
    db.exec("COMMIT");
    printJson({ success: true, jobId, weekStart, shoppingItems: shopping.length, backup: backupPath });
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    db.prepare('UPDATE "AgentJob" SET "status"=?,"error"=?,"completedAt"=? WHERE "id"=?').run("FAILED", String(error.message ?? error), Date.now(), jobId);
    throw error;
  }
}

function replyChat(payload, id) {
  if (!String(id ?? "").trim() || String(id).length > 120) fail("--id is required.");
  const answer = String(payload?.answer ?? "").trim();
  if (!answer) fail("answer is required.");
  if (answer.length > 12_000) fail("answer is too long.");
  const sources = Array.isArray(payload?.sources) ? payload.sources
    .filter((source) => source && typeof source.url === "string" && /^https?:\/\//.test(source.url))
    .slice(0, 8)
    .map((source) => ({ title: typeof source.title === "string" ? source.title.slice(0, 300) : undefined, url: source.url })) : [];
  const result = db.prepare('UPDATE "AgentChat" SET "status"=?,"answer"=?,"sources"=?,"error"=NULL,"completedAt"=? WHERE "id"=? AND "status"="RUNNING"').run("COMPLETED", answer, JSON.stringify(sources), Date.now(), id);
  if (result.changes !== 1) fail("Chat request was not found or is already completed.");
  printJson({ success: true, id, sources: sources.length });
}

function recordReview(weekStart, summary) {
  if (!String(summary ?? "").trim()) fail("--summary is required.");
  const jobId = `agent-review-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
  const now = Date.now();
  db.prepare('INSERT INTO "AgentJob" ("id","weekStart","action","status","summary","createdAt","completedAt") VALUES (?,?,?,?,?,?,?)').run(jobId, toMillis(weekStart), "WEEKLY_REVIEW_MAINTAINED", "COMPLETED", String(summary).trim().slice(0, 2000), now, now);
  printJson({ success: true, jobId, weekStart, maintained: true });
}

try {
  if (command === "context") printJson(loadContext(requireWeek(flags.week)));
  if (command === "validate-week") {
    const payload = readPayload(flags.input);
    const result = validatePayload(payload, requireWeek(flags.week ?? payload.weekStart));
    printJson(result);
    if (!result.valid) process.exitCode = 2;
  }
  if (command === "publish-week") publishWeek(readPayload(flags.input), requireWeek(flags.week));
  if (command === "publish-recipes") publishWeek(readPayload(flags.input), requireWeek(flags.week), false);
  if (command === "validate-day") {
    const payload = readPayload(flags.input);
    const result = validateDay(payload, requireWeek(flags.week ?? payload.weekStart), flags.date);
    printJson(result);
    if (!result.valid) process.exitCode = 2;
  }
  if (command === "publish-day") publishDay(readPayload(flags.input), requireWeek(flags.week), flags.date);
  if (command === "rebuild-shopping") rebuildShopping(requireWeek(flags.week));
  if (command === "reply-chat") replyChat(readPayload(flags.input), flags.id);
  if (command === "record-review") recordReview(requireWeek(flags.week), flags.summary);
} finally {
  db.close();
}
