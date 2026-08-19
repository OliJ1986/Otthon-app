import { NextRequest, NextResponse } from "next/server";
import { createSession, normalizeUsername, sameOrigin, setSessionCookie, verifyPassword } from "@/lib/auth";
import { getSql } from "@/db";

type LoginRow = { id: number; username: string; displayName: string; passwordHash: string; role: "owner" | "member" };

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Érvénytelen kérés." }, { status: 403 });
  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  const username = normalizeUsername(payload?.username);
  const password = typeof payload?.password === "string" ? payload.password : "";

  try {
    const rows = await getSql()`
      SELECT id, username, display_name AS "displayName", password_hash AS "passwordHash", role
      FROM users WHERE username = ${username} LIMIT 1
    ` as unknown as LoginRow[];
    const user = rows[0];
    const valid = user ? await verifyPassword(password, user.passwordHash) : false;
    if (!valid) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      return NextResponse.json({ error: "Hibás felhasználónév vagy jelszó." }, { status: 401 });
    }
    const session = await createSession(user.id);
    const response = NextResponse.json({ actor: { id: user.id, username: user.username, displayName: user.displayName, role: user.role } });
    setSessionCookie(response, session.token, session.expiresAt);
    return response;
  } catch (error) {
    console.error("Login error", error);
    return NextResponse.json({ error: "A belépés nem sikerült." }, { status: 500 });
  }
}
