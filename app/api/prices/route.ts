import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/db";
import { getSessionUser, sameOrigin } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function unauthorized() {
  return NextResponse.json({ error: "Bejelentkezés szükséges." }, { status: 401 });
}

function invalid(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function serverError(error: unknown) {
  console.error("Price API error", error);
  return NextResponse.json({ error: "Az árfigyelő művelet nem sikerült." }, { status: 500 });
}

function foldedSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("hu-HU");
}

async function watchDetails(shoppingItemId: number) {
  const rows = await getSql()`
    SELECT w.id, w.shopping_item_id AS "shoppingItemId", w.product_id AS "productId",
      w.target_price AS "targetPrice", w.notify_on_drop AS "notifyOnDrop",
      COALESCE(product.product_name, '') AS "productName",
      COALESCE(product.category_name, '') AS "categoryName",
      COALESCE(product.unit, '') AS unit,
      product.package_size AS "packageSize",
      product.data_date AS "dataDate",
      COALESCE(product.offers, '[]'::json) AS offers,
      COALESCE(history.points, '[]'::json) AS history
    FROM price_watches w
    LEFT JOIN LATERAL (
      SELECT min(pc.product_name) AS product_name, min(pc.category_name) AS category_name,
        min(pc.unit) AS unit, min(pc.package_size) AS package_size, max(pc.data_date) AS data_date,
        json_agg(json_build_object(
          'chainName', pc.chain_name,
          'maxPrice', pc.max_price,
          'maxUnitPrice', pc.max_unit_price,
          'storeCount', pc.store_count
        ) ORDER BY pc.max_price::numeric ASC, pc.chain_name ASC) AS offers
      FROM price_catalog pc WHERE pc.product_id = w.product_id
    ) product ON true
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object(
        'date', daily.observed_on,
        'maxPrice', daily.max_price
      ) ORDER BY daily.observed_on ASC) AS points
      FROM (
        SELECT observed_on, min(min_price::numeric) AS max_price
        FROM price_watch_history
        WHERE watch_id = w.id
        GROUP BY observed_on
        ORDER BY observed_on DESC
        LIMIT 30
      ) daily
    ) history ON true
    WHERE w.shopping_item_id = ${shoppingItemId}
    LIMIT 1
  `;
  return rows[0] || null;
}

export async function GET(request: NextRequest) {
  const actor = await getSessionUser(request);
  if (!actor) return unauthorized();
  const shoppingItemId = Number(request.nextUrl.searchParams.get("shoppingItemId"));
  if (Number.isInteger(shoppingItemId) && shoppingItemId > 0) {
    try {
      return NextResponse.json({ watch: await watchDetails(shoppingItemId) });
    } catch (error) {
      return serverError(error);
    }
  }

  const query = (request.nextUrl.searchParams.get("q") || "").trim().slice(0, 100);
  if (query.length < 2) return NextResponse.json({ results: [] });
  try {
    const sql = getSql();
    const search = `%${foldedSearch(query)}%`;
    const results = await sql`
      WITH matches AS (
        SELECT *, row_number() OVER (
          PARTITION BY product_id ORDER BY max_price::numeric ASC, chain_name ASC
        ) AS price_rank
        FROM price_catalog
        WHERE translate(lower(product_name), 'áéíóöőúüű', 'aeiooouuu') LIKE ${search}
          OR translate(lower(category_name), 'áéíóöőúüű', 'aeiooouuu') LIKE ${search}
      )
      SELECT product_id AS "productId",
        max(product_name) FILTER (WHERE price_rank = 1) AS "productName",
        max(category_name) FILTER (WHERE price_rank = 1) AS "categoryName",
        max(unit) FILTER (WHERE price_rank = 1) AS unit,
        max(package_size) FILTER (WHERE price_rank = 1) AS "packageSize",
        min(max_price::numeric) AS "bestPrice",
        max(chain_name) FILTER (WHERE price_rank = 1) AS "bestChain",
        count(*)::int AS "chainCount",
        max(data_date) AS "dataDate"
      FROM matches
      GROUP BY product_id
      ORDER BY min(max_price::numeric) ASC, max(product_name) ASC
      LIMIT 30
    `;
    return NextResponse.json({ results });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Érvénytelen kérés." }, { status: 403 });
  const actor = await getSessionUser(request);
  if (!actor) return unauthorized();
  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  const shoppingItemId = Number(payload?.shoppingItemId);
  const productId = typeof payload?.productId === "string" ? payload.productId.trim().slice(0, 40) : "";
  const targetNumber = payload?.targetPrice === "" || payload?.targetPrice == null
    ? null
    : Number(String(payload.targetPrice).replace(",", "."));
  if (!Number.isInteger(shoppingItemId) || shoppingItemId < 1 || !productId) return invalid("Válassz egy terméket.");
  if (targetNumber !== null && (!Number.isFinite(targetNumber) || targetNumber <= 0 || targetNumber > 10_000_000)) {
    return invalid("A célár érvénytelen.");
  }

  try {
    const sql = getSql();
    const [item, product] = await Promise.all([
      sql`SELECT id FROM shopping_items WHERE id = ${shoppingItemId} LIMIT 1`,
      sql`SELECT product_id FROM price_catalog WHERE product_id = ${productId} LIMIT 1`,
    ]);
    if (!item[0]) return NextResponse.json({ error: "A bevásárlási tétel nem található." }, { status: 404 });
    if (!product[0]) return NextResponse.json({ error: "A kiválasztott termék már nem található." }, { status: 404 });
    await sql`
      INSERT INTO price_watches (shopping_item_id, product_id, target_price, created_by)
      VALUES (${shoppingItemId}, ${productId}, ${targetNumber}, ${actor.id})
      ON CONFLICT (shopping_item_id) DO UPDATE SET
        product_id = excluded.product_id,
        target_price = excluded.target_price,
        last_notified_price = NULL,
        created_by = excluded.created_by,
        updated_at = now()
    `;
    return NextResponse.json({ watch: await watchDetails(shoppingItemId) });
  } catch (error) {
    return serverError(error);
  }
}

export async function DELETE(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Érvénytelen kérés." }, { status: 403 });
  const actor = await getSessionUser(request);
  if (!actor) return unauthorized();
  const payload = await request.json().catch(() => null) as { shoppingItemId?: unknown } | null;
  const shoppingItemId = Number(payload?.shoppingItemId);
  if (!Number.isInteger(shoppingItemId) || shoppingItemId < 1) return invalid("Érvénytelen tétel.");
  try {
    await getSql()`DELETE FROM price_watches WHERE shopping_item_id = ${shoppingItemId}`;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return serverError(error);
  }
}
