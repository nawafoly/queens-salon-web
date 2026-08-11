import { useEffect, useMemo, useState } from "react";

import type { StaffAttendanceWithId } from "../../services/firestoreAttendance";
import { CoreHrService } from "../../services/CoreHrService";
import { clearAttendancePunchTimeFromWorker } from "../../services/attendancePunchAdminService";
import type { CoreResolvedShift } from "../../types/hrCoreApi";
import {
  computeAttendanceDay,
  type AttendanceRecord,
  type ShiftSchedule,
} from "../../helpers/hr/attendanceCalculations";
import { resolveStaffScheduleVersionForDate, weeklyOffDaysFromScheduleSnapshot } from "../../helpers/hr/staffScheduleHistory";
import type { AttendanceSpecialDay } from "../../helpers/hr/attendanceCalendarData";
import {
  EmployeeAttendanceTabLiveV2,
  type EmployeeAttendanceRowLiveV2,
  type EmployeeAttendanceShiftInfoLiveV2,
} from "../../components/dashboard-v2/employee-workspace/live";

const RESOLVED_SHIFT_CACHE: Record<string, CoreResolvedShift | null> = {};
const RESOLVED_SHIFT_PENDING: Record<string, Promise<CoreResolvedShift | null> | undefined> = {};
const LABEL_EXCEPTION_OFF = "\u0631\u0627\u062d\u0629 / \u064a\u0648\u0645 \u0627\u0633\u062a\u062b\u0646\u0627\u0626\u064a";

type AttendanceSectionProps = {
  isVisible: boolean;
  loading: boolean;
  error?: string;
  rows: StaffAttendanceWithId[];
  monthKey: string;
  selectedDate: string;
  schedule?: Record<string, unknown> | null;
  salonBusinessHours?: Record<string, unknown> | null;
  employeeId?: string;
  employeeIds?: string[];
  approvedLeaveDateKeys?: string[];
  specialDays?: AttendanceSpecialDay[];
  canEdit?: boolean;
  canDelete?: boolean;
  canReview?: boolean;
  canCreateEmergencyLeave?: boolean;
  canCancelLeave?: boolean;
  onMonthChange: (monthKey: string) => void;
  onSelectedDateChange: (dateKey: string) => void;
  onReload: () => void;
  onEditPunch: (dateKey: string) => void;
  onDeletePunch: (dateKey: string) => void;
  onCreateEmergencyLeave?: (dateKey: string) => void;
  onCancelLeave?: (dateKey: string) => void;
};

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function uniqueCleanTexts(values: unknown[]) {
  return Array.from(new Set(values.map(cleanText).filter(Boolean)));
}

function resolvedShiftRank(row?: CoreResolvedShift | null) {
  const source = cleanText(row?.source).toLowerCase();
  const exceptionType = cleanText(row?.exceptionType || row?.exception_type).toLowerCase();
  if (source === "exception" && exceptionType === "off") return 5;
  if (source === "exception") return 4;
  if (source === "assignment") return 3;
  if (source && source !== "none") return 2;
  return 0;
}

function pickBestResolvedShift(rows: Array<CoreResolvedShift | null | undefined>) {
  return rows
    .filter(Boolean)
    .sort((left, right) => resolvedShiftRank(right) - resolvedShiftRank(left))[0] || null;
}


const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const WEEKDAY_TO_OFF_KEY: Record<(typeof WEEKDAY_KEYS)[number], string> = {
  sun: "sunday",
  mon: "monday",
  tue: "tuesday",
  wed: "wednesday",
  thu: "thursday",
  fri: "friday",
  sat: "saturday",
};

function cleanTime(value: unknown) {
  const raw = cleanText(value);
  const match = /^(\d{1,2}):(\d{2})$/.exec(raw);
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function weekdayKeyForDate(dateKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return "sun";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return WEEKDAY_KEYS[date.getUTCDay()] || "sun";
}

function readPolicyMinutes(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return Math.round(number);
  }
  return undefined;
}

function getDayOverride(dateKey: string, input: Record<string, unknown>) {
  const candidates = [
    input.customWorkingHourOverrides,
    input.workingHourOverrides,
    input.workHourOverrides,
  ];
  for (const value of candidates) {
    const overrides = Array.isArray(value) ? value : [];
    const match = overrides.find((override) => cleanText((override as Record<string, unknown>).date) === dateKey);
    if (match) return match as Record<string, unknown>;
  }
  return null;
}

function isDateKey(value: unknown) {
  return /^\d{4}-\d{2}-\d{2}$/.test(cleanText(value));
}

function normalizeDateKey(value: unknown) {
  const raw = cleanText(value);
  if (isDateKey(raw)) return raw;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}
function normalizeMonthKey(value: unknown) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthDateKeys(monthKey: string) {
  const normalized = normalizeMonthKey(monthKey);
  if (!normalized) return [];
  const [year, month] = normalized.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: lastDay }, (_, index) => `${normalized}-${String(index + 1).padStart(2, "0")}`);
}
function isDateInsideRange(dateKey: string, fromValue: unknown, toValue: unknown) {
  const fromDate = normalizeDateKey(fromValue);
  const toDate = normalizeDateKey(toValue) || fromDate;
  if (!dateKey || !fromDate || !toDate) return false;
  return dateKey >= fromDate && dateKey <= toDate;
}

function isProfileOnLeave(dateKey: string, profile?: Record<string, unknown> | null) {
  const source = profile || {};
  if (!dateKey) return false;
  if (Array.isArray(source.exceptionalLeaveDates) && source.exceptionalLeaveDates.some((date) => normalizeDateKey(date) === dateKey)) {
    return true;
  }
  if (source.onLeave) {
    const fromDate = normalizeDateKey(source.leaveStartDate || source.leaveFrom || source.leaveFromDate) || dateKey;
    const toDate = normalizeDateKey(source.leaveUntil || source.leaveTo || source.leaveToDate) || fromDate;
    return dateKey >= fromDate && dateKey <= toDate;
  }
  return false;
}

function resolveAttendanceSchedule(dateKey: string, schedule?: Record<string, unknown> | null): ShiftSchedule {
  const profile = schedule || {};
  const historicalVersion = resolveStaffScheduleVersionForDate(profile.workingScheduleVersions, dateKey);
  const effectiveSource: Record<string, unknown> = historicalVersion
    ? {
        ...profile,
        useCustomWorkingHours: historicalVersion.useCustomWorkingHours,
        customWorkingHours: historicalVersion.customWorkingHours,
      }
    : profile;
  const weekdayKey = weekdayKeyForDate(dateKey);
  const useCustomWorkingHours = historicalVersion
    ? historicalVersion.useCustomWorkingHours
    : effectiveSource.useCustomWorkingHours === true;
  const customHours = (effectiveSource.customWorkingHours || {}) as Record<string, { enabled?: boolean; start?: string; end?: string }>;
  const customDay = useCustomWorkingHours ? customHours[weekdayKey] : undefined;
  const override = getDayOverride(dateKey, profile);
  const customOffDays = useCustomWorkingHours
    ? Object.entries(customHours)
        .filter(([, day]) => day?.enabled === false)
        .map(([key]) => WEEKDAY_TO_OFF_KEY[key as keyof typeof WEEKDAY_TO_OFF_KEY])
        .filter(Boolean)
    : [];
  const explicitOffDays = historicalVersion
    ? weeklyOffDaysFromScheduleSnapshot({
        useCustomWorkingHours: historicalVersion.useCustomWorkingHours,
        customWorkingHours: historicalVersion.customWorkingHours,
      })
    : [
        ...(Array.isArray(effectiveSource.weeklyOffDays) ? effectiveSource.weeklyOffDays : []),
        ...(Array.isArray(effectiveSource.offDays) ? effectiveSource.offDays : []),
        ...(Array.isArray(effectiveSource.exceptionalLeaveWeekdays) ? effectiveSource.exceptionalLeaveWeekdays : []),
        ...(effectiveSource.weeklyOffDay ? [effectiveSource.weeklyOffDay] : []),
      ];

  if (override?.enabled === false || customDay?.enabled === false) {
    return {
      startTime: "",
      endTime: "",
      lateGraceMinutes: readPolicyMinutes(effectiveSource.lateGraceMinutes, effectiveSource.late_grace_minutes),
      earlyLeaveGraceMinutes: 0,
      weeklyOffDays: [...explicitOffDays, ...customOffDays],
    };
  }

  return {
    startTime:
      cleanTime(override?.start) ||
      cleanTime(customDay?.start) ||
      cleanTime(effectiveSource.startTime) ||
      cleanTime(effectiveSource.start) ||
      cleanTime(effectiveSource.workStartTime) ||
      cleanTime(effectiveSource.shiftStartTime) ||
      "09:00",
    endTime:
      cleanTime(override?.end) ||
      cleanTime(customDay?.end) ||
      cleanTime(effectiveSource.endTime) ||
      cleanTime(effectiveSource.end) ||
      cleanTime(effectiveSource.workEndTime) ||
      cleanTime(effectiveSource.shiftEndTime) ||
      "17:00",
    lateGraceMinutes: readPolicyMinutes(effectiveSource.lateGraceMinutes, effectiveSource.late_grace_minutes),
    earlyLeaveGraceMinutes: 0,
    weeklyOffDays: [...explicitOffDays, ...customOffDays],
  };
}

function parseSnapshot(value: unknown) {
  const raw = cleanText(value);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function resolvedShiftRecord(record: Record<string, unknown>) {
  return record.resolvedShift && typeof record.resolvedShift === "object"
    ? (record.resolvedShift as Record<string, unknown>)
    : {};
}

function isResolvedShiftOff(value?: Record<string, unknown> | CoreResolvedShift | null) {
  const row = value || {};
  return cleanText((row as Record<string, unknown>).exceptionType || (row as Record<string, unknown>).exception_type).toLowerCase() === "off";
}

function specialDayPriority(day?: AttendanceSpecialDay | null) {
  if (!day) return 0;
  if (day.kind === "leave" || day.kind === "rest") return 40;
  if (day.kind === "exception_off") return 30;
  if (day.kind === "weekly_off") return 20;
  return 0;
}

function resolveRecordShiftSchedule(record: Record<string, unknown>): ShiftSchedule | null {
  const resolvedShift = resolvedShiftRecord(record);
  const snapshot = parseSnapshot(resolvedShift.snapshotJson || resolvedShift.snapshot_json || record.shiftSnapshotJson || record.snapshotJson);
  const exceptionType = cleanText(resolvedShift.exceptionType || resolvedShift.exception_type);
  if (exceptionType === "off") return null;

  const startTime =
    cleanTime(record.shiftStartTime) ||
    cleanTime(resolvedShift.startTime) ||
    cleanTime(resolvedShift.start_time) ||
    cleanTime(resolvedShift.templateStartTime) ||
    cleanTime(resolvedShift.template_start_time) ||
    cleanTime(snapshot.startTime) ||
    cleanTime(snapshot.start_time);
  const endTime =
    cleanTime(record.shiftEndTime) ||
    cleanTime(resolvedShift.endTime) ||
    cleanTime(resolvedShift.end_time) ||
    cleanTime(resolvedShift.templateEndTime) ||
    cleanTime(resolvedShift.template_end_time) ||
    cleanTime(snapshot.endTime) ||
    cleanTime(snapshot.end_time);
  if (!startTime && !endTime) return null;

  return {
    startTime: startTime || "09:00",
    endTime: endTime || "17:00",
    lateGraceMinutes: readPolicyMinutes(
      record.lateGraceMinutes,
      resolvedShift.lateGraceMinutes,
      resolvedShift.late_grace_minutes,
      snapshot.lateGraceMinutes,
      snapshot.late_grace_minutes
    ),
    earlyLeaveGraceMinutes: 0,
    weeklyOffDays: [],
  };
}

function resolveEffectiveAttendanceSchedule(
  dateKey: string,
  row: Record<string, unknown>,
  schedule?: Record<string, unknown> | null
) {
  return resolveRecordShiftSchedule(row) || resolveAttendanceSchedule(dateKey, schedule);
}

function riyadhIsoFromDateAndTime(dateKey: string, value: string) {
  const time = cleanTime(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!time || !match) return "";
  const [hour, minute] = time.split(":").map(Number);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour - 3, minute, 0, 0)).toISOString();
}

function attendanceServerTime(dateKey: string, value: unknown) {
  const raw = cleanText(value);
  if (!raw) return "";
  if (cleanTime(raw)) return riyadhIsoFromDateAndTime(dateKey, raw);
  return Number.isFinite(Date.parse(raw)) ? raw : "";
}

function scheduleDateTimeMs(dateKey: string, value: unknown) {
  const time = cleanTime(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!time || !match) return null;
  const [hour, minute] = time.split(":").map(Number);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour - 3, minute, 0, 0);
}

function computeLateMinutes(row: Record<string, unknown>, date: string, schedule?: Record<string, unknown> | null) {
  const explicitLate = Number(row.lateMinutes || 0);
  if (Number.isFinite(explicitLate) && explicitLate > 0) return Math.round(explicitLate);

  const checkInAt = attendanceServerTime(date, row.checkInAtClient || row.checkInAt || row.checkInTime);
  const checkOutAt = attendanceServerTime(date, row.checkOutAtClient || row.checkOutAt || row.checkOutTime);
  if (!checkInAt) return 0;

  const records: AttendanceRecord[] = [
    { id: `${date}-in`, type: "check_in", serverTime: checkInAt },
    ...(checkOutAt ? [{ id: `${date}-out`, type: "check_out", serverTime: checkOutAt }] : []),
  ];
  const computation = computeAttendanceDay(date, records, resolveEffectiveAttendanceSchedule(date, row, schedule));
  return Math.max(0, Math.round(computation.lateHours * 60));
}

function computeEarlyLeaveMinutes(row: Record<string, unknown>, date: string, schedule?: Record<string, unknown> | null) {
  const explicitEarlyLeave = Number(row.earlyLeaveMinutes || 0);
  if (Number.isFinite(explicitEarlyLeave) && explicitEarlyLeave > 0) return Math.round(explicitEarlyLeave);

  const checkOutAt = attendanceServerTime(date, row.checkOutAtClient || row.checkOutAt || row.checkOutTime);
  if (!checkOutAt) return 0;

  const resolvedSchedule = resolveEffectiveAttendanceSchedule(date, row, schedule);
  const scheduleStartMs = scheduleDateTimeMs(date, resolvedSchedule.startTime);
  let scheduleEndMs = scheduleDateTimeMs(date, resolvedSchedule.endTime);
  if (scheduleStartMs === null || scheduleEndMs === null) return 0;
  if (scheduleEndMs <= scheduleStartMs) scheduleEndMs += 24 * 60 * 60 * 1000;

  const checkOutMs = Date.parse(checkOutAt);
  if (!Number.isFinite(checkOutMs)) return 0;

  const earlyLeaveMinutes = Math.round((scheduleEndMs - checkOutMs) / 60000);
  return Math.max(0, earlyLeaveMinutes);
}

function readCoreShiftWindow(row?: CoreResolvedShift | null) {
  const source = (row || {}) as Record<string, unknown>;
  const snapshot = parseSnapshot(source.snapshotJson || source.snapshot_json);
  const startTime =
    cleanTime(source.startTime) ||
    cleanTime(source.start_time) ||
    cleanTime(source.templateStartTime) ||
    cleanTime(source.template_start_time) ||
    cleanTime(snapshot.startTime) ||
    cleanTime(snapshot.start_time);
  const endTime =
    cleanTime(source.endTime) ||
    cleanTime(source.end_time) ||
    cleanTime(source.templateEndTime) ||
    cleanTime(source.template_end_time) ||
    cleanTime(snapshot.endTime) ||
    cleanTime(snapshot.end_time);
  return { startTime, endTime };
}

function windowLabel(startTime?: string, endTime?: string) {
  if (!startTime && !endTime) return "مغلق اليوم";
  return `${startTime || "--:--"} - ${endTime || "--:--"}`;
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function timeToMinutes(value: string) {
  const time = cleanTime(value);
  if (!time) return null;
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function activeStatusForWindow(dateKey: string, startTime?: string, endTime?: string) {
  if (!startTime && !endTime) return "مغلق اليوم";
  const today = localDateKey();
  if (dateKey !== today) return "مجدول";
  const start = timeToMinutes(startTime || "");
  const end = timeToMinutes(endTime || "");
  if (start === null || end === null) return "مجدول";
  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  const inside = end <= start ? current >= start || current <= end : current >= start && current <= end;
  return inside ? "تعمل الآن" : "خارج الدوام";
}

function resolveSalonSchedule(dateKey: string, salonBusinessHours?: Record<string, unknown> | null): ShiftSchedule | null {
  const day = weekdayKeyForDate(dateKey);
  const source = (salonBusinessHours || {}) as Record<string, unknown>;
  const row = source[day] && typeof source[day] === "object" ? (source[day] as Record<string, unknown>) : null;
  if (!row) return null;
  if (row.enabled === false) return { startTime: "", endTime: "", weeklyOffDays: [] };
  return {
    startTime: cleanTime(row.start) || "09:00",
    endTime: cleanTime(row.end) || "17:00",
    weeklyOffDays: [],
  };
}

function employeeScheduleSourceLabel(dateKey: string, schedule?: Record<string, unknown> | null) {
  const profile = schedule || {};
  if (getDayOverride(dateKey, profile)) return "استثناء يومي للموظفة";
  if (resolveStaffScheduleVersionForDate(profile.workingScheduleVersions, dateKey)) return "جدول موظفة بتاريخ فعلي";
  if (profile.useCustomWorkingHours === true) return "جدول دوام الموظفة";
  if (cleanTime(profile.startTime) || cleanTime(profile.workStartTime) || cleanTime(profile.shiftStartTime)) return "جدول دوام الموظفة";
  return "دوام الصالون العام";
}

function coreShiftInfo(dateKey: string, resolvedShift?: CoreResolvedShift | null): EmployeeAttendanceShiftInfoLiveV2 | null {
  if (!resolvedShift) return null;
  const source = cleanText(resolvedShift.source).toLowerCase();
  if (!source || source === "none") return null;
  const exceptionType = cleanText(resolvedShift.exceptionType || resolvedShift.exception_type).toLowerCase();
  const { startTime, endTime } = readCoreShiftWindow(resolvedShift);
  const shiftName = cleanText(resolvedShift.shiftName || resolvedShift.shift_name);
  if (source === "exception") {
    if (exceptionType === "off") {
      return {
        sourceLabel: "استثناء يومي",
        sourceDetail: shiftName || "راحة / إغلاق لهذا اليوم",
        timeLabel: "مغلق اليوم",
        statusLabel: "مغلق اليوم",
        tone: "gold",
      };
    }
    return {
      sourceLabel: "استثناء يومي",
      sourceDetail: shiftName || (exceptionType === "custom" ? "وقت مخصص" : "شفت بديل"),
      timeLabel: windowLabel(startTime, endTime),
      statusLabel: activeStatusForWindow(dateKey, startTime, endTime),
      tone: "gold",
    };
  }
  if (source === "weekly_schedule") {
    if (exceptionType === "off" || Number((resolvedShift as any).active) !== 1) {
      return {
        sourceLabel: "جدول الدوام الأسبوعي",
        sourceDetail: "راحة أسبوعية",
        timeLabel: "مغلق اليوم",
        statusLabel: "راحة أسبوعية",
        tone: "gold",
      };
    }
    return {
      sourceLabel: "جدول الدوام الأسبوعي",
      sourceDetail: shiftName || "شفت اليوم من جدول الموظفة",
      timeLabel: windowLabel(startTime, endTime),
      statusLabel: activeStatusForWindow(dateKey, startTime, endTime),
      tone: "success",
    };
  }
  if (source === "assignment") {
    return {
      sourceLabel: "شفت افتراضي قديم",
      sourceDetail: shiftName || "تعيين احتياطي للموظفات القديمة",
      timeLabel: windowLabel(startTime, endTime),
      statusLabel: activeStatusForWindow(dateKey, startTime, endTime),
      tone: "neutral",
    };
  }
  return null;
}

function recordShiftInfo(dateKey: string, row?: StaffAttendanceWithId | null): EmployeeAttendanceShiftInfoLiveV2 | null {
  if (!row) return null;
  const record = row as StaffAttendanceWithId & Record<string, unknown>;
  const resolvedShift = resolvedShiftRecord(record);
  const source = cleanText(resolvedShift.source).toLowerCase();
  if (!source || source === "none") return null;
  return coreShiftInfo(dateKey, resolvedShift as CoreResolvedShift);
}

function fallbackShiftInfo(input: {
  dateKey: string;
  schedule?: Record<string, unknown> | null;
  salonBusinessHours?: Record<string, unknown> | null;
}): EmployeeAttendanceShiftInfoLiveV2 {
  const { dateKey, schedule, salonBusinessHours } = input;
  const profile = schedule || {};
  const label = employeeScheduleSourceLabel(dateKey, profile);
  const usesEmployeeSchedule = label !== "دوام الصالون العام";
  const resolvedSchedule = usesEmployeeSchedule
    ? resolveAttendanceSchedule(dateKey, profile)
    : resolveSalonSchedule(dateKey, salonBusinessHours) || resolveAttendanceSchedule(dateKey, profile);
  const startTime = cleanTime(resolvedSchedule.startTime);
  const endTime = cleanTime(resolvedSchedule.endTime);
  return {
    sourceLabel: label,
    sourceDetail: usesEmployeeSchedule ? "لا يوجد شفت Core منشور لهذا اليوم" : "لا يوجد شفت خاص؛ تم استخدام ساعات الصالون",
    timeLabel: windowLabel(startTime, endTime),
    statusLabel: activeStatusForWindow(dateKey, startTime, endTime),
    tone: "neutral",
  };
}

function resolveSelectedShiftInfo(input: {
  dateKey: string;
  row?: StaffAttendanceWithId | null;
  schedule?: Record<string, unknown> | null;
  salonBusinessHours?: Record<string, unknown> | null;
  approvedLeaveDateKeys: string[];
  specialDay?: AttendanceSpecialDay | null;
  coreResolvedShift?: CoreResolvedShift | null;
  coreLoading: boolean;
  coreError: string;
}): EmployeeAttendanceShiftInfoLiveV2 {
  const { dateKey, row, schedule, salonBusinessHours, approvedLeaveDateKeys, specialDay, coreResolvedShift, coreLoading, coreError } = input;
  if (specialDay) {
    return {
      sourceLabel: specialDay.label,
      sourceDetail: specialDay.source,
      timeLabel: "\u0645\u063a\u0644\u0642 \u0627\u0644\u064a\u0648\u0645",
      statusLabel: specialDay.label,
      tone: "gold",
    };
  }
  if (approvedLeaveDateKeys.includes(dateKey) || isProfileOnLeave(dateKey, schedule)) {
    return {
      sourceLabel: "إجازة معتمدة",
      sourceDetail: "الإجازة تغلب على الشفت والجدول",
      timeLabel: "مغلق اليوم",
      statusLabel: "في إجازة",
      tone: "gold",
    };
  }
  const coreInfo = coreShiftInfo(dateKey, coreResolvedShift);
  if (coreInfo) return coreInfo;
  const rowInfo = recordShiftInfo(dateKey, row);
  if (rowInfo) return rowInfo;
  const fallback = fallbackShiftInfo({ dateKey, schedule, salonBusinessHours });
  if (coreLoading) {
    return {
      ...fallback,
      sourceDetail: "جاري فحص الشفت المنشور من Core…",
      statusLabel: "جاري التحقق",
      tone: "gold",
    };
  }
  if (coreError) {
    return {
      ...fallback,
      sourceDetail: `${fallback.sourceDetail} — تعذر فحص شفت Core`,
      tone: "gold",
    };
  }
  return fallback;
}

function toLiveAttendanceRow(
  row: StaffAttendanceWithId,
  schedule?: Record<string, unknown> | null
): EmployeeAttendanceRowLiveV2 {
  const record = row as StaffAttendanceWithId & Record<string, unknown>;
  const checkInVerification = (record.checkInVerification || {}) as Record<string, unknown>;
  const checkOutVerification = (record.checkOutVerification || {}) as Record<string, unknown>;
  const records = Array.isArray(record.records)
    ? (record.records as Record<string, unknown>[])
    : [];
  const date = cleanText(record.date || record.dateKey || record.dayKey);
  const resolvedSchedule = date ? resolveEffectiveAttendanceSchedule(date, record, schedule) : null;
  const sourceInfo = date ? recordShiftInfo(date, row) || fallbackShiftInfo({ dateKey: date, schedule }) : null;
  return {
    date,
    status: cleanText(record.status || record.attendanceStatus || record.state),
    checkInAtClient: cleanText(record.checkInAtClient || record.checkInAt || record.checkInTime),
    checkOutAtClient: cleanText(record.checkOutAtClient || record.checkOutAt || record.checkOutTime),
    lateMinutes: date ? computeLateMinutes(record, date, schedule) : Number(record.lateMinutes || 0),
    earlyLeaveMinutes: date ? computeEarlyLeaveMinutes(record, date, schedule) : Number(record.earlyLeaveMinutes || 0),
    shiftName: cleanText(record.shiftName || (record.resolvedShift as Record<string, unknown> | undefined)?.shiftName || (record.resolvedShift as Record<string, unknown> | undefined)?.shift_name || sourceInfo?.sourceDetail),
    shiftSourceLabel: sourceInfo?.sourceLabel,
    shiftStatusLabel: sourceInfo?.statusLabel,
    scheduledStartTime: cleanText(resolvedSchedule?.startTime),
    scheduledEndTime: cleanText(resolvedSchedule?.endTime),
    lateGraceMinutes: Number(resolvedSchedule?.lateGraceMinutes || 0),
    earlyLeaveGraceMinutes: 0,
    notes: cleanText(record.notes || record.note),
    type: cleanText(record.type),
    absentFullDay: record.absentFullDay === true,
    recordCount: records.length,
    workZoneName: cleanText(
      checkInVerification.workZoneName ||
        checkOutVerification.workZoneName ||
        records.find((item) => cleanText(item.zoneName))?.zoneName
    ),
  };
}

export default function AttendanceSection({
  isVisible,
  loading,
  error = "",
  rows,
  monthKey,
  selectedDate,
  schedule = null,
  salonBusinessHours = null,
  employeeId = "",
  employeeIds = [],
  approvedLeaveDateKeys = [],
  specialDays = [],
  canEdit = false,
  canDelete = false,
  canCreateEmergencyLeave = false,
  canCancelLeave = false,
  onMonthChange,
  onSelectedDateChange,
  onReload,
  onEditPunch,
  onDeletePunch,
  onCreateEmergencyLeave,
  onCancelLeave,
}: AttendanceSectionProps) {
  const [coreResolvedShiftsByDate, setCoreResolvedShiftsByDate] = useState<Record<string, CoreResolvedShift | null>>({});
  const [coreShiftLoading, setCoreShiftLoading] = useState(false);
  const [coreShiftError, setCoreShiftError] = useState("");
  const [clearingPunchType, setClearingPunchType] = useState<"check_in" | "check_out" | "">("");
  const [punchClearMessage, setPunchClearMessage] = useState("");
  const [punchClearError, setPunchClearError] = useState("");
  const employeeIdsKey = uniqueCleanTexts([employeeId, ...employeeIds]).join("|");

  useEffect(() => {
    const identityIds = employeeIdsKey.split("|").filter(Boolean);
    const dateKeys = monthDateKeys(monthKey);
    if (!isVisible || !identityIds.length || !dateKeys.length) {
      setCoreResolvedShiftsByDate({});
      setCoreShiftLoading(false);
      setCoreShiftError("");
      return;
    }

    let cancelled = false;
    setCoreShiftLoading(true);
    setCoreShiftError("");

    const request = Promise.all(
      dateKeys.map(async (date) => {
        const resolved = await Promise.all(
          identityIds.map((id) => CoreHrService.resolveEmployeeShift(id, date).catch(() => null))
        );
        return [date, pickBestResolvedShift(resolved)] as const;
      })
    );

    request
      .then((pairs) => {
        if (cancelled) return;
        setCoreResolvedShiftsByDate(Object.fromEntries(pairs));
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("attendance resolved shifts load failed", err);
        setCoreResolvedShiftsByDate({});
        setCoreShiftError("تعذر تحميل شفتات الحضور من Core.");
      })
      .finally(() => {
        if (!cancelled) setCoreShiftLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [employeeIdsKey, isVisible, monthKey]);

  useEffect(() => {
    setPunchClearMessage("");
    setPunchClearError("");
  }, [selectedDate]);

  const liveRows = useMemo(() => rows.map((row) => toLiveAttendanceRow(row, schedule)), [rows, schedule]);
  const rowSpecialDays = useMemo<AttendanceSpecialDay[]>(() => {
    return rows.flatMap((row) => {
      const record = row as StaffAttendanceWithId & Record<string, unknown>;
      const date = cleanText(record.date || record.dateKey || record.dayKey);
      if (!date || !isResolvedShiftOff(resolvedShiftRecord(record))) return [];
      return [{
        date,
        kind: "exception_off" as const,
        label: LABEL_EXCEPTION_OFF,
        source: "attendance_row_core_exception_off",
      }];
    });
  }, [rows]);
  const resolvedCoreSpecialDays = useMemo<AttendanceSpecialDay[]>(() => {
    return Object.entries(coreResolvedShiftsByDate).flatMap(([date, shift]) => {
      if (!date || !isResolvedShiftOff(shift)) return [];
      return [{
        date,
        kind: "exception_off" as const,
        label: LABEL_EXCEPTION_OFF,
        source: "core_exception_off",
      }];
    });
  }, [coreResolvedShiftsByDate]);

  const selectedCoreSpecialDay = useMemo<AttendanceSpecialDay | null>(() => {
    const date = cleanText(selectedDate);
    const shift = date ? coreResolvedShiftsByDate[date] : null;
    if (!date || !isResolvedShiftOff(shift)) return null;
    return {
      date,
      kind: "exception_off",
      label: LABEL_EXCEPTION_OFF,
      source: "core_exception_off",
    };
  }, [coreResolvedShiftsByDate, selectedDate]);

  const mergedSpecialDays = useMemo(() => {
    const byDate = new Map<string, AttendanceSpecialDay>();
    [...specialDays, ...rowSpecialDays, ...resolvedCoreSpecialDays, ...(selectedCoreSpecialDay ? [selectedCoreSpecialDay] : [])].forEach((day) => {
      const date = cleanText(day.date);
      if (!date) return;
      const current = byDate.get(date);
      if (!current || specialDayPriority(day) >= specialDayPriority(current)) {
        byDate.set(date, day);
      }
    });
    return Array.from(byDate.values()).sort((left, right) => left.date.localeCompare(right.date));
  }, [rowSpecialDays, resolvedCoreSpecialDays, selectedCoreSpecialDay, specialDays]);
  const selectedSpecialDay = useMemo(
    () => mergedSpecialDays.find((day) => day.date === cleanText(selectedDate)) || null,
    [mergedSpecialDays, selectedDate]
  );
  const selectedRawRow = useMemo(() => {
    const dateKey = cleanText(selectedDate);
    return rows.find((row) => {
      const record = row as StaffAttendanceWithId & Record<string, unknown>;
      return cleanText(record.date || record.dateKey || record.dayKey) === dateKey;
    }) || null;
  }, [rows, selectedDate]);
  const effectiveShiftInfo = useMemo(
    () => resolveSelectedShiftInfo({
      dateKey: cleanText(selectedDate),
      row: selectedRawRow,
      schedule,
      salonBusinessHours,
      approvedLeaveDateKeys,
      specialDay: selectedSpecialDay,
      coreResolvedShift: cleanText(selectedDate) ? coreResolvedShiftsByDate[cleanText(selectedDate)] || null : null,
      coreLoading: coreShiftLoading,
      coreError: coreShiftError,
    }),
    [approvedLeaveDateKeys, coreResolvedShiftsByDate, coreShiftError, coreShiftLoading, salonBusinessHours, schedule, selectedDate, selectedRawRow, selectedSpecialDay]
  );

  const selectedRawRecord = (selectedRawRow || {}) as StaffAttendanceWithId & Record<string, unknown>;
  const selectedCheckInTime = cleanText(
    selectedRawRecord.checkInAtClient || selectedRawRecord.checkInAt || selectedRawRecord.checkInTime
  );
  const selectedCheckOutTime = cleanText(
    selectedRawRecord.checkOutAtClient || selectedRawRecord.checkOutAt || selectedRawRecord.checkOutTime
  );

  const clearSelectedPunchTime = async (type: "check_in" | "check_out") => {
    const date = cleanText(selectedDate);
    const currentTime = type === "check_in" ? selectedCheckInTime : selectedCheckOutTime;
    if (!canDelete) {
      setPunchClearError("ليست لديك صلاحية لمسح وقت البصمة.");
      return;
    }
    if (!date || !selectedRawRow || !currentTime) {
      setPunchClearError(type === "check_in" ? "لا يوجد وقت حضور لمسحه في هذا اليوم." : "لا يوجد وقت انصراف لمسحه في هذا اليوم.");
      return;
    }

    const label = type === "check_in" ? "الحضور" : "الانصراف";
    if (!window.confirm(`سيتم مسح وقت ${label} فقط ليوم ${date} مع إبقاء البصمة الأخرى كما هي. هل تريد المتابعة؟`)) {
      return;
    }

    const rawRecords = Array.isArray(selectedRawRecord.records)
      ? (selectedRawRecord.records as Record<string, unknown>[])
      : [];
    const matchingRecords = rawRecords.filter((record) => cleanText(record.type).toLowerCase() === type);
    const recordIds = matchingRecords.map((record) => cleanText(record.id)).filter(Boolean);
    const serverTimes = matchingRecords.map((record) => cleanText(record.serverTime)).filter(Boolean);
    if (!recordIds.length && !serverTimes.length) serverTimes.push(currentTime);

    const employeeUid = cleanText(employeeId) || uniqueCleanTexts(employeeIds)[0] || "";
    const identityCandidates = uniqueCleanTexts([
      selectedRawRecord.employeeId,
      selectedRawRecord.employeeDocId,
      ...employeeIds,
      employeeUid,
    ]);
    const employeeDocId =
      cleanText(selectedRawRecord.employeeId || selectedRawRecord.employeeDocId) ||
      identityCandidates.find((value) => value !== employeeUid) ||
      employeeUid;

    setClearingPunchType(type);
    setPunchClearMessage("");
    setPunchClearError("");
    try {
      const result = await clearAttendancePunchTimeFromWorker({
        employeeUid,
        employeeId: employeeDocId,
        date,
        recordIds,
        serverTimes,
        note: `مسح وقت ${label} فقط من إدارة الموظفات`,
      });
      if (Number(result.clearedRecords || 0) <= 0) {
        throw new Error(`لم يتم العثور على سجل ${label} قابل للمسح.`);
      }
      setPunchClearMessage(`تم مسح وقت ${label} فقط، وبقيت بقية سجلات اليوم كما هي.`);
      onReload();
    } catch (clearError) {
      setPunchClearError(cleanText((clearError as Error)?.message) || `تعذر مسح وقت ${label}.`);
    } finally {
      setClearingPunchType("");
    }
  };

  if (!isVisible) return null;

  return (
    <>
      <EmployeeAttendanceTabLiveV2
        readOnly={loading || Boolean(clearingPunchType)}
        loading={loading}
        error={error}
        rows={liveRows}
        monthKey={monthKey}
        selectedDate={selectedDate}
        approvedLeaveDateKeys={approvedLeaveDateKeys}
        specialDays={mergedSpecialDays}
        effectiveShiftInfo={effectiveShiftInfo}
        canEdit={canEdit}
        canDelete={canDelete}
        canCreateEmergencyLeave={canCreateEmergencyLeave}
        canCancelLeave={canCancelLeave}
        onMonthChange={onMonthChange}
        onSelectedDateChange={onSelectedDateChange}
        onReload={onReload}
        onEditPunch={onEditPunch}
        onDeletePunch={onDeletePunch}
        onCreateEmergencyLeave={onCreateEmergencyLeave}
        onCancelLeave={onCancelLeave}
      />

      {selectedRawRow && (selectedCheckInTime || selectedCheckOutTime) ? (
        <section className="dsv2-card dsv2-card--padded" aria-label="إدارة أوقات بصمة اليوم المحدد">
          <div className="dsv2-stack dsv2-stack--sm">
            <div>
              <h3 className="dsv2-section-title">إدارة أوقات البصمة</h3>
              <p className="dsv2-section-caption">
                يمكنك مسح وقت الحضور أو الانصراف بشكل مستقل في أي حالة، بدون حذف الوقت الآخر أو بقية سجلات اليوم.
              </p>
            </div>

            <div className="dsv2-cluster">
              {selectedCheckInTime && canDelete ? (
                <button
                  type="button"
                  className="dsv2-btn dsv2-btn--danger dsv2-btn--sm"
                  disabled={Boolean(clearingPunchType)}
                  onClick={() => void clearSelectedPunchTime("check_in")}
                >
                  {clearingPunchType === "check_in" ? "جاري مسح الحضور..." : "مسح وقت الحضور"}
                </button>
              ) : null}
              {selectedCheckOutTime && canDelete ? (
                <button
                  type="button"
                  className="dsv2-btn dsv2-btn--danger dsv2-btn--sm"
                  disabled={Boolean(clearingPunchType)}
                  onClick={() => void clearSelectedPunchTime("check_out")}
                >
                  {clearingPunchType === "check_out" ? "جاري مسح الانصراف..." : "مسح وقت الانصراف"}
                </button>
              ) : null}
            </div>

            {punchClearMessage ? (
              <div className="dsv2-badge dsv2-badge--success" role="status">{punchClearMessage}</div>
            ) : null}
            {punchClearError ? (
              <div className="dsv2-badge dsv2-badge--danger" role="alert">{punchClearError}</div>
            ) : null}
          </div>
        </section>
      ) : null}
    </>
  );
}
