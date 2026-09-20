import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { resolveEmployeeShift } from "./core/repositories/shift-control.js";

const salonId = "main";
const employeeId = "emp-weekly-off-suspension";

const suspendedWorkDates = new Set([
  "2026-08-16",
  "2026-08-23",
]);

const sundayDates = new Set([
  "2026-08-09",
  "2026-08-16",
  "2026-08-23",
  "2026-08-30",
  "2026-09-06",
]);

function fakeShiftDb() {
  return {
    __fakeD1: true,
    async first(sql, params = []) {
      const normalized = String(sql).replace(/\s+/g, " ").trim();

      if (normalized.includes("MAX(has_profile)") && normalized.includes("FROM employee_profiles p")) {
        return {
          employee_id: employeeId,
          has_profile: 1,
          has_employment: 1,
          profile_status: "active",
          employment_status: "active",
          start_date: "2020-01-01",
          end_date: null,
        };
      }

      if (normalized.includes("FROM hr_schedule_exceptions")) {
        const date = String(params[2] || "");
        if (!suspendedWorkDates.has(date)) return null;
        return {
          id: `TEMP_WORK_${date}`,
          salon_id: salonId,
          employee_id: employeeId,
          date_from: date,
          date_to: date,
          exception_type: "custom",
          shift_template_id: null,
          enabled: 1,
          start_time: "15:00",
          end_time: "23:00",
          note: "[TEMP_WEEKLY_OFF:sun:none:2026-08-12:2026-08-30] TEMP_WORK",
          status: "approved",
          created_at: `${date}T00:00:00.000Z`,
        };
      }

      if (normalized.includes("FROM hr_work_schedules")) {
        const date = String(params[3] || "");
        const isSunday = sundayDates.has(date);
        return {
          id: `weekly_${date}`,
          salon_id: salonId,
          employee_id: employeeId,
          weekday: params[2],
          active: isSunday ? 0 : 1,
          start_time: "15:00",
          end_time: "23:00",
          template_start_time: "15:00",
          template_end_time: "23:00",
          late_grace_minutes: 0,
          attendance_lock_enabled: 0,
          attendance_lock_after_minutes: 30,
          break_minutes: 0,
          overtime_after_minutes: 0,
        };
      }

      if (normalized.includes("FROM hr_shift_assignments")) return null;
      if (normalized.includes("FROM employee_weekly_rest_work_assignments")) return null;
      throw new Error(`Unhandled fake shift query: ${normalized}`);
    },
  };
}

test("suspension UI creates work overrides only before the return date and no replacement off day", () => {
  const source = readFileSync(
    new URL("../src/pages/dashboardEmployees/TemporaryWeeklyOffPeriodCard.tsx", import.meta.url),
    "utf8"
  );

  assert.match(
    source,
    /const temporaryOffDates = mode === "change" && temporaryDay/,
    "suspend mode must not create a substitute TEMP_OFF day"
  );
  assert.match(
    source,
    /const temporaryWorkRangeEnd = mode === "suspend" \? previousDateKey\(toDate\) : toDate/,
    "TEMP_WORK must stop on the day before the configured return date"
  );
  assert.match(
    source,
    /mode === "suspend"[\s\S]*?لا توجد إجازة أسبوعية بديلة/,
    "UI contract must explicitly preserve no-replacement-day semantics"
  );
});

test("Core shift resolver works base weekly-off dates during suspension and restores weekly off on return date", async () => {
  const db = fakeShiftDb();

  const before = await resolveEmployeeShift(db, salonId, employeeId, "2026-08-09");
  assert.equal(before.source, "weekly_schedule");
  assert.equal(before.exception_type, "off");
  assert.equal(Number(before.active), 0);

  for (const date of ["2026-08-16", "2026-08-23"]) {
    const inside = await resolveEmployeeShift(db, salonId, employeeId, date);
    assert.equal(inside.source, "exception");
    assert.equal(inside.exception_type, "custom");
    assert.equal(inside.start_time, "15:00");
    assert.equal(inside.end_time, "23:00");
  }

  const ordinaryWorkingDay = await resolveEmployeeShift(db, salonId, employeeId, "2026-08-17");
  assert.equal(ordinaryWorkingDay.source, "weekly_schedule");
  assert.equal(Number(ordinaryWorkingDay.active), 1, "no substitute weekly-off day may be created");

  const returnDate = await resolveEmployeeShift(db, salonId, employeeId, "2026-08-30");
  assert.equal(returnDate.source, "weekly_schedule");
  assert.equal(returnDate.exception_type, "off");
  assert.equal(Number(returnDate.active), 0, "base weekly off must return automatically on toDate");
});
