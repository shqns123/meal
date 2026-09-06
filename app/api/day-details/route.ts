import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type AttendanceUpdate = {
  lunchNotAtHome?: boolean;
  dinnerNotAtHome?: boolean;
};

type ScheduleUpdate = {
  date?: string;
  dinnerDiningOut?: boolean;
  father?: AttendanceUpdate;
  mother?: AttendanceUpdate;
};

export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get("date");
  if (!isDate(date))
    return NextResponse.json(
      { error: "A valid date is required" },
      { status: 400 },
    );
  return NextResponse.json(await loadDay(date));
}

export async function PUT(request: Request) {
  let body: ScheduleUpdate;
  try {
    body = (await request.json()) as ScheduleUpdate;
  } catch {
    return NextResponse.json(
      { error: "요청 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }
  if (!isDate(body.date))
    return NextResponse.json(
      { error: "A valid date is required" },
      { status: 400 },
    );
  const date = toDate(body.date);
  const [meal, family] = await Promise.all([
    prisma.mealPlan.findFirst({ where: { date } }),
    prisma.familyMember.findMany({
      where: { role: { in: ["father", "mother"] } },
    }),
  ]);
  if (!meal)
    return NextResponse.json(
      { error: "Meal plan was not found" },
      { status: 404 },
    );
  await prisma.$transaction([
    prisma.mealPlan.update({
      where: { id: meal.id },
      data: { dinnerDiningOut: Boolean(body.dinnerDiningOut) },
    }),
    ...family.map((member) => {
      const attendance = member.role === "father" ? body.father : body.mother;
      return prisma.familySchedule.upsert({
        where: { date_memberId: { date, memberId: member.id } },
        update: {
          lunchNotAtHome: Boolean(attendance?.lunchNotAtHome),
          dinnerNotAtHome: Boolean(attendance?.dinnerNotAtHome),
          isWorking: false,
          eatsAtCompany: false,
          isAway: false,
        },
        create: {
          date,
          memberId: member.id,
          lunchNotAtHome: Boolean(attendance?.lunchNotAtHome),
          dinnerNotAtHome: Boolean(attendance?.dinnerNotAtHome),
        },
      });
    }),
  ]);
  return NextResponse.json(await loadDay(body.date));
}

async function loadDay(dateText: string) {
  const date = toDate(dateText);
  const [meal, family] = await Promise.all([
    prisma.mealPlan.findFirst({ where: { date } }),
    prisma.familyMember.findMany({
      where: { role: { in: ["father", "mother"] } },
    }),
  ]);
  const schedules = await prisma.familySchedule.findMany({
    where: { date, memberId: { in: family.map((member) => member.id) } },
  });
  const attendanceFor = (role: string) => {
    const member = family.find((item) => item.role === role);
    const schedule = schedules.find((item) => item.memberId === member?.id);
    return {
      lunchNotAtHome: schedule?.lunchNotAtHome ?? false,
      dinnerNotAtHome: schedule?.dinnerNotAtHome ?? false,
    };
  };
  return {
    date: dateText,
    meal: meal && {
      lunch: meal.lunchPlan,
      main: meal.mainDish,
      sides: parseList(meal.sideDishes),
      baby: meal.babyMenu,
      note: meal.cookingNote,
      dinnerDiningOut: meal.dinnerDiningOut,
    },
    attendance: {
      father: attendanceFor("father"),
      mother: attendanceFor("mother"),
    },
  };
}

function isDate(value: string | null | undefined): value is string {
  return Boolean(
    value &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      !Number.isNaN(Date.parse(`${value}T00:00:00Z`)),
  );
}
function toDate(value: string) {
  return new Date(`${value}T00:00:00+09:00`);
}
function parseList(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
}
