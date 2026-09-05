import { createHmac, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type MealPlanRequest = {
  prompt: string;
  action?: "PUBLISH_WEEK" | "UPDATE_DAY";
  date?: string;
  weekStart?: string;
  family?: { name: string; dietaryNotes?: string }[];
  startDate?: string;
  days?: number;
};

export async function POST(request: Request) {
  const body = await request.json() as MealPlanRequest;
  if (!body.prompt?.trim()) return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  if (body.action === "UPDATE_DAY" && !/^\d{4}-\d{2}-\d{2}$/.test(body.date ?? "")) return NextResponse.json({ error: "A valid date is required for UPDATE_DAY" }, { status: 400 });
  const before = body.date ? await readMeal(body.date) : null;
  if (body.action === "UPDATE_DAY" && !before) return NextResponse.json({ error: "Meal plan was not found for the selected date" }, { status: 404 });

  const payload = {
    task: body.action === "UPDATE_DAY" ? "update_meal_day" : "publish_week_recipes",
    prompt: body.prompt,
    date: body.date,
    weekStart: body.weekStart,
    family: body.family ?? [],
    startDate: body.startDate,
    days: body.days ?? 7,
    requestedAt: new Date().toISOString(),
  };
  if (process.env.AGENT_WEBHOOK_URL) {
    if (!process.env.AGENT_WEBHOOK_TOKEN) return NextResponse.json({ error: "Agent webhook secret is not configured" }, { status: 503 });
    const serialized = JSON.stringify(payload);
    const signature = createHmac("sha256", process.env.AGENT_WEBHOOK_TOKEN).update(serialized).digest("hex");
    const upstream = await fetch(process.env.AGENT_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Signature": signature, "X-Request-ID": randomUUID() },
      body: serialized,
      signal: AbortSignal.timeout(180_000),
    });
    if (!upstream.ok) return NextResponse.json({ error: "Agent request failed" }, { status: 502 });
    const result = await upstream.json();
    const after = body.date ? await readMeal(body.date) : null;
    const changed = Boolean(before && after && JSON.stringify(before) !== JSON.stringify(after));
    const message = body.action === "UPDATE_DAY"
      ? changed ? "Hermes가 식단을 수정했습니다." : "Hermes가 검토했지만 이 날짜의 식단은 유지했습니다."
      : "Hermes가 주간 요청을 처리했습니다. 반영 결과는 레시피와 장보기 탭에서 확인하세요.";
    return NextResponse.json({ accepted: true, message, result: body.date ? { changed, before, after } : null, upstream: result });
  }

  return NextResponse.json(
    { error: "Agent is not connected", message: "Set AGENT_WEBHOOK_URL to connect Hermes or Codex." },
    { status: 503 },
  );
}

async function readMeal(date: string) {
  const meal = await prisma.mealPlan.findFirst({ where: { date: new Date(`${date}T00:00:00+09:00`) } });
  if (!meal) return null;
  return {
    date,
    lunch: meal.lunchPlan,
    main: meal.mainDish ?? "",
    sides: parseList(meal.sideDishes),
    baby: meal.babyMenu,
    note: meal.cookingNote,
    changeReason: meal.changeReason,
  };
}

function parseList(value: string): string[] {
  try { return JSON.parse(value); } catch { return value.split(",").map((item) => item.trim()).filter(Boolean); }
}
