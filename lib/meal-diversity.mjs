import { menuMetadata } from "./catalog-selection.mjs";

const DAY = 86_400_000;
const specificProteins = new Set(["돼지고기", "소고기", "닭고기", "생선", "해산물", "두부/계란"]);

function title(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
function day(value) {
  return Date.parse(`${String(value).slice(0, 10)}T00:00:00Z`);
}
function distance(later, earlier) {
  return Math.round((day(later) - day(earlier)) / DAY);
}
function sundayFor(date) {
  const value = new Date(day(date));
  value.setUTCDate(value.getUTCDate() - value.getUTCDay());
  return value.toISOString().slice(0, 10);
}
function mainCategories(style) {
  if (style === "NOODLE_DUMPLING") return ["면/만두"];
  if (style === "RICE_PORRIDGE_TTEOK") return ["밥/죽/떡"];
  return ["메인반찬"];
}

export function assessMealDiversity({ plans = [], catalog = [], previousPlans = [], activeFrom = null, targetDates = null } = {}) {
  const byVariant = new Map();
  for (const item of catalog) {
    const key = title(item.variantName);
    const matches = byVariant.get(key) ?? [];
    matches.push(item);
    byVariant.set(key, matches);
  }
  const metadata = (name, categories) => {
    const matches = byVariant.get(title(name)) ?? [];
    const item = matches.find((candidate) => categories.includes(candidate.sourceCategory));
    return item ?? {
      sourceCategory: categories[0],
      baseName: title(name),
      variantName: title(name),
      ...menuMetadata({ sourceCategory: categories[0], baseName: title(name), variantName: title(name) }),
    };
  };
  const currentDates = new Set(plans.map((plan) => String(plan.date)));
  const targets = targetDates ? new Set(targetDates) : null;
  const ordered = [...previousPlans, ...plans]
    .filter((plan) => /^\d{4}-\d{2}-\d{2}$/.test(String(plan.date ?? "")))
    .sort((left, right) => String(left.date).localeCompare(String(right.date)));
  const main = [];
  const soups = [];
  const issues = [];
  const seen = new Set();
  const add = (code, severity, dates, message) => {
    if (!dates.some((date) => currentDates.has(date) && (!activeFrom || date >= activeFrom)
      && (!targets || targets.has(date)))) return;
    const key = `${code}|${dates.join("|")}`;
    if (seen.has(key)) return;
    seen.add(key);
    issues.push({ code, severity, dates, message });
  };
  let lastSidePair = null;
  for (const plan of ordered) {
    const date = String(plan.date);
    const mainName = title(plan.main ?? plan.mainDish);
    const soupName = title(plan.soup ?? plan.soupDish);
    const sideNames = Array.isArray(plan.sides) ? plan.sides.map(title)
      : Array.isArray(plan.sideDishes) ? plan.sideDishes.map(title) : [];
    if (mainName) main.push({ date, name: mainName, style: plan.mealStyle, ...metadata(mainName, mainCategories(plan.mealStyle)) });
    if (soupName) soups.push({ date, name: soupName, ...metadata(soupName, ["국/탕", "찌개"]) });
    const allNames = [mainName, soupName, ...sideNames].filter(Boolean);
    if (new Set(allNames).size < allNames.length)
      add("SAME_DAY_DUPLICATE", "HIGH", [date], `${date} 저녁에 같은 메뉴가 주찬·국·부찬에 중복됩니다.`);
    if (currentDates.has(date) && sideNames.length === 2) {
      const pair = [...sideNames].sort().join("|");
      if (pair !== lastSidePair) {
        const sides = sideNames.map((name) => metadata(name, ["밑반찬"]));
        if (sides[0].cookingFamily === sides[1].cookingFamily && sides[0].cookingFamily !== "기타")
          add("SIDE_METHOD_PAIR", "MEDIUM", [date], `${date} 부찬 두 개가 모두 '${sides[0].cookingFamily}' 계열입니다.`);
      }
      lastSidePair = pair;
    }
  }
  for (const [index, item] of main.entries()) {
    const recent = main.slice(0, index).filter((previous) => {
      const gap = distance(item.date, previous.date);
      return gap > 0 && gap <= 5;
    });
    const similar = item.similarGroup
      ? recent.filter((previous) => previous.similarGroup === item.similarGroup).at(-1) : null;
    if (similar) {
      const gap = distance(item.date, similar.date);
      add("SIMILAR_MAIN", gap === 1 ? "HIGH" : "MEDIUM", [similar.date, item.date],
        `${similar.date} '${similar.name}' 다음 ${item.date} '${item.name}'은 체감상 같은 '${item.similarGroup}' 계열입니다.`);
    } else {
      const sameBase = recent.filter((previous) => previous.baseName === item.baseName).at(-1);
      if (sameBase && distance(item.date, sameBase.date) <= 3)
        add("SAME_BASE_MAIN", "HIGH", [sameBase.date, item.date],
          `${sameBase.date}와 ${item.date} 주찬은 세부메뉴명이 달라도 기본메뉴 '${item.baseName}'이 같습니다.`);
    }
    const three = main.slice(Math.max(0, index - 2), index + 1);
    if (three.length !== 3 || distance(three[1].date, three[0].date) !== 1
      || distance(three[2].date, three[1].date) !== 1) continue;
    if (three.every((entry) => entry.cookingFamily === item.cookingFamily) && item.cookingFamily !== "기타")
      add("COOKING_STREAK", "HIGH", three.map((entry) => entry.date),
        `${three[0].date}~${item.date} 주찬이 3일 연속 '${item.cookingFamily}' 조리계열입니다.`);
    if (specificProteins.has(item.primaryIngredient)
      && three.every((entry) => entry.primaryIngredient === item.primaryIngredient))
      add("PROTEIN_STREAK", "HIGH", three.map((entry) => entry.date),
        `${three[0].date}~${item.date} 주찬의 주재료가 3일 연속 '${item.primaryIngredient}'입니다.`);
    if (item.flavorFamily && item.flavorFamily !== "담백"
      && three.every((entry) => entry.flavorFamily === item.flavorFamily))
      add("FLAVOR_STREAK", "MEDIUM", three.map((entry) => entry.date),
        `${three[0].date}~${item.date} 주찬의 맛계열이 3일 연속 '${item.flavorFamily}'입니다.`);
  }
  for (const [index, item] of soups.entries()) {
    if (!item.similarGroup) continue;
    const previous = soups.slice(0, index).filter((entry) => entry.similarGroup === item.similarGroup
      && distance(item.date, entry.date) > 0 && distance(item.date, entry.date) <= 7).at(-1);
    if (previous)
      add("SIMILAR_SOUP", "MEDIUM", [previous.date, item.date],
        `${previous.date}와 ${item.date} 국·찌개가 같은 '${item.similarGroup}' 계열입니다.`);
  }
  const weeks = new Map();
  for (const plan of ordered) {
    const key = sundayFor(plan.date);
    const week = weeks.get(key) ?? [];
    week.push(plan);
    weeks.set(key, week);
  }
  for (const [weekStart, week] of weeks) {
    if (week.length < 5 || new Set(week.map((item) => item.date)).size !== week.length) continue;
    const weekMain = main.filter((item) => sundayFor(item.date) === weekStart);
    const countBy = (field, allowed) => {
      const counts = new Map();
      for (const item of weekMain) {
        const value = item[field];
        if (!value || allowed && !allowed(value)) continue;
        counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      return [...counts].sort((left, right) => right[1] - left[1])[0] ?? null;
    };
    const group = countBy("similarGroup");
    if (group?.[1] >= 3)
      add("WEEK_SIMILAR_GROUP", "HIGH", week.map((item) => item.date),
        `${weekStart} 주차 확인된 주찬 ${weekMain.length}개 중 '${group[0]}' 계열이 ${group[1]}번입니다.`);
    const cooking = countBy("cookingFamily", (value) => value !== "기타");
    const skewThreshold = Math.ceil(weekMain.length * 0.7);
    if (cooking?.[1] >= skewThreshold && weekMain.length >= 5)
      add("WEEK_COOKING_SKEW", "HIGH", week.map((item) => item.date),
        `${weekStart} 주차 확인된 주찬 ${weekMain.length}개 중 '${cooking[0]}' 조리계열이 ${cooking[1]}번입니다.`);
    const protein = countBy("primaryIngredient", (value) => specificProteins.has(value));
    if (protein?.[1] >= skewThreshold && weekMain.length >= 5)
      add("WEEK_PROTEIN_SKEW", "HIGH", week.map((item) => item.date),
        `${weekStart} 주차 확인된 주찬 ${weekMain.length}개 중 '${protein[0]}' 주재료가 ${protein[1]}번입니다.`);
    const styleCounts = new Map();
    for (const item of week) styleCounts.set(item.mealStyle, (styleCounts.get(item.mealStyle) ?? 0) + 1);
    const soupCount = styleCounts.get("SOUP_MEAL") ?? 0;
    const noodleCount = styleCounts.get("NOODLE_DUMPLING") ?? 0;
    if (week.length === 7 && (soupCount === 0 || soupCount > 3 || noodleCount === 0 || noodleCount > 2))
      add("WEEK_STYLE_SKEW", "MEDIUM", week.map((item) => item.date),
        `${weekStart} 주차 식사형태가 메인반찬 ${styleCounts.get("MAIN_DISH") ?? 0}일, 국물식 ${soupCount}일, 면/만두 ${noodleCount}일, 밥/죽/떡 ${styleCounts.get("RICE_PORRIDGE_TTEOK") ?? 0}일입니다.`);
  }
  return {
    issues,
    warnings: issues.map((issue) => issue.message),
    summary: {
      mainDays: main.filter((item) => currentDates.has(item.date)).length,
      distinctSimilarGroups: new Set(main.filter((item) => currentDates.has(item.date)).map((item) => item.similarGroup).filter(Boolean)).size,
      distinctCookingFamilies: new Set(main.filter((item) => currentDates.has(item.date)).map((item) => item.cookingFamily)).size,
      highIssues: issues.filter((issue) => issue.severity === "HIGH").length,
    },
  };
}
