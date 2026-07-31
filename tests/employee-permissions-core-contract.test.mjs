import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');

test('permission frontend is Core D1 only', () => {
  const source = read('src/services/employeePermissionRequests.ts');
  assert.match(source, /coreApiRequest/);
  assert.doesNotMatch(source, /firebase\/firestore|hrCollection|hrDoc|addDoc|getDocs/);
});

test('Core worker exposes permission routes and repository', () => {
  const worker = read('workers/core/index.js');
  const repository = read('workers/core/repositories/permissions.js');
  assert.match(worker, /\/api\/core\/hr\/permissions/);
  assert.match(worker, /case "permissions"/);
  assert.match(repository, /employee_permission_requests/);
  assert.match(repository, /permission_out/);
  assert.match(repository, /permission_return/);
  assert.match(repository, /notification_records/);
});

test('migration links permissions to attendance and payroll', () => {
  const migration = read('migrations/core/0016_employee_permissions.sql');
  assert.match(migration, /employee_permission_requests/);
  assert.match(migration, /employee_permission_events/);
  assert.match(migration, /permission_minutes/);
  assert.match(migration, /unpaid_permission_minutes/);
  assert.match(migration, /trg_payroll_permission_summary_after_insert/);
});
