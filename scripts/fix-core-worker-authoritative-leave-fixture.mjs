import fs from 'node:fs';

const file = 'workers/core-worker.test.mjs';
const raw = fs.readFileSync(file, 'utf8');
const eol = raw.includes('\r\n') ? '\r\n' : '\n';
let text = raw.replace(/\r\n/g, '\n');

const legacy = `  fake.seed("staff", {
    ...fake.find("staff", "main", "staff-a"),
    leave_start_date: "2027-01-09",
    leave_end_date: "2027-01-11",
    leave_note: "annual leave",
    show_on_booking: 1,
  });`;

const authoritative = `  fake.seed("employee_leaves", {
    id: "leave-staff-a-2027-01",
    salon_id: "main",
    employee_id: "staff-a",
    leave_type: "annual",
    duration_kind: "full",
    start_date: "2027-01-09",
    end_date: "2027-01-11",
    days: 3,
    status: "approved",
    note: "annual leave",
    deduct_from_balance: 1,
    affects_payroll: 0,
    affects_attendance: 1,
    created_at: "2027-01-01T00:00:00.000Z",
    updated_at: "2027-01-01T00:00:00.000Z",
  });`;

if (text.includes(authoritative)) {
  console.log('[core-leave-fixture] already authoritative');
  process.exit(0);
}

const count = text.split(legacy).length - 1;
if (count !== 1) {
  throw new Error(`[core-leave-fixture] expected exactly one legacy leave fixture, found ${count}`);
}

text = text.replace(legacy, authoritative);
if (/staff leave blocks booking and is exposed by availability[\s\S]{0,700}?leave_start_date/.test(text)) {
  throw new Error('[core-leave-fixture] legacy staff leave fields remain in booking leave test');
}

fs.writeFileSync(file, eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text, 'utf8');
console.log('[core-leave-fixture] booking leave test now seeds authoritative employee_leaves');
