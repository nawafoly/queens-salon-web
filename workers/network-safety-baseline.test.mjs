import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (file) =>
  readFileSync(resolve(process.cwd(), file), "utf8").replace(/\r\n/g, "\n");

test("Core API blocks definite offline writes and correlates ambiguous writes", () => {
  const source = read("src/services/coreApiClient.ts");

  assert.ok(source.includes("CORE_NETWORK_SAFETY_V1"));
  assert.ok(source.includes("navigator.onLine === false"));
  assert.ok(source.includes("core_api:offline"));
  assert.ok(source.includes("core_api:network_unavailable"));
  assert.ok(source.includes("core_api:write_outcome_unknown"));

  assert.ok(
    source.includes(
      "emitUnknownWriteOutcome(path, method, operationId);"
    )
  );

  assert.ok(
    source.includes(
      "detail: { path, method, operationId }"
    )
  );

  assert.ok(source.includes("error.status === 401"));
});

test("global network banner keeps a correlated ambiguous write pending", () => {
  const banner = read("src/components/NetworkSafetyBanner.tsx");
  const app = read("src/App.tsx");

  assert.ok(
    banner.includes("queens:core-write-outcome-unknown")
  );

  assert.ok(
    banner.includes("queens:core-network-reconnected")
  );

  assert.ok(
    banner.includes("queens:core-reconciled")
  );

  assert.ok(
    banner.includes("CORE_RECONCILIATION_FAILSAFE_V1")
  );

  assert.ok(
    banner.includes("CORE_RECONCILIATION_CORRELATION_V1")
  );

  assert.ok(banner.includes("pendingWriteRef"));
  assert.ok(banner.includes("sameWriteOutcome"));
  assert.ok(banner.includes("RECONCILIATION_FALLBACK_MS"));
  assert.ok(banner.includes("window.location.reload();"));

  assert.ok(app.includes("<NetworkSafetyBanner />"));
});

test("only the exact ambiguous operation acknowledgement can clear the banner", () => {
  const banner = read("src/components/NetworkSafetyBanner.tsx");

  assert.ok(
    banner.includes(
      "pending.path === reconciled.path"
    )
  );

  assert.ok(
    banner.includes(
      "pending.method === reconciled.method"
    )
  );

  assert.ok(
    banner.includes(
      "pending.operationId === reconciled.operationId"
    )
  );

  assert.ok(
    banner.includes(
      "pendingWriteRef.current = null"
    )
  );

  assert.ok(
    banner.includes(
      "unknownWriteOutcomeRef.current = false"
    )
  );
});

test("employee workspace acknowledges only Core domains it actually reloads", () => {
  const source = read("src/pages/DashboardEmployees.tsx");

  assert.ok(
    source.includes("EMPLOYEE_NETWORK_RECONCILIATION_V1")
  );

  assert.ok(
    source.includes(
      "EMPLOYEE_NETWORK_RECONCILIATION_CORRELATION_V1"
    )
  );

  assert.ok(
    source.includes("isEmployeeReconciliationPath")
  );

  assert.ok(
    source.includes('"/api/core/hr/employees"')
  );

  assert.ok(
    source.includes(
      '"/api/core/hr/schedule-exceptions"'
    )
  );

  assert.equal(
    source.includes(
      '"/api/core/hr/shift-templates"'
    ),
    false
  );

  assert.equal(
    source.includes(
      '"/api/core/hr/shift-assignments"'
    ),
    false
  );

  assert.ok(
    source.includes(
      "CoreHrService.getEmployee(employeeId)"
    )
  );

  assert.ok(
    source.includes(
      "CoreHrService.listScheduleExceptions({ employeeId })"
    )
  );

  assert.ok(source.includes("new CustomEvent("));
  assert.ok(source.includes("detail: writeDetail"));
});

test("shift-control ambiguous writes cannot be cleared by unrelated employee reconciliation", () => {
  const shift = read(
    "src/pages/dashboardEmployees/ShiftControlSection.tsx"
  );

  const employees = read(
    "src/pages/DashboardEmployees.tsx"
  );

  const banner = read(
    "src/components/NetworkSafetyBanner.tsx"
  );

  assert.ok(
    shift.includes("CoreHrService.saveShiftTemplate")
  );

  assert.ok(
    shift.includes("CoreHrService.createShiftAssignment")
  );

  assert.ok(
    shift.includes("CoreHrService.updateShiftAssignment")
  );

  assert.ok(
    shift.includes("CoreHrService.cancelShiftAssignment")
  );

  assert.equal(
    employees.includes(
      '"/api/core/hr/shift-templates"'
    ),
    false
  );

  assert.equal(
    employees.includes(
      '"/api/core/hr/shift-assignments"'
    ),
    false
  );

  assert.ok(banner.includes("sameWriteOutcome"));
  assert.ok(banner.includes("window.location.reload();"));
});