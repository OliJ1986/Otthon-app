import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function json(path) {
  return JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), "utf8"));
}

test("a web szolgáltatás migrál, indul és healthchecket ad", async () => {
  const config = await json("railway.json");
  assert.equal(config.build.builder, "RAILPACK");
  assert.equal(config.deploy.preDeployCommand, "npm run db:migrate");
  assert.equal(config.deploy.startCommand, "npm start");
  assert.equal(config.deploy.healthcheckPath, "/api/health");
});

test("az emlékeztető külön, befejeződő cron feladat", async () => {
  const config = await json("railway.cron.json");
  assert.equal(config.deploy.startCommand, "npm run reminders:send");
  assert.equal(config.deploy.restartPolicyType, "NEVER");
});

test("a családi aktivitások a másik felhasználónak szólnak, az esemény pedig mindig jelez 15 perccel előtte", async () => {
  const householdApi = await readFile(new URL("../app/api/household/route.ts", import.meta.url), "utf8");
  const priceApi = await readFile(new URL("../app/api/prices/route.ts", import.meta.url), "utf8");
  const push = await readFile(new URL("../lib/push.ts", import.meta.url), "utf8");
  const reminders = await readFile(new URL("../scripts/send-reminders.mjs", import.meta.url), "utf8");
  assert.match(push, /sendPushToOtherUsers/);
  assert.match(push, /WHERE user_id <> \$\{excludedUserId\}/);
  assert.match(householdApi, /title: "Új esemény"/);
  assert.match(householdApi, /title: "Új házimunka"/);
  assert.match(householdApi, /title: "Új a bevásárlólistán"/);
  assert.match(householdApi, /title: "Házimunka elkészült"/);
  assert.match(priceApi, /title: "Új a bevásárlólistán"/);
  assert.match(reminders, /new Set\(\[15,/);
  assert.match(reminders, /event:\$\{event\.id\}:\$\{occurrence\}:\$\{minutes\}/);
});

test("az elmaradt házimunka másnapra átkerül és az ismétlődő feladat új esedékességet kap", async () => {
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../drizzle/0003_conscious_luke_cage.sql", import.meta.url), "utf8");
  const householdApi = await readFile(new URL("../app/api/household/route.ts", import.meta.url), "utf8");
  const app = await readFile(new URL("../app/OtthonApp.tsx", import.meta.url), "utf8");
  assert.match(schema, /dueDate: date\("due_date"/);
  assert.match(migration, /ALTER TABLE "chores" ADD COLUMN "due_date"/);
  assert.match(migration, /WHEN "repeat_rule" = 'weekly'.*"completed_on" \+ 7/);
  assert.match(householdApi, /function nextChoreDueDate/);
  assert.match(householdApi, /due_date = \$\{dueDate\}/);
  assert.match(householdApi, /left\.dueDate\.localeCompare\(right\.dueDate\)/);
  assert.match(app, /Tegnapról áthozva/);
  assert.match(app, /napja elmaradt/);
  assert.match(app, /type="date" value=\{draft\.dueDate\}/);
});

test("a cron az események mellett a napi árforrásokat is feldolgozza", async () => {
  const packageJson = await json("package.json");
  assert.equal(packageJson.scripts["reminders:send"], "node scripts/run-jobs.mjs");
  assert.equal(packageJson.scripts["prices:import"], "node scripts/import-price-data.mjs");
  const importer = await readFile(new URL("../scripts/import-price-data.mjs", import.meta.url), "utf8");
  const externalRefresh = await readFile(new URL("../scripts/refresh-external-prices.mjs", import.meta.url), "utf8");
  const runner = await readFile(new URL("../scripts/run-jobs.mjs", import.meta.url), "utf8");
  const instrumentation = await readFile(new URL("../lib/background-jobs.ts", import.meta.url), "utf8");
  assert.match(importer, /arfigyelo_napi_termekadatok\.xlsx/);
  assert.match(importer, /price_watch_history/);
  assert.match(importer, /05:15/);
  assert.match(externalRefresh, /external_price_observations/);
  assert.match(externalRefresh, /xapi\.tesco\.com/);
  assert.match(externalRefresh, /lidl\.hu\/q\/api\/search/);
  assert.match(runner, /refresh-external-prices\.mjs/);
  assert.match(instrumentation, /15 \* 60_000/);
});

test("az árfigyelő konzervatívan a lánconkénti maximumárral számol", async () => {
  const importer = await readFile(new URL("../scripts/import-price-data.mjs", import.meta.url), "utf8");
  const priceApi = await readFile(new URL("../app/api/prices/route.ts", import.meta.url), "utf8");
  const householdApi = await readFile(new URL("../app/api/household/route.ts", import.meta.url), "utf8");
  assert.match(importer, /min\(pc\.max_price::numeric\) AS price/);
  assert.match(importer, /ORDER BY max_price::numeric ASC/);
  assert.match(importer, /pc\.max_price, pc\.max_unit_price/);
  assert.match(priceApi, /min\(max_price::numeric\)::text AS "bestPrice"/);
  assert.match(priceApi, /ORDER BY max_price::numeric ASC/);
  assert.match(householdApi, /ORDER BY max_price ASC NULLS LAST/);
});

test("a többforrású keresés a terméket és az ár eredetét külön kezeli", async () => {
  const sources = await readFile(new URL("../lib/product-sources.ts", import.meta.url), "utf8");
  const priceApi = await readFile(new URL("../app/api/prices/route.ts", import.meta.url), "utf8");
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  assert.match(sources, /world\.openfoodfacts\.org\/api\/v2\/product/);
  assert.match(sources, /operationName: "Search"/);
  assert.match(sources, /promotionPrice/);
  assert.match(priceApi, /payload\?\.action === "recordPrice"/);
  assert.match(priceApi, /payload\?\.action === "createManualWatch"/);
  assert.match(priceApi, /C(?:OALESCE|oalesce)\(promotion_price, price\)/i);
  assert.match(schema, /external_price_observations/);
  assert.match(schema, /validUntil: date\("valid_until"/);
});

test("az ajánlatok ár szerint rendeződnek és a külső lekérések három napig cache-eltek", async () => {
  const priceApi = await readFile(new URL("../app/api/prices/route.ts", import.meta.url), "utf8");
  const app = await readFile(new URL("../app/OtthonApp.tsx", import.meta.url), "utf8");
  assert.match(priceApi, /function sortedOffers/);
  assert.match(priceApi, /offerPrice\(left\) - offerPrice\(right\)/);
  assert.match(priceApi, /cachedBarcodeReference/);
  assert.match(priceApi, /cachedExternalTextResults/);
  assert.match(priceApi, /interval '3 days'/);
  assert.match(priceApi, /observed_on >= CURRENT_DATE - 3/);
  assert.match(app, /function SearchOfferList/);
  assert.match(app, /gyorsítótárból/);
});

test("a vonalkód egy lépésben terméket és árfigyelést hoz létre", async () => {
  const packageJson = await json("package.json");
  const priceApi = await readFile(new URL("../app/api/prices/route.ts", import.meta.url), "utf8");
  const app = await readFile(new URL("../app/OtthonApp.tsx", import.meta.url), "utf8");
  assert.match(packageJson.dependencies["@zxing/browser"], /^\^0\.1\./);
  assert.match(priceApi, /searchParams\.get\("barcode"\)/);
  assert.match(priceApi, /trim\(leading '0' from product_id\)/);
  assert.match(priceApi, /payload\?\.action === "addToShopping"/);
  assert.match(priceApi, /INSERT INTO shopping_items/);
  assert.match(priceApi, /INSERT INTO price_watches/);
  assert.match(app, /BarcodeFormat\.EAN_13/);
  assert.match(app, /facingMode: \{ ideal: "environment" \}/);
});

test("az Otthon 2.0 felület napszakos, sötét módban is olvasható és kíméli a mozgásérzékeny felhasználókat", async () => {
  const app = await readFile(new URL("../app/OtthonApp.tsx", import.meta.url), "utf8");
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(app, /type DayPhase = "morning" \| "day" \| "evening" \| "night"/);
  assert.match(app, /app-shell phase-\$\{phase\}/);
  assert.match(app, /function greeting/);
  assert.match(styles, /Otthon 2\.0/);
  assert.match(styles, /@media \(prefers-color-scheme: dark\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /backdrop-filter: blur\(30px\) saturate\(190%\)/);
  assert.match(layout, /prefers-color-scheme: dark/);
});

test("az időjárás Tatabányáról indul, hét napot mutat és közös városbeállítást ment", async () => {
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../drizzle/0006_weather_settings.sql", import.meta.url), "utf8");
  const weatherApi = await readFile(new URL("../app/api/weather/route.ts", import.meta.url), "utf8");
  const app = await readFile(new URL("../app/OtthonApp.tsx", import.meta.url), "utf8");
  assert.match(schema, /export const weatherSettings = pgTable\("weather_settings"/);
  assert.match(migration, /CREATE TABLE "weather_settings"/);
  assert.match(weatherApi, /name: "Tatabánya"/);
  assert.match(weatherApi, /forecast_days: "7"/);
  assert.match(weatherApi, /revalidate: 1_800/);
  assert.match(weatherApi, /geocoding-api\.open-meteo\.com\/v1\/search/);
  assert.match(weatherApi, /ON CONFLICT \(id\) DO UPDATE/);
  assert.match(app, /function WeatherCard/);
  assert.match(app, /function WeatherSheet/);
  assert.match(app, /A választás minden családtagnál megjelenik/);
});

test("a kivezetett Hova tettem modul felülete, API-ja és táblái is eltűnnek", async () => {
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../drizzle/0005_icy_spirit.sql", import.meta.url), "utf8");
  const householdApi = await readFile(new URL("../app/api/household/route.ts", import.meta.url), "utf8");
  const app = await readFile(new URL("../app/OtthonApp.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(schema, /export const storedItems = pgTable/);
  assert.doesNotMatch(schema, /export const storedItemHistory = pgTable/);
  assert.match(migration, /DROP TABLE "stored_item_history" CASCADE/);
  assert.match(migration, /DROP TABLE "stored_items" CASCADE/);
  assert.doesNotMatch(householdApi, /storedItems|stored_items|stored_item_history/);
  assert.doesNotMatch(app, /Hova tettem|Hol van\?|\/api\/storage|type Tab = .*storage/);
});

test("a példakörnyezet nem tartalmaz valódi titkot", async () => {
  const example = await readFile(new URL("../.env.example", import.meta.url), "utf8");
  assert.match(example, /DATABASE_URL=/);
  assert.match(example, /VAPID_PUBLIC_KEY=\n/);
  assert.match(example, /VAPID_PRIVATE_KEY=\n/);
  assert.doesNotMatch(example, /sk-[A-Za-z0-9]/);
});
