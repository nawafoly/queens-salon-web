import assert from "node:assert/strict";
import { test } from "node:test";

import {
  normalizeLeaveEntryType,
  getLeaveEntryActionType,
  getLeaveEntryChangeAmount,
  getLeaveEntryBalanceBefore,
  getLeaveEntryBalanceAfter,
  getLeaveEntryCreatedAt,
  isDeletedLeaveEntry,
} from "../src/helpers/hr/leaveBalanceEntry.ts";

test(
  "leave balance entry helpers normalize add and deduct tokens",
  () => {
    assert.equal(
      normalizeLeaveEntryType("اضافة"),
      "add"
    );

    assert.equal(
      normalizeLeaveEntryType("خصم"),
      "deduct"
    );

    assert.equal(
      normalizeLeaveEntryType("debit"),
      "deduct"
    );
  }
);

test(
  "leave balance entry helpers preserve half-day canonical values",
  () => {
    assert.equal(
      getLeaveEntryChangeAmount({
        changeAmount: 0.5,
      }),
      0.5
    );

    assert.equal(
      getLeaveEntryChangeAmount({
        changeAmount: -0.5,
      }),
      -0.5
    );

    assert.equal(
      getLeaveEntryChangeAmount({
        days: 1.5,
        actionType: "deduct",
      }),
      -1.5
    );

    assert.equal(
      getLeaveEntryChangeAmount({
        days: 2.5,
        actionType: "add",
      }),
      2.5
    );
  }
);

test(
  "leave balance entry helpers read canonical ledger snapshots",
  () => {
    const entry = {
      action_type: "deduct",
      balance_before: 10.5,
      balance_after: 9,
      created_at:
        "2026-08-14T01:00:00.000Z",
    };

    assert.equal(
      getLeaveEntryActionType(entry),
      "deduct"
    );

    assert.equal(
      getLeaveEntryBalanceBefore(entry),
      10.5
    );

    assert.equal(
      getLeaveEntryBalanceAfter(entry),
      9
    );

    assert.equal(
      getLeaveEntryCreatedAt(entry),
      "2026-08-14T01:00:00.000Z"
    );
  }
);

test(
  "leave balance entry deleted marker is presentation-only",
  () => {
    assert.equal(
      isDeletedLeaveEntry({
        deleted: true,
      }),
      true
    );

    assert.equal(
      isDeletedLeaveEntry({
        deleted: false,
      }),
      false
    );
  }
);