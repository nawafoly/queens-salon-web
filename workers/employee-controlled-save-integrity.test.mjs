import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) =>
  readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");

test("employee multi-command save tracks committed stages", () => {
  const source = read("src/pages/DashboardEmployees.tsx");

  assert.match(source, /EMPLOYEE_CONTROLLED_SAVE_V1/);
  assert.match(source, /employeeSaveOperationId = crypto\.randomUUID\(\)/);
  assert.match(source, /employeeMasterCommitted = true/);
  assert.match(source, /workingHourExceptionsCommitted = true/);
  assert.match(source, /schedulesCommitted = true/);
  assert.match(source, /employeeSaveStage = "verified"/);
});

test("partial or ambiguous employee save reconciles against Core", () => {
  const source = read("src/pages/DashboardEmployees.tsx");

  assert.match(source, /core_api:write_outcome_unknown/);
  assert.match(source, /partialOrAmbiguousSave/);
  assert.match(source, /CoreHrService\.getEmployee\(targetEmployeeId\)/);
  assert.match(
    source,
    /CoreHrService\.listScheduleExceptions\(\{[\s\S]*employeeId: targetEmployeeId/
  );
  assert.match(source, /setCoreScheduleRows\(canonicalSchedules\)/);
  assert.match(source, /setCoreScheduleExceptionRows\(canonicalExceptions\)/);
  assert.match(source, /queens:core-reconciled/);
});

test("pre-commit failure preserves normal error path", () => {
  const source = read("src/pages/DashboardEmployees.tsx");

  assert.match(
    source,
    /if \(partialOrAmbiguousSave\)[\s\S]*else \{[\s\S]*toFirestoreErrorMessage/
  );
});
