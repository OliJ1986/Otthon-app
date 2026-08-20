import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/db";
import { getSessionUser, sameOrigin } from "@/lib/auth";
import {
  ExternalProduct,
  findRetailOffers,
  fold,
  lookupOpenFoodFacts,
  normalizeBarcode,
  searchRetailers,
  todayInBudapest,
} from "@/lib/product-sources";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Sql = ReturnType<typeof getSql>;
type SearchResult = {
  productId: string;
  productName: string;
  categoryName: string;
  unit: string;
  packageSize: string;
  bestPrice: string | null;
  bestChain: string | null;
  chainCount: number;
  dataDate: string | null;
  sources: string[];
  imageUrl?: string | null;
};

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

function sourceName(source: ExternalProduct["source"]) {
  if (source === "tesco") return "Tesco";
  if (source === "lidl") return "Lidl";
  return "Open Food Facts";
}

function canonicalProductId(product: ExternalProduct) {
  return product.barcode || `${product.source}:${product.sourceProductId}`;
}

function effectivePrice(product: ExternalProduct) {
  return product.promotionPrice ?? product.price;
}

async function saveExternalProduct(sql: Sql, product: ExternalProduct, forcedProductId?: string) {
  const productId = forcedProductId || canonicalProductId(product);
  const preserveCanonicalMetadata = Boolean(forcedProductId && forcedProductId !== canonicalProductId(product));
  await sql`
    INSERT INTO external_products (
      product_id, barcode, product_name, brand, quantity, package_size, unit,
      category_name, image_url, source, source_product_id, fetched_at, updated_at
    ) VALUES (
      ${productId}, ${product.barcode}, ${product.productName}, ${product.brand}, ${product.quantity},
      ${product.packageSize}, ${product.unit}, ${product.categoryName || "Egyéb"}, ${product.imageUrl},
      ${product.source}, ${product.sourceProductId}, now(), now()
    )
    ON CONFLICT (product_id) DO UPDATE SET
      barcode = CASE WHEN ${preserveCanonicalMetadata} THEN external_products.barcode ELSE COALESCE(excluded.barcode, external_products.barcode) END,
      product_name = CASE WHEN ${preserveCanonicalMetadata} THEN external_products.product_name ELSE excluded.product_name END,
      brand = CASE WHEN ${preserveCanonicalMetadata} THEN external_products.brand ELSE COALESCE(excluded.brand, external_products.brand) END,
      quantity = CASE WHEN ${preserveCanonicalMetadata} THEN external_products.quantity ELSE COALESCE(excluded.quantity, external_products.quantity) END,
      package_size = CASE WHEN ${preserveCanonicalMetadata} THEN external_products.package_size ELSE COALESCE(excluded.package_size, external_products.package_size) END,
      unit = CASE WHEN ${preserveCanonicalMetadata} THEN external_products.unit ELSE COALESCE(excluded.unit, external_products.unit) END,
      category_name = CASE WHEN ${preserveCanonicalMetadata} OR excluded.category_name = 'Egyéb' THEN external_products.category_name ELSE excluded.category_name END,
      image_url = CASE WHEN ${preserveCanonicalMetadata} THEN external_products.image_url ELSE COALESCE(excluded.image_url, external_products.image_url) END,
      source = CASE WHEN ${preserveCanonicalMetadata} THEN external_products.source ELSE excluded.source END,
      source_product_id = CASE WHEN ${preserveCanonicalMetadata} THEN external_products.source_product_id ELSE excluded.source_product_id END,
      fetched_at = now(), updated_at = now()
  `;
  if (product.price != null) {
    await sql`
      INSERT INTO external_price_observations (
        product_id, source, source_product_id, chain_name, price, promotion_price,
        promotion_label, unit_price, unit, observed_on, valid_from, valid_until, source_url
      ) VALUES (
        ${productId}, ${product.source}, ${product.sourceProductId}, ${sourceName(product.source)},
        ${product.price}, ${product.promotionPrice}, ${product.promotionLabel}, ${product.unitPrice},
        ${product.unit}, ${product.observedOn}, ${product.validFrom}, ${product.validUntil}, ${product.sourceUrl}
      )
      ON CONFLICT (product_id, source, chain_name, observed_on) DO UPDATE SET
        source_product_id = excluded.source_product_id,
        price = excluded.price,
        promotion_price = excluded.promotion_price,
        promotion_label = excluded.promotion_label,
        unit_price = excluded.unit_price,
        unit = excluded.unit,
        valid_from = excluded.valid_from,
        valid_until = excluded.valid_until,
        source_url = excluded.source_url,
        updated_at = now()
    `;
  }
  return productId;
}

function resultFromExternal(product: ExternalProduct, productId = canonicalProductId(product)): SearchResult {
  const price = effectivePrice(product);
  return {
    productId,
    productName: product.productName,
    categoryName: product.categoryName || "Egyéb",
    unit: product.unit || "db",
    packageSize: String(product.packageSize ?? 1),
    bestPrice: price == null ? null : String(price),
    bestChain: product.price == null ? null : sourceName(product.source),
    chainCount: product.price == null ? 0 : 1,
    dataDate: product.price == null ? null : product.observedOn,
    sources: [sourceName(product.source)],
    imageUrl: product.imageUrl,
  };
}

async function gvhBarcodeResults(sql: Sql, barcode: string): Promise<SearchResult[]> {
  const strippedBarcode = normalizeBarcode(barcode);
  return sql`
    WITH matches AS (
      SELECT *, row_number() OVER (
        PARTITION BY product_id ORDER BY max_price::numeric ASC, chain_name ASC
      ) AS price_rank
      FROM price_catalog
      WHERE product_id = ${barcode}
        OR (product_id ~ '^[0-9]+$' AND trim(leading '0' from product_id) = ${strippedBarcode})
    )
    SELECT product_id AS "productId",
      max(product_name) FILTER (WHERE price_rank = 1) AS "productName",
      max(category_name) FILTER (WHERE price_rank = 1) AS "categoryName",
      max(unit) FILTER (WHERE price_rank = 1) AS unit,
      max(package_size) FILTER (WHERE price_rank = 1) AS "packageSize",
      min(max_price::numeric)::text AS "bestPrice",
      max(chain_name) FILTER (WHERE price_rank = 1) AS "bestChain",
      count(*)::int AS "chainCount",
      max(data_date)::text AS "dataDate",
      ARRAY['GVH']::text[] AS sources
    FROM matches
    GROUP BY product_id
    ORDER BY min(CASE WHEN product_id = ${barcode} THEN 0 ELSE 1 END), min(max_price::numeric), max(product_name)
    LIMIT 10
  ` as unknown as SearchResult[];
}

async function gvhTextResults(sql: Sql, query: string): Promise<SearchResult[]> {
  const search = `%${fold(query)}%`;
  return sql`
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
      min(max_price::numeric)::text AS "bestPrice",
      max(chain_name) FILTER (WHERE price_rank = 1) AS "bestChain",
      count(*)::int AS "chainCount",
      max(data_date)::text AS "dataDate",
      ARRAY['GVH']::text[] AS sources
    FROM matches
    GROUP BY product_id
    ORDER BY min(max_price::numeric) ASC, max(product_name) ASC
    LIMIT 30
  ` as unknown as SearchResult[];
}

async function barcodeResults(sql: Sql, barcode: string) {
  const [gvh, off] = await Promise.all([
    gvhBarcodeResults(sql, barcode),
    lookupOpenFoodFacts(barcode).catch(() => null),
  ]);
  if (off) {
    const productId = gvh[0]?.productId || barcode;
    const offers = await findRetailOffers(off).catch(() => []);
    await saveExternalProduct(sql, off, productId);
    await Promise.all(offers.map((offer) => saveExternalProduct(sql, offer, productId)));
    const priced = offers.sort((left, right) => (effectivePrice(left) ?? Infinity) - (effectivePrice(right) ?? Infinity))[0];
    const gvhBest = gvh[0];
    const externalBest = priced ? resultFromExternal(priced, productId) : null;
    const useExternal = externalBest?.bestPrice != null
      && (gvhBest?.bestPrice == null || Number(externalBest.bestPrice) < Number(gvhBest.bestPrice));
    return [{
      ...(useExternal && externalBest ? externalBest : gvhBest || resultFromExternal(off, productId)),
      productId,
      productName: off.productName,
      categoryName: off.categoryName || gvhBest?.categoryName || "Egyéb",
      unit: off.unit || gvhBest?.unit || "db",
      packageSize: String(off.packageSize ?? gvhBest?.packageSize ?? 1),
      imageUrl: off.imageUrl,
      chainCount: new Set([...(gvhBest?.sources || []), ...offers.map((item) => sourceName(item.source))]).size,
      sources: [...new Set([...(gvhBest?.sources || []), "Open Food Facts", ...offers.map((item) => sourceName(item.source))])],
    } satisfies SearchResult];
  }
  if (gvh.length) return gvh;

  const direct = await searchRetailers(barcode).catch(() => []);
  const exact = direct.find((product) => product.barcode && normalizeBarcode(product.barcode) === normalizeBarcode(barcode));
  if (!exact) return [];
  const productId = barcode;
  await saveExternalProduct(sql, { ...exact, barcode }, productId);
  return [resultFromExternal(exact, productId)];
}

async function watchDetails(shoppingItemId: number) {
  const rows = await getSql()`
    SELECT w.id, w.shopping_item_id AS "shoppingItemId", w.product_id AS "productId",
      w.target_price AS "targetPrice", w.notify_on_drop AS "notifyOnDrop",
      COALESCE(ep.product_name, pc.product_name, item.name, '') AS "productName",
      COALESCE(NULLIF(ep.category_name, ''), pc.category_name, item.category, 'Egyéb') AS "categoryName",
      COALESCE(ep.unit, pc.unit, 'db') AS unit,
      COALESCE(ep.package_size, pc.package_size, 1) AS "packageSize",
      offers.data_date AS "dataDate",
      COALESCE(offers.rows, '[]'::json) AS offers,
      COALESCE(history.points, '[]'::json) AS history
    FROM price_watches w
    JOIN shopping_items item ON item.id = w.shopping_item_id
    LEFT JOIN external_products ep ON ep.product_id = w.product_id
    LEFT JOIN LATERAL (
      SELECT product_name, category_name, unit, package_size
      FROM price_catalog WHERE product_id = w.product_id LIMIT 1
    ) pc ON true
    LEFT JOIN LATERAL (
      SELECT max(offer.observed_on)::text AS data_date,
        json_agg(json_build_object(
          'source', offer.source, 'chainName', offer.chain_name, 'maxPrice', offer.price,
          'maxUnitPrice', offer.unit_price, 'storeCount', offer.store_count,
          'promotionPrice', offer.promotion_price, 'promotionLabel', offer.promotion_label,
          'validUntil', offer.valid_until, 'observedOn', offer.observed_on,
          'locationLabel', offer.location_label
        ) ORDER BY COALESCE(offer.promotion_price, offer.price) ASC, offer.chain_name ASC) AS rows
      FROM (
        SELECT 'gvh'::text AS source, catalog.chain_name, catalog.max_price::numeric AS price,
          catalog.max_unit_price::numeric AS unit_price, catalog.store_count, NULL::numeric AS promotion_price,
          NULL::text AS promotion_label, NULL::date AS valid_until, catalog.data_date AS observed_on,
          NULL::text AS location_label
        FROM price_catalog catalog WHERE catalog.product_id = w.product_id
        UNION ALL
        SELECT recent.source, recent.chain_name, recent.price, recent.unit_price,
          recent.store_count, recent.promotion_price, recent.promotion_label,
          recent.valid_until, recent.observed_on, recent.location_label
        FROM (
          SELECT DISTINCT ON (external.source, external.chain_name)
            external.source, external.chain_name, external.price::numeric AS price,
            external.unit_price::numeric AS unit_price, 1 AS store_count,
            external.promotion_price::numeric AS promotion_price, external.promotion_label,
            external.valid_until, external.observed_on, external.location_label
          FROM external_price_observations external
          WHERE external.product_id = w.product_id
            AND (external.valid_until IS NULL OR external.valid_until >= CURRENT_DATE)
          ORDER BY external.source, external.chain_name, external.observed_on DESC, external.updated_at DESC
        ) recent
      ) offer
    ) offers ON true
    LEFT JOIN LATERAL (
      SELECT json_agg(json_build_object('date', daily.observed_on, 'maxPrice', daily.price)
        ORDER BY daily.observed_on ASC) AS points
      FROM (
        SELECT observed_on, min(price) AS price
        FROM (
          SELECT observed_on, min_price::numeric AS price
          FROM price_watch_history WHERE watch_id = w.id
          UNION ALL
          SELECT observed_on, COALESCE(promotion_price, price)::numeric AS price
          FROM external_price_observations WHERE product_id = w.product_id
        ) all_prices
        GROUP BY observed_on ORDER BY observed_on DESC LIMIT 30
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

  const barcode = (request.nextUrl.searchParams.get("barcode") || "").trim().slice(0, 40);
  if (barcode) {
    if (!/^[0-9]{6,18}$/.test(barcode)) return invalid("A vonalkód nem érvényes.");
    try {
      return NextResponse.json({ results: await barcodeResults(getSql(), barcode) });
    } catch (error) {
      return serverError(error);
    }
  }

  const query = (request.nextUrl.searchParams.get("q") || "").trim().slice(0, 100);
  if (query.length < 2) return NextResponse.json({ results: [] });
  try {
    const sql = getSql();
    const [gvh, retailerProducts] = await Promise.all([
      gvhTextResults(sql, query),
      searchRetailers(query).catch(() => []),
    ]);
    const selected = retailerProducts
      .sort((left, right) => (effectivePrice(left) ?? Infinity) - (effectivePrice(right) ?? Infinity))
      .filter((product, index, products) => products.findIndex((item) => item.source === product.source && item.sourceProductId === product.sourceProductId) === index)
      .slice(0, 16);
    const external = await Promise.all(selected.map(async (product) => {
      const productId = await saveExternalProduct(sql, product);
      return resultFromExternal(product, productId);
    }));
    return NextResponse.json({ results: [...gvh, ...external].slice(0, 40) });
  } catch (error) {
    return serverError(error);
  }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Érvénytelen kérés." }, { status: 403 });
  const actor = await getSessionUser(request);
  if (!actor) return unauthorized();
  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  let productId = typeof payload?.productId === "string" ? payload.productId.trim().slice(0, 100) : "";
  if (!productId && payload?.action === "createManualWatch") {
    const itemId = Number(payload.shoppingItemId);
    if (Number.isInteger(itemId) && itemId > 0) productId = `manual:item:${itemId}`;
  }
  const targetNumber = payload?.targetPrice === "" || payload?.targetPrice == null
    ? null
    : Number(String(payload.targetPrice).replace(",", "."));
  if (!productId) return invalid("Válassz egy terméket.");
  if (targetNumber !== null && (!Number.isFinite(targetNumber) || targetNumber <= 0 || targetNumber > 10_000_000)) {
    return invalid("A célár érvénytelen.");
  }

  try {
    const sql = getSql();
    if (payload?.action === "createManualWatch") {
      const shoppingItemId = Number(payload.shoppingItemId);
      if (!Number.isInteger(shoppingItemId) || shoppingItemId < 1) return invalid("Érvénytelen bevásárlási tétel.");
      const products = await sql`
        INSERT INTO external_products (product_id, product_name, category_name, source, fetched_at, updated_at)
        SELECT ${productId}, item.name, item.category, 'manual', now(), now()
        FROM shopping_items item WHERE item.id = ${shoppingItemId}
        ON CONFLICT (product_id) DO UPDATE SET
          product_name = excluded.product_name, category_name = excluded.category_name, updated_at = now()
        RETURNING product_id
      `;
      if (!products[0]) return NextResponse.json({ error: "A bevásárlási tétel nem található." }, { status: 404 });
      await sql`
        INSERT INTO price_watches (shopping_item_id, product_id, target_price, created_by)
        VALUES (${shoppingItemId}, ${productId}, ${targetNumber}, ${actor.id})
        ON CONFLICT (shopping_item_id) DO UPDATE SET
          product_id = excluded.product_id, target_price = excluded.target_price,
          last_notified_price = NULL, created_by = excluded.created_by, updated_at = now()
      `;
      await sql`UPDATE shopping_items SET product_id = ${productId}, updated_at = now() WHERE id = ${shoppingItemId}`;
      return NextResponse.json({ watch: await watchDetails(shoppingItemId) });
    }

    if (payload?.action === "recordPrice") {
      const shoppingItemId = Number(payload.shoppingItemId);
      const paidPrice = Number(String(payload.price ?? "").replace(",", "."));
      const chainName = typeof payload.chainName === "string" ? payload.chainName.trim().slice(0, 60) : "";
      if (!Number.isInteger(shoppingItemId) || shoppingItemId < 1) return invalid("Érvénytelen bevásárlási tétel.");
      if (!Number.isFinite(paidPrice) || paidPrice <= 0 || paidPrice > 10_000_000) return invalid("A megadott ár érvénytelen.");
      if (!chainName) return invalid("Válaszd ki az üzletet.");
      await sql`
        INSERT INTO external_products (product_id, barcode, product_name, category_name, source, fetched_at, updated_at)
        SELECT ${productId}, ${productId.match(/^\d+$/) ? productId : null}, item.name, item.category, 'manual', now(), now()
        FROM shopping_items item WHERE item.id = ${shoppingItemId}
        ON CONFLICT (product_id) DO NOTHING
      `;
      await sql`
        INSERT INTO external_price_observations (
          product_id, source, chain_name, price, observed_on, location_label, created_by
        ) VALUES (${productId}, 'manual', ${chainName}, ${paidPrice}, ${todayInBudapest()}, 'Saját vásárlás', ${actor.id})
        ON CONFLICT (product_id, source, chain_name, observed_on) DO UPDATE SET
          price = excluded.price, location_label = excluded.location_label,
          created_by = excluded.created_by, updated_at = now()
      `;
      return NextResponse.json({ watch: await watchDetails(shoppingItemId) });
    }

    if (payload?.action === "addToShopping") {
      const withPriceWatch = payload.withPriceWatch !== false;
      const result = await sql.begin(async (tx) => {
        const products = await tx`
          SELECT product_id AS "productId", product_name AS "productName", category_name AS "categoryName",
            unit, package_size AS "packageSize"
          FROM (
            SELECT product_id, product_name, category_name, unit, package_size, 0 AS priority
            FROM external_products WHERE product_id = ${productId}
            UNION ALL
            SELECT product_id, product_name, category_name, unit, package_size, 1 AS priority
            FROM price_catalog WHERE product_id = ${productId}
          ) product ORDER BY priority LIMIT 1
        `;
        const product = products[0];
        if (!product) return null;
        const quantity = `1 × ${product.packageSize || 1} ${product.unit || "db"}`.slice(0, 40);
        const items = await tx`
          INSERT INTO shopping_items (name, quantity, category, product_id, created_by)
          VALUES (${product.productName}, ${quantity}, ${product.categoryName || "Egyéb"}, ${productId}, ${actor.id})
          RETURNING id, name, quantity, category, checked
        `;
        if (!withPriceWatch) return { ...items[0], priceWatch: null };
        const watches = await tx`
          INSERT INTO price_watches (shopping_item_id, product_id, target_price, created_by)
          VALUES (${items[0].id}, ${productId}, ${targetNumber}, ${actor.id}) RETURNING id
        `;
        return { ...items[0], priceWatch: { id: watches[0].id, productId, productName: product.productName, targetPrice: targetNumber } };
      });
      if (!result) return NextResponse.json({ error: "A beolvasott termék már nem található." }, { status: 404 });
      return NextResponse.json({ record: result }, { status: 201 });
    }

    const shoppingItemId = Number(payload?.shoppingItemId);
    if (!Number.isInteger(shoppingItemId) || shoppingItemId < 1) return invalid("Érvénytelen bevásárlási tétel.");
    const [item, product] = await Promise.all([
      sql`SELECT id FROM shopping_items WHERE id = ${shoppingItemId} LIMIT 1`,
      sql`
        SELECT product_id FROM price_catalog WHERE product_id = ${productId}
        UNION ALL SELECT product_id FROM external_products WHERE product_id = ${productId}
        LIMIT 1
      `,
    ]);
    if (!item[0]) return NextResponse.json({ error: "A bevásárlási tétel nem található." }, { status: 404 });
    if (!product[0]) return NextResponse.json({ error: "A kiválasztott termék már nem található." }, { status: 404 });
    await sql`
      INSERT INTO price_watches (shopping_item_id, product_id, target_price, created_by)
      VALUES (${shoppingItemId}, ${productId}, ${targetNumber}, ${actor.id})
      ON CONFLICT (shopping_item_id) DO UPDATE SET
        product_id = excluded.product_id, target_price = excluded.target_price,
        last_notified_price = NULL, created_by = excluded.created_by, updated_at = now()
    `;
    await sql`UPDATE shopping_items SET product_id = ${productId}, updated_at = now() WHERE id = ${shoppingItemId}`;
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
