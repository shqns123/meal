const DAY = 86_400_000;

const cookingRules = [
  [/탕수육|깐풍|강정|돈까스|치킨까스/, "튀김"],
  [/닭볶음탕|찌개|국|탕|전골|백숙|개장|카레/, "끓이기"],
  [/볶음|불고기|닭갈비|마파/, "볶음"],
  [/조림|장조림/, "조림"],
  [/갈비찜|찜닭|찜/, "찜"],
  [/구이/, "굽기"],
  [/부침|(?<!전복)전$/, "부침"],
  [/무침|나물|생채/, "무침"],
  [/비빔/, "비빔"],
  [/보쌈|(?<!탕)수육/, "삶기"],
  [/국수|면|우동|파스타|칼국수|수제비|라면|만두|죽/, "끓이기"],
  [/밥|덮밥|리조또|오므라이스|김밥|떡/, "기타"],
];
const ingredientRules = [
  [/소고기|쇠고기|한우|소갈비|LA갈비|차돌|우삼겹|소불고기/, "소고기"],
  [/제육|돼지|삼겹|목살|돼지갈비|보쌈|(?<!탕)수육|돈까스|대패/, "돼지고기"],
  [/닭|찜닭|치킨/, "닭고기"],
  [/고등어|갈치|코다리|명태|동태|황태|삼치|꽁치|대구|연어|농어|방어|가자미/, "생선"],
  [/오징어|주꾸미|낙지|새우|조개|바지락|게|해물|굴|참치|명란/, "해산물"],
  [/두부|계란|달걀|순두부|마파/, "두부/계란"],
  [/국수|면|우동|파스타|칼국수|수제비|라면|만두/, "면"],
];
const flavorRules = [
  [/고추장|매콤|매운|김치|마라|불닭|매운맛/, "매콤"],
  [/간장|데리야키|불고기/, "간장"],
  [/된장|청국장/, "된장"],
  [/크림|치즈|마요|까르보/, "고소한 맛"],
];
const sourceMethodFamilies = new Map([
  ["볶음", "볶음"], ["끓이기", "끓이기"], ["부침", "부침"], ["조림", "조림"],
  ["무침", "무침"], ["비빔", "비빔"], ["찜", "찜"], ["절임", "절임"],
  ["튀김", "튀김"], ["삶기", "삶기"], ["굽기", "굽기"], ["데치기", "데치기"], ["회", "회"],
]);
const sourceIngredientPriority = [
  ["소고기", "소고기"], ["돼지고기", "돼지고기"], ["닭고기", "닭고기"],
  ["해물류", "해산물"], ["건어물류", "생선"], ["달걀/유제품", "두부/계란"],
  ["콩/견과류", "두부/계란"], ["밀가루", "면"], ["쌀", "밥"], ["곡류", "밥"],
  ["육류", "육류"], ["채소류", "채소"], ["버섯류", "채소"], ["과일류", "채소"],
];

export const COOLDOWNS = {
  variantDays: 30,
  baseStrongDays: 10,
  baseSoftDays: 14,
  similarStrongDays: 5,
  similarSoftDays: 8,
  cookingFamilyDays: 2,
  sideCookingFamilyDays: 6,
  ingredientDays: 2,
};

export function catalogSelectionRole(sourceCategory) {
  if (sourceCategory === "밑반찬") return "SIDE";
  if (sourceCategory === "국/탕" || sourceCategory === "찌개") return "SOUP";
  return "MAIN";
}

export function similarMenuGroup({ sourceCategory, baseName, variantName = "", primaryIngredient = "" }) {
  const base = String(baseName || "").replace(/\s+/g, "").trim();
  const variant = String(variantName || "").replace(/\s+/g, "").trim();
  const text = `${base} ${variant}`;
  if (sourceCategory === "밑반찬") return null;
  if (/탕수육/.test(text)) return "탕수육";
  if (base === "보쌈" || base === "수육" || /보쌈|(?<!탕)수육/.test(variant)) return "삶은 돼지고기";
  if (["갈치조림", "고등어조림", "코다리조림"].includes(base)
    || /(갈치|고등어|코다리|삼치|꽁치|가자미).*조림/.test(variant)) return "생선조림";
  if (["돼지갈비찜", "소갈비찜"].includes(base) || /갈비찜/.test(variant)) return "갈비찜";
  if (base === "닭갈비" || /닭갈비/.test(variant)) return "닭갈비";
  if (base === "마파두부" || /마파두부/.test(variant)) return "마파두부";
  if (["제육볶음", "콩나물불고기"].includes(base)
    || /제육|두루치기/.test(variant)
    || (primaryIngredient === "돼지고기" && /불고기/.test(variant))) return "돼지고기 볶음";
  if (base === "소불고기" || (base === "불고기" && primaryIngredient === "소고기")) return "소불고기";
  if (["오징어볶음", "낙지볶음", "주꾸미볶음"].includes(base)
    || /(오징어|낙지|주꾸미).*볶음/.test(variant)) return "해산물 볶음";
  if (sourceCategory === "국/탕" || sourceCategory === "찌개") {
    if (/김치찌개/.test(text)) return "김치찌개";
    if (/순두부찌개/.test(text)) return "순두부찌개";
    if (/된장찌개/.test(text)) return "된장찌개";
    if (/된장국/.test(text)) return "된장국";
    if (/미역국/.test(text)) return "미역국";
    if (/북어국|황태국/.test(text)) return "북어·황태국";
    if (/어묵국|어묵탕/.test(text)) return "어묵국·탕";
    if (/떡국|떡만두국|만두국/.test(text)) return "떡·만두국";
    if (/삼계탕|닭백숙|닭곰탕/.test(text)) return "맑은 닭국";
  }
  if (sourceCategory === "면/만두") {
    if (/까르보나라|크림파스타/.test(text)) return "크림파스타";
    if (/토마토파스타|토마토스파게티/.test(text)) return "토마토파스타";
    if (/알리오올리오|오일파스타/.test(text)) return "오일파스타";
    if (/비빔국수|비빔면|쫄면/.test(text)) return "비빔국수·면";
  }
  if (sourceCategory === "밥/죽/떡" || sourceCategory === "메인반찬") {
    if (/카레/.test(text)) return "카레";
    if (/볶음밥/.test(text)) return "볶음밥";
    if (/김밥/.test(text)) return "김밥";
    if (/떡볶이/.test(text)) return "떡볶이";
  }
  return null;
}

export function menuMetadata({ sourceCategory, baseName, variantName = "", cookingMethods = [], ingredientCategories = [] }) {
  const text = `${baseName} ${variantName}`;
  const sourceMethods = Array.isArray(cookingMethods)
    ? cookingMethods
    : JSON.parse(cookingMethods || "[]");
  const variantCooking = cookingRules.find(([pattern]) => pattern.test(variantName))?.[1];
  const baseCooking = cookingRules.find(([pattern]) => pattern.test(baseName))?.[1];
  const cookingFamily = sourceMethods.length === 1
    ? sourceMethodFamilies.get(sourceMethods[0]) ?? variantCooking ?? baseCooking ?? "기타"
    : variantCooking ?? baseCooking ?? sourceMethods.map((method) => sourceMethodFamilies.get(method)).find(Boolean)
      ?? (["국/탕", "찌개"].includes(sourceCategory) ? "끓이기" : "기타");
  const sourceIngredients = Array.isArray(ingredientCategories)
    ? ingredientCategories
    : JSON.parse(ingredientCategories || "[]");
  const variantIngredient = ingredientRules.find(([pattern]) => pattern.test(variantName))?.[1];
  const baseIngredient = ingredientRules.find(([pattern]) => pattern.test(baseName))?.[1];
  // 조합 필터의 기본메뉴는 여러 재료 계열에 동시에 표시될 수 있다.
  // 여러 태그 중 앞선 단백질 하나를 실제 주재료로 단정하지 않는다.
  const mealShapeIngredient = sourceCategory === "면/만두" ? "면"
    : sourceCategory === "밥/죽/떡" ? "밥" : null;
  const singleSourceIngredient = sourceIngredients.length === 1
    ? sourceIngredientPriority.find(([category]) => sourceIngredients.includes(category))?.[1]
    : null;
  const ambiguousSourceIngredient = sourceIngredients.length > 1
    ? sourceCategory === "메인반찬" && sourceIngredients.some((category) => ["소고기", "돼지고기", "닭고기", "육류"].includes(category))
      ? "육류"
      : sourceIngredients.includes("채소류") && ["국/탕", "찌개", "밑반찬"].includes(sourceCategory)
        ? "채소" : null
    : null;
  const primaryIngredient = variantIngredient
    ?? baseIngredient
    ?? mealShapeIngredient
    ?? singleSourceIngredient
    ?? ambiguousSourceIngredient
    ?? "채소";
  const mealForm = sourceCategory === "밑반찬" ? "부찬"
    : ["국/탕", "찌개"].includes(sourceCategory) ? "국물"
      : sourceCategory === "면/만두" ? "면/만두"
        : sourceCategory === "밥/죽/떡" ? "밥/한그릇" : "주찬";
  const similarGroup = similarMenuGroup({ sourceCategory, baseName, variantName, primaryIngredient });
  const flavorFamily = flavorRules.find(([pattern]) => pattern.test(text))?.[1] ?? "담백";
  return { cookingFamily, cookingMethods: sourceMethods, ingredientCategories: sourceIngredients, primaryIngredient, mealForm, similarGroup, flavorFamily, selectionRole: catalogSelectionRole(sourceCategory) };
}

export function flattenCatalog(rows) {
  return rows.map((row) => ({
    sourceCategory: row.sourceCategory,
    baseName: row.baseName,
    variantName: row.variantName,
    searchUrl: row.searchUrl,
    cookingMethods: row.cookingMethods,
    cookingMethodOrigin: row.cookingMethodOrigin,
    ingredientCategories: row.ingredientCategories,
    ingredientCategoryOrigin: row.ingredientCategoryOrigin,
    baseCookingFamily: menuMetadata({ ...row, variantName: "" }).cookingFamily,
    ...menuMetadata(row),
  }));
}

function kstMillis(value) {
  if (typeof value === "number") return value;
  return Date.parse(`${String(value).slice(0, 10)}T00:00:00+09:00`);
}
function daysAgo(today, date) {
  return Math.floor((today - kstMillis(date)) / DAY);
}
function seededRandom(seed) {
  let state = 0;
  for (const character of String(seed)) state = (state * 31 + character.charCodeAt(0)) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}
function weightedPick(values, random) {
  const total = values.reduce((sum, value) => sum + value.weight, 0);
  if (!total) return null;
  let cursor = random() * total;
  for (const value of values) {
    cursor -= value.weight;
    if (cursor <= 0) return value;
  }
  return values.at(-1) ?? null;
}

export function chooseCatalogMenu({ catalog, history = [], sourceCategories, date, seed }) {
  const today = kstMillis(date);
  const allowed = catalog.filter((item) => sourceCategories.includes(item.sourceCategory));
  const grouped = new Map();
  for (const item of allowed) {
    const key = `${item.sourceCategory}|${item.baseName}`;
    const group = grouped.get(key) ?? { ...item, baseCookingFamily: item.baseCookingFamily ?? item.cookingFamily, variants: [] };
    group.variants.push(item);
    grouped.set(key, group);
  }
  const random = seededRandom(seed ?? date);
  const ageFor = (predicate, role) => {
    const ages = history.filter((entry) => (!role || !entry.selectionRole || entry.selectionRole === role) && predicate(entry))
      .map((entry) => daysAgo(today, entry.date)).filter((age) => age >= 0);
    return ages.length ? Math.min(...ages) : Infinity;
  };
  const score = ({ relaxVariant = false, relaxBase = false, relaxSimilar = false, relaxSideFamily = false }) => {
    const scored = [...grouped.values()].flatMap((base) => {
      const role = base.selectionRole ?? catalogSelectionRole(base.sourceCategory);
      const familyAge = ageFor((entry) => entry.cookingFamily === base.baseCookingFamily, role);
      // 부찬 묶음은 유지하되 다음 묶음은 최소 6일 동안 다른 조리계열로 시작한다.
      if (role === "SIDE" && !relaxSideFamily && familyAge < COOLDOWNS.sideCookingFamilyDays) return [];
      const baseAge = ageFor((entry) => entry.baseName === base.baseName, role);
      // 동일 기본메뉴·체감 유사메뉴는 후보가 충분할 때 감점이 아니라 제외한다.
      if (!relaxBase && baseAge < COOLDOWNS.baseSoftDays) return [];
      const usable = base.variants.flatMap((variant) => {
        const variantAge = ageFor((entry) => entry.variantName === variant.variantName, role);
        if (!relaxVariant && variantAge < COOLDOWNS.variantDays) return [];
        const similarAge = variant.similarGroup ? ageFor((entry) => entry.similarGroup === variant.similarGroup, role) : Infinity;
        if (!relaxSimilar && similarAge < COOLDOWNS.similarSoftDays) return [];
        const ingredientAge = variant.primaryIngredient ? ageFor((entry) => entry.primaryIngredient === variant.primaryIngredient, role) : Infinity;
        const flavorAge = variant.flavorFamily && variant.flavorFamily !== "담백" ? ageFor((entry) => entry.flavorFamily === variant.flavorFamily, role) : Infinity;
        let weight = variantAge < COOLDOWNS.variantDays ? 0.03 : 1;
        weight *= Number.isFinite(variant.selectionBoost) ? variant.selectionBoost : 1;
        if (baseAge < COOLDOWNS.baseStrongDays) weight *= 0.05;
        else if (baseAge < COOLDOWNS.baseSoftDays) weight *= 0.25;
        if (similarAge < COOLDOWNS.similarStrongDays) weight *= 0.08;
        else if (similarAge < COOLDOWNS.similarSoftDays) weight *= 0.45;
        if (ingredientAge < COOLDOWNS.ingredientDays) weight *= 0.6;
        if (flavorAge < 2) weight *= 0.75;
        return [{ ...variant, weight }];
      });
      if (!usable.length) return [];
      const recentFamilyDates = new Set(history.filter((entry) => (!entry.selectionRole || entry.selectionRole === role)
        && entry.cookingFamily === base.baseCookingFamily && daysAgo(today, entry.date) >= 1 && daysAgo(today, entry.date) <= 2).map((entry) => entry.date));
      let cookingWeight = recentFamilyDates.size === 2 ? 0.12 : familyAge < COOLDOWNS.cookingFamilyDays ? 0.45 : 1;
      if (base.baseCookingFamily === "튀김") cookingWeight *= 0.2;
      if (role === "SIDE") {
        // 최근 묶음 전체의 계열 분포도 본다. 6일 제한을 지난 계열이라도
        // 나물→조림→볶음 순환처럼 최근에 여러 번 나온 계열은 낮은 확률만 갖는다.
        const recentSideUses = history.filter((entry) => entry.selectionRole === "SIDE"
          && daysAgo(today, entry.date) >= 0 && daysAgo(today, entry.date) <= 15
          && entry.cookingFamily === base.baseCookingFamily).length;
        cookingWeight *= 1 / (1 + recentSideUses * 1.5);
      }
      // 평균을 쓰므로 세부메뉴 개수가 늘어도 기본메뉴의 기본 확률은 늘지 않는다.
      // 사용자가 지정한 값은 100%를 현재 기본값으로 하는 상대 가중치다.
      const configuredWeight = Number.isFinite(base.selectionWeight) ? Math.max(0, base.selectionWeight) : 1;
      return [{ ...base, usable, baseWeight: usable.reduce((sum, variant) => sum + variant.weight, 0) / usable.length * configuredWeight, cookingWeight }];
    });
    const families = new Map();
    for (const base of scored) {
      const family = families.get(base.baseCookingFamily) ?? { cookingFamily: base.baseCookingFamily, bases: [], weight: base.cookingWeight };
      family.bases.push(base); families.set(base.baseCookingFamily, family);
    }
    for (const family of families.values()) family.weight *= family.bases.reduce((sum, base) => sum + base.baseWeight, 0) / family.bases.length;
    return [...families.values()];
  };
  // 세부메뉴 풀이 과도하게 잠기면 30일 제한은 낮은 가중치로 먼저 완화한다.
  // 기본메뉴·유사메뉴·부찬 계열 제한은 그대로 유지한다.
  const recentVariantRatio = allowed.length
    ? allowed.filter((item) => ageFor(
      (entry) => entry.variantName === item.variantName,
      item.selectionRole ?? catalogSelectionRole(item.sourceCategory),
    ) < COOLDOWNS.variantDays).length / allowed.length
    : 0;
  const relaxVariantForCoverage = recentVariantRatio > 0.25;
  let families = score({ relaxVariant: relaxVariantForCoverage });
  if (!families.length) families = score({ relaxVariant: relaxVariantForCoverage, relaxBase: true, relaxSimilar: true, relaxSideFamily: true });
  if (!families.length) families = score({ relaxVariant: true, relaxBase: true, relaxSimilar: true, relaxSideFamily: true });
  const selectedFamily = weightedPick(families, random);
  const selectedBase = selectedFamily && weightedPick(selectedFamily.bases.map((base) => ({ ...base, weight: base.baseWeight })), random);
  const variant = selectedBase && weightedPick(selectedBase.usable, random);
  return variant ? { ...variant, baseWeight: selectedBase.baseWeight } : null;


}
