import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

const worker = readFileSync(new URL('./attendance-worker.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('./attendance-migrations/0005_create_attendance_device_security.sql', import.meta.url), 'utf8');

test('shared-device details use the backfilled and punch-maintained registry, never JSON-group the full ledger', () => {
  const start = worker.indexOf('async function loadSharedDeviceUsage(');
  const end = worker.indexOf('async function generateAttendanceMonthlySummaryRequest(', start);
  assert.ok(start !== -1 && end > start);
  const source = worker.slice(start, end);
  assert.match(source, /FROM attendance_device_assignments\s+WHERE device_id IN/);
  assert.match(source, /last_seen_at,\s+first_seen_at,\s+records_count/);
  assert.doesNotMatch(source, /FROM attendance_records/);
  assert.match(worker, /ON CONFLICT\(device_id, employee_uid\) DO UPDATE SET/);
  assert.match(migration, /INSERT OR IGNORE INTO attendance_device_assignments/);
});

test('registry results match historical per-device/per-employee grouping with bounded indexed reads', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE attendance_records (id INTEGER PRIMARY KEY, employee_uid TEXT NOT NULL, server_time TEXT NOT NULL, device_info TEXT NOT NULL)");
    db.exec("CREATE TABLE attendance_device_assignments (device_id TEXT NOT NULL, employee_uid TEXT NOT NULL, first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, records_count INTEGER NOT NULL, PRIMARY KEY(device_id, employee_uid))");

    const insertRecord = db.prepare('INSERT INTO attendance_records (employee_uid, server_time, device_info) VALUES (?, ?, ?)');
    const insertAssignment = db.prepare('INSERT INTO attendance_device_assignments VALUES (?, ?, ?, ?, ?)');
    const pairs = [
      ['shared-a', 'employee-one', 1100],
      ['shared-a', 'employee-two', 600],
      ['solo-b', 'employee-one', 1200],
      ['shared-c', 'employee-one', 40],
      ['shared-c', 'employee-three', 60],
    ];

    for (const [device, employee, count] of pairs) {
      let first, last;
      for (let i = 0; i < count; i++) {
        const timestamp = new Date(Date.UTC(2026, 9, 1, 0, 0, 0) + i * 60000).toISOString();
        first ??= timestamp;
        last = timestamp;
        insertRecord.run(employee, timestamp, JSON.stringify({ deviceId: device }));
      }
      insertAssignment.run(device, employee, first, last, count);
    }

    const ids = ['shared-a', 'solo-b', 'shared-c'];
    const params = ids.map(() => '?').join(',');
    const oldSql = "SELECT trim(json_extract(device_info, '$.deviceId')) AS device_id, employee_uid, MAX(server_time) AS last_seen_at, MIN(server_time) AS first_seen_at, COUNT(*) AS records_count FROM attendance_records WHERE trim(json_extract(device_info, '$.deviceId')) IN (" + params + ") AND length(trim(coalesce(employee_uid, ''))) > 0 GROUP BY trim(json_extract(device_info, '$.deviceId')), employee_uid ORDER BY device_id ASC, last_seen_at DESC";
    const newSql = "SELECT device_id, employee_uid, last_seen_at, first_seen_at, records_count FROM attendance_device_assignments WHERE device_id IN (" + params + ") AND length(trim(coalesce(employee_uid, ''))) > 0 ORDER BY device_id ASC, last_seen_at DESC";

    const original = db.prepare(oldSql).all(...ids).map(row => ({ ...row, records_count: Number(row.records_count) }));
    const indexed = db.prepare(newSql).all(...ids).map(row => ({ ...row, records_count: Number(row.records_count) }));
    assert.deepEqual(indexed, original);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM attendance_records').get().n, 3000);
    assert.equal(indexed.length, 5);
    const plan = db.prepare('EXPLAIN QUERY PLAN ' + newSql).all(...ids);
    assert.ok(plan.some(row => /SEARCH attendance_device_assignments USING INDEX/.test(row.detail)), JSON.stringify(plan));
    assert.ok(!plan.some(row => /SCAN attendance_records/.test(row.detail)));
    assert.equal(indexed.filter(row => row.device_id === 'shared-a').length, 2);
    assert.equal(indexed.filter(row => row.device_id === 'solo-b').length, 1);
  } finally {
    db.close();
  }
});
