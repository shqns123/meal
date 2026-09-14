export const CATEGORIES = ["주찬", "부찬", "점심", "아기"];
export const SCOPES = ["family", "father", "mother", "child"];
export const USAGES = ["UNKNOWN", "ALLOW", "AVOID"];
export const FAMILIARITIES = ["UNKNOWN", "FAMILIAR", "UNFAMILIAR"];
export const dishName = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
export const dishCategory = (value) => value === "반찬" ? "부찬" : value;

export function validatePreference(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("메뉴 취향 형식이 올바르지 않습니다.");
  if (typeof input.name !== "string" || !dishName(input.name) || input.name.length > 100) throw new Error("메뉴명은 1~100자로 입력해 주세요.");
  if (!CATEGORIES.includes(dishCategory(input.category))) throw new Error("메뉴 구분을 선택해 주세요.");
  if (!SCOPES.includes(input.scope)) throw new Error("적용할 가족을 선택해 주세요.");
  if (!['usage', 'familiarity', 'note'].some(key => Object.hasOwn(input, key))) throw new Error("변경할 취향을 선택해 주세요.");
  if (Object.hasOwn(input, "usage") && !USAGES.includes(input.usage)) throw new Error("식단 사용 선택이 올바르지 않습니다.");
  if (Object.hasOwn(input, "familiarity") && !FAMILIARITIES.includes(input.familiarity)) throw new Error("익숙함 선택이 올바르지 않습니다.");
  if (Object.hasOwn(input, "note") && (typeof input.note !== "string" || input.note.length > 500)) throw new Error("메모는 500자 이내로 입력해 주세요.");
  return { ...input, name: dishName(input.name), category: dishCategory(input.category) };
}

// A household exclusion wins; otherwise every person eating must be covered by
// either a household approval or their own explicit approval. Unknown is never approval.
export function effectiveUsage(preferences, roles = ["father", "mother", "child"]) {
  const relevant = preferences.filter(p => p.scope === "family" || roles.includes(p.scope));
  if (relevant.some(p => p.usage === "AVOID")) return "AVOID";
  if (relevant.some(p => p.scope === "family" && p.usage === "ALLOW")) return "ALLOW";
  return roles.length && roles.every(role => relevant.some(p => p.scope === role && p.usage === "ALLOW")) ? "ALLOW" : "UNKNOWN";
}
