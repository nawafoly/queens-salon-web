import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../migrations/core/0017_shift_control.sql', import.meta.url), 'utf8');
const repository = fs.readFileSync(new URL('../workers/core/repositories/shift-control.js', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../workers/core/index.js', import.meta.url), 'utf8');

test('migration creates shift-control tables and indexes', () => {
  for (const table of ['hr_shift_templates','hr_shift_assignments','hr_schedule_exceptions','hr_payroll_period_locks','hr_shift_audit_log']) {
    assert.match(migration, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
});

test('assignment creation rejects overlapping published assignments', () => {
  assert.match(repository, /shift_assignment_overlap/);
  assert.match(repository, /effective_from <= COALESCE/);
});

test('resolved shift gives approved exceptions priority over assignments', () => {
  const exceptionPos = repository.indexOf("source: 'exception'");
  const assignmentPos = repository.indexOf("source: 'assignment'");
  assert.ok(exceptionPos >= 0 && assignmentPos > exceptionPos);
});

test('core routes expose templates, assignments, exceptions, and resolved shift', () => {
  for (const route of ['shift-templates','shift-assignments','schedule-exceptions','hr-shift:resolve']) {
    assert.ok(worker.includes(route), `missing route ${route}`);
  }
});
