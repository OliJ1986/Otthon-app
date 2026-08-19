import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/db";
import { getSessionUser, sameOrigin } from "@/lib/auth";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Érvénytelen kérés." }, { status: 403 });
  const actor = await getSessionUser(request);
  if (!actor) return NextResponse.json({ error: "Bejelentkezés szükséges." }, { status: 401 });
  const payload = await request.json().catch(() => null) as {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  } | null;
  const endpoint = typeof payload?.endpoint === "string" ? payload.endpoint.slice(0, 2000) : "";
  const p256dh = typeof payload?.keys?.p256dh === "string" ? payload.keys.p256dh.slice(0, 500) : "";
  const auth = typeof payload?.keys?.auth === "string" ? payload.keys.auth.slice(0, 500) : "";
  if (!endpoint.startsWith("https://") || !p256dh || !auth) {
    return NextResponse.json({ error: "Érvénytelen értesítési feliratkozás." }, { status: 400 });
  }

  try {
    await getSql()`
      INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
      VALUES (${actor.id}, ${endpoint}, ${p256dh}, ${auth})
      ON CONFLICT (endpoint) DO UPDATE SET
        user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        updated_at = now()
    `;
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Push subscription error", error);
    return NextResponse.json({ error: "Az értesítés bekapcsolása nem sikerült." }, { status: 500 });
  }
}
