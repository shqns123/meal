import { NextResponse } from "next/server";
import { configuredCredentials, createSessionToken, credentialsMatch, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth";
import { isRateLimited } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (isRateLimited(request, "login", 8, 10 * 60_000))
    return NextResponse.json({ error: "로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요." }, { status: 429 });
  if (!configuredCredentials())
    return NextResponse.json({ error: "로그인 환경 변수가 설정되지 않았습니다." }, { status: 503 });
  let body: { id?: string; password?: string };
  try {
    body = (await request.json()) as { id?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const id = body.id?.trim() ?? "";
  const password = body.password ?? "";
  if (!id || !password || id.length > 120 || password.length > 500)
    return NextResponse.json({ error: "ID와 비밀번호를 확인해 주세요." }, { status: 400 });
  if (!credentialsMatch(id, password))
    return NextResponse.json({ error: "ID 또는 비밀번호가 올바르지 않습니다." }, { status: 401 });

  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.AUTH_COOKIE_SECURE === "true",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return response;
}
