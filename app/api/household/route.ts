import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/db";
import { getSessionUser, sameOrigin } from "@/lib/auth";

export const dynamic = "force-dynamic";

type RepeatRule = "none" | "daily" | "weekly" | "monthly";
type ItemType = "event" | "chore" | "shopping";
type EventRow = {
  id: number;
  date: string;
  startTime: string;
  departureTime: string | null;
  title: string;
  person: string;
  driver: string;
  place: string;
  tone: string;
  kind: string;
  repeatRule: RepeatRule;
  reminderMinutes: number;
  reminderEnabled: boolean;
};
type ChoreRow = {
  id: number;
  title: string;
  room: string;
  assignee: string;
  dueLabel: string;
  repeatRule: RepeatRule;
  done: boolean;
  completedOn: string | null;
  tone: string;
};
type ShoppingRow = {
  id: number;
  name: string;
  quantity: string;
  category: string;
  checked: boolean;
};

const tones = ["violet", "blue", "coral", "mint", "orange", "green", "pink", "yellow"];
const eventKinds = ["medical", "school", "other"];
const repeatRules: RepeatRule[] = ["none", "daily", "weekly", "monthly"];

function todayInBudapest() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Budapest",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function textValue(value: unknown, fallback = "", maxLength = 120) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) || fallback : fallback;
}

function repeatRuleValue(value: unknown): RepeatRule {
  return repeatRules.includes(value as RepeatRule) ? value as RepeatRule : "none";
}

function recurringChoreDone(completedOn: string | null, rule: RepeatRule, today: string) {
  if (!completedOn || rule === "none") return false;
  if (rule === "daily") return completedOn === today;
  if (rule === "weekly") {
    const elapsed = Date.parse(`${today}T12:00:00Z`) - Date.parse(`${completedOn}T12:00:00Z`);
    return elapsed >= 0 && elapsed < 7 * 86_400_000;
  }
  return completedOn.slice(0, 7) === today.slice(0, 7);
}

function unauthorized() {
  return NextResponse.json({ error: "Bejelentkezés szükséges." }, { status: 401 });
}

function invalid(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function serverError(error: unknown) {
  console.error("Household API error", error);
  return NextResponse.json({ error: "A művelet nem sikerült." }, { status: 500 });
}

async function payloadFrom(request: NextRequest) {
  return request.json().catch(() => null) as Promise<Record<string, unknown> | null>;
}

function normalizeEvent(row: EventRow): EventRow {
  return {
    ...row,
    startTime: row.startTime.slice(0, 5),
    departureTime: row.departureTime?.slice(0, 5) || null,
  };
}

export async function GET(request: NextRequest) {
  const actor = await getSessionUser(request);
  if (!actor) return unauthorized();
  try {
    const sql = getSql();
    const [eventRows, choreRows, shoppingRows, familyRows] = await Promise.all([
      sql`
        SELECT id, date::text AS date, start_time::text AS "startTime",
          departure_time::text AS "departureTime", title, person, driver, place,
          tone, kind, repeat_rule AS "repeatRule",
          reminder_minutes AS "reminderMinutes", reminder_enabled AS "reminderEnabled"
        FROM family_events ORDER BY date ASC, start_time ASC, id ASC
      ` as unknown as Promise<EventRow[]>,
      sql`
        SELECT id, title, room, assignee, due_label AS "dueLabel",
          repeat_rule AS "repeatRule", done, completed_on::text AS "completedOn", tone
        FROM chores ORDER BY done ASC, id DESC
      ` as unknown as Promise<ChoreRow[]>,
      sql`
        SELECT id, name, quantity, category, checked
        FROM shopping_items ORDER BY checked ASC, id DESC
      ` as unknown as Promise<ShoppingRow[]>,
      sql`
        SELECT id, name, tone, member_type AS "memberType", sort_order AS "sortOrder"
        FROM family_members ORDER BY sort_order ASC, id ASC
      ` as unknown as Promise<Array<{ id: number; name: string; tone: string; memberType: string; sortOrder: number }>>,
    ]);
    const today = todayInBudapest();
    return NextResponse.json({
      actor,
      events: eventRows.map(normalizeEvent),
      chores: choreRows.map((row) => ({
        ...row,
        recurring: row.repeatRule !== "none",
        done: row.repeatRule !== "none" ? recurringChoreDone(row.completedOn, row.repeatRule, today) : row.done,
      })),
      shopping: shoppingRows,
      familyMembers: familyRows,
      syncedAt: new Date().toISOString(),
    });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Érvénytelen kérés." }, { status: 403 });
  const actor = await getSessionUser(request);
  if (!actor) return unauthorized();
  const payload = await payloadFrom(request);
  if (!payload) return invalid("Érvénytelen kérés.");

  try {
    const sql = getSql();
    if (payload.type === "event") {
      const title = textValue(payload.title);
      const date = textValue(payload.date, "", 10);
      const startTime = textValue(payload.startTime, "", 5);
      if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(startTime)) {
        return invalid("A név, dátum és időpont kötelező.");
      }
      const tone = tones.includes(String(payload.tone)) ? String(payload.tone) : "violet";
      const kind = eventKinds.includes(String(payload.kind)) ? String(payload.kind) : "other";
      const repeatRule = repeatRuleValue(payload.repeatRule);
      const reminderMinutes = [30, 120, 1440].includes(Number(payload.reminderMinutes)) ? Number(payload.reminderMinutes) : 1440;
      const reminderEnabled = payload.reminderEnabled !== false;
      const rows = await sql`
        INSERT INTO family_events
          (date, start_time, departure_time, title, person, driver, place, tone, kind, repeat_rule,
            reminder_minutes, reminder_enabled, created_by)
        VALUES (
          ${date}, ${startTime}, ${textValue(payload.departureTime, "", 5) || null}, ${title},
          ${textValue(payload.person, "Család", 50)}, ${textValue(payload.driver, "Egyeztetésre vár", 50)},
          ${textValue(payload.place, "Helyszín nélkül", 120)}, ${tone}, ${kind}, ${repeatRule},
          ${reminderMinutes}, ${reminderEnabled}, ${actor.id}
        )
        RETURNING id, date::text AS date, start_time::text AS "startTime",
          departure_time::text AS "departureTime", title, person, driver, place,
          tone, kind, repeat_rule AS "repeatRule",
          reminder_minutes AS "reminderMinutes", reminder_enabled AS "reminderEnabled"
      ` as unknown as EventRow[];
      return NextResponse.json({ record: normalizeEvent(rows[0]) }, { status: 201 });
    }

    if (payload.type === "chore") {
      const title = textValue(payload.title);
      if (!title) return invalid("A feladat neve kötelező.");
      const repeatRule = repeatRuleValue(payload.repeatRule);
      const rows = await sql`
        INSERT INTO chores (title, room, assignee, due_label, repeat_rule, tone, created_by)
        VALUES (
          ${title}, ${textValue(payload.room, "Otthon", 50)}, ${textValue(payload.assignee, "Közös", 50)},
          ${textValue(payload.dueLabel, "Ma", 50)}, ${repeatRule}, 'mint', ${actor.id}
        )
        RETURNING id, title, room, assignee, due_label AS "dueLabel",
          repeat_rule AS "repeatRule", done, completed_on::text AS "completedOn", tone
      ` as unknown as ChoreRow[];
      return NextResponse.json({ record: { ...rows[0], recurring: repeatRule !== "none", done: false } }, { status: 201 });
    }

    if (payload.type === "shopping") {
      const name = textValue(payload.name);
      if (!name) return invalid("A termék neve kötelező.");
      const rows = await sql`
        INSERT INTO shopping_items (name, quantity, category, created_by)
        VALUES (${name}, ${textValue(payload.quantity, "1 db", 40)}, ${textValue(payload.category, "Egyéb", 50)}, ${actor.id})
        RETURNING id, name, quantity, category, checked
      ` as unknown as ShoppingRow[];
      return NextResponse.json({ record: rows[0] }, { status: 201 });
    }
    return invalid("Érvénytelen elemtípus.");
  } catch (error) {
    return serverError(error);
  }
}

export async function PATCH(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Érvénytelen kérés." }, { status: 403 });
  const actor = await getSessionUser(request);
  if (!actor) return unauthorized();
  const payload = await payloadFrom(request);
  const id = Number(payload?.id);
  if (!payload || !Number.isInteger(id) || id < 1) return invalid("Érvénytelen azonosító.");

  try {
    const sql = getSql();
    if (payload.type === "event") {
      const title = textValue(payload.title);
      const date = textValue(payload.date, "", 10);
      const startTime = textValue(payload.startTime, "", 5);
      const departureTime = textValue(payload.departureTime, "", 5);
      if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(startTime)) {
        return invalid("A név, dátum és időpont kötelező.");
      }
      if (departureTime && !/^\d{2}:\d{2}$/.test(departureTime)) {
        return invalid("Az indulási időpont érvénytelen.");
      }
      const tone = tones.includes(String(payload.tone)) ? String(payload.tone) : "violet";
      const kind = eventKinds.includes(String(payload.kind)) ? String(payload.kind) : "other";
      const repeatRule = repeatRuleValue(payload.repeatRule);
      const reminderMinutes = [30, 120, 1440].includes(Number(payload.reminderMinutes)) ? Number(payload.reminderMinutes) : 1440;
      const reminderEnabled = payload.reminderEnabled !== false;
      const rows = await sql`
        UPDATE family_events SET
          date = ${date}, start_time = ${startTime}, departure_time = ${departureTime || null},
          title = ${title}, person = ${textValue(payload.person, "Család", 50)},
          driver = ${textValue(payload.driver, "Egyeztetésre vár", 50)},
          place = ${textValue(payload.place, "Helyszín nélkül", 120)}, tone = ${tone}, kind = ${kind},
          repeat_rule = ${repeatRule}, reminder_minutes = ${reminderMinutes},
          reminder_enabled = ${reminderEnabled}, updated_at = now()
        WHERE id = ${id}
        RETURNING id, date::text AS date, start_time::text AS "startTime",
          departure_time::text AS "departureTime", title, person, driver, place,
          tone, kind, repeat_rule AS "repeatRule",
          reminder_minutes AS "reminderMinutes", reminder_enabled AS "reminderEnabled"
      ` as unknown as EventRow[];
      if (!rows[0]) return NextResponse.json({ error: "Az esemény nem található." }, { status: 404 });
      return NextResponse.json({ record: normalizeEvent(rows[0]) });
    }
    if (payload.type === "chore") {
      if (payload.action === "claim") {
        const rows = await sql`
          UPDATE chores SET assignee = ${actor.displayName}, updated_at = now()
          WHERE id = ${id}
          RETURNING id, title, room, assignee, due_label AS "dueLabel",
            repeat_rule AS "repeatRule", done, completed_on::text AS "completedOn", tone
        ` as unknown as ChoreRow[];
        if (!rows[0]) return NextResponse.json({ error: "A feladat nem található." }, { status: 404 });
        const row = rows[0];
        return NextResponse.json({ record: {
          ...row,
          recurring: row.repeatRule !== "none",
          done: row.repeatRule !== "none" ? recurringChoreDone(row.completedOn, row.repeatRule, todayInBudapest()) : row.done,
        } });
      }
      if (payload.action === "update") {
        const title = textValue(payload.title);
        if (!title) return invalid("A feladat neve kötelező.");
        const repeatRule = repeatRuleValue(payload.repeatRule);
        const rows = await sql`
          UPDATE chores SET
            title = ${title}, room = ${textValue(payload.room, "Otthon", 50)},
            assignee = ${textValue(payload.assignee, "Közös", 50)},
            due_label = ${textValue(payload.dueLabel, "Ma", 50)},
            repeat_rule = ${repeatRule}, updated_at = now()
          WHERE id = ${id}
          RETURNING id, title, room, assignee, due_label AS "dueLabel",
            repeat_rule AS "repeatRule", done, completed_on::text AS "completedOn", tone
        ` as unknown as ChoreRow[];
        if (!rows[0]) return NextResponse.json({ error: "A feladat nem található." }, { status: 404 });
        return NextResponse.json({ record: {
          ...rows[0],
          recurring: repeatRule !== "none",
          done: repeatRule !== "none" ? recurringChoreDone(rows[0].completedOn, repeatRule, todayInBudapest()) : rows[0].done,
        } });
      }
      const rows = await sql`SELECT repeat_rule AS "repeatRule" FROM chores WHERE id = ${id} LIMIT 1` as unknown as Array<{ repeatRule: RepeatRule }>;
      const current = rows[0];
      if (!current) return NextResponse.json({ error: "A feladat nem található." }, { status: 404 });
      if (current.repeatRule !== "none") {
        await sql`UPDATE chores SET completed_on = ${payload.done === true ? todayInBudapest() : null}, updated_at = now() WHERE id = ${id}`;
      } else {
        await sql`UPDATE chores SET done = ${payload.done === true}, updated_at = now() WHERE id = ${id}`;
      }
      return NextResponse.json({ ok: true });
    }
    if (payload.type === "shopping") {
      if (payload.action === "update") {
        const name = textValue(payload.name);
        if (!name) return invalid("A termék neve kötelező.");
        const rows = await sql`
          UPDATE shopping_items SET
            name = ${name}, quantity = ${textValue(payload.quantity, "1 db", 40)},
            category = ${textValue(payload.category, "Egyéb", 50)}, updated_at = now()
          WHERE id = ${id}
          RETURNING id, name, quantity, category, checked
        ` as unknown as ShoppingRow[];
        if (!rows[0]) return NextResponse.json({ error: "A tétel nem található." }, { status: 404 });
        return NextResponse.json({ record: rows[0] });
      }
      await sql`UPDATE shopping_items SET checked = ${payload.checked === true}, updated_at = now() WHERE id = ${id}`;
      return NextResponse.json({ ok: true });
    }
    return invalid("Ez az elem nem módosítható.");
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Érvénytelen kérés." }, { status: 403 });
  const actor = await getSessionUser(request);
  if (!actor) return unauthorized();
  const payload = await payloadFrom(request);
  if (!payload) return invalid("Érvénytelen kérés.");

  try {
    const sql = getSql();
    if (payload.type === "shoppingCompleted") {
      await sql`DELETE FROM shopping_items WHERE checked = true`;
      return NextResponse.json({ ok: true });
    }
    const id = Number(payload.id);
    const type = payload.type as ItemType;
    if (!(type === "event" || type === "chore" || type === "shopping") || !Number.isInteger(id) || id < 1) {
      return invalid("Érvénytelen törlési kérés.");
    }
    if (type === "event") await sql`DELETE FROM family_events WHERE id = ${id}`;
    if (type === "chore") await sql`DELETE FROM chores WHERE id = ${id}`;
    if (type === "shopping") await sql`DELETE FROM shopping_items WHERE id = ${id}`;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
