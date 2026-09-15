import { menuMetadata } from "./catalog-selection.mjs";

const SOURCE_CATEGORIES = {
  main: ["메인반찬"], soup: ["국/탕", "찌개"], side: ["밑반찬"],
  noodle: ["면/만두"], rice: ["밥/죽/떡"],
};
const ROLE_CATEGORIES = {
  main: "주찬", soup: "국/탕/찌개", side: "부찬", noodle: "한그릇", rice: "한그릇",
};
const SLOT_WEIGHTS = { main: 2, soup: 1.2, side: 0.35, noodle: 2, rice: 2 };

function title(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}
function mainSlot(style) {
  if (style === "NOODLE_DUMPLING") return "noodle";
  if (style === "RICE_PORRIDGE_TTEOK") return "rice";
  return "main";
}
function currentSlots(plan) {
  const main = mainSlot(plan.mealStyle);
  const sides = Array.isArray(plan.sides) ? plan.sides : [];
  return [
    { date: plan.date, slot: main, name: title(plan.main ?? plan.mainDish) },
    ...(title(plan.soup ?? plan.soupDish) ? [{ date: plan.date, slot: "soup", name: title(plan.soup ?? plan.soupDish) }] : []),
    ...sides.map((name) => ({ date: plan.date, slot: "side", name: title(name) })),
  ].filter((item) => item.name);
}
function lineage(item, byVariant, byBase, knownMenus, verifiedRecipes) {
  const categories = SOURCE_CATEGORIES[item.slot];
  const exact = (byVariant.get(item.name) ?? []).find((match) => categories.includes(match.sourceCategory));
  if (exact) return { type: "CATALOG_VARIANT", points: 100, metadata: exact };
  const key = `${ROLE_CATEGORIES[item.slot]}|${item.name}`;
  if (verifiedRecipes.has(key)) return { type: "VERIFIED_RECIPE", points: 92 };
  const base = (byBase.get(item.name) ?? []).find((match) => categories.includes(match.sourceCategory));
  if (base) return { type: "CATALOG_BASE", points: 60, metadata: base };
  if (knownMenus.has(key)) return { type: "HOUSEHOLD_MENU", points: 72 };
  return { type: "UNVERIFIED_MENU", points: 20, metadata: (byVariant.get(item.name) ?? [])[0] };
}

export function assessFinalMealQuality({ plans = [], catalog = [], knownMenus = new Set(), verifiedRecipes = new Set(), targetDates = null, diversityIssues = [] } = {}) {
  const byVariant = new Map();
  const byBase = new Map();
  for (const item of catalog) {
    for (const [map, key] of [[byVariant, item.variantName], [byBase, item.baseName]]) {
      const name = title(key);
      if (!name) continue;
      const list = map.get(name) ?? [];
      list.push(item);
      map.set(name, list);
    }
  }
  const targets = targetDates ? new Set(targetDates) : null;
  const slots = plans.filter((plan) => !targets || targets.has(plan.date)).flatMap(currentSlots);
  const issues = [];
  const assessed = slots.map((item) => {
    const source = lineage(item, byVariant, byBase, knownMenus, verifiedRecipes);
    const metadata = source.metadata ?? menuMetadata({
      sourceCategory: SOURCE_CATEGORIES[item.slot][0], baseName: item.name, variantName: item.name,
    });
    let points = source.points;
    if (metadata.cookingFamily === "기타" && item.slot !== "rice") points -= 8;
    if (source.type === "UNVERIFIED_MENU" && metadata.primaryIngredient === "채소" && item.slot !== "side") points -= 5;
    const soupAsMain = item.slot === "main" &&
      (["국/탕", "찌개"].includes(source.metadata?.sourceCategory)
        || /찌개|국$|전골$/.test(item.name));
    const sideAsSoup = item.slot === "side" && /찌개|국$|탕$|전골$/.test(item.name);
    if (soupAsMain || sideAsSoup) {
      points -= 35;
      issues.push({ code: "MEAL_ROLE_MISMATCH", severity: "HIGH", dates: [item.date], slot: item.slot, name: item.name,
        message: `${item.date} '${item.name}'은 ${item.slot === "main" ? "국물 메뉴를 주찬으로 단독 편성" : "국물 메뉴를 부찬으로 편성"}한 것으로 보입니다.` });
    }
    if (source.type === "UNVERIFIED_MENU")
      issues.push({ code: "UNVERIFIED_MENU", severity: "HIGH", dates: [item.date], slot: item.slot, name: item.name,
        message: `${item.date} '${item.name}'은 해당 역할의 카탈로그 세부메뉴·기존 집 메뉴·출처가 확인된 레시피 중 어디에도 없습니다.` });
    else if (source.type === "CATALOG_BASE")
      issues.push({ code: "CATALOG_BASE_ONLY", severity: "MEDIUM", dates: [item.date], slot: item.slot, name: item.name,
        message: `${item.date} '${item.name}'은 세부메뉴가 아닌 기본메뉴명입니다. 정확한 세부메뉴를 고르면 반복 점검이 더 정확해집니다.` });
    if (metadata.cookingFamily === "기타" && !["side", "rice"].includes(item.slot))
      issues.push({ code: "METHOD_UNCERTAIN", severity: "MEDIUM", dates: [item.date], slot: item.slot, name: item.name,
        message: `${item.date} '${item.name}'의 실제 조리법을 확인하지 못해 조리계열 점수의 신뢰도가 낮습니다.` });
    return { ...item, source: source.type, points: Math.max(0, points), weight: SLOT_WEIGHTS[item.slot],
      cookingFamily: metadata.cookingFamily, primaryIngredient: metadata.primaryIngredient };
  });
  const totalWeight = assessed.reduce((sum, item) => sum + item.weight, 0);
  const baseScore = totalWeight ? assessed.reduce((sum, item) => sum + item.points * item.weight, 0) / totalWeight : null;
  const diversityPenalty = Math.min(20, diversityIssues.filter((issue) => issue.severity === "HIGH").length * 8
    + diversityIssues.filter((issue) => issue.severity === "MEDIUM").length * 3);
  const score = baseScore === null ? null : Math.max(0, Math.round(baseScore - diversityPenalty));
  const mainSlots = assessed.filter((item) => item.slot === "main" || item.slot === "noodle" || item.slot === "rice");
  const catalogMainCount = mainSlots.filter((item) => item.source === "CATALOG_VARIANT").length;
  const catalogMainPercent = mainSlots.length ? Math.round(catalogMainCount / mainSlots.length * 100) : null;
  if (mainSlots.length >= 7 && score !== null && score < 72) {
    const repairDates = mainSlots.filter((item) => item.source !== "CATALOG_VARIANT" || item.points < 75).map((item) => item.date);
    issues.push({ code: "FINAL_SCORE_LOW", severity: "HIGH", dates: [...new Set(repairDates)],
      message: `최종 식단 품질 점수 ${score}/100, 주 메뉴의 카탈로그 세부메뉴 일치 ${catalogMainCount}/${mainSlots.length}개입니다. 카탈로그 밖 메뉴와 낮은 신뢰도 항목을 다시 검토해 주세요.` });
  }
  return { score, catalogMainPercent, issues, assessed,
    summary: { scoredSlots: assessed.length, mainSlots: mainSlots.length, catalogMainCount, catalogMainPercent,
      lineageCounts: assessed.reduce((counts, item) => ({ ...counts, [item.source]: (counts[item.source] ?? 0) + 1 }), {}) } };
}
