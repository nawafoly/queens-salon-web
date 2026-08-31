import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  buildAttendanceSecurityEventSpecs,
  classifyAttendanceDeviceSecurity,
  resolveAttendanceZoneAssignment,
  resolveZones,
} from "./attendance-worker.js";
import attendanceEdgeWorker from "./malikat-attendance-worker.js";

function rowObject(row) {
  return row == null ? null : { ...row };
}

function d1FromSqlite(database) {
  const bindStatement = (sql, bindings) => {
    const execute = (mode) => {
      const statement = database.prepare(sql);
      if (mode === "first") return rowObject(statement.get(...bindings));
      if (mode === "all") {
        return { results: statement.all(...bindings).map((row) => ({ ...row })) };
      }
      const result = statement.run(...bindings);
      return { meta: { changes: Number(result.changes || 0) } };
    };

    return {
      async first() {
        return execute("first");
      },
      async all() {
        return execute("all");
      },
      async run() {
        return execute("run");
      },
      async __batchRun() {
        return execute("run");
      },
    };
  };

  return {
    prepare(sql) {
      return {
        bind(...bindings) {
          return bindStatement(sql, bindings);
        },
        async first() {
          return bindStatement(sql, []).first();
        },
        async all() {
          return bindStatement(sql, []).all();
        },
        async run() {
          return bindStatement(sql, []).run();
        },
      };
    },
    async batch(statements) {
      database.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) {
          results.push(await statement.__batchRun());
        }
        database.exec("COMMIT");
        return results;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function coreDirectoryDb() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE employee_profiles (
      id TEXT PRIMARY KEY,
      salon_id TEXT NOT NULL,
      firebase_uid TEXT,
      updated_at TEXT
    );
    CREATE TABLE employee_employment (
      salon_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      allowed_zone_ids_json TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (salon_id, employee_id)
    );
  `);
  return { database, db: d1FromSqlite(database) };
}

function seedCoreEmployee(database, {
  id,
  firebaseUid,
  zones = [],
  updatedAt = "2026-08-31T12:00:00.000Z",
}) {
  database
    .prepare("INSERT INTO employee_profiles (id, salon_id, firebase_uid, updated_at) VALUES (?, 'main', ?, ?)")
    .run(id, firebaseUid, updatedAt);
  database
    .prepare("INSERT INTO employee_employment (salon_id, employee_id, allowed_zone_ids_json) VALUES ('main', ?, ?)")
    .run(id, JSON.stringify(zones));
}

function attendanceDb() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE work_zones (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      center_lat REAL NOT NULL,
      center_lng REAL NOT NULL,
      radius_meters REAL NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      office_ip TEXT,
      created_at TEXT,
      updated_at TEXT
    );
  `);
  return { database, db: d1FromSqlite(database) };
}

function seedZone(database, { id, active = 1, radius = 50 }) {
  database
    .prepare(`
      INSERT INTO work_zones (
        id, name, type, center_lat, center_lng, radius_meters, active,
        office_ip, created_at, updated_at
      ) VALUES (?, ?, 'radius', 24.7136, 46.6753, ?, ?, NULL,
        '2026-08-31T12:00:00.000Z', '2026-08-31T12:00:00.000Z')
    `)
    .run(id, id, radius, active);
}

test("attendance worker preflight allows local dev Authorization requests", async () => {
  const origin = "http://127.0.0.1:5174";
  const response = await attendanceEdgeWorker.fetch(
    new Request("https://attendance.test/attendance/records", {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
      },
    }),
    {}
  );

  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
  assert.match(response.headers.get("Access-Control-Allow-Methods") || "", /\bGET\b/);
  assert.match(response.headers.get("Access-Control-Allow-Headers") || "", /Authorization/i);
});

test("attendance worker error responses keep production CORS headers", async () => {
  const origin = "https://queens-salon-web.vercel.app";
  const response = await attendanceEdgeWorker.fetch(
    new Request("https://attendance.test/attendance/records", {
      method: "GET",
      headers: { Origin: origin },
    }),
    {}
  );

  assert.equal(response.status, 500);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), origin);
  assert.equal((await response.json()).message, "missing_attendance_d1_binding");
});

test("new employee with Core attendance zone resolves the same zone by Firebase uid", async () => {
  const { database, db } = coreDirectoryDb();
  seedCoreEmployee(database, {
    id: "NAJIDAH_DIPATUAN_AMRODIN",
    firebaseUid: "7XoxXS2Ru5dJWcQPL3Um9U7PU353",
    zones: ["الفرع_الرئيسي"],
  });

  const result = await resolveAttendanceZoneAssignment({
    directoryDb: db,
    salonId: "main",
    requester: { uid: "7XoxXS2Ru5dJWcQPL3Um9U7PU353" },
    requestedEmployeeId: "NAJIDAH_DIPATUAN_AMRODIN",
    employeeResolution: {
      employeeDocId: "7XoxXS2Ru5dJWcQPL3Um9U7PU353",
      identityIds: ["7XoxXS2Ru5dJWcQPL3Um9U7PU353"],
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.source, "core");
  assert.equal(result.coreEmployeeId, "NAJIDAH_DIPATUAN_AMRODIN");
  assert.deepEqual(result.allowedZoneIds, ["الفرع_الرئيسي"]);
});

test("Core attendance zone takes precedence over legacy Firestore zone", async () => {
  const { database, db } = coreDirectoryDb();
  seedCoreEmployee(database, {
    id: "emp-core",
    firebaseUid: "firebase-1",
    zones: ["core-zone"],
  });

  const result = await resolveAttendanceZoneAssignment({
    directoryDb: db,
    salonId: "main",
    requester: { uid: "firebase-1" },
    employeeResolution: {
      employeeDocId: "emp-core",
      identityIds: ["firebase-1", "emp-core"],
    },
    legacyEmployeeData: { allowedZoneIds: ["legacy-zone"] },
    legacyUserData: { attendanceZoneId: "legacy-user-zone" },
  });

  assert.equal(result.source, "core");
  assert.equal(result.legacyUsed, false);
  assert.deepEqual(result.allowedZoneIds, ["core-zone"]);
  assert.deepEqual(result.legacyAllowedZoneIds, ["legacy-zone", "legacy-user-zone"]);
});

test("missing Core employment can use legacy compatibility zone", async () => {
  const { database, db } = coreDirectoryDb();
  database
    .prepare("INSERT INTO employee_profiles (id, salon_id, firebase_uid, updated_at) VALUES ('legacy-emp', 'main', 'legacy-uid', '2026-08-31T12:00:00.000Z')")
    .run();

  const result = await resolveAttendanceZoneAssignment({
    directoryDb: db,
    salonId: "main",
    requester: { uid: "legacy-uid" },
    employeeResolution: {
      employeeDocId: "legacy-emp",
      identityIds: ["legacy-uid", "legacy-emp"],
    },
    legacyEmployeeData: { allowedZoneIds: ["legacy-zone"] },
  });

  assert.equal(result.source, "legacy");
  assert.equal(result.legacyUsed, true);
  assert.deepEqual(result.allowedZoneIds, ["legacy-zone"]);
});

test("Core empty attendance zones do not fall back to legacy mirrors", async () => {
  const { database, db } = coreDirectoryDb();
  seedCoreEmployee(database, {
    id: "emp-empty",
    firebaseUid: "uid-empty",
    zones: [],
  });

  const result = await resolveAttendanceZoneAssignment({
    directoryDb: db,
    salonId: "main",
    requester: { uid: "uid-empty" },
    employeeResolution: {
      employeeDocId: "emp-empty",
      identityIds: ["uid-empty", "emp-empty"],
    },
    legacyEmployeeData: { allowedZoneIds: ["legacy-zone"] },
  });

  assert.equal(result.source, "core");
  assert.equal(result.legacyUsed, false);
  assert.deepEqual(result.allowedZoneIds, []);

  const zones = await resolveZones(attendanceDb().db, result.allowedZoneIds);
  assert.equal(zones.error, "zone_not_assigned");
});

test("attendance zone resolution reports missing and inactive Core-assigned zones", async () => {
  const { database, db } = attendanceDb();
  seedZone(database, { id: "active-zone" });
  seedZone(database, { id: "inactive-zone", active: 0 });

  const one = await resolveZones(db, ["active-zone"]);
  assert.equal(one.error, "");
  assert.deepEqual(one.resolvedZoneIds, ["active-zone"]);

  seedZone(database, { id: "second-zone" });

  const many = await resolveZones(db, ["active-zone", "second-zone"]);
  assert.equal(many.error, "");
  assert.deepEqual(many.resolvedZoneIds, ["active-zone", "second-zone"]);

  const missing = await resolveZones(db, ["missing-zone"]);
  assert.equal(missing.error, "zone_not_found");
  assert.deepEqual(missing.missingZoneIds, ["missing-zone"]);

  const inactive = await resolveZones(db, ["inactive-zone"]);
  assert.equal(inactive.error, "zone_invalid");
});

test("Core employee/account identity mismatch blocks zone fallback", async () => {
  const { database, db } = coreDirectoryDb();
  seedCoreEmployee(database, {
    id: "requester-emp",
    firebaseUid: "requester-uid",
    zones: ["requester-zone"],
  });
  seedCoreEmployee(database, {
    id: "other-emp",
    firebaseUid: "other-uid",
    zones: ["other-zone"],
  });

  const result = await resolveAttendanceZoneAssignment({
    directoryDb: db,
    salonId: "main",
    requester: { uid: "requester-uid" },
    requestedEmployeeId: "other-emp",
    employeeResolution: {
      employeeDocId: "other-emp",
      identityIds: ["requester-uid", "other-emp"],
    },
    legacyEmployeeData: { allowedZoneIds: ["legacy-zone"] },
  });

  assert.equal(result.ok, false);
  assert.equal(result.message, "attendance_employee_identity_mismatch");
  assert.equal(result.legacyUsed, false);
  assert.deepEqual(result.allowedZoneIds, []);
});

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
