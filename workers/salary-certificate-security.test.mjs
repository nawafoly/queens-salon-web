import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';

const repoSource = await fs.readFile(new URL('./core/repositories/salary-certificate-requests.js', import.meta.url), 'utf8');
const migrationSource = await fs.readFile(new URL('../migrations/core/0067_salary_certificate_request_type.sql', import.meta.url), 'utf8');

test('salary certificate self-service identity stays actor-bound and cross-employee targeting requires management permission', () => {
  assert.match(repoSource, /const actorEmployeeId = cleanText\(actor\.employeeId\)/);
  assert.match(repoSource, /const actorUid = cleanText\(actor\.uid\)/);
  assert.match(repoSource, /const requestedEmployeeId = cleanText\(data\.employeeId \|\| data\.employee_id\)/);
  assert.match(repoSource, /const requestedEmployeeUid = cleanText\(data\.employeeUid \|\| data\.employee_uid\)/);
  assert.match(repoSource, /const crossEmployeeTarget = Boolean\(/);
  assert.match(repoSource, /actorCanManageEmployeeRequests\(db, salonId, actor\)/);
  assert.match(repoSource, /employee_requests\.manage/);
  assert.match(repoSource, /directEffect === 'deny'/);
  assert.match(repoSource, /core_employee_request:cross_employee_forbidden/);
});

test('salary certificate management targeting remains tenant-scoped', () => {
  assert.match(
    repoSource,
    /FROM employee_profiles\s+WHERE salon_id = \?\s+AND \(id = \? OR firebase_uid = \? OR firebase_uid = \?\)/
  );
  assert.match(repoSource, /core_employee_request:employee_not_found/);
});

test('salary certificate request type migration preserves the dependent reference-gap view', () => {
  assert.match(migrationSource, /'salary_certificate'/);
  assert.match(migrationSource, /CREATE TABLE employee_requests_v3/);
  assert.match(migrationSource, /INSERT INTO employee_requests_v3/);

  const dropView = migrationSource.indexOf('DROP VIEW IF EXISTS employee_request_reference_gaps;');
  const dropTable = migrationSource.indexOf('DROP TABLE employee_requests;');
  const renameTable = migrationSource.indexOf('ALTER TABLE employee_requests_v3 RENAME TO employee_requests;');
  const recreateView = migrationSource.indexOf('CREATE VIEW employee_request_reference_gaps AS');

  assert.ok(dropView >= 0, 'dependent view must be dropped before rebuilding employee_requests');
  assert.ok(dropView < dropTable, 'dependent view must be dropped before employee_requests');
  assert.ok(dropTable < renameTable, 'replacement table must be renamed after the old table is dropped');
  assert.ok(renameTable < recreateView, 'dependent view must be recreated after employee_requests exists again');

  for (const indexName of [
    'idx_employee_requests_employee',
    'idx_employee_requests_uid',
    'idx_employee_requests_type',
    'idx_employee_requests_status',
    'idx_employee_requests_assignee',
    'idx_employee_requests_number',
  ]) {
    assert.match(migrationSource, new RegExp(`CREATE INDEX IF NOT EXISTS ${indexName}`));
  }
});
