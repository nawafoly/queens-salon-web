import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  buildAttendanceSecurityEventSpecs,
  classifyAttendanceDeviceSecurity,
} from "./attendance-worker.js";

test("new device is flagged without false device-change warning", () => {
  const result = classifyAttendanceDeviceSecurity({
    deviceId: "malikat-web-v2-new",
    previousDeviceId: "",
    trustStatus: "new",
    assignmentCount: 0,
    assignedToEmployee: false,
    deviceExists: false,
    result: "allowed",
    accuracy: 22,
  });

  assert.equal(result.isNewDevice, true);
  assert.equal(result.isNewForEmployee, true);
  assert.equal(result.deviceChanged, false);
  assert.deepEqual(result.eventTypes, ["new_device"]);
});

test("changed shared device creates security events", () => {
  const result = classifyAttendanceDeviceSecurity({
    deviceId: "malikat-web-v2-shared",
    previousDeviceId: "malikat-web-v2-old",
    trustStatus: "trusted",
    assignmentCount: 2,
    assignedToEmployee: false,
    deviceExists: true,
    result: "allowed",
    accuracy: 18,
  });

  assert.equal(result.deviceChanged, true);
  assert.equal(result.sharedDevice, true);
  assert.deepEqual(result.eventTypes, ["device_changed", "shared_device"]);

  const events = buildAttendanceSecurityEventSpecs({
    classification: result,
    recordId: "record-1",
    previousDeviceId: "malikat-web-v2-old",
    accuracy: 18,
  });
  assert.deepEqual(events.map((event) => event.id), [
    "device_changed:record-1",
    "shared_device:record-1",
  ]);
  assert.equal(events[1].severity, "critical");
});

test("blocked device is rejected with one critical blocked event", () => {
  const result = classifyAttendanceDeviceSecurity({
    deviceId: "malikat-web-v2-blocked",
    previousDeviceId: "malikat-web-v2-blocked",
    trustStatus: "blocked",
    assignmentCount: 1,
    assignedToEmployee: true,
    deviceExists: true,
    result: "rejected",
    rejectionReason: "blocked_device",
    accuracy: 12,
  });

  assert.equal(result.blockedDevice, true);
  assert.deepEqual(result.eventTypes, ["blocked_device_attempt"]);
});

test("poor accuracy rejection is visible without duplicate event ids", () => {
  const result = classifyAttendanceDeviceSecurity({
    deviceId: "malikat-web-v2-a",
    previousDeviceId: "malikat-web-v2-a",
    trustStatus: "trusted",
    assignmentCount: 1,
    assignedToEmployee: true,
    deviceExists: true,
    result: "rejected",
    rejectionReason: "poor_accuracy",
    accuracy: 190,
  });

  assert.deepEqual(result.eventTypes, ["rejected_punch", "poor_accuracy"]);
  const events = buildAttendanceSecurityEventSpecs({
    classification: result,
    recordId: "record-2",
    rejectionReason: "poor_accuracy",
    accuracy: 190,
  });
  assert.equal(new Set(events.map((event) => event.id)).size, 2);
});

test("attendance migration backfills historical devices and employee assignments", () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationsDir = path.join(here, "attendance-migrations");
  const database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");

  for (const migration of [
    "0001_create_attendance.sql",
    "0002_create_attendance_monthly_summaries.sql",
    "0003_add_work_zone_office_ip.sql",
    "0004_create_permission_cache.sql",
  ]) {
    database.exec(fs.readFileSync(path.join(migrationsDir, migration), "utf8"));
  }

  const insert = database.prepare(`
    INSERT INTO attendance_records (
      id, employee_uid, employee_doc_id, type, server_time, client_time,
      location_lat, location_lng, location_accuracy, zone_id, zone_name,
      zone_type, allowed_zone_ids, distance_meters, result,
      rejection_reason, accuracy_accepted, device_info, source,
      created_by_uid, created_by_email, created_by_role, created_at, updated_at
    ) VALUES (?, ?, ?, 'check_in', ?, ?, 24.47, 39.61, 10, NULL, NULL,
              NULL, '[]', NULL, ?, ?, ?, ?, '{}', ?, ?, 'staff', ?, ?)
  `);
  const firstTime = "2026-07-15T06:00:00.000Z";
  const secondTime = "2026-07-16T06:00:00.000Z";
  insert.run(
    "record-old-1", "employee-1", "employee-doc-1", firstTime, firstTime,
    "allowed", null, 1,
    JSON.stringify({ deviceId: "device-history", platform: "Android", appVariant: "staff" }),
    "employee-1", "one@example.com", firstTime, firstTime
  );
  insert.run(
    "record-old-2", "employee-2", "employee-doc-2", secondTime, secondTime,
    "rejected", "outside_zone", 1,
    JSON.stringify({ deviceId: "device-history", platform: "Android", appVariant: "staff" }),
    "employee-2", "two@example.com", secondTime, secondTime
  );

  database.exec(
    fs.readFileSync(
      path.join(migrationsDir, "0005_create_attendance_device_security.sql"),
      "utf8"
    )
  );

  const device = database
    .prepare(`
      SELECT device_id, total_records, allowed_records, rejected_records,
             first_seen_employee_uid, last_seen_employee_uid
      FROM attendance_devices
      WHERE device_id = 'device-history'
    `)
    .get();
  assert.deepEqual({ ...device }, {
    device_id: "device-history",
    total_records: 2,
    allowed_records: 1,
    rejected_records: 1,
    first_seen_employee_uid: "employee-1",
    last_seen_employee_uid: "employee-2",
  });

  const assignments = database
    .prepare(`
      SELECT employee_uid, records_count, allowed_count, rejected_count
      FROM attendance_device_assignments
      WHERE device_id = 'device-history'
      ORDER BY employee_uid
    `)
    .all();
  assert.deepEqual(assignments.map((row) => ({ ...row })), [
    {
      employee_uid: "employee-1",
      records_count: 1,
      allowed_count: 1,
      rejected_count: 0,
    },
    {
      employee_uid: "employee-2",
      records_count: 1,
      allowed_count: 0,
      rejected_count: 1,
    },
  ]);
});

