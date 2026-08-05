import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildApprovedLeaveSpecialDays,
  buildApprovedLeaveDateKeys,
} from "../src/helpers/hr/attendanceCalendarData.ts";

const profile = { id: "1001", uid: "1001", employeeUid: "1001" };
const dateKey = "2026-08-04";
const baseEntry = {
  fromDate: dateKey,
  toDate: dateKey,
  id: "entry-1",
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
