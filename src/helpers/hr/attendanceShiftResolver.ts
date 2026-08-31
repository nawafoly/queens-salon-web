import {
  computeAttendanceDay,
  getAttendanceDayStatus,
  type AttendanceDayComputation,
  type AttendanceRecord,
  type AttendanceStatus,
  type ShiftSchedule,
} from "./attendanceCalculations.ts";
import { permissionIntervalsFromRequests, type PermissionIntervalInput } from "./permissionAttendance.ts";
import type { CoreResolvedShift } from "../../types/hrCoreApi.ts";

export type AttendanceShiftResolutionSource =
  | "core_resolved_shift"
  | "core_unavailable";

export type AttendanceShiftResolution = {
  dateKey: string;
  source: AttendanceShiftResolutionSource;
  sourceLabel: string;
  sourceDetail: string;
  sourceType: string;
  sourceDoc: string;
  shiftName: string;
  schedule: ShiftSchedule;
  startTime: string;
  endTime: string;
  lateGraceMinutes: number;
  exceptionType: string;
  active: boolean | null;
  coreResolvedShift: CoreResolvedShift | null;
  recordResolvedShift: CoreResolvedShift | null;
  coreResolvedShiftPresent: boolean;
  recordResolvedShiftPresent: boolean;
  fallbackUsed: boolean;
  fallbackSource: string;
  isOff: boolean;
  calculationTime: string;
};

export type ResolvedAttendanceDay = {
  shiftResolution: AttendanceShiftResolution;
  schedule: ShiftSchedule;
  computation: AttendanceDayComputation;
  status: AttendanceStatus;
};

function cleanText(value: unknown) {
  return String(value || "").trim();
}

export function cleanAttendanceTime(value: unknown) {
  const raw = cleanText(value);
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function readPolicyMinutes(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return Math.round(number);
  }
  return undefined;
}

function readPolicyFlag(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    return value === true || value === 1 || value === "1" || value === "true";
  }
  return false;
}

function readActiveState(value: unknown): boolean | null {
  if (value === null || value === undefined || value === "") return null;
  if (value === true || value === 1 || value === "1" || value === "true") return true;
  if (value === false || value === 0 || value === "0" || value === "false") return false;
  return null;
}

export function normalizeAttendanceDateKey(value: unknown) {
  const raw = cleanText(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function normalizeAttendanceMonthKey(value: unknown) {
  const raw = cleanText(value);
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function attendanceMonthDateKeys(monthKey: string) {
  const normalized = normalizeAttendanceMonthKey(monthKey);
  if (!normalized) return [];
  const [year, month] = normalized.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: lastDay }, (_, index) => `${normalized}-${String(index + 1).padStart(2, "0")}`);
}

function parseJsonObject(value: unknown) {
  const raw = cleanText(value);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function sourceDocOf(row?: Record<string, unknown> | null) {
  if (!row) return "";
  return cleanText(
    row.sourceDoc ||
      row.source_doc ||
      row.sourceId ||
      row.source_id ||
      row.assignmentId ||
      row.assignment_id ||
      row.exceptionId ||
      row.exception_id ||
      row.shiftTemplateId ||
      row.shift_template_id ||
      row.id
  );
}

function sourceTypeOf(row?: Record<string, unknown> | null) {
  if (!row) return "";
  return cleanText(row.sourceType || row.source_type || row.source);
}

export function attendanceResolvedShiftSourceLabel(row?: CoreResolvedShift | null) {
  const source = cleanText((row as Record<string, unknown> | undefined)?.source).toLowerCase();
  const exceptionType = cleanText(
    (row as Record<string, unknown> | undefined)?.exceptionType ||
      (row as Record<string, unknown> | undefined)?.exception_type
  ).toLowerCase();
  if (!source) return "غير موجود";
  if (source === "none") return "Core: لا يوجد شفت";
  if (source === "weekly_rest_work_assignment") {
    return "عمل استثنائي في يوم الراحة";
  }
  if (source === "exception") {
    if (exceptionType === "off") return "استثناء: يوم راحة";
    if (exceptionType === "custom") return "استثناء: وقت مخصص";
    return "استثناء: شفت بديل";
  }
  if (source === "assignment") return "شفت منشور";
  if (source === "weekly_schedule") return "جدول أسبوعي من Core";
  if (source === "attendance_record") return "سجل البصمة";
  return "Core";
}

export function attendanceResolvedShiftName(row?: CoreResolvedShift | null) {
  const snapshot = parseJsonObject((row as Record<string, unknown> | undefined)?.snapshotJson || (row as Record<string, unknown> | undefined)?.snapshot_json);
  return (
    cleanText((row as Record<string, unknown> | undefined)?.shiftName || (row as Record<string, unknown> | undefined)?.shift_name) ||
    cleanText(snapshot.name) ||
    cleanText(snapshot.code) ||
    (isAttendanceResolvedShiftOff(row) ? "يوم راحة" : attendanceResolvedShiftSourceLabel(row))
  );
}

export function isAttendanceResolvedShiftOff(row?: CoreResolvedShift | null) {
  const source = cleanText((row as Record<string, unknown> | undefined)?.source).toLowerCase();
  const exceptionType = cleanText(
    (row as Record<string, unknown> | undefined)?.exceptionType ||
      (row as Record<string, unknown> | undefined)?.exception_type
  ).toLowerCase();
  if (exceptionType === "off" || source === "none") return true;
  if (source === "weekly_schedule") {
    const active = readActiveState((row as Record<string, unknown> | undefined)?.active);
    return active === false;
  }
  return false;
}

export function attendanceResolvedShiftWindow(row?: CoreResolvedShift | null) {
  if (!row) return null;
  if (isAttendanceResolvedShiftOff(row)) {
    return {
      startTime: "",
      endTime: "",
      lateGraceMinutes: 0,
      earlyLeaveGraceMinutes: 0,
      attendanceLockEnabled: false,
      attendanceLockAfterMinutes: 0,
      isOff: true,
    };
  }

  const source = cleanText((row as Record<string, unknown>).source).toLowerCase();
  if (!source) return null;

  const snapshot = parseJsonObject((row as Record<string, unknown>).snapshotJson || (row as Record<string, unknown>).snapshot_json);
  const startTime =
    cleanAttendanceTime((row as Record<string, unknown>).templateStartTime) ||
    cleanAttendanceTime((row as Record<string, unknown>).template_start_time) ||
    cleanAttendanceTime((row as Record<string, unknown>).startTime) ||
    cleanAttendanceTime((row as Record<string, unknown>).start_time) ||
    cleanAttendanceTime(snapshot.startTime) ||
    cleanAttendanceTime(snapshot.start_time);
  const endTime =
    cleanAttendanceTime((row as Record<string, unknown>).templateEndTime) ||
    cleanAttendanceTime((row as Record<string, unknown>).template_end_time) ||
    cleanAttendanceTime((row as Record<string, unknown>).endTime) ||
    cleanAttendanceTime((row as Record<string, unknown>).end_time) ||
    cleanAttendanceTime(snapshot.endTime) ||
    cleanAttendanceTime(snapshot.end_time);
  if (!startTime || !endTime) return null;

  return {
    startTime,
    endTime,
    lateGraceMinutes: readPolicyMinutes(
      (row as Record<string, unknown>).lateGraceMinutes,
      (row as Record<string, unknown>).late_grace_minutes,
      snapshot.lateGraceMinutes,
      snapshot.late_grace_minutes
    ) || 0,
    earlyLeaveGraceMinutes: 0,
    attendanceLockEnabled: readPolicyFlag(
      (row as Record<string, unknown>).attendanceLockEnabled,
      (row as Record<string, unknown>).attendance_lock_enabled,
      snapshot.attendanceLockEnabled,
      snapshot.attendance_lock_enabled
    ),
    attendanceLockAfterMinutes: readPolicyMinutes(
      (row as Record<string, unknown>).attendanceLockAfterMinutes,
      (row as Record<string, unknown>).attendance_lock_after_minutes,
      snapshot.attendanceLockAfterMinutes,
      snapshot.attendance_lock_after_minutes
    ) || 0,
    isOff: false,
  };
}

export function attendanceResolvedShiftFromRow(row?: Record<string, unknown> | null): CoreResolvedShift | null {
  if (!row) return null;
  const nested = row.resolvedShift && typeof row.resolvedShift === "object"
    ? { ...(row.resolvedShift as Record<string, unknown>) }
    : {};
  const directFields = {
    source: cleanText(nested.source) || "attendance_record",
    shiftName: cleanText(nested.shiftName || nested.shift_name || row.shiftName || row.shift_name),
    startTime: cleanAttendanceTime(nested.startTime || nested.start_time || row.shiftStartTime || row.shift_start_time),
    endTime: cleanAttendanceTime(nested.endTime || nested.end_time || row.shiftEndTime || row.shift_end_time),
    templateStartTime: cleanAttendanceTime(nested.templateStartTime || nested.template_start_time || row.shiftStartTime || row.shift_start_time),
    templateEndTime: cleanAttendanceTime(nested.templateEndTime || nested.template_end_time || row.shiftEndTime || row.shift_end_time),
    lateGraceMinutes: readPolicyMinutes(nested.lateGraceMinutes, nested.late_grace_minutes, row.lateGraceMinutes, row.late_grace_minutes),
    snapshotJson: cleanText(nested.snapshotJson || nested.snapshot_json || row.shiftSnapshotJson || row.snapshotJson),
    exceptionType: cleanText(nested.exceptionType || nested.exception_type),
    active: nested.active ?? row.active,
    sourceDoc: sourceDocOf(nested) || sourceDocOf(row),
    sourceType: sourceTypeOf(nested) || sourceTypeOf(row) || "attendance_record",
  };
  const hasNested = Object.keys(nested).length > 0;
  const hasDirectWindow = Boolean(directFields.startTime || directFields.endTime || directFields.snapshotJson);
  if (!hasNested && !hasDirectWindow) return null;
  return {
    ...nested,
    ...Object.fromEntries(Object.entries(directFields).filter(([, value]) => value !== "" && value !== undefined)),
  } as CoreResolvedShift;
}

function scheduleFromResolvedShift(dateKey: string, row: CoreResolvedShift | null) {
  const window = attendanceResolvedShiftWindow(row);
  if (!row || !window) return null;
  const exceptionType = cleanText((row as Record<string, unknown>).exceptionType || (row as Record<string, unknown>).exception_type).toLowerCase();
  const active = readActiveState((row as Record<string, unknown>).active);
  if (window.isOff) {
    return {
      schedule: {
        startTime: "",
        endTime: "",
        lateGraceMinutes: 0,
        earlyLeaveGraceMinutes: 0,
        attendanceLockEnabled: false,
        attendanceLockAfterMinutes: 0,
        weeklyOffDays: [],
      },
      startTime: "",
      endTime: "",
      lateGraceMinutes: 0,
      exceptionType,
      active,
      isOff: true,
    };
  }

  return {
    schedule: {
      startTime: window.startTime,
      endTime: window.endTime,
      lateGraceMinutes: window.lateGraceMinutes,
      earlyLeaveGraceMinutes: 0,
      attendanceLockEnabled: window.attendanceLockEnabled,
      attendanceLockAfterMinutes: window.attendanceLockAfterMinutes,
      weeklyOffDays: [],
    },
    startTime: window.startTime,
    endTime: window.endTime,
    lateGraceMinutes: window.lateGraceMinutes,
    exceptionType,
    active,
    isOff: false,
  };
}

function buildResolution(input: {
  dateKey: string;
  source: AttendanceShiftResolutionSource;
  sourceLabel: string;
  sourceDetail: string;
  sourceType: string;
  sourceDoc: string;
  shiftName: string;
  schedule: ShiftSchedule;
  startTime: string;
  endTime: string;
  lateGraceMinutes: number;
  exceptionType?: string;
  active?: boolean | null;
  coreResolvedShift: CoreResolvedShift | null;
  recordResolvedShift: CoreResolvedShift | null;
  fallbackUsed: boolean;
  fallbackSource?: string;
  isOff: boolean;
  calculationTime?: string;
}): AttendanceShiftResolution {
  return {
    dateKey: input.dateKey,
    source: input.source,
    sourceLabel: input.sourceLabel,
    sourceDetail: input.sourceDetail,
    sourceType: input.sourceType,
    sourceDoc: input.sourceDoc,
    shiftName: input.shiftName,
    schedule: input.schedule,
    startTime: input.startTime,
    endTime: input.endTime,
    lateGraceMinutes: input.lateGraceMinutes,
    exceptionType: input.exceptionType || "",
    active: input.active ?? null,
    coreResolvedShift: input.coreResolvedShift,
    recordResolvedShift: input.recordResolvedShift,
    coreResolvedShiftPresent: Boolean(input.coreResolvedShift),
    recordResolvedShiftPresent: Boolean(input.recordResolvedShift),
    fallbackUsed: input.fallbackUsed,
    fallbackSource: input.fallbackSource || "",
    isOff: input.isOff,
    calculationTime: input.calculationTime || new Date().toISOString(),
  };
}

export function resolveAttendanceShiftForDate(input: {
  dateKey: string;
  row?: Record<string, unknown> | null;
  coreResolvedShift?: CoreResolvedShift | null;
  calculationTime?: string;
}): AttendanceShiftResolution {
  const dateKey =
    normalizeAttendanceDateKey(
      input.dateKey
    );

  /*
   * Audit metadata only.
   * A shift snapshot stored on an attendance record
   * must never become the operational schedule.
   */
  const recordResolvedShift =
    attendanceResolvedShiftFromRow(
      input.row
    );

  const coreResolvedShift =
    input.coreResolvedShift || null;

  const coreSchedule =
    scheduleFromResolvedShift(
      dateKey,
      coreResolvedShift
    );

  if (coreSchedule) {
    return buildResolution({
      dateKey,
      source:
        "core_resolved_shift",
      sourceLabel:
        attendanceResolvedShiftSourceLabel(
          coreResolvedShift
        ),
      sourceDetail:
        "CoreHrService.resolveEmployeeShift",
      sourceType:
        sourceTypeOf(
          coreResolvedShift
        ) ||
        cleanText(
          coreResolvedShift?.source
        ) ||
        "core",
      sourceDoc:
        sourceDocOf(
          coreResolvedShift
        ),
      shiftName:
        attendanceResolvedShiftName(
          coreResolvedShift
        ),
      schedule:
        coreSchedule.schedule,
      startTime:
        coreSchedule.startTime,
      endTime:
        coreSchedule.endTime,
      lateGraceMinutes:
        coreSchedule.lateGraceMinutes,
      exceptionType:
        coreSchedule.exceptionType,
      active:
        coreSchedule.active,
      coreResolvedShift,
      recordResolvedShift,
      fallbackUsed: false,
      fallbackSource: "",
      isOff:
        coreSchedule.isOff,
      calculationTime:
        input.calculationTime,
    });
  }

  /*
   * Fail closed.
   * Missing/incomplete Core data is NOT interpreted as:
   * - attendance record snapshot
   * - historical schedule
   * - employee profile schedule
   * - default 09:00-17:00
   */
  return buildResolution({
    dateKey,
    source:
      "core_unavailable",
    sourceLabel:
      "\u0627\u0644\u062f\u0648\u0627\u0645 \u0627\u0644\u0645\u0639\u062a\u0645\u062f \u063a\u064a\u0631 \u0645\u062a\u0627\u062d",
    sourceDetail:
      "Core resolved shift missing or incomplete",
    sourceType:
      "core_unavailable",
    sourceDoc: "",
    shiftName:
      "\u063a\u064a\u0631 \u0645\u062a\u0627\u062d",
    schedule: {
      startTime: "",
      endTime: "",
      lateGraceMinutes: 0,
      earlyLeaveGraceMinutes: 0,
      attendanceLockEnabled: false,
      attendanceLockAfterMinutes: 0,
      weeklyOffDays: [],
    },
    startTime: "",
    endTime: "",
    lateGraceMinutes: 0,
    exceptionType: "",
    active: null,
    coreResolvedShift,
    recordResolvedShift,
    fallbackUsed: false,
    fallbackSource: "",
    isOff: false,
    calculationTime:
      input.calculationTime,
  });
}

function riyadhIsoFromDateAndTime(dateKey: string, value: string) {
  const time = cleanAttendanceTime(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!time || !match) return "";
  const [hour, minute] = time.split(":").map(Number);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour - 3, minute, 0, 0)).toISOString();
}

function attendanceServerTime(dateKey: string, value: unknown) {
  const raw = cleanText(value);
  if (!raw) return "";
  if (cleanAttendanceTime(raw)) return riyadhIsoFromDateAndTime(dateKey, raw);
  return Number.isFinite(Date.parse(raw)) ? raw : "";
}

export function recordsFromAttendanceRow(row?: Record<string, unknown> | null): AttendanceRecord[] {
  const source = row || {};
  const dateKey = normalizeAttendanceDateKey(source.date || source.dateKey || source.dayKey);
  const rawRecords = Array.isArray(source.records) ? (source.records as Record<string, unknown>[]) : [];
  if (rawRecords.length) {
    return rawRecords
      .map((record, index) => ({
        id: cleanText(record.id) || `${cleanText(source.id) || dateKey || "record"}-${index}`,
        type: cleanText(record.type || record.recordType || record.record_type) || "record",
        serverTime: attendanceServerTime(dateKey, record.serverTime || record.recordedAt || record.clientTime),
        location: record.location,
        result: record.result,
        zoneName: record.zoneName,
        zoneId: record.zoneId,
        distanceMeters: record.distanceMeters,
      }))
      .filter((record) => record.serverTime)
      .sort((left, right) => Date.parse(left.serverTime || "") - Date.parse(right.serverTime || ""));
  }

  const records: AttendanceRecord[] = [];
  const rowId = cleanText(source.id) || dateKey || "attendance";
  const checkInAt = attendanceServerTime(dateKey, source.checkInAtClient || source.checkInAt || source.checkInTime);
  const checkOutAt = attendanceServerTime(dateKey, source.checkOutAtClient || source.checkOutAt || source.checkOutTime);
  if (checkInAt) records.push({ id: `${rowId}-in`, type: "check_in", serverTime: checkInAt });
  if (checkOutAt) records.push({ id: `${rowId}-out`, type: "check_out", serverTime: checkOutAt });
  return records;
}

function riyadhTodayDateKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function computeResolvedAttendanceDay(input: {
  dateKey: string;
  row?: Record<string, unknown> | null;
  records?: AttendanceRecord[];
  coreResolvedShift?: CoreResolvedShift | null;
  permissionIntervals?: PermissionIntervalInput[];
  permissionEntries?: unknown[];
  todayDateKey?: string;
  approvedLeaveDateKeys?: Set<string> | Iterable<string>;
  absenceDateKeys?: Set<string> | Iterable<string>;
  calculationTime?: string;
}): ResolvedAttendanceDay {
  const dateKey =
    normalizeAttendanceDateKey(
      input.dateKey
    );

  const records =
    input.records ||
    recordsFromAttendanceRow(
      input.row
    );

  const shiftResolution =
    resolveAttendanceShiftForDate({
      dateKey,
      row: input.row,
      coreResolvedShift:
        input.coreResolvedShift,
      calculationTime:
        input.calculationTime,
    });

  const permissionIntervals =
    input.permissionIntervals ||
    (
      input.permissionEntries
        ? permissionIntervalsFromRequests(
            input.permissionEntries as
              Array<Record<string, unknown>>,
            dateKey
          )
        : undefined
    );

  const computation =
    computeAttendanceDay(
      dateKey,
      records,
      shiftResolution.schedule,
      permissionIntervals
    );

  const resolvedStatus =
    getAttendanceDayStatus({
      date: dateKey,
      hasAttendance:
        records.length > 0,
      checkOut:
        computation.checkOut,
      computation,
      todayDateKey:
        input.todayDateKey ||
        riyadhTodayDateKey(),
      weeklyOffDays:
        shiftResolution.schedule.weeklyOffDays,
      approvedLeaveDateKeys:
        input.approvedLeaveDateKeys,
      holidayDateKeys:
        shiftResolution.isOff
          ? [dateKey]
          : [],
      absenceDateKeys:
        input.absenceDateKeys,
    });

  /*
   * Leave and explicit absence are independent canonical facts.
   * Missing scheduling must never erase them.
   *
   * For every other status, missing/incomplete Core scheduling
   * fails closed as schedule_unavailable.
   */
  const status: AttendanceStatus =
    shiftResolution.source ===
      "core_unavailable" &&
    resolvedStatus !== "leave" &&
    resolvedStatus !== "absent"
      ? "schedule_unavailable"
      : resolvedStatus;

  return {
    shiftResolution,
    schedule:
      shiftResolution.schedule,
    computation,
    status,
  };
}

function scheduleDateTimeMs(dateKey: string, value: unknown) {
  const time = cleanAttendanceTime(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!time || !match) return null;
  const [hour, minute] = time.split(":").map(Number);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour - 3, minute, 0, 0);
}

export function computeAttendanceEarlyLeaveMinutes(input: {
  dateKey: string;
  records: AttendanceRecord[];
  schedule: ShiftSchedule;
}) {
  const sorted = [...input.records].sort(
    (left, right) => Date.parse(left.serverTime || "") - Date.parse(right.serverTime || "")
  );
  const checkOut = [...sorted].reverse().find((record) => record.type === "check_out") || null;
  if (!checkOut?.serverTime) return 0;

  const scheduleStartMs = scheduleDateTimeMs(input.dateKey, input.schedule.startTime);
  let scheduleEndMs = scheduleDateTimeMs(input.dateKey, input.schedule.endTime);
  if (scheduleStartMs === null || scheduleEndMs === null) return 0;
  if (scheduleEndMs <= scheduleStartMs) scheduleEndMs += 24 * 60 * 60 * 1000;

  const checkOutMs = Date.parse(checkOut.serverTime);
  if (!Number.isFinite(checkOutMs)) return 0;
  return Math.max(0, Math.round((scheduleEndMs - checkOutMs) / 60000));
}
