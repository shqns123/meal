import assert from "node:assert/strict";
import { parseExactServings, parseCatalogIngredient, scaleCatalogRecipe } from "../lib/catalog-shopping.mjs";

assert.equal(parseExactServings("6인분"), 6);
assert.equal(parseExactServings("6인분 이상"), null);
assert.equal(parseExactServings("0인분"), null);
assert.equal(parseExactServings(""), null);
assert.deepEqual(parseCatalogIngredient("돼지고기 0.8kg"), {
  name: "돼지고기", quantity: 800, unit: "g", category: "기타",
});
assert.deepEqual(parseCatalogIngredient("간장 1/2큰술"), {
  name: "간장", quantity: 0.5, unit: "큰술", category: "기타",
});
assert.equal(parseCatalogIngredient("꽈리고추 조금"), null);
assert.equal(parseCatalogIngredient("소금 적당량"), null);

const recipe = {
  servingsText: "6인분",
  sourceUrl: "https://www.10000recipe.com/recipe/1234567",
  ingredientGroups: JSON.stringify([{ group: "재료", items: ["돼지고기 600g", "간장 90ml"] }]),
};
const scaled = scaleCatalogRecipe(recipe, 2.5, []);
assert.equal(scaled.reason, null);
assert.equal(scaled.ingredients[0].quantity, 250);
assert.equal(scaled.ingredients[1].quantity, 37.5);
assert.equal(scaleCatalogRecipe(recipe, 7.5, []).ingredients[0].quantity, 750);
assert.match(scaleCatalogRecipe({ ...recipe, servingsText: "6인분 이상" }, 2.5).ingredients[0].quantityNote, /6인분 이상/);
assert.match(scaleCatalogRecipe({ ...recipe, ingredientGroups: JSON.stringify([{ items: ["간장 조금"] }]) }, 2.5).ingredients[0].quantityNote, /원문: 조금/);
assert.match(scaleCatalogRecipe(recipe, 2.5, ["돼지고기"]).reason, /알레르기/);
assert.match(scaleCatalogRecipe({ ...recipe, sourceUrl: "https://example.com/recipe" }, 2.5).reason, /출처/);

console.log("catalog shopping tests passed");
