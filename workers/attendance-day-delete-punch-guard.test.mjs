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
