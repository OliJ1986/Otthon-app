import postgres from "postgres";
import webpush from "web-push";

const connectionString = process.env.DATABASE_URL;
const publicKey = process.env.VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.invalid";

if (!connectionString || !publicKey || !privateKey) {
  throw new Error("DATABASE_URL, VAPID_PUBLIC_KEY és VAPID_PRIVATE_KEY szükséges.");
}

webpush.setVapidDetails(subject, publicKey, privateKey);
const sql = postgres(connectionString, { max: 2, idle_timeout: 5, connect_timeout: 15, prepare: false });

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function budapestDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Budapest",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

function addDays(dateIso, days) {
  const date = new Date(`${dateIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

function nextMonth(dateIso) {
  const [year, month, day] = dateIso.split("-").map(Number);
  const target = new Date(Date.UTC(year, month, 1, 12));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return isoDate(target);
}

function timeZoneOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return represented - date.getTime();
}

function budapestDateTime(dateIso, time) {
  const [year, month, day] = dateIso.split("-").map(Number);
  const [hour, minute] = time.slice(0, 5).split(":").map(Number);
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const first = new Date(guess.getTime() - timeZoneOffsetMs(guess, "Europe/Budapest"));
  return new Date(guess.getTime() - timeZoneOffsetMs(first, "Europe/Budapest"));
}

function occurrences(event, fromDate, toDate) {
  const result = [];
  let cursor = event.date;
  let guard = 0;
  while (cursor <= toDate && guard < 800) {
    if (cursor >= fromDate) result.push(cursor);
    if (event.repeatRule === "none") break;
    cursor = event.repeatRule === "daily" ? addDays(cursor, 1)
      : event.repeatRule === "weekly" ? addDays(cursor, 7)
        : nextMonth(cursor);
    guard += 1;
  }
  return result;
}

async function main() {
  const now = new Date();
  const windowEnd = new Date(now.getTime() + 5 * 60_000);
  const localToday = budapestDate(now);
  const fromDate = addDays(localToday, -1);
  const toDate = addDays(localToday, 3);
  const events = await sql`
    SELECT id, date::text AS date, start_time::text AS "startTime", title, person, place,
      repeat_rule AS "repeatRule", reminder_minutes AS "reminderMinutes"
    FROM family_events
    WHERE reminder_enabled = true AND date <= ${toDate}
  `;
  const subscriptions = await sql`SELECT id, endpoint, p256dh, auth FROM push_subscriptions`;
  if (!subscriptions.length) return;

  for (const event of events) {
    for (const occurrence of occurrences(event, fromDate, toDate)) {
      const startsAt = budapestDateTime(occurrence, event.startTime);
      const notifyAt = new Date(startsAt.getTime() - Number(event.reminderMinutes) * 60_000);
      if (notifyAt < new Date(now.getTime() - 150_000) || notifyAt >= windowEnd) continue;
      const notificationKey = `event:${event.id}:${occurrence}:${event.reminderMinutes}`;
      const inserted = await sql`
        INSERT INTO notification_log (notification_key)
        VALUES (${notificationKey})
        ON CONFLICT (notification_key) DO NOTHING
        RETURNING id
      `;
      if (!inserted.length) continue;

      const payload = JSON.stringify({
        title: event.person && event.person !== "Család" ? `${event.person} · ${event.title}` : event.title,
        body: `${occurrence === localToday ? "Ma" : "Holnap"} ${event.startTime.slice(0, 5)}${event.place ? ` · ${event.place}` : ""}`,
        url: "/",
        tag: notificationKey,
      });
      await Promise.all(subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification({
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          }, payload, { TTL: 86_400 });
        } catch (error) {
          if (error?.statusCode === 404 || error?.statusCode === 410) {
            await sql`DELETE FROM push_subscriptions WHERE id = ${subscription.id}`;
            return;
          }
          console.error("Push send failed", subscription.id, error);
        }
      }));
    }
  }
}

try {
  await main();
} finally {
  await sql.end({ timeout: 5 });
}
