#!/usr/bin/env node
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.env.MEAL_PLAN_ROOT ?? process.cwd();
const dbPath =
  process.env.MEAL_DB_PATH ?? path.join(root, "data", "mealplan.db");
const command = process.argv[2];
const flags = parseFlags(process.argv.slice(3));

if (
  !command ||
  ![
    "context",
    "context-month",
    "validate-week",
    "validate-month",
    "publish-week",
    "publish-month",
    "publish-recipes",
    "validate-day",
    "publish-day",
    "rebuild-shopping",
    "reply-chat",
    "record-review",
    "fail-job",
    "fail-chat",
    "notify-web",
  ].includes(command)
)
  usage();
if (!fs.existsSync(dbPath)) fail(`Database not found: ${dbPath}`);

const db = new DatabaseSync(dbPath);
db.exec(
  "PRAGMA foreign_keys = ON; PRAGMA journal_mode = DELETE; PRAGMA busy_timeout = 5000;",
);

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
  node scripts/mealctl.mjs context-month --month YYYY-MM
  node scripts/mealctl.mjs validate-week --input /path/week.json [--week YYYY-MM-DD]
  node scripts/mealctl.mjs validate-month --input /path/month.json --month YYYY-MM
  node scripts/mealctl.mjs publish-week --input /path/week.json --week YYYY-MM-DD [--request-id ID]
  node scripts/mealctl.mjs publish-month --input /path/month.json --month YYYY-MM [--request-id ID]
  node scripts/mealctl.mjs publish-recipes --input /path/week.json --week YYYY-MM-DD [--request-id ID]
  node scripts/mealctl.mjs validate-day --input /path/day.json --week YYYY-MM-DD --date YYYY-MM-DD
  node scripts/mealctl.mjs publish-day --input /path/day.json --week YYYY-MM-DD --date YYYY-MM-DD [--request-id ID]
  node scripts/mealctl.mjs rebuild-shopping --week YYYY-MM-DD [--request-id ID]
  node scripts/mealctl.mjs reply-chat --id REQUEST_ID --input /path/chat-response.json
  node scripts/mealctl.mjs record-review --week YYYY-MM-DD --summary "reason" [--request-id ID]
  node scripts/mealctl.mjs fail-job --request-id REQUEST_ID --error "reason"
  node scripts/mealctl.mjs fail-chat --id REQUEST_ID --error "reason"
  node scripts/mealctl.mjs notify-web --request-id REQUEST_ID
  node scripts/mealctl.mjs notify-web --chat-id REQUEST_ID`);
  process.exit(1);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}
function requireWeek(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? ""))
    fail("--week must be YYYY-MM-DD.");
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.valueOf()) || date.getUTCDay() !== 0)
    fail("--week must be a Sunday.");
  return value;
}
function requireMonth(value) {
  if (!/^\d{4}-\d{2}$/.test(value ?? "")) fail("--month must be YYYY-MM.");
  const [year, month] = value.split("-").map(Number);
  if (month < 1 || month > 12 || !Number.isInteger(year))
    fail("--month must be a real calendar month.");
  return value;
}
function monthStart(month) {
  return `${requireMonth(month)}-01`;
}
function daysInMonth(month) {
  const [year, value] = requireMonth(month).split("-").map(Number);
  return new Date(Date.UTC(year, value, 0)).getUTCDate();
}
function monthDates(month) {
  return Array.from({ length: daysInMonth(month) }, (_, index) =>
    addDays(monthStart(month), index),
  );
}
function sundayFor(date) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - value.getUTCDay());
  return value.toISOString().slice(0, 10);
}
function toMillis(date) {
  return Date.parse(`${date}T00:00:00+09:00`);
}
function addDays(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function formatKst(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}
function parseJsonList(value) {
  try {
    return JSON.parse(value || "[]");
  } catch {
    return String(value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
}
function readPayload(inputPath) {
  if (!inputPath) fail("--input is required.");
  if (!fs.existsSync(inputPath)) fail(`Input file not found: ${inputPath}`);
  try {
    return JSON.parse(fs.readFileSync(inputPath, "utf8"));
  } catch (error) {
    fail(`Invalid JSON: ${error.message}`);
  }
}

function reusableRecipesForPlans(mealRows) {
  const required = new Map();
  const addRequired = (title, category, date) => {
    const normalizedTitle = String(title ?? "").trim();
    if (!normalizedTitle) return;
    const key = `${category}|${normalizedTitle}`;
    const item = required.get(key) ?? {
      title: normalizedTitle,
      category,
      plannedDates: new Set(),
    };
    item.plannedDates.add(date);
    required.set(key, item);
  };
  for (const meal of mealRows) {
    const date = formatKst(meal.date);
    if (!meal.dinnerDiningOut) {
      addRequired(meal.mainDish, "주찬", date);
      for (const side of parseJsonList(meal.sideDishes))
        addRequired(side, "반찬", date);
    }
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (
      [0, 6].includes(day) &&
      meal.lunchPlan &&
      !String(meal.lunchPlan).includes("회사 식사")
    )
      addRequired(meal.lunchPlan, "점심", date);
  }

  const findRecipe = db.prepare(
    `SELECT * FROM "Recipe" WHERE "title"=? AND "category"=? AND "needsReview"=0
     AND ("category"='점심' OR ("sourceUrl" IS NOT NULL AND "sourceTitle" IS NOT NULL AND "sourceCheckedAt" IS NOT NULL))
     ORDER BY "updatedAt" DESC LIMIT 1`,
  );
  const findIngredients = db.prepare(
    `SELECT "name","amount","category" FROM "Ingredient" WHERE "recipeId"=? ORDER BY "id"`,
  );
  const reusable = [];
  for (const requirement of required.values()) {
    const recipe = findRecipe.get(requirement.title, requirement.category);
    if (!recipe) continue;
    const ingredients = findIngredients.all(recipe.id).map((ingredient) => {
      const match = String(ingredient.amount ?? "").match(
        /^([0-9]+(?:\.[0-9]+)?)(.+)$/,
      );
      return match
        ? {
            name: ingredient.name,
            quantity: Number(match[1]),
            unit: match[2],
            category: ingredient.category,
          }
        : null;
    });
    if (!ingredients.length || ingredients.some((ingredient) => !ingredient))
      continue;
    reusable.push({
      title: recipe.title,
      description: recipe.description,
      prepMinutes: recipe.prepMinutes,
      cookMinutes: recipe.cookMinutes,
      adultServings: recipe.adultServings,
      childServings: recipe.childServings,
      tags: String(recipe.tags ?? "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      category: recipe.category,
      plannedDates: [...requirement.plannedDates].sort(),
      ingredients,
      instructions: parseJsonList(recipe.instructions),
      babySplitStep: recipe.babySplitStep,
      storageMethod: recipe.storageMethod,
      consumeWithin: recipe.consumeWithin,
      sourceUrl: recipe.sourceUrl,
      sourceTitle: recipe.sourceTitle,
      sourceAuthor: recipe.sourceAuthor,
      sourceCheckedAt: recipe.sourceCheckedAt
        ? formatKst(recipe.sourceCheckedAt)
        : null,
    });
  }
  return reusable;
}

function loadContext(weekStart) {
  const weekEnd = addDays(weekStart, 6);
  const startMs = toMillis(weekStart);
  const endExclusiveMs = toMillis(addDays(weekStart, 7));
  const mealRows = db
    .prepare(
      'SELECT * FROM "MealPlan" WHERE "date" >= ? AND "date" < ? ORDER BY "date"',
    )
    .all(startMs, endExclusiveMs);
  const schedules = db
    .prepare(
      `SELECT s."date",s."memberId",s."lunchNotAtHome",s."dinnerNotAtHome",m.name AS memberName,m.role AS memberRole FROM "FamilySchedule" s JOIN "FamilyMember" m ON m.id=s.memberId WHERE s.date>=? AND s.date<? ORDER BY s.date`,
    )
    .all(startMs, endExclusiveMs);
  const pantry = db
    .prepare(
      'SELECT * FROM "PantryItem" ORDER BY CASE WHEN "expiresAt" IS NULL THEN 1 ELSE 0 END, "expiresAt", "name"',
    )
    .all();
  const weeklyReview =
    db
      .prepare(
        'SELECT "weekStart","referenceDate","wantedFoods","avoidFoods","note" FROM "WeeklyReview" WHERE "weekStart"=?',
      )
      .get(startMs) ?? null;
  const existingRecipes = db
    .prepare(
      'SELECT "id","title","category","plannedDates","sourceUrl","sourceTitle","sourceAuthor","sourceDomain","sourceCheckedAt","needsReview" FROM "Recipe" WHERE "weekKeys" LIKE ? ORDER BY "plannedDates","title"',
    )
    .all(`%${weekStart}%`);
  return {
    schemaVersion: "meal-week.v1",
    weekStart,
    weekEnd,
    timezone: "Asia/Seoul",
    rules: {
      agents: path.join(root, "AGENTS.md"),
      meal: path.join(root, "MEAL.md"),
    },
    family: db
      .prepare(
        'SELECT "id","name","role","allergies","chewingAbility","spiceTolerance","dietaryNotes" FROM "FamilyMember" ORDER BY "role"',
      )
      .all(),
    schedules: schedules.map((item) => ({
      ...item,
      date: formatKst(item.date),
    })),
    meals: mealRows.map((meal) => ({
      date: formatKst(meal.date),
      lunch: meal.lunchPlan,
      main: meal.mainDish,
      sides: parseJsonList(meal.sideDishes),
      baby: meal.babyMenu,
      note: meal.cookingNote,
      dinnerDiningOut: Boolean(meal.dinnerDiningOut),
    })),
    pantry,
    weeklyReview: weeklyReview
      ? {
          ...weeklyReview,
          weekStart: formatKst(weeklyReview.weekStart),
          referenceDate: weeklyReview.referenceDate
            ? formatKst(weeklyReview.referenceDate)
            : weekStart,
        }
      : null,
    existingRecipes,
    reusableRecipes: reusableRecipesForPlans(mealRows),
    outputContract: {
      weekStart: "YYYY-MM-DD (Sunday)",
      changeReason: "string",
      mealChanges: [
        {
          date: "YYYY-MM-DD",
          main: "string",
          sides: ["side 1", "side 2"],
          lunch: "optional string",
          baby: "optional string",
          note: "optional string",
        },
      ],
      recipes: [
        {
          title: "string",
          category: "주찬|반찬|점심",
          plannedDates: ["YYYY-MM-DD"],
          prepMinutes: 15,
          cookMinutes: 20,
          adultServings: 2,
          childServings: 1,
          ingredients: [
            {
              name: "string",
              quantity: 100,
              unit: "g|ml|개|팩|모",
              category: "string",
            },
          ],
          instructions: ["1. ...", "2. ..."],
          babySplitStep: "string",
          storageMethod: "string",
          consumeWithin: "string",
          sourceUrl: "https://verified-blog-post",
          sourceTitle: "verified page title",
          sourceAuthor: "author or null",
          sourceCheckedAt: "YYYY-MM-DD",
        },
      ],
    },
  };
}

function loadMonthContext(month) {
  const selectedMonth = requireMonth(month);
  const dates = monthDates(selectedMonth);
  const start = dates[0];
  const endExclusive = addDays(dates.at(-1), 1);
  const [year, numericMonth] = selectedMonth.split("-").map(Number);
  const previousMonth = `${numericMonth === 1 ? year - 1 : year}-${String(numericMonth === 1 ? 12 : numericMonth - 1).padStart(2, "0")}`;
  const monthMeals = db.prepare('SELECT "date","lunchPlan","mainDish","sideDishes","babyMenu","cookingNote" FROM "MealPlan" WHERE "monthKey"=? ORDER BY "date"').all(selectedMonth);
  const previousMeals = db.prepare('SELECT "date","mainDish","sideDishes" FROM "MealPlan" WHERE "monthKey"=? ORDER BY "date"').all(previousMonth);
  const recentMeals = db.prepare('SELECT "monthKey","date","mainDish","sideDishes" FROM "MealPlan" WHERE "monthKey">=? AND "monthKey"<? ORDER BY "date"').all(shiftMonth(selectedMonth, -3), selectedMonth);
  const schedules = db.prepare('SELECT s."date",s."lunchNotAtHome",s."dinnerNotAtHome",m."name" AS "memberName",m."role" AS "memberRole" FROM "FamilySchedule" s JOIN "FamilyMember" m ON m."id"=s."memberId" WHERE s."date">=? AND s."date"<? ORDER BY s."date"').all(toMillis(start), toMillis(endExclusive));
  return {
    schemaVersion: "meal-month.v1",
    month: selectedMonth,
    dates,
    timezone: "Asia/Seoul",
    rules: { agents: path.join(root, "AGENTS.md"), meal: path.join(root, "MEAL.md") },
    family: db.prepare('SELECT "id","name","role","allergies","chewingAbility","spiceTolerance","dietaryNotes" FROM "FamilyMember" ORDER BY "role"').all(),
    pantry: db.prepare('SELECT * FROM "PantryItem" ORDER BY CASE WHEN "expiresAt" IS NULL THEN 1 ELSE 0 END, "expiresAt", "name"').all(),
    schedules: schedules.map((item) => ({ ...item, date: formatKst(item.date) })),
    existingMonthMeals: monthMeals.map((item) => ({ ...item, date: formatKst(item.date), sides: parseJsonList(item.sideDishes) })),
    previousMonth: { month: previousMonth, meals: previousMeals.map((item) => ({ ...item, date: formatKst(item.date), sides: parseJsonList(item.sideDishes) })) },
    recentMonths: recentMeals.map((item) => ({ ...item, date: formatKst(item.date), sides: parseJsonList(item.sideDishes) })),
    outputContract: {
      changeReason: "string",
      mealChanges: [{ date: "YYYY-MM-DD", lunch: "string", main: "string", sides: ["side 1", "side 2"], baby: "optional string", note: "optional string" }],
    },
  };
}

const banned = ["브로콜리", "파프리카", "피망"];
const basicStock = new Set([
  "쌀",
  "밥",
  "김치",
  "깍두기",
  "소금",
  "설탕",
  "간장",
  "식초",
  "고춧가루",
  "고추장",
  "된장",
  "참기름",
  "식용유",
  "다진 마늘",
  "후추",
]);
const allowedBlogHosts = new Set(["blog.naver.com", "m.blog.naver.com"]);

function validatePayload(payload, weekStart, scopeDate = null) {
  const errors = [];
  const warnings = [];
  if (payload?.schemaVersion && payload.schemaVersion !== "meal-week.v1")
    errors.push("schemaVersion must be meal-week.v1.");
  if (payload?.weekStart !== weekStart)
    errors.push(`weekStart must be ${weekStart}.`);
  if (!String(payload?.changeReason ?? "").trim())
    errors.push("changeReason is required.");
  if (!Array.isArray(payload?.recipes))
    errors.push("recipes must be an array.");

  const startMs = toMillis(weekStart);
  const endExclusiveMs = toMillis(addDays(weekStart, 7));
  const plans = db
    .prepare(
      'SELECT "id","date","lunchPlan","mainDish","sideDishes","babyMenu","cookingNote","dinnerDiningOut" FROM "MealPlan" WHERE "date">=? AND "date"<? ORDER BY "date"',
    )
    .all(startMs, endExclusiveMs);
  const plansByDate = new Map(
    plans.map((plan) => [formatKst(plan.date), plan]),
  );
  const changedDates = new Set();
  if (payload.mealChanges !== undefined && !Array.isArray(payload.mealChanges))
    errors.push("mealChanges must be an array when provided.");
  for (const [index, change] of (payload.mealChanges ?? []).entries()) {
    const at = `mealChanges[${index}]`;
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(change.date ?? "") ||
      change.date < weekStart ||
      change.date > addDays(weekStart, 6)
    )
      errors.push(`${at}.date must be inside the selected week.`);
    if (changedDates.has(change.date)) errors.push(`${at}.date is duplicated.`);
    changedDates.add(change.date);
    const plan = plansByDate.get(change.date);
    if (!plan) errors.push(`${at}.date does not have an existing meal plan.`);
    if (!String(change.main ?? "").trim())
      errors.push(`${at}.main is required.`);
    if (
      !Array.isArray(change.sides) ||
      change.sides.length !== 2 ||
      change.sides.some((side) => !String(side).trim())
    )
      errors.push(`${at}.sides must contain exactly two named side dishes.`);
    if (
      Array.isArray(change.sides) &&
      new Set(change.sides.map(normalizeName)).size !== change.sides.length
    )
      errors.push(`${at}.sides must not contain duplicates.`);
    const text = JSON.stringify(change);
    for (const item of banned)
      if (text.includes(item))
        errors.push(`${at} contains banned ingredient: ${item}`);
    if (plan) {
      plan.mainDish = String(change.main ?? "").trim();
      plan.sideDishes = JSON.stringify(change.sides ?? []);
      if (Object.hasOwn(change, "lunch")) plan.lunchPlan = change.lunch ?? null;
      if (Object.hasOwn(change, "baby")) plan.babyMenu = change.baby ?? null;
      if (Object.hasOwn(change, "note")) plan.cookingNote = change.note ?? null;
    }
  }
  if (scopeDate && (changedDates.size !== 1 || !changedDates.has(scopeDate)))
    errors.push(
      `mealChanges must contain exactly ${scopeDate} for a daily update.`,
    );
  const coverage = new Set();
  const unitsByIngredient = new Map();

  for (const [index, recipe] of (payload.recipes ?? []).entries()) {
    const at = `recipes[${index}]`;
    if (!String(recipe.title ?? "").trim())
      errors.push(`${at}.title is required.`);
    if (!["주찬", "반찬", "점심"].includes(recipe.category))
      errors.push(`${at}.category must be 주찬, 반찬, or 점심.`);
    if (!Number.isInteger(recipe.prepMinutes) || recipe.prepMinutes < 0)
      errors.push(`${at}.prepMinutes must be a non-negative integer.`);
    if (!Number.isInteger(recipe.cookMinutes) || recipe.cookMinutes < 1)
      errors.push(`${at}.cookMinutes must be a positive integer.`);
    if (recipe.tags !== undefined && !Array.isArray(recipe.tags))
      errors.push(`${at}.tags must be an array when provided.`);
    if (!Array.isArray(recipe.plannedDates) || recipe.plannedDates.length === 0)
      errors.push(`${at}.plannedDates is required.`);
    for (const date of recipe.plannedDates ?? []) {
      if (date < weekStart || date > addDays(weekStart, 6))
        errors.push(
          `${at}.plannedDates contains a date outside the selected week: ${date}`,
        );
      if (scopeDate && date !== scopeDate)
        errors.push(
          `${at}.plannedDates must contain only ${scopeDate} for a daily update.`,
        );
      coverage.add(`${date}|${recipe.title}`);
    }
    if (!Number.isInteger(recipe.adultServings) || recipe.adultServings < 0)
      errors.push(`${at}.adultServings must be a non-negative integer.`);
    if (!Number.isInteger(recipe.childServings) || recipe.childServings < 0)
      errors.push(`${at}.childServings must be a non-negative integer.`);
    if (!Array.isArray(recipe.ingredients) || recipe.ingredients.length === 0)
      errors.push(`${at}.ingredients is required.`);
    for (const [ingredientIndex, ingredient] of (
      recipe.ingredients ?? []
    ).entries()) {
      const ingredientAt = `${at}.ingredients[${ingredientIndex}]`;
      if (!String(ingredient.name ?? "").trim())
        errors.push(`${ingredientAt}.name is required.`);
      if (!(Number(ingredient.quantity) > 0))
        errors.push(`${ingredientAt}.quantity must be greater than zero.`);
      if (!String(ingredient.unit ?? "").trim())
        errors.push(`${ingredientAt}.unit is required.`);
      const normalized = normalizeName(ingredient.name);
      const units = unitsByIngredient.get(normalized) ?? new Set();
      units.add(ingredient.unit);
      unitsByIngredient.set(normalized, units);
    }
    if (!Array.isArray(recipe.instructions) || recipe.instructions.length < 2)
      errors.push(
        `${at}.instructions must contain at least two numbered steps.`,
      );
    else
      recipe.instructions.forEach((step, stepIndex) => {
        if (!new RegExp(`^${stepIndex + 1}[.)]\\s`).test(String(step).trim()))
          errors.push(
            `${at}.instructions[${stepIndex}] must start with ${stepIndex + 1}. or ${stepIndex + 1}).`,
          );
      });
    if (!String(recipe.babySplitStep ?? "").trim())
      errors.push(`${at}.babySplitStep is required.`);
    if (!String(recipe.storageMethod ?? "").trim())
      errors.push(`${at}.storageMethod is required.`);
    if (!String(recipe.consumeWithin ?? "").trim())
      errors.push(`${at}.consumeWithin is required.`);
    if (["주찬", "반찬"].includes(recipe.category) || recipe.sourceUrl)
      validateBlogSource(recipe, at, errors);
    const text = JSON.stringify(recipe);
    for (const item of banned)
      if (text.includes(item))
        errors.push(`${at} contains banned ingredient: ${item}`);
  }
  for (const [name, units] of unitsByIngredient)
    if (units.size > 1)
      errors.push(
        `Ingredient '${name}' uses incompatible units: ${[...units].join(", ")}.`,
      );

  for (const plan of plans) {
    const date = formatKst(plan.date);
    if (scopeDate && date !== scopeDate) continue;
    if (!plan.dinnerDiningOut)
      for (const dish of [
        plan.mainDish,
        ...parseJsonList(plan.sideDishes),
      ].filter(Boolean))
        if (!coverage.has(`${date}|${dish}`))
          errors.push(`Missing recipe coverage for ${date}: ${dish}`);
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (
      [0, 6].includes(day) &&
      plan.lunchPlan &&
      !plan.lunchPlan.includes("회사 식사")
    ) {
      const hasLunch = (payload.recipes ?? []).some(
        (recipe) =>
          recipe.category === "점심" && recipe.plannedDates?.includes(date),
      );
      if (!hasLunch)
        errors.push(`Missing lunch recipe for ${date}: ${plan.lunchPlan}`);
    }
  }
  const shopping = errors.length
    ? []
    : calculateShopping(payload.recipes, weekStart);
  return {
    valid: errors.length === 0,
    weekStart,
    errors,
    warnings,
    counts: {
      meals: plans.length,
      mealChanges: payload.mealChanges?.length ?? 0,
      recipes: payload.recipes?.length ?? 0,
      shoppingItems: shopping.length,
    },
    shoppingPreview: shopping,
  };
}

function validateDay(payload, weekStart, date) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    date < weekStart ||
    date > addDays(weekStart, 6)
  )
    fail("--date must be inside the selected week.");
  return validatePayload(payload, weekStart, date);
}

function validateMonth(payload, month) {
  const selectedMonth = requireMonth(month);
  const dates = monthDates(selectedMonth);
  const errors = [];
  if (payload?.schemaVersion && payload.schemaVersion !== "meal-month.v1")
    errors.push("schemaVersion must be meal-month.v1.");
  if (payload?.month !== selectedMonth)
    errors.push(`month must be ${selectedMonth}.`);
  if (!String(payload?.changeReason ?? "").trim())
    errors.push("changeReason is required.");
  if (!Array.isArray(payload?.mealChanges)) errors.push("mealChanges must be an array.");
  const changes = payload?.mealChanges ?? [];
  const changedDates = new Set();
  const mainDishes = new Set();
  for (const [index, change] of changes.entries()) {
    const at = `mealChanges[${index}]`;
    if (!dates.includes(change.date)) errors.push(`${at}.date must be inside ${selectedMonth}.`);
    if (changedDates.has(change.date)) errors.push(`${at}.date is duplicated.`);
    changedDates.add(change.date);
    if (!String(change.lunch ?? "").trim()) errors.push(`${at}.lunch is required.`);
    if (!String(change.main ?? "").trim()) errors.push(`${at}.main is required.`);
    const normalizedMain = normalizeName(change.main);
    if (mainDishes.has(normalizedMain)) errors.push(`${at}.main is duplicated in this month: ${normalizedMain}.`);
    mainDishes.add(normalizedMain);
    if (!Array.isArray(change.sides) || change.sides.length !== 2 || change.sides.some((side) => !String(side).trim()))
      errors.push(`${at}.sides must contain exactly two named side dishes.`);
    if (Array.isArray(change.sides) && new Set(change.sides.map(normalizeName)).size !== change.sides.length)
      errors.push(`${at}.sides must not contain duplicates.`);
    for (const item of banned)
      if (JSON.stringify(change).includes(item)) errors.push(`${at} contains banned ingredient: ${item}`);
  }
  if (changedDates.size !== dates.length)
    errors.push(`mealChanges must contain every day of ${selectedMonth} exactly once.`);
  const orderedSideChanges = changes
    .filter(
      (change) =>
        dates.includes(change.date) &&
        Array.isArray(change.sides) &&
        change.sides.length === 2,
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  const previousMonth = previousMonthKey(selectedMonth);
  const previousSideRows = db
    .prepare(
      'SELECT "sideDishes" FROM "MealPlan" WHERE "monthKey"=? ORDER BY "date"',
    )
    .all(previousMonth);
  const previousSideBatches = [];
  let previousSignature = "";
  for (const row of previousSideRows) {
    const sides = parseJsonList(row.sideDishes).map(normalizeName).sort();
    if (sides.length !== 2) continue;
    const signature = sides.join("|");
    if (signature !== previousSignature) previousSideBatches.push(sides);
    previousSignature = signature;
  }
  const previousSidePairs = new Set(
    previousSideBatches.map((sides) => sides.join("|")),
  );
  const previousSideDishBatches = new Map();
  for (const sides of previousSideBatches)
    for (const side of sides)
      previousSideDishBatches.set(
        side,
        (previousSideDishBatches.get(side) ?? 0) + 1,
      );
  const usedSidePairs = new Map();
  const sideDishBatches = new Map();
  for (let index = 0; index < orderedSideChanges.length; index += 3) {
    const batch = orderedSideChanges.slice(index, index + 3);
    const expectedSides = batch[0].sides.map(normalizeName).sort();
    const expectedSignature = expectedSides.join("|");
    for (const change of batch.slice(1)) {
      const signature = change.sides.map(normalizeName).sort().join("|");
      if (signature !== expectedSignature)
        errors.push(
          `Side dishes must stay the same for the 3-day batch ${batch[0].date} through ${batch.at(-1).date}.`,
        );
    }
    if (usedSidePairs.has(expectedSignature))
      errors.push(
        `Side dish pair '${expectedSides.join(" + ")}' is reused in separate monthly batches (${usedSidePairs.get(expectedSignature)} and ${batch[0].date}).`,
      );
    else usedSidePairs.set(expectedSignature, batch[0].date);
    if (previousSidePairs.has(expectedSignature))
      errors.push(
        `Side dish pair '${expectedSides.join(" + ")}' repeats the previous month.`,
      );
    for (const side of expectedSides) {
      const batchDates = sideDishBatches.get(side) ?? [];
      batchDates.push(batch[0].date);
      sideDishBatches.set(side, batchDates);
      if (batchDates.length > 3)
        errors.push(
          `Side dish '${side}' is used in more than three monthly batches (${batchDates.join(", ")}).`,
        );
    }
  }
  if (previousSideBatches.length) {
    const currentSides = [...sideDishBatches.keys()];
    const previousSides = new Set(previousSideDishBatches.keys());
    const newSideCount = currentSides.filter(
      (side) => !previousSides.has(side),
    ).length;
    const requiredNewSideCount = Math.ceil(currentSides.length * 0.4);
    if (newSideCount < requiredNewSideCount)
      errors.push(
        `At least 40% of unique side dishes must be new compared with ${previousMonth} (${newSideCount}/${currentSides.length}, requires ${requiredNewSideCount}).`,
      );
    for (const [side, dates] of sideDishBatches)
      if ((previousSideDishBatches.get(side) ?? 0) >= 2 && dates.length > 1)
        errors.push(
          `Side dish '${side}' appeared in multiple ${previousMonth} batches and may be used in only one ${selectedMonth} batch (${dates.join(", ")}).`,
        );
  }
  const existing = db.prepare('SELECT "date" FROM "MealPlan" WHERE "monthKey"=?').all(selectedMonth);
  if (existing.length) errors.push(`${selectedMonth} already has ${existing.length} saved meal plans and will not be overwritten.`);
  const previousMains = new Set(db.prepare('SELECT "mainDish" FROM "MealPlan" WHERE "monthKey"=?').all(previousMonth).map((row) => row.mainDish ? normalizeName(row.mainDish) : "").filter(Boolean));
  for (const main of mainDishes)
    if (previousMains.has(main)) errors.push(`main dish '${main}' repeats the previous month.`);
  return { valid: errors.length === 0, month: selectedMonth, errors, counts: { mealChanges: changes.length } };
}

function previousMonthKey(month) {
  const [year, numericMonth] = requireMonth(month).split("-").map(Number);
  return `${numericMonth === 1 ? year - 1 : year}-${String(numericMonth === 1 ? 12 : numericMonth - 1).padStart(2, "0")}`;
}
function shiftMonth(month, amount) {
  const [year, numericMonth] = requireMonth(month).split("-").map(Number);
  const value = new Date(Date.UTC(year, numericMonth - 1 + amount, 1));
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}`;
}

function normalizeName(value) {
  return String(value).trim().replace(/\s+/g, " ");
}
function validateBlogSource(recipe, at, errors) {
  if (!String(recipe.sourceUrl ?? "").trim()) {
    errors.push(`${at}.sourceUrl is required for 주찬 and 반찬.`);
    return;
  }
  try {
    const source = new URL(recipe.sourceUrl);
    const host = source.hostname.toLowerCase();
    if (source.protocol !== "https:")
      errors.push(`${at}.sourceUrl must use https.`);
    if (!allowedBlogHosts.has(host) && !host.endsWith(".tistory.com"))
      errors.push(`${at}.sourceUrl must be a Naver Blog or Tistory post.`);
  } catch {
    errors.push(`${at}.sourceUrl must be a valid URL.`);
  }
  if (!String(recipe.sourceTitle ?? "").trim())
    errors.push(`${at}.sourceTitle is required.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(recipe.sourceCheckedAt ?? ""))
    errors.push(`${at}.sourceCheckedAt must be YYYY-MM-DD.`);
}
function calculateShopping(recipes, weekStart) {
  const pantryRows = db
    .prepare('SELECT "name","quantity","unit" FROM "PantryItem"')
    .all();
  const pantry = new Map(
    pantryRows.map((item) => [
      `${normalizeName(item.name)}|${item.unit}`,
      item.quantity,
    ]),
  );
  const totals = new Map();
  for (const recipe of recipes)
    for (const ingredient of recipe.ingredients) {
      const name = normalizeName(ingredient.name);
      if (basicStock.has(name)) continue;
      const key = `${name}|${ingredient.unit}`;
      const current = totals.get(key) ?? {
        name,
        quantity: 0,
        unit: ingredient.unit,
        category: ingredient.category ?? "기타",
        uses: [],
      };
      current.quantity += Number(ingredient.quantity);
      for (const date of recipe.plannedDates)
        current.uses.push(`${date.slice(5)} ${recipe.title}`);
      totals.set(key, current);
    }
  return [...totals.entries()]
    .map(([key, item]) => {
      const ownedQuantity = Math.min(
        Number(pantry.get(key) ?? 0),
        item.quantity,
      );
      return {
        ...item,
        quantity: round(item.quantity - ownedQuantity),
        requiredQuantity: round(item.quantity),
        ownedQuantity: round(ownedQuantity),
        usePlan: [...new Set(item.uses)].sort().join(" · "),
        purchased: false,
        weekStart,
      };
    })
    .filter((item) => item.quantity > 0)
    .sort(
      (a, b) =>
        a.usePlan.localeCompare(b.usePlan, "ko") ||
        a.name.localeCompare(b.name, "ko"),
    );
}
function round(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function insertRecipes(recipes, weekStart, prefix, now) {
  const insertRecipe = db.prepare(
    `INSERT INTO "Recipe" ("id","title","description","prepMinutes","cookMinutes","adultServings","childServings","tags","category","plannedDates","weekKeys","instructions","babySplitStep","storageMethod","consumeWithin","sourceUrl","sourceTitle","sourceAuthor","sourceDomain","sourceCheckedAt","needsReview","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const insertIngredient = db.prepare(
    'INSERT INTO "Ingredient" ("id","name","amount","category","recipeId") VALUES (?,?,?,?,?)',
  );
  const recipeIds = new Map();
  for (const recipe of recipes) {
    const id = `${prefix}${crypto
      .createHash("sha1")
      .update(
        `${recipe.category}|${recipe.title}|${recipe.plannedDates.join(",")}`,
      )
      .digest("hex")
      .slice(0, 12)}`;
    recipeIds.set(recipe.title, id);
    const sourceDomain = recipe.sourceUrl
      ? new URL(recipe.sourceUrl).hostname.toLowerCase()
      : null;
    insertRecipe.run(
      id,
      recipe.title,
      recipe.description ?? null,
      recipe.prepMinutes,
      recipe.cookMinutes,
      recipe.adultServings,
      recipe.childServings,
      (recipe.tags ?? []).join(","),
      recipe.category,
      JSON.stringify(recipe.plannedDates),
      JSON.stringify([weekStart]),
      JSON.stringify(recipe.instructions),
      recipe.babySplitStep,
      recipe.storageMethod,
      recipe.consumeWithin,
      recipe.sourceUrl ?? null,
      recipe.sourceTitle ?? null,
      recipe.sourceAuthor ?? null,
      sourceDomain,
      recipe.sourceCheckedAt ? toMillis(recipe.sourceCheckedAt) : null,
      0,
      now,
      now,
    );
    recipe.ingredients.forEach((ingredient, index) =>
      insertIngredient.run(
        `${id}-ingredient-${index + 1}`,
        ingredient.name,
        `${ingredient.quantity}${ingredient.unit}`,
        ingredient.category ?? "기타",
        id,
      ),
    );
  }
  return recipeIds;
}

function storedRecipes(weekStart, { skipInvalid = false } = {}) {
  const rows = db
    .prepare(
      'SELECT r."id",r."title",r."category",r."plannedDates",i."name",i."amount",i."category" AS "ingredientCategory" FROM "Recipe" r LEFT JOIN "Ingredient" i ON i."recipeId"=r."id" WHERE r."weekKeys" LIKE ? ORDER BY r."title"',
    )
    .all(`%${weekStart}%`);
  const recipes = new Map();
  for (const row of rows) {
    const recipe = recipes.get(row.id) ?? {
      id: row.id,
      title: row.title,
      category: row.category,
      plannedDates: parseJsonList(row.plannedDates),
      ingredients: [],
      invalidIngredient: false,
    };
    if (row.name) {
      const match = String(row.amount ?? "").match(
        /^([0-9]+(?:\.[0-9]+)?)(.+)$/,
      );
      if (!match) recipe.invalidIngredient = true;
      else
        recipe.ingredients.push({
          name: row.name,
          quantity: Number(match[1]),
          unit: match[2],
          category: row.ingredientCategory ?? "기타",
        });
    }
    recipes.set(row.id, recipe);
  }
  return [...recipes.values()].filter(
    (recipe) => !skipInvalid || !recipe.invalidIngredient,
  );
}

function missingStoredCoverage(weekStart) {
  const startMs = toMillis(weekStart),
    endMs = toMillis(addDays(weekStart, 7));
  const plans = db
    .prepare(
      'SELECT "date","lunchPlan","mainDish","sideDishes","dinnerDiningOut" FROM "MealPlan" WHERE "date">=? AND "date"<? ORDER BY "date"',
    )
    .all(startMs, endMs);
  const coverage = new Set();
  const allRecipes = storedRecipes(weekStart);
  const recipes = allRecipes.filter((recipe) => !recipe.invalidIngredient);
  for (const recipe of recipes)
    for (const date of recipe.plannedDates)
      coverage.add(`${date}|${recipe.title}`);
  const missing = [];
  for (const plan of plans) {
    const date = formatKst(plan.date);
    if (!plan.dinnerDiningOut)
      for (const dish of [
        plan.mainDish,
        ...parseJsonList(plan.sideDishes),
      ].filter(Boolean))
        if (!coverage.has(`${date}|${dish}`)) missing.push(`${date}: ${dish}`);
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (
      [0, 6].includes(day) &&
      plan.lunchPlan &&
      !plan.lunchPlan.includes("회사 식사") &&
      !recipes.some(
        (recipe) =>
          recipe.category === "점심" && recipe.plannedDates.includes(date),
      )
    )
      missing.push(`${date}: ${plan.lunchPlan} (점심)`);
  }
  for (const recipe of allRecipes.filter((recipe) => recipe.invalidIngredient))
    for (const date of recipe.plannedDates)
      missing.push(`${date}: ${recipe.title} (재료 수량 형식 오류)`);
  return missing;
}

function writeShopping(weekStart, recipes, now) {
  const shopping = calculateShopping(recipes, weekStart);
  const weekEnd = addDays(weekStart, 6);
  db.prepare(
    'INSERT OR IGNORE INTO "ShoppingWeek" ("id","startDate","endDate","createdAt") VALUES (?,?,?,?)',
  ).run(
    `shopping-week-${weekStart}`,
    toMillis(weekStart),
    toMillis(weekEnd),
    now,
  );
  const weekRow = db
    .prepare('SELECT "id" FROM "ShoppingWeek" WHERE "startDate"=?')
    .get(toMillis(weekStart));
  const purchased = new Map(
    db
      .prepare('SELECT "name","purchased" FROM "ShoppingItem" WHERE "weekId"=?')
      .all(weekRow.id)
      .map((item) => [item.name, item.purchased]),
  );
  const manualItems = db
    .prepare(
      'SELECT "id","name","quantity","unit","category","ownedQuantity","usePlan","purchased" FROM "ShoppingItem" WHERE "weekId"=? AND "usePlan"=?',
    )
    .all(weekRow.id, "직접 추가");
  db.prepare('DELETE FROM "ShoppingItem" WHERE "weekId"=?').run(weekRow.id);
  const insertShopping = db.prepare(
    'INSERT INTO "ShoppingItem" ("id","name","quantity","unit","category","ownedQuantity","usePlan","purchased","weekId") VALUES (?,?,?,?,?,?,?,?,?)',
  );
  for (const item of shopping)
    insertShopping.run(
      `${weekRow.id}-${crypto.createHash("sha1").update(`${item.name}|${item.unit}`).digest("hex").slice(0, 10)}`,
      item.name,
      item.quantity,
      item.unit,
      item.category,
      item.ownedQuantity,
      item.usePlan,
      purchased.get(item.name) ?? 0,
      weekRow.id,
    );
  const generatedNames = new Set(shopping.map((item) => item.name));
  for (const item of manualItems) {
    if (generatedNames.has(item.name)) continue;
    insertShopping.run(
      item.id,
      item.name,
      item.quantity,
      item.unit,
      item.category,
      item.ownedQuantity,
      item.usePlan,
      item.purchased,
      weekRow.id,
    );
  }
  return shopping;
}

function beginAgentJob({
  prefix,
  requestId,
  weekStart,
  action,
  inputPath = null,
  now = Date.now(),
}) {
  // Web requests create the RUNNING row before the background worker starts. Reuse that row
  // so the UI can poll one stable requestId. CLI and cron runs still create a
  // fresh row because they do not have a pre-created web job.
  const queued = requestId
    ? db
        .prepare(
          `SELECT "id" FROM "AgentJob" WHERE "requestId"=? AND "status"='RUNNING' ORDER BY "createdAt" DESC LIMIT 1`,
        )
        .get(requestId)
    : null;
  if (queued) {
    db.prepare(
      'UPDATE "AgentJob" SET "weekStart"=?,"action"=?,"inputPath"=?,"summary"=NULL,"error"=NULL,"completedAt"=NULL WHERE "id"=?',
    ).run(toMillis(weekStart), action, inputPath, queued.id);
    return queued.id;
  }

  const jobId = `${prefix}-${now}-${crypto.randomBytes(3).toString("hex")}`;
  db.prepare(
    'INSERT INTO "AgentJob" ("id","requestId","weekStart","action","status","inputPath","createdAt") VALUES (?,?,?,?,?,?,?)',
  ).run(
    jobId,
    requestId ?? null,
    toMillis(weekStart),
    action,
    "RUNNING",
    inputPath,
    now,
  );
  return jobId;
}

function failQueuedAgentJob(requestId, error) {
  if (!requestId) return;
  db.prepare(
    `UPDATE "AgentJob" SET "status"='FAILED',"error"=?,"completedAt"=? WHERE "requestId"=? AND "status"='RUNNING'`,
  ).run(String(error).slice(0, 2000), Date.now(), requestId);
}

function publishMonth(payload, month, requestId = null) {
  const selectedMonth = requireMonth(month);
  const validation = validateMonth(payload, selectedMonth);
  if (!validation.valid) {
    failQueuedAgentJob(requestId, validation.errors.join("; "));
    printJson(validation);
    process.exitCode = 2;
    return;
  }
  const now = Date.now();
  const jobId = beginAgentJob({
    prefix: "agent-month",
    requestId,
    weekStart: sundayFor(monthStart(selectedMonth)),
    action: "PUBLISH_MONTH",
    inputPath: path.resolve(flags.input),
    now,
  });
  const backupDir = path.join(root, "data", "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `mealplan-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
  fs.copyFileSync(dbPath, backupPath);
  try {
    db.exec("BEGIN IMMEDIATE");
    const insertPlan = db.prepare('INSERT INTO "MealPlan" ("id","date","monthKey","mealType","lunchPlan","mainDish","sideDishes","babyMenu","cookingNote","changeReason","adultServings","childServings","dinnerDiningOut","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const change of payload.mealChanges) {
      const date = String(change.date);
      insertPlan.run(
        `month-${date}-${crypto.randomBytes(3).toString("hex")}`,
        toMillis(date),
        selectedMonth,
        "DINNER",
        String(change.lunch).trim(),
        String(change.main).trim(),
        JSON.stringify(change.sides.map((side) => String(side).trim())),
        String(change.baby ?? "").trim() || null,
        String(change.note ?? "").trim() || null,
        String(payload.changeReason).trim().slice(0, 2_000),
        2,
        1,
        0,
        now,
        now,
      );
    }
    const summary = JSON.stringify({ mealChanges: payload.mealChanges.length, recipes: 0, shoppingItems: 0, backup: backupPath, month: selectedMonth });
    db.prepare('UPDATE "AgentJob" SET "status"=?,"summary"=?,"completedAt"=? WHERE "id"=?').run("COMPLETED", summary, Date.now(), jobId);
    db.exec("COMMIT");
    printJson({ success: true, jobId, month: selectedMonth, mealChanges: payload.mealChanges.length, recipes: 0, shoppingItems: 0, backup: backupPath });
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    db.prepare('UPDATE "AgentJob" SET "status"=?,"error"=?,"completedAt"=? WHERE "id"=?').run("FAILED", String(error.message ?? error), Date.now(), jobId);
    throw error;
  }
}

function publishWeek(
  payload,
  weekStart,
  rebuildShopping = true,
  requestId = null,
) {
  const validation = validatePayload(payload, weekStart);
  if (!validation.valid) {
    failQueuedAgentJob(requestId, validation.errors.join("; "));
    printJson(validation);
    process.exitCode = 2;
    return;
  }
  const now = Date.now();
  const action = payload.mealChanges?.length
    ? "UPDATE_AND_PUBLISH_WEEK"
    : rebuildShopping
      ? "PUBLISH_WEEK"
      : "PUBLISH_RECIPES";
  const jobId = beginAgentJob({
    prefix: "agent-job",
    requestId,
    weekStart,
    action,
    inputPath: path.resolve(flags.input),
    now,
  });
  const backupDir = path.join(root, "data", "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(
    backupDir,
    `mealplan-${new Date().toISOString().replace(/[:.]/g, "-")}.db`,
  );
  fs.copyFileSync(dbPath, backupPath);
  const prefix = `generated-${weekStart}-`;
  try {
    db.exec("BEGIN IMMEDIATE");
    const findPlan = db.prepare(
      'SELECT "id","lunchPlan","mainDish","sideDishes","babyMenu","cookingNote" FROM "MealPlan" WHERE "date"=?',
    );
    const updatePlan = db.prepare(
      'UPDATE "MealPlan" SET "lunchPlan"=?,"mainDish"=?,"sideDishes"=?,"babyMenu"=?,"cookingNote"=?,"changeReason"=?,"recipeId"=NULL,"updatedAt"=? WHERE "id"=?',
    );
    for (const change of payload.mealChanges ?? []) {
      const current = findPlan.get(toMillis(change.date));
      updatePlan.run(
        Object.hasOwn(change, "lunch")
          ? (change.lunch ?? null)
          : current.lunchPlan,
        change.main,
        JSON.stringify(change.sides),
        Object.hasOwn(change, "baby")
          ? (change.baby ?? null)
          : current.babyMenu,
        Object.hasOwn(change, "note")
          ? (change.note ?? null)
          : current.cookingNote,
        payload.changeReason,
        now,
        current.id,
      );
    }
    // A weekly regeneration is an authoritative replacement for that week.
    // Older data did not always use the generated ID prefix, so scope cleanup by
    // the persisted week key rather than leaving stale recipes visible.
    db.prepare(
      'UPDATE "MealPlan" SET "recipeId"=NULL WHERE "recipeId" IN (SELECT "id" FROM "Recipe" WHERE "weekKeys" LIKE ?)',
    ).run(`%${weekStart}%`);
    db.prepare('DELETE FROM "Recipe" WHERE "weekKeys" LIKE ?').run(
      `%${weekStart}%`,
    );
    const insertRecipe = db.prepare(
      `INSERT INTO "Recipe" ("id","title","description","prepMinutes","cookMinutes","adultServings","childServings","tags","category","plannedDates","weekKeys","instructions","babySplitStep","storageMethod","consumeWithin","sourceUrl","sourceTitle","sourceAuthor","sourceDomain","sourceCheckedAt","needsReview","createdAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    const insertIngredient = db.prepare(
      'INSERT INTO "Ingredient" ("id","name","amount","category","recipeId") VALUES (?,?,?,?,?)',
    );
    const recipeIds = new Map();
    for (const recipe of payload.recipes) {
      const id = `${prefix}${crypto.createHash("sha1").update(`${recipe.category}|${recipe.title}`).digest("hex").slice(0, 12)}`;
      recipeIds.set(recipe.title, id);
      const sourceDomain = recipe.sourceUrl
        ? new URL(recipe.sourceUrl).hostname.toLowerCase()
        : null;
      insertRecipe.run(
        id,
        recipe.title,
        recipe.description ?? null,
        recipe.prepMinutes,
        recipe.cookMinutes,
        recipe.adultServings,
        recipe.childServings,
        (recipe.tags ?? []).join(","),
        recipe.category,
        JSON.stringify(recipe.plannedDates),
        JSON.stringify([weekStart]),
        JSON.stringify(recipe.instructions),
        recipe.babySplitStep,
        recipe.storageMethod,
        recipe.consumeWithin,
        recipe.sourceUrl ?? null,
        recipe.sourceTitle ?? null,
        recipe.sourceAuthor ?? null,
        sourceDomain,
        recipe.sourceCheckedAt ? toMillis(recipe.sourceCheckedAt) : null,
        0,
        now,
        now,
      );
      recipe.ingredients.forEach((ingredient, index) =>
        insertIngredient.run(
          `${id}-ingredient-${index + 1}`,
          ingredient.name,
          `${ingredient.quantity}${ingredient.unit}`,
          ingredient.category ?? "기타",
          id,
        ),
      );
    }
    const startMs = toMillis(weekStart),
      endMs = toMillis(addDays(weekStart, 7));
    const planRows = db
      .prepare(
        'SELECT "id","mainDish" FROM "MealPlan" WHERE "date">=? AND "date"<?',
      )
      .all(startMs, endMs);
    const linkRecipe = db.prepare(
      'UPDATE "MealPlan" SET "recipeId"=?, "updatedAt"=? WHERE "id"=?',
    );
    for (const plan of planRows)
      if (recipeIds.has(plan.mainDish))
        linkRecipe.run(recipeIds.get(plan.mainDish), now, plan.id);
    let shoppingItems = 0;
    if (rebuildShopping)
      shoppingItems = writeShopping(weekStart, payload.recipes, now).length;
    const summary = JSON.stringify({
      mealChanges: payload.mealChanges?.length ?? 0,
      recipes: payload.recipes.length,
      shoppingItems,
      backup: backupPath,
    });
    db.prepare(
      'UPDATE "AgentJob" SET "status"=?,"summary"=?,"completedAt"=? WHERE "id"=?',
    ).run("COMPLETED", summary, Date.now(), jobId);
    db.exec("COMMIT");
    printJson({
      success: true,
      jobId,
      weekStart,
      backup: backupPath,
      mealChanges: payload.mealChanges?.length ?? 0,
      recipes: payload.recipes.length,
      shoppingItems,
    });
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    db.prepare(
      'UPDATE "AgentJob" SET "status"=?,"error"=?,"completedAt"=? WHERE "id"=?',
    ).run("FAILED", String(error.message ?? error), Date.now(), jobId);
    throw error;
  }
}

function publishDay(payload, weekStart, date, requestId = null) {
  const validation = validateDay(payload, weekStart, date);
  if (!validation.valid) {
    failQueuedAgentJob(requestId, validation.errors.join("; "));
    printJson(validation);
    process.exitCode = 2;
    return;
  }
  const now = Date.now();
  const jobId = beginAgentJob({
    prefix: "agent-day",
    requestId,
    weekStart,
    action: "UPDATE_DAY",
    inputPath: path.resolve(flags.input),
    now,
  });
  const backupDir = path.join(root, "data", "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(
    backupDir,
    `mealplan-${new Date().toISOString().replace(/[:.]/g, "-")}.db`,
  );
  fs.copyFileSync(dbPath, backupPath);
  try {
    db.exec("BEGIN IMMEDIATE");
    const change = payload.mealChanges[0];
    const current = db
      .prepare(
        'SELECT "id","lunchPlan","babyMenu","cookingNote" FROM "MealPlan" WHERE "date"=?',
      )
      .get(toMillis(date));
    db.prepare(
      'UPDATE "MealPlan" SET "lunchPlan"=?,"mainDish"=?,"sideDishes"=?,"babyMenu"=?,"cookingNote"=?,"changeReason"=?,"recipeId"=NULL,"updatedAt"=? WHERE "id"=?',
    ).run(
      Object.hasOwn(change, "lunch")
        ? (change.lunch ?? null)
        : current.lunchPlan,
      change.main,
      JSON.stringify(change.sides),
      Object.hasOwn(change, "baby") ? (change.baby ?? null) : current.babyMenu,
      Object.hasOwn(change, "note")
        ? (change.note ?? null)
        : current.cookingNote,
      payload.changeReason,
      now,
      current.id,
    );

    const oldRecipes = db
      .prepare(
        'SELECT "id","plannedDates" FROM "Recipe" WHERE "weekKeys" LIKE ? AND "plannedDates" LIKE ?',
      )
      .all(`%${weekStart}%`, `%${date}%`);
    const unlink = db.prepare(
      'UPDATE "MealPlan" SET "recipeId"=NULL WHERE "recipeId"=?',
    );
    const trimDates = db.prepare(
      'UPDATE "Recipe" SET "plannedDates"=?,"updatedAt"=? WHERE "id"=?',
    );
    const deleteRecipe = db.prepare('DELETE FROM "Recipe" WHERE "id"=?');
    for (const recipe of oldRecipes) {
      const dates = parseJsonList(recipe.plannedDates).filter(
        (value) => value !== date,
      );
      unlink.run(recipe.id);
      if (dates.length) trimDates.run(JSON.stringify(dates), now, recipe.id);
      else deleteRecipe.run(recipe.id);
    }
    const recipeIds = insertRecipes(
      payload.recipes,
      weekStart,
      `generated-${weekStart}-${date}-`,
      now,
    );
    const mainRecipeId = recipeIds.get(change.main);
    if (mainRecipeId)
      db.prepare(
        'UPDATE "MealPlan" SET "recipeId"=?,"updatedAt"=? WHERE "id"=?',
      ).run(mainRecipeId, now, current.id);
    const skippedLegacyRecipes = storedRecipes(weekStart)
      .filter((recipe) => recipe.invalidIngredient)
      .map((recipe) => recipe.title);
    const shopping = writeShopping(
      weekStart,
      storedRecipes(weekStart, { skipInvalid: true }),
      now,
    );
    const summary = JSON.stringify({
      mealChanges: 1,
      recipes: payload.recipes.length,
      shoppingItems: shopping.length,
      skippedLegacyRecipes,
      backup: backupPath,
    });
    db.prepare(
      'UPDATE "AgentJob" SET "status"=?,"summary"=?,"completedAt"=? WHERE "id"=?',
    ).run("COMPLETED", summary, Date.now(), jobId);
    db.exec("COMMIT");
    printJson({
      success: true,
      jobId,
      weekStart,
      date,
      backup: backupPath,
      mealChanges: 1,
      recipes: payload.recipes.length,
      shoppingItems: shopping.length,
      skippedLegacyRecipes,
    });
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    db.prepare(
      'UPDATE "AgentJob" SET "status"=?,"error"=?,"completedAt"=? WHERE "id"=?',
    ).run("FAILED", String(error.message ?? error), Date.now(), jobId);
    throw error;
  }
}

function rebuildShopping(weekStart, requestId = null) {
  const now = Date.now();
  const jobId = beginAgentJob({
    prefix: "agent-shopping",
    requestId,
    weekStart,
    action: "REGENERATE_GROCERY",
    now,
  });
  const missing = missingStoredCoverage(weekStart);
  if (missing.length) {
    const error = `레시피가 아직 준비되지 않은 메뉴가 있습니다: ${missing.join(", ")}`;
    db.prepare(
      'UPDATE "AgentJob" SET "status"=?,"error"=?,"completedAt"=? WHERE "id"=?',
    ).run("FAILED", error, Date.now(), jobId);
    printJson({ success: false, jobId, weekStart, missing });
    process.exitCode = 2;
    return;
  }
  const backupDir = path.join(root, "data", "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(
    backupDir,
    `mealplan-${new Date().toISOString().replace(/[:.]/g, "-")}.db`,
  );
  fs.copyFileSync(dbPath, backupPath);
  try {
    db.exec("BEGIN IMMEDIATE");
    const shopping = writeShopping(weekStart, storedRecipes(weekStart), now);
    db.prepare(
      'UPDATE "AgentJob" SET "status"=?,"summary"=?,"completedAt"=? WHERE "id"=?',
    ).run(
      "COMPLETED",
      JSON.stringify({ shoppingItems: shopping.length, backup: backupPath }),
      Date.now(),
      jobId,
    );
    db.exec("COMMIT");
    printJson({
      success: true,
      jobId,
      weekStart,
      shoppingItems: shopping.length,
      backup: backupPath,
    });
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    db.prepare(
      'UPDATE "AgentJob" SET "status"=?,"error"=?,"completedAt"=? WHERE "id"=?',
    ).run("FAILED", String(error.message ?? error), Date.now(), jobId);
    throw error;
  }
}

function replyChat(payload, id) {
  if (!String(id ?? "").trim() || String(id).length > 120)
    fail("--id is required.");
  const answer = String(payload?.answer ?? "").trim();
  if (!answer) fail("answer is required.");
  if (answer.length > 12_000) fail("answer is too long.");
  const sources = Array.isArray(payload?.sources)
    ? payload.sources
        .filter(
          (source) =>
            source &&
            typeof source.url === "string" &&
            /^https?:\/\//.test(source.url),
        )
        .slice(0, 8)
        .map((source) => ({
          title:
            typeof source.title === "string"
              ? source.title.slice(0, 300)
              : undefined,
          url: source.url,
        }))
    : [];
  const result = db
    .prepare(
      'UPDATE "AgentChat" SET "status"=?,"answer"=?,"sources"=?,"error"=NULL,"completedAt"=? WHERE "id"=? AND "status"="RUNNING"',
    )
    .run("COMPLETED", answer, JSON.stringify(sources), Date.now(), id);
  if (result.changes !== 1)
    fail("Chat request was not found or is already completed.");
  printJson({ success: true, id, sources: sources.length });
}

function recordReview(weekStart, summary, requestId = null) {
  if (!String(summary ?? "").trim()) fail("--summary is required.");
  const now = Date.now();
  const jobId = beginAgentJob({
    prefix: "agent-review",
    requestId,
    weekStart,
    action: "REVIEW_WEEK",
    now,
  });
  db.prepare(
    'UPDATE "AgentJob" SET "action"=?,"status"=?,"summary"=?,"error"=NULL,"completedAt"=? WHERE "id"=?',
  ).run(
    "WEEKLY_REVIEW_MAINTAINED",
    "COMPLETED",
    String(summary).trim().slice(0, 2000),
    now,
    jobId,
  );
  printJson({ success: true, jobId, weekStart, maintained: true });
}

function failJob(requestId, error) {
  if (!String(requestId ?? "").trim() || String(requestId).length > 120)
    fail("--request-id is required.");
  const result = db
    .prepare(
      `UPDATE "AgentJob" SET "status"='FAILED',"error"=?,"completedAt"=? WHERE "requestId"=? AND "status"='RUNNING'`,
    )
    .run(
      String(error ?? "AI 작업에 실패했습니다.").trim().slice(0, 2000),
      Date.now(),
      requestId,
    );
  if (!result.changes)
    fail("Queued agent job was not found or is already completed.");
  printJson({ success: true, requestId, status: "FAILED" });
}

function failChat(id, error) {
  if (!String(id ?? "").trim() || String(id).length > 120)
    fail("--id is required.");
  const result = db
    .prepare(
      `UPDATE "AgentChat" SET "status"='FAILED',"error"=?,"completedAt"=? WHERE "id"=? AND "status"='RUNNING'`,
    )
    .run(
      String(error ?? "AI 답변을 완료하지 못했습니다.").trim().slice(0, 2000),
      Date.now(),
      id,
    );
  if (!result.changes)
    fail("Queued chat was not found or is already completed.");
  printJson({ success: true, id, status: "FAILED" });
}

function notifyWeb({ requestId, chatId }) {
  if (Boolean(requestId) === Boolean(chatId))
    fail("Provide exactly one of --request-id or --chat-id.");
  const url = process.env.MEAL_APP_NOTIFY_URL?.trim();
  const token = process.env.MEAL_APP_NOTIFY_TOKEN?.trim();
  if (!url || !token) {
    printJson({ success: true, skipped: true, reason: "MEAL_APP_NOTIFY_URL or MEAL_APP_NOTIFY_TOKEN is not configured." });
    return;
  }
  let endpoint;
  try {
    endpoint = new URL(url);
  } catch {
    fail("MEAL_APP_NOTIFY_URL must be a valid URL.");
  }
  if (!/^https?:$/.test(endpoint.protocol))
    fail("MEAL_APP_NOTIFY_URL must use http or https.");
  const body = requestId ? { requestId } : { chatId };
  const code = `
const [url, token, body] = process.argv.slice(1);
fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body })
  .then(async (response) => { const text = await response.text(); if (!response.ok) throw new Error("Notification callback returned " + response.status + ": " + text); process.stdout.write(text); })
  .catch((error) => { console.error(error.message); process.exit(1); });`;
  const result = spawnSync(
    process.execPath,
    ["-e", code, url, token, JSON.stringify(body)],
    { encoding: "utf8", timeout: 15_000 },
  );
  if (result.status !== 0) {
    // Notification delivery must never invalidate a successfully published meal.
    printJson({ success: true, notified: false, warning: String(result.stderr || result.error?.message || "Notification callback failed.").trim() });
    return;
  }
  try {
    printJson({ success: true, notified: true, callback: JSON.parse(result.stdout) });
  } catch {
    printJson({ success: true, notified: true });
  }
}

try {
  if (command === "context") printJson(loadContext(requireWeek(flags.week)));
  if (command === "context-month") printJson(loadMonthContext(requireMonth(flags.month)));
  if (command === "validate-week") {
    const payload = readPayload(flags.input);
    const result = validatePayload(
      payload,
      requireWeek(flags.week ?? payload.weekStart),
    );
    printJson(result);
    if (!result.valid) process.exitCode = 2;
  }
  if (command === "validate-month") {
    const payload = readPayload(flags.input);
    const result = validateMonth(payload, requireMonth(flags.month ?? payload.month));
    printJson(result);
    if (!result.valid) process.exitCode = 2;
  }
  if (command === "publish-week")
    publishWeek(
      readPayload(flags.input),
      requireWeek(flags.week),
      true,
      flags["request-id"],
    );
  if (command === "publish-month")
    publishMonth(readPayload(flags.input), requireMonth(flags.month), flags["request-id"]);
  if (command === "publish-recipes")
    publishWeek(
      readPayload(flags.input),
      requireWeek(flags.week),
      false,
      flags["request-id"],
    );
  if (command === "validate-day") {
    const payload = readPayload(flags.input);
    const result = validateDay(
      payload,
      requireWeek(flags.week ?? payload.weekStart),
      flags.date,
    );
    printJson(result);
    if (!result.valid) process.exitCode = 2;
  }
  if (command === "publish-day")
    publishDay(
      readPayload(flags.input),
      requireWeek(flags.week),
      flags.date,
      flags["request-id"],
    );
  if (command === "rebuild-shopping")
    rebuildShopping(requireWeek(flags.week), flags["request-id"]);
  if (command === "reply-chat") replyChat(readPayload(flags.input), flags.id);
  if (command === "record-review")
    recordReview(requireWeek(flags.week), flags.summary, flags["request-id"]);
  if (command === "fail-job") failJob(flags["request-id"], flags.error);
  if (command === "fail-chat") failChat(flags.id, flags.error);
  if (command === "notify-web")
    notifyWeb({ requestId: flags["request-id"], chatId: flags["chat-id"] });
} finally {
  db.close();
}
