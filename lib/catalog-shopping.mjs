const units = new Set([
  "g", "kg", "ml", "L", "개", "알", "마리", "장", "팩", "봉", "모", "단", "대",
  "줄기", "쪽", "토막", "캔", "병", "통", "컵", "T", "t", "큰술", "작은술", "줌", "꼬집",
  "뿌리", "포기", "공기", "주걱", "인분", "스푼", "주먹",
]);
export const REVIEW_UNIT = "수량 확인";

export function parseExactServings(value) {
  const match = /^([1-9]\d*)인분$/u.exec(String(value ?? "").trim());
  const servings = match ? Number(match[1]) : 0;
  return servings > 0 && servings <= 100 ? servings : null;
}

export function parseCatalogIngredient(value, category = "기타") {
  const match = /^(.+?)\s+(\d+(?:\.\d+)?|\d+\/\d+)\s*([A-Za-z가-힣]+)$/u.exec(String(value ?? "").trim());
  if (!match || !units.has(match[3])) return null;
  const quantity = match[2].includes("/")
    ? match[2].split("/").map(Number).reduce((numerator, denominator) => numerator / denominator)
    : Number(match[2]);
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  const name = match[1].trim();
  if (!name || name.length > 80) return null;
  const unit = match[3] === "kg" ? "g" : match[3] === "L" ? "ml" : match[3];
  const converted = match[3] === "kg" || match[3] === "L" ? quantity * 1000 : quantity;
  return { name, quantity: converted, unit, category };
}

function reviewIngredient(value, category) {
  const raw = String(value ?? "").trim();
  if (!raw || raw.length > 120) return null;
  const split = /^(.+?)\s+(\d.*|적당량|약간|조금|소량|넉넉히|솔솔|톡톡)$/u.exec(raw);
  const name = (split?.[1] ?? raw).trim();
  if (!name || name.length > 80) return null;
  return { name, quantity: 1, unit: REVIEW_UNIT, category,
    quantityNote: split?.[2] ? `원문: ${split[2]}` : "원문에 수량 없음" };
}

export function scaleCatalogRecipe(row, targetServings, banned = []) {
  const servings = parseExactServings(row?.servingsText);
  if (!Number.isFinite(targetServings) || targetServings <= 0)
    return { ingredients: null, reason: "실제 식사 인원을 확인할 수 없습니다." };
  if (!/^https:\/\/(?:www|m)\.10000recipe\.com\/recipe\/\d+\/?$/u.test(String(row.sourceUrl ?? "")))
    return { ingredients: null, reason: "확인된 개별 레시피 출처가 없습니다." };
  let groups;
  try { groups = JSON.parse(row.ingredientGroups); } catch { groups = null; }
  if (!Array.isArray(groups) || !groups.length)
    return { ingredients: null, reason: "원문 재료 목록이 없습니다." };
  const ingredients = [];
  for (const group of groups) {
    if (!Array.isArray(group?.items))
      return { ingredients: null, reason: "원문 재료 형식이 올바르지 않습니다." };
    for (const value of group.items) {
      const ingredient = parseCatalogIngredient(value, String(group.group || "기타"))
        ?? reviewIngredient(value, String(group.group || "기타"));
      if (!ingredient)
        return { ingredients: null, reason: `재료명을 확인할 수 없습니다: ${String(value).slice(0, 80)}` };
      if (banned.some((name) => name && ingredient.name.includes(name)))
        return { ingredients: null, reason: `가족 알레르기 재료: ${ingredient.name}` };
      if (!servings) {
        ingredients.push({ ...ingredient, quantity: 1, unit: REVIEW_UNIT,
          quantityNote: `원문 ${row.servingsText || "인분 미기재"}: ${String(value).trim()}` });
      } else if (ingredient.unit === REVIEW_UNIT) {
        ingredients.push(ingredient);
      } else {
        ingredients.push({ ...ingredient, quantity: ingredient.quantity * targetServings / servings });
      }
    }
  }
  if (!ingredients.length) return { ingredients: null, reason: "원문 재료 목록이 비어 있습니다." };
  return { ingredients, reason: null };
}
