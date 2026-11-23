import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("workers/core/index.js", "utf8");

test("scheduled tasks expose structured performance telemetry", () => {
  assert.match(source, /function observeScheduledTask\(/);
  assert.match(source, /event: "core_scheduled_task_completed"/);
  assert.match(source, /durationMs: Date\.now\(\) - startedAt/);
  assert.match(source, /ok: true/);
  assert.match(source, /ok: false/);
});

test("scheduled telemetry records known task identifiers", () => {
  for (const task of [
    "hr_payroll_recovery",
    "attendance_window_check",
    "employee_push_outbox",
    "package_expiry",
    "cashback_expiry",
    "overdue_employee_requests",
    "hourly_employee_push_outbox",
  ]) {
    assert.ok(
      source.includes(`"${task}"`),
      `Missing telemetry for ${task}`
    );
  }
});

test("push failures are observed before they are ignored", () => {
  assert.match(
    source,
    /"employee_push_outbox",\s*flushEmployeeWebPushOutbox\([\s\S]*?\)\s*\)\.catch\(\(\) => null\)/
  );

  assert.match(
    source,
    /"hourly_employee_push_outbox",\s*flushEmployeeWebPushOutbox\([\s\S]*?\)\s*\)\.catch\(\(\) => null\)/
  );
});

test("scheduled telemetry excludes raw error messages", () => {
  const helper = source.split("function observeScheduledTask(")[1]
    ?.split("export default {")[0];

  assert.ok(helper, "Telemetry helper not found");
  assert.doesNotMatch(helper, /error\.message|JSON\.stringify\(error\)/);
  assert.match(helper, /errorType:/);
});