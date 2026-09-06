import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isRateLimited } from "@/lib/rate-limit";
import { hasWebPushConfig } from "@/lib/web-push";

type SubscriptionBody = {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
};

export async function POST(request: Request) {
  if (isRateLimited(request, "push-subscription", 10, 10 * 60_000))
    return NextResponse.json({ error: "요청이 너무 많습니다." }, { status: 429 });
  if (!hasWebPushConfig())
    return NextResponse.json({ error: "푸시 알림 설정이 준비되지 않았습니다." }, { status: 503 });

  let body: SubscriptionBody;
  try {
    body = (await request.json()) as SubscriptionBody;
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const endpoint = body.endpoint?.trim();
  const p256dh = body.keys?.p256dh?.trim();
  const auth = body.keys?.auth?.trim();
  if (!endpoint || !/^https:\/\//.test(endpoint) || !p256dh || !auth)
    return NextResponse.json({ error: "유효한 브라우저 알림 정보가 필요합니다." }, { status: 400 });
  if (endpoint.length > 2_000 || p256dh.length > 512 || auth.length > 512)
    return NextResponse.json({ error: "알림 정보가 너무 깁니다." }, { status: 400 });

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: { endpoint, p256dh, auth },
    update: { p256dh, auth },
  });
  return NextResponse.json({ subscribed: true });
}
