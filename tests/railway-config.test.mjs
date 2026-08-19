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

test("a cron az események mellett a GVH napi árlistát is feldolgozza", async () => {
  const packageJson = await json("package.json");
  assert.equal(packageJson.scripts["reminders:send"], "node scripts/run-jobs.mjs");
  assert.equal(packageJson.scripts["prices:import"], "node scripts/import-price-data.mjs");
  const importer = await readFile(new URL("../scripts/import-price-data.mjs", import.meta.url), "utf8");
  const instrumentation = await readFile(new URL("../lib/background-jobs.ts", import.meta.url), "utf8");
  assert.match(importer, /arfigyelo_napi_termekadatok\.xlsx/);
  assert.match(importer, /price_watch_history/);
  assert.match(importer, /05:15/);
  assert.match(instrumentation, /15 \* 60_000/);
});

test("az árfigyelő konzervatívan a lánconkénti maximumárral számol", async () => {
  const importer = await readFile(new URL("../scripts/import-price-data.mjs", import.meta.url), "utf8");
  const priceApi = await readFile(new URL("../app/api/prices/route.ts", import.meta.url), "utf8");
  const householdApi = await readFile(new URL("../app/api/household/route.ts", import.meta.url), "utf8");
  assert.match(importer, /min\(pc\.max_price::numeric\) AS price/);
  assert.match(importer, /ORDER BY max_price::numeric ASC/);
  assert.match(importer, /pc\.max_price, pc\.max_unit_price/);
  assert.match(priceApi, /min\(max_price::numeric\) AS "bestPrice"/);
  assert.match(priceApi, /ORDER BY pc\.max_price::numeric ASC/);
  assert.match(householdApi, /ORDER BY max_price::numeric ASC/);
});

test("a példakörnyezet nem tartalmaz valódi titkot", async () => {
  const example = await readFile(new URL("../.env.example", import.meta.url), "utf8");
  assert.match(example, /DATABASE_URL=/);
  assert.match(example, /VAPID_PUBLIC_KEY=\n/);
  assert.match(example, /VAPID_PRIVATE_KEY=\n/);
  assert.doesNotMatch(example, /sk-[A-Za-z0-9]/);
});
