import crypto from "node:crypto";
import { dishName, dishCategory, effectiveUsage, validatePreference } from "../lib/dish-preference-rules.mjs";

export function preferenceContext(db) {
  const dishes = db.prepare('SELECT * FROM "Dish" ORDER BY "name"').all();
  const preferences = db.prepare('SELECT * FROM "DishPreference"').all();
  const roles = db.prepare('SELECT "role" FROM "FamilyMember"').all().map(m => m.role);
  return dishes.map(dish => ({...dish, preferences: preferences.filter(p => p.dishId === dish.id), usage: effectiveUsage(preferences.filter(p => p.dishId === dish.id), roles)}));
}

export function savePreference(db, raw, source = "chat") {
  const input = validatePreference(raw);
  if (input.scope !== "family" && !db.prepare('SELECT "id" FROM "FamilyMember" WHERE "role"=?').get(input.scope)) throw new Error("등록된 가족을 선택해 주세요.");
  const now = Date.now();
  db.exec("BEGIN IMMEDIATE");
  try {
    let dish = db.prepare('SELECT * FROM "Dish" WHERE "name"=? AND "category"=?').get(input.name, input.category);
    if (!dish) {
      dish = {id: crypto.randomUUID()};
      db.prepare('INSERT INTO "Dish" ("id","name","category","aliases","createdAt") VALUES (?,?,?,?,?)').run(dish.id, input.name, input.category, "[]", now);
    }
    const current = db.prepare('SELECT * FROM "DishPreference" WHERE "dishId"=? AND "scope"=?').get(dish.id, input.scope);
    db.prepare(`INSERT INTO "DishPreference" ("id","dishId","scope","usage","familiarity","note","source","confirmedAt","updatedAt") VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT("dishId","scope") DO UPDATE SET "usage"=excluded."usage","familiarity"=excluded."familiarity","note"=excluded."note","source"=excluded."source","confirmedAt"=excluded."confirmedAt","updatedAt"=excluded."updatedAt"`).run(
      current?.id ?? crypto.randomUUID(), dish.id, input.scope, input.usage ?? current?.usage ?? "UNKNOWN", input.familiarity ?? current?.familiarity ?? "UNKNOWN", input.note ?? current?.note ?? "", source, now, now);
    db.exec("COMMIT");
    return {success: true, name: input.name, category: input.category, scope: input.scope};
  } catch(error) {db.exec("ROLLBACK"); throw error;}
}

export function validateMealPreferences(db, changes) {
  const errors = [];
  const dishes = preferenceContext(db);
  const members = db.prepare('SELECT "id","role" FROM "FamilyMember"').all();
  for (const change of changes) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(change?.date ?? "")) continue;
    const millis = Date.parse(`${change.date}T00:00:00+09:00`);
    const old = db.prepare('SELECT * FROM "MealPlan" WHERE "date"=? AND "mealType"=\'DINNER\'').get(millis);
    const schedules = db.prepare('SELECT * FROM "FamilySchedule" WHERE "date"=?').all(millis);
    const weekday = new Date(`${change.date}T00:00:00Z`).getUTCDay();
    const weekMillis = millis - weekday * 86_400_000;
    const review = db.prepare('SELECT * FROM "WeeklyReview" WHERE "weekStart"=?').get(weekMillis);
    const attending = (meal) => members.filter(m => !schedules.some(s => s.memberId === m.id && s[meal === "점심" ? "lunchNotAtHome" : "dinnerNotAtHome"])).map(m => m.role);
    const check = (name, category, previous = []) => {
      if (typeof name !== "string" || !name.trim()) return;
      const title = dishName(name);
      // Unchanged saved dishes remain intact, even if their preference is unknown.
      if (previous.some(item => dishName(item) === title)) return;
      if (category === "점심" && title === "회사 식사" && ![0,6].includes(new Date(`${change.date}T00:00:00Z`).getUTCDay())) return;
      if (category !== "점심" && old?.dinnerDiningOut) return;
      const roles = category === "아기" ? attending(category).filter(r => r === "child") : attending(category);
      if (!roles.length) return;
      if (review && millis >= Number(review.referenceDate || review.weekStart) && String(review.avoidFoods || "").includes(title)) {
        errors.push(`${change.date} ${category} '${title}': 이번 주 피하고 싶은 메뉴입니다.`);
        return;
      }
      const dish = dishes.find(d => dishCategory(d.category) === category && (d.name === title || safeList(d.aliases).includes(title)));
      const usage = effectiveUsage(dish?.preferences ?? [], roles);
      if (usage !== "ALLOW") errors.push(`${change.date} ${category} '${title}': ${usage === "AVOID" ? "함께 먹는 가족이 피하는 메뉴입니다." : "식단 사용이 미확인입니다. 우리 집 메뉴에서 후보를 확인해 주세요."}`);
    };
    check(change.main, "주찬", [old?.mainDish]);
    for (const side of Array.isArray(change.sides) ? change.sides : []) check(side, "부찬", safeList(old?.sideDishes));
    check(change.lunch, "점심", [old?.lunchPlan]);
    check(change.baby, "아기", [old?.babyMenu]);
  }
  return errors;
}
function safeList(value) {try { const list = JSON.parse(value || "[]"); return Array.isArray(list) ? list : []; } catch {return [];}}
