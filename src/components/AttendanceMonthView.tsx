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
  type AttendanceRecord,
  type AttendanceStatus,
} from "../helpers/hr/attendanceCalculations";
import {
  computeResolvedAttendanceDay,
  recordsFromAttendanceRow,
} from "../helpers/hr/attendanceShiftResolver";
import type { EmployeePermissionRequest } from "../services/employeePermissionRequests";
import type { CoreResolvedShift } from "../types/hrCoreApi";
import "../styles/AttendanceMonthView.css";

type AttendanceViewerMode = "employee" | "admin";

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
  language?: "ar" | "en";
  canEdit?: boolean;
  canDelete?: boolean;
  canReview?: boolean;
  canCreateEmergencyLeave?: boolean;
  canCancelLeave?: boolean;
  showAdminActions?: boolean;
  showSummaryTools?: boolean;
  coreResolvedShifts?: Record<string, CoreResolvedShift | null> | null;
  coreResolvedShiftsLoading?: boolean;
  coreResolvedShiftsError?: string;
  approvedLeaveDateKeys?: Iterable<string>;
  absenceDateKeys?: Iterable<string>;
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

const attendanceCopy = {
  ar: {
    week: ["سبت", "أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة"],
    hour: "ساعة", minute: "دقيقة", and: "و", in: "دخول", out: "خروج", record: "سجل", meter: "م",
    presentComplete: "حضور مكتمل", late: "متأخر", missingHours: "ناقص ساعات", waitingOut: "بانتظار الانصراف", needsCompletion: "بصمة تحتاج إكمال", absent: "غياب", offDay: "يوم راحة", leave: "إجازة", notRecorded: "لم يسجل بعد", scheduleUnavailable: "الدوام المعتمد غير متاح", future: "يوم قادم",
    exception: "استثناء", noDuty: "لا يوجد دوام", weeklyRest: "راحة أسبوعية",
    attendanceManagement: "إدارة الدوام", updating: "جاري التحديث...", refresh: "تحديث السجلات", selectedDay: "اليوم المحدد", loading: "تحميل", shiftUsed: "الشفت المستخدم للحساب",
    attendanceCalendar: "تقويم الحضور", chooseMonth: "اختيار الشهر", year: "السنة", chooseYear: "اختيار السنة", previousYear: "السنة السابقة", nextYear: "السنة التالية", today: "اليوم",
    legend: "دليل حالات الحضور", present: "حاضر", needsReview: "يحتاج مراجعة", records: "السجلات", rest: "راحة",
    review: "مراجعة", registerLeave: "تسجيل إجازة", editPunch: "تعديل البصمة", addPunch: "إضافة بصمة", deletePunch: "مسح البصمة", oneRecord: "سجل واحد", recordsCount: "سجل",
    undefined: "غير محدد", notFound: "غير موجود", no: "لا", yes: "نعم", none: "لا يوجد", date: "التاريخ", startTime: "وقت البداية", endTime: "وقت النهاية", lateGrace: "سماح التأخير", shiftName: "اسم الشفت", source: "المصدر", sourceType: "نوع المصدر", sourceDocument: "مستند المصدر", coreShift: "Core resolved shift", exceptionType: "نوع الاستثناء", active: "نشط", fromPunch: "من سجل البصمة", fromCore: "من Core", calculationTime: "وقت الحساب", coreError: "خطأ Core",
    cancelLeave: "إلغاء الإجازة", scheduleUnavailableDetails: "تعذر الحصول على الشفت المعتمد من Malikat Core. لم يتم استخدام أي جدول قديم كبديل.", recordOptions: "خيارات السجل", status: "الحالة", checkInTime: "وقت الحضور", checkOutTime: "وقت الانصراف", workDuration: "مدة العمل", recordStatus: "حالة السجل", needsFinish: "يحتاج إكمال", delay: "التأخير", coveredPermission: "استئذان محتسب", requestDuration: "مدة الطلب", shortage: "نقص الساعات", overtime: "وقت إضافي", commitment: "الالتزام", committed: "ملتزم",
    noCoreShift: "Core: لا يوجد شفت", exceptionalRestWork: "عمل استثنائي في يوم الراحة", exceptionOff: "استثناء: يوم راحة", exceptionCustom: "استثناء: وقت مخصص", exceptionAlternative: "استثناء: شفت بديل", publishedShift: "شفت منشور", weeklyCore: "جدول أسبوعي من Core", attendanceRecord: "سجل البصمة", core: "Core",
  },
  en: {
    week: ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"],
    hour: "hour", minute: "minute", and: "and", in: "Clock in", out: "Clock out", record: "Record", meter: "m",
    presentComplete: "Complete attendance", late: "Late", missingHours: "Missing hours", waitingOut: "Awaiting clock-out", needsCompletion: "Attendance needs completion", absent: "Absent", offDay: "Rest day", leave: "Leave", notRecorded: "Not recorded yet", scheduleUnavailable: "Approved schedule unavailable", future: "Upcoming day",
    exception: "Exception", noDuty: "No shift", weeklyRest: "Weekly rest",
    attendanceManagement: "Attendance management", updating: "Updating...", refresh: "Refresh records", selectedDay: "Selected day", loading: "Loading", shiftUsed: "Shift used for calculation",
    attendanceCalendar: "Attendance calendar", chooseMonth: "Choose month", year: "Year", chooseYear: "Choose year", previousYear: "Previous year", nextYear: "Next year", today: "Today",
    legend: "Attendance status guide", present: "Present", needsReview: "Needs review", records: "Records", rest: "Rest",
    review: "Review", registerLeave: "Record leave", editPunch: "Edit attendance", addPunch: "Add attendance", deletePunch: "Delete attendance", oneRecord: "1 record", recordsCount: "records",
    undefined: "Not specified", notFound: "Not found", no: "No", yes: "Yes", none: "None", date: "Date", startTime: "Start time", endTime: "End time", lateGrace: "Late grace", shiftName: "Shift name", source: "Source", sourceType: "Source type", sourceDocument: "Source document", coreShift: "Core resolved shift", exceptionType: "Exception type", active: "Active", fromPunch: "From attendance record", fromCore: "From Core", calculationTime: "Calculation time", coreError: "Core error",
    cancelLeave: "Cancel leave", scheduleUnavailableDetails: "The approved shift could not be retrieved from Malikat Core. No legacy schedule was used as a fallback.", recordOptions: "Record options", status: "Status", checkInTime: "Clock-in time", checkOutTime: "Clock-out time", workDuration: "Work duration", recordStatus: "Record status", needsFinish: "Needs completion", delay: "Late time", coveredPermission: "Covered permission", requestDuration: "Request duration", shortage: "Missing hours", overtime: "Overtime", commitment: "Commitment", committed: "Committed",
    noCoreShift: "Core: no shift", exceptionalRestWork: "Exceptional work on a rest day", exceptionOff: "Exception: rest day", exceptionCustom: "Exception: custom time", exceptionAlternative: "Exception: alternate shift", publishedShift: "Published shift", weeklyCore: "Weekly schedule from Core", attendanceRecord: "Attendance record", core: "Core",
  },
} as const;

type AttendanceCopy = { [K in keyof typeof attendanceCopy.ar]: K extends "week" ? readonly string[] : string };
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

function monthLabel(monthKey: string, language: "ar" | "en") {
  const [year, month] = normalizeMonthKey(monthKey).split("-").map(Number);
  return new Intl.DateTimeFormat(language === "ar" ? "ar-SA-u-nu-latn" : "en-SA", {
    calendar: "gregory",
    month: "long",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

function monthYearLabel(monthKey: string, language: "ar" | "en") {
  const [year] = normalizeMonthKey(monthKey).split("-").map(Number);
  return new Intl.NumberFormat(language === "ar" ? "ar-SA-u-nu-latn" : "en-SA", { useGrouping: false }).format(year).replace(/\u066c/g, "") || String(year);
}

function daysInMonth(monthKey: string) {
  const [year, month] = normalizeMonthKey(monthKey).split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function firstWeekday(monthKey: string) {
  const [year, month] = normalizeMonthKey(monthKey).split("-").map(Number);
  return (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 1) % 7;
}

function cleanTime(value: unknown) {
  const raw = String(value || "").trim();
  return /^\d{1,2}:\d{2}$/.test(raw) ? raw : "";
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

function formatHours(value: number, copy: AttendanceCopy) {
  if (!Number.isFinite(value) || value <= 0) return "--";
  const totalMinutes = Math.round(value * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours && minutes) return `${hours} ${copy.hour} ${copy.and} ${minutes} ${copy.minute}`;
  if (hours) return `${hours} ${copy.hour}`;
  return `${minutes} ${copy.minute}`;
}

function fullDateLabel(dateKey: string, language: "ar" | "en") {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return dateKey;
  return new Intl.DateTimeFormat(language === "ar" ? "ar-SA-u-nu-latn" : "en-SA", {
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
  return recordsFromAttendanceRow(row as (StaffAttendanceWithId & Record<string, unknown>) | null);
}

function selectedEventCount(row: StaffAttendanceWithId | null) {
  return recordsFromRow(row).length;
}

function recordTypeLabel(type: unknown, copy: AttendanceCopy) {
  const clean = cleanText(type);
  if (clean === "check_in") return copy.in;
  if (clean === "check_out") return copy.out;
  return clean || copy.record;
}

function recordLocationLabel(record: AttendanceRecord, copy: AttendanceCopy) {
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
    parts.push(`${Math.round(distance)} ${copy.meter}`);
  }

  return parts.join(" - ") || "--";
}

function statusTone(status: AttendanceStatus) {
  if (status === "present") return "complete";
  if (status === "late") return "late";
  if (status === "missing_hours") return "partial";
  if (status === "in_progress") return "partial";
  if (
    status === "partial" ||
    status === "today_pending" ||
    status === "schedule_unavailable"
  ) {
    return "partial";
  }
  if (status === "absent") return "absent";
  if (status === "off_day") return "off-day";
  if (status === "leave") return "leave";
  return "none";
}

function statusLabel(status: AttendanceStatus, copy: AttendanceCopy) {
  if (status === "present") return copy.presentComplete;
  if (status === "late") return copy.late;
  if (status === "missing_hours") return copy.missingHours;
  if (status === "in_progress") return copy.waitingOut;
  if (status === "partial") return copy.needsCompletion;
  if (status === "absent") return copy.absent;
  if (status === "off_day") return copy.offDay;
  if (status === "leave") return copy.leave;
  if (status === "today_pending") return copy.notRecorded;
  if (status === "schedule_unavailable") return copy.scheduleUnavailable;
  return copy.future;
}

function employeeOffDayPresentation(
  copy: AttendanceCopy,
  coreShift?: CoreResolvedShift | null
) {
  const source = cleanText(
    (coreShift as Record<string, unknown> | null)?.source
  ).toLowerCase();

  if (source === "exception") {
    return {
      label: copy.exception,
      tone: "exception",
    };
  }

  if (source === "none") {
    return {
      label: copy.noDuty,
      tone: "off-day",
    };
  }

  return {
    label: copy.weeklyRest,
    tone: "off-day",
  };
}

function displayStatusLabel(
  status: AttendanceStatus,
  viewerMode: AttendanceViewerMode,
  copy: AttendanceCopy,
  coreShift?: CoreResolvedShift | null
) {
  if (
    viewerMode === "employee" &&
    status === "off_day"
  ) {
    return employeeOffDayPresentation(
      copy,
      coreShift
    ).label;
  }

  return statusLabel(status, copy);
}

function displayStatusTone(
  status: AttendanceStatus,
  viewerMode: AttendanceViewerMode,
  copy: AttendanceCopy,
  coreShift?: CoreResolvedShift | null
) {
  if (
    viewerMode === "employee" &&
    status === "off_day"
  ) {
    return employeeOffDayPresentation(
      copy,
      coreShift
    ).tone;
  }

  return statusTone(status);
}

function localizedCoreShiftSourceLabel(row: CoreResolvedShift | null | undefined, copy: AttendanceCopy) {
  const source = cleanText((row as Record<string, unknown> | null | undefined)?.source).toLowerCase();
  const exceptionType = cleanText(
    (row as Record<string, unknown> | null | undefined)?.exceptionType ||
      (row as Record<string, unknown> | null | undefined)?.exception_type
  ).toLowerCase();
  if (!source) return copy.notFound;
  if (source === "none") return copy.noCoreShift;
  if (source === "weekly_rest_work_assignment") return copy.exceptionalRestWork;
  if (source === "exception") {
    if (exceptionType === "off") return copy.exceptionOff;
    if (exceptionType === "custom") return copy.exceptionCustom;
    return copy.exceptionAlternative;
  }
  if (source === "assignment") return copy.publishedShift;
  if (source === "weekly_schedule") return copy.weeklyCore;
  if (source === "attendance_record") return copy.attendanceRecord;
  return copy.core;
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
  language = "ar",
  canEdit,
  canDelete,
  canReview,
  canCreateEmergencyLeave,
  canCancelLeave,
  showAdminActions = false,
  showSummaryTools = true,
  coreResolvedShifts,
  coreResolvedShiftsLoading = false,
  coreResolvedShiftsError = "",
  approvedLeaveDateKeys,
  absenceDateKeys,
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
  const copy = attendanceCopy[language] as AttendanceCopy;
  const safeMonthKey = normalizeMonthKey(monthKey);
  const todayKey = getTodayAttendanceDateKey();
  const leaveDateKeys =
    new Set(
      Array.from(
        approvedLeaveDateKeys ||
        []
      )
        .map(normalizeDateKey)
        .filter(Boolean)
    );

  const absenceDateKeySet =
    new Set(
      Array.from(
        absenceDateKeys ||
        []
      )
        .map(normalizeDateKey)
        .filter(Boolean)
    );

  const rowsByDate =
    new Map(
      rows.map(
        (row) => [
          normalizeDateKey(
            row.date
          ) || row.id,
          row,
        ]
      )
    );
  const safeSelectedDate =
    normalizeDateKey(selectedDate) && selectedDate.startsWith(safeMonthKey)
      ? selectedDate
      : todayKey.startsWith(safeMonthKey)
        ? todayKey
        : `${safeMonthKey}-01`;
  const selectedRow = rowsByDate.get(safeSelectedDate) || null;
  const selectedDayRecords = recordsFromRow(selectedRow);
  const selectedCoreShift = coreResolvedShifts?.[safeSelectedDate] || null;
  const selectedResolvedDay = computeResolvedAttendanceDay({
    dateKey: safeSelectedDate,
    row: selectedRow as (StaffAttendanceWithId & Record<string, unknown>) | null,
    records: selectedDayRecords,
    coreResolvedShift: selectedCoreShift,
    permissionEntries,
    todayDateKey: todayKey,
    approvedLeaveDateKeys:
      leaveDateKeys,
    absenceDateKeys:
      absenceDateKeySet,
  });
  const selectedSchedule = selectedResolvedDay.schedule;
  const selectedComputation = selectedResolvedDay.computation;
  const selectedStatus = selectedResolvedDay.status;
  const selectedShiftResolution = selectedResolvedDay.shiftResolution;
  const selectedShiftName = selectedShiftResolution.source === "core_unavailable"
    ? copy.scheduleUnavailable
    : selectedShiftResolution.shiftName;
  const selectedShiftSourceLabel = selectedCoreShift
    ? localizedCoreShiftSourceLabel(selectedCoreShift, copy)
    : selectedShiftResolution.source === "core_unavailable"
      ? copy.scheduleUnavailable
      : selectedShiftResolution.sourceLabel;
  const selectedTone = displayStatusTone(
    selectedStatus,
    viewerMode,
    copy,
    selectedCoreShift
  );
  const selectedCount = selectedEventCount(selectedRow);
  const selectedShiftDebugRows: Array<[string, string]> = [
    [copy.date, selectedShiftResolution.dateKey],
    [copy.startTime, selectedShiftResolution.startTime || copy.undefined],
    [copy.endTime, selectedShiftResolution.endTime || copy.undefined],
    [copy.lateGrace, `${selectedShiftResolution.lateGraceMinutes || 0} ${copy.minute}`],
    [copy.shiftName, selectedShiftName || copy.undefined],
    [copy.source, selectedShiftSourceLabel || copy.undefined],
    [copy.sourceType, selectedShiftResolution.sourceType || copy.undefined],
    [copy.sourceDocument, selectedShiftResolution.sourceDoc || copy.notFound],
    [copy.coreShift, selectedCoreShift ? localizedCoreShiftSourceLabel(selectedCoreShift, copy) : coreResolvedShiftsLoading ? copy.loading : copy.notFound],
    [copy.exceptionType, selectedShiftResolution.exceptionType || copy.none],
    [copy.active, selectedShiftResolution.active === null ? copy.undefined : selectedShiftResolution.active ? copy.yes : copy.no],
    [copy.fromPunch, selectedShiftResolution.recordResolvedShiftPresent ? copy.yes : copy.no],
    [copy.fromCore, selectedShiftResolution.coreResolvedShiftPresent ? copy.yes : copy.no],
    ["Fallback used", selectedShiftResolution.fallbackUsed ? copy.yes : copy.no],
    ["Fallback source", selectedShiftResolution.fallbackSource || copy.none],
    [copy.calculationTime, selectedShiftResolution.calculationTime],
    ...(coreResolvedShiftsError ? [[copy.coreError, coreResolvedShiftsError] as [string, string]] : []),
  ];
  const dayCount = daysInMonth(safeMonthKey);
  const blanks = firstWeekday(safeMonthKey);
  const calendarCells = [
    ...Array.from({ length: blanks }, (_, index) => ({ key: `blank-${index}`, blank: true as const })),
    ...Array.from({ length: dayCount }, (_, index) => {
      const day = index + 1;
      const dateKey = `${safeMonthKey}-${pad2(day)}`;
      const row = rowsByDate.get(dateKey) || null;
      const dayCoreShift = coreResolvedShifts?.[dateKey] || null;
      const dayRecords = recordsFromRow(row);
      const resolvedDay = computeResolvedAttendanceDay({
        dateKey,
        row: row as (StaffAttendanceWithId & Record<string, unknown>) | null,
        records: dayRecords,
        coreResolvedShift: dayCoreShift,
        permissionEntries,
        todayDateKey: todayKey,
        approvedLeaveDateKeys:
          leaveDateKeys,
        absenceDateKeys:
          absenceDateKeySet,
      });
      const status = resolvedDay.status;
      return {
        key: dateKey,
        blank: false as const,
        day,
        dateKey,
        status,
        tone: displayStatusTone(
          status,
          viewerMode,
          copy,
          dayCoreShift
        ),
        coreShift: dayCoreShift,
        isException:
          cleanText(
            dayCoreShift?.source
          ).toLowerCase() === "exception",
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

  const isScheduleUnavailable =
    selectedStatus ===
    "schedule_unavailable";

  const isWorkedDay =
    !isRestDay &&
    !isLeaveDay &&
    !isAbsentDay &&
    !isPendingDay &&
    !isScheduleUnavailable;

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
  const pickerYearLabel = new Intl.NumberFormat(language === "ar" ? "ar-SA-u-nu-latn" : "en-SA", { useGrouping: false }).format(pickerYear);
  const pickerMonths = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const key = `${pickerYear}-${pad2(month)}`;
    return {
      key,
      label: monthLabel(key, language),
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
    <section className={["attendance-month", "attendance-month--premium-v3", className].filter(Boolean).join(" ")} dir={language === "ar" ? "rtl" : "ltr"} lang={language}>
      {showSummaryTools ? (
        <div className="attendance-month__summary attendance-month__command-center">
          <div className="attendance-month__command-intro">
            <span className="attendance-month__command-icon" aria-hidden="true">
              <FontAwesomeIcon icon={faFingerprint} />
            </span>
            <div className="attendance-month__command-copy">
              <span className="attendance-month__eyebrow">{copy.attendanceManagement}</span>
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
              <span>{loading ? copy.updating : copy.refresh}</span>
            </button>
          </div>

          <div className="attendance-month__selected-overview">
            <div className="attendance-month__selected-overview-head">
              <span>{copy.selectedDay}</span>
              <span className={`attendance-month__selected-status is-${selectedTone}`}>
                {loading ? copy.loading : displayStatusLabel(selectedStatus, viewerMode, copy, selectedCoreShift)}
              </span>
            </div>
            <strong>{fullDateLabel(safeSelectedDate, language)}</strong>
            <small>{emptySummaryText}</small>
            {selectedShiftResolution ? (
              <small>
                {copy.shiftUsed}: {selectedShiftName} — {selectedShiftSourceLabel}
              </small>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="attendance-month__calendar-shell attendance-month__calendar-card">
        <div className="attendance-month__calendar-head">
          <div className="attendance-month__title">
            <span>{copy.attendanceCalendar}</span>
            <h3>{monthLabel(safeMonthKey, language)} {monthYearLabel(safeMonthKey, language)}</h3>
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
              <span className="attendance-month__month-picker-label">{copy.chooseMonth}</span>
            </button>
            {monthPickerOpen ? (
              <div className="attendance-month__month-menu" role="dialog" aria-label={copy.chooseMonth}>
                <div className="attendance-month__month-menu-head">
                  <span>{copy.year}</span>
                  <div className="attendance-month__year-switcher" aria-label={copy.chooseYear}>
                    <button
                      type="button"
                      className="attendance-month__year-button"
                      onClick={() => setPickerYear((year) => Math.max(oldestPickerYear, year - 1))}
                      disabled={pickerYear <= oldestPickerYear}
                      aria-label={copy.previousYear}
                    >
                      <FontAwesomeIcon icon={faChevronRight} />
                    </button>
                    <strong className="attendance-month__year-value">{pickerYearLabel}</strong>
                    <button
                      type="button"
                      className="attendance-month__year-button"
                      onClick={() => setPickerYear((year) => Math.min(newestPickerYear, year + 1))}
                      disabled={pickerYear >= newestPickerYear}
                      aria-label={copy.nextYear}
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
              <span>{copy.today}</span>
            </button>
          </div>
        </div>

        <div className="attendance-month__weekdays">
          {copy.week.map((label, index) => (
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
                  cell.isException ? "has-exception" : ""
                } ${
                  safeSelectedDate === cell.dateKey ? "is-selected" : ""
                } ${todayKey === cell.dateKey ? "is-today" : ""}`}
                onClick={() => onSelectedDateChange(cell.dateKey)}
                title={`${cell.dateKey} - ${displayStatusLabel(cell.status, viewerMode, copy, cell.coreShift)}`}
                aria-current={todayKey === cell.dateKey ? "date" : undefined}
                aria-selected={safeSelectedDate === cell.dateKey}
              >
                <span className="attendance-month__day-marker" />
                <strong>{cell.day}</strong>
                {viewerMode === "employee" ? (
                  <span className="attendance-month__primary-status-label">
                    {displayStatusLabel(cell.status, viewerMode, copy, cell.coreShift)}
                  </span>
                ) : null}
                {cell.isException && cell.status !== "off_day" ? (
                  <span className="attendance-month__exception-label">
                    {copy.exception}
                  </span>
                ) : null}
                {todayKey === cell.dateKey ? <span className="attendance-month__today-label">{copy.today}</span> : null}
              </button>
            )
          )}
        </div>
        <div className="attendance-month__legend" aria-label={copy.legend}>
          <span className="is-complete">{copy.present}</span>
          <span className="is-late">{copy.late}</span>
          <span className="is-partial">{copy.needsReview}</span>
          <span className="is-absent">{copy.absent}</span>
          <span className="is-leave">{copy.leave}</span>
          {viewerMode === "employee" ? <span className="is-off-day">{copy.weeklyRest}</span> : null}
          {viewerMode === "employee" ? <span className="is-exception">{copy.exception}</span> : null}
          {viewerMode === "admin" ? <span className="is-off-day">{copy.offDay}</span> : null}
        </div>
      </div>

      <div className="attendance-month__detail">
        <div className="attendance-month__detail-head">
          <div className="attendance-month__selected-date">
            <strong>{fullDateLabel(safeSelectedDate, language)}</strong>
            {safeSelectedDate === todayKey ? <span>{copy.today}</span> : null}
          </div>
          <div className="attendance-month__records-tab">
            <span>{copy.records}</span>
          </div>
        </div>

        <div className="attendance-month__records-meta">
          {selectedShiftResolution ? (
            <div className="attendance-month__shift-chip">
              <span>{selectedShiftSourceLabel}</span>
              <strong>{selectedShiftName}</strong>
              <small>{selectedShiftResolution.isOff ? copy.rest : `${selectedSchedule.startTime || "-"} — ${selectedSchedule.endTime || "-"}`}</small>
            </div>
          ) : null}
          {canShowAdminControls &&
          !isRestDay &&
          !isLeaveDay ? (
            <div className="attendance-month__actions">
              {shouldShowReview ? (
                <button type="button" onClick={() => (onReviewDay || onEditPunch)?.(safeSelectedDate)}>
                  <FontAwesomeIcon icon={faCheck} /> {copy.review}
                </button>
              ) : null}
              {shouldShowEmergencyLeave && selectedDayRecords.length === 0 ? (
                <button type="button" onClick={() => onCreateEmergencyLeave?.(safeSelectedDate)}>
                  <FontAwesomeIcon icon={faCalendarDay} /> {copy.registerLeave}
                </button>
              ) : null}
              {shouldShowEdit ? (
                <button type="button" onClick={() => onEditPunch?.(safeSelectedDate)} disabled={!onEditPunch}>
                  <FontAwesomeIcon icon={faPenToSquare} />
                  {selectedCount > 0
                    ? copy.editPunch
                    : copy.addPunch}
                </button>
              ) : null}
              {shouldShowDelete ? (
                <button
                  type="button"
                  className="is-danger"
                  onClick={() => onDeletePunch?.(safeSelectedDate)}
                  disabled={!onDeletePunch}
                >
                  <FontAwesomeIcon icon={faTrash} /> {copy.deletePunch}
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
                {displayStatusLabel(selectedStatus, viewerMode, copy, selectedCoreShift)}
              </span>

              <span className="attendance-month__record-count">
                <FontAwesomeIcon icon={faFingerprint} />

                {selectedCount === 1
                  ? copy.oneRecord
                  : `${selectedCount} ${copy.recordsCount}`}
              </span>
            </div>
          ) : null}
        </div>

        {viewerMode === "employee" ? (
          <div className="attendance-month__shift-debug" aria-label={copy.shiftUsed}>
            <div className="attendance-month__shift-debug-head">
              <strong>{copy.shiftUsed}</strong>
              <span>{selectedShiftResolution.fallbackUsed ? "Fallback" : "Canonical"}</span>
            </div>
            <dl>
              {selectedShiftDebugRows.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value || copy.undefined}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}

        {isRestDay ? (
          <div className={`attendance-month__state-card is-${selectedTone}`}>
            <div className="attendance-month__state-icon">
              <FontAwesomeIcon icon={faCalendarDay} />
            </div>

            <strong>{displayStatusLabel(selectedStatus, viewerMode, copy, selectedCoreShift)}</strong>
          </div>
        ) : isLeaveDay ? (
          <div className="attendance-month__state-card is-leave">
            <div className="attendance-month__state-icon">
              <FontAwesomeIcon icon={faCalendarDay} />
            </div>

            <strong>{copy.leave}</strong>
            {shouldShowCancelLeave ? (
              <button
                type="button"
                className="attendance-month__state-action is-danger"
                onClick={() => onCancelLeave?.(safeSelectedDate)}
              >
                {copy.cancelLeave}
              </button>
            ) : null}
          </div>
        ) : isAbsentDay ? (
          <div className="attendance-month__state-card is-absent">
            <div className="attendance-month__state-icon">
              <FontAwesomeIcon icon={faCalendarDay} />
            </div>

            <strong>{copy.absent}</strong>
          </div>
        ) : isScheduleUnavailable ? (
          <div className="attendance-month__state-card is-pending">
            <div className="attendance-month__state-icon">
              <FontAwesomeIcon icon={faCalendarDay} />
            </div>

            <strong>
              {copy.scheduleUnavailable}
            </strong>

            <span>
              {copy.scheduleUnavailableDetails}
            </span>
          </div>
        ) : isPendingDay ? (
          <div className="attendance-month__state-card is-pending">
            <div className="attendance-month__state-icon">
              <FontAwesomeIcon icon={faCalendarDay} />
            </div>

            <strong>{displayStatusLabel(selectedStatus, viewerMode, copy, selectedCoreShift)}</strong>
          </div>
        ) : (
          <div className="attendance-month__worked-day">
            <div
              className={`attendance-month__record attendance-month__record--premium is-${selectedTone}`}
            >
              <div className="attendance-month__record-main">
                <button
                  type="button"
                  aria-label={copy.recordOptions}
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

                  {formatHours(selectedComputation.actualHours, copy)}
                </span>
              </div>
            </div>
          </div>
        )}

        {isWorkedDay ? (
          <div className="attendance-month__worked-details">
            <div className="attendance-month__worked-metrics">
              <div className="attendance-month__worked-metric">
                <span>{copy.status}</span>
                <b>{displayStatusLabel(selectedStatus, viewerMode, copy, selectedCoreShift)}</b>
              </div>

              <div className="attendance-month__worked-metric">
                <span>{copy.checkInTime}</span>
                <b>
                  {formatTime(
                    selectedRow?.checkInAtClient
                  )}
                </b>
              </div>

              <div className="attendance-month__worked-metric">
                <span>{copy.checkOutTime}</span>
                <b>
                  {formatTime(
                    selectedRow?.checkOutAtClient
                  )}
                </b>
              </div>

              <div className="attendance-month__worked-metric">
                <span>{copy.workDuration}</span>
                <b>
                  {formatHours(selectedComputation.actualHours, copy)}
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
                    <span>{recordTypeLabel(record.type, copy)}</span>
                    <b>{formatTime(record.serverTime)}</b>
                    <small>{recordLocationLabel(record, copy)}</small>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="attendance-month__performance">
              {isPartialDay ? (
                <div className="attendance-month__performance-item is-review">
                  <FontAwesomeIcon icon={faClock} />
                  <span>{copy.recordStatus}</span>
                  <b>{copy.needsFinish}</b>
                </div>
              ) : (
                <>
                  {hasLate ? (
                    <div className="attendance-month__performance-item is-late">
                      <span>{copy.delay}</span>
                      <b>
                        {formatHours(selectedComputation.lateHours, copy)}
                      </b>
                    </div>
                  ) : null}

                  {hasPermissionCoverage ? (
                    <div className="attendance-month__performance-item is-review">
                      <span>{copy.coveredPermission}</span>
                      <b>{formatHours(selectedComputation.permissionCoveredHours, copy)}</b>
                      <small>{copy.requestDuration}: {formatHours(selectedComputation.permissionRequestedHours, copy)}</small>
                    </div>
                  ) : null}

                  {hasMissingHours ? (
                    <div className="attendance-month__performance-item is-missing">
                      <span>{copy.shortage}</span>
                      <b>
                        {formatHours(selectedComputation.missingHours, copy)}
                      </b>
                    </div>
                  ) : null}

                  {hasOvertime ? (
                    <div className="attendance-month__performance-item is-overtime">
                      <span>{copy.overtime}</span>
                      <b>
                        {formatHours(selectedComputation.overtimeHours, copy)}
                      </b>
                    </div>
                  ) : null}

                  {!hasLate &&
                  !hasMissingHours &&
                  !hasOvertime ? (
                    <div className="attendance-month__performance-item is-committed">
                      <FontAwesomeIcon icon={faCheck} />
                      <span>{copy.commitment}</span>
                      <b>{copy.committed}</b>
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
