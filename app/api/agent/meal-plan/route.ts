import { createHmac, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type MealPlanRequest = {
  prompt: string;
  action?: "PUBLISH_WEEK" | "UPDATE_DAY" | "REVIEW_WEEK" | "REGENERATE_RECIPES" | "REGENERATE_GROCERY";
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

  const requestedAt = new Date();
  const payload = {
    task: body.action === "UPDATE_DAY" ? "update_meal_day"
      : body.action === "REVIEW_WEEK" ? "review_week_plan"
      : body.action === "REGENERATE_RECIPES" ? "regenerate_week_recipes"
      : body.action === "REGENERATE_GROCERY" ? "regenerate_week_grocery"
      : "publish_week_recipes",
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
    const job = body.weekStart
      ? await waitForAgentJob(body.weekStart, requestedAt)
      : null;
    const after = body.date ? await readMeal(body.date) : null;
    const changed = Boolean(before && after && JSON.stringify(before) !== JSON.stringify(after));
    if (job?.status === "FAILED") {
      return NextResponse.json({ error: "AI could not publish the meal update", message: "AI가 식단 반영에 실패했습니다. AI 실행 로그를 확인해 주세요.", upstream: result }, { status: 502 });
    }
    if (!job) {
      return NextResponse.json({ error: "Meal update was not published", message: "AI가 SQLite 게시 작업을 완료하지 않았습니다. Hermes 로그에서 요청 유형에 맞는 mealctl 명령 실행 여부를 확인해 주세요.", result: body.date ? { changed: false, before, after } : null, upstream: result }, { status: 502 });
    }
    const message = body.action === "UPDATE_DAY"
      ? changed ? "AI가 식단을 수정했습니다." : "AI가 검토했지만 이 날짜의 식단은 유지했습니다."
      : body.action === "REVIEW_WEEK" ? "AI가 다음 주 식단을 점검했습니다."
      : body.action === "REGENERATE_RECIPES" ? "AI가 선택한 주차의 레시피를 재생성했습니다. 장보기는 별도 새로고침으로 계산할 수 있습니다."
      : body.action === "REGENERATE_GROCERY" ? "AI가 준비된 레시피를 기준으로 장보기를 다시 계산했습니다."
      : "AI가 주간 요청을 처리했습니다. 반영 결과는 레시피와 장보기 탭에서 확인하세요.";
    return NextResponse.json({ accepted: true, message, result: body.date ? { changed, before, after } : null, upstream: result });
  }

  return NextResponse.json(
    { error: "Agent is not connected", message: "Set AGENT_WEBHOOK_URL to connect Hermes or Codex." },
    { status: 503 },
  );
}

async function waitForAgentJob(weekStart: string, requestedAt: Date) {
  // Browser-verified weekly recipes can take several minutes. Keep the modal request
  // alive long enough for Hermes to finish its final validate/publish transaction.
  const deadline = Date.now() + 20 * 60_000;
  const startedAfter = new Date(requestedAt.getTime() - 5_000);
  const week = new Date(`${weekStart}T00:00:00+09:00`);
  while (Date.now() < deadline) {
    const job = await prisma.agentJob.findFirst({
      where: { weekStart: week, createdAt: { gte: startedAfter } },
      orderBy: { createdAt: "desc" },
      select: { status: true },
    });
    if (job?.status === "COMPLETED" || job?.status === "FAILED") return job;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  return null;
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
