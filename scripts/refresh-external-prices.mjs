import postgres from "postgres";
import webpush from "web-push";

const connectionString = process.env.DATABASE_URL;
const force = process.env.EXTERNAL_PRICE_REFRESH_FORCE === "1";
if (!connectionString) throw new Error("DATABASE_URL szükséges a külső árfrissítéshez.");

const sql = postgres(connectionString, { max: 3, idle_timeout: 10, connect_timeout: 20, prepare: false });
const searchQuery = `query Search($query:String!,$page:Int=1,$count:Int){search(query:$query,page:$page,count:$count){results{node{__typename ... on ProductInterface{id gtin title isForSale price{actual unitPrice unitOfMeasure} promotions{id startDate endDate description}}}}}}`;

function budapestParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date()).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function numeric(value) {
  const parsed = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function folded(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tokens(value) {
  return new Set(folded(value).split(/\s+/).filter((token) => token.length > 1 && !/^\d+$/.test(token)));
}

function packageAmount(value) {
  const normalized = folded(value).replace(/(\d)\s*,\s*(\d)/g, "$1.$2");
  const match = [...normalized.matchAll(/(\d+(?:\.\d+)?)\s*(kg|g|l|ml|db)\b/g)].at(-1);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2];
  if (unit === "kg") return { amount: amount * 1000, unit: "g" };
  if (unit === "l") return { amount: amount * 1000, unit: "ml" };
  return { amount, unit };
}

function score(reference, candidate) {
  const left = tokens(`${reference.brand || ""} ${reference.productName}`);
  const right = tokens(candidate.productName);
  const common = [...left].filter((token) => right.has(token)).length;
  let result = common / (new Set([...left, ...right]).size || 1) * 60;
  if (reference.brand && folded(candidate.productName).includes(folded(reference.brand))) result += 20;
  const leftPackage = packageAmount(reference.quantity || reference.productName);
  const rightPackage = packageAmount(candidate.quantity || candidate.productName);
  if (leftPackage && rightPackage) {
    if (leftPackage.unit !== rightPackage.unit) result -= 30;
    else result += Math.abs(leftPackage.amount - rightPackage.amount) / leftPackage.amount <= 0.05 ? 35 : -35;
  }
  return result;
}

function dateFromEpoch(value) {
  if (!value) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(value * 1000));
}

function bestMatch(reference, candidates) {
  const ranked = candidates.map((candidate) => ({ candidate, score: score(reference, candidate) })).sort((a, b) => b.score - a.score);
  return ranked[0]?.score >= 25 ? ranked[0].candidate : null;
}

async function fetchTimeout(url, init, timeout = 9_000) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
}

async function tescoConfig() {
  let apiKey = process.env.TESCO_API_KEY || "";
  let url = "https://xapi.tesco.com/";
  try {
    const response = await fetchTimeout("https://bevasarlas.tesco.hu/shop/hu-HU/search?query=tej", { headers: { "user-agent": "Mozilla/5.0 Otthon-family-price-monitor" } });
    if (response.ok) {
      const html = (await response.text())
        .replaceAll("&quot;", "\"")
        .replace(/\\u([0-9a-f]{4})/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)));
      apiKey ||= html.match(/"mangoApiKey"\s*:\s*"([^"]+)"/)?.[1] || "";
      url = html.match(/"mangoUrl"\s*:\s*"([^"]+)"/)?.[1] || url;
    }
  } catch {
    // A legutóbbi publikus konfigurációval még megkíséreljük a lekérést.
  }
  if (!apiKey) throw new Error("A Tesco publikus frontend-konfigurációja most nem olvasható.");
  return { apiKey, url };
}

function clubcard(promotions, normal, today) {
  return array(promotions).reduce((best, raw) => {
    const promotion = record(raw);
    const end = String(promotion.endDate || "").slice(0, 10) || null;
    if (end && end < today) return best;
    const description = String(promotion.description || "");
    const match = description.match(/([0-9][0-9 .]*)\s*Ft\b/i);
    const price = match ? numeric(match[1]) : null;
    if (price == null || price <= 0 || price >= normal || (best && best.price <= price)) return best;
    return { price, label: description, from: String(promotion.startDate || "").slice(0, 10) || null, until: end };
  }, null);
}

async function searchTesco(query, today) {
  const config = await tescoConfig();
  const response = await fetchTimeout(config.url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", region: "HU", language: "hu-HU", "accept-language": "hu-HU", "x-apikey": config.apiKey },
    body: JSON.stringify([{ operationName: "Search", variables: { query, page: 1, count: 24 }, query: searchQuery }]),
  });
  if (!response.ok) throw new Error(`Tesco keresés: ${response.status}`);
  const search = record(record(record(array(await response.json())[0]).data).search);
  return array(search.results).flatMap((raw) => {
    const node = record(record(raw).node);
    const priceData = record(node.price);
    const price = numeric(priceData.actual);
    if (!node.title || !node.id || price == null || node.isForSale === false) return [];
    const promotion = clubcard(node.promotions, price, today);
    return [{ source: "tesco", sourceProductId: String(node.id), productName: String(node.title), price, promotionPrice: promotion?.price ?? null, promotionLabel: promotion?.label ?? null, unitPrice: numeric(priceData.unitPrice), unit: String(priceData.unitOfMeasure || "") || null, validFrom: promotion?.from ?? null, validUntil: promotion?.until ?? null, sourceUrl: `https://bevasarlas.tesco.hu/shop/hu-HU/products/${node.id}` }];
  });
}

async function searchLidl(query) {
  const url = new URL("https://www.lidl.hu/q/api/search");
  url.searchParams.set("assortment", "HU");
  url.searchParams.set("locale", "hu_HU");
  url.searchParams.set("version", "v2.0.0");
  url.searchParams.set("q", query);
  const response = await fetchTimeout(url, {
    headers: { accept: "*/*", "x-requested-with": "XMLHttpRequest", "user-agent": "Mozilla/5.0 Otthon-family-price-monitor" },
  });
  if (!response.ok) throw new Error(`Lidl keresés: ${response.status}`);
  return array(record(await response.json()).items).flatMap((raw) => {
    const product = record(record(record(raw).gridbox).data);
    const priceData = record(product.price);
    const price = numeric(priceData.price);
    const sourceProductId = String(product.productId || product.itemId || product.erpNumber || "");
    const productName = String(product.fullTitle || product.title || "");
    if (!sourceProductId || !productName || price == null) return [];
    const start = numeric(product.storeStartDate);
    const end = numeric(product.storeEndDate);
    const quantity = String(record(priceData.basePrice).text || "").split(";")[0]?.trim() || null;
    const discount = record(priceData.discount);
    return [{ source: "lidl", sourceProductId, productName, quantity, price, promotionPrice: null, promotionLabel: String(discount.discountText || "") || null, unitPrice: null, unit: null, validFrom: dateFromEpoch(start), validUntil: dateFromEpoch(end), sourceUrl: "https://www.lidl.hu/q/search" }];
  });
}

async function notify(watch, previous, current, date) {
  const target = watch.targetPrice == null ? null : Number(watch.targetPrice);
  const last = watch.lastNotifiedPrice == null ? null : Number(watch.lastNotifiedPrice);
  const dropped = watch.notifyOnDrop && previous != null && current.price < previous;
  const targetReached = target != null && current.price <= target && (last == null || current.price < last);
  if ((!dropped && !targetReached) || last === current.price) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (publicKey && privateKey) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.invalid", publicKey, privateKey);
    const subscriptions = await sql`SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ${watch.userId}`;
    const body = `${watch.productName}: ${Math.round(current.price).toLocaleString("hu-HU")} Ft · ${current.chainName}`;
    await Promise.all(subscriptions.map(async (subscription) => {
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, JSON.stringify({ title: "Árfigyelő: olcsóbb lett", body, url: "/", tag: `external-price-${watch.id}-${date}` }), { TTL: 86_400 });
      } catch (error) {
        if (error?.statusCode === 404 || error?.statusCode === 410) await sql`DELETE FROM push_subscriptions WHERE id = ${subscription.id}`;
      }
    }));
  }
  await sql`UPDATE price_watches SET last_notified_price = ${current.price}, updated_at = now() WHERE id = ${watch.id}`;
}

async function main() {
  const now = budapestParts();
  if (!force && now.minutes < 320) return console.log("Külső árfrissítés kihagyva: Budapesten még nincs 05:20.");
  const state = await sql`SELECT value FROM job_state WHERE key = 'external_price_refresh' LIMIT 1`;
  if (!force && state[0]?.value === now.date) return console.log(`Külső árfrissítés már elkészült: ${now.date}`);

  const watches = await sql`
    SELECT w.id, w.product_id AS "productId", w.created_by AS "userId", w.target_price AS "targetPrice",
      w.notify_on_drop AS "notifyOnDrop", w.last_notified_price AS "lastNotifiedPrice",
      product.product_name AS "productName", product.brand, product.quantity
    FROM price_watches w JOIN external_products product ON product.product_id = w.product_id
  `;
  const previousRows = await sql`
    SELECT w.id, min(recent.price) AS price
    FROM price_watches w
    JOIN LATERAL (
      SELECT DISTINCT ON (price.source, price.chain_name)
        COALESCE(price.promotion_price, price.price)::numeric AS price
      FROM external_price_observations price
      WHERE price.product_id = w.product_id AND price.source <> 'manual'
        AND (price.valid_until IS NULL OR price.valid_until >= CURRENT_DATE)
      ORDER BY price.source, price.chain_name, price.observed_on DESC, price.updated_at DESC
    ) recent ON true
    GROUP BY w.id
  `;
  const previous = new Map(previousRows.map((row) => [row.id, Number(row.price)]));
  const cache = new Map();

  for (const watch of watches) {
    const query = `${watch.brand || ""} ${watch.productName}`.replace(/\b\d+(?:[.,]\d+)?\s*(?:kg|g|l|ml|db)\b/gi, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!query) continue;
    if (!cache.has(query)) {
      cache.set(query, await Promise.allSettled([searchTesco(query, now.date), searchLidl(query)]).then((groups) => groups.flatMap((group) => group.status === "fulfilled" ? group.value : [])));
    }
    const candidates = cache.get(query);
    const reference = { productName: watch.productName, brand: watch.brand, quantity: watch.quantity };
    for (const source of ["tesco", "lidl"]) {
      const match = bestMatch(reference, candidates.filter((item) => item.source === source));
      if (!match) continue;
      const chainName = source === "tesco" ? "Tesco" : "Lidl";
      await sql`
        INSERT INTO external_price_observations (
          product_id, source, source_product_id, chain_name, price, promotion_price, promotion_label,
          unit_price, unit, observed_on, valid_from, valid_until, source_url
        ) VALUES (
          ${watch.productId}, ${source}, ${match.sourceProductId}, ${chainName}, ${match.price},
          ${match.promotionPrice}, ${match.promotionLabel}, ${match.unitPrice}, ${match.unit}, ${now.date},
          ${match.validFrom}, ${match.validUntil}, ${match.sourceUrl}
        ) ON CONFLICT (product_id, source, chain_name, observed_on) DO UPDATE SET
          source_product_id = excluded.source_product_id, price = excluded.price,
          promotion_price = excluded.promotion_price, promotion_label = excluded.promotion_label,
          unit_price = excluded.unit_price, unit = excluded.unit, valid_from = excluded.valid_from,
          valid_until = excluded.valid_until, source_url = excluded.source_url, updated_at = now()
      `;
      await sql`
        INSERT INTO price_watch_history (watch_id, observed_on, chain_name, min_price, min_unit_price)
        VALUES (${watch.id}, ${now.date}, ${chainName}, ${match.promotionPrice ?? match.price}, ${match.unitPrice ?? match.promotionPrice ?? match.price})
        ON CONFLICT (watch_id, observed_on, chain_name) DO UPDATE SET
          min_price = excluded.min_price, min_unit_price = excluded.min_unit_price
      `;
    }
  }

  const currentRows = await sql`
    SELECT DISTINCT ON (w.id) w.id, recent.price, recent.chain_name AS "chainName"
    FROM price_watches w
    JOIN LATERAL (
      SELECT DISTINCT ON (price.source, price.chain_name)
        price.chain_name, COALESCE(price.promotion_price, price.price)::numeric AS price
      FROM external_price_observations price
      WHERE price.product_id = w.product_id AND price.source <> 'manual'
        AND (price.valid_until IS NULL OR price.valid_until >= CURRENT_DATE)
      ORDER BY price.source, price.chain_name, price.observed_on DESC, price.updated_at DESC
    ) recent ON true
    ORDER BY w.id, recent.price ASC, recent.chain_name ASC
  `;
  const current = new Map(currentRows.map((row) => [row.id, { price: Number(row.price), chainName: row.chainName }]));
  for (const watch of watches) {
    const currentPrice = current.get(watch.id);
    if (currentPrice) await notify(watch, previous.get(watch.id), currentPrice, now.date);
  }
  await sql`
    INSERT INTO job_state (key, value) VALUES ('external_price_refresh', ${now.date})
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()
  `;
  console.log(`Külső árfrissítés kész: ${watches.length} figyelés.`);
}

try {
  await main();
} finally {
  await sql.end({ timeout: 5 });
}
