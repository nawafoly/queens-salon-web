import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("administrative leave modal uses the canonical direct registration contract", () => {
  const dashboard = readFileSync(
    new URL("../src/pages/DashboardEmployees.tsx", import.meta.url),
    "utf8"
  );

  const start = dashboard.indexOf(
    "const handleLeaveModalSubmit = useCallback("
  );

  assert.ok(start >= 0);

  const end = dashboard.indexOf("  }, [", start);

  assert.ok(end > start);

  const submit = dashboard.slice(start, end);

  assert.match(
    submit,
    /employeeId: employeeIdLocal/
  );

  assert.match(
    submit,
    /CoreHrService\.registerAdminDirectLeave/
  );

  assert.match(
    submit,
    /operationId/
  );

  assert.match(
    submit,
    /registration_not_confirmed/
  );

  assert.doesNotMatch(
    submit,
    /submitAndApproveLeave|createManagedLeaveRequest|approveEmployeeLeaveRequest/
  );
});
