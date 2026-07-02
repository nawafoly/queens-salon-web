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
  faTrash,
} from "@fortawesome/free-solid-svg-icons";

import type { StaffAttendanceWithId } from "../services/firestoreAttendance";
import {
  computeAttendanceDay,
  getAttendanceDayStatus,
  type AttendanceRecord,
  type AttendanceStatus,
  type ShiftSchedule,
} from "../helpers/hr/attendanceCalculations";
import { isWeeklyOffDateKey } from "../helpers/hr/workSchedule";
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
  customWorkingHours?: Record<string, { enabled?: boolean; start?: string; end?: string }> | null;
  customWorkingHourOverrides?: Array<{ date?: string; enabled?: boolean; start?: string; end?: string }> | null;
};

type AttendanceMonthViewProps = {
  rows: StaffAttendanceWithId[];
  loading?: boolean;
  monthKey: string;
  selectedDate: string;
  title?: string;
  subtitle?: string;
  emptySummaryText?: string;
  viewerMode?: AttendanceViewerMode;
  canEdit?: boolean;
  canDelete?: boolean;
  canReview?: boolean;
  showAdminActions?: boolean;
  showSummaryTools?: boolean;
  schedule?: AttendanceScheduleInput | null;
  approvedLeaveDateKeys?: Iterable<string>;
  onMonthChange: (monthKey: string) => void;
  onSelectedDateChange: (dateKey: string) => void;
  onGenerateSummary?: () => void;
  onEditPunch?: (dateKey: string) => void;
  onDeletePunch?: (dateKey: string) => void;
  onReviewDay?: (dateKey: string) => void;
};

const WEEK_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
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

function getRiyadhTodayKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
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

function shiftMonth(monthKey: string, delta: number) {
  const [year, month] = normalizeMonthKey(monthKey).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}`;
}

function daysInMonth(monthKey: string) {
  const [year, month] = normalizeMonthKey(monthKey).split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function firstWeekday(monthKey: string) {
  const [year, month] = normalizeMonthKey(monthKey).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
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

function scheduleForDate(dateKey: string, input?: AttendanceScheduleInput | null): ShiftSchedule {
  const source = input || {};
  const weekdayKey = weekdayKeyForDate(dateKey);
  const customDay = source.customWorkingHours?.[weekdayKey];
  const override = getDayOverride(dateKey, source);
  const customOffDays = Object.entries(source.customWorkingHours || {})
    .filter(([, day]) => day?.enabled === false)
    .map(([key]) => WEEKDAY_TO_OFF_KEY[key as keyof typeof WEEKDAY_TO_OFF_KEY])
    .filter(Boolean);
  const explicitOffDays = [
    ...(Array.isArray(source.weeklyOffDays) ? source.weeklyOffDays : []),
    ...(Array.isArray(source.offDays) ? source.offDays : []),
    ...(Array.isArray(source.exceptionalLeaveWeekdays) ? source.exceptionalLeaveWeekdays : []),
    ...(source.weeklyOffDay ? [source.weeklyOffDay] : []),
  ];

  const startTime =
    cleanTime(override?.start) ||
    cleanTime(customDay?.start) ||
    cleanTime(source.startTime) ||
    cleanTime(source.start) ||
    cleanTime(source.workStartTime) ||
    cleanTime(source.shiftStartTime) ||
    "09:00";
  const endTime =
    cleanTime(override?.end) ||
    cleanTime(customDay?.end) ||
    cleanTime(source.endTime) ||
    cleanTime(source.end) ||
    cleanTime(source.workEndTime) ||
    cleanTime(source.shiftEndTime) ||
    "17:00";

  return {
    startTime,
    endTime,
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

function formatSignedHours(value: number) {
  if (!Number.isFinite(value) || value === 0) return "0";
  const sign = value > 0 ? "+" : "-";
  return `${sign}${formatHours(Math.abs(value))}`;
}

function recordsFromRow(row: StaffAttendanceWithId | null): AttendanceRecord[] {
  const records: AttendanceRecord[] = [];
  if (row?.checkInAtClient) {
    records.push({ id: `${row.id}-in`, type: "check_in", serverTime: row.checkInAtClient });
  }
  if (row?.checkOutAtClient) {
    records.push({ id: `${row.id}-out`, type: "check_out", serverTime: row.checkOutAtClient });
  }
  return records;
}

function statusTone(status: AttendanceStatus) {
  if (status === "present") return "complete";
  if (status === "partial" || status === "today_pending") return "partial";
  if (status === "absent") return "absent";
  if (status === "off_day") return "off-day";
  if (status === "leave") return "leave";
  return "none";
}

function statusLabel(status: AttendanceStatus) {
  if (status === "present") return "حضور مكتمل";
  if (status === "partial") return "حضور يحتاج مراجعة";
  if (status === "absent") return "غياب";
  if (status === "off_day") return "يوم راحة أسبوعية";
  if (status === "leave") return "إجازة";
  if (status === "today_pending") return "بانتظار تسجيل اليوم";
  return "يوم قادم";
}

function statusMessage(status: AttendanceStatus) {
  if (status === "present") return "تم تسجيل الحضور والانصراف لهذا اليوم.";
  if (status === "partial") return "يوجد حضور بدون اكتمال الانصراف أو يحتاج مراجعة.";
  if (status === "absent") return "غياب - لا يوجد سجل حضور.";
  if (status === "off_day") return "هذا اليوم ضمن أيام الراحة الأسبوعية.";
  if (status === "leave") return "هذا اليوم مسجل ضمن الإجازات.";
  if (status === "today_pending") return "لم يتم تسجيل حضور لهذا اليوم حتى الآن.";
  return "هذا اليوم لم يبدأ بعد.";
}

function selectedEventCount(row: StaffAttendanceWithId | null) {
  return (row?.checkInAtClient ? 1 : 0) + (row?.checkOutAtClient ? 1 : 0);
}

export default function AttendanceMonthView({
  rows,
  loading = false,
  monthKey,
  selectedDate,
  title = "سجل الحضور الشهري",
  subtitle = "اختر الشهر واليوم لعرض حالة الحضور وتفاصيل السجل.",
  emptySummaryText = "اختر يومًا من التقويم لعرض تفاصيل الحضور.",
  viewerMode = "employee",
  canEdit,
  canDelete,
  canReview,
  showAdminActions = false,
  showSummaryTools = true,
  schedule,
  approvedLeaveDateKeys,
  onMonthChange,
  onSelectedDateChange,
  onGenerateSummary,
  onEditPunch,
  onDeletePunch,
  onReviewDay,
}: AttendanceMonthViewProps) {
  const safeMonthKey = normalizeMonthKey(monthKey);
  const todayKey = getRiyadhTodayKey();
  const leaveDateKeys = new Set(Array.from(approvedLeaveDateKeys || []).map(normalizeDateKey).filter(Boolean));
  const rowsByDate = new Map(rows.map((row) => [normalizeDateKey(row.date) || row.id, row]));
  const safeSelectedDate =
    normalizeDateKey(selectedDate) && selectedDate.startsWith(safeMonthKey)
      ? selectedDate
      : `${safeMonthKey}-01`;
  const selectedRow = rowsByDate.get(safeSelectedDate) || null;
  const selectedSchedule = scheduleForDate(safeSelectedDate, schedule);
  const selectedComputation = computeAttendanceDay(
    safeSelectedDate,
    recordsFromRow(selectedRow),
    selectedSchedule
  );
  const selectedStatus = getAttendanceDayStatus({
    date: safeSelectedDate,
    hasAttendance: Boolean(selectedRow?.checkInAtClient || selectedRow?.checkOutAtClient),
    checkOut: selectedComputation.checkOut,
    computation: selectedComputation,
    todayDateKey: todayKey,
    weeklyOffDays: selectedSchedule.weeklyOffDays,
    approvedLeaveDateKeys: leaveDateKeys,
    holidayDateKeys: isDateSpecificOff(safeSelectedDate, schedule) ? [safeSelectedDate] : [],
  });
  const selectedTone = statusTone(selectedStatus);
  const selectedCount = selectedEventCount(selectedRow);
  const dayCount = daysInMonth(safeMonthKey);
  const blanks = firstWeekday(safeMonthKey);
  const calendarCells = [
    ...Array.from({ length: blanks }, (_, index) => ({ key: `blank-${index}`, blank: true as const })),
    ...Array.from({ length: dayCount }, (_, index) => {
      const day = index + 1;
      const dateKey = `${safeMonthKey}-${pad2(day)}`;
      const row = rowsByDate.get(dateKey) || null;
      const daySchedule = scheduleForDate(dateKey, schedule);
      const computation = computeAttendanceDay(dateKey, recordsFromRow(row), daySchedule);
      const status = getAttendanceDayStatus({
        date: dateKey,
        hasAttendance: Boolean(row?.checkInAtClient || row?.checkOutAtClient),
        checkOut: computation.checkOut,
        computation,
        todayDateKey: todayKey,
        weeklyOffDays: daySchedule.weeklyOffDays,
        approvedLeaveDateKeys: leaveDateKeys,
        holidayDateKeys: isDateSpecificOff(dateKey, schedule) ? [dateKey] : [],
      });
      return {
        key: dateKey,
        blank: false as const,
        day,
        dateKey,
        status,
        tone: statusTone(status),
      };
    }),
  ];

  const canShowAdminControls = viewerMode === "admin" || showAdminActions;
  const shouldShowEdit = canShowAdminControls && (canEdit ?? showAdminActions);
  const shouldShowDelete = canShowAdminControls && (canDelete ?? showAdminActions);
  const shouldShowReview = canShowAdminControls && (canReview ?? showAdminActions);
  const differenceHours = selectedComputation.actualHours - selectedComputation.expectedHours;
  const isWeeklyOff = isWeeklyOffDateKey(safeSelectedDate, selectedSchedule.weeklyOffDays);

  return (
    <section className="attendance-month" dir="rtl">
      {showSummaryTools ? (
        <div className="attendance-month__summary">
          <div className="attendance-month__summary-copy">
            <h3>{title}</h3>
            <p>{subtitle}</p>
          </div>
          <div className="attendance-month__summary-tools">
            <button
              type="button"
              className="attendance-month__primary"
              onClick={onGenerateSummary}
              disabled={loading || !onGenerateSummary}
            >
              تحديث السجلات
            </button>
            <label className="attendance-month__month-input">
              <FontAwesomeIcon icon={faCalendarDay} />
              <input
                type="month"
                value={safeMonthKey}
                onChange={(event) => onMonthChange(normalizeMonthKey(event.target.value))}
              />
              <span>الشهر</span>
            </label>
          </div>
          <div className="attendance-month__summary-empty">
            {loading ? "جاري تحميل سجلات الحضور..." : emptySummaryText}
          </div>
        </div>
      ) : null}

      <div className="attendance-month__calendar-shell">
        <button
          type="button"
          className="attendance-month__arrow attendance-month__arrow--prev"
          onClick={() => onMonthChange(shiftMonth(safeMonthKey, -1))}
          aria-label="الشهر السابق"
        >
          <FontAwesomeIcon icon={faChevronRight} />
        </button>
        <button
          type="button"
          className="attendance-month__arrow attendance-month__arrow--next"
          onClick={() => onMonthChange(shiftMonth(safeMonthKey, 1))}
          aria-label="الشهر التالي"
        >
          <FontAwesomeIcon icon={faChevronLeft} />
        </button>

        <div className="attendance-month__title">
          <h3>{showSummaryTools ? monthLabel(safeMonthKey) : "الحضور"}</h3>
          <span>{monthLabel(safeMonthKey)} {monthYearLabel(safeMonthKey)}</span>
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
                }`}
                onClick={() => onSelectedDateChange(cell.dateKey)}
                title={`${cell.dateKey} - ${statusLabel(cell.status)}`}
              >
                <span className="attendance-month__day-marker" />
                <strong>{cell.day}</strong>
              </button>
            )
          )}
        </div>
      </div>

      <div className="attendance-month__detail">
        <div className="attendance-month__detail-head">
          <span className="attendance-month__leave">إجازتي</span>
          <div className="attendance-month__records-tab">
            <span>السجلات</span>
          </div>
        </div>

        <div className="attendance-month__records-meta">
          {canShowAdminControls ? (
            <div className="attendance-month__actions">
              {shouldShowReview ? (
                <button type="button" onClick={() => (onReviewDay || onEditPunch)?.(safeSelectedDate)}>
                  <FontAwesomeIcon icon={faCheck} /> مراجعة
                </button>
              ) : null}
              {shouldShowEdit ? (
                <button type="button" onClick={() => onEditPunch?.(safeSelectedDate)} disabled={!onEditPunch}>
                  <FontAwesomeIcon icon={faPenToSquare} /> تعديل البصمة
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
          <div className="attendance-month__count">
            <span className={`attendance-month__badge is-${selectedTone}`}>{statusLabel(selectedStatus)}</span>
            <b>{selectedCount}</b>
            <FontAwesomeIcon icon={faFingerprint} />
          </div>
        </div>

        {selectedStatus === "off_day" || isWeeklyOff ? (
          <div className="attendance-month__empty is-off-day">
            <FontAwesomeIcon icon={faCalendarDay} />
            <strong>يوم راحة أسبوعية</strong>
            <span>هذا اليوم ضمن أيام الراحة الأسبوعية، ولا يعرض كغياب محسوب.</span>
          </div>
        ) : selectedStatus === "absent" ? (
          <div className="attendance-month__empty is-absent">
            <FontAwesomeIcon icon={faCalendarDay} />
            <strong>غياب - لا يوجد سجل حضور</strong>
            <span>هذا يوم عمل سابق بلا سجلات حضور، ويظهر كغياب محسوب.</span>
          </div>
        ) : selectedStatus === "future" || selectedStatus === "today_pending" ? (
          <div className="attendance-month__empty">
            <FontAwesomeIcon icon={faCalendarDay} />
            <strong>{statusMessage(selectedStatus)}</strong>
            <span>{safeSelectedDate}</span>
          </div>
        ) : (
          <div className={`attendance-month__record is-${selectedTone}`}>
            <div className="attendance-month__record-main">
              <button type="button" aria-label="خيارات السجل">
                <FontAwesomeIcon icon={faEllipsisVertical} />
              </button>
              <strong>
                {formatTime(selectedRow?.checkInAtClient)} — {formatTime(selectedRow?.checkOutAtClient)}
              </strong>
              <span>
                <FontAwesomeIcon icon={faClock} /> {formatHours(selectedComputation.actualHours)}
              </span>
            </div>
          </div>
        )}

        <div className={`attendance-month__metrics is-${selectedTone}`}>
          <div>
            <span>الحالة</span>
            <b>{statusLabel(selectedStatus)}</b>
          </div>
          <div>
            <span>أول حضور</span>
            <b>{formatTime(selectedRow?.checkInAtClient)}</b>
          </div>
          <div>
            <span>آخر انصراف</span>
            <b>{formatTime(selectedRow?.checkOutAtClient)}</b>
          </div>
          <div>
            <span>مدة العمل</span>
            <b>{formatHours(selectedComputation.actualHours)}</b>
          </div>
          <div>
            <span>الفرق</span>
            <b>{selectedStatus === "absent" ? "0" : formatSignedHours(differenceHours)}</b>
          </div>
        </div>

        <div className={`attendance-month__wide-metrics is-${selectedTone}`}>
          <div>
            <span>الأوفر تايم</span>
            <b>{formatHours(selectedComputation.overtimeHours)}</b>
          </div>
          <div>
            <span>التأخير</span>
            <b>{formatHours(selectedComputation.lateHours)}</b>
          </div>
          <div>
            <span>نقص الساعات</span>
            <b>{formatHours(selectedComputation.missingHours)}</b>
          </div>
        </div>
      </div>
    </section>
  );
}
