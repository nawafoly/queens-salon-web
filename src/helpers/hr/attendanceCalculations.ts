import { isWeeklyOffDateKey, type WorkScheduleWeekday } from "./workSchedule.ts";
import { calculateAttendanceMinutePolicy } from "./attendancePolicyMath.js";
import {
  calculatePermissionCoverage,
  permissionIntervalsFromAttendanceRecords,
  permissionIntervalsFromRequests,
  roundPermissionHours,
  type PermissionIntervalInput,
} from "./permissionAttendance.ts";

export type AttendanceRecord = {
  id?: string;
  type: "check_in" | "check_out" | string;
  serverTime?: string | null;
  [key: string]: unknown;
};

const RIYADH_TIME_ZONE = "Asia/Riyadh";

export type ShiftSchedule = {
  startTime?: string | null;
  endTime?: string | null;
  lateGraceMinutes?: number | string | null;
  /** @deprecated No early-departure grace is applied. */
  earlyLeaveGraceMinutes?: number | string | null;
  attendanceLockEnabled?: boolean | number | string | null;
  attendanceLockAfterMinutes?: number | string | null;
  weeklyOffDays?: WorkScheduleWeekday[] | string[] | null;
};

export type AttendanceDayComputation = {
  date: string;
  checkIn: AttendanceRecord | null;
  checkOut: AttendanceRecord | null;
  expectedHours: number;
  actualHours: number;
  lateHours: number;
  rawMissingHours: number;
  permissionRequestedHours: number;
  permissionCoveredHours: number;
  missingHours: number;
  overtimeHours: number;
  isComplete: boolean;
  isBeforeScheduledEnd: boolean;
};

export type AttendanceStatus =
  | "present"
  | "late"
  | "missing_hours"
  | "in_progress"
  | "partial"
  | "absent"
  | "leave"
  | "off_day"
  | "future"
  | "today_pending";

export type AttendancePayrollSummary = {
  expectedHours: number;
  actualHours: number;
  lateHours: number;
  missingHours: number;
  overtimeHours: number;
  completeDays: number;
  incompleteDays: number;
  absentDays: number;
  absentDateKeys: string[];
  days: AttendanceDayComputation[];
};

export type AttendancePayrollSummaryOptions = {
  workDateKeys?: Iterable<string>;
  todayDateKey?: string;
  approvedLeaveDateKeys?: Iterable<string>;
  holidayDateKeys?: Iterable<string>;
  absenceDateKeys?: Iterable<string>;
  permissionEntries?: Array<Record<string, unknown>>;
};

function roundHours(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value * 100) / 100;
}

function policyMinutes(value: unknown) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.min(24 * 60, Math.round(number));
}

function parseTimeParts(value?: string | null) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }
  return { hours, minutes };
}

function riyadhDateKey(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: RIYADH_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function buildRiyadhDateTimeMs(dateKey: string, time?: string | null) {
  const parts = parseTimeParts(time);
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!parts || !dateMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  return Date.UTC(year, month - 1, day, parts.hours - 3, parts.minutes, 0, 0);
}

export function getAttendanceDayStatus(input: {
  date: string;
  hasAttendance: boolean;
  checkOut?: AttendanceRecord | null;
  computation?: AttendanceDayComputation | null;
  todayDateKey: string;
  weeklyOffDays?: WorkScheduleWeekday[] | string[] | null;
  approvedLeaveDateKeys?: Set<string> | Iterable<string>;
  holidayDateKeys?: Set<string> | Iterable<string>;
  absenceDateKeys?: Set<string> | Iterable<string>;
}): AttendanceStatus {
  const approvedLeaveDateKeys =
    input.approvedLeaveDateKeys instanceof Set
      ? input.approvedLeaveDateKeys
      : new Set(input.approvedLeaveDateKeys || []);
  const holidayDateKeys =
    input.holidayDateKeys instanceof Set
      ? input.holidayDateKeys
      : new Set(input.holidayDateKeys || []);
  const absenceDateKeys =
    input.absenceDateKeys instanceof Set
      ? input.absenceDateKeys
      : new Set(input.absenceDateKeys || []);

  if (input.hasAttendance) {
    if (input.computation?.isComplete) {
      if (input.computation.missingHours > 0.001) return "missing_hours";
      if (input.computation.lateHours > 0.001) return "late";
      return "present";
    }
    return input.computation?.isBeforeScheduledEnd ? "in_progress" : "partial";
  }

  if (approvedLeaveDateKeys.has(input.date)) return "leave";
  if (absenceDateKeys.has(input.date)) return "absent";

  if (
    isWeeklyOffDateKey(input.date, input.weeklyOffDays) ||
    holidayDateKeys.has(input.date)
  ) {
    return "off_day";
  }

  if (input.date < input.todayDateKey) return "absent";
  if (input.date === input.todayDateKey) return "today_pending";
  return "future";
}

export function getShiftExpectedHours(schedule: ShiftSchedule) {
  const startParts = parseTimeParts(schedule.startTime);
  const endParts = parseTimeParts(schedule.endTime);
  if (!startParts || !endParts) return 0;

  const startMinutes = startParts.hours * 60 + startParts.minutes;
  let endMinutes = endParts.hours * 60 + endParts.minutes;
  if (endMinutes <= startMinutes) endMinutes += 24 * 60;
  return roundHours((endMinutes - startMinutes) / 60);
}

export function computeAttendanceDay(
  date: string,
  records: AttendanceRecord[],
  schedule: ShiftSchedule,
  permissionIntervals: PermissionIntervalInput[] = permissionIntervalsFromAttendanceRecords(records, date)
): AttendanceDayComputation {
  const sorted = [...records].sort(
    (left, right) =>
      Date.parse(left.serverTime || "") - Date.parse(right.serverTime || "")
  );
  const checkIn = sorted.find(record => record.type === "check_in") || null;
  const checkOut =
    [...sorted].reverse().find(record => record.type === "check_out") || null;
  const checkInMs = checkIn?.serverTime ? Date.parse(checkIn.serverTime) : NaN;
  const checkOutMs = checkOut?.serverTime ? Date.parse(checkOut.serverTime) : NaN;
  const scheduleStartMs = buildRiyadhDateTimeMs(date, schedule.startTime);
  let scheduleEndMs = buildRiyadhDateTimeMs(date, schedule.endTime);
  if (
    scheduleStartMs !== null &&
    scheduleEndMs !== null &&
    scheduleEndMs <= scheduleStartMs
  ) {
    scheduleEndMs += 24 * 60 * 60 * 1000;
  }

  const expectedHours = getShiftExpectedHours(schedule);
  const isComplete =
    Number.isFinite(checkInMs) &&
    Number.isFinite(checkOutMs) &&
    checkOutMs > checkInMs;
  const actualHours = isComplete
    ? roundHours((checkOutMs - checkInMs) / 3600000)
    : 0;
  const actualLateMinutes =
    Number.isFinite(checkInMs) && scheduleStartMs !== null
      ? Math.max(0, Math.round((checkInMs - scheduleStartMs) / 60000))
      : 0;
  const afterScheduleMinutes =
    Number.isFinite(checkOutMs) && scheduleEndMs !== null
      ? Math.max(0, Math.round((checkOutMs - scheduleEndMs) / 60000))
      : 0;
  const actualEarlyLeaveMinutes =
    Number.isFinite(checkOutMs) && scheduleEndMs !== null
      ? Math.max(0, Math.round((scheduleEndMs - checkOutMs) / 60000))
      : 0;
  const minutePolicy = calculateAttendanceMinutePolicy({
    actualLateMinutes,
    earlyLeaveMinutes: actualEarlyLeaveMinutes,
    afterScheduleMinutes,
  });
  const lateHours = roundHours(minutePolicy.uncompensatedLateMinutes / 60);
  const overtimeHours = isComplete ? roundHours(minutePolicy.extraMinutes / 60) : 0;
  const isBeforeScheduledEnd =
    !isComplete &&
    Number.isFinite(checkInMs) &&
    !Number.isFinite(checkOutMs) &&
    scheduleEndMs !== null &&
    date === riyadhDateKey(new Date().toISOString()) &&
    Date.now() <= scheduleEndMs;
  const rawMissingMinutes = isComplete
    ? minutePolicy.missingMinutes
    : Math.max(0, Math.round(expectedHours * 60 - actualHours * 60));
  // There is no free late time and no early-departure grace. Arriving early cannot
  // offset leaving early; approved permission is the only adjustment.
  const rawMissingHours = roundHours(rawMissingMinutes / 60);
  const permissionCoverage = calculatePermissionCoverage({
    date,
    scheduledStart: schedule.startTime,
    scheduledEnd: schedule.endTime,
    checkInAt: checkIn?.serverTime,
    checkOutAt: checkOut?.serverTime,
    rawMissingMinutes,
    intervals: permissionIntervals,
  });
  const missingHours = roundPermissionHours(permissionCoverage.adjustedMissingMinutes);

  return {
    date,
    checkIn,
    checkOut,
    expectedHours,
    actualHours,
    lateHours,
    rawMissingHours,
    permissionRequestedHours: roundPermissionHours(permissionCoverage.requestedMinutes),
    permissionCoveredHours: roundPermissionHours(permissionCoverage.coveredMissingMinutes),
    missingHours,
    overtimeHours,
    isComplete,
    isBeforeScheduledEnd,
  };
}

export function summarizeAttendanceForPayroll(
  records: AttendanceRecord[],
  schedule: ShiftSchedule,
  options: AttendancePayrollSummaryOptions = {}
): AttendancePayrollSummary {
  const grouped = new Map<string, AttendanceRecord[]>();
  for (const record of records) {
    const date = riyadhDateKey(record.serverTime);
    if (!date) continue;
    const group = grouped.get(date) || [];
    group.push(record);
    grouped.set(date, group);
  }

  const days = Array.from(grouped.entries())
    .map(([date, dayRecords]) =>
      computeAttendanceDay(
        date,
        dayRecords,
        schedule,
        permissionIntervalsFromRequests(options.permissionEntries, date)
      )
    )
    .sort((left, right) => left.date.localeCompare(right.date));
  const dayMap = new Map(days.map(day => [day.date, day]));
  const todayDateKey = options.todayDateKey || riyadhDateKey(new Date().toISOString());
  const approvedLeaveDateKeys = new Set(options.approvedLeaveDateKeys || []);
  const holidayDateKeys = new Set(options.holidayDateKeys || []);
  const absenceDateKeys = new Set(options.absenceDateKeys || []);
  const absentDateKeys = Array.from(
    new Set(Array.from(options.workDateKeys || []))
  )
    .filter(date => {
      const day = dayMap.get(date) || null;
      return (
        getAttendanceDayStatus({
          date,
          hasAttendance: Boolean(day?.checkIn || day?.checkOut),
          checkOut: day?.checkOut || null,
          computation: day,
          todayDateKey,
          weeklyOffDays: schedule.weeklyOffDays,
          approvedLeaveDateKeys,
          holidayDateKeys,
          absenceDateKeys,
        }) === "absent"
      );
    })
    .sort((left, right) => left.localeCompare(right));

  const summary = days.reduce<AttendancePayrollSummary>(
    (summary, day) => {
      const status = getAttendanceDayStatus({
        date: day.date,
        hasAttendance: Boolean(day.checkIn || day.checkOut),
        checkOut: day.checkOut,
        computation: day,
        todayDateKey,
        weeklyOffDays: schedule.weeklyOffDays,
        approvedLeaveDateKeys,
        holidayDateKeys,
        absenceDateKeys,
      });
      if (status === "absent") {
        return summary;
      }

      const countsAsWorkDay = !isWeeklyOffDateKey(
        day.date,
        schedule.weeklyOffDays
      );
      summary.expectedHours = roundHours(
        summary.expectedHours + (countsAsWorkDay ? day.expectedHours : 0)
      );
      summary.actualHours = roundHours(summary.actualHours + day.actualHours);
      summary.lateHours = roundHours(
        summary.lateHours + (countsAsWorkDay ? day.lateHours : 0)
      );
      summary.missingHours = roundHours(
        summary.missingHours + (countsAsWorkDay ? day.missingHours : 0)
      );
      summary.overtimeHours = roundHours(
        summary.overtimeHours + (countsAsWorkDay ? day.overtimeHours : 0)
      );
      summary.completeDays += day.isComplete ? 1 : 0;
      summary.incompleteDays += day.checkIn && !day.checkOut && status !== "in_progress" ? 1 : 0;
      summary.days.push(day);
      return summary;
    },
    {
      expectedHours: 0,
      actualHours: 0,
      lateHours: 0,
      missingHours: 0,
      overtimeHours: 0,
      completeDays: 0,
      incompleteDays: 0,
      absentDays: 0,
      absentDateKeys: [],
      days: [],
    }
  );

  summary.absentDateKeys = absentDateKeys;
  summary.absentDays = absentDateKeys.length;
  return summary;
}


