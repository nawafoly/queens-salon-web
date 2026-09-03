import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (file) =>
  readFileSync(
    resolve(process.cwd(), file),
    "utf8"
  ).replace(/\r\n/g, "\n");

test(
  "Core API blocks definite offline writes and carries reconciliation identity",
  () => {
    const source = read(
      "src/services/coreApiClient.ts"
    );

    assert.ok(
      source.includes("CORE_NETWORK_SAFETY_V1")
    );
    assert.ok(
      source.includes(
        "navigator.onLine === false"
      )
    );
    assert.ok(
      source.includes("core_api:offline")
    );
    assert.ok(
      source.includes(
        "core_api:network_unavailable"
      )
    );
    assert.ok(
      source.includes(
        "core_api:write_outcome_unknown"
      )
    );

    assert.ok(
      source.includes(
        "options.reconciliation?.employeeId"
      )
    );

    assert.ok(
      source.includes(
        "options.body?.employeeId"
      )
    );

    assert.ok(
      source.includes(
        "emitUnknownWriteOutcome(path, method, operationId, options);"
      )
    );

    assert.ok(
      source.includes(
        "...(employeeId ? { employeeId } : {})"
      )
    );

    assert.ok(
      source.includes(
        "error.status === 401"
      )
    );
  }
);

test(
  "global banner retains every ambiguous operation independently",
  () => {
    const banner = read(
      "src/components/NetworkSafetyBanner.tsx"
    );

    const app = read(
      "src/App.tsx"
    );

    assert.ok(
      banner.includes(
        "CORE_RECONCILIATION_FAILSAFE_V1"
      )
    );

    assert.ok(
      banner.includes(
        "CORE_RECONCILIATION_CORRELATION_V1"
      )
    );

    assert.ok(
      banner.includes(
        "CORE_RECONCILIATION_MULTI_PENDING_V1"
      )
    );

    assert.ok(
      banner.includes(
        "pendingWritesRef"
      )
    );

    assert.ok(
      banner.includes(
        "new Map()"
      )
    );

    assert.ok(
      banner.includes(
        "pendingWritesRef.current.set("
      )
    );

    assert.ok(
      banner.includes(
        "pendingWritesRef.current.delete(key)"
      )
    );

    assert.ok(
      banner.includes(
        "pendingWritesRef.current.size > 0"
      )
    );

    assert.ok(
      banner.includes(
        "uncorrelatedUnknownWriteRef"
      )
    );

    assert.equal(
      banner.includes(
        "pendingWriteRef.current = detail"
      ),
      false
    );

    assert.ok(
      banner.includes(
        "window.location.reload();"
      )
    );

    assert.ok(
      app.includes(
        "<NetworkSafetyBanner />"
      )
    );
  }
);

test(
  "one exact acknowledgement cannot clear another pending ambiguous write",
  () => {
    const banner = read(
      "src/components/NetworkSafetyBanner.tsx"
    );

    assert.ok(
      banner.includes(
        "writeOutcomeKey("
      )
    );

    assert.ok(
      banner.includes(
        "sameWriteOutcome("
      )
    );

    assert.ok(
      banner.includes(
        "pendingWritesRef.current.get(key)"
      )
    );

    assert.ok(
      banner.includes(
        "pendingWritesRef.current.delete(key)"
      )
    );

    assert.ok(
      banner.includes(
        "pendingWritesRef.current.size > 0"
      )
    );

    assert.ok(
      banner.includes(
        "unknownWriteOutcomeRef.current = false"
      )
    );
  }
);

test(
  "employee reconciliation reloads the employee identified by the failed write",
  () => {
    const source = read(
      "src/pages/DashboardEmployees.tsx"
    );

    assert.ok(
      source.includes(
        "EMPLOYEE_NETWORK_RECONCILIATION_TARGET_V1"
      )
    );

    assert.ok(
      source.includes(
        "employeeId?: string"
      )
    );

    assert.ok(
      source.includes(
        "writeDetail.employeeId"
      )
    );

    assert.ok(
      source.includes(
        "const employeeId ="
      )
    );

    assert.ok(
      source.includes(
        "CoreHrService.getEmployee("
      )
    );

    assert.ok(
      source.includes(
        "CoreHrService.listScheduleExceptions("
      )
    );

    assert.ok(
      source.includes(
        "cleanText(editId) === employeeId"
      )
    );

    assert.ok(
      source.includes(
        "selectedEmployeeStillMatches"
      )
    );

    assert.ok(
      source.includes(
        "reconciliationQueue"
      )
    );

    assert.ok(
      source.includes(
        "detail: writeDetail"
      )
    );
  }
);

test(
  "employee-domain mutations provide employee reconciliation scope when body does not",
  () => {
    const hr = read(
      "src/services/CoreHrService.ts"
    );

    const shift = read(
      "src/pages/dashboardEmployees/ShiftControlSection.tsx"
    );

    const tempWeeklyOff = read(
      "src/services/temporaryWeeklyOffService.ts"
    );

    assert.ok(
      hr.includes(
        "employeeReconciliation("
      )
    );

    assert.ok(
      hr.includes(
        "reconciliationEmployeeId?: string"
      )
    );

    assert.ok(
      hr.includes(
        "reconciliation:"
      )
    );

    assert.ok(
      shift.includes(
        "targetShiftEmployeeId"
      )
    );

    assert.ok(
      tempWeeklyOff.includes(
        "fallbackEmployeeId"
      )
    );

    assert.ok(
      tempWeeklyOff.includes(
        "row.employeeId"
      )
    );
  }
);

test(
  "employee workspace still refuses to acknowledge shift-template and shift-assignment domains",
  () => {
    const employees = read(
      "src/pages/DashboardEmployees.tsx"
    );

    const shift = read(
      "src/pages/dashboardEmployees/ShiftControlSection.tsx"
    );

    const banner = read(
      "src/components/NetworkSafetyBanner.tsx"
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

    assert.ok(
      shift.includes(
        "CoreHrService.saveShiftTemplate"
      )
    );

    assert.ok(
      shift.includes(
        "CoreHrService.createShiftAssignment"
      )
    );

    assert.ok(
      shift.includes(
        "CoreHrService.updateShiftAssignment"
      )
    );

    assert.ok(
      shift.includes(
        "CoreHrService.cancelShiftAssignment"
      )
    );

    assert.ok(
      banner.includes(
        "window.location.reload();"
      )
    );
  }
);

test(
  "Core GET requests coalesce while an identical read is already in flight",
  () => {
    const source = read("src/services/coreApiClient.ts");

    assert.ok(source.includes("inFlightGetRequests"));
    assert.ok(source.includes("coreGetRequestKey"));
    assert.ok(source.includes("const existing = inFlightGetRequests.get(requestKey)"));
    assert.ok(source.includes("inFlightGetRequests.delete(requestKey)"));
    assert.ok(source.includes('logicalMethod !== "GET"'));
  }
);

test(
  "Core settings reads use a bounded cache and one in-flight request per key",
  () => {
    const source = read("src/services/CoreSettingsService.ts");

    assert.ok(source.includes("SETTINGS_READ_TTL_MS = 60_000"));
    assert.ok(source.includes("settingCache"));
    assert.ok(source.includes("settingRequests"));
    assert.ok(source.includes("readFreshCachedSetting"));
    assert.ok(source.includes("cacheSetting(normalizedKey, saved)"));
    assert.ok(source.includes("invalidate(key?: string)"));
  }
);

test(
  "pending account status uses adaptive visible-only refresh instead of a fixed interval",
  () => {
    const source = read("src/pages/DashboardPending.tsx");

    assert.equal(source.includes("setInterval("), false);
    assert.ok(source.includes("STATUS_REFRESH_DELAYS_MS"));
    assert.ok(source.includes("window.setTimeout"));
    assert.ok(source.includes("Math.random()"));
    assert.ok(source.includes('document.visibilityState === "visible"'));
    assert.ok(source.includes("navigator.onLine !== false"));
    assert.ok(source.includes("requestInFlight"));
    assert.ok(source.includes('window.addEventListener("focus", refreshWhenActive)'));
    assert.ok(source.includes('window.addEventListener("online", refreshWhenActive)'));
  }
);
