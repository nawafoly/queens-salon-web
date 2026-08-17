// CORE D1 ONLY — Partner Portal may consume operational HR truth only through this projection.

import {
  cleanText,
  validDate,
} from "../d1.js";
import { listStaffByIds } from "./staff.js";
import { resolveStaffBookingDaysBatch } from "./booking-staff-policy.js";

const MAX_PARTNER_OPERATIONAL_EMPLOYEES = 100;

function uniqueEmployeeIds(value) {
  return Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map(cleanText)
        .filter(Boolean)
    )
  );
}

function projectedBlockedRanges(value) {
  return (Array.isArray(value) ? value : [])
    .map((row) => ({
      startTime: cleanText(row?.startTime),
      endTime: cleanText(row?.endTime),
      source: cleanText(row?.source),
      reason: cleanText(row?.reason),
      leaveId: cleanText(row?.leaveId) || undefined,
      leaveType: cleanText(row?.leaveType) || undefined,
    }))
    .filter(
      (row) =>
        row.startTime &&
        row.endTime
    );
}

function projectOperationalDay(
  employeeId,
  date,
  day,
  staff
) {
  return {
    employeeId,
    date,
    available: day?.available === true,
    showOnBooking:
      Number(
        staff?.show_on_booking ?? 1
      ) === 1,
    reason: cleanText(day?.reason),
    source:
      cleanText(day?.source) ||
      "malikat_core",
    startTime:
      cleanText(day?.startTime) ||
      undefined,
    endTime:
      cleanText(day?.endTime) ||
      undefined,
    leaveType:
      cleanText(day?.leaveType) ||
      undefined,
    absenceType:
      cleanText(day?.absenceType) ||
      undefined,
    blockedRanges:
      projectedBlockedRanges(
        day?.blockedRanges
      ),
  };
}

function employeeNotFoundState(
  employeeId,
  date
) {
  return {
    employeeId,
    date,
    available: false,
    reason: "employee_not_found",
    source: "malikat_core",
    blockedRanges: [],
  };
}

export async function resolvePartnerOperationalDays(
  db,
  salonIdValue,
  input = {}
) {
  const salonId =
    cleanText(salonIdValue) ||
    "main";

  const date =
    validDate(
      input.date,
      "date"
    );

  const employeeIds =
    uniqueEmployeeIds(
      input.employeeIds
    );

  if (
    employeeIds.length >
    MAX_PARTNER_OPERATIONAL_EMPLOYEES
  ) {
    const error =
      new Error(
        "partner operational employee batch is too large"
      );

    error.code =
      "core_hr:partner_operational_batch_too_large";

    throw error;
  }

  if (!employeeIds.length) {
    return {
      date,
      rows: [],
    };
  }

  // Target only the requested canonical employees.
  // No global LIMIT and no per-employee D1 resolver loop.
  const staffRows =
    await listStaffByIds(
      db,
      salonId,
      employeeIds
    );

  const staffById =
    new Map(
      staffRows.map(
        (staff) => [
          cleanText(staff.id),
          staff,
        ]
      )
    );

  const operationalRows =
    await resolveStaffBookingDaysBatch(
      db,
      salonId,
      staffRows,
      date
    );

  const dayByEmployeeId =
    new Map(
      operationalRows.map(
        (row) => [
          cleanText(
            row.employeeId
          ),
          row.day,
        ]
      )
    );

  const rows =
    employeeIds.map(
      (employeeId) => {
        const staff =
          staffById.get(
            employeeId
          );

        if (!staff) {
          return employeeNotFoundState(
            employeeId,
            date
          );
        }

        return projectOperationalDay(
          employeeId,
          date,
          dayByEmployeeId.get(
            employeeId
          ),
          staff
        );
      }
    );

  return {
    date,
    rows,
  };
}
