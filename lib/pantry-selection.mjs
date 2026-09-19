const DAY_MS = 86_400_000;

function canonicalIngredient(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/계란/g, "달걀")
    .replace(/[^\p{L}]/gu, "");
}

function ingredientName(value) {
  return String(value ?? "")
    .replace(/\s+(?:약\s*)?\d[\s\S]*$/u, "")
    .replace(/\s+(?:적당량|약간|조금|소량|한\s*꼬집)[\s\S]*$/u, "")
    .trim();
}

function addTerms(index, menuName, values) {
  const key = String(menuName ?? "").trim();
  if (!key) return;
  const terms = index.get(key) ?? new Set();
  for (const value of values) {
    const normalized = canonicalIngredient(ingredientName(value));
    if (normalized) terms.add(normalized);
  }
  index.set(key, terms);
}

export function buildRecipeIngredientIndex({ catalogRows = [], storedRows = [] } = {}) {
  const index = new Map();
  for (const row of catalogRows) {
    let groups = [];
    try {
      groups = JSON.parse(row.ingredientGroups || "[]");
    } catch {
      groups = [];
    }
    addTerms(index, row.variantName, groups.flatMap((group) => [
      group?.group,
      ...(Array.isArray(group?.items) ? group.items : []),
    ]));
  }
  const storedByTitle = new Map();
  for (const row of storedRows) {
    const values = storedByTitle.get(row.variantName) ?? [];
    values.push(row.ingredientName);
    storedByTitle.set(row.variantName, values);
  }
  for (const [title, values] of storedByTitle) addTerms(index, title, values);
  return index;
}

function ingredientMatches(pantryName, recipeTerm) {
  if (!pantryName || !recipeTerm) return false;
  if (pantryName === recipeTerm) return true;
  return Math.min(pantryName.length, recipeTerm.length) >= 2
    && (recipeTerm.includes(pantryName) || pantryName.includes(recipeTerm));
}

function daysUntilExpiry(expiresAt, targetMillis) {
  if (expiresAt === null || expiresAt === undefined || expiresAt === "") return null;
  const expiryMillis = Number(expiresAt);
  if (!Number.isFinite(expiryMillis)) return null;
  return Math.ceil((expiryMillis - targetMillis) / DAY_MS);
}

export function pantrySelectionSignal({
  item,
  date,
  pantryItems = [],
  recipeIngredientIndex = new Map(),
}) {
  const menuName = String(item?.variantName ?? "").trim();
  const titleText = canonicalIngredient(`${item?.baseName ?? ""} ${menuName}`);
  const recipeTerms = recipeIngredientIndex.get(menuName) ?? new Set();
  const targetMillis = Date.parse(`${date}T00:00:00+09:00`);
  let boost = 1;
  const matches = [];

  for (const pantry of pantryItems) {
    if (!(Number(pantry.quantity) > 0)) continue;
    const pantryName = canonicalIngredient(pantry.name);
    if (!pantryName) continue;
    const recipeMatch = [...recipeTerms].some((term) => ingredientMatches(pantryName, term));
    const titleMatch = titleText.includes(pantryName);
    if (!recipeMatch && !titleMatch) continue;

    const days = daysUntilExpiry(pantry.expiresAt, targetMillis);
    const source = recipeMatch ? "recipe" : "menu-name";
    boost += recipeMatch ? 0.8 : 0.35;
    if (days !== null) {
      if (days <= 0) boost += recipeMatch ? 5 : 2.5;
      else if (days <= 3) boost += recipeMatch ? 3.5 : 1.75;
      else if (days <= 7) boost += recipeMatch ? 1.5 : 0.75;
    }
    matches.push({
      name: String(pantry.name).trim(),
      source,
      daysUntilExpiry: days,
      urgent: days !== null && days <= 3,
    });
  }

  return {
    boost: Math.min(boost, 8),
    matches,
    urgentMatches: matches.filter((match) => match.urgent).map((match) => match.name),
  };
}
