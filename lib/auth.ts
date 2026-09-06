import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "meal_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 180;

type SessionPayload = { exp: number; nonce: string };

export function configuredCredentials() {
  const id = process.env.APP_LOGIN_ID?.trim();
  const password = process.env.APP_LOGIN_PASSWORD;
  const secret = process.env.AUTH_SECRET?.trim();
  return id && password && secret ? { id, password, secret } : null;
}

export function credentialsMatch(id: string, password: string) {
  const configured = configuredCredentials();
  if (!configured) return false;
  return safeEqual(id, configured.id) && safeEqual(password, configured.password);
}

export function createSessionToken() {
  const configured = configuredCredentials();
  if (!configured) throw new Error("Authentication is not configured.");
  const payload: SessionPayload = {
    exp: Math.floor(Date.now() / 1_000) + SESSION_MAX_AGE,
    nonce: randomUUID(),
  };
  const encoded = base64Url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded, configured.secret)}`;
}

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function base64Url(value: string) {
  return Buffer.from(value).toString("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
