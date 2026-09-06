import webpush from "web-push";

type PushTarget = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

function vapidConfig() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

export function hasWebPushConfig() {
  return Boolean(vapidConfig());
}

export async function sendWebPush(target: PushTarget, payload: object) {
  const config = vapidConfig();
  if (!config) throw new Error("Web Push is not configured.");
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  return webpush.sendNotification(
    {
      endpoint: target.endpoint,
      keys: { p256dh: target.p256dh, auth: target.auth },
    },
    JSON.stringify(payload),
    { TTL: 60 * 60 },
  );
}
