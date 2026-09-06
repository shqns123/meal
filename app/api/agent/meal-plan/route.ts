import { createHmac, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isRateLimited } from "@/lib/rate-limit";

type MealPlanRequest = {
  prompt: string;
  action?:
    | "PUBLISH_WEEK"
    | "UPDATE_DAY"
    | "REVIEW_WEEK"
    | "REGENERATE_RECIPES"
    | "REGENERATE_GROCERY";
  date?: string;
  weekStart?: string;
  family?: { name: string; dietaryNotes?: string }[];
  startDate?: string;
  days?: number;
};

const ACTION_LABELS: Record<string, string> = {
  UPDATE_DAY: "일일 식단 수정",
  REVIEW_WEEK: "주간 식단 점검",
  REGENERATE_RECIPES: "주간 레시피 재생성",
  REGENERATE_GROCERY: "주간 장보기 재생성",
  PUBLISH_WEEK: "주간 식단 게시",
  PUBLISH_RECIPES: "주간 레시피 재생성",
  REBUILD_SHOPPING: "주간 장보기 재생성",
  WEEKLY_REVIEW_MAINTAINED: "주간 식단 점검",
};

export async function POST(request: Request) {
  if (isRateLimited(request, "meal-plan", 6, 10 * 60_000))
    return NextResponse.json(
      { error: "AI 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
      { status: 429 },
    );

  let body: MealPlanRequest;
  try {
    body = (await request.json()) as MealPlanRequest;
  } catch {
    return NextResponse.json(
      { error: "요청 형식이 올바르지 않습니다." },
      { status: 400 },
    );
  }

  const validationError = validateRequest(body);
  if (validationError)
    return NextResponse.json({ error: validationError }, { status: 400 });

  const webhookUrl = process.env.AGENT_WEBHOOK_URL;
  const token = process.env.AGENT_WEBHOOK_TOKEN;
  if (!webhookUrl || !token)
    return NextResponse.json(
      {
        error: "Agent is not connected",
        message: "AI 웹훅 연결 설정을 확인해 주세요.",
      },
      { status: 503 },
    );

  const action = body.action ?? "PUBLISH_WEEK";
  const weekStart = resolveWeekStart(body)!;
  const before = body.date ? await readMeal(body.date) : null;
  if (action === "UPDATE_DAY" && !before)
    return NextResponse.json(
      { error: "선택한 날짜의 식단을 찾을 수 없습니다." },
      { status: 404 },
    );

  const requestId = randomUUID();
  await prisma.agentJob.create({
    data: {
      id: `web-${requestId}`,
      requestId,
      weekStart: dateAtKst(weekStart),
      action,
      status: "RUNNING",
    },
  });

  const payload = {
    task:
      action === "UPDATE_DAY"
        ? "update_meal_day"
        : action === "REVIEW_WEEK"
          ? "review_week_plan"
          : action === "REGENERATE_RECIPES"
            ? "regenerate_week_recipes"
            : action === "REGENERATE_GROCERY"
              ? "regenerate_week_grocery"
              : "publish_week_recipes",
    prompt: body.prompt,
    date: body.date,
    weekStart,
    family: body.family ?? [],
    startDate: body.startDate,
    days: body.days ?? 7,
    requestId,
    requestedAt: new Date().toISOString(),
  };
  const serialized = JSON.stringify(payload);
  const signature = createHmac("sha256", token)
    .update(serialized)
    .digest("hex");

  try {
    const upstream = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature,
        "X-Request-ID": requestId,
      },
      body: serialized,
      // Hermes only acknowledges the queued delivery here. Completion is
      // tracked independently through AgentJob.
      signal: AbortSignal.timeout(30_000),
    });
    if (!upstream.ok) throw new Error(`Webhook returned ${upstream.status}`);
  } catch (error) {
    await prisma.agentJob.update({
      where: { id: `web-${requestId}` },
      data: {
        status: "FAILED",
        error: "AI 웹훅에 요청을 전달하지 못했습니다.",
        completedAt: new Date(),
      },
    });
    console.error("Failed to enqueue meal-plan request", error);
    return NextResponse.json(
      {
        error: "Agent request failed",
        message: "AI에 요청을 전달하지 못했습니다. 연결 상태를 확인해 주세요.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json(
    {
      accepted: true,
      pending: true,
      requestId,
      before,
      message:
        "요청을 접수했습니다. 다른 화면으로 이동하거나 창을 닫아도 작업은 계속됩니다.",
    },
    { status: 202 },
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestId = url.searchParams.get("requestId")?.trim();
  const date = url.searchParams.get("date")?.trim();
  if (!requestId || requestId.length > 120)
    return NextResponse.json(
      { error: "유효한 작업 ID가 필요합니다." },
      { status: 400 },
    );

  let job = await prisma.agentJob.findFirst({
    where: { requestId },
    orderBy: { createdAt: "desc" },
    select: {
      status: true,
      action: true,
      summary: true,
      error: true,
      createdAt: true,
      completedAt: true,
    },
  });
  if (!job)
    return NextResponse.json(
      { error: "요청한 AI 작업을 찾을 수 없습니다." },
      { status: 404 },
    );

  if (
    job.status === "RUNNING" &&
    Date.now() - job.createdAt.getTime() > 30 * 60_000
  ) {
    await prisma.agentJob.updateMany({
      where: { requestId, status: "RUNNING" },
      data: {
        status: "FAILED",
        error: "AI 작업 시간이 30분을 초과했습니다.",
        completedAt: new Date(),
      },
    });
    job = {
      ...job,
      status: "FAILED",
      error: "AI 작업 시간이 30분을 초과했습니다.",
    };
  }

  const after =
    date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? await readMeal(date) : null;
  return NextResponse.json({
    status: job.status,
    action: job.action,
    message:
      job.status === "COMPLETED"
        ? `${ACTION_LABELS[job.action] ?? "AI 작업"}이 완료되었습니다.`
        : job.status === "FAILED"
          ? (job.error ?? "AI 작업에 실패했습니다.")
          : "AI가 요청을 처리하고 있습니다.",
    summary: parseSummary(job.summary),
    after,
    completedAt: job.completedAt,
  });
}

function validateRequest(body: MealPlanRequest) {
  if (!body.prompt?.trim()) return "요청 내용을 입력해 주세요.";
  if (body.prompt.length > 4_000)
    return "요청 내용은 4,000자 이내로 입력해 주세요.";
  if (
    body.action === "UPDATE_DAY" &&
    !/^\d{4}-\d{2}-\d{2}$/.test(body.date ?? "")
  )
    return "일일 식단 수정에는 올바른 날짜가 필요합니다.";
  const weekStart = resolveWeekStart(body);
  if (!weekStart) return "올바른 주 시작 날짜가 필요합니다.";
  return null;
}

function resolveWeekStart(body: MealPlanRequest) {
  if (body.weekStart) {
    if (!isRealDate(body.weekStart)) return null;
    const value = new Date(`${body.weekStart}T00:00:00Z`);
    return value.getUTCDay() === 0 ? body.weekStart : null;
  }
  const basis = body.date ?? body.startDate;
  return basis && isRealDate(basis) ? sundayFor(basis) : sundayFor();
}

function isRealDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}

function dateAtKst(date: string) {
  return new Date(`${date}T00:00:00+09:00`);
}

function sundayFor(date?: string) {
  const value = new Date(
    `${date ?? new Date().toISOString().slice(0, 10)}T00:00:00Z`,
  );
  value.setUTCDate(value.getUTCDate() - value.getUTCDay());
  return value.toISOString().slice(0, 10);
}

function parseSummary(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function readMeal(date: string) {
  const meal = await prisma.mealPlan.findFirst({
    where: { date: dateAtKst(date) },
  });
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
  try {
    return JSON.parse(value);
  } catch {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
}
