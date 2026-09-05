import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type ScheduleUpdate = {
  date?: string;
  isWorking?: boolean;
  eatsAtCompany?: boolean;
  isAway?: boolean;
  note?: string;
};

export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date");
  if (!isDate(date)) return NextResponse.json({ error: "A valid date is required" }, { status: 400 });
  return NextResponse.json(await loadDay(date));
}

export async function PUT(request: Request) {
  const body = await request.json() as ScheduleUpdate;
  if (!isDate(body.date)) return NextResponse.json({ error: "A valid date is required" }, { status: 400 });
  const father = await prisma.familyMember.findFirst({ where: { role: "father" } });
  if (!father) return NextResponse.json({ error: "Father profile was not found" }, { status: 404 });

  const date = toDate(body.date);
  const isWorking = Boolean(body.isWorking);
  await prisma.familySchedule.upsert({
    where: { date_memberId: { date, memberId: father.id } },
    update: { isWorking, eatsAtCompany: isWorking && Boolean(body.eatsAtCompany), isAway: Boolean(body.isAway), note: body.note?.trim() || null },
    create: { date, memberId: father.id, isWorking, eatsAtCompany: isWorking && Boolean(body.eatsAtCompany), isAway: Boolean(body.isAway), note: body.note?.trim() || null },
  });
  return NextResponse.json(await loadDay(body.date));
}

async function loadDay(dateText: string) {
  const date = toDate(dateText);
  const [meal, father] = await Promise.all([
    prisma.mealPlan.findFirst({ where: { date } }),
    prisma.familyMember.findFirst({ where: { role: "father" } }),
  ]);
  const schedule = father ? await prisma.familySchedule.findUnique({ where: { date_memberId: { date, memberId: father.id } } }) : null;
  return {
    date: dateText,
    meal: meal && { lunch: meal.lunchPlan, main: meal.mainDish, sides: parseList(meal.sideDishes), baby: meal.babyMenu, note: meal.cookingNote },
    fatherSchedule: { isWorking: schedule?.isWorking ?? false, eatsAtCompany: schedule?.eatsAtCompany ?? false, isAway: schedule?.isAway ?? false, note: schedule?.note ?? "" },
  };
}

function isDate(value: string | null | undefined): value is string { return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value)); }
function toDate(value: string) { return new Date(`${value}T00:00:00+09:00`); }
function parseList(value: string) { try { return JSON.parse(value); } catch { return value.split(",").map((item) => item.trim()).filter(Boolean); } }
