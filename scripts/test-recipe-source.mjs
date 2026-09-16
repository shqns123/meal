import assert from "node:assert/strict";
import {
  isVerifiedRecipeSource,
  recipeSourceError,
} from "../lib/recipe-source.mjs";

assert.equal(
  isVerifiedRecipeSource("https://www.10000recipe.com/recipe/7042554"),
  true,
);
assert.equal(
  isVerifiedRecipeSource("https://m.10000recipe.com/recipe/7042554?seq=1"),
  true,
);
assert.equal(
  isVerifiedRecipeSource("https://www.10000recipe.com/recipe/list.html?q=제육볶음"),
  false,
);
assert.equal(
  isVerifiedRecipeSource("https://blog.naver.com/example/123"),
  false,
);
assert.match(
  recipeSourceError("https://www.10000recipe.com/recipe/list.html?q=제육볶음"),
  /individual 10000recipe recipe URL/,
);
assert.equal(
  recipeSourceError("https://www.10000recipe.com/recipe/7042554"),
  null,
);

console.log("recipe source tests passed");
