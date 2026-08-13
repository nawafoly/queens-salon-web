import { useEffect, useRef, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalendarDay,
  faCheck,
  faChevronLeft,
  faChevronRight,
  faClock,
  faEllipsisVertical,
  faFingerprint,
  faPenToSquare,
  faRotate,
  faTrash,
} from "@fortawesome/free-solid-svg-icons";

import {
  getTodayAttendanceDateKey,
  type StaffAttendanceWithId,
} from "../services/firestoreAttendance";
import {
  computeAttendanceDay,
  getAttendanceDayStatus,
  type AttendanceRecord,
  type AttendanceStatus,
  type ShiftSchedule,
} from "../helpers/hr/attendanceCalculations";
import { resolveStaffScheduleVersionForDate, weeklyOffDaysFromScheduleSnapshot } from "../helpers/hr/staffScheduleHistory";
import { permissionIntervalsFromRequests } from "../helpers/hr/permissionAttendance";
import type { EmployeePermissionRequest } from "../services/employeePermissionRequests";
import type { CoreResolvedShift } from "../types/hrCoreApi";
import "../styles/AttendanceMonthView.css";

type AttendanceViewerMode = "employee" | "admin";

type AttendanceScheduleInput = ShiftSchedule & {
  start?: string | null;
  end?: string | null;
  workStartTime?: string | null;
  workEndTime?: string | null;
  shiftStartTime?: string | null;
  shiftEndTime?: string | null;
  offDays?: unknown;
  weeklyOffDay?: unknown;
  exceptionalLeaveWeekdays?: unknown;
  useCustomWorkingHours?: boolean;
  customWorkingHours?: Record<string, { enabled?: boolean; start?: string; end?: string }> | null;
  customWorkingHourOverrides?: Array<{ date?: string; enabled?: boolean; start?: string; end?: string }> | null;
  workingScheduleVersions?: Array<{
    id?: string;
    effectiveFrom?: string;
    effectiveTo?: string;
    useCustomWorkingHours?: boolean;
    customWorkingHours?: Record<string, { enabled?: boolean; start?: string; end?: string }>;
  }> | null;
};

type AttendanceMonthViewProps = {
  rows: StaffAttendanceWithId[];
  loading?: boolean;
  monthKey: string;
  selectedDate: string;
  title?: string;
  subtitle?: string;
  className?: string;
  emptySummaryText?: string;
  viewerMode?: AttendanceViewerMode;
  canEdit?: boolean;
  canDelete?: boolean;
  canReview?: boolean;
  canCreateEmergencyLeave?: boolean;
  canCancelLeave?: boolean;
  showAdminActions?: boolean;
  showSummaryTools?: boolean;
  schedule?: AttendanceScheduleInput | null;
  coreResolvedShifts?: Record<string, CoreResolvedShift | null> | null;
  approvedLeaveDateKeys?: Iterable<string>;
  permissionEntries?: EmployeePermissionRequest[];
  onMonthChange: (monthKey: string) => void;
  onSelectedDateChange: (dateKey: string) => void;
  onGenerateSummary?: () => void;
  onEditPunch?: (dateKey: string) => void;
  onDeletePunch?: (dateKey: string) => void;
  onReviewDay?: (dateKey: string) => void;
  onCreateEmergencyLeave?: (dateKey: string) => void;
  onCancelLeave?: (dateKey: string) => void;
};

const WEEK_LABELS = ["سبت", "أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة"];
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

function normalizeMonthKey(value: string) {
  const s = String(value || "").trim();
  return /^\d{4}-\d{2}$/.test(s) ? s : new Date().toISOString().slice(0, 7);
}

function normalizeDateKey(value: unknown) {
  const s = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function monthLabel(monthKey: string) {
  const [year, month] = normalizeMonthKey(monthKey).split("-").map(Number);
  return new Intl.DateTimeFormat("ar-SA", {
    calendar: "gregory",
    month: "long",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function monthYearLabel(monthKey: string) {
  const [year] = normalizeMonthKey(monthKey).split("-").map(Number);
  return new Intl.NumberFormat("ar-SA", { useGrouping: false }).format(year).replace(/\u066c/g, "") || String(year);
}

function daysInMonth(monthKey: string) {
  const [year, month] = normalizeMonthKey(monthKey).split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function firstWeekday(monthKey: string) {
  const [year, month] = normalizeMonthKey(monthKey).split("-").map(Number);
  return (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 1) % 7;
}

function weekdayKeyForDate(dateKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return "sun";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  return WEEKDAY_KEYS[date.getUTCDay()] || "sun";
}

function cleanTime(value: unknown) {
  const raw = String(value || "").trim();
  return /^\d{1,2}:\d{2}$/.test(raw) ? raw : "";
}

function cleanShiftText(value: unknown) {
  return String(value || "").trim();
}

function readPolicyMinutes(...values: unknown[]) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number) && number >= 0) return Math.round(number);
  }
  return undefined;
}

function parseShiftSnapshot(row?: CoreResolvedShift | null) {
  const raw = cleanShiftText((row as any)?.snapshotJson || (row as any)?.snapshot_json);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function resolvedShiftSourceLabel(row?: CoreResolvedShift | null) {
  const source = cleanShiftText((row as any)?.source);
  const exceptionType = cleanShiftText((row as any)?.exceptionType || (row as any)?.exception_type);
  if (source === "exception") {
    if (exceptionType === "off") return "استثناء: يوم راحة";
    if (exceptionType === "custom") return "استثناء: وقت مخصص";
    return "استثناء: شفت بديل";
  }
  if (source === "assignment") return "شفت منشور";
  return "جدول الموظفة";
}

function resolvedShiftName(row?: CoreResolvedShift | null) {
  const snapshot = parseShiftSnapshot(row);
  return (
    cleanShiftText((row as any)?.shiftName || (row as any)?.shift_name) ||
    cleanShiftText(snapshot.name) ||
    cleanShiftText(snapshot.code) ||
    resolvedShiftSourceLabel(row)
  );
}

function resolvedShiftWindow(row?: CoreResolvedShift | null) {
  if (!row || cleanShiftText((row as any).source) === "none") return null;
  const exceptionType = cleanShiftText((row as any)?.exceptionType || (row as any)?.exception_type);
  if (exceptionType === "off") {
    return {
      startTime: "09:00",
      endTime: "17:00",
      lateGraceMinutes: 0,
      earlyLeaveGraceMinutes: 0,
      isOff: true,
    };
  }
  const snapshot = parseShiftSnapshot(row);
  const startTime =
    cleanTime((row as any)?.templateStartTime) ||
    cleanTime((row as any)?.template_start_time) ||
    cleanTime((row as any)?.startTime) ||
    cleanTime((row as any)?.start_time) ||
    cleanTime(snapshot.start_time) ||
    cleanTime(snapshot.startTime);
  const endTime =
    cleanTime((row as any)?.templateEndTime) ||
    cleanTime((row as any)?.template_end_time) ||
    cleanTime((row as any)?.endTime) ||
    cleanTime((row as any)?.end_time) ||
    cleanTime(snapshot.end_time) ||
    cleanTime(snapshot.endTime);
  if (!startTime && !endTime) return null;
  return {
    startTime: startTime || "09:00",
    endTime: endTime || "17:00",
    lateGraceMinutes: readPolicyMinutes(
      (row as any)?.lateGraceMinutes,
      (row as any)?.late_grace_minutes,
      snapshot.lateGraceMinutes,
      snapshot.late_grace_minutes
    ),
    earlyLeaveGraceMinutes: 0,
    isOff: false,
  };
}

function isCoreResolvedOff(row?: CoreResolvedShift | null) {
  const source = cleanShiftText((row as any)?.source);
  const exceptionType = cleanShiftText((row as any)?.exceptionType || (row as any)?.exception_type);
  return exceptionType === "off" || (source === "weekly_schedule" && Number((row as any)?.active) !== 1);
}

function getDayOverride(dateKey: string, input?: AttendanceScheduleInput | null) {
  const overrides = Array.isArray(input?.customWorkingHourOverrides)
    ? input?.customWorkingHourOverrides || []
    : [];
  return overrides.find((override) => normalizeDateKey(override.date) === dateKey) || null;
}

function isDateSpecificOff(dateKey: string, input?: AttendanceScheduleInput | null) {
  const override = getDayOverride(dateKey, input);
  return override?.enabled === false;
}

function scheduleForDate(dateKey: string, input?: AttendanceScheduleInput | null, resolved?: CoreResolvedShift | null): ShiftSchedule {
  const coreWindow = resolvedShiftWindow(resolved);
  if (coreWindow && !coreWindow.isOff) {
    return {
      startTime: coreWindow.startTime,
      endTime: coreWindow.endTime,
      lateGraceMinutes: coreWindow.lateGraceMinutes,
      earlyLeaveGraceMinutes: coreWindow.earlyLeaveGraceMinutes,
      weeklyOffDays: [],
    };
  }
  const source = input || {};
  const historicalVersion = resolveStaffScheduleVersionForDate(source.workingScheduleVersions, dateKey);
  const effectiveSource: AttendanceScheduleInput = historicalVersion
    ? {
        ...source,
        useCustomWorkingHours: historicalVersion.useCustomWorkingHours,
        customWorkingHours: historicalVersion.customWorkingHours,
      } as AttendanceScheduleInput
    : source;
  const weekdayKey = weekdayKeyForDate(dateKey);
  const useCustomWorkingHours = historicalVersion
    ? historicalVersion.useCustomWorkingHours
    : effectiveSource.useCustomWorkingHours === true;
  const customDay = useCustomWorkingHours ? effectiveSource.customWorkingHours?.[weekdayKey] : undefined;
  const override = getDayOverride(dateKey, source);
  const customHours = (effectiveSource.customWorkingHours || {}) as Record<
    string,
    { enabled?: boolean; start?: string; end?: string }
  >;
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

  const startTime =
    cleanTime(override?.start) ||
    cleanTime(customDay?.start) ||
    cleanTime(effectiveSource.startTime) ||
    cleanTime(effectiveSource.start) ||
    cleanTime(effectiveSource.workStartTime) ||
    cleanTime(effectiveSource.shiftStartTime) ||
    "09:00";
  const endTime =
    cleanTime(override?.end) ||
    cleanTime(customDay?.end) ||
    cleanTime(effectiveSource.endTime) ||
    cleanTime(effectiveSource.end) ||
    cleanTime(effectiveSource.workEndTime) ||
    cleanTime(effectiveSource.shiftEndTime) ||
    "17:00";

  return {
    startTime,
    endTime,
    lateGraceMinutes: readPolicyMinutes(
      effectiveSource.lateGraceMinutes,
      (effectiveSource as any).late_grace_minutes
    ),
    earlyLeaveGraceMinutes: 0,
    weeklyOffDays: [...explicitOffDays, ...customOffDays],
  };
}

function formatTime(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "--";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "--";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Riyadh",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatHours(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "--";
  const totalMinutes = Math.round(value * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours && minutes) return `${hours} ساعة و ${minutes} دقيقة`;
  if (hours) return `${hours} ساعة`;
  return `${minutes} دقيقة`;
}

function fullDateLabel(dateKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return dateKey;
  return new Intl.DateTimeFormat("ar-SA", {
    timeZone: "Asia/Riyadh",
    calendar: "gregory",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)));
}


function cleanText(value: unknown) {
  return String(value || "").trim();
}

function recordsFromRow(row: StaffAttendanceWithId | null): AttendanceRecord[] {
  const rawRecords = Array.isArray(row?.records) ? row.records : [];
  if (rawRecords.length) {
    return rawRecords
      .map((record, index) => ({
        id: cleanText(record.id) || `${row?.id || "record"}-${index}`,
        type: cleanText(record.type) || "record",
        serverTime: cleanText(record.serverTime || record.clientTime),
        location: record.location,
        result: record.result,
        zoneName: record.zoneName,
        zoneId: record.zoneId,
        distanceMeters: record.distanceMeters,
      }))
      .filter((record) => record.serverTime)
      .sort(
        (left, right) =>
          Date.parse(left.serverTime || "") -
          Date.parse(right.serverTime || "")
      );
  }

  const records: AttendanceRecord[] = [];
  if (row?.checkInAtClient) {
    records.push({ id: `${row.id}-in`, type: "check_in", serverTime: row.checkInAtClient });
  }
  if (row?.checkOutAtClient) {
    records.push({ id: `${row.id}-out`, type: "check_out", serverTime: row.checkOutAtClient });
  }
  return records;
}

function selectedEventCount(row: StaffAttendanceWithId | null) {
  return recordsFromRow(row).length;
}

function recordTypeLabel(type: unknown) {
  const clean = cleanText(type);
  if (clean === "check_in") return "دخول";
  if (clean === "check_out") return "خروج";
  return clean || "سجل";
}

function recordLocationLabel(record: AttendanceRecord) {
  const location = record.location as
    | { lat?: number; lng?: number; accuracy?: number }
    | undefined;
  const zoneName = cleanText(record.zoneName);
  const distance = Number(record.distanceMeters);
  const parts: string[] = [];

  if (zoneName) parts.push(zoneName);
  if (
    location &&
    Number.isFinite(Number(location.lat)) &&
    Number.isFinite(Number(location.lng))
  ) {
    parts.push(
      `${Number(location.lat).toFixed(5)}, ${Number(location.lng).toFixed(5)}`
    );
  }
  if (Number.isFinite(distance)) {
    parts.push(`${Math.round(distance)} م`);
  }

  return parts.join(" - ") || "--";
}

function statusTone(status: AttendanceStatus) {
  if (status === "present") return "complete";
  if (status === "late") return "late";
  if (status === "missing_hours") return "partial";
  if (status === "in_progress") return "partial";
  if (status === "partial" || status === "today_pending") return "partial";
  if (status === "absent") return "absent";
  if (status === "off_day") return "off-day";
  if (status === "leave") return "leave";
  return "none";
}

function statusLabel(status: AttendanceStatus) {
  if (status === "present") return "حضور مكتمل";
  if (status === "late") return "متأخر";
  if (status === "missing_hours") return "ناقص ساعات";
  if (status === "in_progress") return "بانتظار الانصراف";
  if (status === "partial") return "بصمة تحتاج إكمال";
  if (status === "absent") return "غياب";
  if (status === "off_day") return "يوم راحة";
  if (status === "leave") return "إجازة";
  if (status === "today_pending") return "لم يسجل بعد";
  return "يوم قادم";
}

function displayStatusLabel(status: AttendanceStatus, viewerMode: AttendanceViewerMode) {
  if (viewerMode === "employee" && status === "off_day") return "إجازة";
  return statusLabel(status);
}

function displayStatusTone(status: AttendanceStatus, viewerMode: AttendanceViewerMode) {
  if (viewerMode === "employee" && status === "off_day") return "leave";
  return statusTone(status);
}


export default function AttendanceMonthView({
  rows,
  loading = false,
  monthKey,
  selectedDate,
  className,
  title = "سجل الحضور الشهري",
  subtitle = "اختر الشهر واليوم لعرض حالة الحضور وتفاصيل السجل.",
  emptySummaryText = "اختر يومًا من التقويم لعرض تفاصيل الحضور.",
  viewerMode = "employee",
  canEdit,
  canDelete,
  canReview,
  canCreateEmergencyLeave,
  canCancelLeave,
  showAdminActions = false,
  showSummaryTools = true,
  schedule,
  coreResolvedShifts,
  approvedLeaveDateKeys,
  permissionEntries,
  onMonthChange,
  onSelectedDateChange,
  onGenerateSummary,
  onEditPunch,
  onDeletePunch,
  onReviewDay,
  onCreateEmergencyLeave,
  onCancelLeave,
}: AttendanceMonthViewProps) {
  const safeMonthKey = normalizeMonthKey(monthKey);
  const todayKey = getTodayAttendanceDateKey();
  const leaveDateKeys = new Set(Array.from(approvedLeaveDateKeys || []).map(normalizeDateKey).filter(Boolean));
  const rowsByDate = new Map(rows.map((row) => [normalizeDateKey(row.date) || row.id, row]));
  const safeSelectedDate =
    normalizeDateKey(selectedDate) && selectedDate.startsWith(safeMonthKey)
      ? selectedDate
      : todayKey.startsWith(safeMonthKey)
        ? todayKey
        : `${safeMonthKey}-01`;
  const selectedRow = rowsByDate.get(safeSelectedDate) || null;
  const selectedDayRecords = recordsFromRow(selectedRow);
  const selectedCoreShift = coreResolvedShifts?.[safeSelectedDate] || null;
  const selectedSchedule = scheduleForDate(safeSelectedDate, schedule, selectedCoreShift);
  const selectedComputation = computeAttendanceDay(
    safeSelectedDate,
    selectedDayRecords,
    selectedSchedule,
    permissionIntervalsFromRequests(permissionEntries, safeSelectedDate)
  );
  const selectedStatus = getAttendanceDayStatus({
    date: safeSelectedDate,
    hasAttendance: selectedDayRecords.length > 0,
    checkOut: selectedComputation.checkOut,
    computation: selectedComputation,
    todayDateKey: todayKey,
    weeklyOffDays: selectedSchedule.weeklyOffDays,
    approvedLeaveDateKeys: leaveDateKeys,
    holidayDateKeys: isDateSpecificOff(safeSelectedDate, schedule) || isCoreResolvedOff(selectedCoreShift) ? [safeSelectedDate] : [],
  });
  const selectedTone = displayStatusTone(selectedStatus, viewerMode);
  const selectedCount = selectedEventCount(selectedRow);
  const dayCount = daysInMonth(safeMonthKey);
  const blanks = firstWeekday(safeMonthKey);
  const calendarCells = [
    ...Array.from({ length: blanks }, (_, index) => ({ key: `blank-${index}`, blank: true as const })),
    ...Array.from({ length: dayCount }, (_, index) => {
      const day = index + 1;
      const dateKey = `${safeMonthKey}-${pad2(day)}`;
      const row = rowsByDate.get(dateKey) || null;
      const dayCoreShift = coreResolvedShifts?.[dateKey] || null;
      const daySchedule = scheduleForDate(dateKey, schedule, dayCoreShift);
      const dayRecords = recordsFromRow(row);
      const computation = computeAttendanceDay(
        dateKey,
        dayRecords,
        daySchedule,
        permissionIntervalsFromRequests(permissionEntries, dateKey)
      );
      const status = getAttendanceDayStatus({
        date: dateKey,
        hasAttendance: dayRecords.length > 0,
        checkOut: computation.checkOut,
        computation,
        todayDateKey: todayKey,
        weeklyOffDays: daySchedule.weeklyOffDays,
        approvedLeaveDateKeys: leaveDateKeys,
        holidayDateKeys: isDateSpecificOff(dateKey, schedule) || isCoreResolvedOff(dayCoreShift) ? [dateKey] : [],
      });
      return {
        key: dateKey,
        blank: false as const,
        day,
        dateKey,
        status,
        tone: displayStatusTone(status, viewerMode),
      };
    }),
  ];
  const canShowAdminControls = viewerMode === "admin" || showAdminActions;
  const shouldShowEdit = canShowAdminControls && (canEdit ?? showAdminActions);
  const shouldShowDelete = canShowAdminControls && (canDelete ?? showAdminActions);
  const shouldShowReview = canShowAdminControls && (canReview ?? showAdminActions);
  const shouldShowEmergencyLeave =
    canShowAdminControls &&
    Boolean(canCreateEmergencyLeave && onCreateEmergencyLeave);
  const shouldShowCancelLeave =
    canShowAdminControls &&
    Boolean(canCancelLeave && onCancelLeave);
  const isRestDay =
    selectedStatus === "off_day";

  const isLeaveDay =
    selectedStatus === "leave";

  const isAbsentDay =
    selectedStatus === "absent";

  const isPendingDay =
    selectedStatus === "future" ||
    selectedStatus === "today_pending";

  const isPartialDay =
    selectedStatus === "partial";

  const isWorkedDay =
    !isRestDay &&
    !isLeaveDay &&
    !isAbsentDay &&
    !isPendingDay;

  const hasLate =
    selectedComputation.lateHours > 0.001;

  const hasPermissionCoverage =
    selectedComputation.permissionCoveredHours > 0.001;

  const hasMissingHours =
    selectedComputation.missingHours > 0.001;

  const hasOvertime =
    selectedComputation.overtimeHours > 0.001;

  const currentMonthKey = todayKey.slice(0, 7);
  const currentYear = Number(currentMonthKey.slice(0, 4));
  const selectedYear = Number(safeMonthKey.slice(0, 4));
  const monthPickerRef = useRef<HTMLDivElement | null>(null);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(selectedYear);
  const pickerYears = Array.from(
    new Set([
      selectedYear,
      ...Array.from({ length: 6 }, (_, index) => currentYear - index),
    ])
  )
    .filter((year) => Number.isFinite(year) && year <= currentYear)
    .sort((left, right) => right - left);
  const newestPickerYear = pickerYears[0] ?? currentYear;
  const oldestPickerYear = pickerYears[pickerYears.length - 1] ?? selectedYear;
  const pickerYearLabel = new Intl.NumberFormat("ar-SA", { useGrouping: false }).format(pickerYear);
  const pickerMonths = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const key = `${pickerYear}-${pad2(month)}`;
    return {
      key,
      label: monthLabel(key),
      disabled: key > currentMonthKey,
      selected: key === safeMonthKey,
    };
  });

  useEffect(() => {
    setPickerYear(selectedYear);
  }, [selectedYear]);

  useEffect(() => {
    if (!monthPickerOpen) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!monthPickerRef.current?.contains(event.target as Node)) {
        setMonthPickerOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMonthPickerOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [monthPickerOpen]);

  const goToToday = () => {
    const currentToday = getTodayAttendanceDateKey();
    onMonthChange(currentToday.slice(0, 7));
    onSelectedDateChange(currentToday);
  };

  return (
    <section className={["attendance-month", "attendance-month--premium-v3", className].filter(Boolean).join(" ")} dir="rtl">
      {showSummaryTools ? (
        <div className="attendance-month__summary attendance-month__command-center">
          <div className="attendance-month__command-intro">
            <span className="attendance-month__command-icon" aria-hidden="true">
              <FontAwesomeIcon icon={faFingerprint} />
            </span>
            <div className="attendance-month__command-copy">
              <span className="attendance-month__eyebrow">إدارة الدوام</span>
              <h2>{title}</h2>
              <p>{subtitle}</p>
            </div>
          </div>

          <div className="attendance-month__command-controls">
            <button
              type="button"
              className="attendance-month__refresh-button"
              onClick={onGenerateSummary}
              disabled={loading || !onGenerateSummary}
            >
              <FontAwesomeIcon icon={faRotate} spin={loading} />
              <span>{loading ? "جاري التحديث..." : "تحديث السجلات"}</span>
            </button>
          </div>

          <div className="attendance-month__selected-overview">
            <div className="attendance-month__selected-overview-head">
              <span>اليوم المحدد</span>
              <span className={`attendance-month__selected-status is-${selectedTone}`}>
                {loading ? "تحميل" : displayStatusLabel(selectedStatus, viewerMode)}
              </span>
            </div>
            <strong>{fullDateLabel(safeSelectedDate)}</strong>
            <small>{emptySummaryText}</small>
            {selectedCoreShift && cleanShiftText((selectedCoreShift as any).source) !== "none" ? (
              <small>
                الشفت المستخدم للحساب: {resolvedShiftName(selectedCoreShift)} — {resolvedShiftSourceLabel(selectedCoreShift)}
              </small>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="attendance-month__calendar-shell attendance-month__calendar-card">
        <div className="attendance-month__calendar-head">
          <div className="attendance-month__title">
            <span>تقويم الحضور</span>
            <h3>{monthLabel(safeMonthKey)} {monthYearLabel(safeMonthKey)}</h3>
          </div>
          <div className="attendance-month__calendar-month-control attendance-month__month-control" ref={monthPickerRef}>
            <button
              type="button"
              className="attendance-month__control-field attendance-month__month-picker attendance-month__month-picker-button"
              onClick={() => setMonthPickerOpen((open) => !open)}
              aria-haspopup="dialog"
              aria-expanded={monthPickerOpen}
            >
              <FontAwesomeIcon icon={faCalendarDay} />
              <span className="attendance-month__month-picker-label">اختيار الشهر</span>
            </button>
            {monthPickerOpen ? (
              <div className="attendance-month__month-menu" role="dialog" aria-label="اختيار الشهر">
                <div className="attendance-month__month-menu-head">
                  <span>السنة</span>
                  <div className="attendance-month__year-switcher" aria-label="اختيار السنة">
                    <button
                      type="button"
                      className="attendance-month__year-button"
                      onClick={() => setPickerYear((year) => Math.max(oldestPickerYear, year - 1))}
                      disabled={pickerYear <= oldestPickerYear}
                      aria-label="السنة السابقة"
                    >
                      <FontAwesomeIcon icon={faChevronRight} />
                    </button>
                    <strong className="attendance-month__year-value">{pickerYearLabel}</strong>
                    <button
                      type="button"
                      className="attendance-month__year-button"
                      onClick={() => setPickerYear((year) => Math.min(newestPickerYear, year + 1))}
                      disabled={pickerYear >= newestPickerYear}
                      aria-label="السنة التالية"
                    >
                      <FontAwesomeIcon icon={faChevronLeft} />
                    </button>
                  </div>
                </div>
                <div className="attendance-month__month-options">
                  {pickerMonths.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      className={`attendance-month__month-option ${item.selected ? "is-selected" : ""}`}
                      disabled={item.disabled}
                      onClick={() => {
                        onMonthChange(item.key);
                        setMonthPickerOpen(false);
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <div className="attendance-month__calendar-actions">
            <button type="button" className="attendance-month__today-button" onClick={goToToday}>
              <FontAwesomeIcon icon={faCalendarDay} />
              <span>اليوم</span>
            </button>
          </div>
        </div>

        <div className="attendance-month__weekdays">
          {WEEK_LABELS.map((label, index) => (
            <span key={`${label}-${index}`}>{label}</span>
          ))}
        </div>

        <div className="attendance-month__grid">
          {calendarCells.map((cell) =>
            cell.blank ? (
              <span key={cell.key} className="attendance-month__blank" />
            ) : (
              <button
                key={cell.key}
                type="button"
                className={`attendance-month__day is-${cell.tone} ${
                  safeSelectedDate === cell.dateKey ? "is-selected" : ""
                } ${todayKey === cell.dateKey ? "is-today" : ""}`}
                onClick={() => onSelectedDateChange(cell.dateKey)}
                title={`${cell.dateKey} - ${displayStatusLabel(cell.status, viewerMode)}`}
                aria-current={todayKey === cell.dateKey ? "date" : undefined}
                aria-selected={safeSelectedDate === cell.dateKey}
              >
                <span className="attendance-month__day-marker" />
                <strong>{cell.day}</strong>
                {todayKey === cell.dateKey ? <span className="attendance-month__today-label">اليوم</span> : null}
              </button>
            )
          )}
        </div>
        <div className="attendance-month__legend" aria-label="دليل حالات الحضور">
          <span className="is-complete">حاضر</span>
          <span className="is-late">متأخر</span>
          <span className="is-partial">يحتاج مراجعة</span>
          <span className="is-absent">غياب</span>
          <span className="is-leave">إجازة</span>
          {viewerMode === "admin" ? <span className="is-off-day">يوم راحة</span> : null}
        </div>
      </div>

      <div className="attendance-month__detail">
        <div className="attendance-month__detail-head">
          <div className="attendance-month__selected-date">
            <strong>{fullDateLabel(safeSelectedDate)}</strong>
            {safeSelectedDate === todayKey ? <span>اليوم</span> : null}
          </div>
          <div className="attendance-month__records-tab">
            <span>السجلات</span>
          </div>
        </div>

        <div className="attendance-month__records-meta">
          {selectedCoreShift && cleanShiftText((selectedCoreShift as any).source) !== "none" ? (
            <div className="attendance-month__shift-chip">
              <span>{resolvedShiftSourceLabel(selectedCoreShift)}</span>
              <strong>{resolvedShiftName(selectedCoreShift)}</strong>
              <small>{isCoreResolvedOff(selectedCoreShift) ? "راحة" : `${selectedSchedule.startTime} — ${selectedSchedule.endTime}`}</small>
            </div>
          ) : null}
          {canShowAdminControls &&
          !isRestDay &&
          !isLeaveDay ? (
            <div className="attendance-month__actions">
              {shouldShowReview ? (
                <button type="button" onClick={() => (onReviewDay || onEditPunch)?.(safeSelectedDate)}>
                  <FontAwesomeIcon icon={faCheck} /> مراجعة
                </button>
              ) : null}
              {shouldShowEmergencyLeave && selectedDayRecords.length === 0 ? (
                <button type="button" onClick={() => onCreateEmergencyLeave?.(safeSelectedDate)}>
                  <FontAwesomeIcon icon={faCalendarDay} /> تسجيل إجازة
                </button>
              ) : null}
              {shouldShowEdit ? (
                <button type="button" onClick={() => onEditPunch?.(safeSelectedDate)} disabled={!onEditPunch}>
                  <FontAwesomeIcon icon={faPenToSquare} />
                  {selectedCount > 0
                    ? "تعديل البصمة"
                    : "إضافة بصمة"}
                </button>
              ) : null}
              {shouldShowDelete ? (
                <button
                  type="button"
                  className="is-danger"
                  onClick={() => onDeletePunch?.(safeSelectedDate)}
                  disabled={!onDeletePunch}
                >
                  <FontAwesomeIcon icon={faTrash} /> مسح البصمة
                </button>
              ) : null}
            </div>
          ) : (
            <div />
          )}
          {isWorkedDay ? (
            <div className="attendance-month__status-summary">
              <span
                className={`attendance-month__badge is-${selectedTone}`}
              >
                {displayStatusLabel(selectedStatus, viewerMode)}
              </span>

              <span className="attendance-month__record-count">
                <FontAwesomeIcon icon={faFingerprint} />

                {selectedCount === 1
                  ? "سجل واحد"
                  : `${selectedCount} سجل`}
              </span>
            </div>
          ) : null}
        </div>

        {isRestDay ? (
          <div className={`attendance-month__state-card is-${selectedTone}`}>
            <div className="attendance-month__state-icon">
              <FontAwesomeIcon icon={faCalendarDay} />
            </div>

            <strong>{displayStatusLabel(selectedStatus, viewerMode)}</strong>
          </div>
        ) : isLeaveDay ? (
          <div className="attendance-month__state-card is-leave">
            <div className="attendance-month__state-icon">
              <FontAwesomeIcon icon={faCalendarDay} />
            </div>

            <strong>إجازة</strong>
            {shouldShowCancelLeave ? (
              <button
                type="button"
                className="attendance-month__state-action is-danger"
                onClick={() => onCancelLeave?.(safeSelectedDate)}
              >
                إلغاء الإجازة
              </button>
            ) : null}
          </div>
        ) : isAbsentDay ? (
          <div className="attendance-month__state-card is-absent">
            <div className="attendance-month__state-icon">
              <FontAwesomeIcon icon={faCalendarDay} />
            </div>

            <strong>غياب</strong>
          </div>
        ) : isPendingDay ? (
          <div className="attendance-month__state-card is-pending">
            <div className="attendance-month__state-icon">
              <FontAwesomeIcon icon={faCalendarDay} />
            </div>

            <strong>{displayStatusLabel(selectedStatus, viewerMode)}</strong>
          </div>
        ) : (
          <div className="attendance-month__worked-day">
            <div
              className={`attendance-month__record attendance-month__record--premium is-${selectedTone}`}
            >
              <div className="attendance-month__record-main">
                <button
                  type="button"
                  aria-label="خيارات السجل"
                >
                  <FontAwesomeIcon
                    icon={faEllipsisVertical}
                  />
                </button>

                <strong>
                  {formatTime(
                    selectedRow?.checkInAtClient
                  )}
                  {" — "}
                  {formatTime(
                    selectedRow?.checkOutAtClient
                  )}
                </strong>

                <span>
                  <FontAwesomeIcon icon={faClock} />

                  {formatHours(
                    selectedComputation.actualHours
                  )}
                </span>
              </div>
            </div>
          </div>
        )}

        {isWorkedDay ? (
          <div className="attendance-month__worked-details">
            <div className="attendance-month__worked-metrics">
              <div className="attendance-month__worked-metric">
                <span>الحالة</span>
                <b>{displayStatusLabel(selectedStatus, viewerMode)}</b>
              </div>

              <div className="attendance-month__worked-metric">
                <span>وقت الحضور</span>
                <b>
                  {formatTime(
                    selectedRow?.checkInAtClient
                  )}
                </b>
              </div>

              <div className="attendance-month__worked-metric">
                <span>وقت الانصراف</span>
                <b>
                  {formatTime(
                    selectedRow?.checkOutAtClient
                  )}
                </b>
              </div>

              <div className="attendance-month__worked-metric">
                <span>مدة العمل</span>
                <b>
                  {formatHours(
                    selectedComputation.actualHours
                  )}
                </b>
              </div>
            </div>

            {selectedDayRecords.length ? (
              <div className="attendance-month__raw-records">
                {selectedDayRecords.map((record) => (
                  <div
                    key={`${record.id || record.type}-${record.serverTime}`}
                    className="attendance-month__raw-record"
                  >
                    <span>{recordTypeLabel(record.type)}</span>
                    <b>{formatTime(record.serverTime)}</b>
                    <small>{recordLocationLabel(record)}</small>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="attendance-month__performance">
              {isPartialDay ? (
                <div className="attendance-month__performance-item is-review">
                  <FontAwesomeIcon icon={faClock} />
                  <span>حالة السجل</span>
                  <b>يحتاج إكمال</b>
                </div>
              ) : (
                <>
                  {hasLate ? (
                    <div className="attendance-month__performance-item is-late">
                      <span>التأخير</span>
                      <b>
                        {formatHours(
                          selectedComputation.lateHours
                        )}
                      </b>
                    </div>
                  ) : null}

                  {hasPermissionCoverage ? (
                    <div className="attendance-month__performance-item is-review">
                      <span>استئذان محتسب</span>
                      <b>{formatHours(selectedComputation.permissionCoveredHours)}</b>
                      <small>مدة الطلب: {formatHours(selectedComputation.permissionRequestedHours)}</small>
                    </div>
                  ) : null}

                  {hasMissingHours ? (
                    <div className="attendance-month__performance-item is-missing">
                      <span>نقص الساعات</span>
                      <b>
                        {formatHours(
                          selectedComputation.missingHours
                        )}
                      </b>
                    </div>
                  ) : null}

                  {hasOvertime ? (
                    <div className="attendance-month__performance-item is-overtime">
                      <span>وقت إضافي</span>
                      <b>
                        {formatHours(
                          selectedComputation.overtimeHours
                        )}
                      </b>
                    </div>
                  ) : null}

                  {!hasLate &&
                  !hasMissingHours &&
                  !hasOvertime ? (
                    <div className="attendance-month__performance-item is-committed">
                      <FontAwesomeIcon icon={faCheck} />
                      <span>الالتزام</span>
                      <b>ملتزم</b>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
