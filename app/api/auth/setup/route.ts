import { NextRequest, NextResponse } from "next/server";
import { createSession, hashPassword, normalizeUsername, sameOrigin, setSessionCookie, validPassword, validUsername } from "@/lib/auth";
import { getSql } from "@/db";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Érvénytelen kérés." }, { status: 403 });
  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  const username = normalizeUsername(payload?.username);
  const displayName = typeof payload?.displayName === "string" ? payload.displayName.trim().slice(0, 60) : "";
  const password = typeof payload?.password === "string" ? payload.password : "";
  if (!validUsername(username)) return NextResponse.json({ error: "A felhasználónév 3–30 karakteres lehet: kisbetű, szám, pont, kötőjel." }, { status: 400 });
  if (displayName.length < 2) return NextResponse.json({ error: "A megjelenő név túl rövid." }, { status: 400 });
  if (!validPassword(password)) return NextResponse.json({ error: "A jelszó legalább 10 karakter legyen." }, { status: 400 });

  try {
    const passwordHash = await hashPassword(password);
    const sql = getSql();
    const user = await sql.begin(async (transaction) => {
      await transaction`SELECT pg_advisory_xact_lock(68420731)`;
      const countRows = await transaction`SELECT count(*)::int AS count FROM users` as unknown as Array<{ count: number }>;
      if ((countRows[0]?.count || 0) > 0) return null;
      const inserted = await transaction`
        INSERT INTO users (username, display_name, password_hash, role)
        VALUES (${username}, ${displayName}, ${passwordHash}, 'owner')
        RETURNING id, username, display_name AS "displayName", role
      ` as unknown as Array<{ id: number; username: string; displayName: string; role: "owner" }>;
      await transaction`
        INSERT INTO family_members (name, tone, member_type, sort_order)
        VALUES (${displayName}, 'violet', 'adult', 0)
        ON CONFLICT (name) DO NOTHING
      `;
      return inserted[0];
    });
    if (!user) return NextResponse.json({ error: "A családi fiók már be lett állítva." }, { status: 409 });
    const session = await createSession(user.id);
    const response = NextResponse.json({ actor: user }, { status: 201 });
    setSessionCookie(response, session.token, session.expiresAt);
    return response;
  } catch (error) {
    console.error("Setup error", error);
    return NextResponse.json({ error: "A beállítás nem sikerült." }, { status: 500 });
  }
}
