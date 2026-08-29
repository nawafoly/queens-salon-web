import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const projectRoot = process.cwd();
const wranglerBin = resolve(projectRoot, "node_modules", "wrangler", "bin", "wrangler.js");
const coreDevConfig = resolve(projectRoot, "wrangler.core.dev.jsonc");
const partnersDevConfig = resolve(projectRoot, "wrangler.partners.dev.jsonc");
const generatedCoreConfig = resolve(projectRoot, ".wrangler.core.setup.local.generated.jsonc");

function fail(message) {
  console.error(`\n[dev:setup] FAIL — ${message}`);
  process.exit(1);
}

function runWrangler(label, args, options = {}) {
  console.log(`\n[dev:setup] ${label}`);
  const result = spawnSync(process.execPath, [wranglerBin, ...args], {
    cwd: projectRoot,
    shell: false,
    env: process.env,
    ...options,
  });

  if (result.error) fail(`${label}: ${result.error.message}`);
  if (result.status !== 0) fail(`${label} exited with code ${result.status ?? "unknown"}`);
  return result;
}

function run(label, args) {
  runWrangler(label, args, { stdio: "inherit" });
}

function runJson(label, args) {
  const result = runWrangler(label, args, { encoding: "utf8" });
  if (result.stderr) process.stderr.write(result.stderr);

  try {
    return JSON.parse(result.stdout || "null");
  } catch {
    fail(`${label}: Wrangler did not return valid JSON.`);
  }
}

function findNumericValue(value, key) {
  if (!value || typeof value !== "object") return null;
  if (Object.prototype.hasOwnProperty.call(value, key)) {
    const numeric = Number(value[key]);
    if (Number.isFinite(numeric)) return numeric;
  }
  for (const nested of Object.values(value)) {
    const found = findNumericValue(nested, key);
    if (found !== null) return found;
  }
  return null;
}

function createLocalOnlyCoreConfig() {
  const source = readFileSync(coreDevConfig, "utf8");
  const localOnly = source.replace(
    /^\s*"remote"\s*:\s*true\s*,?\s*(?:\r?\n|$)/gm,
    ""
  );
  writeFileSync(generatedCoreConfig, localOnly, "utf8");
}

console.log("[dev:setup] Queens Salon local development bootstrap");
console.log(`[dev:setup] Node ${process.version}`);

if (!existsSync(resolve(projectRoot, "node_modules"))) {
  fail("node_modules is missing. Run npm install once, then rerun npm run dev:setup.");
}
if (!existsSync(wranglerBin)) {
  fail("Local Wrangler is missing. Run npm install once, then rerun npm run dev:setup.");
}
if (!existsSync(coreDevConfig)) {
  fail("wrangler.core.dev.jsonc is missing on this device.");
}
if (!existsSync(partnersDevConfig)) {
  fail("wrangler.partners.dev.jsonc is missing on this device.");
}

try {
  createLocalOnlyCoreConfig();

  run("Apply pending Core D1 migrations locally", [
    "d1",
    "migrations",
    "apply",
    "queens-salon-core",
    "--local",
    "--config",
    generatedCoreConfig,
  ]);

  run("Verify Core D1 migration state", [
    "d1",
    "migrations",
    "list",
    "queens-salon-core",
    "--local",
    "--config",
    generatedCoreConfig,
  ]);

  const accountResult = runJson("Verify an active internal account exists locally", [
    "d1",
    "execute",
    "queens-salon-core",
    "--local",
    "--config",
    generatedCoreConfig,
    "--json",
    "--command",
    "SELECT COUNT(*) AS active_internal_accounts FROM app_users WHERE salon_id = 'main' AND status = 'active' AND primary_role IN ('owner','admin','hr','accountant','reception','staff');",
  ]);

  const activeInternalAccounts = findNumericValue(accountResult, "active_internal_accounts");
  if (!Number.isFinite(activeInternalAccounts) || activeInternalAccounts < 1) {
    fail("No active internal Core account exists in the local D1 database on this device.");
  }
  console.log(`[dev:setup] Active internal accounts: ${activeInternalAccounts}`);

  console.log("\n[dev:setup] PASS — local Core D1 is migrated, an active internal account exists, and the device configs are present.");
  console.log("[dev:setup] Next: npm run dev");
} finally {
  rmSync(generatedCoreConfig, { force: true });
}
