import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(
  new URL(
    "../src/components/dashboard-v2/employee-workspace/live/EmployeeWorkspaceOperationalTabsLiveV2.tsx",
    import.meta.url
  ),
  "utf8"
);

test("the selected-day delete action requires a real attendance punch", () => {
  assert.match(
    source,
    /const selectedHasPunch = Boolean\(selectedRow\?\.checkInAtClient \|\| selectedRow\?\.checkOutAtClient\);/
  );
  assert.match(
    source,
    /disabled=\{readOnly \|\| !canDelete \|\| !selectedRow\?\.date \|\| !selectedHasPunch\} onClick=\{\(\) => selectedRow\?\.date && selectedHasPunch && onDeletePunch\(selectedRow\.date\)\}/
  );
});

test("leave registration remains available for a day without punches", () => {
  assert.match(
    source,
    /disabled=\{readOnly \|\| !canCreateEmergencyLeave \|\| !activeSelectedDate \|\| selectedHasPunch\}/
  );
});

const leaveStatsSource = readFileSync(
  new URL("../src/pages/dashboardEmployees/EmployeeStatsSection.tsx", import.meta.url),
  "utf8"
);

test("historical leave types keep their explicit categories rather than showing unrecorded", () => {
  for (const [type, arabicLabel] of [
    ["other", "أخرى"],
    ["exceptional", "استثنائية"],
    ["compensatory", "تعويضية"],
  ]) {
    assert.ok(
      leaveStatsSource.includes(type + ': "' + arabicLabel + '"'),
      "missing historical leave type: " + type
    );
  }
  assert.match(leaveStatsSource, /t\(historicalLeaveTypeLabel\(entry\)\)/);
});
