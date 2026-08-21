import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/db";
import { getSessionUser, sameOrigin } from "@/lib/auth";
import { sendPushToOtherUsers } from "@/lib/push";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type StoredItemRow = {
  id: number;
  name: string;
  location: string;
  note: string | null;
  aliases: string | null;
  status: "stored" | "missing";
  storedBy: string;
  updatedBy: string;
  storedAt: string;
  lastFoundAt: string | null;
  updatedAt: string;
  historyCount: number;
};

function unauthorized() {
  return NextResponse.json({ error: "Bejelentkezés szükséges." }, { status: 401 });
}

function invalid(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function serverError(error: unknown) {
  console.error("Storage API error", error);
  return NextResponse.json({ error: "A művelet nem sikerült." }, { status: 500 });
}

function textValue(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

async function payloadFrom(request: NextRequest) {
  return request.json().catch(() => null) as Promise<Record<string, unknown> | null>;
}

async function itemById(sql: ReturnType<typeof getSql>, id: number) {
  const rows = await sql`
    SELECT item.id, item.name, item.location, item.note, item.aliases, item.status,
      COALESCE(creator.display_name, 'Ismeretlen') AS "storedBy",
      COALESCE(updater.display_name, creator.display_name, 'Ismeretlen') AS "updatedBy",
      item.stored_at::text AS "storedAt",
      item.last_found_at::text AS "lastFoundAt",
      item.updated_at::text AS "updatedAt",
      (SELECT count(*)::int FROM stored_item_history history WHERE history.item_id = item.id) AS "historyCount"
    FROM stored_items item
    LEFT JOIN users creator ON creator.id = item.created_by
    LEFT JOIN users updater ON updater.id = item.updated_by
    WHERE item.id = ${id}
    LIMIT 1
  ` as unknown as StoredItemRow[];
  return rows[0] || null;
}

export async function GET(request: NextRequest) {
  const actor = await getSessionUser(request);
  if (!actor) return unauthorized();
  const itemId = Number(request.nextUrl.searchParams.get("itemId"));
  if (!Number.isInteger(itemId) || itemId < 1) return invalid("Érvénytelen tárgy.");

  try {
    const sql = getSql();
    const item = await itemById(sql, itemId);
    if (!item) return NextResponse.json({ error: "A tárgy nem található." }, { status: 404 });
    const history = await sql`
      SELECT history.id, history.action,
        history.from_location AS "fromLocation",
        history.to_location AS "toLocation",
        history.note,
        COALESCE(actor.display_name, 'Ismeretlen') AS "actorName",
        history.created_at::text AS "createdAt"
      FROM stored_item_history history
      LEFT JOIN users actor ON actor.id = history.actor_id
      WHERE history.item_id = ${itemId}
      ORDER BY history.created_at DESC, history.id DESC
    `;
    return NextResponse.json({ item, history });
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

  const name = textValue(payload.name, 120);
  const location = textValue(payload.location, 220);
  const note = textValue(payload.note, 500);
  const aliases = textValue(payload.aliases, 300);
  if (!name || !location) return invalid("A tárgy neve és a helye kötelező.");

  try {
    const sql = getSql();
    const duplicate = await sql`
      SELECT id FROM stored_items
      WHERE lower(trim(name)) = lower(trim(${name}))
      LIMIT 1
    ` as unknown as Array<{ id: number }>;
    if (duplicate[0]) {
      return NextResponse.json({
        error: "Ez a tárgy már szerepel. Nyisd meg, és használd az Áthelyezem gombot.",
        existingId: duplicate[0].id,
      }, { status: 409 });
    }

    const id = await sql.begin(async (transaction) => {
      const inserted = await transaction`
        INSERT INTO stored_items
          (name, location, note, aliases, status, created_by, updated_by, stored_at)
        VALUES
          (${name}, ${location}, ${note || null}, ${aliases || null}, 'stored', ${actor.id}, ${actor.id}, now())
        RETURNING id
      ` as unknown as Array<{ id: number }>;
      await transaction`
        INSERT INTO stored_item_history (item_id, action, to_location, note, actor_id)
        VALUES (${inserted[0].id}, 'stored', ${location}, ${note || null}, ${actor.id})
      `;
      return inserted[0].id;
    });

    const record = await itemById(sql, id);
    await sendPushToOtherUsers(actor.id, {
      title: "Új eltett tárgy",
      body: `${actor.displayName} eltette: ${name} · ${location}`,
      url: "/?tab=storage",
      tag: `stored-item-${id}`,
    }).catch((error) => console.error("Stored item push failed", error));
    return NextResponse.json({ record }, { status: 201 });
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
  const action = textValue(payload?.action, 20);
  if (!payload || !Number.isInteger(id) || id < 1) return invalid("Érvénytelen tárgy.");
  if (!["move", "found", "missing"].includes(action)) return invalid("Érvénytelen művelet.");

  try {
    const sql = getSql();
    const currentRows = await sql`
      SELECT id, name, location FROM stored_items WHERE id = ${id} LIMIT 1
    ` as unknown as Array<{ id: number; name: string; location: string }>;
    const current = currentRows[0];
    if (!current) return NextResponse.json({ error: "A tárgy nem található." }, { status: 404 });

    const note = textValue(payload.note, 500);
    let nextLocation = current.location;
    if (action === "move") {
      nextLocation = textValue(payload.location, 220);
      if (!nextLocation) return invalid("Az új hely megadása kötelező.");
      await sql.begin(async (transaction) => {
        await transaction`
          UPDATE stored_items SET
            location = ${nextLocation}, note = ${note || null}, status = 'stored',
            updated_by = ${actor.id}, stored_at = now(), updated_at = now()
          WHERE id = ${id}
        `;
        await transaction`
          INSERT INTO stored_item_history
            (item_id, action, from_location, to_location, note, actor_id)
          VALUES
            (${id}, 'moved', ${current.location}, ${nextLocation}, ${note || null}, ${actor.id})
        `;
      });
    } else if (action === "found") {
      await sql.begin(async (transaction) => {
        await transaction`
          UPDATE stored_items SET
            status = 'stored', last_found_at = now(), updated_by = ${actor.id}, updated_at = now()
          WHERE id = ${id}
        `;
        await transaction`
          INSERT INTO stored_item_history
            (item_id, action, from_location, to_location, note, actor_id)
          VALUES
            (${id}, 'found', ${current.location}, ${current.location}, ${note || null}, ${actor.id})
        `;
      });
    } else {
      await sql.begin(async (transaction) => {
        await transaction`
          UPDATE stored_items SET
            status = 'missing', updated_by = ${actor.id}, updated_at = now()
          WHERE id = ${id}
        `;
        await transaction`
          INSERT INTO stored_item_history
            (item_id, action, from_location, note, actor_id)
          VALUES
            (${id}, 'missing', ${current.location}, ${note || null}, ${actor.id})
        `;
      });
    }

    const record = await itemById(sql, id);
    if (action === "move") {
      await sendPushToOtherUsers(actor.id, {
        title: "Tárgy áthelyezve",
        body: `${actor.displayName} áthelyezte: ${current.name} · ${nextLocation}`,
        url: "/?tab=storage",
        tag: `stored-item-moved-${id}-${Date.now()}`,
      }).catch((error) => console.error("Stored item move push failed", error));
    }
    if (action === "missing") {
      await sendPushToOtherUsers(actor.id, {
        title: "Nincs a megadott helyen",
        body: `${actor.displayName} nem találta: ${current.name} · ${current.location}`,
        url: "/?tab=storage",
        tag: `stored-item-missing-${id}-${Date.now()}`,
      }).catch((error) => console.error("Stored item missing push failed", error));
    }
    return NextResponse.json({ record });
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Érvénytelen kérés." }, { status: 403 });
  const actor = await getSessionUser(request);
  if (!actor) return unauthorized();
  const payload = await payloadFrom(request);
  const id = Number(payload?.id);
  if (!payload || !Number.isInteger(id) || id < 1) return invalid("Érvénytelen tárgy.");

  try {
    const sql = getSql();
    await sql`DELETE FROM stored_items WHERE id = ${id}`;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
