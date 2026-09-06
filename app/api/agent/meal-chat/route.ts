import { createHmac, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type ChatRequest = {
  message?: string;
  conversation?: { role: "user" | "assistant"; content: string }[];
};

type ChatSource = { title?: string; url: string };

export async function POST(request: Request) {
  let body: ChatRequest;
  try {
    body = await request.json() as ChatRequest;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const message = body.message?.trim();
  if (!message) return NextResponse.json({ error: "message is required" }, { status: 400 });
  if (message.length > 2_000) return NextResponse.json({ error: "message is too long" }, { status: 400 });

  const webhookUrl = process.env.AGENT_CHAT_WEBHOOK_URL;
  const token = process.env.AGENT_CHAT_WEBHOOK_TOKEN;
  if (!webhookUrl || !token) {
    return NextResponse.json({ error: "Chat agent is not connected", message: "Hermes 채팅 연결이 아직 설정되지 않았습니다." }, { status: 503 });
  }

  const conversation = (body.conversation ?? [])
    .filter((item) => (item.role === "user" || item.role === "assistant") && typeof item.content === "string")
    .slice(-8)
    .map((item) => ({ role: item.role, content: item.content.slice(0, 4_000) }));
  const requestId = randomUUID();
  await prisma.agentChat.create({ data: { id: requestId, question: message } });
  const payload = JSON.stringify({
    task: "meal_chat",
    requestId,
    message,
    conversation,
    readOnly: true,
    requestedAt: new Date().toISOString(),
  });
  const signature = createHmac("sha256", token).update(payload).digest("hex");

  try {
    const upstream = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Webhook-Signature": signature, "X-Request-ID": randomUUID() },
      body: payload,
      signal: AbortSignal.timeout(90_000),
    });
    if (!upstream.ok) throw new Error("Agent request failed");
    return NextResponse.json({ id: requestId, pending: true }, { status: 202 });
  } catch {
    await prisma.agentChat.update({ where: { id: requestId }, data: { status: "FAILED", error: "Hermes에 연결할 수 없습니다.", completedAt: new Date() } });
    return NextResponse.json({ error: "Agent request failed", message: "Hermes에 연결할 수 없습니다." }, { status: 502 });
  }
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const chat = await prisma.agentChat.findUnique({ where: { id }, select: { status: true, answer: true, sources: true, error: true } });
  if (!chat) return NextResponse.json({ error: "Chat request was not found" }, { status: 404 });
  let sources: ChatSource[] = [];
  try {
    const parsed = JSON.parse(chat.sources ?? "[]");
    if (Array.isArray(parsed)) sources = parsed.filter((source): source is ChatSource => Boolean(source) && typeof source.url === "string" && /^https?:\/\//.test(source.url));
  } catch { /* Hermes answer remains readable even if its source list is malformed. */ }
  return NextResponse.json({ status: chat.status, answer: chat.answer, sources, error: chat.error });
}
