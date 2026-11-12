import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

const source = await readFile(new URL('./core/repositories/permissions.js', import.meta.url), 'utf8');
const predicate = source.match(/const permissionConflictPredicate = `([\s\S]*?)`;/)?.[1];
assert.ok(predicate, 'Core SQL conflict predicate must exist');

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE employee_permission_requests (
      id TEXT PRIMARY KEY, salon_id TEXT, employee_id TEXT, date_key TEXT,
      requested_exit_time TEXT, expected_return_time TEXT, status TEXT
    );
    CREATE TABLE employee_leaves (
      id TEXT PRIMARY KEY, salon_id TEXT, employee_id TEXT, request_id TEXT,
      start_date TEXT, end_date TEXT, status TEXT, duration_kind TEXT,
      partial_start_time TEXT, partial_end_time TEXT
    );
  `);
  return db;
}
function insertPermission(db, { id, employee = 'staff-a', day = '2026-11-12', start, end, status = 'returned' }) {
  const result = db.prepare(`
    INSERT INTO employee_permission_requests
    (id, salon_id, employee_id, date_key, requested_exit_time, expected_return_time, status)
    SELECT ?, 'main', ?, ?, ?, ?, ?
    WHERE ${predicate}
  `).run(
    id, employee, day, start, end, status,
    'main', employee, day, id, end, start,
    'main', employee, day, day, id, end, start,
  );
  return result.changes;
}
function insertLeave(db, { id, kind = 'full_day', start = null, end = null, employee = 'staff-a', day = '2026-11-12' }) {
  db.prepare(`INSERT INTO employee_leaves
    (id, salon_id, employee_id, request_id, start_date, end_date, status, duration_kind, partial_start_time, partial_end_time)
    VALUES (?, 'main', ?, NULL, ?, ?, 'approved', ?, ?, ?)`).run(id, employee, day, day, kind, start, end);
}
test('simultaneous sequential writes cannot insert overlapping permissions, adjacent intervals are allowed', () => {
  const db = database();
  assert.equal(insertPermission(db, { id: 'p1', start: '12:00', end: '14:00' }), 1);
  assert.equal(insertPermission(db, { id: 'p2', start: '13:00', end: '15:00' }), 0);
  assert.equal(insertPermission(db, { id: 'p3', start: '14:00', end: '15:00' }), 1);
  assert.equal(insertPermission(db, { id: 'p4', employee: 'staff-b', start: '13:00', end: '15:00' }), 1);
  assert.equal(insertPermission(db, { id: 'p5', day: '2026-11-13', start: '13:00', end: '15:00' }), 1);
  db.close();
});
test('approved full-day leave blocks any permission on its date', () => {
  const db = database();
  insertLeave(db, { id: 'leave-1' });
  assert.equal(insertPermission(db, { id: 'p1', start: '12:00', end: '13:00' }), 0);
  db.close();
});
test('approved partial leave rejects overlapping, accepts disjoint time', () => {
  const db = database();
  insertLeave(db, { id: 'leave-1', kind: 'partial', start: '12:00', end: '13:00' });
  assert.equal(insertPermission(db, { id: 'p1', start: '12:30', end: '14:00' }), 0);
  assert.equal(insertPermission(db, { id: 'p2', start: '13:00', end: '14:00' }), 1);
  db.close();
});
test('legacy partial leave without times fails closed', () => {
  const db = database();
  insertLeave(db, { id: 'leave-1', kind: 'partial' });
  assert.equal(insertPermission(db, { id: 'p1', start: '10:00', end: '11:00' }), 0);
  db.close();
});
test('Core guards both direct creation and approval with atomic D1.batch writes', () => {
  assert.match(source, /source === 'admin_direct' \? permissionConflictPredicate/);
  assert.match(source, /WHERE salon_id = \? AND id = \? AND status = 'pending'\s+AND \$\{permissionConflictPredicate\}/);
  assert.match(source, /assertConflictFreeWrite/);
  assert.match(source, /json_extract\('PERMISSION_INTERVAL_CONFLICT'/);
});

test('deliberate SQLite assertion failure is mapped to a permission domain conflict, not HTTP 500', () => {
  assert.match(source, /async function runPermissionConflictGuardedBatch\(db, statements\)/);
  assert.match(source, /if \(\/malformed json\/i\.test\(message\)\)/);
  assert.match(source, /new AppError\(409, 'core_permission:interval_conflict'/);
  const guardedCalls = source.match(/await runPermissionConflictGuardedBatch\(db, \[/g) || [];
  assert.equal(guardedCalls.length, 3, 'creation, approval and exit must all use translated atomic guard');
});
