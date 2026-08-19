import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/db";
import { getSessionUser, hashPassword, normalizeUsername, sameOrigin, validPassword, validUsername } from "@/lib/auth";

const tones = ["violet", "blue", "coral", "mint", "orange", "green", "pink", "yellow"] as const;
type FamilyMemberRow = { id: number; name: string; tone: typeof tones[number]; memberType: "adult" | "child"; sortOrder: number };

function unauthorized() {
  return NextResponse.json({ error: "Nincs jogosultságod ehhez." }, { status: 403 });
}

export async function GET(request: NextRequest) {
  const actor = await getSessionUser(request);
  if (!actor) return NextResponse.json({ error: "Bejelentkezés szükséges." }, { status: 401 });
  const sql = getSql();
  const users = await sql`
    SELECT id, username, display_name AS "displayName", role
    FROM users ORDER BY role DESC, id ASC
  `;
  const members = await sql`
    SELECT id, name, tone, member_type AS "memberType", sort_order AS "sortOrder"
    FROM family_members ORDER BY sort_order ASC, id ASC
  `;
  return NextResponse.json({ users, members });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Érvénytelen kérés." }, { status: 403 });
  const actor = await getSessionUser(request);
  if (!actor) return NextResponse.json({ error: "Bejelentkezés szükséges." }, { status: 401 });
  if (actor.role !== "owner") return unauthorized();
  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!payload) return NextResponse.json({ error: "Érvénytelen kérés." }, { status: 400 });
  const sql = getSql();

  try {
    if (payload.action === "addUser") {
      const username = normalizeUsername(payload.username);
      const displayName = typeof payload.displayName === "string" ? payload.displayName.trim().slice(0, 60) : "";
      const password = typeof payload.password === "string" ? payload.password : "";
      if (!validUsername(username)) return NextResponse.json({ error: "A felhasználónév 3–30 karakteres lehet: kisbetű, szám, pont, kötőjel." }, { status: 400 });
      if (displayName.length < 2) return NextResponse.json({ error: "A név túl rövid." }, { status: 400 });
      if (!validPassword(password)) return NextResponse.json({ error: "A jelszó legalább 10 karakter legyen." }, { status: 400 });
      const passwordHash = await hashPassword(password);
      const rows = await sql`
        INSERT INTO users (username, display_name, password_hash, role)
        VALUES (${username}, ${displayName}, ${passwordHash}, 'member')
        RETURNING id, username, display_name AS "displayName", role
      `;
      await sql`
        INSERT INTO family_members (name, tone, member_type, sort_order)
        VALUES (${displayName}, 'coral', 'adult', 1)
        ON CONFLICT (name) DO NOTHING
      `;
      return NextResponse.json({ user: rows[0] }, { status: 201 });
    }

    if (payload.action === "addMember") {
      const name = typeof payload.name === "string" ? payload.name.trim().slice(0, 60) : "";
      const tone: typeof tones[number] = tones.includes(payload.tone as typeof tones[number])
        ? payload.tone as typeof tones[number]
        : "blue";
      if (name.length < 2) return NextResponse.json({ error: "A név túl rövid." }, { status: 400 });
      const orderRows = await sql`SELECT coalesce(max(sort_order), 0)::int + 1 AS next FROM family_members` as unknown as Array<{ next: number }>;
      const rows = await sql`
        INSERT INTO family_members (name, tone, member_type, sort_order)
        VALUES (${name}, ${tone}, 'child', ${orderRows[0]?.next || 1})
        RETURNING id, name, tone, member_type AS "memberType", sort_order AS "sortOrder"
      `;
      return NextResponse.json({ member: rows[0] }, { status: 201 });
    }
    return NextResponse.json({ error: "Ismeretlen művelet." }, { status: 400 });
  } catch (error) {
    const message = error instanceof Error && /unique/i.test(error.message)
      ? "Ez a felhasználónév vagy családtag már létezik."
      : "A mentés nem sikerült.";
    console.error("Family settings error", error);
    return NextResponse.json({ error: message }, { status: 409 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Érvénytelen kérés." }, { status: 403 });
  const actor = await getSessionUser(request);
  if (!actor) return NextResponse.json({ error: "Bejelentkezés szükséges." }, { status: 401 });
  if (actor.role !== "owner") return unauthorized();
  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  const id = Number(payload?.id);
  const tone = payload?.tone as typeof tones[number];
  if (payload?.action !== "updateMemberTone" || !Number.isInteger(id) || id < 1 || !tones.includes(tone)) {
    return NextResponse.json({ error: "Érvénytelen profilszín." }, { status: 400 });
  }

  try {
    const sql = getSql();
    const member = await sql.begin(async (transaction) => {
      const rows = await transaction`
        UPDATE family_members SET tone = ${tone}
        WHERE id = ${id}
        RETURNING id, name, tone, member_type AS "memberType", sort_order AS "sortOrder"
      ` as unknown as FamilyMemberRow[];
      if (!rows[0]) return null;
      await transaction`
        UPDATE family_events SET tone = ${tone}, updated_at = now()
        WHERE lower(person) = lower(${rows[0].name})
      `;
      return rows[0];
    });
    if (!member) return NextResponse.json({ error: "A családtag nem található." }, { status: 404 });
    return NextResponse.json({ member });
  } catch (error) {
    console.error("Family color update error", error);
    return NextResponse.json({ error: "A szín módosítása nem sikerült." }, { status: 500 });
  }
}
