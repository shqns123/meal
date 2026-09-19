import assert from "node:assert/strict";
import {
  buildRecipeIngredientIndex,
  pantrySelectionSignal,
} from "../lib/pantry-selection.mjs";

const index = buildRecipeIngredientIndex({
  catalogRows: [{
    variantName: "버섯콩나물밥",
    ingredientGroups: JSON.stringify([
      { group: "채소", items: ["콩나물 120g"] },
      { group: "달걀", items: ["계란 3개"] },
    ]),
  }],
  storedRows: [{ variantName: "버섯콩나물밥", ingredientName: "느타리버섯" }],
});

const urgent = pantrySelectionSignal({
  item: { baseName: "콩나물밥", variantName: "버섯콩나물밥" },
  date: "2026-09-20",
  pantryItems: [{ name: "느타리버섯", quantity: 200, expiresAt: Date.parse("2026-09-22T00:00:00+09:00") }],
  recipeIngredientIndex: index,
});
assert.deepEqual(urgent.urgentMatches, ["느타리버섯"]);
assert.equal(urgent.matches[0].source, "recipe");
assert.ok(urgent.boost >= 5, "실제 레시피의 임박 재료는 강한 우선순위를 가져야 한다.");

const alias = pantrySelectionSignal({
  item: { baseName: "콩나물밥", variantName: "버섯콩나물밥" },
  date: "2026-09-20",
  pantryItems: [{ name: "달걀", quantity: 3, expiresAt: Date.parse("2026-09-27T00:00:00+09:00") }],
  recipeIngredientIndex: index,
});
assert.equal(alias.matches[0].source, "recipe", "계란과 달걀은 같은 재료로 매칭한다.");

const titleFallback = pantrySelectionSignal({
  item: { baseName: "감자전", variantName: "바삭감자전" },
  date: "2026-09-20",
  pantryItems: [{ name: "감자", quantity: 2, expiresAt: null }],
  recipeIngredientIndex: index,
});
assert.equal(titleFallback.matches[0].source, "menu-name");

const noMatch = pantrySelectionSignal({
  item: { baseName: "콩나물밥", variantName: "버섯콩나물밥" },
  date: "2026-09-20",
  pantryItems: [{ name: "연어", quantity: 1, expiresAt: Date.parse("2026-09-20T00:00:00+09:00") }],
  recipeIngredientIndex: index,
});
assert.equal(noMatch.boost, 1);
assert.deepEqual(noMatch.matches, []);

console.log("pantry selection tests passed");
