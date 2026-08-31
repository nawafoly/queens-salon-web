import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveStaffBookingDay,
  resolveStaffBookingDaysBatch,
} from "./core/repositories/booking-staff-policy.js";

const salonId = "main";
const staff = {
  id: "emp-1",
  active: 1,
  employment_status: "active",
};

function fakeDb({
  date = "2026-08-31",
  leave = false,
  recall = false,
  weeklyOff = false,
  weeklyRestAssignment = false,
} = {}) {
  const rows = {
    employee_leaves: leave
      ? [{
          id: "leave-1",
          salon_id: salonId,
          employee_id: staff.id,
          status: "approved",
          leave_type: "annual",
          duration_kind: "full_day",
          start_date: date,
          end_date: date,
        }]
      : [],
    employee_leave_recalls: recall
      ? [{
          id: "recall-1",
          salon_id: salonId,
          leave_id: "leave-1",
          employee_id: staff.id,
          recall_date: date,
          status: "active",
        }]
      : [],
    employee_absences: [],
    employee_weekly_rest_work_assignments: weeklyRestAssignment
      ? [{
          id: "rest-work-1",
          salon_id: salonId,
          employee_id: staff.id,
          rest_date: date,
          start_time: "15:00",
          end_time: "23:00",
          attendance_lock_enabled: 0,
          attendance_lock_after_minutes: 0,
          status: "assigned",
          created_at: date + "T00:00:00.000Z",
        }]
      : [],
  };

  return {
    __fakeD1: true,
    rows(table) {
      return rows[table] || [];
    },
    async first(sql, params = []) {
      const q = String(sql).replace(/\s+/g, " ").trim();

      if (
        q.includes("FROM employee_profiles p") &&
        q.includes("FROM employee_employment e")
      ) {
        return {
          employee_id: staff.id,
          has_profile: 1,
          has_employment: 1,
          profile_status: "active",
          employment_status: "active",
          end_date: null,
        };
      }

      if (q.includes("FROM employee_weekly_rest_work_assignments")) {
        return rows.employee_weekly_rest_work_assignments.find(
          (row) =>
            row.salon_id === params[0] &&
            row.employee_id === params[1] &&
            row.rest_date === params[2] &&
            row.status === "assigned"
        ) || null;
      }

      if (q.includes("FROM hr_schedule_exceptions")) return null;
      if (q.includes("FROM hr_shift_assignments")) return null;

      if (q.includes("FROM hr_work_schedules")) {
        return {
          id: "schedule-1",
          salon_id: salonId,
          employee_id: staff.id,
          weekday: params[2],
          active: weeklyOff ? 0 : 1,
          start_time: "15:00",
          end_time: "23:00",
          template_start_time: "15:00",
          template_end_time: "23:00",
          attendance_lock_enabled: 0,
          attendance_lock_after_minutes: 0,
          late_grace_minutes: 0,
          break_minutes: 0,
          overtime_after_minutes: 0,
        };
      }

      throw new Error("Unhandled fake first query: " + q);
    },
    async all(sql) {
      const q = String(sql).replace(/\s+/g, " ").trim();
      if (q.includes("FROM employee_leaves")) return rows.employee_leaves;
      if (q.includes("FROM employee_absences")) return rows.employee_absences;
      if (q.includes("FROM employee_weekly_rest_work_assignments")) {
        return rows.employee_weekly_rest_work_assignments;
      }
      throw new Error("Unhandled fake all query: " + q);
    },
  };
}

test("approved annual leave remains unavailable for booking without recall", async () => {
  const date = "2026-08-31";
  const day = await resolveStaffBookingDay(
    fakeDb({ date, leave: true }),
    salonId,
    staff,
    date
  );
  assert.equal(day.available, false);
  assert.equal(day.reason, "approved_leave");
});

test("active annual recall removes only that date from the booking leave block", async () => {
  const date = "2026-08-31";
  const day = await resolveStaffBookingDay(
    fakeDb({ date, leave: true, recall: true }),
    salonId,
    staff,
    date
  );
  assert.equal(day.available, true);
  assert.equal(day.source, "weekly_schedule");
});

test("weekly rest remains unavailable without an explicit work assignment", async () => {
  const date = "2026-08-31";
  const day = await resolveStaffBookingDay(
    fakeDb({ date, weeklyOff: true }),
    salonId,
    staff,
    date
  );
  assert.equal(day.available, false);
  assert.equal(day.reason, "weekly_or_schedule_off");
});

test("weekly-rest work assignment opens the authorized booking window without rewriting the schedule", async () => {
  const date = "2026-08-31";
  const day = await resolveStaffBookingDay(
    fakeDb({
      date,
      weeklyOff: true,
      weeklyRestAssignment: true,
    }),
    salonId,
    staff,
    date,
    "16:00",
    "17:00"
  );
  assert.equal(day.available, true);
  assert.equal(day.source, "weekly_rest_work_assignment");
  assert.equal(day.startTime, "15:00");
  assert.equal(day.endTime, "23:00");
});

test("batch booking policy applies recall and weekly-rest authorization consistently", async () => {
  const date = "2026-08-31";

  const recallBatch = await resolveStaffBookingDaysBatch(
    fakeDb({ date, leave: true, recall: true }),
    salonId,
    [staff],
    date
  );
  assert.equal(recallBatch[0].day.available, true);

  const restBatch = await resolveStaffBookingDaysBatch(
    fakeDb({ date, weeklyOff: true, weeklyRestAssignment: true }),
    salonId,
    [staff],
    date
  );
  assert.equal(restBatch[0].day.available, true);
  assert.equal(restBatch[0].day.source, "weekly_rest_work_assignment");
});
