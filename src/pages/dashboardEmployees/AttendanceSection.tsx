import type { StaffAttendanceWithId } from "../../services/firestoreAttendance";
import {
  computeAttendanceDay,
  type AttendanceRecord,
  type ShiftSchedule,
} from "../../helpers/hr/attendanceCalculations";
import { resolveStaffScheduleVersionForDate } from "../../helpers/hr/staffScheduleHistory";
import {
  EmployeeAttendanceTabLiveV2,
  type EmployeeAttendanceRowLiveV2,
} from "../../components/dashboard-v2/employee-workspace/live";

type AttendanceSectionProps = {
  isVisible: boolean;
  loading: boolean;
  error?: string;
  rows: StaffAttendanceWithId[];
  monthKey: string;
  selectedDate: string;
  schedule?: Record<string, unknown> | null;
  employeeId?: string;
  approvedLeaveDateKeys?: string[];
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

function resolveAttendanceSchedule(dateKey: string, schedule?: Record<string, unknown> | null): ShiftSchedule {
  const profile = schedule || {};
  const historicalVersion = resolveStaffScheduleVersionForDate(profile.workingScheduleVersions, dateKey);
  const effectiveSource = historicalVersion
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
  const explicitOffDays = [
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
      earlyLeaveGraceMinutes: readPolicyMinutes(effectiveSource.earlyLeaveGraceMinutes, effectiveSource.early_leave_grace_minutes),
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
    earlyLeaveGraceMinutes: readPolicyMinutes(effectiveSource.earlyLeaveGraceMinutes, effectiveSource.early_leave_grace_minutes),
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

function resolveRecordShiftSchedule(record: Record<string, unknown>): ShiftSchedule | null {
  const resolvedShift = record.resolvedShift && typeof record.resolvedShift === "object"
    ? (record.resolvedShift as Record<string, unknown>)
    : {};
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
    earlyLeaveGraceMinutes: readPolicyMinutes(
      record.earlyLeaveGraceMinutes,
      resolvedShift.earlyLeaveGraceMinutes,
      resolvedShift.early_leave_grace_minutes,
      snapshot.earlyLeaveGraceMinutes,
      snapshot.early_leave_grace_minutes
    ),
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

  const graceMinutes = readPolicyMinutes(resolvedSchedule.earlyLeaveGraceMinutes) || 0;
  const earlyLeaveMinutes = Math.round((scheduleEndMs - checkOutMs) / 60000) - graceMinutes;
  return Math.max(0, earlyLeaveMinutes);
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
  return {
    date,
    status: cleanText(record.status || record.attendanceStatus || record.state),
    checkInAtClient: cleanText(record.checkInAtClient || record.checkInAt || record.checkInTime),
    checkOutAtClient: cleanText(record.checkOutAtClient || record.checkOutAt || record.checkOutTime),
    lateMinutes: date ? computeLateMinutes(record, date, schedule) : Number(record.lateMinutes || 0),
    earlyLeaveMinutes: date ? computeEarlyLeaveMinutes(record, date, schedule) : Number(record.earlyLeaveMinutes || 0),
    shiftName: cleanText(record.shiftName || (record.resolvedShift as Record<string, unknown> | undefined)?.shiftName || (record.resolvedShift as Record<string, unknown> | undefined)?.shift_name),
    scheduledStartTime: cleanText(resolvedSchedule?.startTime),
    scheduledEndTime: cleanText(resolvedSchedule?.endTime),
    lateGraceMinutes: Number(resolvedSchedule?.lateGraceMinutes || 0),
    earlyLeaveGraceMinutes: Number(resolvedSchedule?.earlyLeaveGraceMinutes || 0),
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
  approvedLeaveDateKeys = [],
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
  if (!isVisible) return null;

  const liveRows = rows.map((row) => toLiveAttendanceRow(row, schedule));

  return (
    <>
      <EmployeeAttendanceTabLiveV2
        readOnly={loading}
        loading={loading}
        error={error}
        rows={liveRows}
        monthKey={monthKey}
        selectedDate={selectedDate}
        approvedLeaveDateKeys={approvedLeaveDateKeys}
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
    </>
  );
}
