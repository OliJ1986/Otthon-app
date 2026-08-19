import webpush from "web-push";
import { getSql } from "@/db";

type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

type PushSubscriptionRow = {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export async function sendPushToUser(userId: number, payload: PushPayload) {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.invalid";

  if (!publicKey || !privateKey) {
    console.warn("Push skipped: VAPID keys are not configured.");
    return;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  const sql = getSql();
  const subscriptions = await sql`
    SELECT id, endpoint, p256dh, auth
    FROM push_subscriptions
    WHERE user_id = ${userId}
  ` as unknown as PushSubscriptionRow[];

  const message = JSON.stringify({
    ...payload,
    url: payload.url || "/",
    tag: payload.tag || `otthon-${Date.now()}`,
  });

  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, message, { TTL: 86_400 });
    } catch (error) {
      const statusCode = typeof error === "object" && error && "statusCode" in error
        ? Number(error.statusCode)
        : undefined;
      if (statusCode === 404 || statusCode === 410) {
        await sql`DELETE FROM push_subscriptions WHERE id = ${subscription.id}`;
        return;
      }
      console.error("Push send failed", subscription.id, error);
    }
  }));
}
