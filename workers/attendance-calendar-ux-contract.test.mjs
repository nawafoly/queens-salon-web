import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  "src/components/dashboard-v2/employee-workspace/live/EmployeeWorkspaceOperationalTabsLiveV2.tsx",
  "utf8"
);

test("attendance calendar uses semantic no-punch labels", () => {
  assert.match(source, /function attendanceCalendarTimeLabel/);
  assert.match(source, /راحة أسبوعية — لا تتطلب بصمة/);
  assert.match(source, /إجازة معتمدة — لا تتطلب بصمة/);
  assert.match(source, /يوم مغلق — لا تتطلب بصمة/);
  assert.match(source, /لم تسجل بصمة دخول أو خروج/);
  assert.match(source, /rowStatus\s*\|\|\s*"غير مصنف"/s);
  assert.match(source, /attendanceCalendarTimeLabel\(\{/);

  assert.doesNotMatch(
    source,
    /rowStatus\s*\|\|\s*"\?"/,
    "calendar must not expose an unexplained question-mark status"
  );

  assert.doesNotMatch(
    source,
    /\.join\(" \? "\)/,
    "attendance times must not use a question mark as a separator"
  );
});