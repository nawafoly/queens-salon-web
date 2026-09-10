import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync("workers/core/repositories/staff.js", "utf8");
const migration = readFileSync(
  "migrations/core/0062_staff_read_efficiency_indexes.sql",
  "utf8"
);

test("staff HR status hydration is scoped to returned staff identities", () => {
  assert.match(source, /function staffIdentityScope\(rows = \[\]\)/);
  assert.match(source, /hrStatusMapsForStaff\(db, salonId, staffRows = \[\]\)/);
  assert.match(source, /id IN \(\$\{placeholders\(ids\.length\)\}\)/);
  assert.match(source, /firebase_uid IN \(\$\{placeholders\(uids\.length\)\}\)/);
  assert.match(source, /employee_id IN \(\$\{placeholders\(ids\.length\)\}\)/);
  assert.match(source, /JOIN app_users a/);
  assert.match(source, /l\.link_status = 'active'/);
  assert.match(source, /cleanText\(row\.link_status\)\.toLowerCase\(\) === "active"/);
  assert.match(source, /hrStatusMapsForStaff\(db, salonId, rows\)/);
  assert.match(source, /hrStatusMapsForStaff\(db, salonId, \[row\]\)/);

  assert.doesNotMatch(
    source,
    /SELECT id, firebase_uid, status FROM employee_profiles WHERE salon_id = \?"/
  );
  assert.doesNotMatch(
    source,
    /SELECT employee_id, employment_status FROM employee_employment WHERE salon_id = \?"/
  );
  assert.doesNotMatch(
    source,
    /SELECT id, firebase_uid, status FROM app_users WHERE salon_id = \?"/
  );
  assert.doesNotMatch(
    source,
    /SELECT user_id, employee_id, link_status FROM user_employee_links WHERE salon_id = \?"/
  );
});

test("active and service-scoped staff reads are filtered before HR hydration", () => {
  assert.match(source, /SELECT DISTINCT s\.\* FROM staff s/);
  assert.match(source, /JOIN staff_services ss/);
  assert.match(source, /ss\.service_id = \?/);
  assert.match(source, /ss\.active = 1/);
  assert.match(source, /if \(activeOnly\) sql \+= " AND s\.active = 1"/);
  assert.match(source, /ORDER BY s\.active DESC, s\.name LIMIT 500/);
  assert.doesNotMatch(
    source,
    /SELECT \* FROM staff WHERE salon_id = \? ORDER BY active DESC, name LIMIT 500/
  );
});

test("D1 has supporting indexes for scoped staff reads", () => {
  assert.match(
    migration,
    /idx_staff_services_salon_service_active_staff[\s\S]*staff_services\(salon_id, service_id, active, staff_id\)/
  );
  assert.match(
    migration,
    /idx_app_users_salon_firebase_uid[\s\S]*app_users\(salon_id, firebase_uid\)/
  );
});
