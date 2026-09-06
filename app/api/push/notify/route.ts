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
    return NextResponse.json({ skipped: true, reason: "push-not-configured" });

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
  let claimed = 0;
  if (requestId) {
    const job = await prisma.agentJob.findFirst({
      where: { requestId },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, action: true, notifiedAt: true },
    });
    if (!job || job.status !== "COMPLETED")
      return NextResponse.json({ error: "Completed job was not found." }, { status: 404 });
    if (job.notifiedAt) return NextResponse.json({ delivered: false, duplicate: true });
    claimed = (
      await prisma.agentJob.updateMany({
        where: { id: job.id, notifiedAt: null, status: "COMPLETED" },
        data: { notifiedAt: new Date() },
      })
    ).count;
    message = `${actionLabels[job.action] ?? "AI 작업"}이 완료되었습니다.`;
  } else {
    const chat = await prisma.agentChat.findUnique({
      where: { id: chatId! },
      select: { id: true, status: true, notifiedAt: true },
    });
    if (!chat || chat.status !== "COMPLETED")
      return NextResponse.json({ error: "Completed chat was not found." }, { status: 404 });
    if (chat.notifiedAt) return NextResponse.json({ delivered: false, duplicate: true });
    claimed = (
      await prisma.agentChat.updateMany({
        where: { id: chat.id, notifiedAt: null, status: "COMPLETED" },
        data: { notifiedAt: new Date() },
      })
    ).count;
    message = "AI 답변이 도착했습니다.";
  }
  if (!claimed) return NextResponse.json({ delivered: false, duplicate: true });

  const subscriptions = await prisma.pushSubscription.findMany();
  const results = await Promise.allSettled(
    subscriptions.map((subscription) =>
      sendWebPush(subscription, {
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
  return NextResponse.json({ delivered: true, subscriptions: subscriptions.length, expired: expired.length });
}

function authorized(request: Request) {
  const expected = process.env.MEAL_APP_NOTIFY_TOKEN?.trim();
  const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}
