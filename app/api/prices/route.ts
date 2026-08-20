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
type SearchOffer = {
  source: "gvh" | "tesco" | "lidl" | "manual";
  chainName: string;
  price: string;
  promotionPrice: string | null;
  promotionLabel: string | null;
  observedOn: string;
  validUntil: string | null;
};
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
  offers: SearchOffer[];
  cached?: boolean;
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

function offerPrice(offer: SearchOffer) {
  return Number(offer.promotionPrice ?? offer.price);
}

function sortedOffers(offers: SearchOffer[]) {
  return offers.sort((left, right) => offerPrice(left) - offerPrice(right) || left.chainName.localeCompare(right.chainName, "hu"));
}

function sortedResults(results: SearchResult[]) {
  return results.sort((left, right) => {
    const priceDifference = Number(left.bestPrice ?? Infinity) - Number(right.bestPrice ?? Infinity);
    return priceDifference || left.productName.localeCompare(right.productName, "hu");
  });
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
  const offers: SearchOffer[] = product.price == null ? [] : [{
    source: product.source === "off" ? "manual" : product.source,
    chainName: sourceName(product.source),
    price: String(product.price),
    promotionPrice: product.promotionPrice == null ? null : String(product.promotionPrice),
    promotionLabel: product.promotionLabel,
    observedOn: product.observedOn,
    validUntil: product.validUntil,
  }];
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
    offers,
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
      ARRAY['GVH']::text[] AS sources,
      json_agg(json_build_object(
        'source', 'gvh', 'chainName', chain_name, 'price', max_price::text,
        'promotionPrice', NULL, 'promotionLabel', NULL,
        'observedOn', data_date::text, 'validUntil', NULL
      ) ORDER BY max_price::numeric ASC, chain_name ASC) AS offers
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
      ARRAY['GVH']::text[] AS sources,
      json_agg(json_build_object(
        'source', 'gvh', 'chainName', chain_name, 'price', max_price::text,
        'promotionPrice', NULL, 'promotionLabel', NULL,
        'observedOn', data_date::text, 'validUntil', NULL
      ) ORDER BY max_price::numeric ASC, chain_name ASC) AS offers
    FROM matches
    GROUP BY product_id
    ORDER BY min(max_price::numeric) ASC, max(product_name) ASC
    LIMIT 30
  ` as unknown as SearchResult[];
}

async function cachedBarcodeReference(sql: Sql, barcode: string) {
  const normalized = normalizeBarcode(barcode);
  const rows = await sql`
    SELECT product_id AS "productId", barcode, product_name AS "productName", brand, quantity,
      package_size AS "packageSize", unit, category_name AS "categoryName", image_url AS "imageUrl",
      source, source_product_id AS "sourceProductId",
      (GREATEST(product.fetched_at, COALESCE(prices.last_update, product.fetched_at)) >= now() - interval '3 days') AS fresh
    FROM external_products product
    LEFT JOIN LATERAL (
      SELECT max(updated_at) AS last_update
      FROM external_price_observations WHERE product_id = product.product_id AND source <> 'manual'
    ) prices ON true
    WHERE product.product_id = ${barcode}
      OR product.barcode = ${barcode}
      OR (product.barcode ~ '^[0-9]+$' AND trim(leading '0' from product.barcode) = ${normalized})
    ORDER BY CASE WHEN product.product_id = ${barcode} OR product.barcode = ${barcode} THEN 0 ELSE 1 END, product.updated_at DESC
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  const source = ["off", "tesco", "lidl"].includes(String(row.source)) ? row.source as ExternalProduct["source"] : "off";
  const reference: ExternalProduct = {
    source,
    sourceProductId: String(row.sourceProductId || row.productId),
    barcode: row.barcode ? String(row.barcode) : barcode,
    productName: String(row.productName),
    brand: row.brand ? String(row.brand) : null,
    quantity: row.quantity ? String(row.quantity) : null,
    packageSize: row.packageSize == null ? null : Number(row.packageSize),
    unit: row.unit ? String(row.unit) : null,
    categoryName: String(row.categoryName || "Egyéb"),
    imageUrl: row.imageUrl ? String(row.imageUrl) : null,
    price: null,
    promotionPrice: null,
    promotionLabel: null,
    unitPrice: null,
    observedOn: todayInBudapest(),
    validFrom: null,
    validUntil: null,
    sourceUrl: null,
  };
  return { productId: String(row.productId), reference, fresh: row.fresh === true };
}

async function recentExternalOffers(sql: Sql, productId: string): Promise<SearchOffer[]> {
  const rows = await sql`
    SELECT DISTINCT ON (source, chain_name)
      source, chain_name AS "chainName", price::text,
      promotion_price::text AS "promotionPrice", promotion_label AS "promotionLabel",
      observed_on::text AS "observedOn", valid_until::text AS "validUntil"
    FROM external_price_observations
    WHERE product_id = ${productId}
      AND (source = 'manual' OR observed_on >= CURRENT_DATE - 3)
      AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
    ORDER BY source, chain_name, observed_on DESC, updated_at DESC
  `;
  return rows as unknown as SearchOffer[];
}

async function unifiedBarcodeResult(
  sql: Sql,
  productId: string,
  reference: ExternalProduct,
  gvh: SearchResult[],
  cached: boolean,
) {
  const gvhResult = gvh[0] || null;
  const offers = sortedOffers([
    ...(gvhResult?.offers || []),
    ...await recentExternalOffers(sql, productId),
  ]);
  const best = offers[0] || null;
  const sourceLabels = [...new Set([
    ...(gvhResult?.sources || []),
    sourceName(reference.source),
    ...offers.filter((offer) => offer.source !== "gvh").map((offer) => offer.chainName),
  ])];
  const dataDates = offers.map((offer) => offer.observedOn).filter(Boolean).sort();
  return {
    productId,
    productName: reference.productName,
    categoryName: reference.categoryName || gvhResult?.categoryName || "Egyéb",
    unit: reference.unit || gvhResult?.unit || "db",
    packageSize: String(reference.packageSize ?? gvhResult?.packageSize ?? 1),
    bestPrice: best ? String(offerPrice(best)) : null,
    bestChain: best?.chainName || null,
    chainCount: offers.length,
    dataDate: dataDates.at(-1) || null,
    sources: sourceLabels,
    offers,
    cached,
    imageUrl: reference.imageUrl,
  } satisfies SearchResult;
}

async function cachedExternalTextResults(sql: Sql, query: string): Promise<SearchResult[]> {
  const search = `%${fold(query)}%`;
  return sql`
    WITH recent AS (
      SELECT DISTINCT ON (product_id, source, chain_name)
        product_id, source, chain_name, price, promotion_price, promotion_label,
        observed_on, valid_until
      FROM external_price_observations
      WHERE (source = 'manual' OR observed_on >= CURRENT_DATE - 3)
        AND (valid_until IS NULL OR valid_until >= CURRENT_DATE)
      ORDER BY product_id, source, chain_name, observed_on DESC, updated_at DESC
    )
    SELECT product.product_id AS "productId", product.product_name AS "productName",
      product.category_name AS "categoryName", COALESCE(product.unit, 'db') AS unit,
      COALESCE(product.package_size, 1)::text AS "packageSize",
      min(COALESCE(recent.promotion_price, recent.price)::numeric)::text AS "bestPrice",
      (array_agg(recent.chain_name ORDER BY COALESCE(recent.promotion_price, recent.price)::numeric ASC))[1] AS "bestChain",
      count(*)::int AS "chainCount", max(recent.observed_on)::text AS "dataDate",
      array_agg(DISTINCT CASE WHEN recent.source = 'manual' THEN 'Saját ár' ELSE recent.chain_name END) AS sources,
      json_agg(json_build_object(
        'source', recent.source, 'chainName', recent.chain_name, 'price', recent.price::text,
        'promotionPrice', recent.promotion_price::text, 'promotionLabel', recent.promotion_label,
        'observedOn', recent.observed_on::text, 'validUntil', recent.valid_until::text
      ) ORDER BY COALESCE(recent.promotion_price, recent.price)::numeric ASC, recent.chain_name ASC) AS offers,
      true AS cached, product.image_url AS "imageUrl"
    FROM external_products product
    JOIN recent ON recent.product_id = product.product_id
    WHERE translate(lower(product.product_name), 'áéíóöőúüű', 'aeiooouuu') LIKE ${search}
    GROUP BY product.product_id
    HAVING product.fetched_at >= now() - interval '3 days'
      OR max(recent.observed_on) FILTER (WHERE recent.source <> 'manual') >= CURRENT_DATE - 3
    ORDER BY min(COALESCE(recent.promotion_price, recent.price)::numeric) ASC, product.product_name ASC
    LIMIT 20
  ` as unknown as SearchResult[];
}

async function barcodeResults(sql: Sql, barcode: string) {
  const [gvh, cachedProduct] = await Promise.all([
    gvhBarcodeResults(sql, barcode),
    cachedBarcodeReference(sql, barcode),
  ]);
  if (cachedProduct?.fresh) {
    return [await unifiedBarcodeResult(sql, cachedProduct.productId, cachedProduct.reference, gvh, true)];
  }

  const reference = cachedProduct?.reference || await lookupOpenFoodFacts(barcode).catch(() => null);
  if (reference) {
    const productId = cachedProduct?.productId || gvh[0]?.productId || barcode;
    const retailOffers = await findRetailOffers(reference).catch(() => []);
    await saveExternalProduct(sql, reference, productId);
    await Promise.all(retailOffers.map((offer) => saveExternalProduct(sql, offer, productId)));
    return [await unifiedBarcodeResult(sql, productId, reference, gvh, false)];
  }
  if (gvh.length) return gvh;

  const direct = await searchRetailers(barcode).catch(() => []);
  const exact = direct.find((product) => product.barcode && normalizeBarcode(product.barcode) === normalizeBarcode(barcode));
  if (!exact) return [];
  const productId = barcode;
  await saveExternalProduct(sql, { ...exact, barcode }, productId);
  return [await unifiedBarcodeResult(sql, productId, { ...exact, barcode }, [], false)];
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
            AND (external.source = 'manual' OR external.observed_on >= CURRENT_DATE - 3)
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
    const [gvh, cachedExternal] = await Promise.all([
      gvhTextResults(sql, query),
      cachedExternalTextResults(sql, query),
    ]);
    if (cachedExternal.length) {
      return NextResponse.json({ results: sortedResults([...gvh, ...cachedExternal]).slice(0, 40), cached: true });
    }

    const retailerProducts = await searchRetailers(query).catch(() => []);
    const selected = retailerProducts
      .sort((left, right) => (effectivePrice(left) ?? Infinity) - (effectivePrice(right) ?? Infinity))
      .filter((product, index, products) => products.findIndex((item) => item.source === product.source && item.sourceProductId === product.sourceProductId) === index)
      .slice(0, 16);
    const external = await Promise.all(selected.map(async (product) => {
      const productId = await saveExternalProduct(sql, product);
      return resultFromExternal(product, productId);
    }));
    return NextResponse.json({ results: sortedResults([...gvh, ...external]).slice(0, 40), cached: false });
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
