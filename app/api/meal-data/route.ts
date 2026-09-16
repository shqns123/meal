import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { missingRecipeCoverage } from "@/lib/recipe-coverage.mjs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const month = params.get("month") ?? "2026-09";
  const week = params.get("week") ?? "2026-08-30";
  const weekStart = new Date(`${week}T00:00:00+09:00`);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const [mealPlans, recipes, shoppingWeek] = await Promise.all([
    prisma.mealPlan.findMany({
      where: {
        OR: [{ monthKey: month }, { date: { gte: weekStart, lt: weekEnd } }],
      },
      orderBy: { date: "asc" },
    }),
    prisma.recipe.findMany({
      where: { weekKeys: { contains: week } },
      orderBy: [{ plannedDates: "asc" }, { title: "asc" }],
      include: { ingredients: { orderBy: { name: "asc" } } },
    }),
    prisma.shoppingWeek.findUnique({
      where: { startDate: weekStart },
      include: { items: { orderBy: [{ usePlan: "asc" }, { name: "asc" }] } },
    }),
  ]);

  return NextResponse.json({
    groceryMissingRecipes: missingRecipeCoverage(mealPlans.filter(meal => meal.date >= weekStart && meal.date < weekEnd), recipes),
    meals: mealPlans.map((meal, index) => ({
      date: formatKst(meal.date),
      day: Number(
        new Intl.DateTimeFormat("en-US", {
          day: "numeric",
          timeZone: "Asia/Seoul",
        }).format(meal.date),
      ),
      main: meal.mainDish ?? "",
      soup: meal.soupDish,
      mealStyle: meal.mealStyle,
      sides: parseList(meal.sideDishes),
      type:
        meal.mealType === "DINNER"
          ? "저녁"
          : meal.mealType === "LUNCH"
            ? "점심"
            : "아침",
      color: ["bg-[#e6f3fe]", "bg-[#fff0d4]", "bg-[#ffe0db]", "bg-[#e2f3e9]"][
        index % 4
      ],
      lunch: meal.lunchPlan,
      baby: meal.babyMenu,
      note: meal.cookingNote,
      changeReason: meal.changeReason,
    })),
    recipes: recipes.map((recipe, index) => {
      const isSideDish =
        recipe.category === "반찬" || recipe.category === "부찬";
      return {
        id: recipe.id,
        color: ["bg-[#ffe0db]", "bg-[#e2f3e9]", "bg-[#fff0d4]"][index % 3],
        title: recipe.title,
        meta: `성인 ${recipe.adultServings}명 · 아기 ${recipe.childServings}명`,
        category: isSideDish ? "부찬" : "주찬",
        plannedDates: recipeDates(
          recipe.plannedDates,
          recipe.title,
          isSideDish,
          mealPlans,
          week,
        ),
        tags: [
          isSideDish ? "부찬" : "주찬",
          ...(recipe.sourceUrl ? ["레시피 원문 참고"] : []),
          ...(recipe.needsReview ? ["조리 순서 보완 필요"] : []),
        ],
        sourceUrl: recipe.sourceUrl,
        sourceTitle: recipe.sourceTitle,
        sourceAuthor: recipe.sourceAuthor,
        description: recipe.description,
        prepMinutes: recipe.prepMinutes,
        cookMinutes: recipe.cookMinutes,
        instructions: parseList(recipe.instructions),
        ingredients: recipe.ingredients.map((ingredient) => ({
          name: ingredient.name,
          amount: ingredient.amount,
          category: ingredient.category,
        })),
        babySplitStep: recipe.babySplitStep,
        storageMethod: recipe.storageMethod,
        consumeWithin: recipe.consumeWithin,
      };
    }),
    grocery: (shoppingWeek?.items ?? []).map((item) => ({
      id: item.id,
      name: `${item.name} ${item.quantity}${item.unit}`,
      category: item.category,
      done: item.purchased,
      usePlan: item.usePlan,
      useDates: shoppingUseDates(item.usePlan, week),
    })),
  });
}

function shoppingUseDates(usePlan: string, weekStart: string) {
  const start = new Date(`${weekStart}T00:00:00Z`).getTime();
  const end = start + 6 * 86_400_000;
  const startYear = Number(weekStart.slice(0, 4));
  const dates = new Set<string>();
  for (const match of usePlan.matchAll(/(?:^|\s·\s)(\d{2})-(\d{2})(?=\s)/g)) {
    for (const year of [startYear - 1, startYear, startYear + 1]) {
      const date = `${year}-${match[1]}-${match[2]}`;
      const timestamp = new Date(`${date}T00:00:00Z`).getTime();
      if (timestamp >= start && timestamp <= end) dates.add(date);
    }
  }
  return [...dates].sort();
}

function parseList(value: string): string[] {
  try {
    return JSON.parse(value);
  } catch {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function recipeDates(
  storedDates: string,
  title: string,
  isSideDish: boolean,
  mealPlans: { date: Date; mainDish: string | null; sideDishes: string }[],
  weekStart: string,
) {
  const dates = parseList(storedDates).filter((date) =>
    /^\d{4}-\d{2}-\d{2}$/.test(date),
  );
  if (dates.length) return dates.sort();
  const end =
    new Date(`${weekStart}T00:00:00+09:00`).getTime() + 7 * 86_400_000;
  return mealPlans
    .filter((meal) => {
      const timestamp = meal.date.getTime();
      return (
        timestamp >= new Date(`${weekStart}T00:00:00+09:00`).getTime() &&
        timestamp < end &&
        (isSideDish
          ? parseList(meal.sideDishes).includes(title)
          : meal.mainDish === title)
      );
    })
    .map((meal) => formatKst(meal.date));
}

function formatKst(date: Date) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
