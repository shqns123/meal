import assert from "node:assert/strict";
import { flattenCatalog } from "../lib/catalog-selection.mjs";
import { assessMealDiversity } from "../lib/meal-diversity.mjs";

const catalog = flattenCatalog([
  { sourceCategory: "메인반찬", baseName: "보쌈", variantName: "돼지보쌈" },
  { sourceCategory: "메인반찬", baseName: "수육", variantName: "돼지수육" },
  { sourceCategory: "메인반찬", baseName: "고등어조림", variantName: "감자고등어조림" },
  { sourceCategory: "메인반찬", baseName: "갈치조림", variantName: "무갈치조림" },
  { sourceCategory: "메인반찬", baseName: "두부조림", variantName: "간장두부조림" },
  { sourceCategory: "메인반찬", baseName: "닭갈비", variantName: "춘천닭갈비" },
  { sourceCategory: "밑반찬", baseName: "어묵볶음", variantName: "간장어묵볶음" },
  { sourceCategory: "밑반찬", baseName: "두부조림", variantName: "간장두부조림" },
]);
const plans = [
  { date: "2026-09-13", mealStyle: "MAIN_DISH", main: "돼지보쌈", sides: ["간장어묵볶음", "간장두부조림"] },
  { date: "2026-09-14", mealStyle: "MAIN_DISH", main: "돼지수육", sides: ["간장어묵볶음", "간장두부조림"] },
  { date: "2026-09-15", mealStyle: "MAIN_DISH", main: "감자고등어조림", sides: ["간장어묵볶음", "간장두부조림"] },
  { date: "2026-09-16", mealStyle: "MAIN_DISH", main: "무갈치조림", sides: ["간장어묵볶음", "간장두부조림"] },
];
const result = assessMealDiversity({ plans, catalog });
const similar = result.issues.filter((issue) => issue.code === "SIMILAR_MAIN");
assert.equal(similar.length, 2, "보쌈/수육과 고등어/갈치는 이름이 달라도 근접 반복으로 감지한다.");
assert.ok(similar.every((issue) => issue.severity === "HIGH"));
assert.ok(!result.issues.some((issue) => issue.code.includes("SIDE") && issue.dates.includes("2026-09-14")),
  "2~3일 유지할 부찬 조합은 하루마다 반복 경고를 내지 않는다.");
const duplicate = assessMealDiversity({ plans: [{ ...plans[0], sides: ["돼지보쌈", "간장두부조림"] }], catalog });
assert.ok(duplicate.issues.some((issue) => issue.code === "SAME_DAY_DUPLICATE"));
const partial = assessMealDiversity({ plans, catalog, activeFrom: "2026-09-16" });
assert.equal(partial.issues.filter((issue) => issue.code === "SIMILAR_MAIN").length, 1,
  "부분 교체에서는 교체 시작일 이전의 경고를 새 변경 대상으로 삼지 않는다.");
const sameMethod = assessMealDiversity({ plans: [
  { ...plans[0], main: "감자고등어조림" },
  { ...plans[1], main: "무갈치조림" },
  { ...plans[2], main: "간장두부조림" },
], catalog });
assert.ok(sameMethod.issues.some((issue) => issue.code === "COOKING_STREAK" && issue.severity === "HIGH"),
  "생선에서 두부로 재료를 바꿔도 조림 3일 연속은 월간 완성본에서 감지한다.");
const skewedWeek = assessMealDiversity({ plans: Array.from({ length: 7 }, (_, index) => ({
  date: `2026-09-${String(13 + index).padStart(2, "0")}`,
  mealStyle: "MAIN_DISH",
  main: index < 5 ? ["감자고등어조림", "무갈치조림", "간장두부조림"][index % 3] : "춘천닭갈비",
  sides: ["간장어묵볶음", "간장두부조림"],
})), catalog });
assert.ok(skewedWeek.issues.some((issue) => issue.code === "WEEK_COOKING_SKEW"),
  "같은 주에 조림이 5일이면 연속 여부와 별도로 주간 쏠림을 감지한다.");
const crossingMonth = assessMealDiversity({
  previousPlans: ["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"]
    .map((date) => ({ date, mealStyle: "MAIN_DISH", mainDish: "감자고등어조림" })),
  plans: ["2026-10-01", "2026-10-02", "2026-10-03"]
    .map((date) => ({ date, mealStyle: "MAIN_DISH", main: "무갈치조림" })),
  catalog,
});
assert.ok(crossingMonth.issues.some((issue) => issue.code === "WEEK_SIMILAR_GROUP"),
  "전월 마지막 4일과 이번 달 첫 3일이 같은 주면 합쳐서 계열 쏠림을 판정한다.");

console.log("meal diversity checks passed");
