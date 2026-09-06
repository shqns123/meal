import { NextResponse } from "next/server";
import { hasWebPushConfig } from "@/lib/web-push";

export const runtime = "nodejs";

export async function GET() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  if (!publicKey || !hasWebPushConfig())
    return NextResponse.json(
      { configured: false, message: "푸시 알림 설정이 아직 준비되지 않았습니다." },
      { status: 503 },
    );
  return NextResponse.json({ configured: true, publicKey });
}
