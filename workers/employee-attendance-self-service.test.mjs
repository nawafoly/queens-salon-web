import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  evaluateCheckInWindow,
} from "./attendance-worker.js";

async function source(path) {
  return readFile(
    new URL(`../${path}`, import.meta.url),
    "utf8"
  );
}

test("employee attendance portal uses self-service Core routes only", async () => {
  const portal = await source(
    "src/pages/hr/EmployeeOverview.tsx"
  );

  assert.doesNotMatch(
    portal,
    /CoreHrService\.listAbsences\(/
  );

  assert.doesNotMatch(
    portal,
    /CoreHrService\.resolveEmployeeShiftsRange\(/
  );

  assert.doesNotMatch(
    portal,
    /attendanceCoreEmployeeId/
  );

  assert.match(
    portal,
    /CoreHrService\.listMyAbsences\(\)/
  );

  assert.match(
    portal,
    /CoreHrService\.resolveMyShiftsRange\(/
  );

  assert.match(
    portal,
    /canAttemptCheckInWithServerValidation/
  );
});

test("Core exposes identity-bound attendance self-service routes", async () => {
  const core = await source(
    "workers/core/index.js"
  );

  assert.match(
    core,
    /\/api\/core\/hr\/employee-portal\/absences/
  );

  assert.match(
    core,
    /\/api\/core\/hr\/employee-portal\/resolved-shifts/
  );

  assert.match(
    core,
    /attendance\.own\.view/
  );

  assert.match(
    core,
    /requestedEmployeeId[\s\S]*requestedEmployeeId !== ownEmployeeId[\s\S]*403[\s\S]*core_attendance:cross_employee_forbidden/
  );

  assert.match(
    core,
    /employeeIds:\s*\[\s*ownEmployeeId\s*,?\s*\]/
  );
});

test("administrative attendance routes remain permission protected", async () => {
  const core = await source(
    "workers/core/index.js"
  );

  assert.match(
    core,
    /\/api\/core\/hr\/absences/
  );

  assert.match(
    core,
    /attendance\.absences\.manage/
  );

  assert.match(
    core,
    /\/api\/core\/hr\/resolved-shifts\/batch/
  );

  assert.match(
    core,
    /employees\.schedule\.manage/
  );
});

test("CoreHrService self calls never send browser-selected employee identity", async () => {
  const service = await source(
    "src/services/CoreHrService.ts"
  );

  assert.match(
    service,
    /async listMyAbsences\(\)/
  );

  assert.match(
    service,
    /\/api\/core\/hr\/employee-portal\/absences/
  );

  assert.match(
    service,
    /async resolveMyShiftsRange\(/
  );

  assert.match(
    service,
    /\/api\/core\/hr\/employee-portal\/resolved-shifts/
  );
});

test("check-in fails closed without canonical Core shift", () => {
  assert.deepEqual(
    evaluateCheckInWindow({
      type: "check_in",
      now: "2026-08-27T06:00:00.000Z",
      shift: null,
    }),
    {
      result: "rejected",
      rejectionReason:
        "core_shift_resolution_unavailable",
    }
  );

  assert.deepEqual(
    evaluateCheckInWindow({
      type: "check_in",
      now: "2026-08-27T06:00:00.000Z",
      shift: {
        source: "none",
      },
    }),
    {
      result: "rejected",
      rejectionReason:
        "not_scheduled_workday",
    }
  );

  assert.equal(
    evaluateCheckInWindow({
      type: "check_out",
      now: "2026-08-27T06:00:00.000Z",
      shift: null,
    }).result,
    "allowed"
  );
});

test("late, leave and exception calendar colors are distinct", async () => {
  const css = await source(
    "src/styles/dashboard-v2/components/employee-attendance-month-status.css"
  );

  assert.match(
    css,
    /\.is-late[\s\S]*#d97706/
  );

  assert.match(
    css,
    /\.is-leave[\s\S]*#7c3aed/
  );

  assert.match(
    css,
    /\.is-exception[\s\S]*#0369a1/
  );

  assert.notEqual(
    "#d97706",
    "#7c3aed"
  );
});
