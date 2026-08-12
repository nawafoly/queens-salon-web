import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createLeave, decideLeave } from "./core/repositories/leaves.js";

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
                "partial_start_time", "partial_end_time", "request_id", "employee_note", "hr_note",
                "decided_at", "decided_by_uid", "decided_by_email", "decided_by_name", "created_at", "updated_at",
              ];
              db.leaves.set(params[0], Object.fromEntries(keys.map((key, index) => [key, params[index]])));
              return { meta: { changes: 1 } };
            }

            if (normalized.startsWith("UPDATE employee_leaves SET status = ?")) {
              const [status, hrNote, decidedAt, uid, email, name, updatedAt, salonId, id] = params;
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
              const [start, end, note, , salonId, id] = params;
              const row = db.staff.get(id);
              if (row && row.salon_id === salonId) {
                Object.assign(row, { leave_start_date: start, leave_end_date: end, leave_note: note });
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            }

            if (normalized.startsWith("UPDATE staff SET leave_start_date = NULL")) {
              db.staffMirrorWrites += 1;
              const [, salonId, id, start, end] = params;
              const row = db.staff.get(id);
              if (row && row.salon_id === salonId && row.leave_start_date === start && row.leave_end_date === end) {
                Object.assign(row, { leave_start_date: null, leave_end_date: null, leave_note: null });
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
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

test("admin partial leave persists its time range and never becomes a full-day staff mirror", async () => {
  const db = new LeaveFakeD1();
  const leave = await createLeave(db, "main", {
    id: "partial-1",
    employeeId: "staff-1",
    leaveType: "emergency",
    startDate: "2026-08-30",
    endDate: "2026-08-30",
    durationKind: "partial",
    partialStartTime: "18:00",
    partialEndTime: "20:00",
    daysCount: 1,
  }, { uid: "admin-1" });

  assert.equal(leave.duration_kind, "partial");
  assert.equal(leave.partial_start_time, "18:00");
  assert.equal(leave.partial_end_time, "20:00");

  const approved = await decideLeave(db, "main", "partial-1", {
    status: "approved",
    hrNote: "approved",
  }, { uid: "admin-1" });

  assert.equal(approved.status, "approved");
  assert.equal(db.staffMirrorWrites, 0);
  assert.equal(db.staff.get("staff-1").leave_start_date, null);
});

test("full-day leave keeps the historical staff mirror behavior", async () => {
  const db = new LeaveFakeD1();
  await createLeave(db, "main", {
    id: "full-1",
    employeeId: "staff-1",
    leaveType: "annual",
    startDate: "2026-08-30",
    endDate: "2026-08-30",
    daysCount: 1,
  });

  await decideLeave(db, "main", "full-1", {
    status: "approved",
    hrNote: "approved",
  }, { uid: "admin-1" });

  assert.equal(db.staffMirrorWrites, 1);
  assert.equal(db.staff.get("staff-1").leave_start_date, "2026-08-30");
});

test("admin UI and dashboard pass the partial leave contract end to end", () => {
  const modal = readFileSync("src/components/LeaveRequestModal.tsx", "utf8");
  const dashboard = readFileSync("src/pages/DashboardEmployees.tsx", "utf8");
  const hub = readFileSync("src/services/employeeHub.ts", "utf8");

  assert.match(modal, /استئذان/);
  assert.match(modal, /partialStartTime/);
  assert.match(modal, /partialEndTime/);
  assert.match(dashboard, /durationKind,/);
  assert.match(dashboard, /partialStartTime: isPartialLeave/);
  assert.equal(dashboard.includes("if (!isPartialLeave)"), true);
  assert.equal(hub.includes('durationKind: cleanText(input.durationKind).toLowerCase() === "partial" ? "partial" : "full_day",'), true);
  assert.match(hub, /partialStartTime:/);
  assert.match(hub, /partialEndTime:/);
});
