import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(
  new URL("../src/pages/DashboardAttendanceSecurity.tsx", import.meta.url),
  "utf8"
);

test("only shared-device alerts with a device identifier are grouped", () => {
  assert.match(page, /event\.eventType === "shared_device" && event\.deviceId/);
  assert.match(page, /\`shared:\$\{event\.deviceId\}\`/);
  assert.match(page, /\`event:\$\{event\.id\}\`/);
});

test("group summary shows counts from existing dashboard data and remains expandable", () => {
  assert.match(page, /<details className="dsv2-card dsv2-card--padded is-critical">/);
  assert.match(page, /group\.device\.assignments\.length/);
  assert.match(page, /group\.device\.allowedRecords/);
  assert.match(page, /group\.device\.rejectedRecords/);
  assert.match(page, /group\.events\.map\(\(event\) =>/);
});

test("alert actions remain per individual event, not per device group", () => {
  assert.match(page, /eventId: event\.id, status/);
  assert.match(page, /setAlertStatus\(event, "resolved"\)/);
  assert.match(page, /setAlertStatus\(event, "ignored"\)/);
  assert.doesNotMatch(page, /updateAttendanceSecurityEventStatus\(\{ deviceId:/);
});
