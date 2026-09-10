import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("workers/core/repositories/absences.js", "utf8");
const migration = readFileSync("migrations/core/0065_absence_read_efficiency.sql", "utf8");

test("absence employee filter is applied inside D1 before LIMIT", () => {
  const start = source.indexOf("export async function listAbsences");
  const end = source.indexOf("export async function createAbsence", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const block = source.slice(start, end);

  assert.match(block, /where = \['salon_id = \?'\]/);
  assert.match(block, /\(employee_id = \? OR employee_uid = \?\)/);
  assert.match(block, /WHERE \$\{where\.join\(' AND '\)\}/);
  assert.match(block, /ORDER BY date_key DESC[\s\S]*LIMIT 1000/);
  assert.doesNotMatch(block, /rows\.filter/);
  assert.doesNotMatch(block, /SELECT \* FROM employee_absences WHERE salon_id = \? ORDER BY date_key DESC LIMIT 1000/);
});

test("absence list indexes cover tenant ordering and both employee identities", () => {
  assert.match(migration, /employee_absences\(salon_id, date_key DESC\)/);
  assert.match(migration, /employee_absences\(salon_id, employee_id, date_key DESC\)/);
  assert.match(migration, /employee_absences\(salon_id, employee_uid, date_key DESC\)/);
});
