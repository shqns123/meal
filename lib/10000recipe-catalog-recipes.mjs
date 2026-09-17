const entities = new Map([
  ["amp", "&"],
  ["quot", '"'],
  ["apos", "'"],
  ["#39", "'"],
  ["lt", "<"],
  ["gt", ">"],
  ["nbsp", " "],
]);

export function decodeHtml(value = "") {
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity) => {
    const key = entity.toLowerCase();
    if (entities.has(key)) return entities.get(key);
    if (key.startsWith("#x")) return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
    if (key.startsWith("#")) return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
    return match;
  });
}

export function plainText(value = "") {
  return decodeHtml(String(value)
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " "))
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

export function normalizeDishName(value = "") {
  return plainText(value).normalize("NFC").toLocaleLowerCase("ko-KR")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .replace(/쭈꾸미/g, "주꾸미")
    .replace(/쇠고기/g, "소고기")
    .replace(/찌게/g, "찌개")
    .replace(/자장/g, "짜장")
    .replace(/삽겹살/g, "삼겹살")
    .replace(/마늘쫑/g, "마늘종")
    .replace(/북엇국/g, "북어국")
    .replace(/뭇국/g, "무국")
    .replace(/철팬/g, "철판")
    .replace(/오지어/g, "오징어")
    .replace(/계란/g, "달걀");
}

function isSubsequence(needle, haystack) {
  let index = 0;
  for (const character of haystack) {
    if (character === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return false;
}

export function recipeTitleScore(target, candidate) {
  const wanted = normalizeDishName(target);
  const title = normalizeDishName(candidate);
  if (!wanted || !title) return 0;
  if (wanted === title) return 100;
  if (title.includes(wanted)) return 90 + Math.round((wanted.length / title.length) * 9);
  if (wanted.length >= 4 && isSubsequence(wanted, title))
    return 90 + Math.round((wanted.length / title.length) * 5);
  if (wanted.includes(title) && title.length >= Math.max(3, Math.floor(wanted.length * 0.7)))
    return 75 + Math.round((title.length / wanted.length) * 10);
  return 0;
}

export function parseSearchResults(html) {
  const results = [];
  for (const match of String(html).matchAll(/<li\s+class="[^"]*common_sp_list_li[^"]*"[^>]*>([\s\S]*?)<\/li>/gi)) {
    const block = match[1];
    const recipe = block.match(/<a\s+href="\/recipe\/(\d+)"[^>]*class="[^"]*common_sp_link[^"]*"/i)
      ?? block.match(/<a\s+class="[^"]*common_sp_link[^"]*"[^>]*href="\/recipe\/(\d+)"/i);
    const title = block.match(/<div\s+class="[^"]*common_sp_caption_tit[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const author = block.match(/<div\s+class="[^"]*common_sp_caption_rv_name[^"]*"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
    if (!recipe || !title) continue;
    results.push({
      recipeId: recipe[1],
      sourceUrl: `https://www.10000recipe.com/recipe/${recipe[1]}`,
      title: plainText(title[1]),
      author: plainText(author?.[1] ?? "").replace(/^.*?>/, "").trim(),
    });
  }
  return results.filter((item, index, all) =>
    all.findIndex((candidate) => candidate.recipeId === item.recipeId) === index);
}

function capture(html, expression) {
  return plainText(String(html).match(expression)?.[1] ?? "");
}

export function parsePrintRecipe(html, sourceUrl) {
  const value = String(html);
  const title = capture(value, /<div\s+class="title"[^>]*>([\s\S]*?)<\/div>/i)
    || capture(value, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const servingsText = capture(value, /분량\s*:\s*([\s\S]*?)<\/span>/i);
  const durationText = capture(value, /조리시간\s*:\s*([\s\S]*?)<\/span>/i);
  const difficulty = capture(value, /난이도\s*:\s*([\s\S]*?)<\/span>/i);
  const sourceAuthor = capture(value, /<span\s+class="name"[^>]*>\s*By\.\s*([\s\S]*?)<\/span>/i);
  const ingredientGroups = [];
  const ingredientPattern = /<div\s+class="best_tit"[^>]*>[\s\S]*?<b>([\s\S]*?)<\/b>[\s\S]*?<\/div>\s*<div\s+class="ready_ingre3"[^>]*>([\s\S]*?)<\/div>/gi;
  for (const match of value.matchAll(ingredientPattern)) {
    const group = plainText(match[1]).replace(/^\[|\]$/g, "").trim() || "재료";
    const items = decodeHtml(match[2])
      .split(",")
      .map((item) => plainText(item))
      .filter(Boolean);
    if (items.length) ingredientGroups.push({ group, items });
  }
  const instructions = [];
  const steps = value.match(/<div\s+class="print_step"[^>]*>[\s\S]*?<ol[^>]*>([\s\S]*?)<\/ol>/i)?.[1] ?? "";
  for (const match of steps.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
    const step = plainText(match[1]);
    if (step) instructions.push(step);
  }
  if (!title) throw new Error("개별 레시피 제목을 찾지 못했습니다.");
  if (!ingredientGroups.length) throw new Error("개별 레시피 재료를 찾지 못했습니다.");
  if (!instructions.length) throw new Error("개별 레시피 조리 순서를 찾지 못했습니다.");
  return {
    sourceUrl,
    sourceTitle: title,
    sourceAuthor,
    servingsText,
    durationText,
    difficulty,
    ingredientGroups,
    instructions,
  };
}

export function chooseRecipe(target, candidates, minimumScore = 90) {
  const ranked = candidates.map((candidate, index) => ({
    ...candidate,
    matchScore: recipeTitleScore(target, candidate.title),
    position: index + 1,
  }));
  return ranked.find((candidate) => candidate.matchScore >= minimumScore) ?? null;
}
