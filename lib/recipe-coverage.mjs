const list = value => {try {const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed : [];} catch {return [];}};
const kst = value => new Date(new Date(value).getTime() + 9 * 3_600_000).toISOString().slice(0,10);
const category = value => value === "반찬" ? "부찬" : value;

export function missingRecipeCoverage(plans, recipes) {
  const missing = [];
  for (const plan of plans) {
    const date = kst(plan.date);
    const required = plan.dinnerDiningOut ? [] : [[plan.mainDish,"주찬"], ...list(plan.sideDishes).map(name => [name,"부찬"])];
    if ([0,6].includes(new Date(`${date}T00:00:00Z`).getUTCDay()) && plan.lunchPlan && plan.lunchPlan !== "회사 식사") required.push([plan.lunchPlan,"점심"]);
    for (const [name,kind] of required) {
      if (!name) continue;
      const valid = recipes.some(recipe => recipe.title === name && category(recipe.category) === kind && list(recipe.plannedDates).includes(date) &&
        !recipe.needsReview && list(recipe.instructions).length > 0 &&
        (kind === "점심" || (recipe.sourceUrl && recipe.sourceTitle && recipe.sourceCheckedAt)) &&
        recipe.ingredients?.length > 0 && recipe.ingredients.every(item => /^([0-9]+(?:\.[0-9]+)?)\s*\S+$/u.test(String(item.amount)) && parseFloat(item.amount) > 0));
      if (!valid) missing.push(`${date} · ${name} (${kind})`);
    }
  }
  return [...new Set(missing)];
}
