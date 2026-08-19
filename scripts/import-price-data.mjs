import { readFile } from "node:fs/promises";
import postgres from "postgres";
import webpush from "web-push";
import * as XLSX from "xlsx";

const sourceUrl = process.env.PRICE_DATA_URL
  || "https://cdnarfigyeloprodweu.azureedge.net/excel/arfigyelo_napi_termekadatok.xlsx";
const localFile = process.env.PRICE_DATA_FILE;
const force = process.env.PRICE_IMPORT_FORCE === "1";
const connectionString = process.env.DATABASE_URL;

if (!connectionString) throw new Error("DATABASE_URL szükséges az árimporthoz.");

const sql = postgres(connectionString, { max: 3, idle_timeout: 10, connect_timeout: 20, prepare: false });

function budapestParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Budapest",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date()).reduce((result, part) => ({ ...result, [part.type]: part.value }), {});
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

function decimal(value) {
  const normalized = String(value ?? "").trim().replace(/\s/g, "").replace(",", ".");
  if (!normalized || !Number.isFinite(Number(normalized))) throw new Error(`Érvénytelen szám az árlistában: ${value}`);
  return normalized;
}

function integer(value) {
  const result = Number.parseInt(String(value ?? "0"), 10);
  return Number.isFinite(result) ? result : 0;
}

async function downloadWorkbook() {
  if (localFile) return readFile(localFile);
  const response = await fetch(sourceUrl, { headers: { "user-agent": "Otthon/0.1 family-price-monitor" } });
  if (!response.ok) throw new Error(`A GVH árlista nem tölthető le (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

function parseWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("Az árlista nem tartalmaz munkalapot.");
  const dateMatch = sheetName.match(/(\d{4}-\d{2}-\d{2})/);
  if (!dateMatch) throw new Error(`Nem olvasható ki az adatdátum a munkalap nevéből: ${sheetName}`);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "", raw: false });
  const parsed = rows.map((row) => ({
    product_id: String(row["Termék azonosító"] ?? "").trim(),
    product_name: String(row["Termék név"] ?? "").trim().replace(/\s+/g, " "),
    category_id: String(row["Kategória azonosító"] ?? "").trim(),
    category_name: String(row["Kategória név"] ?? "").trim(),
    chain_name: String(row["Üzletlánc név"] ?? "").trim(),
    unit: String(row.Egység ?? "").trim(),
    package_size: decimal(row.Kiszerelés),
    min_price: decimal(row["Minimum ár"]),
    max_price: decimal(row["Maximum ár"]),
    min_unit_price: decimal(row["Minimum egységár"]),
    max_unit_price: decimal(row["Maximum egységár"]),
    store_count: integer(row["Hány boltban elérhető"]),
    total_stores: integer(row["Üzletlánc összes boltja"]),
    data_date: dateMatch[1],
  })).filter((row) => row.product_id && row.product_name && row.chain_name);
  if (parsed.length < 1_000) throw new Error(`Gyanúsan kevés ársor érkezett: ${parsed.length}`);
  return { dataDate: dateMatch[1], rows: parsed };
}

async function sendAlerts(previousPrices, dataDate) {
  const watches = await sql`
    SELECT w.id, w.created_by AS "userId", w.target_price AS "targetPrice",
      w.notify_on_drop AS "notifyOnDrop", w.last_notified_price AS "lastNotifiedPrice",
      pc.product_name AS "productName", pc.chain_name AS "chainName", pc.max_price AS "bestPrice"
    FROM price_watches w
    JOIN LATERAL (
      SELECT product_name, chain_name, max_price
      FROM price_catalog WHERE product_id = w.product_id
      ORDER BY max_price::numeric ASC, chain_name ASC LIMIT 1
    ) pc ON true
  `;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (publicKey && privateKey) {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:admin@example.invalid", publicKey, privateKey);
  }

  for (const watch of watches) {
    const current = Number(watch.bestPrice);
    const previous = previousPrices.get(watch.id);
    const target = watch.targetPrice == null ? null : Number(watch.targetPrice);
    const lastNotified = watch.lastNotifiedPrice == null ? null : Number(watch.lastNotifiedPrice);
    const dropped = watch.notifyOnDrop && previous != null && current < previous;
    const targetReached = target != null && current <= target && (lastNotified == null || current < lastNotified);
    if ((!dropped && !targetReached) || lastNotified === current) continue;

    if (publicKey && privateKey) {
      const subscriptions = await sql`
        SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ${watch.userId}
      `;
      const difference = previous == null ? null : previous - current;
      const body = difference && difference > 0
        ? `${watch.productName}: ${Math.round(previous).toLocaleString("hu-HU")} Ft → ${Math.round(current).toLocaleString("hu-HU")} Ft · ${watch.chainName}`
        : `${watch.productName}: ${Math.round(current).toLocaleString("hu-HU")} Ft · ${watch.chainName}`;
      await Promise.all(subscriptions.map(async (subscription) => {
        try {
          await webpush.sendNotification({
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          }, JSON.stringify({ title: "Árfigyelő: olcsóbb lett", body, url: "/", tag: `price-${watch.id}-${dataDate}` }), { TTL: 86_400 });
        } catch (error) {
          if (error?.statusCode === 404 || error?.statusCode === 410) {
            await sql`DELETE FROM push_subscriptions WHERE id = ${subscription.id}`;
          } else {
            console.error("Price push failed", watch.id, error);
          }
        }
      }));
    }
    await sql`UPDATE price_watches SET last_notified_price = ${current}, updated_at = now() WHERE id = ${watch.id}`;
  }
}

async function main() {
  const now = budapestParts();
  if (!force && now.minutes < 315) {
    console.log("Árimport kihagyva: Budapesten még nincs 05:15.");
    return;
  }
  // A korábbi verzió minimumárat mentett ugyanebbe a történeti mezőbe.
  // Az aktuális katalógusból helyreigazítjuk, így a grafikon már az első naptól
  // ugyanazt a konzervatív maximumár-logikát követi.
  await sql`
    UPDATE price_watch_history history SET
      min_price = catalog.max_price,
      min_unit_price = catalog.max_unit_price
    FROM price_watches watch, price_catalog catalog
    WHERE history.watch_id = watch.id
      AND catalog.product_id = watch.product_id
      AND history.chain_name = catalog.chain_name
      AND history.observed_on = catalog.data_date
  `;
  const state = await sql`SELECT value FROM job_state WHERE key = 'gvh_price_import' LIMIT 1`;
  if (!force && state[0]?.value === now.date) {
    console.log(`Árimport már elkészült erre a napra: ${now.date}`);
    return;
  }

  const previousRows = await sql`
    SELECT w.id, min(pc.max_price::numeric) AS price
    FROM price_watches w LEFT JOIN price_catalog pc ON pc.product_id = w.product_id
    GROUP BY w.id
  `;
  const previousPrices = new Map(previousRows.filter((row) => row.price != null).map((row) => [row.id, Number(row.price)]));
  const { dataDate, rows } = parseWorkbook(await downloadWorkbook());

  await sql.begin(async (tx) => {
    await tx`CREATE TEMP TABLE price_catalog_import (LIKE price_catalog INCLUDING DEFAULTS) ON COMMIT DROP`;
    const columns = [
      "product_id", "product_name", "category_id", "category_name", "chain_name", "unit",
      "package_size", "min_price", "max_price", "min_unit_price", "max_unit_price",
      "store_count", "total_stores", "data_date",
    ];
    for (let offset = 0; offset < rows.length; offset += 300) {
      await tx`INSERT INTO price_catalog_import ${tx(rows.slice(offset, offset + 300), ...columns)}`;
    }
    await tx`DELETE FROM price_catalog`;
    await tx`
      INSERT INTO price_catalog (
        product_id, product_name, category_id, category_name, chain_name, unit,
        package_size, min_price, max_price, min_unit_price, max_unit_price,
        store_count, total_stores, data_date
      )
      SELECT product_id, product_name, category_id, category_name, chain_name, unit,
        package_size, min_price, max_price, min_unit_price, max_unit_price,
        store_count, total_stores, data_date
      FROM price_catalog_import
    `;
    await tx`
      INSERT INTO price_watch_history (watch_id, observed_on, chain_name, min_price, min_unit_price)
      SELECT w.id, pc.data_date, pc.chain_name, pc.max_price, pc.max_unit_price
      FROM price_watches w JOIN price_catalog pc ON pc.product_id = w.product_id
      ON CONFLICT (watch_id, observed_on, chain_name) DO UPDATE SET
        min_price = excluded.min_price, min_unit_price = excluded.min_unit_price
    `;
    await tx`
      INSERT INTO job_state (key, value) VALUES ('gvh_price_import', ${now.date})
      ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()
    `;
  });

  await sendAlerts(previousPrices, dataDate);
  console.log(`GVH árimport kész: ${dataDate}, ${rows.length} sor.`);
}

try {
  await main();
} finally {
  await sql.end({ timeout: 5 });
}
