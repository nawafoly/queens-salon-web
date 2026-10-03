import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");

test("stale employee master writes allow only semantic no-op replays", () => {
  const source = read("workers/core/repositories/hr-employees.js");

  assert.match(source, /EMPLOYEE_STALE_NOOP_REPLAY_V1/);
  assert.match(
    source,
    /cleanText\(existing\?\.updated_at\)\s*!==\s*expectedUpdatedAt/
  );
  assert.match(source, /employeeRowSemanticallyMatches\(existing, profile\)/);
  assert.match(
    source,
    /employeeRowSemanticallyMatches\(existingEmployment, employment\)/
  );
  assert.match(source, /employeeRowSemanticallyMatches\(existingStaff, staff\)/);
  assert.match(
    source,
    /SELECT service_id[\s\S]*FROM staff_services[\s\S]*active = 1/
  );
  assert.match(source, /sameStringSet\(currentSpecialtyIds, bookingSpecialtyIds \|\| \[\]\)/);

  const replayIndex = source.indexOf("if (semanticNoop)");
  const conflictIndex = source.indexOf("'core_hr:employee_changed'", replayIndex);
  assert.ok(replayIndex >= 0 && conflictIndex > replayIndex);
  assert.match(
    source.slice(replayIndex, conflictIndex),
    /return getHrEmployee\(db, salonId, id\)/
  );

  assert.match(source, /export async function replaceHrSchedules\(/);
  assert.match(source, /EMPLOYEE_OPTIMISTIC_CONCURRENCY_V1/);
});

test("24-hour dashboard time controls use a real native time input", () => {
  const source = read("src/components/dashboard-v2/DashboardTimePickerV2.tsx");

  assert.match(source, /clock === "12h" \? \(/);
  assert.match(source, /type="time"/);
  assert.match(source, /min=\{min\}/);
  assert.match(source, /max=\{max\}/);
  assert.match(source, /step=\{step\}/);
  assert.match(source, /normalizeCommittedTime\(event\.target\.value\)/);
});
