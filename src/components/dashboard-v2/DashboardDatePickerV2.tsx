import { createPortal } from "react-dom";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import useDashboardFloatingPositionV2 from "./useDashboardFloatingPositionV2";

export type DashboardDatePickerV2Props = {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  min?: string;
  max?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  clearable?: boolean;
  className?: string;
  "aria-describedby"?: string;
  onChange?: (value: string) => void;
};

const WEEKDAYS = ["أحد", "إثن", "ثلا", "أرب", "خمي", "جمع", "سبت"] as const;
const ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const monthFormatter = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
  month: "long",
  year: "numeric",
});
const dayLabelFormatter = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

function parseIsoDate(value?: string): Date | null {
  if (!value) {
    return null;
  }
  const match = ISO_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  date.setHours(0, 0, 0, 0);
  return date;
}

function toIsoDate(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function displayDate(value?: string): string {
  const date = parseIsoDate(value);
  if (!date) {
    return "";
  }
  return [
    String(date.getDate()).padStart(2, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getFullYear()).padStart(4, "0"),
  ].join("/");
}

function addDays(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

function addMonths(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function sameDay(a: Date | null, b: Date | null): boolean {
  return Boolean(a && b && toIsoDate(a) === toIsoDate(b));
}

function buildCalendarDays(viewDate: Date): Date[] {
  const monthStart = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const calendarStart = addDays(monthStart, -monthStart.getDay());
  return Array.from({ length: 42 }, (_, index) => addDays(calendarStart, index));
}

function CalendarIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path
        d="M7 3v3M17 3v3M4.5 9h15M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ArrowIcon({ direction }: { direction: "next" | "previous" }) {
  // In RTL: previous month is on the right and points right; next is on the left.
  const transform = direction === "previous" ? "rotate(180 10 10)" : undefined;
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path
        d="m12.5 5-5 5 5 5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        transform={transform}
      />
    </svg>
  );
}

export default function DashboardDatePickerV2({
  id,
  name,
  value,
  defaultValue = "",
  min,
  max,
  placeholder = "اختر التاريخ",
  disabled = false,
  required = false,
  clearable = true,
  className = "",
  "aria-describedby": ariaDescribedBy,
  onChange,
}: DashboardDatePickerV2Props) {
  const generatedId = useId();
  const triggerId = id ?? `dsv2-date-${generatedId}`;
  const dialogId = `${triggerId}-dialog`;
  const controlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue);
  const selectedValue = controlled ? value : internalValue;
  const selectedDate = useMemo(() => parseIsoDate(selectedValue), [selectedValue]);
  const minDate = useMemo(() => parseIsoDate(min), [min]);
  const maxDate = useMemo(() => parseIsoDate(max), [max]);
  const today = useMemo(() => {
    const date = new Date();
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }, []);
  const [open, setOpen] = useState(false);
  const [viewDate, setViewDate] = useState<Date>(selectedDate ?? today);
  const [focusedDate, setFocusedDate] = useState<Date>(selectedDate ?? today);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { position, updatePosition } = useDashboardFloatingPositionV2({
    open,
    anchorRef: triggerRef,
    preferredWidth: 320,
    estimatedHeight: 372,
  });
  const calendarDays = useMemo(() => buildCalendarDays(viewDate), [viewDate]);

  const isDisabledDate = (date: Date) =>
    Boolean((minDate && date < minDate) || (maxDate && date > maxDate));

  const commitValue = (nextValue: string) => {
    if (!controlled) {
      setInternalValue(nextValue);
    }
    onChange?.(nextValue);
  };

  const openCalendar = () => {
    if (disabled) {
      return;
    }
    const initial = selectedDate ?? today;
    setViewDate(initial);
    setFocusedDate(initial);
    setOpen(true);
  };

  const closeCalendar = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) {
      requestAnimationFrame(() => triggerRef.current?.focus());
    }
  };

  const selectDate = (date: Date) => {
    if (isDisabledDate(date)) {
      return;
    }
    commitValue(toIsoDate(date));
    closeCalendar(true);
  };

  const changeMonth = (amount: number) => {
    setViewDate((current) => {
      const nextView = addMonths(current, amount);
      setFocusedDate((currentFocused) => {
        const preferredDay = currentFocused.getDate();
        const lastDay = new Date(
          nextView.getFullYear(),
          nextView.getMonth() + 1,
          0,
        ).getDate();
        return new Date(
          nextView.getFullYear(),
          nextView.getMonth(),
          Math.min(preferredDay, lastDay),
        );
      });
      return nextView;
    });
  };

  const moveFocus = (nextDate: Date) => {
    let candidate = nextDate;
    if (minDate && candidate < minDate) {
      candidate = minDate;
    }
    if (maxDate && candidate > maxDate) {
      candidate = maxDate;
    }
    setFocusedDate(candidate);
    if (
      candidate.getFullYear() !== viewDate.getFullYear() ||
      candidate.getMonth() !== viewDate.getMonth()
    ) {
      setViewDate(new Date(candidate.getFullYear(), candidate.getMonth(), 1));
    }
  };

  const handleDayKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    date: Date,
  ) => {
    let nextDate: Date | null = null;
    switch (event.key) {
      case "ArrowRight":
        nextDate = addDays(date, -1);
        break;
      case "ArrowLeft":
        nextDate = addDays(date, 1);
        break;
      case "ArrowDown":
        nextDate = addDays(date, 7);
        break;
      case "ArrowUp":
        nextDate = addDays(date, -7);
        break;
      case "Home":
        nextDate = addDays(date, -date.getDay());
        break;
      case "End":
        nextDate = addDays(date, 6 - date.getDay());
        break;
      case "PageUp":
        nextDate = addMonths(date, -1);
        break;
      case "PageDown":
        nextDate = addMonths(date, 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        selectDate(date);
        return;
      case "Escape":
        event.preventDefault();
        closeCalendar(true);
        return;
      default:
        return;
    }
    event.preventDefault();
    moveFocus(nextDate);
  };

  useEffect(() => {
    if (!open) {
      return undefined;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        closeCalendar(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeCalendar(true);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const focusedIso = toIsoDate(focusedDate);
    requestAnimationFrame(() => {
      panelRef.current
        ?.querySelector<HTMLButtonElement>(`[data-date="${focusedIso}"]`)
        ?.focus({ preventScroll: true });
    });
  }, [focusedDate, open, viewDate]);

  useEffect(() => {
    if (!open && selectedDate) {
      setViewDate(selectedDate);
      setFocusedDate(selectedDate);
    }
  }, [open, selectedDate]);

  const classes = ["dsv2-date-v2", className].filter(Boolean).join(" ");
  const panel = open && typeof document !== "undefined" ? (
    <div className="dashboard-v2 dsv2-page dsv2-floating-root" aria-hidden="false">
      <div
        ref={panelRef}
        id={dialogId}
        className="dsv2-date-v2__panel"
        role="dialog"
        aria-modal="false"
        aria-label="اختيار التاريخ"
        data-placement={position.placement}
        style={{
          left: position.left,
          top: position.top,
          width: position.width,
          maxHeight: position.maxHeight,
        }}
      >
        <div className="dsv2-date-v2__header">
          <button
            type="button"
            className="dsv2-date-v2__nav"
            aria-label="الشهر السابق"
            onClick={() => changeMonth(-1)}
          >
            <ArrowIcon direction="previous" />
          </button>
          <strong aria-live="polite">{monthFormatter.format(viewDate)}</strong>
          <button
            type="button"
            className="dsv2-date-v2__nav"
            aria-label="الشهر التالي"
            onClick={() => changeMonth(1)}
          >
            <ArrowIcon direction="next" />
          </button>
        </div>

        <div className="dsv2-date-v2__weekdays" aria-hidden="true">
          {WEEKDAYS.map((weekday) => (
            <span key={weekday}>{weekday}</span>
          ))}
        </div>

        <div className="dsv2-date-v2__grid" role="grid">
          {calendarDays.map((date) => {
            const iso = toIsoDate(date);
            const outsideMonth = date.getMonth() !== viewDate.getMonth();
            const selected = sameDay(date, selectedDate);
            const currentDay = sameDay(date, today);
            const unavailable = isDisabledDate(date);
            const focused = sameDay(date, focusedDate);
            return (
              <button
                key={iso}
                type="button"
                className="dsv2-date-v2__day"
                role="gridcell"
                aria-selected={selected}
                aria-label={dayLabelFormatter.format(date)}
                disabled={unavailable}
                tabIndex={focused ? 0 : -1}
                data-date={iso}
                data-outside={outsideMonth ? "true" : "false"}
                data-today={currentDay ? "true" : "false"}
                onFocus={() => setFocusedDate(date)}
                onClick={() => selectDate(date)}
                onKeyDown={(event) => handleDayKeyDown(event, date)}
              >
                {date.getDate()}
              </button>
            );
          })}
        </div>

        <div className="dsv2-date-v2__footer">
          <button
            type="button"
            className="dsv2-date-v2__footer-btn"
            disabled={isDisabledDate(today)}
            onClick={() => selectDate(today)}
          >
            اليوم
          </button>
          {clearable ? (
            <button
              type="button"
              className="dsv2-date-v2__footer-btn dsv2-date-v2__footer-btn--muted"
              disabled={!selectedValue}
              onClick={() => {
                commitValue("");
                closeCalendar(true);
              }}
            >
              مسح
            </button>
          ) : null}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div ref={rootRef} className={classes}>
      {name ? <input type="hidden" name={name} value={selectedValue ?? ""} /> : null}
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className="dsv2-date-v2__trigger"
        aria-controls={dialogId}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-describedby={ariaDescribedBy}
        aria-required={required}
        disabled={disabled}
        data-open={open ? "true" : "false"}
        onClick={() => {
          if (open) {
            closeCalendar(false);
          } else {
            openCalendar();
            requestAnimationFrame(updatePosition);
          }
        }}
        onKeyDown={(event) => {
          if (!open && ["ArrowDown", "Enter", " "].includes(event.key)) {
            event.preventDefault();
            openCalendar();
          }
        }}
      >
        <span
          className="dsv2-date-v2__value"
          data-placeholder={selectedDate ? "false" : "true"}
          dir="ltr"
        >
          {displayDate(selectedValue) || placeholder}
        </span>
        <span className="dsv2-date-v2__icon">
          <CalendarIcon />
        </span>
      </button>
      {panel ? createPortal(panel, document.body) : null}
    </div>
  );
}
