import assert from "node:assert/strict";
import test from "node:test";
import { pathToFileURL } from "node:url";

const helperPath = process.env.PERMISSION_HELPER_JS;
if (!helperPath) throw new Error("PERMISSION_HELPER_JS is required");
const {
  calculatePermissionCoverage,
  permissionIntervalsFromAttendanceRecords,
  permissionIntervalsFromRequests,
} = await import(pathToFileURL(helperPath).href);

test("permission covers only the scheduled missing segment", () => {
  const coverage = calculatePermissionCoverage({
    date: "2026-07-30",
    scheduledStart: "14:00",
    scheduledEnd: "22:00",
    checkInAt: "2026-07-30T11:59:00.000Z",
    checkOutAt: "2026-07-30T18:05:00.000Z",
    rawMissingMinutes: 115,
    intervals: [{ startTime: "21:00", endTime: "23:00" }],
  });
  assert.equal(coverage.requestedMinutes, 120);
  assert.equal(coverage.coveredMissingMinutes, 55);
  assert.equal(coverage.adjustedMissingMinutes, 60);
});

test("worked time inside permission is not counted twice", () => {
  const coverage = calculatePermissionCoverage({
    date: "2026-07-30",
    scheduledStart: "14:00",
    scheduledEnd: "22:00",
    checkInAt: "2026-07-30T11:00:00.000Z",
    checkOutAt: "2026-07-30T19:00:00.000Z",
    rawMissingMinutes: 0,
    intervals: [{ startTime: "21:00", endTime: "22:00" }],
  });
  assert.equal(coverage.coveredMissingMinutes, 0);
  assert.equal(coverage.adjustedMissingMinutes, 0);
});

test("overnight permission is supported", () => {
  const coverage = calculatePermissionCoverage({
    date: "2026-07-30",
    scheduledStart: "20:00",
    scheduledEnd: "04:00",
    checkInAt: "2026-07-30T17:00:00.000Z",
    checkOutAt: "2026-07-30T22:00:00.000Z",
    rawMissingMinutes: 180,
    intervals: [{ startTime: "01:00", endTime: "04:00" }],
  });
  assert.equal(coverage.requestedMinutes, 180);
  assert.equal(coverage.coveredMissingMinutes, 180);
  assert.equal(coverage.adjustedMissingMinutes, 0);
});

test("only returned requests are used", () => {
  const intervals = permissionIntervalsFromRequests([
    { id: "a", date: "2026-07-30", status: "pending", startTime: "20:00", expectedReturnTime: "21:00" },
    { id: "b", date: "2026-07-30", status: "returned", startTime: "21:00", actualReturnTime: "22:00" },
  ], "2026-07-30");
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].id, "b");
});


test("zero-duration permission records are ignored", () => {
  const intervals = permissionIntervalsFromAttendanceRecords([
    {
      recordType: "permission_out",
      recordedAt: "2026-07-30T00:17:00.000Z",
      idempotencyKey: "permission:permission_old:permission_out",
    },
    {
      recordType: "permission_return",
      recordedAt: "2026-07-30T00:17:00.000Z",
      idempotencyKey: "permission:permission_old:permission_return",
    },
  ], "2026-07-30");
  assert.equal(intervals.length, 1);
  const coverage = calculatePermissionCoverage({
    date: "2026-07-30",
    scheduledStart: "15:00",
    scheduledEnd: "23:00",
    checkInAt: "2026-07-30T11:59:00.000Z",
    checkOutAt: "2026-07-30T18:05:00.000Z",
    rawMissingMinutes: 115,
    intervals,
  });
  assert.equal(coverage.requestedMinutes, 0);
  assert.equal(coverage.coveredMissingMinutes, 0);
});

test("valid permission remains effective beside an old zero-duration record", () => {
  const intervals = permissionIntervalsFromAttendanceRecords([
    {
      recordType: "permission_out",
      recordedAt: "2026-07-30T00:17:00.000Z",
      idempotencyKey: "permission:permission_old:permission_out",
    },
    {
      recordType: "permission_return",
      recordedAt: "2026-07-30T00:17:00.000Z",
      idempotencyKey: "permission:permission_old:permission_return",
    },
    {
      recordType: "permission_out",
      recordedAt: "2026-07-30T18:00:00.000Z",
      idempotencyKey: "permission:permission_valid:permission_out",
    },
    {
      recordType: "permission_return",
      recordedAt: "2026-07-30T20:00:00.000Z",
      idempotencyKey: "permission:permission_valid:permission_return",
    },
  ], "2026-07-30");
  const coverage = calculatePermissionCoverage({
    date: "2026-07-30",
    scheduledStart: "15:00",
    scheduledEnd: "23:00",
    checkInAt: "2026-07-30T11:59:00.000Z",
    checkOutAt: "2026-07-30T18:05:00.000Z",
    rawMissingMinutes: 115,
    intervals,
  });
  assert.equal(coverage.requestedMinutes, 120);
  assert.equal(coverage.coveredMissingMinutes, 115);
  assert.equal(coverage.adjustedMissingMinutes, 0);
});
