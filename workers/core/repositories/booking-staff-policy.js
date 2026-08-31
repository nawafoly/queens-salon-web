// CORE D1 ONLY — booking availability must follow the operational HR truth.

import {
  cleanText,
  dbAll,
  dbFirst,
  placeholders,
} from '../d1.js';
import {
  resolveEmployeeShift,
  resolveEmployeeShiftsBatch,
} from './shift-control.js';
const INACTIVE_EMPLOYMENT_STATUSES = new Set([
  'inactive',
  'disabled',
  'suspended',
  'archived',
  'deleted',
  'terminated',
  'resigned',
  'ended',
  'stopped',
  'blocked',
]);

function safeFakeRows(db, table) {
  if (!db?.__fakeD1 || typeof db.rows !== 'function') return [];
  try {
    return db.rows(table);
  } catch {
    return [];
  }
}

function staffIsActiveForBooking(staff) {
  const statuses = [
    staff?.employment_status,
    staff?.hr_profile_status,
    staff?.hr_employment_status,
    staff?.hr_account_status,
  ].map((status) => cleanText(status || 'active').toLowerCase());
  return Number(staff?.active) === 1 && statuses.every((status) => !INACTIVE_EMPLOYMENT_STATUSES.has(status));
}

function activeRecallIdsForDateFake(db, salonId, date) {
  return new Set(
    safeFakeRows(db, 'employee_leave_recalls')
      .filter((row) =>
        row.salon_id === salonId &&
        cleanText(row.recall_date) === date &&
        cleanText(row.status).toLowerCase() === 'active'
      )
      .map((row) => cleanText(row.leave_id))
      .filter(Boolean)
  );
}

async function approvedLeavesForDate(db, salonId, employeeId, date) {
  if (db?.__fakeD1) {
    const recalledLeaveIds = activeRecallIdsForDateFake(db, salonId, date);
    return safeFakeRows(db, 'employee_leaves').filter((row) =>
      row.salon_id === salonId &&
      cleanText(row.employee_id) === employeeId &&
      cleanText(row.status).toLowerCase() === 'approved' &&
      cleanText(row.start_date) <= date &&
      cleanText(row.end_date) >= date &&
      !recalledLeaveIds.has(cleanText(row.id))
    );
  }

  return dbAll(
    db,
    `SELECT leave.* FROM employee_leaves leave
      WHERE leave.salon_id = ?
        AND leave.employee_id = ?
        AND LOWER(leave.status) = 'approved'
        AND leave.start_date <= ?
        AND leave.end_date >= ?
        AND NOT EXISTS (
          SELECT 1 FROM employee_leave_recalls recall
           WHERE recall.salon_id = leave.salon_id
             AND recall.leave_id = leave.id
             AND recall.recall_date = ?
             AND recall.status = 'active'
        )
      ORDER BY leave.start_date DESC`,
    [salonId, employeeId, date, date, date]
  );
}

async function absenceForDate(db, salonId, employeeId, date) {
  if (db?.__fakeD1) {
    return safeFakeRows(db, 'employee_absences').find((row) =>
      row.salon_id === salonId &&
      cleanText(row.employee_id) === employeeId &&
      cleanText(row.date_key) === date
    ) || null;
  }

  return dbFirst(
    db,
    `SELECT * FROM employee_absences
      WHERE salon_id = ? AND employee_id = ? AND date_key = ?
      ORDER BY created_at DESC LIMIT 1`,
    [salonId, employeeId, date]
  );
}

function resolvedShiftWindow(shift) {
  const start = cleanText(
    shift?.start_time || shift?.startTime || shift?.template_start_time || shift?.templateStartTime
  );
  const end = cleanText(
    shift?.end_time || shift?.endTime || shift?.template_end_time || shift?.templateEndTime
  );
  return { start, end };
}

function timeInsideRange(time, start, end) {
  const value = cleanText(time);
  if (!value || !start || !end) return false;
  return value >= start && value <= end;
}

function isPartialLeave(row) {
  return cleanText(row?.duration_kind).toLowerCase() === 'partial' &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(cleanText(row?.partial_start_time)) &&
    /^([01]\d|2[0-3]):[0-5]\d$/.test(cleanText(row?.partial_end_time));
}

function rangesOverlap(startA, endA, startB, endB) {
  return Boolean(startA && endA && startB && endB && startA < endB && endA > startB);
}

function partialLeaveRanges(leaves) {
  return leaves
    .filter(isPartialLeave)
    .map((row) => ({
      startTime: cleanText(row.partial_start_time),
      endTime: cleanText(row.partial_end_time),
      source: 'employee_leaves',
      reason: 'partial_leave',
      leaveId: cleanText(row.id),
      leaveType: cleanText(row.leave_type),
    }));
}

function resolveStaffBookingDayFromFacts(
  staff,
  date,
  leaves,
  absence,
  shift,
  startTime = "",
  endTime = ""
) {
  const employeeId =
    cleanText(
      staff?.id
    );

  if (
    !employeeId ||
    !date ||
    !staffIsActiveForBooking(
      staff
    )
  ) {
    return {
      available: false,
      reason: "inactive",
      source: "staff",
      blockedRanges: [],
    };
  }

  const fullLeave =
    leaves.find(
      (row) =>
        !isPartialLeave(row)
    );

  if (fullLeave) {
    return {
      available: false,
      reason:
        "approved_leave",
      source:
        "employee_leaves",
      leaveType:
        cleanText(
          fullLeave.leave_type
        ),
      leaveId:
        cleanText(
          fullLeave.id
        ),
      leaveNote:
        cleanText(
          fullLeave.hr_note ||
            fullLeave.employee_note
        ),
      blockedRanges: [],
    };
  }

  const blockedRanges =
    partialLeaveRanges(
      leaves
    );

  if (
    startTime &&
    endTime &&
    blockedRanges.some(
      (range) =>
        rangesOverlap(
          startTime,
          endTime,
          range.startTime,
          range.endTime
        )
    )
  ) {
    return {
      available: false,
      reason:
        "partial_leave",
      source:
        "employee_leaves",
      blockedRanges,
    };
  }

  if (absence) {
    return {
      available: false,
      reason: "absence",
      source:
        "employee_absences",
      absenceType:
        cleanText(
          absence.absence_type
        ),
      absenceId:
        cleanText(
          absence.id
        ),
      blockedRanges,
    };
  }

  if (
    shift &&
    cleanText(
      shift.source
    ) !== "none"
  ) {
    const exceptionType =
      cleanText(
        shift.exception_type ||
        shift.exceptionType
      ).toLowerCase();

    if (
      exceptionType === "off" ||
      exceptionType === "rest" ||
      Number(
        shift.active
      ) === 0
    ) {
      return {
        available: false,
        reason:
          exceptionType ===
          "rest"
            ? "rest"
            : "weekly_or_schedule_off",
        source:
          cleanText(
            shift.source
          ) ||
          "hr_schedule",
        shift,
        blockedRanges,
      };
    }

    const {
      start,
      end,
    } =
      resolvedShiftWindow(
        shift
      );

    if (!start || !end) {
      return {
        available: false,
        reason:
          "no_working_window",
        source:
          cleanText(
            shift.source
          ),
        shift,
        blockedRanges,
      };
    }

    if (
      startTime ||
      endTime
    ) {
      if (
        !startTime ||
        !endTime ||
        !timeInsideRange(
          startTime,
          start,
          end
        ) ||
        !timeInsideRange(
          endTime,
          start,
          end
        )
      ) {
        return {
          available: false,
          reason:
            "outside_shift",
          source:
            cleanText(
              shift.source
            ),
          startTime: start,
          endTime: end,
          shift,
          blockedRanges,
        };
      }
    }

    return {
      available: true,
      reason: "",
      source:
        cleanText(
          shift.source
        ),
      startTime: start,
      endTime: end,
      shift,
      blockedRanges,
    };
  }

  return {
    available: false,
    reason:
      "no_hr_schedule",
    source:
      "hr_schedule",
    blockedRanges,
  };
}

export async function resolveStaffBookingDay(
  db,
  salonId,
  staff,
  dateValue,
  startTime = "",
  endTime = ""
) {
  const employeeId =
    cleanText(
      staff?.id
    );

  const date =
    cleanText(
      dateValue
    );

  if (
    !employeeId ||
    !date ||
    !staffIsActiveForBooking(
      staff
    )
  ) {
    return resolveStaffBookingDayFromFacts(
      staff,
      date,
      [],
      null,
      null,
      startTime,
      endTime
    );
  }

  const leaves =
    await approvedLeavesForDate(
      db,
      salonId,
      employeeId,
      date
    );

  if (
    leaves.some(
      (row) =>
        !isPartialLeave(row)
    )
  ) {
    return resolveStaffBookingDayFromFacts(
      staff,
      date,
      leaves,
      null,
      null,
      startTime,
      endTime
    );
  }

  const absence =
    await absenceForDate(
      db,
      salonId,
      employeeId,
      date
    );

  if (absence) {
    return resolveStaffBookingDayFromFacts(
      staff,
      date,
      leaves,
      absence,
      null,
      startTime,
      endTime
    );
  }

  const shift =
    await resolveEmployeeShift(
      db,
      salonId,
      employeeId,
      date
    ).catch(
      () => null
    );

  return resolveStaffBookingDayFromFacts(
    staff,
    date,
    leaves,
    absence,
    shift,
    startTime,
    endTime
  );
}

export async function resolveStaffBookingDaysBatch(
  db,
  salonId,
  staffRows,
  dateValue
) {
  const date =
    cleanText(
      dateValue
    );

  const staff =
    (Array.isArray(staffRows)
      ? staffRows
      : []
    ).filter(
      (row) =>
        cleanText(row?.id)
    );

  if (!staff.length) {
    return [];
  }

  const employeeIds =
    Array.from(
      new Set(
        staff.map(
          (row) =>
            cleanText(row.id)
        )
      )
    );

  let leaves;
  let absences;

  if (db?.__fakeD1) {
    const wanted =
      new Set(
        employeeIds
      );

    const recalledLeaveIds =
      activeRecallIdsForDateFake(
        db,
        salonId,
        date
      );

    leaves =
      safeFakeRows(
        db,
        "employee_leaves"
      ).filter(
        (row) =>
          row.salon_id === salonId &&
          wanted.has(
            cleanText(row.employee_id)
          ) &&
          cleanText(row.status).toLowerCase() === "approved" &&
          cleanText(row.start_date) <= date &&
          cleanText(row.end_date) >= date &&
          !recalledLeaveIds.has(
            cleanText(row.id)
          )
      );

    absences =
      safeFakeRows(
        db,
        "employee_absences"
      ).filter(
        (row) =>
          row.salon_id === salonId &&
          wanted.has(
            cleanText(row.employee_id)
          ) &&
          cleanText(row.date_key) === date
      );
  } else {
    const marks =
      placeholders(
        employeeIds.length
      );

    [leaves, absences] =
      await Promise.all([
        dbAll(
          db,
          'SELECT leave.* FROM employee_leaves leave ' +
            'WHERE leave.salon_id = ? ' +
            'AND leave.employee_id IN (' + marks + ') ' +
            'AND LOWER(leave.status) = \'approved\' ' +
            'AND leave.start_date <= ? AND leave.end_date >= ? ' +
            'AND NOT EXISTS (' +
              'SELECT 1 FROM employee_leave_recalls recall ' +
              'WHERE recall.salon_id = leave.salon_id ' +
              'AND recall.leave_id = leave.id ' +
              'AND recall.recall_date = ? ' +
              'AND recall.status = \'active\'' +
            ') ORDER BY leave.employee_id, leave.start_date DESC',
          [
            salonId,
            ...employeeIds,
            date,
            date,
            date,
          ]
        ),
        dbAll(
          db,
          'SELECT * FROM employee_absences ' +
            'WHERE salon_id = ? ' +
            'AND employee_id IN (' + marks + ') ' +
            'AND date_key = ? ' +
            'ORDER BY employee_id, created_at DESC',
          [
            salonId,
            ...employeeIds,
            date,
          ]
        ),
      ]);
  }

  const shiftBatch =
    await resolveEmployeeShiftsBatch(
      db,
      salonId,
      {
        employeeIds,
        dateFrom: date,
        dateTo: date,
      }
    );

  const leavesByEmployee =
    new Map();

  for (const row of leaves) {
    const employeeId =
      cleanText(
        row.employee_id
      );
    const current =
      leavesByEmployee.get(
        employeeId
      ) || [];
    current.push(row);
    leavesByEmployee.set(
      employeeId,
      current
    );
  }

  const absenceByEmployee =
    new Map();

  for (const row of absences) {
    const employeeId =
      cleanText(
        row.employee_id
      );
    if (
      employeeId &&
      !absenceByEmployee.has(
        employeeId
      )
    ) {
      absenceByEmployee.set(
        employeeId,
        row
      );
    }
  }

  const shiftByEmployee =
    new Map(
      (Array.isArray(
        shiftBatch?.rows
      )
        ? shiftBatch.rows
        : []
      )
        .map(
          (row) => [
            cleanText(row?.employee_id),
            row,
          ]
        )
        .filter(
          ([employeeId]) =>
            employeeId
        )
    );

  return staff.map(
    (row) => {
      const employeeId =
        cleanText(
          row.id
        );

      return {
        employeeId,
        day:
          resolveStaffBookingDayFromFacts(
            row,
            date,
            leavesByEmployee.get(
              employeeId
            ) || [],
            absenceByEmployee.get(
              employeeId
            ) || null,
            shiftByEmployee.get(
              employeeId
            ) || null
          ),
      };
    }
  );
}

export async function staffCanPerformService(db, salonId, staffIdValue, serviceIdValue) {
  const staffId = cleanText(staffIdValue);
  const serviceId = cleanText(serviceIdValue);
  if (!staffId || !serviceId) return false;

  if (db?.__fakeD1) {
    return safeFakeRows(db, 'staff_services').some((row) =>
      row.salon_id === salonId &&
      cleanText(row.staff_id) === staffId &&
      cleanText(row.service_id) === serviceId &&
      Number(row.active) === 1
    );
  }

  const row = await dbFirst(
    db,
    `SELECT staff_id FROM staff_services
      WHERE salon_id = ? AND staff_id = ? AND service_id = ? AND active = 1
      LIMIT 1`,
    [salonId, staffId, serviceId]
  );
  return Boolean(row);
}
