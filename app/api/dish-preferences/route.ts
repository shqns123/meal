import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { CATEGORIES, dishCategory, dishName, validatePreference } from "@/lib/dish-preference-rules.mjs";

export async function GET() {
  const [dishes, recipes, meals, family] = await Promise.all([
    prisma.dish.findMany({ include: { preferences: true }, orderBy: { name: "asc" } }),
    prisma.recipe.findMany({ select: { title: true, category: true } }),
    prisma.mealPlan.findMany({ select: { mainDish: true, sideDishes: true, lunchPlan: true, babyMenu: true } }),
    prisma.familyMember.findMany({ select: { name: true, role: true } }),
  ]);
  const candidates = new Map<string, {name: string; category: string; preferences: typeof dishes[number]["preferences"]}>();
  function add(name: string | null, category: string) {
    const title = dishName(name);
    const kind = dishCategory(category);
    if (!title || ["회사 식사", "외식", "미식사", "없음"].includes(title) || !CATEGORIES.includes(kind)) return;
    const key = `${kind}|${title}`;
    if (!candidates.has(key)) candidates.set(key, { name: title, category: kind, preferences: [] });
  }
  for (const dish of dishes) candidates.set(`${dish.category}|${dish.name}`, dish);
  for (const recipe of recipes) add(recipe.title, recipe.category);
  for (const meal of meals) {
    add(meal.mainDish, "주찬"); add(meal.lunchPlan, "점심"); add(meal.babyMenu, "아기");
    let sides: unknown;
    try { sides = JSON.parse(meal.sideDishes); } catch { sides = meal.sideDishes.split(","); }
    if (Array.isArray(sides)) for (const side of sides) if (typeof side === "string") add(side, "부찬");
  }
  return NextResponse.json({ dishes: [...candidates.values()].sort((a,b) => a.name.localeCompare(b.name, "ko")), family });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!Array.isArray(body?.updates) || !body.updates.length || body.updates.length > 200) throw new Error("저장할 메뉴를 1~200개 선택해 주세요.");
    const updates = body.updates.map((item: unknown) => validatePreference(item));
    const family = await prisma.familyMember.findMany({ select: {role: true} });
    if (updates.some((item: {scope: string}) => item.scope !== "family" && !family.some(m => m.role === item.scope))) throw new Error("등록된 가족을 선택해 주세요.");
    const source = body.source === "day-detail" ? "day-detail" : "menu-settings";
    await prisma.$transaction(async tx => {
      for (const input of updates) {
        const dish = await tx.dish.upsert({ where: {name_category: { name: input.name, category: input.category }}, create: { name: input.name, category: input.category }, update: {} });
        const patch = { ...(input.usage !== undefined ? {usage: input.usage} : {}), ...(input.familiarity !== undefined ? {familiarity: input.familiarity} : {}), ...(input.note !== undefined ? {note: input.note} : {}), source, confirmedAt: new Date() };
        await tx.dishPreference.upsert({ where: {dishId_scope: {dishId: dish.id, scope: input.scope}}, create: {dishId: dish.id, scope: input.scope, ...patch}, update: patch });
      }
    });
    return NextResponse.json({ success: true, count: updates.length, message: `${updates.length}개 메뉴의 취향을 저장했습니다. 기존 식단은 유지하고 이후 생성·재구성부터 반영합니다.` });
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : "메뉴 취향을 저장하지 못했습니다."}, {status: 400});
  }
}
