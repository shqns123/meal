#!/usr/bin/env node
import assert from "node:assert/strict";
import {
  chooseRecipe,
  parsePrintRecipe,
  parseSearchResults,
  recipeTitleScore,
} from "../lib/10000recipe-catalog-recipes.mjs";

const searchHtml = `
<li class="common_sp_list_li"><div><a href="/recipe/1234567" class="common_sp_link">사진</a></div>
<div class="common_sp_caption_tit line2">쉽고 맛있는 계란감자국 끓이기</div>
<div class="common_sp_caption_rv_name"><a>테스트요리사</a></div></li>`;
const candidates = parseSearchResults(searchHtml);
assert.equal(candidates.length, 1);
assert.equal(candidates[0].recipeId, "1234567");
assert.equal(candidates[0].title, "쉽고 맛있는 계란감자국 끓이기");
assert.ok(recipeTitleScore("계란감자국", candidates[0].title) >= 90);
assert.equal(chooseRecipe("계란감자국", candidates)?.recipeId, "1234567");
assert.equal(chooseRecipe("김치찌개", candidates), null);
assert.ok(recipeTitleScore("가지무침양념장", "가지무침 입에 착착 감기는 양념장") >= 90);
assert.ok(recipeTitleScore("대패삼겹주꾸미볶음", "제철 쭈꾸미를 맛있게! 대패삼겹 쭈꾸미 볶음") >= 90);

const printHtml = `
<title>계란감자국</title><div class="title">계란감자국</div>
<span>분량 : 3인분</span><span>조리시간 : 30분 이내</span><span>난이도 : 아무나</span>
<span class="name">By.테스트요리사</span>
<div class="best_tit"><b>[재료]</b></div><div class="ready_ingre3">감자 2개 ,계란 1개</div>
<div class="best_tit"><b>[양념]</b></div><div class="ready_ingre3">국간장 1큰술</div>
<div class="print_step"><ol><li>감자를 썬다.</li><li>재료를 끓인다.</li></ol></div>`;
const recipe = parsePrintRecipe(printHtml, "https://www.10000recipe.com/recipe/1234567");
assert.equal(recipe.sourceTitle, "계란감자국");
assert.equal(recipe.sourceAuthor, "테스트요리사");
assert.deepEqual(recipe.ingredientGroups[0], { group: "재료", items: ["감자 2개", "계란 1개"] });
assert.deepEqual(recipe.instructions, ["감자를 썬다.", "재료를 끓인다."]);

console.log("10000recipe catalog recipe parser tests passed");
