import assert from "node:assert/strict";
import { splitWeeklyFoods, weeklyWishBoost } from "../lib/weekly-wishes.mjs";

const wishes = splitWeeklyFoods("카레, 생선구이 / 계란찜");
assert.deepEqual(wishes, ["카레", "생선구이", "계란찜"]);
assert.equal(weeklyWishBoost({ variantName: "닭가슴살카레", baseName: "카레" }, wishes), 3);
assert.equal(weeklyWishBoost({ variantName: "된장찌개", baseName: "찌개" }, wishes), 1);
console.log("weekly wanted-food selection checks passed");
