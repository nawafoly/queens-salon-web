import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';

const repoSource = await fs.readFile(new URL('./core/repositories/salary-certificate-requests.js', import.meta.url), 'utf8');
const migrationSource = await fs.readFile(new URL('../migrations/core/0067_salary_certificate_request_type.sql', import.meta.url), 'utf8');

test('salary certificate identity is bound to authenticated actor', () => {
  assert.match(repoSource, /const actorEmployeeId = cleanText\(actor\.employeeId\)/);
  assert.match(repoSource, /const actorUid = cleanText\(actor\.uid\)/);
  assert.doesNotMatch(repoSource, /data\.employeeId\s*\|\|\s*data\.employee_id/);
  assert.doesNotMatch(repoSource, /data\.employeeUid\s*\|\|\s*data\.employee_uid/);
});

test('salary certificate request type is allowed by the latest D1 migration', () => {
  assert.match(migrationSource, /'salary_certificate'/);
  assert.match(migrationSource, /CREATE TABLE employee_requests_v3/);
  assert.match(migrationSource, /INSERT INTO employee_requests_v3/);
  assert.match(migrationSource, /ALTER TABLE employee_requests_v3 RENAME TO employee_requests/);
});
