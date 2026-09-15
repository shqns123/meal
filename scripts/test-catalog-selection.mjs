import assert from "node:assert/strict";
import { chooseCatalogMenu, flattenCatalog, menuMetadata } from "../lib/catalog-selection.mjs";

const catalog = flattenCatalog([
  { sourceCategory: "메인반찬", baseName: "제육볶음", variantName: "앞다리살제육볶음", searchUrl: "https://example.test/a" },
  { sourceCategory: "메인반찬", baseName: "제육볶음", variantName: "간장제육볶음", searchUrl: "https://example.test/b" },
  { sourceCategory: "메인반찬", baseName: "닭갈비", variantName: "춘천닭갈비", searchUrl: "https://example.test/c" },
]);

const selected = chooseCatalogMenu({
  catalog,
  history: [{ date: "2026-09-14", variantName: "앞다리살제육볶음", baseName: "제육볶음", cookingFamily: "볶음", primaryIngredient: "돼지고기" }],
  sourceCategories: ["메인반찬"],
  date: "2026-09-15",
  seed: "same-variant-cooldown",
});
assert.notEqual(selected.variantName, "앞다리살제육볶음", "같은 세부 메뉴는 30일 동안 선택하지 않는다.");
assert.equal(selected.baseName, "닭갈비", "다른 기본메뉴가 있으면 14일 이내 같은 기본메뉴는 후보에서 제외한다.");

const metadata = menuMetadata({ sourceCategory: "메인반찬", baseName: "갈치조림", variantName: "무갈치조림" });
assert.equal(metadata.cookingFamily, "조림");
assert.equal(metadata.primaryIngredient, "생선");

const sourceMethodMetadata = menuMetadata({
  sourceCategory: "메인반찬", baseName: "불고기", variantName: "간장불고기", cookingMethods: ["굽기"],
});
assert.equal(sourceMethodMetadata.cookingFamily, "굽기", "만개의레시피 방법별 태그를 메뉴명 규칙보다 우선한다.");
const sourceIngredientMetadata = menuMetadata({
  sourceCategory: "메인반찬", baseName: "어묵볶음", variantName: "간장어묵볶음", ingredientCategories: ["돼지고기"],
});
assert.deepEqual(sourceIngredientMetadata.ingredientCategories, ["돼지고기"]);
assert.equal(sourceIngredientMetadata.primaryIngredient, "돼지고기", "메뉴명에서 주재료를 알 수 없고 원본 재료 태그가 하나일 때 그 태그를 사용한다.");
assert.equal(menuMetadata({ sourceCategory: "국/탕", baseName: "감자국", variantName: "참치감자국", ingredientCategories: [] }).primaryIngredient, "해산물", "세부메뉴 이름이 주재료를 명시하면 기본메뉴 재료 태그보다 우선한다.");
assert.equal(menuMetadata({ sourceCategory: "메인반찬", baseName: "불고기", variantName: "돼지불고기", ingredientCategories: ["소고기"] }).primaryIngredient, "돼지고기", "세부메뉴의 재료명이 기본메뉴 태그보다 우선한다.");
assert.equal(menuMetadata({ sourceCategory: "국/탕", baseName: "감자국", variantName: "맑은감자국", ingredientCategories: ["채소류", "달걀/유제품", "곡류", "기타"] }).primaryIngredient, "채소", "여러 기본메뉴 재료 태그 중 달걀을 주재료로 단정하지 않는다.");
assert.equal(menuMetadata({ sourceCategory: "면/만두", baseName: "까르보나라", variantName: "크림까르보나라", ingredientCategories: ["닭고기", "쌀", "밀가루"] }).primaryIngredient, "면", "여러 기본메뉴 재료 태그가 있어도 면 식사형태를 유지한다.");
assert.equal(menuMetadata({ sourceCategory: "메인반찬", baseName: "탕수육", variantName: "치킨탕수육" }).primaryIngredient, "닭고기", "탕수육을 돼지고기 수육으로 잘못 분류하지 않는다.");
assert.equal(menuMetadata({ sourceCategory: "메인반찬", baseName: "소갈비찜" }).primaryIngredient, "소고기");
assert.equal(menuMetadata({ sourceCategory: "메인반찬", baseName: "고등어조림", variantName: "감자고등어조림" }).similarGroup, "생선조림");
assert.equal(menuMetadata({ sourceCategory: "메인반찬", baseName: "갈치조림", variantName: "무갈치조림" }).similarGroup, "생선조림");
assert.equal(menuMetadata({ sourceCategory: "메인반찬", baseName: "수육", variantName: "돼지수육" }).similarGroup, "삶은 돼지고기");
assert.equal(menuMetadata({ sourceCategory: "메인반찬", baseName: "보쌈", variantName: "돼지보쌈" }).similarGroup, "삶은 돼지고기");
assert.equal(menuMetadata({ sourceCategory: "메인반찬", baseName: "소갈비찜", variantName: "LA소갈비찜" }).similarGroup, "갈비찜");
assert.equal(menuMetadata({ sourceCategory: "메인반찬", baseName: "돼지갈비찜", variantName: "간장돼지갈비찜" }).similarGroup, "갈비찜");
assert.equal(menuMetadata({ sourceCategory: "메인반찬", baseName: "제육볶음", variantName: "간장제육볶음" }).similarGroup, "돼지고기 볶음");
assert.equal(menuMetadata({ sourceCategory: "메인반찬", baseName: "불고기", variantName: "소고기고추장불고기" }).similarGroup, "소불고기", "고추장불고기 이름만으로 돼지고기 그룹에 넣지 않는다.");
assert.equal(menuMetadata({ sourceCategory: "메인반찬", baseName: "오징어볶음", variantName: "매콤오징어볶음" }).similarGroup,
  menuMetadata({ sourceCategory: "메인반찬", baseName: "낙지볶음", variantName: "낙지볶음" }).similarGroup);
assert.equal(menuMetadata({ sourceCategory: "국/탕", baseName: "어묵국", variantName: "맑은어묵국" }).similarGroup,
  menuMetadata({ sourceCategory: "국/탕", baseName: "어묵탕", variantName: "어묵탕" }).similarGroup);
assert.equal(menuMetadata({ sourceCategory: "메인반찬", baseName: "탕수육", variantName: "치킨탕수육" }).similarGroup, "탕수육", "탕수육은 삶은 돼지고기 그룹이 아니다");
assert.equal(menuMetadata({ sourceCategory: "밑반찬", baseName: "두부조림", variantName: "간장두부조림" }).similarGroup, null, "부찬 묶음의 의도된 반복을 주찬 그룹 감점에 섞지 않는다.");

const similarCatalog = flattenCatalog([
  { sourceCategory: "메인반찬", baseName: "수육", variantName: "돼지수육" },
  { sourceCategory: "메인반찬", baseName: "보쌈", variantName: "돼지보쌈" },
  { sourceCategory: "메인반찬", baseName: "닭갈비", variantName: "춘천닭갈비" },
]);
const recentBoiledPork = [{ date: "2026-09-14", ...similarCatalog[0] }];
let recentBoiledPorkPicks = 0;
let baselineBoiledPorkPicks = 0;
for (let index = 0; index < 160; index += 1) {
  const options = { catalog: similarCatalog, sourceCategories: ["메인반찬"], date: "2026-09-15", seed: `comparison-${index}` };
  if (chooseCatalogMenu({ ...options, history: recentBoiledPork }).similarGroup === "삶은 돼지고기") recentBoiledPorkPicks += 1;
  if (chooseCatalogMenu({ ...options, history: [] }).similarGroup === "삶은 돼지고기") baselineBoiledPorkPicks += 1;
}
assert.equal(recentBoiledPorkPicks, 0,
  "다른 기본메뉴가 있으면 최근 8일 이내 유사메뉴그룹은 후보에서 제외한다.");
assert.ok(chooseCatalogMenu({ catalog: similarCatalog.slice(0, 1), history: recentBoiledPork,
  sourceCategories: ["메인반찬"], date: "2026-09-15", seed: "only-candidate" }),
"후보가 한 개뿐이어도 최근 사용 메뉴를 약하게 재허용해 생성이 멈추지 않는다.");

console.log("catalog selection checks passed");

const sideCatalog = flattenCatalog([
  { sourceCategory: "밑반찬", baseName: "감자조림", variantName: "간장감자조림" },
  { sourceCategory: "밑반찬", baseName: "어묵볶음", variantName: "간장어묵볶음" },
]);
const sideChoice = chooseCatalogMenu({ catalog: sideCatalog, sourceCategories: ["밑반찬"], date: "2026-09-10", seed: "side-family", history: [{date:"2026-09-07", ...sideCatalog[0]}] });
assert.equal(sideChoice.cookingFamily, "볶음", "새 부찬 묶음은 최근 6일의 같은 조리계열을 피한다.");

const sideDistributionCatalog = flattenCatalog([
  {sourceCategory:"밑반찬",baseName:"시금치나물",variantName:"시금치나물"},
  {sourceCategory:"밑반찬",baseName:"감자조림",variantName:"감자조림"},
  {sourceCategory:"밑반찬",baseName:"어묵볶음",variantName:"어묵볶음"},
  {sourceCategory:"밑반찬",baseName:"오이무침",variantName:"오이무침"},
]);
const repeatedSideHistory = ["2026-08-28","2026-09-01","2026-09-03"].map((date) => ({date,...sideDistributionCatalog[0]}));
let repeatedFamily = 0; let freshFamily = 0;
for (let index=0; index<120; index+=1) { const item=chooseCatalogMenu({catalog:sideDistributionCatalog,history:repeatedSideHistory,sourceCategories:["밑반찬"],date:"2026-09-10",seed:`distribution-${index}`}); if (item.cookingFamily === "무침") repeatedFamily += 1; else freshFamily += 1; }
assert.ok(repeatedFamily < freshFamily, "최근 묶음에서 자주 나온 부찬 계열은 아직 안 나온 계열보다 낮은 확률이어야 한다.");

const coverageCatalog = flattenCatalog([
  {sourceCategory:"메인반찬",baseName:"A",variantName:"A1"},{sourceCategory:"메인반찬",baseName:"B",variantName:"B1"},{sourceCategory:"메인반찬",baseName:"C",variantName:"C1"},{sourceCategory:"메인반찬",baseName:"D",variantName:"D1"},
]);
assert.ok(chooseCatalogMenu({catalog:coverageCatalog,sourceCategories:["메인반찬"],date:"2026-09-10",seed:"coverage",history:[{date:"2026-09-01",...coverageCatalog[0]},{date:"2026-09-01",...coverageCatalog[1]}]}), "세부메뉴 제외 비율이 25%를 넘으면 생성이 멈추지 않고 낮은 가중치로 완화한다.");
