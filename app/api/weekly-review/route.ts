import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type PantryDraft = {
  name?: string;
  quantity?: number;
  unit?: string;
  category?: string;
  expiresAt?: string | null;
};
type ReviewRequest = {
  referenceDate?: string;
  wantedFoods?: string;
  avoidFoods?: string;
  note?: string;
  pantry?: PantryDraft[];
};

function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function validDate(value?: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value ?? "") &&
    !Number.isNaN(new Date(`${value}T00:00:00Z`).valueOf())
  );
}
function sundayFor(date: string) {
  return addDays(date, -new Date(`${date}T00:00:00Z`).getUTCDay());
}
function formatKst(value: Date) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export async function GET(request: Request) {
  const referenceDate = new URL(request.url).searchParams.get("date") ?? "";
  if (!validDate(referenceDate))
    return NextResponse.json(
      { error: "date must be in YYYY-MM-DD format" },
      { status: 400 },
    );
  const weekStart = sundayFor(referenceDate);
  const start = new Date(`${weekStart}T00:00:00+09:00`);
  const end = new Date(`${addDays(weekStart, 7)}T00:00:00+09:00`);
  const father = await prisma.familyMember.findFirst({
    where: { role: "father" },
    select: { id: true },
  });
  const [review, pantry, schedules] = await Promise.all([
    prisma.weeklyReview.findUnique({ where: { weekStart: start } }),
    prisma.pantryItem.findMany({
      orderBy: [{ expiresAt: "asc" }, { name: "asc" }],
    }),
    father
      ? prisma.familySchedule.findMany({
          where: { memberId: father.id, date: { gte: start, lt: end } },
          orderBy: { date: "asc" },
        })
      : [],
  ]);
  return NextResponse.json({
    review: review
      ? {
          ...review,
          referenceDate: review.referenceDate
            ? formatKst(review.referenceDate)
            : weekStart,
        }
      : null,
    pantry: pantry.map((item) => ({
      ...item,
      expiresAt: item.expiresAt ? formatKst(item.expiresAt) : null,
    })),
    schedules: schedules.map((item) => ({
      ...item,
      date: formatKst(item.date),
    })),
  });
}

export async function POST(request: Request) {
  let body: ReviewRequest;
  try {
    body = (await request.json()) as ReviewRequest;
  } catch {
    return NextResponse.json(
      { error: "요청 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }
  if (!validDate(body.referenceDate))
    return NextResponse.json(
      { error: "referenceDate must be in YYYY-MM-DD format" },
      { status: 400 },
    );
  const referenceDate = body.referenceDate!;
  const weekStart = sundayFor(referenceDate);
  const pantry = (body.pantry ?? []).filter((item) => item.name?.trim());
  if (
    pantry.some((item) => !item.unit?.trim() || !(Number(item.quantity) >= 0))
  )
    return NextResponse.json(
      { error: "Each pantry item needs a name, quantity, and unit" },
      { status: 400 },
    );
  await prisma.$transaction(async (tx) => {
    await tx.weeklyReview.upsert({
      where: { weekStart: new Date(`${weekStart}T00:00:00+09:00`) },
      create: {
        weekStart: new Date(`${weekStart}T00:00:00+09:00`),
        referenceDate: new Date(`${referenceDate}T00:00:00+09:00`),
        wantedFoods: body.wantedFoods?.trim() || null,
        avoidFoods: body.avoidFoods?.trim() || null,
        note: body.note?.trim() || null,
      },
      update: {
        referenceDate: new Date(`${referenceDate}T00:00:00+09:00`),
        budgetRemaining: null,
        diningOutPlan: null,
        wantedFoods: body.wantedFoods?.trim() || null,
        avoidFoods: body.avoidFoods?.trim() || null,
        note: body.note?.trim() || null,
      },
    });
    for (const item of pantry)
      await tx.pantryItem.upsert({
        where: { name: item.name!.trim() },
        create: {
          name: item.name!.trim(),
          quantity: Number(item.quantity),
          unit: item.unit!.trim(),
          category: item.category?.trim() || "기타",
          expiresAt: item.expiresAt
            ? new Date(`${item.expiresAt}T00:00:00+09:00`)
            : null,
        },
        update: {
          quantity: Number(item.quantity),
          unit: item.unit!.trim(),
          category: item.category?.trim() || "기타",
          expiresAt: item.expiresAt
            ? new Date(`${item.expiresAt}T00:00:00+09:00`)
            : null,
        },
      });
    const retainedNames = pantry.map((item) => item.name!.trim());
    await tx.pantryItem.deleteMany({
      where: retainedNames.length ? { name: { notIn: retainedNames } } : {},
    });
  });
  return NextResponse.json({ success: true });
}
