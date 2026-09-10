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

test("catalog and disciplinary list filters stay inside D1", () => {
  const services = read("workers/core/repositories/services.js");
  const fineFund = read("workers/core/repositories/disciplinary-fine-fund.js");
  const migration = read("migrations/core/0066_filtered_list_read_efficiency.sql");

  const servicesStart = services.indexOf("export async function listServices");
  const servicesEnd = services.indexOf("export async function getService", servicesStart);
  const servicesBlock = services.slice(servicesStart, servicesEnd);
  assert.match(servicesBlock, /where = \["salon_id = \?"\]/);
  assert.match(servicesBlock, /where\.push\("active = 1"\)/);
  assert.match(servicesBlock, /where\.push\("section_id = \?"\)/);
  assert.match(servicesBlock, /where\.push\("category_id = \?"\)/);
  assert.match(servicesBlock, /ORDER BY sort_order, name[\s\S]*LIMIT 1000/);
  assert.doesNotMatch(servicesBlock, /rows\.filter/);

  const ledgerStart = fineFund.indexOf("export async function listDisciplinaryFineFundLedger");
  const ledgerEnd = fineFund.indexOf("export async function createDisciplinaryFineFundDisbursement", ledgerStart);
  const ledgerBlock = fineFund.slice(ledgerStart, ledgerEnd);
  assert.match(ledgerBlock, /where = \['salon_id = \?'\]/);
  assert.match(ledgerBlock, /where\.push\('entry_kind = \?'\)/);
  assert.match(ledgerBlock, /where\.push\('disciplinary_case_id = \?'\)/);
  assert.match(ledgerBlock, /ORDER BY created_at DESC, id DESC[\s\S]*LIMIT 1000/);
  assert.doesNotMatch(ledgerBlock, /rows\.filter/);

  assert.match(migration, /services\(salon_id, section_id, active, sort_order, name\)/);
  assert.match(migration, /services\(salon_id, category_id, active, sort_order, name\)/);
  assert.match(migration, /salon_id, entry_kind, created_at DESC, id DESC/);
  assert.match(migration, /salon_id, disciplinary_case_id, entry_kind, created_at DESC, id DESC/);
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
