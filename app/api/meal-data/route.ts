import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const month = params.get("month") ?? "2026-09";
  const week = params.get("week") ?? "2026-08-30";
  const weekStart = new Date(`${week}T00:00:00+09:00`);
  const [mealPlans, recipes, shoppingWeek] = await Promise.all([
    prisma.mealPlan.findMany({ where: { monthKey: month }, orderBy: { date: "asc" } }),
    prisma.recipe.findMany({ where: { weekKeys: { contains: week } }, orderBy: [{ plannedDates: "asc" }, { title: "asc" }] }),
    prisma.shoppingWeek.findUnique({ where: { startDate: weekStart }, include: { items: { orderBy: [{ usePlan: "asc" }, { name: "asc" }] } } }),
  ]);

  return NextResponse.json({
    meals: mealPlans.map((meal, index) => ({
      day: Number(new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: "Asia/Seoul" }).format(meal.date)),
      main: meal.mainDish ?? "",
      sides: parseList(meal.sideDishes),
      type: meal.mealType === "DINNER" ? "저녁" : meal.mealType === "LUNCH" ? "점심" : "아침",
      color: ["bg-[#e6f3fe]", "bg-[#fff0d4]", "bg-[#ffe0db]", "bg-[#e2f3e9]"][index % 4],
      lunch: meal.lunchPlan,
      baby: meal.babyMenu,
      note: meal.cookingNote,
      changeReason: meal.changeReason,
    })),
    recipes: recipes.map((recipe, index) => ({
      id: recipe.id,
      emoji: recipe.category === "반찬" ? "🥢" : "🍲",
      color: ["bg-[#ffe0db]", "bg-[#e2f3e9]", "bg-[#fff0d4]"][index % 3],
      title: recipe.title,
      meta: `성인 ${recipe.adultServings}명 · 아기 ${recipe.childServings}명`,
      tags: [recipe.category, ...(recipe.sourceUrl ? ["블로그 참고"] : []), ...(recipe.needsReview ? ["조리 순서 보완 필요"] : [])],
      sourceUrl: recipe.sourceUrl,
      sourceTitle: recipe.sourceTitle,
      sourceAuthor: recipe.sourceAuthor,
    })),
    grocery: (shoppingWeek?.items ?? []).map((item) => ({ id: item.id, name: `${item.name} ${item.quantity}${item.unit}`, category: item.category, done: item.purchased, usePlan: item.usePlan })),
  });
}

function parseList(value: string): string[] {
  try { return JSON.parse(value); } catch { return value.split(",").map((item) => item.trim()).filter(Boolean); }
}
