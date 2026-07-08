import { describe, expect, it } from "vitest";

// @ts-expect-error The production Worker is plain JavaScript by design.
import * as attendanceWorker from "../workers/attendance-worker.js";

const {
  calculateDistanceMeters,
  clearAttendanceRecordsForDay,
  evaluateAttendanceZones,
  evaluateDeviceChange,
  evaluateLocationDecision,
  evaluateStateTransition,
  generateAttendanceMonthlySummary,
  isDeviceFirstSeenToday,
  parseAttendanceRecordsQuery,
  parseRiyadhDateBoundary,
} = attendanceWorker;

function createAttendanceClearFakeDb() {
  const records = new Map<string, Record<string, any>>();
  const state = new Map<string, Record<string, any>>();

  const db = {
    records,
    state,
    prepare(sql: string) {
      const normalizedSql = sql.replace(/\s+/g, " ").trim().toUpperCase();
      return {
        bind(...bindings: any[]) {
          return {
            async all() {
              if (
                normalizedSql.includes("SELECT ID FROM ATTENDANCE_RECORDS") &&
                normalizedSql.includes("SERVER_TIME IN")
              ) {
                const [employeeUid, ...serverTimes] = bindings;
                const timeSet = new Set(serverTimes);
                return {
                  results: Array.from(records.values())
                    .filter(
                      record =>
                        record.employee_uid === employeeUid &&
                        timeSet.has(record.server_time)
                    )
                    .map(record => ({ id: record.id })),
                };
              }

              if (
                normalizedSql.includes("SELECT ID FROM ATTENDANCE_RECORDS") &&
                normalizedSql.includes("SERVER_TIME >=")
              ) {
                const [employeeUid, dayStart, dayEnd] = bindings;
                return {
                  results: Array.from(records.values())
                    .filter(
                      record =>
                        record.employee_uid === employeeUid &&
                        record.server_time >= dayStart &&
                        record.server_time < dayEnd
                    )
                    .map(record => ({ id: record.id })),
                };
              }

              return { results: [] };
            },
            async run() {
              if (
                normalizedSql.startsWith("UPDATE ATTENDANCE_STATE") &&
                normalizedSql.includes("LAST_RECORD_ID = NULL")
              ) {
                const [updatedAt, employeeUid, ...recordIds] = bindings;
                const currentState = state.get(employeeUid);
                if (
                  currentState &&
                  recordIds.includes(currentState.last_record_id)
                ) {
                  currentState.last_record_id = null;
                  currentState.last_type = null;
                  currentState.last_server_time = null;
                  currentState.last_location_lat = null;
                  currentState.last_location_lng = null;
                  currentState.last_location_accuracy = null;
                  currentState.last_zone_id = null;
                  currentState.status = "checked_out";
                  currentState.updated_at = updatedAt;
                  return { meta: { changes: 1 } };
                }
                return { meta: { changes: 0 } };
              }

              if (
                normalizedSql.startsWith("DELETE FROM ATTENDANCE_RECORDS")
              ) {
                const [employeeUid, ...recordIds] = bindings;
                let changes = 0;
                for (const recordId of recordIds) {
                  for (const row of state.values()) {
                    if (row.last_record_id === recordId) {
                      throw new Error(
                        "D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT_FOREIGNKEY"
                      );
                    }
                  }
                  const record = records.get(recordId);
                  if (record?.employee_uid === employeeUid) {
                    records.delete(recordId);
                    changes += 1;
                  }
                }
                return { meta: { changes } };
              }

              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
  };

  return db;
}

function createAttendanceMonthlySummaryFakeDb() {
  const records: Array<Record<string, any>> = [];
  const summaries = new Map<string, Record<string, any>>();

  const db = {
    records,
    summaries,
    prepare(sql: string) {
      const normalizedSql = sql.replace(/\s+/g, " ").trim().toUpperCase();
      return {
        bind(...bindings: any[]) {
          return {
            async all() {
              if (
                normalizedSql.includes("FROM ATTENDANCE_RECORDS") &&
                normalizedSql.includes("ORDER BY SERVER_TIME ASC")
              ) {
                const [employeeUid, start, end] = bindings;
                return {
                  results: records
                    .filter(
                      record =>
                        record.employee_uid === employeeUid &&
                        record.server_time >= start &&
                        record.server_time < end
                    )
                    .sort((left, right) =>
                      `${left.server_time}:${left.id}`.localeCompare(
                        `${right.server_time}:${right.id}`
                      )
                    ),
                };
              }

              return { results: [] };
            },
            async run() {
              if (
                normalizedSql.startsWith(
                  "INSERT INTO ATTENDANCE_MONTHLY_SUMMARIES"
                )
              ) {
                const [
                  id,
                  employeeUid,
                  employeeDocId,
                  yearMonth,
                  presentDays,
                  checkInCount,
                  checkOutCount,
                  rejectedCount,
                  workedMinutes,
                  lateMinutes,
                  earlyLeaveMinutes,
                  overtimeMinutes,
                  shortageMinutes,
                  deviceIdsJson,
                  zoneIdsJson,
                  firstCheckIn,
                  lastCheckOut,
                  sourceRecordsCount,
                  generatedAt,
                  updatedAt,
                ] = bindings;
                summaries.set(`${employeeUid}:${yearMonth}`, {
                  id,
                  employee_uid: employeeUid,
                  employee_doc_id: employeeDocId,
                  year_month: yearMonth,
                  present_days: presentDays,
                  check_in_count: checkInCount,
                  check_out_count: checkOutCount,
                  rejected_count: rejectedCount,
                  worked_minutes: workedMinutes,
                  late_minutes: lateMinutes,
                  early_leave_minutes: earlyLeaveMinutes,
                  overtime_minutes: overtimeMinutes,
                  shortage_minutes: shortageMinutes,
                  device_ids_json: deviceIdsJson,
                  zone_ids_json: zoneIdsJson,
                  first_check_in: firstCheckIn,
                  last_check_out: lastCheckOut,
                  source_records_count: sourceRecordsCount,
                  generated_at: generatedAt,
                  updated_at: updatedAt,
                });
                return { meta: { changes: 1 } };
              }

              return { meta: { changes: 0 } };
            },
          };
        },
      };
    },
  };

  return db;
}

const center = { lat: 24.7136, lng: 46.6753 };
const zone = {
  id: "riyadh-office",
  name: "Riyadh office",
  type: "radius",
  center,
  radiusMeters: 100,
  active: true,
};

describe("attendance location validation", () => {
  it("accepts an accurate location inside the assigned zone", () => {
    const location = { ...center, accuracy: 15 };
    const zoneCheck = evaluateAttendanceZones(location, [zone]);
    expect(
      evaluateLocationDecision({ location, zoneError: "", zoneCheck })
    ).toEqual({
      result: "allowed",
      rejectionReason: null,
    });
  });

  it("rejects a location outside the assigned zone", () => {
    const location = { lat: 24.72, lng: 46.69, accuracy: 15 };
    const zoneCheck = evaluateAttendanceZones(location, [zone]);
    expect(zoneCheck.withinZone).toBe(false);
    expect(
      evaluateLocationDecision({ location, zoneError: "", zoneCheck })
        .rejectionReason
    ).toBe("outside_zone");
  });

  it("prioritizes outside zone over weak accuracy when the employee is clearly far away", () => {
    const location = { lat: 24.809, lng: 46.6753, accuracy: 109 };
    const zoneCheck = evaluateAttendanceZones(location, [zone]);
    expect(zoneCheck.withinZone).toBe(false);
    expect(zoneCheck.distanceMeters).toBeGreaterThan(10_000);
    expect(
      evaluateLocationDecision({ location, zoneError: "", zoneCheck })
        .rejectionReason
    ).toBe("outside_zone");
  });

  it("accepts moderate GPS accuracy inside a standard assigned zone", () => {
    const location = { ...center, accuracy: 110 };
    const zoneCheck = evaluateAttendanceZones(location, [zone]);
    expect(
      evaluateLocationDecision({ location, zoneError: "", zoneCheck })
    ).toEqual({
      result: "allowed",
      rejectionReason: null,
    });
  });

  it("rejects very weak GPS accuracy inside a standard assigned zone", () => {
    const location = { ...center, accuracy: 151 };
    const zoneCheck = evaluateAttendanceZones(location, [zone]);
    expect(
      evaluateLocationDecision({ location, zoneError: "", zoneCheck })
        .rejectionReason
    ).toBe("poor_accuracy");
  });

  it("accepts moderate GPS accuracy inside a wider assigned zone", () => {
    const location = { ...center, accuracy: 131 };
    const zoneCheck = evaluateAttendanceZones(location, [
      { ...zone, radiusMeters: 200 },
    ]);
    expect(
      evaluateLocationDecision({ location, zoneError: "", zoneCheck })
    ).toEqual({
      result: "allowed",
      rejectionReason: null,
    });
  });

  it("uses a wider overlapping zone when a smaller nearby zone cannot accept GPS accuracy", () => {
    const location = { lat: center.lat, lng: center.lng, accuracy: 180 };
    const zoneCheck = evaluateAttendanceZones(location, [
      { ...zone, id: "small-office", radiusMeters: 50 },
      { ...zone, id: "wide-office", radiusMeters: 200 },
    ]);

    expect(zoneCheck.zone?.id).toBe("wide-office");
    expect(
      evaluateLocationDecision({ location, zoneError: "", zoneCheck })
    ).toEqual({
      result: "allowed",
      rejectionReason: null,
    });
  });

  it("rejects an employee without allowed zones", () => {
    const location = { ...center, accuracy: 10 };
    const zoneCheck = evaluateAttendanceZones(location, []);
    expect(zoneCheck.withinZone).toBe(false);
    expect(
      evaluateLocationDecision({
        location,
        zoneError: "zone_not_found",
        zoneCheck,
      }).rejectionReason
    ).toBe("zone_not_found");
  });

  it("calculates a zero distance for identical coordinates", () => {
    expect(calculateDistanceMeters(center, center)).toBe(0);
  });
});

describe("attendance state transitions", () => {
  it("allows check-in from checked-out state", () => {
    expect(evaluateStateTransition("check_in", "checked_out")).toMatchObject({
      result: "allowed",
      currentStatus: "checked_in",
    });
  });

  it("allows check-out from checked-in state", () => {
    expect(evaluateStateTransition("check_out", "checked_in")).toMatchObject({
      result: "allowed",
      currentStatus: "checked_out",
    });
  });

  it("rejects duplicate check-in", () => {
    expect(
      evaluateStateTransition("check_in", "checked_in").rejectionReason
    ).toBe("duplicate_check_in");
  });

  it("rejects check-out without check-in", () => {
    expect(evaluateStateTransition("check_out", null).rejectionReason).toBe(
      "not_checked_in"
    );
  });

  it("allows a new check-in when the previous open check-in is from another day", () => {
    expect(
      evaluateStateTransition("check_in", "checked_in", {
        lastServerTime: "2026-06-22T10:00:00.000Z",
        dayBounds: {
          start: parseRiyadhDateBoundary("2026-06-23", false),
          end: parseRiyadhDateBoundary("2026-06-23", true),
        },
      })
    ).toMatchObject({
      result: "allowed",
      currentStatus: "checked_in",
    });
  });

  it("rejects check-out when the only open check-in is from another day", () => {
    expect(
      evaluateStateTransition("check_out", "checked_in", {
        lastServerTime: "2026-06-22T10:00:00.000Z",
        dayBounds: {
          start: parseRiyadhDateBoundary("2026-06-23", false),
          end: parseRiyadhDateBoundary("2026-06-23", true),
        },
      }).rejectionReason
    ).toBe("not_checked_in");
  });
});

describe("attendance device tracking", () => {
  it("does not flag the same browser device", () => {
    expect(evaluateDeviceChange("device-a", "device-a")).toEqual({
      deviceChanged: false,
      previousDeviceId: null,
    });
  });

  it("flags a different browser device", () => {
    expect(evaluateDeviceChange("device-b", "device-a")).toEqual({
      deviceChanged: true,
      previousDeviceId: "device-a",
    });
  });

  it("does not flag the first known device", () => {
    expect(evaluateDeviceChange("device-a", null)).toEqual({
      deviceChanged: false,
      previousDeviceId: null,
    });
  });

  it("does not count an old device as new today", () => {
    const records = [
      {
        serverTime: "2026-06-24T09:00:00.000Z",
        deviceInfo: { deviceId: "device-old" },
      },
      {
        serverTime: "2026-06-25T09:00:00.000Z",
        deviceInfo: { deviceId: "device-old" },
      },
    ];

    expect(
      isDeviceFirstSeenToday({ deviceId: "device-old" }, records, "2026-06-25")
    ).toBe(false);
  });

  it("counts a device as new only when its first appearance is today", () => {
    const records = [
      {
        serverTime: "2026-06-25T09:00:00.000Z",
        deviceInfo: { deviceId: "device-new" },
      },
    ];

    expect(
      isDeviceFirstSeenToday({ deviceId: "device-new" }, records, "2026-06-25")
    ).toBe(true);
  });
});

describe("attendance clear action", () => {
  it("clears attendance_state last_record_id before deleting referenced records", async () => {
    const db = createAttendanceClearFakeDb();
    const employeeUid = "employee-1";
    const recordId = "attendance-record-1";

    db.records.set(recordId, {
      id: recordId,
      employee_uid: employeeUid,
      server_time: "2026-06-29T19:18:00.000Z",
    });
    db.state.set(employeeUid, {
      employee_uid: employeeUid,
      employee_doc_id: employeeUid,
      status: "checked_in",
      last_type: "check_in",
      last_record_id: recordId,
      last_server_time: "2026-06-29T19:18:00.000Z",
      last_location_lat: 24.4356,
      last_location_lng: 39.6757,
      last_location_accuracy: 25,
      last_zone_id: "home-zone",
      updated_at: "2026-06-29T19:18:00.000Z",
    });

    const response = await clearAttendanceRecordsForDay({
      db,
      requester: {
        uid: "hr-admin",
        email: "hr@example.com",
      },
      employeeUid,
      date: "2026-06-29",
      recordIds: [recordId],
      note: "test clear",
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      ok: true,
      action: "clear",
      clearedRecords: 1,
    });
    expect(db.records.has(recordId)).toBe(false);
    expect(db.state.get(employeeUid)).toMatchObject({
      status: "checked_out",
      last_record_id: null,
      last_type: null,
      last_server_time: null,
      last_location_lat: null,
      last_location_lng: null,
      last_location_accuracy: null,
      last_zone_id: null,
    });
  });
});

describe("attendance monthly summaries", () => {
  it("generates and upserts a monthly summary without deleting source records", async () => {
    const db = createAttendanceMonthlySummaryFakeDb();
    db.records.push(
      {
        id: "june-check-in-1",
        employee_uid: "employee-1",
        employee_doc_id: "employee-doc-1",
        type: "check_in",
        result: "allowed",
        server_time: "2026-06-01T05:00:00.000Z",
        device_info: JSON.stringify({ deviceId: "device-a" }),
        zone_id: "main-office",
      },
      {
        id: "june-check-out-1",
        employee_uid: "employee-1",
        employee_doc_id: "employee-doc-1",
        type: "check_out",
        result: "allowed",
        server_time: "2026-06-01T14:00:00.000Z",
        device_info: JSON.stringify({ deviceId: "device-a" }),
        zone_id: "main-office",
      },
      {
        id: "june-check-in-2",
        employee_uid: "employee-1",
        employee_doc_id: "employee-doc-1",
        type: "check_in",
        result: "allowed",
        server_time: "2026-06-02T05:10:00.000Z",
        device_info: JSON.stringify({ deviceId: "device-b" }),
        zone_id: "project-zone",
      },
      {
        id: "june-check-out-2",
        employee_uid: "employee-1",
        employee_doc_id: "employee-doc-1",
        type: "check_out",
        result: "allowed",
        server_time: "2026-06-02T14:10:00.000Z",
        device_info: JSON.stringify({ deviceId: "device-b" }),
        zone_id: "project-zone",
      },
      {
        id: "june-rejected",
        employee_uid: "employee-1",
        employee_doc_id: "employee-doc-1",
        type: "check_in",
        result: "rejected",
        server_time: "2026-06-03T05:00:00.000Z",
        device_info: JSON.stringify({ deviceId: "device-rejected" }),
        zone_id: "main-office",
      },
      {
        id: "july-check-in",
        employee_uid: "employee-1",
        employee_doc_id: "employee-doc-1",
        type: "check_in",
        result: "allowed",
        server_time: "2026-07-01T05:00:00.000Z",
        device_info: JSON.stringify({ deviceId: "device-july" }),
        zone_id: "main-office",
      }
    );
    const sourceCount = db.records.length;

    const summary = await generateAttendanceMonthlySummary(
      db,
      "employee-1",
      "2026-06"
    );
    const repeatedSummary = await generateAttendanceMonthlySummary(
      db,
      "employee-1",
      "2026-06"
    );

    expect(summary).toMatchObject({
      employeeUid: "employee-1",
      employeeDocId: "employee-doc-1",
      yearMonth: "2026-06",
      presentDays: 2,
      checkInCount: 2,
      checkOutCount: 2,
      rejectedCount: 1,
      workedMinutes: 0,
      lateMinutes: 0,
      earlyLeaveMinutes: 0,
      overtimeMinutes: 0,
      shortageMinutes: 0,
      firstCheckIn: "2026-06-01T05:00:00.000Z",
      lastCheckOut: "2026-06-02T14:10:00.000Z",
      sourceRecordsCount: 5,
    });
    expect(summary.deviceIds).toEqual([
      "device-a",
      "device-b",
      "device-rejected",
    ]);
    expect(summary.zoneIds).toEqual(["main-office", "project-zone"]);
    expect(repeatedSummary.id).toBe(summary.id);
    expect(db.summaries.size).toBe(1);
    expect(db.records).toHaveLength(sourceCount);
  });
});

describe("attendance records query", () => {
  it("parses supported filters and clamps the limit", () => {
    const params = new URLSearchParams({
      employeeUid: "employee-1",
      fromDate: "2026-06-22",
      toDate: "2026-06-23",
      result: "allowed",
      type: "check_in",
      deviceChanged: "true",
      limit: "999",
      page: "2",
    });
    const parsed = parseAttendanceRecordsQuery(params);
    expect(parsed.ok).toBe(true);
    expect(parsed.value).toMatchObject({ limit: 200, page: 2, offset: 200 });
    expect(parsed.value.bindings).toContain("employee-1");
  });

  it("rejects unsupported result values", () => {
    const parsed = parseAttendanceRecordsQuery(
      new URLSearchParams({ result: "pending" })
    );
    expect(parsed.ok).toBe(false);
    expect(parsed.response.status).toBe(400);
  });

  it("converts a Riyadh day boundary to UTC", () => {
    expect(parseRiyadhDateBoundary("2026-06-22", false)).toBe(
      "2026-06-21T21:00:00.000Z"
    );
    expect(parseRiyadhDateBoundary("2026-06-22", true)).toBe(
      "2026-06-22T21:00:00.000Z"
    );
  });
});
