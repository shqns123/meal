import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasWebPushConfig, sendWebPush } from "@/lib/web-push";

type NotifyBody = { requestId?: string; chatId?: string };

const actionLabels: Record<string, string> = {
  UPDATE_DAY: "일일 식단 수정",
  REVIEW_WEEK: "주간 식단 점검",
  WEEKLY_REVIEW_MAINTAINED: "주간 식단 점검",
  REGENERATE_RECIPES: "주간 레시피 재생성",
  REGENERATE_GROCERY: "주간 장보기 재생성",
  PUBLISH_WEEK: "주간 식단 생성",
  PUBLISH_RECIPES: "주간 레시피 재생성",
  REBUILD_SHOPPING: "주간 장보기 재생성",
  PUBLISH_MONTH: "다음 달 식단 생성",
};

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!authorized(request))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasWebPushConfig())
    return NextResponse.json(
      { delivered: false, reason: "push-not-configured" },
      { status: 503 },
    );

  let body: NotifyBody;
  try {
    body = (await request.json()) as NotifyBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const requestId = body.requestId?.trim();
  const chatId = body.chatId?.trim();
  if (Boolean(requestId) === Boolean(chatId) || (requestId && requestId.length > 120) || (chatId && chatId.length > 120))
    return NextResponse.json({ error: "One valid request ID is required." }, { status: 400 });

  let message: string;
  let target: { kind: "job" | "chat"; id: string };
  if (requestId) {
    const job = await prisma.agentJob.findFirst({
      where: { requestId },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, action: true, notifiedAt: true },
    });
    if (!job || job.status !== "COMPLETED")
      return NextResponse.json({ error: "Completed job was not found." }, { status: 404 });
    if (job.notifiedAt) return NextResponse.json({ delivered: false, duplicate: true });
    target = { kind: "job", id: job.id };
    message = `${actionLabels[job.action] ?? "AI 작업"}이 완료되었습니다.`;
  } else {
    const chat = await prisma.agentChat.findUnique({
      where: { id: chatId! },
      select: { id: true, status: true, notifiedAt: true },
    });
    if (!chat || chat.status !== "COMPLETED")
      return NextResponse.json({ error: "Completed chat was not found." }, { status: 404 });
    if (chat.notifiedAt) return NextResponse.json({ delivered: false, duplicate: true });
    target = { kind: "chat", id: chat.id };
    message = "AI 답변이 도착했습니다.";
  }

  const subscriptions = await prisma.pushSubscription.findMany();
  if (!subscriptions.length)
    return NextResponse.json(
      { delivered: false, reason: "no-subscriptions" },
      { status: 503 },
    );

  const claimedAt = new Date();
  const claimed = target.kind === "job"
    ? (
        await prisma.agentJob.updateMany({
          where: { id: target.id, notifiedAt: null, status: "COMPLETED" },
          data: { notifiedAt: claimedAt },
        })
      ).count
    : (
        await prisma.agentChat.updateMany({
          where: { id: target.id, notifiedAt: null, status: "COMPLETED" },
          data: { notifiedAt: claimedAt },
        })
      ).count;
  if (!claimed) return NextResponse.json({ delivered: false, duplicate: true });

  const results = await Promise.allSettled(
    subscriptions.map((subscription) =>
      sendWithRetry(subscription, {
        title: "우리집 식탁",
        body: message,
        url: "/",
        tag: requestId ? `meal-job-${requestId}` : `meal-chat-${chatId}`,
      }),
    ),
  );
  const expired = subscriptions
    .filter((_, index) => {
      const result = results[index];
      return result.status === "rejected" && [404, 410].includes(Number((result.reason as { statusCode?: number }).statusCode));
    })
    .map((subscription) => subscription.endpoint);
  if (expired.length)
    await prisma.pushSubscription.deleteMany({ where: { endpoint: { in: expired } } });
  const delivered = results.filter((result) => result.status === "fulfilled").length;
  const failed = results.length - delivered;
  if (!delivered) {
    if (target.kind === "job")
      await prisma.agentJob.updateMany({
        where: { id: target.id, notifiedAt: claimedAt },
        data: { notifiedAt: null },
      });
    else
      await prisma.agentChat.updateMany({
        where: { id: target.id, notifiedAt: claimedAt },
        data: { notifiedAt: null },
      });
    return NextResponse.json(
      { delivered: false, subscriptions: subscriptions.length, failed, expired: expired.length },
      { status: 502 },
    );
  }
  return NextResponse.json({
    delivered: true,
    subscriptions: subscriptions.length,
    deliveredSubscriptions: delivered,
    failed,
    expired: expired.length,
  });
}

async function sendWithRetry(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: object,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await sendWebPush(subscription, payload);
    } catch (error) {
      lastError = error;
      const statusCode = Number((error as { statusCode?: number }).statusCode);
      if ([404, 410].includes(statusCode) || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 400 * 2 ** attempt));
    }
  }
  throw lastError;
}

function authorized(request: Request) {
  const expected = process.env.MEAL_APP_NOTIFY_TOKEN?.trim();
  const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}
