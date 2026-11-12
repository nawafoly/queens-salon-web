import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('employee UI and Core share employee-only three-day annual leave policy', async () => {
  const ui = await readFile(new URL('../src/pages/hr/EmployeeRequests.tsx', import.meta.url), 'utf8');
  const doc = await readFile(new URL('../src/components/hr/LeaveRequestDocument.tsx', import.meta.url), 'utf8');
  const api = await readFile(new URL('../src/services/coreApiClient.ts', import.meta.url), 'utf8');
  assert.match(ui, /startDate < minimumAnnualLeaveRequestDate\(\)/);
  assert.match(doc, /min=\{annualMinimumDate\}/);
  assert.match(api, /"core_employee_request:annual_leave_three_day_notice":/);
});
