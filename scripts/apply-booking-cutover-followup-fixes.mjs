import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const bookingPath = path.join(root, 'src/pages/Booking.tsx');
const testPath = path.join(root, 'workers/core-worker.test.mjs');

function read(file) {
  const raw = fs.readFileSync(file, 'utf8');
  return { raw, eol: raw.includes('\r\n') ? '\r\n' : '\n', text: raw.replace(/\r\n/g, '\n') };
}

function write(file, source, nextText) {
  const next = source.eol === '\r\n' ? nextText.replace(/\n/g, '\r\n') : nextText;
  if (next === source.raw) return false;
  fs.writeFileSync(file, next, 'utf8');
  return true;
}

function replaceOnce(text, before, after, label) {
  const first = text.indexOf(before);
  if (first < 0) throw new Error(`[booking-cutover-followup] expected source not found: ${label}`);
  if (text.indexOf(before, first + before.length) >= 0) {
    throw new Error(`[booking-cutover-followup] source matched more than once: ${label}`);
  }
  return text.slice(0, first) + after + text.slice(first + before.length);
}

// 1) Remove the last legacy working-window imports from Booking.tsx.
{
  const src = read(bookingPath);
  let text = src.text;
  text = text.replace('  filterStaffSlotsByWorkingHours,\n', '');
  text = text.replace('  resolveStaffWorkingWindowsForDate,\n', '');
  console.log(`[booking-cutover-followup] Booking.tsx imports: ${write(bookingPath, src, text) ? 'updated' : 'unchanged'}`);
}

// 2) Bring the shared worker test fixture into the modern booking world.
// Production stays strict: these are test fixtures, not runtime bypasses.
{
  const src = read(testPath);
  let text = src.text;

  if (!text.includes('"hr_work_schedules",')) {
    text = replaceOnce(
      text,
      `      "staff_schedules",\n      "bookings",`,
      `      "staff_schedules",\n      "hr_work_schedules",\n      "hr_schedule_exceptions",\n      "hr_shift_assignments",\n      "hr_shift_templates",\n      "bookings",`,
      'add HR shift tables to FakeD1'
    );
  }

  if (!text.includes('FROM hr_schedule_exceptions e LEFT JOIN hr_shift_templates t')) {
    text = replaceOnce(
      text,
      `    const normalized = sql.replace(/\\s+/g, " ").trim();\n    if (normalized.startsWith("SELECT * FROM app_users WHERE salon_id = ? AND firebase_uid = ?")) {`,
      `    const normalized = sql.replace(/\\s+/g, " ").trim();\n\n    if (normalized.includes("FROM hr_schedule_exceptions e LEFT JOIN hr_shift_templates t")) {\n      const [salonId, employeeId, dateFrom, dateTo] = params;\n      return this.rows("hr_schedule_exceptions")\n        .filter((row) =>\n          row.salon_id === salonId &&\n          row.employee_id === employeeId &&\n          row.status === "approved" &&\n          Number(row.enabled) === 1 &&\n          row.date_from <= dateFrom &&\n          row.date_to >= dateTo\n        )\n        .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))\n        .slice(0, 1)\n        .map((row) => {\n          const template = row.shift_template_id\n            ? this.rows("hr_shift_templates").find((item) => item.id === row.shift_template_id)\n            : null;\n          return {\n            ...row,\n            shift_name: template?.name || null,\n            template_start_time: template?.start_time || null,\n            template_end_time: template?.end_time || null,\n            crosses_midnight: template?.crosses_midnight || 0,\n            break_minutes: template?.break_minutes || 0,\n            late_grace_minutes: template?.late_grace_minutes || 0,\n            early_leave_grace_minutes: 0,\n            attendance_lock_enabled: template?.attendance_lock_enabled || 0,\n            attendance_lock_after_minutes: template?.attendance_lock_after_minutes || 30,\n            overtime_after_minutes: template?.overtime_after_minutes || 0,\n          };\n        });\n    }\n\n    if (normalized.includes("FROM hr_work_schedules s") && normalized.includes("LEFT JOIN hr_shift_templates t")) {\n      const [salonId, employeeId, weekday, dateFrom, dateTo] = params;\n      return this.rows("hr_work_schedules")\n        .filter((row) =>\n          row.salon_id === salonId &&\n          row.employee_id === employeeId &&\n          Number(row.weekday) === Number(weekday) &&\n          (!row.effective_from || row.effective_from <= dateFrom) &&\n          (!row.effective_to || row.effective_to >= dateTo)\n        )\n        .sort((a, b) => {\n          const byFrom = String(b.effective_from || "0000-01-01").localeCompare(String(a.effective_from || "0000-01-01"));\n          if (byFrom !== 0) return byFrom;\n          return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));\n        })\n        .slice(0, 1)\n        .map((row) => {\n          const template = row.shift_template_id\n            ? this.rows("hr_shift_templates").find((item) => item.id === row.shift_template_id)\n            : null;\n          return {\n            ...row,\n            shift_name: template?.name || null,\n            shift_code: template?.code || null,\n            template_start_time: template?.start_time || null,\n            template_end_time: template?.end_time || null,\n            crosses_midnight: template?.crosses_midnight || 0,\n            break_minutes: template?.break_minutes || 0,\n            late_grace_minutes: template?.late_grace_minutes || 0,\n            early_leave_grace_minutes: 0,\n            attendance_lock_enabled: template?.attendance_lock_enabled || 0,\n            attendance_lock_after_minutes: template?.attendance_lock_after_minutes || 30,\n            overtime_after_minutes: template?.overtime_after_minutes || 0,\n          };\n        });\n    }\n\n    if (normalized.includes("FROM hr_shift_assignments a") && normalized.includes("LEFT JOIN hr_shift_templates t")) {\n      const [salonId, employeeId, dateFrom, dateTo] = params;\n      return this.rows("hr_shift_assignments")\n        .filter((row) =>\n          row.salon_id === salonId &&\n          row.employee_id === employeeId &&\n          row.status === "published" &&\n          row.effective_from <= dateFrom &&\n          (!row.effective_to || row.effective_to >= dateTo)\n        )\n        .sort((a, b) => String(b.effective_from || "").localeCompare(String(a.effective_from || "")))\n        .slice(0, 1)\n        .map((row) => {\n          const template = row.shift_template_id\n            ? this.rows("hr_shift_templates").find((item) => item.id === row.shift_template_id)\n            : null;\n          return {\n            ...row,\n            shift_name: template?.name || null,\n            template_start_time: template?.start_time || null,\n            template_end_time: template?.end_time || null,\n            crosses_midnight: template?.crosses_midnight || 0,\n            break_minutes: template?.break_minutes || 0,\n            late_grace_minutes: template?.late_grace_minutes || 0,\n            early_leave_grace_minutes: 0,\n            attendance_lock_enabled: template?.attendance_lock_enabled || 0,\n            attendance_lock_after_minutes: template?.attendance_lock_after_minutes || 30,\n            overtime_after_minutes: template?.overtime_after_minutes || 0,\n          };\n        });\n    }\n\n    if (normalized.startsWith("SELECT * FROM app_users WHERE salon_id = ? AND firebase_uid = ?")) {`,
      'teach FakeD1 the modern HR resolver queries'
    );
  }

  if (!text.includes('id: "staff-a__svc-a"')) {
    text = replaceOnce(
      text,
      `  fake.seed("staff", { id: "staff-a", salon_id: "main", firebase_uid: "staff1", name: "Staff A", phone_normalized: null, active: 1, employment_status: "active", created_at: now, updated_at: now });\n}`,
      `  fake.seed("staff", { id: "staff-a", salon_id: "main", firebase_uid: "staff1", name: "Staff A", phone_normalized: null, active: 1, employment_status: "active", show_on_booking: 1, created_at: now, updated_at: now });\n  fake.seed("staff_services", {\n    id: "staff-a__svc-a",\n    salon_id: "main",\n    staff_id: "staff-a",\n    service_id: "svc-a",\n    active: 1,\n    created_at: now,\n    updated_at: now,\n  });\n  for (let weekday = 0; weekday <= 6; weekday += 1) {\n    fake.seed("hr_work_schedules", {\n      id: \`staff-a__weekday-\${weekday}\`,\n      salon_id: "main",\n      employee_id: "staff-a",\n      weekday,\n      shift_template_id: null,\n      active: 1,\n      start_time: "09:00",\n      end_time: "23:00",\n      effective_from: "2020-01-01",\n      effective_to: null,\n      schedule_source: "test_fixture",\n      created_at: now,\n      updated_at: now,\n    });\n  }\n}`,
      'seed staff-service assignment and modern HR schedule'
    );
  }

  console.log(`[booking-cutover-followup] core-worker.test.mjs fixtures: ${write(testPath, src, text) ? 'updated' : 'unchanged'}`);
}

console.log('[booking-cutover-followup] follow-up fixes applied.');
