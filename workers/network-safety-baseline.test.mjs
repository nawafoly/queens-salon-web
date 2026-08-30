import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) =>
  readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");

test("Core API blocks definite offline writes and classifies ambiguous writes", () => {
  const source = read("src/services/coreApiClient.ts");

  assert.match(source, /CORE_NETWORK_SAFETY_V1/);
  assert.match(source, /navigator\.onLine === false/);
  assert.match(source, /core_api:offline/);
  assert.match(source, /core_api:network_unavailable/);
  assert.match(source, /core_api:write_outcome_unknown/);
  assert.match(source, /emitUnknownWriteOutcome\(path, method\)/);
  assert.match(source, /error\.status === 401/);
});

test("global network banner distinguishes offline and unknown write outcomes", () => {
  const banner = read("src/components/NetworkSafetyBanner.tsx");
  const app = read("src/App.tsx");

  assert.match(banner, /queens:core-write-outcome-unknown/);
  assert.match(banner, /window\.addEventListener\("offline", onOffline\)/);
  assert.match(banner, /window\.addEventListener\("online", onOnline\)/);
  assert.match(banner, /queens:core-network-reconnected/);
  assert.match(banner, /queens:core-reconciled/);
  assert.match(app, /<NetworkSafetyBanner \/>/);
});

test("employee workspace re-fetches canonical schedule state after reconnect", () => {
  const source = read("src/pages/DashboardEmployees.tsx");

  assert.match(source, /EMPLOYEE_NETWORK_RECONCILIATION_V1/);
  assert.match(source, /queens:core-network-reconnected/);
  assert.match(source, /CoreHrService\.getEmployee\(employeeId\)/);
  assert.match(
    source,
    /CoreHrService\.listScheduleExceptions\(\{ employeeId \}\)/
  );
  assert.match(source, /setCoreScheduleExceptionRows\(exceptionRows\)/);
  assert.match(source, /queens:core-reconciled/);
});
