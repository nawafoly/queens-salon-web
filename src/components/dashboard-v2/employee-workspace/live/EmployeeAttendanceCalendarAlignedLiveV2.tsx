import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { createPortal } from "react-dom";

import { EmployeeAttendanceTabLiveV2 as EmployeeAttendanceTabBaseLiveV2 } from "./EmployeeWorkspaceOperationalTabsLiveV2";

const MONTH_NAMES = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

function monthStartWeekday(monthKey: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(monthKey || "").trim());
  if (!match) return 0;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  return new Date(Date.UTC(year, monthIndex, 1, 12)).getUTCDay();
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function AttendanceMonthSearchIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="17" height="17">
      <path
        d="M5.5 4.5h9a2 2 0 0 1 2 2v8.2a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M7 2.9v3.2M13 2.9v3.2M3.7 8.2h12.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="17.4" cy="17.3" r="3.1" stroke="currentColor" strokeWidth="1.7" />
      <path d="m19.7 19.6 2 2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon({ direction }: { direction: "prev" | "next" }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" width="15" height="15">
      <path
        d={direction === "prev" ? "m12.5 4.5-5 5 5 5" : "m7.5 4.5 5 5-5 5"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type EmployeeAttendanceTabBaseProps = ComponentProps<typeof EmployeeAttendanceTabBaseLiveV2>;

export function EmployeeAttendanceCalendarAlignedLiveV2(props: EmployeeAttendanceTabBaseProps) {
  const weekdayOffset = monthStartWeekday(props.monthKey);
  const rootRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [toolbarTarget, setToolbarTarget] = useState<HTMLElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const normalizedMonth = /^\d{4}-\d{2}$/.test(String(props.monthKey || "").trim())
    ? String(props.monthKey).trim()
    : localDateKey().slice(0, 7);
  const selectedYear = Number(normalizedMonth.slice(0, 4));
  const selectedMonth = Number(normalizedMonth.slice(5, 7));
  const [viewYear, setViewYear] = useState(selectedYear);

  useEffect(() => {
    setViewYear(selectedYear);
  }, [selectedYear]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const syncToolbarTarget = () => {
      setToolbarTarget(
        root.querySelector<HTMLElement>(
          ".dsv2-ew-attendance-calendar-card .dsv2-ew-card__actions"
        )
      );
    };

    syncToolbarTarget();
    const observer = new MutationObserver(syncToolbarTarget);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pickerOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (pickerRef.current?.contains(event.target as Node)) return;
      setPickerOpen(false);
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPickerOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [pickerOpen]);

  const selectMonth = (monthIndex: number) => {
    const nextMonth = `${viewYear}-${String(monthIndex + 1).padStart(2, "0")}`;
    const today = localDateKey();
    props.onMonthChange(nextMonth);
    props.onSelectedDateChange(
      nextMonth === today.slice(0, 7) ? today : `${nextMonth}-01`
    );
    setPickerOpen(false);
  };

  const compactMonthPicker = toolbarTarget
    ? createPortal(
        <div ref={pickerRef} className="dsv2-ew-attendance-month-control">
          <button
            type="button"
            className="dsv2-ew-icon-btn dsv2-ew-attendance-month-trigger"
            aria-label="اختيار شهر الحضور"
            aria-expanded={pickerOpen}
            title="اختيار الشهر"
            disabled={props.readOnly || props.loading}
            onClick={() => setPickerOpen((current) => !current)}
          >
            <AttendanceMonthSearchIcon />
          </button>

          {pickerOpen ? (
            <div className="dsv2-ew-attendance-month-popover" role="dialog" aria-label="اختيار شهر الحضور">
              <div className="dsv2-ew-attendance-month-popover__head">
                <button
                  type="button"
                  className="dsv2-ew-attendance-month-nav"
                  aria-label="السنة السابقة"
                  onClick={() => setViewYear((year) => year - 1)}
                >
                  <ChevronIcon direction="prev" />
                </button>
                <strong>{viewYear}</strong>
                <button
                  type="button"
                  className="dsv2-ew-attendance-month-nav"
                  aria-label="السنة التالية"
                  onClick={() => setViewYear((year) => year + 1)}
                >
                  <ChevronIcon direction="next" />
                </button>
              </div>

              <div className="dsv2-ew-attendance-month-picker-grid" role="grid">
                {MONTH_NAMES.map((monthName, index) => {
                  const active = viewYear === selectedYear && index + 1 === selectedMonth;
                  return (
                    <button
                      key={monthName}
                      type="button"
                      className="dsv2-ew-attendance-month-option"
                      data-active={active ? "true" : "false"}
                      aria-current={active ? "date" : undefined}
                      onClick={() => selectMonth(index)}
                    >
                      {monthName}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                className="dsv2-ew-attendance-month-current"
                onClick={() => {
                  const today = localDateKey();
                  const nextMonth = today.slice(0, 7);
                  props.onMonthChange(nextMonth);
                  props.onSelectedDateChange(today);
                  setPickerOpen(false);
                }}
              >
                هذا الشهر
              </button>
            </div>
          ) : null}
        </div>,
        toolbarTarget
      )
    : null;

  return (
    <div
      ref={rootRef}
      className={`dsv2-ew-attendance-calendar-alignment dsv2-ew-attendance-calendar-alignment--start-${weekdayOffset}`}
    >
      {compactMonthPicker}
      <EmployeeAttendanceTabBaseLiveV2 {...props} />
    </div>
  );
}
