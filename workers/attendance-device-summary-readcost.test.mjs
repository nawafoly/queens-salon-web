import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";

const source = readFileSync(new URL("./attendance-worker.js", import.meta.url), "utf8");

test("attendance records dashboard counts new devices using canonical registry, never a full punch-ledger JSON grouping", () => {
  const begin = source.indexOf("async function listAttendanceRecords(");
  const end = source.indexOf("async function loadSharedDeviceUsage(", begin);
  assert.ok(begin > -1 && end > begin, "attendance list handler must exist");
  const handler = source.slice(begin, end);
  assert.match(handler, /SELECT COUNT\(\*\) AS new_devices\s+FROM attendance_devices\s+WHERE first_seen_at >= \? AND first_seen_at < \?/);
  assert.doesNotMatch(handler, /SELECT COUNT\(\*\) AS new_devices\s+FROM\s*\(\s*SELECT/);
  assert.match(handler, /newDevices: Number\(deviceSummary\.new_devices \|\| 0\)/);
});

test("registry summary preserves distinct first-seen device count without scanning all punches", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE attendance_records (id INTEGER PRIMARY KEY, server_time TEXT NOT NULL, device_info TEXT NOT NULL)");
    db.exec("CREATE TABLE attendance_devices (device_id TEXT PRIMARY KEY, first_seen_at TEXT NOT NULL)");
    const insert = db.prepare("INSERT INTO attendance_records (server_time, device_info) VALUES (?, ?)");
    const devices = db.prepare("INSERT INTO attendance_devices (device_id, first_seen_at) VALUES (?, ?)");
    const oldTime = "2026-11-01T09:00:00.000Z";
    const todayTime = "2026-11-02T09:00:00.000Z";
    for (const [id, first] of [["old-a", oldTime], ["old-b", oldTime], ["new-a", todayTime]]) {
      devices.run(id, first);
      for (let i = 0; i < 1000; i++) insert.run(i === 0 ? first : todayTime, JSON.stringify({ deviceId: id }));
    }
    const start = "2026-11-02T00:00:00.000Z";
    const end = "2026-11-03T00:00:00.000Z";
    const canonical = db.prepare("SELECT COUNT(*) AS new_devices FROM attendance_devices WHERE first_seen_at >= ? AND first_seen_at < ?").get(start, end);
    const legacySql = [
      "SELECT COUNT(*) AS new_devices FROM (",
      "SELECT trim(json_extract(device_info, '$.deviceId')) AS device_id,",
      "MIN(COALESCE(NULLIF(trim(json_extract(device_info, '$.firstSeenAt')), ''), server_time)) AS first_seen_at",
      "FROM attendance_records WHERE length(trim(coalesce(json_extract(device_info, '$.deviceId'), ''))) > 0",
      "GROUP BY trim(json_extract(device_info, '$.deviceId'))",
      "HAVING first_seen_at >= ? AND first_seen_at < ?",
      ")",
    ].join(" ");
    const legacy = db.prepare(legacySql).get(start, end);
    assert.equal(canonical.new_devices, 1);
    assert.equal(legacy.new_devices, canonical.new_devices);
    assert.equal(db.prepare("SELECT COUNT(*) AS total FROM attendance_records").get().total, 3000);
    assert.equal(db.prepare("SELECT COUNT(*) AS total FROM attendance_devices").get().total, 3);
  } finally {
    db.close();
  }
});


test("daily attendance aggregates use existing result-time index without excluding valid punches", () => {
  const securityStart = source.indexOf("async function", source.indexOf("SELECT COUNT(*) AS checked_in"));
  // Both daily aggregates must constrain result, enabling the existing (result, server_time) index.
  const indexPredicates = source.match(/WHERE result IN \('allowed', 'rejected'\)\s+AND server_time >= \? AND server_time < \?/g) || [];
  assert.equal(indexPredicates.length, 2);

  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE attendance_records (id INTEGER PRIMARY KEY, result TEXT NOT NULL CHECK (result IN ('allowed','rejected')), type TEXT NOT NULL, server_time TEXT NOT NULL, location_accuracy REAL NOT NULL)");
    db.exec("CREATE INDEX idx_attendance_records_result_time ON attendance_records(result,server_time DESC)");
    const insert = db.prepare("INSERT INTO attendance_records(result,type,server_time,location_accuracy) VALUES(?,?,?,?)");
    const before = "2026-11-01T10:00:00.000Z", today = "2026-11-02T10:00:00.000Z";
    for (let i = 0; i < 1000; i++) insert.run(i % 4 === 0 ? "rejected" : "allowed", i % 2 === 0 ? "check_in" : "check_out", i < 10 ? today : before, 10);
    const start = "2026-11-02T00:00:00.000Z", end = "2026-11-03T00:00:00.000Z";
    const measure = "SELECT COUNT(*) AS total, SUM(CASE WHEN type='check_in' THEN 1 ELSE 0 END) AS ins, SUM(CASE WHEN result='rejected' THEN 1 ELSE 0 END) AS rejected, AVG(location_accuracy) AS accuracy FROM attendance_records";
    const previous = db.prepare(measure + " WHERE server_time >= ? AND server_time < ?").get(start,end);
    const optimizedSql = measure + " WHERE result IN ('allowed','rejected') AND server_time >= ? AND server_time < ?";
    const optimized = db.prepare(optimizedSql).get(start,end);
    assert.deepEqual({ ...optimized }, { ...previous });
    const plan = db.prepare("EXPLAIN QUERY PLAN " + optimizedSql).all(start,end);
    assert.ok(plan.some((row) => String(row.detail).includes("SEARCH attendance_records USING INDEX idx_attendance_records_result_time")), JSON.stringify(plan));
  } finally {
    db.close();
  }
});
