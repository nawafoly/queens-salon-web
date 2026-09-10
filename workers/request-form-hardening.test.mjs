import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const requests = readFileSync('workers/core/repositories/employee-requests-legacy.js', 'utf8');
const ui = readFileSync('src/pages/hr/EmployeeRequests.tsx', 'utf8');

test('attendance corrections require an explicit target for update or void', () => {
  assert.match(requests, /attendance_target_required/);
  assert.match(requests, /correctionType\.startsWith\('update_'\)/);
});

test('request form does not invent overtime hours and describes attendance void semantics', () => {
  assert.match(ui, /type === "overtime"\) return \{ \.\.\.common, date: today, startTime: "", endTime: ""/);
  assert.match(ui, /إلغاء بصمة خاطئة مع حفظ السجل/);
  assert.doesNotMatch(ui, /startTime: "23:00", endTime: "00:00"/);
});
