import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalendarDay,
  faChevronLeft,
  faChevronRight,
  faClock,
  faEllipsisVertical,
  faFingerprint,
  faTrash,
} from "@fortawesome/free-solid-svg-icons";

import type { StaffAttendanceWithId } from "../services/firestoreAttendance";
import "../styles/AttendanceMonthView.css";

type AttendanceMonthViewProps = {
  rows: StaffAttendanceWithId[];
  loading?: boolean;
  monthKey: string;
  selectedDate: string;
  title?: string;
  subtitle?: string;
  emptySummaryText?: string;
  showAdminActions?: boolean;
  showSummaryTools?: boolean;
  onMonthChange: (monthKey: string) => void;
  onSelectedDateChange: (dateKey: string) => void;
  onGenerateSummary?: () => void;
  onEditPunch?: (dateKey: string) => void;
  onDeletePunch?: (dateKey: string) => void;
};

const WEEK_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function normalizeMonthKey(value: string) {
  const s = String(value || "").trim();
  return /^\d{4}-\d{2}$/.test(s) ? s : new Date().toISOString().slice(0, 7);
}

function normalizeDateKey(value: string) {
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
  const [year, month] = normalizeMonthKey(monthKey).split("-").map(Number);
  return new Intl.NumberFormat("ar-SA", { useGrouping: false }).format(year).replace(/\u066c/g, "") ||
    String(year);
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

function minutesBetween(start?: string, end?: string) {
  if (!start || !end) return 0;
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.round((b - a) / 60000);
}

function durationLabel(totalMinutes: number) {
  if (!totalMinutes) return "--";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!minutes) return `${hours} ساعة`;
  return `${hours} ساعة و ${minutes} دقيقة`;
}

function rowTone(row: StaffAttendanceWithId | null, dateKey: string, todayKey: string) {
  if (row?.type === "absent" || row?.absentFullDay) return "absent";
  if (row?.status === "checked_out" && row.checkInAtClient && row.checkOutAtClient) return "complete";
  if (row?.status === "checked_in" || row?.checkInAtClient) return "partial";
  if (dateKey < todayKey && row && row.status === "not_started") return "absent";
  return "none";
}

function toneLabel(tone: string) {
  if (tone === "complete") return "حضور مكتمل";
  if (tone === "partial") return "حضور يحتاج مراجعة";
  if (tone === "absent") return "غياب";
  return "بانتظار تسجيل اليوم";
}

function selectedEventCount(row: StaffAttendanceWithId | null) {
  if (!row) return 0;
  return (row.checkInAtClient ? 1 : 0) + (row.checkOutAtClient ? 1 : 0);
}

export default function AttendanceMonthView({
  rows,
  loading = false,
  monthKey,
  selectedDate,
  title = "ملخص الحضور الشهري",
  subtitle = "اختر شهرًا لتوليد أو عرض الملخص المحفوظ بدون حذف أو أرشفة للسجلات.",
  emptySummaryText = 'لا يوجد ملخص محفوظ لهذا الشهر بعد. اضغط "توليد ملخص الشهر" لإنشاء القراءة الأولى.',
  showAdminActions = false,
  showSummaryTools = true,
  onMonthChange,
  onSelectedDateChange,
  onGenerateSummary,
  onEditPunch,
  onDeletePunch,
}: AttendanceMonthViewProps) {
  const safeMonthKey = normalizeMonthKey(monthKey);
  const todayKey = new Date().toISOString().slice(0, 10);
  const rowsByDate = new Map(rows.map((row) => [normalizeDateKey(row.date) || row.id, row]));
  const safeSelectedDate =
    normalizeDateKey(selectedDate) && selectedDate.startsWith(safeMonthKey)
      ? selectedDate
      : `${safeMonthKey}-01`;
  const selectedRow = rowsByDate.get(safeSelectedDate) || null;
  const selectedTone = rowTone(selectedRow, safeSelectedDate, todayKey);
  const selectedMinutes = minutesBetween(selectedRow?.checkInAtClient, selectedRow?.checkOutAtClient);
  const selectedCount = selectedEventCount(selectedRow);
  const dayCount = daysInMonth(safeMonthKey);
  const blanks = firstWeekday(safeMonthKey);
  const calendarCells = [
    ...Array.from({ length: blanks }, (_, index) => ({ key: `blank-${index}`, blank: true as const })),
    ...Array.from({ length: dayCount }, (_, index) => {
      const day = index + 1;
      const dateKey = `${safeMonthKey}-${pad2(day)}`;
      const row = rowsByDate.get(dateKey) || null;
      return {
        key: dateKey,
        blank: false as const,
        day,
        dateKey,
        row,
        tone: rowTone(row, dateKey, todayKey),
      };
    }),
  ];

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
              توليد ملخص الشهر
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
          <h3>{monthLabel(safeMonthKey)}</h3>
          <span>{monthYearLabel(safeMonthKey)}</span>
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
          {showAdminActions ? (
            <div className="attendance-month__actions">
              <button type="button" onClick={() => onEditPunch?.(safeSelectedDate)} disabled={!onEditPunch}>
                تعديل البصمة
              </button>
              <button
                type="button"
                className="is-danger"
                onClick={() => onDeletePunch?.(safeSelectedDate)}
                disabled={!onDeletePunch}
              >
                <FontAwesomeIcon icon={faTrash} /> مسح البصمة
              </button>
            </div>
          ) : (
            <div />
          )}
          <div className="attendance-month__count">
            <span className={`attendance-month__badge is-${selectedTone}`}>{toneLabel(selectedTone)}</span>
            <b>{selectedCount}</b>
            <FontAwesomeIcon icon={faFingerprint} />
          </div>
        </div>

        {selectedTone === "none" ? (
          <div className="attendance-month__empty">
            <FontAwesomeIcon icon={faCalendarDay} />
            <strong>لم يتم تسجيل حضور لهذا اليوم حتى الآن</strong>
            <span>لا توجد بيانات حضور فعالة لليوم المحدد.</span>
          </div>
        ) : selectedTone === "absent" ? (
          <div className="attendance-month__empty is-absent">
            <FontAwesomeIcon icon={faCalendarDay} />
            <strong>غياب - لا يوجد سجل حضور</strong>
            <span>هذا يوم عمل سابق بلا سجلات حضور، ويتعامل كغياب محسوب.</span>
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
                <FontAwesomeIcon icon={faClock} /> {durationLabel(selectedMinutes)}
              </span>
            </div>
          </div>
        )}

        <div className={`attendance-month__metrics is-${selectedTone}`}>
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
            <b>{durationLabel(selectedMinutes)}</b>
          </div>
          <div>
            <span>الفرق</span>
            <b>0</b>
          </div>
        </div>

        <div className={`attendance-month__wide-metrics is-${selectedTone}`}>
          <div>
            <span>الأوفر تايم</span>
            <b>--</b>
          </div>
          <div>
            <span>التأخير</span>
            <b>--</b>
          </div>
          <div>
            <span>نقص الساعات</span>
            <b>--</b>
          </div>
        </div>
      </div>
    </section>
  );
}
