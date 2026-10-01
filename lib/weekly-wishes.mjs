export function splitWeeklyFoods(value) {
  return String(value || "").split(/[,/·\n]/).map((item) => item.trim()).filter(Boolean);
}

export function weeklyWishBoost(item, wanted) {
  return wanted.some((name) => item.variantName.includes(name) || item.baseName.includes(name)) ? 3 : 1;
}
