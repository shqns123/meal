const recipeSourceHosts = new Set([
  "www.10000recipe.com",
  "m.10000recipe.com",
]);

export function isVerifiedRecipeSource(value) {
  try {
    const source = new URL(String(value ?? "").trim());
    return (
      source.protocol === "https:" &&
      recipeSourceHosts.has(source.hostname.toLowerCase()) &&
      /^\/recipe\/\d+\/?$/.test(source.pathname)
    );
  } catch {
    return false;
  }
}

export function recipeSourceError(value) {
  if (!String(value ?? "").trim())
    return "sourceUrl is required for 주찬 and 반찬.";
  try {
    const source = new URL(value);
    if (source.protocol !== "https:") return "sourceUrl must use https.";
    if (!recipeSourceHosts.has(source.hostname.toLowerCase()))
      return "sourceUrl must use www.10000recipe.com or m.10000recipe.com.";
    if (!/^\/recipe\/\d+\/?$/.test(source.pathname))
      return "sourceUrl must be an individual 10000recipe recipe URL (/recipe/{number}), not a search or category page.";
  } catch {
    return "sourceUrl must be a valid URL.";
  }
  return null;
}
