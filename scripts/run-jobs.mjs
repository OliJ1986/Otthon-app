import { spawnSync } from "node:child_process";

function run(script, required) {
  const result = spawnSync(process.execPath, [script], { stdio: "inherit", env: process.env });
  if (result.status !== 0) {
    console.error(`${script} hibával állt le.`);
    if (required) process.exit(result.status || 1);
  }
}

run("scripts/import-price-data.mjs", false);
run("scripts/send-reminders.mjs", true);
