import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/pages/Dashboard.tsx", "utf8");

test("dashboard snapshot cache carries verified identity and effective-permission scope", () => {
  assert.match(source, /cacheUid:\s*string/);
  assert.match(source, /cacheRole:\s*UiRole/);
  assert.match(source, /cachePermissionsFingerprint:\s*string/);
});

test("dashboard does not hydrate sensitive cache during unverified component bootstrap", () => {
  assert.doesNotMatch(
    source,
    /const initialDashboardSnapshot = readDashboardViewCache\(\)/
  );
});

test("dashboard consumes effective permissions from PermissionContext", () => {
  assert.match(
    source,
    /const\s*\{\s*[^}]*permissions[^}]*\}\s*=\s*usePermissions\(\)/
  );
});

test("dashboard cache scope fingerprint is derived deterministically from effective permissions", () => {
  assert.match(source, /function dashboardPermissionsFingerprint/);
  assert.match(source, /\.sort\(\)/);
  assert.match(source, /\.join\(/);
});

test("dashboard cache read requires verified identity and access scope", () => {
  assert.match(
    source,
    /function readDashboardViewCache\(\s*scope:\s*DashboardCacheScope/
  );
  assert.match(source, /cacheUid !== scope\.uid/);
  assert.match(source, /cacheRole !== scope\.role/);
  assert.match(
    source,
    /cachePermissionsFingerprint !== scope\.permissionsFingerprint/
  );
});

test("dashboard cache write records verified identity and access scope", () => {
  assert.match(source, /cacheUid:\s*scope\.uid/);
  assert.match(source, /cacheRole:\s*scope\.role/);
  assert.match(
    source,
    /cachePermissionsFingerprint:\s*scope\.permissionsFingerprint/
  );
});

test("dashboard starts sensitive cached state empty until verified scope is available", () => {
  assert.match(
    source,
    /const \[stats,\s*setStats\] = useState<DashboardStats>\(emptyDashboardStats\)/
  );
  assert.match(
    source,
    /const \[allScheduleBookings,\s*setAllScheduleBookings\] = useState<Booking\[\]>\(\[\]\)/
  );
  assert.match(
    source,
    /const hasDashboardDataRef = useRef\(false\)/
  );
});