import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("src/pages/DashboardEmployees.tsx", "utf8");

test("employee editor keeps canonical employee id separate from Firebase uid", () => {
  assert.match(source, /function employeeCanonicalUiId\(/);
  assert.match(source, /setSelectedEmployeeId\(canonicalEmployeeId\)/);
  assert.match(source, /setEditId\(canonicalEmployeeId\)/);
  assert.match(source, /encodeURIComponent\(canonicalEmployeeId\)/);
  assert.match(source, /employeeCanonicalUiId\(editingStaff, editId\)/);
  assert.match(source, /employeeMatchesRouteId\(x, editId\)/);
});

test("merged employee rows prefer canonical document ids over linked auth uids", () => {
  assert.match(source, /const linkedUidSet = new Set\(\[/);
  assert.match(source, /canonicalCandidates\.find\(\(value\) => !linkedUidSet\.has\(value\)\)/);
  assert.match(source, /const staffPublicDocId = canonicalEmployeeId/);
});

test("legacy save target cannot prioritize staff mirror ids over canonical employee id", () => {
  assert.doesNotMatch(
    source,
    /\(editingStaff as any\)\?\.staffPublicDocId \|\|[\s\S]{0,220}source === \"core_staff\"/
  );
});
