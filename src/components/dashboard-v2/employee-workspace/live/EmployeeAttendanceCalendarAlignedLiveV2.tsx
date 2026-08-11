import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ComponentProps,
} from "react";
import { createPortal } from "react-dom";

import { EmployeeAttendanceTabLiveV2 as EmployeeAttendanceTabBaseLiveV2 } from "./EmployeeWorkspaceOperationalTabsLiveV2";
import "../../../../styles/dashboard-v2/pages/employee-attendance-calendar-alignment.css";

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

function openMonthPicker(input: HTMLInputElement | null) {
  if (!input) return;
  if (typeof input.showPicker === "function") {
    input.showPicker();
    return;
  }
  input.click();
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

type EmployeeAttendanceTabBaseProps = ComponentProps<typeof EmployeeAttendanceTabBaseLiveV2>;

export function EmployeeAttendanceCalendarAlignedLiveV2(props: EmployeeAttendanceTabBaseProps) {
  const weekdayOffset = monthStartWeekday(props.monthKey);
  const rootRef = useRef<HTMLDivElement>(null);
  const monthInputRef = useRef<HTMLInputElement>(null);
  const [toolbarTarget, setToolbarTarget] = useState<HTMLElement | null>(null);
  const pickerMonth = /^\d{4}-\d{2}$/.test(String(props.monthKey || "").trim())
    ? String(props.monthKey).trim()
    : "";

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

  const handleMonthPickerChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextMonth = event.target.value;
    if (!/^\d{4}-\d{2}$/.test(nextMonth)) return;
    const today = localDateKey();
    props.onMonthChange(nextMonth);
    props.onSelectedDateChange(
      nextMonth === today.slice(0, 7) ? today : `${nextMonth}-01`
    );
  };

  const compactMonthPicker = toolbarTarget
    ? createPortal(
        <>
          <button
            type="button"
            className="dsv2-ew-icon-btn dsv2-ew-attendance-month-trigger"
            aria-label="اختيار شهر الحضور"
            title="اختيار الشهر"
            disabled={props.readOnly || props.loading}
            onClick={() => openMonthPicker(monthInputRef.current)}
          >
            <AttendanceMonthSearchIcon />
          </button>
          <input
            ref={monthInputRef}
            className="dsv2-ew-attendance-month-native"
            type="month"
            value={pickerMonth}
            disabled={props.readOnly || props.loading}
            aria-label="شهر الحضور"
            tabIndex={-1}
            onChange={handleMonthPickerChange}
          />
        </>,
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
