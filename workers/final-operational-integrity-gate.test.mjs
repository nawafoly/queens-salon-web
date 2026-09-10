import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) =>
  readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");

test("critical journey gate covers every operational integrity business journey", () => {
  const source = read("scripts/verify-critical-journeys.mjs");

  const required = [
    "employee workspace",
    "employee concurrency",
    "shift authority",
    "attendance security",
    "leave lifecycle",
    "employee requests",
    "payroll approval",
    "payroll payment and reversal",
    "employee termination safety",
    "booking offline safety",
    "internal booking client dedup",
  ];

  for (const journey of required) {
    assert.ok(
      source.includes(journey),
      "Missing critical journey: " + journey
    );
  }

  assert.match(source, /Critical journey regression coverage is incomplete/);
  assert.match(source, /spawnSync/);
  assert.match(source, /"--test"/);
});

test("generic idempotency ledger never uses an implicit shared tenant namespace", () => {
  const source = read("workers/core/index.js");

  assert.match(source, /IDEMPOTENCY_CONFIGURED_TENANT_FENCE_V1/);
  assert.match(source, /const tenantId =\s*cleanText\(env\.SALON_ID\)/);
  assert.match(
    source,
    /if \(\s*tenantId &&\s*shouldUseIdempotency/
  );
});

test("absence employee filtering stays inside D1 before the bounded list", () => {
  const source = read("workers/core/repositories/absences.js");
  const migration = read("migrations/core/0065_absence_read_efficiency.sql");
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
  assert.match(migration, /employee_absences\(salon_id, date_key DESC\)/);
  assert.match(migration, /employee_absences\(salon_id, employee_id, date_key DESC\)/);
  assert.match(migration, /employee_absences\(salon_id, employee_uid, date_key DESC\)/);
});

test("public booking tracking stays on canonical Core instead of Firestore", () => {
  const source = read("src/pages/Track.tsx");

  assert.match(source, /CoreBookingService\.trackPublic\(normalizedParam\)/);
  assert.match(source, /coreApiRequest<CorePublicSettingRow>\("\/api\/core\/settings\/public"\)/);
  assert.doesNotMatch(source, /firestoreBookings/);
  assert.doesNotMatch(source, /firebase\/firestore/);
  assert.doesNotMatch(source, /services\/firebase/);
  assert.doesNotMatch(source, /onSnapshot\(/);
  assert.doesNotMatch(source, /getTrackByPublicId/);
});

test("final aggregate remains cumulative through P7 and critical journeys", () => {
  const pkg = JSON.parse(read("package.json"));

  assert.equal(
    pkg.scripts["verify:operational-integrity"],
    "npm run verify:operational-integrity:p8"
  );

  assert.match(
    pkg.scripts["verify:operational-integrity:p8"],
    /verify:operational-integrity:p7/
  );

  assert.match(
    pkg.scripts["verify:operational-integrity:p8"],
    /test:critical-journeys/
  );

  assert.match(
    pkg.scripts["verify:operational-integrity:p8"],
    /final-operational-integrity-gate\.test\.mjs/
  );
});

test("GitHub release gate runs the final aggregate after dependency audit", () => {
  const workflow = read(
    ".github/workflows/operational-integrity-hardening.yml"
  );

  assert.match(workflow, /npm audit --audit-level=high/);
  assert.match(workflow, /npm run verify:operational-integrity/);
  assert.match(workflow, /git diff --check/);
});
