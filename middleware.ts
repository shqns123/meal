import { NextRequest, NextResponse } from "next/server";

const cookieName = "meal_session";
const publicPaths = new Set([
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/push/notify",
  "/push-worker.js",
  "/manifest.webmanifest",
  "/icon.svg",
]);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (publicPaths.has(pathname)) return NextResponse.next();
  const token = request.cookies.get(cookieName)?.value;
  if (token && (await isValidSession(token))) return NextResponse.next();
  if (pathname.startsWith("/api/"))
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

async function isValidSession(token: string) {
  const secret = process.env.AUTH_SECRET?.trim();
  const [encoded, signature] = token.split(".");
  if (!secret || !encoded || !signature || token.split(".").length !== 2) return false;
  const expected = await hmac(encoded, secret);
  if (!constantTimeEqual(signature, expected)) return false;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encoded))) as { exp?: number };
    return typeof payload.exp === "number" && payload.exp > Math.floor(Date.now() / 1_000);
  } catch {
    return false;
  }
}

async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function base64UrlDecode(value: string) {
  const padded = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function base64UrlEncode(value: Uint8Array) {
  let binary = "";
  value.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
