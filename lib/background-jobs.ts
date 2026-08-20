import { spawn } from "node:child_process";

const globalJobs = globalThis as typeof globalThis & { otthonPriceTimer?: NodeJS.Timeout };

function runPriceImport() {
  for (const script of ["scripts/import-price-data.mjs", "scripts/refresh-external-prices.mjs"]) {
    const child = spawn(process.execPath, [script], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });
    child.on("error", (error) => console.error(`${script} process failed`, error));
  }
}

if (!globalJobs.otthonPriceTimer) {
  setTimeout(runPriceImport, 5_000).unref();
  globalJobs.otthonPriceTimer = setInterval(runPriceImport, 15 * 60_000);
  globalJobs.otthonPriceTimer.unref();
}
