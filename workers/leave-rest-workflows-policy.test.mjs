import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("0057 keeps annual recall and weekly-rest work as separate audited facts", () => {
  const migration = source("../migrations/core/0057_leave_rest_workflows.sql");
  assert.match(migration, /CREATE TABLE employee_leave_recalls/);
  assert.match(migration, /CREATE TABLE employee_weekly_rest_work_assignments/);
  assert.match(migration, /WHERE status = 'active'/);
  assert.match(migration, /WHERE status = 'assigned'/);
});

test("attendance blocks approved full-day leave unless recall removes that date", () => {
  const attendance = source("./attendance-worker.js");
  const workflows = source("./core/repositories/leave-rest-workflows.js");
  assert.match(attendance, /approved_leave_day/);
  assert.match(attendance, /resolveAttendanceWorkAuthorization/);
  assert.ok(
    workflows.includes("employee_leave_recalls") &&
    workflows.includes("recall_date = ?") &&
    workflows.includes("status = 'active'")
  );
});

test("weekly-rest assignment is authorized by the canonical effective shift without replacing the weekly-rest schedule", () => {
  const attendance = source("./attendance-worker.js");
  const workflows = source("./core/repositories/leave-rest-workflows.js");
  const shiftControl = source("./core/repositories/shift-control.js");
  assert.match(attendance, /resolveEmployeeShift/);
  assert.doesNotMatch(attendance, /weeklyRestAssignmentAsShift/);
  assert.match(shiftControl, /employee_weekly_rest_work_assignments/);
  assert.match(shiftControl, /weekly_rest_work_assignment/);
  assert.match(workflows, /isExplicitWeeklyRestShift/);
  assert.match(workflows, /source: 'weekly_rest_work_assignment'/);
  assert.doesNotMatch(workflows, /createScheduleException/);
});

test("completed assigned weekly-rest work creates the existing 24h due entitlement", () => {
  const workflows = source("./core/repositories/leave-rest-workflows.js");
  assert.match(workflows, /reconcileWeeklyRestDate/);
  assert.match(workflows, /confirmWeeklyRestDue/);
  assert.ok(workflows.includes("result?.attendance?.complete"));
});

test("full annual cancellation cannot double-credit active recalled dates", () => {
  const cancellation = source("./core/repositories/annual-leave-cancellation.js");
  assert.match(cancellation, /employee_leave_recalls/);
  assert.match(cancellation, /active_recalls_must_be_cancelled_first/);
});

test("Core exposes recall, weekly-rest assignment, overview, and reconciliation contracts", () => {
  const core = source("./core/index.js");
  assert.match(core, /leave:recalls/);
  assert.match(core, /leave:recall-cancel/);
  assert.match(core, /weekly-rest:work-assignments/);
  assert.match(core, /leave-rest:overview/);
  assert.match(core, /reconcileAssignedWeeklyRestWork/);
});
