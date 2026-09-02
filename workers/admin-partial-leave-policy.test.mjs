import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { AppError } from "./core/errors.js";
import {
  createLeave,
  decideLeave,
  leaveDecisionRuntime,
} from "./core/repositories/leaves.js";

class LeaveFakeD1 {
  constructor() {
    this.leaves = new Map();
    this.staff = new Map([["staff-1", {
      id: "staff-1",
      salon_id: "main",
      leave_start_date: null,
      leave_end_date: null,
      leave_note: null,
    }]]);
    this.staffMirrorWrites = 0;
  }

  prepare(sql) {
    const db = this;
    return {
      bind(...params) {
        const normalized = sql.replace(/\s+/g, " ").trim();
        return {
          sql: normalized,
          params,
          async first() {
            if (normalized.startsWith("SELECT * FROM employee_leaves WHERE salon_id = ? AND id = ?")) {
              const [salonId, id] = params;
              const row = db.leaves.get(id);
              return row && row.salon_id === salonId ? { ...row } : null;
            }
            return null;
          },
          async all() {
            return { results: [] };
          },
          async run() {
            if (normalized.startsWith("INSERT INTO employee_leaves")) {
              const keys = [
                "id", "salon_id", "employee_id", "employee_uid", "employee_name", "employee_email",
                "status", "leave_type", "start_date", "end_date", "days_count", "duration_kind",
                "partial_start_time", "partial_end_time", "request_id",
                "deduct_from_balance", "affects_payroll", "balance_adjustment_id",
                "employee_note", "hr_note",
                "decided_at", "decided_by_uid", "decided_by_email", "decided_by_name",
                "created_at", "updated_at",
              ];
              db.leaves.set(
                params[0],
                Object.fromEntries(keys.map((key, index) => [key, params[index]]))
              );
              return { meta: { changes: 1 } };
            }

            if (normalized.startsWith("UPDATE employee_leaves SET policy_version = ?")) {
              const [policyVersion, balanceBucket, legalBasis, documentationStatus,
                statutoryReviewRequired, deductFromBalance, affectsPayroll,
                entitlementMinutesRequested, updatedAt, salonId, id] = params;
              const row = db.leaves.get(id);
              if (row && row.salon_id === salonId && row.status === "pending") {
                Object.assign(row, {
                  policy_version: policyVersion,
                  balance_bucket: balanceBucket,
                  legal_basis: legalBasis,
                  documentation_status: documentationStatus,
                  statutory_review_required: statutoryReviewRequired,
                  deduct_from_balance: deductFromBalance,
                  affects_payroll: affectsPayroll,
                  entitlement_minutes_requested: entitlementMinutesRequested,
                  updated_at: updatedAt,
                });
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            }

            const simpleLeaveDecision = normalized.match(
              /^UPDATE employee_leaves SET status = '(approved|rejected)'/
            );
            if (simpleLeaveDecision) {
              const status = simpleLeaveDecision[1];
              const [hrNote, decidedAt, uid, email, name, updatedAt, salonId, id] = params;
              const row = db.leaves.get(id);
              if (row && row.salon_id === salonId) {
                Object.assign(row, {
                  status,
                  hr_note: hrNote,
                  decided_at: decidedAt,
                  decided_by_uid: uid,
                  decided_by_email: email,
                  decided_by_name: name,
                  updated_at: updatedAt,
                });
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            }

            if (normalized.startsWith("UPDATE staff SET leave_start_date = ?")) {
              db.staffMirrorWrites += 1;
            }
            if (normalized.startsWith("UPDATE staff SET leave_start_date = NULL")) {
              db.staffMirrorWrites += 1;
            }
            return { meta: { changes: 0 } };
          },
        };
      },
    };
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
}

test("admin partial unpaid leave persists its time range and never becomes a full-day staff mirror", async () => {
  const db = new LeaveFakeD1();
  const leave = await createLeave(db, "main", {
    id: "partial-1",
    employeeId: "staff-1",
    leaveType: "unpaid",
    startDate: "2026-08-30",
    endDate: "2026-08-30",
    durationKind: "partial",
    partialStartTime: "18:00",
    partialEndTime: "20:00",
    daysCount: 0.25,
  }, { uid: "admin-1" });

  assert.equal(leave.duration_kind, "partial");
  assert.equal(leave.partial_start_time, "18:00");
  assert.equal(leave.partial_end_time, "20:00");
  assert.equal(leave.leave_type, "unpaid");

  const approved = await decideLeave(db, "main", "partial-1", {
    status: "approved",
    hrNote: "approved",
  }, { uid: "admin-1" });

  assert.equal(approved.status, "approved");
  assert.equal(db.staffMirrorWrites, 0);
  assert.equal(db.staff.get("staff-1").leave_start_date, null);
});

test("emergency leave is canonical company policy backed by annual balance", async () => {
  const db = new LeaveFakeD1();
  const leave = await createLeave(db, "main", {
    id: "emergency-1",
    employeeId: "staff-1",
    leaveType: "emergency",
    startDate: "2026-08-30",
    endDate: "2026-08-30",
    daysCount: 1,
  });

  assert.equal(leave.leave_type, "emergency");
  assert.equal(Number(leave.deduct_from_balance), 1);
  assert.equal(Number(leave.statutory_review_required), 0);
  assert.equal(
    leaveDecisionRuntime(leave, "approved"),
    "annual_approve"
  );
  assert.equal(db.staffMirrorWrites, 0);
});

test("full-day unpaid leave remains canonical and never writes a staff leave mirror", async () => {
  const db = new LeaveFakeD1();
  await createLeave(db, "main", {
    id: "full-1",
    employeeId: "staff-1",
    leaveType: "unpaid",
    startDate: "2026-08-30",
    endDate: "2026-08-30",
    daysCount: 1,
  });

  const approved = await decideLeave(db, "main", "full-1", {
    status: "approved",
    hrNote: "approved",
  }, { uid: "admin-1" });

  assert.equal(approved.status, "approved");
  assert.equal(db.staffMirrorWrites, 0);
  assert.equal(db.staff.get("staff-1").leave_start_date, null);
});

test("admin UI and dashboard pass the partial leave contract end to end", () => {
  const modal = readFileSync("src/components/LeaveRequestModal.tsx", "utf8");
  const dashboard = readFileSync("src/pages/DashboardEmployees.tsx", "utf8");
  const canonicalLeaveBridge = readFileSync(
    "src/services/canonicalEmployeeLeaveRequests.ts",
    "utf8"
  );

  assert.match(modal, /استئذان/);
  assert.match(modal, /partialStartTime/);
  assert.match(modal, /partialEndTime/);
  assert.match(dashboard, /durationKind,/);
  assert.match(dashboard, /partialStartTime: isPartialLeave/);
  assert.match(dashboard, /partialEndTime:\s*isPartialLeave/);
  assert.match(
    canonicalLeaveBridge,
    /durationKind:\s*cleanText\(payload\.durationKind\)\.toLowerCase\(\)\s*===\s*"partial"\s*\?\s*"partial"\s*:\s*"full_day"/
  );
  assert.match(
    canonicalLeaveBridge,
    /partialStartTime:\s*cleanText\(payload\.partialStartTime\s*\|\|\s*base\.partialStartTime\)/
  );
  assert.match(
    canonicalLeaveBridge,
    /partialEndTime:\s*cleanText\(payload\.partialEndTime\s*\|\|\s*base\.partialEndTime\)/
  );
  assert.match(canonicalLeaveBridge, /employeeRequestAction\(request\.id, action/);
  assert.match(canonicalLeaveBridge, /CoreHrService\.listLeaves\(\{ employeeId \}\)/);
  assert.doesNotMatch(canonicalLeaveBridge, /CoreHrService\.createLeave\(/);
});
