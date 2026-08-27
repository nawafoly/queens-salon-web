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
  attendanceResolvedShiftSourceLabel,
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

const WEEK_LABELS = ["سبت", "أحد", "اثنين", "ثلاثاء", "أربعاء", "خميس", "جمعة"];
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
  return recordsFromAttendanceRow(row as (StaffAttendanceWithId & Record<string, unknown>) | null);
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

function statusLabel(status: AttendanceStatus) {
  if (status === "present") return "\u062d\u0636\u0648\u0631 \u0645\u0643\u062a\u0645\u0644";
  if (status === "late") return "\u0645\u062a\u0623\u062e\u0631";
  if (status === "missing_hours") return "\u0646\u0627\u0642\u0635 \u0633\u0627\u0639\u0627\u062a";
  if (status === "in_progress") return "\u0628\u0627\u0646\u062a\u0638\u0627\u0631 \u0627\u0644\u0627\u0646\u0635\u0631\u0627\u0641";
  if (status === "partial") return "\u0628\u0635\u0645\u0629 \u062a\u062d\u062a\u0627\u062c \u0625\u0643\u0645\u0627\u0644";
  if (status === "absent") return "\u063a\u064a\u0627\u0628";
  if (status === "off_day") return "\u064a\u0648\u0645 \u0631\u0627\u062d\u0629";
  if (status === "leave") return "\u0625\u062c\u0627\u0632\u0629";
  if (status === "today_pending") return "\u0644\u0645 \u064a\u0633\u062c\u0644 \u0628\u0639\u062f";
  if (status === "schedule_unavailable") {
    return "\u0627\u0644\u062f\u0648\u0627\u0645 \u0627\u0644\u0645\u0639\u062a\u0645\u062f \u063a\u064a\u0631 \u0645\u062a\u0627\u062d";
  }
  return "\u064a\u0648\u0645 \u0642\u0627\u062f\u0645";
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
  const selectedTone = displayStatusTone(selectedStatus, viewerMode);
  const selectedCount = selectedEventCount(selectedRow);
  const selectedShiftDebugRows: Array<[string, string]> = [
    ["التاريخ", selectedShiftResolution.dateKey],
    ["وقت البداية", selectedShiftResolution.startTime || "غير محدد"],
    ["وقت النهاية", selectedShiftResolution.endTime || "غير محدد"],
    ["سماح التأخير", `${selectedShiftResolution.lateGraceMinutes || 0} دقيقة`],
    ["اسم الشفت", selectedShiftResolution.shiftName || "غير محدد"],
    ["المصدر", selectedShiftResolution.sourceLabel || "غير محدد"],
    ["نوع المصدر", selectedShiftResolution.sourceType || "غير محدد"],
    ["مستند المصدر", selectedShiftResolution.sourceDoc || "غير موجود"],
    ["Core resolved shift", selectedCoreShift ? attendanceResolvedShiftSourceLabel(selectedCoreShift) : coreResolvedShiftsLoading ? "جاري التحميل" : "غير موجود"],
    ["نوع الاستثناء", selectedShiftResolution.exceptionType || "لا يوجد"],
    ["نشط", selectedShiftResolution.active === null ? "غير محدد" : selectedShiftResolution.active ? "نعم" : "لا"],
    ["من سجل البصمة", selectedShiftResolution.recordResolvedShiftPresent ? "نعم" : "لا"],
    ["من Core", selectedShiftResolution.coreResolvedShiftPresent ? "نعم" : "لا"],
    ["Fallback used", selectedShiftResolution.fallbackUsed ? "نعم" : "لا"],
    ["Fallback source", selectedShiftResolution.fallbackSource || "لا يوجد"],
    ["وقت الحساب", selectedShiftResolution.calculationTime],
    ...(coreResolvedShiftsError ? [["خطأ Core", coreResolvedShiftsError] as [string, string]] : []),
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
            {selectedShiftResolution ? (
              <small>
                الشفت المستخدم للحساب: {selectedShiftResolution.shiftName} — {selectedShiftResolution.sourceLabel}
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
          {selectedShiftResolution ? (
            <div className="attendance-month__shift-chip">
              <span>{selectedShiftResolution.sourceLabel}</span>
              <strong>{selectedShiftResolution.shiftName}</strong>
              <small>{selectedShiftResolution.isOff ? "راحة" : `${selectedSchedule.startTime || "-"} — ${selectedSchedule.endTime || "-"}`}</small>
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

        {viewerMode === "employee" ? (
          <div className="attendance-month__shift-debug" aria-label="الشفت المستخدم للحساب">
            <div className="attendance-month__shift-debug-head">
              <strong>الشفت المستخدم للحساب</strong>
              <span>{selectedShiftResolution.fallbackUsed ? "Fallback" : "Canonical"}</span>
            </div>
            <dl>
              {selectedShiftDebugRows.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value || "غير محدد"}</dd>
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
        ) : isScheduleUnavailable ? (
          <div className="attendance-month__state-card is-pending">
            <div className="attendance-month__state-icon">
              <FontAwesomeIcon icon={faCalendarDay} />
            </div>

            <strong>
              {"\u0627\u0644\u062f\u0648\u0627\u0645 \u0627\u0644\u0645\u0639\u062a\u0645\u062f \u063a\u064a\u0631 \u0645\u062a\u0627\u062d"}
            </strong>

            <span>
              {"\u062a\u0639\u0630\u0631 \u0627\u0644\u062d\u0635\u0648\u0644 \u0639\u0644\u0649 \u0627\u0644\u0634\u0641\u062a \u0627\u0644\u0645\u0639\u062a\u0645\u062f \u0645\u0646 Malikat Core. \u0644\u0645 \u064a\u062a\u0645 \u0627\u0633\u062a\u062e\u062f\u0627\u0645 \u0623\u064a \u062c\u062f\u0648\u0644 \u0642\u062f\u064a\u0645 \u0643\u0628\u062f\u064a\u0644."}
            </span>
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
