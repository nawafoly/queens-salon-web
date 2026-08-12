import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(file) {
  const abs = path.join(root, file);
  const raw = fs.readFileSync(abs, 'utf8');
  return { abs, raw, eol: raw.includes('\r\n') ? '\r\n' : '\n', text: raw.replace(/\r\n/g, '\n') };
}

function write(src, text) {
  const next = src.eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
  if (next === src.raw) return false;
  fs.writeFileSync(src.abs, next, 'utf8');
  return true;
}

function replaceExact(text, before, after, label, { min = 1, max = 1 } = {}) {
  const count = text.split(before).length - 1;
  if (count < min || count > max) {
    throw new Error(`[finalize-booking-cutover] ${label}: expected ${min}..${max}, found ${count}`);
  }
  return text.split(before).join(after);
}

function replaceRegex(text, regex, after, label, { min = 1, max = 1 } = {}) {
  const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
  const re = new RegExp(regex.source, flags);
  const count = [...text.matchAll(re)].length;
  if (count < min || count > max) {
    throw new Error(`[finalize-booking-cutover] ${label}: expected ${min}..${max}, found ${count}`);
  }
  return text.replace(re, after);
}

function ensureServiceAssignment(text, serviceId, seedRegex, label, expectedSeeds = 1) {
  const current = (text.match(new RegExp(`staff_id: "staff-a", service_id: "${serviceId}"`, 'g')) || []).length;
  if (current >= expectedSeeds) return text;

  const matches = [...text.matchAll(seedRegex)];
  if (matches.length !== expectedSeeds) {
    throw new Error(`[finalize-booking-cutover] ${label}: expected ${expectedSeeds} seed(s), found ${matches.length}`);
  }

  let offset = 0;
  for (const match of matches) {
    const full = match[0];
    const nowExpr = full.includes('created_at: now') ? 'now' : '"2027-01-01T00:00:00.000Z"';
    const assignment = `\n  fake.seed("staff_services", { salon_id: "main", staff_id: "staff-a", service_id: "${serviceId}", active: 1, created_at: ${nowExpr}, updated_at: ${nowExpr} });`;
    const index = (match.index ?? 0) + offset + full.length;
    text = text.slice(0, index) + assignment + text.slice(index);
    offset += assignment.length;
  }
  return text;
}

// 1) DashboardBookings had an unused import that made the whole legacy
// staffAvailability module reachable from the booking-runtime audit graph.
{
  const src = read('src/pages/DashboardBookings.tsx');
  let text = src.text;
  text = replaceExact(
    text,
    'import { isStaffAvailableForDate } from "../helpers/staffAvailability";\n',
    '',
    'remove unused DashboardBookings legacy staff availability import',
    { min: 0, max: 1 }
  );
  console.log(`[finalize-booking-cutover] DashboardBookings.tsx: ${write(src, text) ? 'updated' : 'unchanged'}`);
}

// 2) firestoreBookings remains a read/compatibility facade for unrelated
// dashboard surfaces. Its obsolete writer must not retain an overtime policy.
{
  const src = read('src/services/firestoreBookings.ts');
  let text = src.text;
  text = text.replace(/\bconst ALLOW_OVERTIME_MIN\s*=\s*(?!0\b)\d+\s*;/g, 'const ALLOW_OVERTIME_MIN = 0;');
  if (/\bALLOW_OVERTIME_MIN\s*=\s*(?!0\b)\d+/.test(text)) {
    throw new Error('[finalize-booking-cutover] non-zero Firestore booking overtime remains');
  }
  console.log(`[finalize-booking-cutover] firestoreBookings.ts: ${write(src, text) ? 'updated' : 'unchanged'}`);
}

// 3) Strict staff_services and employee_leaves production policy exposed stale
// test fixtures. Fix only fixtures; never add a production fallback.
{
  const src = read('workers/core-worker.test.mjs');
  let text = src.text;

  text = ensureServiceAssignment(
    text,
    'svc-blowdry-short',
    /  fake\.seed\("services", \{\n    id: "svc-blowdry-short",[\s\S]*?\n  \}\);/g,
    'Arabic canonical service fixture',
    1
  );

  text = ensureServiceAssignment(
    text,
    'svc-b',
    /  fake\.seed\("services", \{(?:\n| )+id: "svc-b",[\s\S]*?\n  \}\);|  fake\.seed\("services", \{ id: "svc-b",[^\n]+\}\);/g,
    'svc-b strict assignment fixtures',
    2
  );

  if (!text.includes('      "employee_leaves",')) {
    text = replaceExact(
      text,
      '      "employee_absences",\n',
      '      "employee_leaves",\n      "employee_absences",\n',
      'add employee_leaves to FakeD1 tables'
    );
  }

  text = replaceRegex(
    text,
    /test\("staff leave blocks booking and is exposed by availability", async \(\) => \{\n  const fake = new FakeD1\(\);\n  seedCore\(fake\);\n  fake\.seed\("staff", \{[\s\S]*?\n  \}\);\n\n  const availability = await worker\.fetch\(/,
    `test("approved employee leave blocks booking and is exposed by availability", async () => {\n  const fake = new FakeD1();\n  seedCore(fake);\n  fake.seed("employee_leaves", {\n    id: "leave-a",\n    salon_id: "main",\n    employee_id: "staff-a",\n    leave_type: "annual",\n    start_date: "2027-01-09",\n    end_date: "2027-01-11",\n    duration_kind: "full",\n    status: "approved",\n    note: "annual leave",\n    created_at: "2027-01-01T00:00:00.000Z",\n    updated_at: "2027-01-01T00:00:00.000Z",\n  });\n\n  const availability = await worker.fetch(`,
    'replace mirrored staff leave fixture with employee_leaves authority',
    { min: 0, max: 1 }
  );

  if (/test\("staff leave blocks booking and is exposed by availability"/.test(text)) {
    throw new Error('[finalize-booking-cutover] legacy mirrored leave fixture still present');
  }

  console.log(`[finalize-booking-cutover] core-worker.test.mjs: ${write(src, text) ? 'updated' : 'unchanged'}`);
}

// 4) Migration architecture guard must describe the current runtime, not the
// removed Internal legacy implementation.
{
  const src = read('scripts/check-frontend-core-migration.mjs');
  let text = src.text;

  text = replaceExact(
    text,
    `    required: [\n      /resolveCoreBookingDataSource\\(\\)\\.getActiveStaff\\(\\)/,\n      /resolveCoreBookingDataSource\\(\\)\\.getServiceSections\\(\\)/,`,
    `    required: [\n      /listCoreBookableStaffForDate/,\n      /getCoreStaffBookableStartSlots/,\n      /resolveCoreBookingDataSource\\(\\)\\.getServiceSections\\(\\)/,`,
    'V2 migration guard Core staff authority',
    { min: 0, max: 1 }
  );

  text = replaceExact(
    text,
    `  {\n    file: "src/pages/BookingInternal.tsx",\n    required: [/CoreRefundService/, /CoreAuditService/],\n  },`,
    `  {\n    file: "src/pages/BookingInternal.tsx",\n    required: [/BookingInternalV2/],\n  },`,
    'legacy Internal wrapper migration guard',
    { min: 0, max: 1 }
  );

  console.log(`[finalize-booking-cutover] check-frontend-core-migration.mjs: ${write(src, text) ? 'updated' : 'unchanged'}`);
}

// 5) Frontend migration tests: assert one internal scheduling engine (V2) and
// the new Core dated staff policy.
{
  const src = read('workers/frontend-core-migration.test.mjs');
  let text = src.text;

  text = replaceRegex(
    text,
    /test\("booking pages route slot availability through the selected data source", \(\) => \{[\s\S]*?\n\}\);/,
    `test("booking pages use one Core availability engine", () => {\n  for (const file of [\n    "src/pages/Booking.tsx",\n    "src/features/internal-booking-v2/BookingInternalV2.tsx",\n  ]) {\n    const source = readFileSync(file, "utf8");\n    assert.match(source, /getStaffAvailability/);\n    assert.doesNotMatch(source, /collection\\([^\\n]*["']booking_slots["']/);\n    assert.doesNotMatch(source, /doc\\([^\\n]*["']availability_days["']/);\n  }\n\n  const legacyEntry = readFileSync("src/pages/BookingInternal.tsx", "utf8");\n  assert.match(legacyEntry, /BookingInternalV2/);\n  assert.doesNotMatch(legacyEntry, /getStaffAvailability|staffAvailability|firestoreAvailabilityBackfill/);\n});`,
    'frontend test single internal availability engine',
    { min: 0, max: 1 }
  );

  text = replaceExact(
    text,
    `  assert.match(internal, /CoreRefundService/);\n  assert.match(internal, /getDataSourceFlags\\(\\)\\.useCoreD1/);`,
    `  assert.match(internal, /BookingInternalV2/);\n  assert.doesNotMatch(internal, /CoreRefundService|getDataSourceFlags/);`,
    'frontend refund test legacy Internal delegate',
    { min: 0, max: 1 }
  );

  text = replaceRegex(
    text,
    /test\("internal booking V2 loads authoritative Core staff without hardcoded staff names", \(\) => \{[\s\S]*?\n\}\);/,
    `test("internal booking V2 uses dated Core HR staff and scheduleWindows", () => {\n  const v2Source = readFileSync("src/features/internal-booking-v2/BookingInternalV2.tsx", "utf8");\n  assert.match(v2Source, /listCoreBookableStaffForDate/);\n  assert.match(v2Source, /getCoreStaffBookableStartSlots/);\n  assert.match(v2Source, /getStaffAvailability/);\n  assert.doesNotMatch(v2Source, /filterStaffForInternalBookingTarget|filterStaffSlotsByWorkingHours|isStaffAvailableForDate|isStaffOperationallyActiveForDate/);\n  assert.doesNotMatch(v2Source, /firestoreStaffPublic|staff_public|bookingDataSourceCompat/);\n  assert.doesNotMatch(v2Source, /Wessam|وسام/i);\n});`,
    'frontend V2 authoritative Core staff test',
    { min: 0, max: 1 }
  );

  text = text.replace(
    'const internalBooking = readFileSync("src/pages/BookingInternal.tsx", "utf8");',
    'const internalBooking = readFileSync("src/features/internal-booking-v2/BookingInternalV2.tsx", "utf8");'
  );

  console.log(`[finalize-booking-cutover] frontend-core-migration.test.mjs: ${write(src, text) ? 'updated' : 'unchanged'}`);
}

console.log('[finalize-booking-cutover] cleanup complete');