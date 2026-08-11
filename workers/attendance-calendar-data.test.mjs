import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAttendanceSpecialDayMap,
  buildApprovedLeaveSpecialDays,
  buildApprovedLeaveDateKeys,
} from "../src/helpers/hr/attendanceCalendarData.ts";
import { getAttendanceDayStatus } from "../src/helpers/hr/attendanceCalculations.ts";

const profile = { id: "1001", uid: "1001", employeeUid: "1001" };
const dateKey = "2026-08-04";
const baseEntry = {
  fromDate: dateKey,
  toDate: dateKey,
  id: "entry-1",
};

const scheduleProfile = {
  ...profile,
  useCustomWorkingHours: true,
  customWorkingHours: {
    sun: { enabled: true, start: "15:00", end: "23:00" },
    mon: { enabled: true, start: "15:00", end: "23:00" },
    tue: { enabled: false, start: "15:00", end: "23:00" },
    wed: { enabled: true, start: "15:00", end: "23:00" },
    thu: { enabled: true, start: "15:00", end: "23:00" },
    fri: { enabled: true, start: "15:00", end: "23:00" },
    sat: { enabled: true, start: "15:00", end: "23:00" },
  },
};

test("approved balance adjustment entry with deduct is excluded", () => {
  const days = buildApprovedLeaveSpecialDays({
    profile,
    leaveEntries: [{
      ...baseEntry,
      actionType: "deduct",
      status: "approved",
    }],
  });

  assert.equal(days.length, 0);
});

test("approved balance adjustment entry with add is excluded", () => {
  const days = buildApprovedLeaveSpecialDays({
    profile,
    leaveEntries: [{
      ...baseEntry,
      actionType: "add",
      status: "approved",
    }],
  });

  assert.equal(days.length, 0);
});

test("approved leave entry appears as leave", () => {
  const keys = buildApprovedLeaveDateKeys({
    profile,
    leaveEntries: [{
      ...baseEntry,
      type: "annual",
      status: "approved",
    }],
  });

  assert.deepEqual(keys, [dateKey]);
});

test("approved rest entry appears as rest kind", () => {
  const days = buildApprovedLeaveSpecialDays({
    profile,
    leaveEntries: [{
      ...baseEntry,
      type: "rest",
      status: "approved",
    }],
  });

  assert.equal(days.length, 1);
  assert.equal(days[0].kind, "rest");
});

test("deleted leave entry is excluded", () => {
  const days = buildApprovedLeaveSpecialDays({
    profile,
    leaveEntries: [{
      ...baseEntry,
      type: "annual",
      status: "approved",
      deleted: true,
    }],
  });

  assert.equal(days.length, 0);
});

test("leave entry without status is not approved by default", () => {
  const days = buildApprovedLeaveSpecialDays({
    profile,
    leaveEntries: [{
      ...baseEntry,
      type: "annual",
    }],
  });

  assert.equal(days.length, 0);
});

test("approved leave request appears", () => {
  const keys = buildApprovedLeaveDateKeys({
    profile,
    leaveRequests: [{
      id: "req-1",
      employeeUid: profile.uid,
      employeeId: profile.id,
      type: "annual",
      fromDate: dateKey,
      toDate: dateKey,
      days: 1,
      status: "approved",
    }],
  });

  assert.deepEqual(keys, [dateKey]);
});

test("pending leave request does not appear", () => {
  const keys = buildApprovedLeaveDateKeys({
    profile,
    leaveRequests: [{
      id: "req-2",
      employeeUid: profile.uid,
      employeeId: profile.id,
      type: "annual",
      fromDate: dateKey,
      toDate: dateKey,
      days: 1,
      status: "pending",
    }],
  });

  assert.deepEqual(keys, []);
});

test("rejected leave request does not appear", () => {
  const keys = buildApprovedLeaveDateKeys({
    profile,
    leaveRequests: [{
      id: "req-3",
      employeeUid: profile.uid,
      employeeId: profile.id,
      type: "annual",
      fromDate: dateKey,
      toDate: dateKey,
      days: 1,
      status: "rejected",
    }],
  });

  assert.deepEqual(keys, []);
});

test("cancelled leave request does not appear", () => {
  const keys = buildApprovedLeaveDateKeys({
    profile,
    leaveRequests: [{
      id: "req-4",
      employeeUid: profile.uid,
      employeeId: profile.id,
      type: "annual",
      fromDate: dateKey,
      toDate: dateKey,
      days: 1,
      status: "cancelled",
    }],
  });

  assert.deepEqual(keys, []);
});

test("weekly off from the employee schedule is not treated as absence", () => {
  const offDate = "2026-08-11";
  const days = buildAttendanceSpecialDayMap({
    profile: scheduleProfile,
    fromDate: offDate,
    toDate: offDate,
  });

  assert.equal(days.get(offDate)?.kind, "weekly_off");
  assert.equal(
    getAttendanceDayStatus({
      date: offDate,
      hasAttendance: false,
      todayDateKey: "2026-08-20",
      weeklyOffDays: ["tuesday"],
    }),
    "off_day"
  );
});

test("approved leave wins over weekly-off classification and is not absence", () => {
  const offDate = "2026-08-11";
  const leaveRequest = {
    id: "req-weekly-off",
    employeeUid: profile.uid,
    employeeId: profile.id,
    type: "annual",
    fromDate: offDate,
    toDate: offDate,
    days: 1,
    status: "approved",
  };
  const days = buildAttendanceSpecialDayMap({
    profile: scheduleProfile,
    leaveRequests: [leaveRequest],
    fromDate: offDate,
    toDate: offDate,
  });

  assert.equal(days.get(offDate)?.kind, "leave");
  assert.equal(
    getAttendanceDayStatus({
      date: offDate,
      hasAttendance: false,
      todayDateKey: "2026-08-20",
      weeklyOffDays: ["tuesday"],
      approvedLeaveDateKeys: [offDate],
    }),
    "leave"
  );
});

test("an explicit working override reopens a weekly-off date", () => {
  const offDate = "2026-08-11";
  const days = buildAttendanceSpecialDayMap({
    profile: {
      ...scheduleProfile,
      customWorkingHourOverrides: [{
        date: offDate,
        enabled: true,
        start: "15:00",
        end: "23:00",
      }],
    },
    fromDate: offDate,
    toDate: offDate,
  });

  assert.equal(days.has(offDate), false);
});

test("generic Core off does not overwrite an existing weekly-off label", () => {
  const offDate = "2026-08-11";
  const days = buildAttendanceSpecialDayMap({
    profile: scheduleProfile,
    fromDate: offDate,
    toDate: offDate,
    coreResolvedShifts: {
      [offDate]: {
        source: "exception",
        exceptionType: "off",
      },
    },
  });

  assert.equal(days.get(offDate)?.kind, "weekly_off");
  assert.equal(days.get(offDate)?.source, "weekly_schedule");
});
