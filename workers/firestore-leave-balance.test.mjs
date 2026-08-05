import assert from "node:assert/strict";
import { test } from "node:test";
import {
  normalizeLeaveEntryType,
  getLeaveEntryActionType,
  getLeaveEntryChangeAmount,
} from "../src/services/firestoreLeaveBalance.helpers.ts";
import {
  applyBalanceAdjustmentForRequest,
  restoreBalanceForRequest,
} from "../src/services/employeeHub.helpers.ts";

test("applyBalanceAdjustmentForRequest applies once and is idempotent", async () => {
  let calls = 0;
  const mockApply = async (args) => {
    calls += 1;
    return { createdEntry: { id: `entry-${calls}`, changeAmount: args.actionType === "add" ? args.days : -args.days } };
  };

  const req = { id: "req-1", employeeId: "staff-1", days: 2, type: "annual", balanceAdjusted: false };
  const actor = { uid: "admin-1", role: "admin", displayName: "Admin" };

  const r1 = await applyBalanceAdjustmentForRequest(req, actor, mockApply, req.id);
  assert.equal(calls, 1);
  assert(r1 && r1.createdEntry && r1.createdEntry.id === "entry-1");

  // second call should be idempotent (no new apply)
  req.balanceAdjusted = true;
  const r2 = await applyBalanceAdjustmentForRequest(req, actor, mockApply, req.id);
  assert.equal(calls, 1);
  assert.equal(r2, null);
});

test("restoreBalanceForRequest creates reversal once and is idempotent", async () => {
  let calls = 0;
  const mockApply = async (args) => {
    calls += 1;
    return { createdEntry: { id: `rev-${calls}`, changeAmount: args.actionType === "add" ? args.days : -args.days } };
  };

  const req = { id: "req-2", employeeId: "staff-1", days: 3, type: "annual", balanceAdjusted: true, balanceAdjustmentEntryId: "entry-1", balanceAdjustmentChangeAmount: -3 };
  const actor = { uid: "admin-1", role: "admin", displayName: "Admin" };

  const r1 = await restoreBalanceForRequest(req, actor, mockApply, req.id);
  assert.equal(calls, 1);
  assert(r1 && r1.createdEntry && r1.createdEntry.id === "rev-1");

  // second call should not call again
  req.balanceRestored = true;
  const r2 = await restoreBalanceForRequest(req, actor, mockApply, req.id);
  assert.equal(calls, 1);
  assert.equal(r2, null);
});

test("normalizeLeaveEntryType recognizes add and deduct tokens", () => {
  const add = normalizeLeaveEntryType("اضافة");
  const deduct = normalizeLeaveEntryType("خصم");
  assert.equal(add, "add");
  assert.equal(deduct, "deduct");
});

test("getLeaveEntryActionType reads actionType or type", () => {
  assert.equal(getLeaveEntryActionType({ actionType: "add" }), "add");
  assert.equal(getLeaveEntryActionType({ type: "deduct" }), "deduct");
});

test("getLeaveEntryChangeAmount prefers explicit changeAmount then infers from days and action", () => {
  assert.equal(getLeaveEntryChangeAmount({ changeAmount: 3 }), 3);
  assert.equal(getLeaveEntryChangeAmount({ days: 2, actionType: "add" }), 2);
  assert.equal(getLeaveEntryChangeAmount({ days: 2, actionType: "deduct" }), -2);
  assert.equal(getLeaveEntryChangeAmount({}), 0);
});

test("manual adjustment tokens are recognized as add/deduct", () => {
  assert.equal(normalizeLeaveEntryType("اضافة"), "add");
  assert.equal(normalizeLeaveEntryType("خصم"), "deduct");
});
