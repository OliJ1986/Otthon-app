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

test("a példakörnyezet nem tartalmaz valódi titkot", async () => {
  const example = await readFile(new URL("../.env.example", import.meta.url), "utf8");
  assert.match(example, /DATABASE_URL=/);
  assert.match(example, /VAPID_PUBLIC_KEY=\n/);
  assert.match(example, /VAPID_PRIVATE_KEY=\n/);
  assert.doesNotMatch(example, /sk-[A-Za-z0-9]/);
});
