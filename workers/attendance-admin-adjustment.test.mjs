import test from "node:test";
import assert from "node:assert/strict";
import { migratedD1 } from "./test-support/sqlite-d1.mjs";
import {
  adjustAttendanceRecords,
  clearAttendanceRecordsForDay,
  parseRiyadhDateTime,
  resolveCanonicalAttendanceIdentity,
} from "./attendance-worker.js";

const CANONICAL_UID = "eqnFOm4TtWdAjpLeG4XopdEj24I2";
const CORE_ID = "1002";

function rowObject(row) {
  return row == null ? null : { ...row };
}

function createFixture() {
  const attendanceDb = migratedD1("../attendance-migrations/");
  const coreDb = migratedD1("../../migrations/core/");

  const attendanceSqlite = attendanceDb.database;
  const coreSqlite = coreDb.database;

  const timestamp = "2026-01-01T00:00:00.000Z";

  coreSqlite.prepare(`
    INSERT INTO employee_profiles (
      id, salon_id, firebase_uid, name, status,
      created_at, updated_at
    )
    VALUES (?, 'main', ?, 'Isolated attendance employee',
            'active', ?, ?)
  `).run(CORE_ID, CANONICAL_UID, timestamp, timestamp);

  coreSqlite.prepare(`
    INSERT INTO employee_employment (
      salon_id, employee_id, employment_status,
      start_date, base_salary_halalas,
      expected_work_days, expected_work_hours,
      daily_scheduled_hours, attendance_payroll_mode,
      social_insurance_category,
      social_insurance_effective_from,
      gosi_wage_mode, created_at, updated_at
    )
    VALUES (
      'main', ?, 'active', '2026-01-01',
      300000, 30, 240, 8, 'required',
      'non_saudi', '2026-01-01',
      'derived', ?, ?
    )
  `).run(CORE_ID, timestamp, timestamp);

  return {
    attendanceSqlite,
    coreSqlite,
    attendanceDb,
    coreDb,
  };
}

function insertRecord(database, {
  id,
  uid = CANONICAL_UID,
  docId = CORE_ID,
  type,
  serverTime,
  createdByRole = "staff",
}) {
  database.prepare(`
    INSERT INTO attendance_records (
      id, employee_uid, employee_doc_id, type, server_time, client_time,
      location_lat, location_lng, location_accuracy, zone_id, zone_name,
      zone_type, allowed_zone_ids, distance_meters, result,
      rejection_reason, accuracy_accepted, device_info, source,
      created_by_uid, created_by_email, created_by_role, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, NULL, NULL, NULL, '[]', NULL,
              'allowed', NULL, 1, '{}', '{}', 'seed', 'seed@example.com', ?, ?, ?)
  `).run(
    id,
    uid,
    docId,
    type,
    serverTime,
    serverTime,
    createdByRole,
    serverTime,
    serverTime
  );
}

function setState(database, { recordId, type, serverTime }) {
  database.prepare(`
    INSERT INTO attendance_state (
      employee_uid, employee_doc_id, status, last_type, last_record_id,
      last_server_time, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(employee_uid) DO UPDATE SET
      employee_doc_id = excluded.employee_doc_id,
      status = excluded.status,
      last_type = excluded.last_type,
      last_record_id = excluded.last_record_id,
      last_server_time = excluded.last_server_time,
      updated_at = excluded.updated_at
  `).run(
    CANONICAL_UID,
    CORE_ID,
    type === "check_in" ? "checked_in" : "checked_out",
    type,
    recordId,
    serverTime,
    serverTime
  );
}

function requester(permissions = []) {
  return {
    uid: "admin-user",
    email: "admin@example.com",
    runtime: {
      isActive: true,
      role: "hr",
      permissionsAllow: permissions,
      permissionsDeny: [],
    },
  };
}

function adjustmentRequest(body) {
  return new Request("https://attendance.test/attendance/admin-adjustment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function json(response) {
  return response.json();
}

function dayRows(database, date) {
  const start = `${date}T00:00:00.000Z`;
  const next = new Date(Date.parse(start) + 24 * 60 * 60 * 1000).toISOString();
  return database
    .prepare(
      "SELECT * FROM attendance_records WHERE employee_uid = ? AND server_time >= ? AND server_time < ? ORDER BY server_time, id"
    )
    .all(CANONICAL_UID, start, next)
    .map((row) => ({ ...row }));
}

test("canonical attendance identity resolves Core id and Firebase UID to one employee", async () => {
  const { coreDb } = createFixture();
  const fromCoreId = await resolveCanonicalAttendanceIdentity(coreDb, "main", {
    employeeUid: CORE_ID,
    employeeDocId: CORE_ID,
  });
  const fromFirebaseUid = await resolveCanonicalAttendanceIdentity(coreDb, "main", {
    employeeUid: CANONICAL_UID,
    employeeDocId: CANONICAL_UID,
  });

  assert.equal(fromCoreId.ok, true);
  assert.equal(fromCoreId.employeeUid, CANONICAL_UID);
  assert.equal(fromCoreId.employeeDocId, CORE_ID);
  assert.equal(fromFirebaseUid.employeeUid, CANONICAL_UID);
  assert.equal(fromFirebaseUid.employeeDocId, CORE_ID);
});

test("admin edits existing check-in and check-out without changing the other side", async () => {
  const { attendanceSqlite, attendanceDb, coreDb } = createFixture();
  insertRecord(attendanceSqlite, {
    id: "in-1",
    type: "check_in",
    serverTime: "2026-08-16T12:17:00.505Z",
  });
  insertRecord(attendanceSqlite, {
    id: "out-1",
    type: "check_out",
    serverTime: "2026-08-16T20:02:49.730Z",
  });

  let response = await adjustAttendanceRecords(
    adjustmentRequest({
      employeeUid: CORE_ID,
      employeeDocId: CORE_ID,
      date: "2026-08-16",
      checkInTime: "15:18",
    }),
    attendanceDb,
    coreDb,
    "main",
    requester(["attendance.records.update"])
  );
  assert.equal(
    response.status,
    200,
    JSON.stringify(
      attendanceSqlite.prepare(
        "SELECT id, status, last_error FROM attendance_operations"
      ).all()
    )
  );

  let rows = attendanceSqlite
    .prepare("SELECT id, employee_uid, employee_doc_id, type, server_time FROM attendance_records ORDER BY id")
    .all()
    .map((row) => ({ ...row }));
  assert.equal(rows.find((row) => row.id === "in-1").server_time, "2026-08-16T12:18:00.000Z");
  assert.equal(rows.find((row) => row.id === "out-1").server_time, "2026-08-16T20:02:49.730Z");
  assert.equal(rows.find((row) => row.id === "in-1").employee_uid, CANONICAL_UID);
  assert.equal(rows.find((row) => row.id === "in-1").employee_doc_id, CORE_ID);

  response = await adjustAttendanceRecords(
    adjustmentRequest({
      employeeUid: CANONICAL_UID,
      employeeDocId: CORE_ID,
      date: "2026-08-16",
      checkOutTime: "23:03",
    }),
    attendanceDb,
    coreDb,
    "main",
    requester(["attendance.records.update"])
  );
  assert.equal(
    response.status,
    200,
    JSON.stringify(
      attendanceSqlite.prepare(
        "SELECT id, status, last_error FROM attendance_operations"
      ).all()
    )
  );

  rows = attendanceSqlite
    .prepare("SELECT id, type, server_time FROM attendance_records ORDER BY id")
    .all()
    .map((row) => ({ ...row }));
  assert.equal(rows.find((row) => row.id === "in-1").server_time, "2026-08-16T12:18:00.000Z");
  assert.equal(rows.find((row) => row.id === "out-1").server_time, "2026-08-16T20:03:00.000Z");
});

test("adding a missing checkout to an existing day requires update, not create", async () => {
  const { attendanceSqlite, attendanceDb, coreDb } = createFixture();
  insertRecord(attendanceSqlite, {
    id: "in-only",
    type: "check_in",
    serverTime: "2026-08-17T06:00:00.000Z",
  });

  const response = await adjustAttendanceRecords(
    adjustmentRequest({
      employeeUid: CANONICAL_UID,
      employeeDocId: CORE_ID,
      date: "2026-08-17",
      checkOutTime: "18:00",
    }),
    attendanceDb,
    coreDb,
    "main",
    requester(["attendance.records.update"])
  );
  const payload = await json(response);

  assert.equal(
    response.status,
    200,
    JSON.stringify(
      attendanceSqlite.prepare(
        "SELECT id, status, last_error FROM attendance_operations"
      ).all()
    )
  );
  assert.equal(payload.records[0].action, "created");
  assert.equal(
    attendanceSqlite
      .prepare("SELECT COUNT(*) AS count FROM attendance_records WHERE type='check_out'")
      .get().count,
    1
  );
});

test("manual attendance day creation uses create permission and Riyadh clock conversion", async () => {
  const { attendanceSqlite, attendanceDb, coreDb } = createFixture();
  const response = await adjustAttendanceRecords(
    adjustmentRequest({
      employeeUid: CORE_ID,
      employeeDocId: CORE_ID,
      date: "2026-08-18",
      checkInTime: "08:00",
      checkOutTime: "12:30",
    }),
    attendanceDb,
    coreDb,
    "main",
    requester(["attendance.records.create"])
  );

  assert.equal(
    response.status,
    200,
    JSON.stringify(
      attendanceSqlite.prepare(
        "SELECT id, status, last_error FROM attendance_operations"
      ).all()
    )
  );
  const rows = attendanceSqlite
    .prepare("SELECT type, server_time FROM attendance_records ORDER BY server_time")
    .all()
    .map((row) => ({ ...row }));
  assert.deepEqual(rows, [
    { type: "check_in", server_time: "2026-08-18T05:00:00.000Z" },
    { type: "check_out", server_time: "2026-08-18T09:30:00.000Z" },
  ]);
});

test("selective clear checkout preserves check-in and rebuilds state", async () => {
  const { attendanceSqlite, attendanceDb, coreDb } = createFixture();
  insertRecord(attendanceSqlite, {
    id: "clear-out-in",
    type: "check_in",
    serverTime: "2026-08-19T06:00:00.000Z",
  });
  insertRecord(attendanceSqlite, {
    id: "clear-out-out",
    type: "check_out",
    serverTime: "2026-08-19T15:00:00.000Z",
  });
  setState(attendanceSqlite, {
    recordId: "clear-out-out",
    type: "check_out",
    serverTime: "2026-08-19T15:00:00.000Z",
  });

  const response = await adjustAttendanceRecords(
    adjustmentRequest({
      employeeUid: CORE_ID,
      employeeDocId: CORE_ID,
      date: "2026-08-19",
      clearCheckOut: true,
    }),
    attendanceDb,
    coreDb,
    "main",
    requester(["attendance.records.delete"])
  );
  const payload = await json(response);

  assert.equal(
    response.status,
    200,
    JSON.stringify(
      attendanceSqlite.prepare(
        "SELECT id, status, last_error FROM attendance_operations"
      ).all()
    )
  );
  assert.equal(payload.clearedRecords, 1);
  assert.equal(attendanceSqlite.prepare("SELECT COUNT(*) AS count FROM attendance_records WHERE type='check_in'").get().count, 1);
  assert.equal(attendanceSqlite.prepare("SELECT COUNT(*) AS count FROM attendance_records WHERE type='check_out'").get().count, 0);
  const state = rowObject(attendanceSqlite.prepare("SELECT status, last_type, last_record_id FROM attendance_state WHERE employee_uid=?").get(CANONICAL_UID));
  assert.deepEqual(state, {
    status: "checked_in",
    last_type: "check_in",
    last_record_id: "clear-out-in",
  });
});

test("selective clear check-in preserves checkout", async () => {
  const { attendanceSqlite, attendanceDb, coreDb } = createFixture();
  insertRecord(attendanceSqlite, {
    id: "clear-in-in",
    type: "check_in",
    serverTime: "2026-08-20T06:00:00.000Z",
  });
  insertRecord(attendanceSqlite, {
    id: "clear-in-out",
    type: "check_out",
    serverTime: "2026-08-20T15:00:00.000Z",
  });
  setState(attendanceSqlite, {
    recordId: "clear-in-out",
    type: "check_out",
    serverTime: "2026-08-20T15:00:00.000Z",
  });

  const response = await adjustAttendanceRecords(
    adjustmentRequest({
      employeeUid: CANONICAL_UID,
      employeeDocId: CORE_ID,
      date: "2026-08-20",
      clearCheckIn: true,
    }),
    attendanceDb,
    coreDb,
    "main",
    requester(["attendance.records.delete"])
  );

  assert.equal(
    response.status,
    200,
    JSON.stringify(
      attendanceSqlite.prepare(
        "SELECT id, status, last_error FROM attendance_operations"
      ).all()
    )
  );
  assert.equal(attendanceSqlite.prepare("SELECT COUNT(*) AS count FROM attendance_records WHERE type='check_in'").get().count, 0);
  assert.equal(attendanceSqlite.prepare("SELECT COUNT(*) AS count FROM attendance_records WHERE type='check_out'").get().count, 1);
  const state = rowObject(attendanceSqlite.prepare("SELECT status, last_type, last_record_id FROM attendance_state WHERE employee_uid=?").get(CANONICAL_UID));
  assert.deepEqual(state, {
    status: "checked_out",
    last_type: "check_out",
    last_record_id: "clear-in-out",
  });
});

test("authorized explicit full-day clear removes the day and derived state", async () => {
  const { attendanceSqlite, attendanceDb, coreDb } = createFixture();
  insertRecord(attendanceSqlite, {
    id: "full-in",
    type: "check_in",
    serverTime: "2026-08-21T06:00:00.000Z",
  });
  insertRecord(attendanceSqlite, {
    id: "full-out",
    type: "check_out",
    serverTime: "2026-08-21T15:00:00.000Z",
  });
  setState(attendanceSqlite, {
    recordId: "full-out",
    type: "check_out",
    serverTime: "2026-08-21T15:00:00.000Z",
  });

  const response = await adjustAttendanceRecords(
    adjustmentRequest({
      employeeUid: CORE_ID,
      employeeDocId: CORE_ID,
      date: "2026-08-21",
      action: "clear",
      clear: true,
    }),
    attendanceDb,
    coreDb,
    "main",
    requester(["attendance.records.delete"])
  );
  const payload = await json(response);

  assert.equal(
    response.status,
    200,
    JSON.stringify(
      attendanceSqlite.prepare(
        "SELECT id, status, last_error FROM attendance_operations"
      ).all()
    )
  );
  assert.equal(payload.clearedRecords, 2);
  assert.equal(attendanceSqlite.prepare("SELECT COUNT(*) AS count FROM attendance_records").get().count, 0);
  assert.equal(attendanceSqlite.prepare("SELECT COUNT(*) AS count FROM attendance_state").get().count, 0);
});

test("unauthorized create, update, and delete are rejected independently", async () => {
  {
    const { attendanceDb, coreDb } = createFixture();
    const response = await adjustAttendanceRecords(
      adjustmentRequest({
        employeeUid: CORE_ID,
        employeeDocId: CORE_ID,
        date: "2026-08-22",
        checkInTime: "08:00",
      }),
      attendanceDb,
      coreDb,
      "main",
      requester([])
    );
    assert.equal(response.status, 403);
    assert.equal((await json(response)).requiredPermission, "attendance.records.create");
  }

  {
    const { attendanceSqlite, attendanceDb, coreDb } = createFixture();
    insertRecord(attendanceSqlite, {
      id: "unauthorized-update",
      type: "check_in",
      serverTime: "2026-08-22T05:00:00.000Z",
    });
    const response = await adjustAttendanceRecords(
      adjustmentRequest({
        employeeUid: CORE_ID,
        employeeDocId: CORE_ID,
        date: "2026-08-22",
        checkInTime: "08:05",
      }),
      attendanceDb,
      coreDb,
      "main",
      requester([])
    );
    assert.equal(response.status, 403);
    assert.equal((await json(response)).requiredPermission, "attendance.records.update");
  }

  {
    const { attendanceSqlite, attendanceDb, coreDb } = createFixture();
    insertRecord(attendanceSqlite, {
      id: "unauthorized-delete",
      type: "check_in",
      serverTime: "2026-08-22T05:00:00.000Z",
    });
    const response = await adjustAttendanceRecords(
      adjustmentRequest({
        employeeUid: CORE_ID,
        employeeDocId: CORE_ID,
        date: "2026-08-22",
        clearCheckIn: true,
      }),
      attendanceDb,
      coreDb,
      "main",
      requester([])
    );
    assert.equal(response.status, 403);
    assert.equal((await json(response)).requiredPermission, "attendance.records.delete");
  }
});

test("targeted clear never falls back to deleting the whole requested day", async () => {
  const { attendanceSqlite, attendanceDb, coreDb } = createFixture();
  insertRecord(attendanceSqlite, {
    id: "target-day",
    type: "check_in",
    serverTime: "2026-08-23T05:00:00.000Z",
  });
  insertRecord(attendanceSqlite, {
    id: "other-day",
    type: "check_in",
    serverTime: "2026-08-24T05:00:00.000Z",
  });

  const response = await clearAttendanceRecordsForDay({
    db: attendanceDb,
    requester: requester(["attendance.records.delete"]),
    employeeUid: CANONICAL_UID,
    date: "2026-08-23",
    recordIds: ["other-day"],
    serverTimes: [],
    note: "scope regression",
    directoryDb: coreDb,
    employeeDocId: CORE_ID,
  });
  const payload = await json(response);

  assert.equal(
    response.status,
    200,
    JSON.stringify(
      attendanceSqlite.prepare(
        "SELECT id, status, last_error FROM attendance_operations"
      ).all()
    )
  );
  assert.equal(payload.clearedRecords, 0);
  assert.equal(attendanceSqlite.prepare("SELECT COUNT(*) AS count FROM attendance_records").get().count, 2);
});

test("Riyadh datetime conversion is stable at 08:00, 12:30, and 23:30", () => {
  assert.equal(
    parseRiyadhDateTime("2026-08-21", "08:00"),
    "2026-08-21T05:00:00.000Z"
  );
  assert.equal(
    parseRiyadhDateTime("2026-08-21", "12:30"),
    "2026-08-21T09:30:00.000Z"
  );
  assert.equal(
    parseRiyadhDateTime("2026-08-21", "23:30"),
    "2026-08-21T20:30:00.000Z"
  );
});
