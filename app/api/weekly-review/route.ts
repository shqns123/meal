import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type PantryDraft = { name?: string; quantity?: number; unit?: string; category?: string; expiresAt?: string | null };
type ReviewRequest = { weekStart?: string; budgetRemaining?: number | null; diningOutPlan?: string; wantedFoods?: string; avoidFoods?: string; note?: string; pantry?: PantryDraft[]; fatherSaturdayWorking?: boolean; fatherSaturdayCompanyMeal?: boolean; fatherSundayWorking?: boolean; fatherSundayCompanyMeal?: boolean };

function validWeek(week?: string) { return /^\d{4}-\d{2}-\d{2}$/.test(week ?? "") && new Date(`${week}T00:00:00Z`).getUTCDay() === 0; }
function addDays(date: string, days: number) { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); }
function formatKst(value: Date) { const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value); const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value; return `${part("year")}-${part("month")}-${part("day")}`; }

export async function GET(request: Request) {
  const weekStart = new URL(request.url).searchParams.get("week") ?? "";
  if (!validWeek(weekStart)) return NextResponse.json({ error: "week must be a Sunday in YYYY-MM-DD format" }, { status: 400 });
  const start = new Date(`${weekStart}T00:00:00+09:00`);
  const end = new Date(`${addDays(weekStart, 7)}T00:00:00+09:00`);
  const father = await prisma.familyMember.findFirst({ where: { role: "father" }, select: { id: true } });
  const [review, pantry, schedules] = await Promise.all([
    prisma.weeklyReview.findUnique({ where: { weekStart: start } }),
    prisma.pantryItem.findMany({ orderBy: [{ expiresAt: "asc" }, { name: "asc" }] }),
    father ? prisma.familySchedule.findMany({ where: { memberId: father.id, date: { gte: start, lt: end } }, orderBy: { date: "asc" } }) : [],
  ]);
  return NextResponse.json({ review, pantry: pantry.map((item) => ({ ...item, expiresAt: item.expiresAt ? formatKst(item.expiresAt) : null })), schedules: schedules.map((item) => ({ ...item, date: formatKst(item.date) })) });
}

export async function POST(request: Request) {
  const body = await request.json() as ReviewRequest;
  if (!validWeek(body.weekStart)) return NextResponse.json({ error: "weekStart must be a Sunday in YYYY-MM-DD format" }, { status: 400 });
  const weekStart = body.weekStart!;
  const budgetRemaining = body.budgetRemaining === null || body.budgetRemaining === undefined ? null : Number(body.budgetRemaining);
  if (budgetRemaining !== null && (!Number.isInteger(budgetRemaining) || budgetRemaining < 0 || budgetRemaining > 10_000_000)) return NextResponse.json({ error: "budgetRemaining must be a valid non-negative amount" }, { status: 400 });
  const pantry = (body.pantry ?? []).filter((item) => item.name?.trim());
  if (pantry.some((item) => !item.unit?.trim() || !(Number(item.quantity) >= 0))) return NextResponse.json({ error: "Each pantry item needs a name, quantity, and unit" }, { status: 400 });
  const father = await prisma.familyMember.findFirst({ where: { role: "father" }, select: { id: true } });
  await prisma.$transaction(async (tx) => {
    await tx.weeklyReview.upsert({ where: { weekStart: new Date(`${weekStart}T00:00:00+09:00`) }, create: { weekStart: new Date(`${weekStart}T00:00:00+09:00`), budgetRemaining, diningOutPlan: body.diningOutPlan?.trim() || null, wantedFoods: body.wantedFoods?.trim() || null, avoidFoods: body.avoidFoods?.trim() || null, note: body.note?.trim() || null }, update: { budgetRemaining, diningOutPlan: body.diningOutPlan?.trim() || null, wantedFoods: body.wantedFoods?.trim() || null, avoidFoods: body.avoidFoods?.trim() || null, note: body.note?.trim() || null } });
    for (const item of pantry) await tx.pantryItem.upsert({ where: { name: item.name!.trim() }, create: { name: item.name!.trim(), quantity: Number(item.quantity), unit: item.unit!.trim(), category: item.category?.trim() || "기타", expiresAt: item.expiresAt ? new Date(`${item.expiresAt}T00:00:00+09:00`) : null }, update: { quantity: Number(item.quantity), unit: item.unit!.trim(), category: item.category?.trim() || "기타", expiresAt: item.expiresAt ? new Date(`${item.expiresAt}T00:00:00+09:00`) : null } });
    if (father) for (const [date, isWorking, eatsAtCompany] of [[addDays(weekStart, 0), body.fatherSundayWorking, body.fatherSundayCompanyMeal], [addDays(weekStart, 6), body.fatherSaturdayWorking, body.fatherSaturdayCompanyMeal]] as const) await tx.familySchedule.upsert({ where: { date_memberId: { date: new Date(`${date}T00:00:00+09:00`), memberId: father.id } }, create: { date: new Date(`${date}T00:00:00+09:00`), memberId: father.id, isWorking: Boolean(isWorking), eatsAtCompany: Boolean(isWorking && eatsAtCompany) }, update: { isWorking: Boolean(isWorking), eatsAtCompany: Boolean(isWorking && eatsAtCompany) } });
  });
  return NextResponse.json({ success: true });
}
