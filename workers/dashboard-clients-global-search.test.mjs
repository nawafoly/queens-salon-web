import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const page = fs.readFileSync(
  new URL("../src/pages/DashboardClients.tsx", import.meta.url),
  "utf8"
);
const service = fs.readFileSync(
  new URL("../src/services/CoreClientService.ts", import.meta.url),
  "utf8"
);
const repo = fs.readFileSync(
  new URL("./core/repositories/clients.js", import.meta.url),
  "utf8"
);
const core = fs.readFileSync(
  new URL("./core/index.js", import.meta.url),
  "utf8"
);

test("dashboard client search queries Core instead of filtering only the first loaded page", () => {
  assert.match(page, /CoreClientService\.list\(searchTerm,[\s\S]*includeMetrics:\s*true/);
  assert.match(page, /const activeCoreClients = deferredQuery\.trim\(\)[\s\S]*searchClients/);
  assert.match(page, /CoreClientService\.directorySummary\(\)/);
});

test("Core client search normalizes partial Saudi phone fragments", () => {
  assert.match(repo, /function clientPhoneSearchFragment/);
  assert.match(repo, /digits\.startsWith\('05'\)/);
  assert.match(
    repo,
    /INSTR\(COALESCE\(c\.phone_normalized, ''\), \?\) > 0/
  );
});

test("client directory summary is routed through Core", () => {
  assert.match(service, /\/api\/core\/clients\/directory-summary/);
  assert.match(core, /client:directory-summary/);
  assert.match(repo, /export async function getClientDirectorySummary/);
});
