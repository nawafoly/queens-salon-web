import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const worker = fs.readFileSync('workers/core/repositories/permissions.js', 'utf8');
const adminPage = fs.readFileSync('src/pages/hr/AdminPermissionRequests.tsx', 'utf8');
const employeePage = fs.readFileSync('src/pages/hr/EmployeePermissionRequests.tsx', 'utf8');

test('approval adopts the employee requested exit and return times', () => {
  assert.match(worker, /SET status = 'returned'/);
  assert.match(worker, /actual_exit_time = \?/);
  assert.match(worker, /actual_return_time = \?/);
  assert.match(worker, /durationMinutes\(exitTime, approvedReturnTime\)/);
  assert.match(worker, /autoFinalized: true/);
  assert.match(worker, /insertAttendanceEvent\(db, salonId, updated, 'permission_out', exitTime/);
  assert.match(worker, /insertAttendanceEvent\(db, salonId, updated, 'permission_return', approvedReturnTime/);
  assert.match(worker, /refreshPayrollEntries\(db, salonId, updated\.employee_id, updated\.date_key\)/);
});

test('admin direct permission is finalized from its entered times', () => {
  assert.match(worker, /const autoApproved = source === 'admin_direct'/);
  assert.match(worker, /const status = autoApproved \? 'returned' : 'pending'/);
  assert.match(worker, /core_permission:return_time_required/);
});

test('manual out and return buttons are removed from normal admin flow', () => {
  assert.doesNotMatch(adminPage, /تسجيل الخروج الآن/);
  assert.doesNotMatch(adminPage, /تسجيل العودة الآن/);
  assert.match(adminPage, /موافقة واعتماد الوقت/);
  assert.match(adminPage, /وقت الخروج والعودة\s+المحدد في الطلب يُعتمد تلقائيًا/);
});

test('employee screen explains that approved request times are adopted', () => {
  assert.match(employeePage, /عند الموافقة يُعتمد وقت الخروج والعودة الذي حددته تلقائيًا/);
  assert.match(employeePage, /تم اعتماد الاستئذان/);
});
