import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isRateLimited } from "@/lib/rate-limit";
import { openRouterConfigured, queueOpenRouterTask } from "@/lib/openrouter-worker";

type ChatRequest = {
  message?: string;
  targetMonth?: string;
  conversation?: { role: "user" | "assistant"; content: string }[];
};

type ChatSource = { title?: string; url: string };

export async function POST(request: Request) {
  if (isRateLimited(request, "meal-chat", 20, 10 * 60_000))
    return NextResponse.json(
      { error: "질문이 너무 많습니다. 잠시 후 다시 시도해 주세요." },
      { status: 429 },
    );
  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 },
    );
  }

  const message = body.message?.trim();
  if (!message)
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  if (message.length > 2_000)
    return NextResponse.json({ error: "message is too long" }, { status: 400 });
  if (body.targetMonth && !/^\d{4}-(0[1-9]|1[0-2])$/.test(body.targetMonth))
    return NextResponse.json(
      { error: "선택한 월이 올바르지 않습니다." },
      { status: 400 },
    );

  if (!openRouterConfigured()) {
    return NextResponse.json(
      {
        error: "OpenRouter chat is not connected",
        message: "OpenRouter API 키와 모델 설정을 확인해 주세요.",
      },
      { status: 503 },
    );
  }

  const conversation = (body.conversation ?? [])
    .filter(
      (item) =>
        (item.role === "user" || item.role === "assistant") &&
        typeof item.content === "string",
    )
    .slice(-8)
    .map((item) => ({
      role: item.role,
      content: item.content.slice(0, 4_000),
    }));
  const requestId = randomUUID();
  await prisma.agentChat.create({ data: { id: requestId, question: message } });
  try {
    queueOpenRouterTask({
      kind: "chat",
      requestId,
      message,
      conversation,
      targetMonth: body.targetMonth ?? currentKstMonth(),
      weekStart: sundayForKst(),
    });
    return NextResponse.json({ id: requestId, pending: true }, { status: 202 });
  } catch {
    await prisma.agentChat.update({
      where: { id: requestId },
      data: {
        status: "FAILED",
        error: "OpenRouter 작업을 시작하지 못했습니다.",
        completedAt: new Date(),
      },
    });
    return NextResponse.json(
      {
        error: "OpenRouter request failed",
        message: "AI 작업을 시작하지 못했습니다. 연결 상태를 확인해 주세요.",
      },
      { status: 502 },
    );
  }
}

function currentKstMonth() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date())
    .slice(0, 7);
}

function sundayForKst() {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return date.toISOString().slice(0, 10);
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id)
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  const chat = await prisma.agentChat.findUnique({
    where: { id },
    select: {
      status: true,
      answer: true,
      sources: true,
      error: true,
      createdAt: true,
    },
  });
  if (!chat)
    return NextResponse.json(
      { error: "Chat request was not found" },
      { status: 404 },
    );
  if (
    chat.status === "RUNNING" &&
    Date.now() - chat.createdAt.getTime() > 10 * 60_000
  ) {
    const expired = await prisma.agentChat.update({
      where: { id },
      data: {
        status: "FAILED",
        error: "AI 응답 시간이 초과됐습니다.",
        completedAt: new Date(),
      },
    });
    return NextResponse.json({
      status: expired.status,
      answer: expired.answer,
      sources: [],
      error: expired.error,
    });
  }
  let sources: ChatSource[] = [];
  try {
    const parsed = JSON.parse(chat.sources ?? "[]");
    if (Array.isArray(parsed))
      sources = parsed.filter(
        (source): source is ChatSource =>
          Boolean(source) &&
          typeof source.url === "string" &&
          /^https?:\/\//.test(source.url),
      );
  } catch {
    /* Keep an otherwise useful AI answer readable if its source list is malformed. */
  }
  return NextResponse.json({
    status: chat.status,
    answer: chat.answer,
    sources,
    error: chat.error,
  });
}
