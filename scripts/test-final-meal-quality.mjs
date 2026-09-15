import assert from "node:assert/strict";
import { assessFinalMealQuality } from "../lib/final-meal-quality.mjs";
import { menuMetadata } from "../lib/catalog-selection.mjs";

const catalog = [
  ["메인반찬", "제육볶음", "앞다리살제육볶음"],
  ["메인반찬", "두부부침", "간장두부부침"],
  ["메인반찬", "닭볶음탕", "치즈닭볶음탕"],
  ["국/탕", "감자국", "소고기감자국"],
  ["밑반찬", "어묵볶음", "꽈리고추어묵볶음"],
  ["밑반찬", "콩나물무침", "아삭콩나물무침"],
].map(([sourceCategory, baseName, variantName]) => ({
  sourceCategory, baseName, variantName,
  ...menuMetadata({ sourceCategory, baseName, variantName }),
}));
const plan = (date, main = "앞다리살제육볶음", sides = ["꽈리고추어묵볶음", "아삭콩나물무침"]) => ({
  date, mealStyle: "MAIN_DISH", main, sides,
});
const dates = Array.from({ length: 7 }, (_, index) => `2026-10-${String(index + 1).padStart(2, "0")}`);
const clean = assessFinalMealQuality({ plans: dates.map((date) => plan(date)), catalog });
assert.equal(clean.catalogMainPercent, 100);
assert.ok(clean.score >= 85);
assert.equal(clean.issues.filter((issue) => issue.severity === "HIGH").length, 0);

const unknown = assessFinalMealQuality({ plans: [plan(dates[0], "대구살구이")], catalog });
assert.ok(unknown.issues.some((issue) => issue.code === "UNVERIFIED_MENU"));
assert.equal(unknown.assessed.find((item) => item.slot === "main").primaryIngredient, "생선");

const confirmed = assessFinalMealQuality({ plans: [plan(dates[0], "대구살구이")], catalog,
  knownMenus: new Set(["주찬|대구살구이"]) });
assert.equal(confirmed.issues.some((issue) => issue.code === "UNVERIFIED_MENU"), false);
assert.ok(confirmed.score > unknown.score);

const verified = assessFinalMealQuality({ plans: [plan(dates[0], "대구살구이")], catalog,
  verifiedRecipes: new Set(["주찬|대구살구이"]) });
assert.equal(verified.issues.some((issue) => issue.code === "UNVERIFIED_MENU"), false);
assert.ok(verified.score > confirmed.score);

const wrongRole = assessFinalMealQuality({ plans: [plan(dates[0], "소고기감자국")], catalog });
assert.ok(wrongRole.issues.some((issue) => issue.code === "MEAL_ROLE_MISMATCH"));
const legitimateMain = assessFinalMealQuality({ plans: [plan(dates[0], "치즈닭볶음탕")], catalog });
assert.equal(legitimateMain.issues.some((issue) => issue.code === "MEAL_ROLE_MISMATCH"), false);

const scoped = assessFinalMealQuality({ plans: [plan(dates[0]), plan(dates[1], "대구살구이")], catalog,
  targetDates: [dates[0]] });
assert.equal(scoped.issues.some((issue) => issue.code === "UNVERIFIED_MENU"), false);
assert.equal(scoped.summary.mainSlots, 1);

const lowMonth = assessFinalMealQuality({ plans: dates.map((date) => plan(date, "대구살구이")), catalog });
assert.ok(lowMonth.issues.some((issue) => issue.code === "FINAL_SCORE_LOW"));
console.log("Final meal quality tests passed.");
