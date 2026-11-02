import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { attendanceDeviceAssignmentReconcileStatements } from './attendance-worker.js';

test('both attendance admin mutation paths reconcile their materialized device usage atomically', () => {
  const source = readFileSync(new URL('./attendance-worker.js', import.meta.url), 'utf8');
  assert.equal((source.match(/attendanceDeviceAssignmentReconcileStatements\(employeeUid, now\)/g) || []).length, 2);
  assert.match(source, /statements\.push\(db\.prepare\(sql\)\.bind\(\.\.\.params\)\)/);
  assert.match(source, /\.\.\.attendanceDeviceAssignmentReconcileStatements\(employeeUid, now\)\.map/);
});

test('admin edit, partial clear and full clear update per-employee device counters', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE attendance_records (id INTEGER PRIMARY KEY, employee_uid TEXT NOT NULL, server_time TEXT NOT NULL, result TEXT NOT NULL, device_info TEXT)');
    db.exec('CREATE INDEX idx_attendance_records_employee_time ON attendance_records (employee_uid, server_time DESC)');
    db.exec('CREATE TABLE attendance_device_assignments (device_id TEXT NOT NULL, employee_uid TEXT NOT NULL, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, records_count INTEGER NOT NULL, allowed_count INTEGER NOT NULL, rejected_count INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (device_id, employee_uid))');
    const first = '2026-11-01T08:00:00.000Z', second = '2026-11-01T10:00:00.000Z';
    const third = '2026-11-01T12:00:00.000Z', edited = '2026-11-01T16:00:00.000Z';
    const seed = db.prepare('INSERT INTO attendance_records (employee_uid, server_time, result, device_info) VALUES (?,?,?,?)');
    seed.run('employee-A', first, 'allowed', JSON.stringify({ deviceId: 'shared-device' }));
    seed.run('employee-A', second, 'rejected', JSON.stringify({ deviceId: 'shared-device' }));
    seed.run('employee-A', third, 'allowed', JSON.stringify({ deviceId: 'shared-device' }));
    seed.run('employee-B', first, 'allowed', JSON.stringify({ deviceId: 'shared-device' }));
    const add = db.prepare('INSERT INTO attendance_device_assignments VALUES (?,?,?,?,?,?,?,?)');
    add.run('shared-device','employee-A',first,third,3,2,1,first);
    add.run('shared-device','employee-B',first,first,1,1,0,first);

    const reconcile = (uid) => {
      db.exec('BEGIN');
      try {
        for (const entry of attendanceDeviceAssignmentReconcileStatements(uid, edited)) {
          db.prepare(entry.sql).run(...entry.params);
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    };
    db.prepare('UPDATE attendance_records SET server_time = ? WHERE employee_uid = ? AND server_time = ?').run(edited,'employee-A',first);
    db.prepare('DELETE FROM attendance_records WHERE employee_uid = ? AND server_time = ?').run('employee-A',second);
    reconcile('employee-A');
    const a = db.prepare('SELECT * FROM attendance_device_assignments WHERE employee_uid = ?').get('employee-A');
    assert.equal(a.records_count, 2);
    assert.equal(a.allowed_count, 2);
    assert.equal(a.rejected_count, 0);
    assert.equal(a.first_seen_at, third);
    assert.equal(a.last_seen_at, edited);
    const b = db.prepare('SELECT * FROM attendance_device_assignments WHERE employee_uid = ?').get('employee-B');
    assert.equal(b.records_count, 1);
    assert.equal(b.first_seen_at, first);

    db.prepare('DELETE FROM attendance_records WHERE employee_uid = ?').run('employee-A');
    reconcile('employee-A');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM attendance_device_assignments WHERE employee_uid = ?').get('employee-A').n, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM attendance_device_assignments WHERE employee_uid = ?').get('employee-B').n, 1);
    const plan = db.prepare('EXPLAIN QUERY PLAN SELECT COUNT(*) FROM attendance_records WHERE employee_uid = ?').all('employee-A');
    assert.ok(plan.some(p => /SEARCH attendance_records USING COVERING INDEX idx_attendance_records_employee_time/.test(p.detail)), JSON.stringify(plan));
  } finally {
    db.close();
  }
});
