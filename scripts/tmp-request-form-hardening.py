from pathlib import Path

# Backend: explicit target required for update/void attendance corrections.
p = Path('workers/core/repositories/employee-requests-legacy.js')
t = p.read_text(encoding='utf-8')
old = """      const requestedTime = correctionType === 'delete_record' ? null : validTime(payload.requestedTime, 'requestedTime');
      return {
        ...payload,
        date,
        correctionType,
        currentTime: cleanText(payload.currentTime) ? validTime(payload.currentTime, 'currentTime') : '',
        requestedTime,
        reason: requiredReason(payload.reason),
        recordId: cleanText(payload.recordId),
        notes: cleanText(payload.notes),
      };
"""
new = """      const requestedTime = correctionType === 'delete_record' ? null : validTime(payload.requestedTime, 'requestedTime');
      const currentTime = cleanText(payload.currentTime) ? validTime(payload.currentTime, 'currentTime') : '';
      const recordId = cleanText(payload.recordId);
      if ((correctionType.startsWith('update_') || correctionType === 'delete_record') && !recordId && !currentTime) {
        throw new AppError(400, 'core_employee_request:attendance_target_required');
      }
      return {
        ...payload,
        date,
        correctionType,
        currentTime,
        requestedTime,
        reason: requiredReason(payload.reason),
        recordId,
        notes: cleanText(payload.notes),
      };
"""
if t.count(old) != 1:
    raise SystemExit(f'attendance validation anchor mismatch: {t.count(old)}')
t = t.replace(old, new, 1)
p.write_text(t, encoding='utf-8')

# Frontend: no invented overtime hours; clarify void semantics.
p = Path('src/pages/hr/EmployeeRequests.tsx')
t = p.read_text(encoding='utf-8')
replacements = [
    ('if (type === "overtime") return { ...common, date: today, startTime: "23:00", endTime: "00:00", taskSummary: "", location: "", requestedByManager: "" };',
     'if (type === "overtime") return { ...common, date: today, startTime: "", endTime: "", taskSummary: "", location: "", requestedByManager: "" };'),
    ('{ value: "delete_record", label: "حذف بصمة خاطئة" },',
     '{ value: "delete_record", label: "إلغاء بصمة خاطئة مع حفظ السجل" },'),
    ('<TextField label="الوقت الحالي إن وجد" name="currentTime" type="time" value={String(form.currentTime)} onChange={update} />',
     '<TextField label={form.correctionType === "delete_record" || String(form.correctionType).startsWith("update_") ? "وقت البصمة الحالية (أو استخدم معرف السجل)" : "الوقت الحالي إن وجد"} name="currentTime" type="time" value={String(form.currentTime)} onChange={update} />'),
    ('<TextField label="معرف السجل إن وجد" name="recordId" value={String(form.recordId)} onChange={update} />',
     '<TextField label={form.correctionType === "delete_record" || String(form.correctionType).startsWith("update_") ? "معرف السجل (بديل عن وقت البصمة الحالية)" : "معرف السجل إن وجد"} name="recordId" value={String(form.recordId)} onChange={update} />'),
]
for old, new in replacements:
    if t.count(old) != 1:
        raise SystemExit(f'frontend anchor mismatch: {old[:70]!r} count={t.count(old)}')
    t = t.replace(old, new, 1)
p.write_text(t, encoding='utf-8')

Path('workers/request-form-hardening.test.mjs').write_text("""import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const requests = readFileSync('workers/core/repositories/employee-requests-legacy.js', 'utf8');
const ui = readFileSync('src/pages/hr/EmployeeRequests.tsx', 'utf8');

test('attendance corrections require an explicit target for update or void', () => {
  assert.match(requests, /attendance_target_required/);
  assert.match(requests, /correctionType\.startsWith\('update_'\)/);
});

test('request form does not invent overtime hours and describes attendance void semantics', () => {
  assert.match(ui, /type === \"overtime\"\) return \{ \.\.\.common, date: today, startTime: \"\", endTime: \"\"/);
  assert.match(ui, /إلغاء بصمة خاطئة مع حفظ السجل/);
  assert.doesNotMatch(ui, /startTime: \"23:00\", endTime: \"00:00\"/);
});
""", encoding='utf-8')
