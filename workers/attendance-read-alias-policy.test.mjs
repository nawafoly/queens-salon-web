import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("attendance records read remains canonical-alias aware", () => {
  const source = readFileSync(new URL("./attendance-worker.js", import.meta.url), "utf8");
  const start = source.indexOf("async function listAttendanceRecords(");
  const next = source.indexOf("async function listAttendanceMonthlySummaries", start);
  assert.ok(start >= 0, "listAttendanceRecords must exist");
  const block = source.slice(start, next > start ? next : source.length);

  assert.match(block, /const attendanceAliases = Array\.from/);
  assert.match(block, /params\.delete\("employeeUid"\)/);
  assert.match(block, /params\.delete\("employeeDocId"\)/);
  assert.ok(
    block.includes("(employee_uid IN (${placeholders}) OR employee_doc_id IN (${placeholders}))"),
    "records query must match trusted aliases through both employee_uid and employee_doc_id"
  );
  assert.match(
    block,
    /bindings\.unshift\(\.\.\.attendanceAliases,\s*\.\.\.attendanceAliases\)/
  );
});