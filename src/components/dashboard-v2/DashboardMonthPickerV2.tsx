import { createPortal } from "react-dom";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import useDashboardFloatingPositionV2 from "./useDashboardFloatingPositionV2";

export type DashboardMonthPickerV2Props = {
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
  onChange?: (value: string) => void;
};

const MONTHS = [
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
] as const;

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

function parseMonth(value?: string) {
  const match = MONTH_PATTERN.exec(String(value || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || month < 1 || month > 12) return null;
  return { year, month };
}

function monthKey(year: number, month: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

function monthIndex(value?: string) {
  const parsed = parseMonth(value);
  return parsed ? parsed.year * 12 + parsed.month - 1 : null;
}

export default function DashboardMonthPickerV2({
  id,
  name,
  value,
  defaultValue = "",
  min,
  max,
  placeholder = "اختر الشهر",
  disabled = false,
  required = false,
  clearable = true,
  className = "",
  onChange,
}: DashboardMonthPickerV2Props) {
  const generatedId = useId();
  const triggerId = id ?? `dsv2-month-${generatedId}`;
  const controlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(defaultValue);
  const selectedValue = controlled ? value ?? "" : internalValue;
  const selected = useMemo(() => parseMonth(selectedValue), [selectedValue]);

  const now = new Date();
  const [viewYear, setViewYear] = useState(selected?.year ?? now.getFullYear());
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const { position, updatePosition } = useDashboardFloatingPositionV2({
    open,
    anchorRef: triggerRef,
    preferredWidth: 360,
    estimatedHeight: 300,
  });

  const minIndex = monthIndex(min);
  const maxIndex = monthIndex(max);

  const commit = (next: string) => {
    if (!controlled) setInternalValue(next);
    onChange?.(next);
  };

  const isDisabledMonth = (year: number, month: number) => {
    const index = year * 12 + month - 1;
    return Boolean(
      (minIndex !== null && index < minIndex) ||
      (maxIndex !== null && index > maxIndex)
    );
  };

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !triggerRef.current?.contains(target) &&
        !panelRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        requestAnimationFrame(() => triggerRef.current?.focus());
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open && selected?.year) setViewYear(selected.year);
  }, [open, selected?.year]);

  const panel =
    open && typeof document !== "undefined"
      ? createPortal(
          <div className="dashboard-v2 dsv2-page dsv2-floating-root">
            <div
              ref={panelRef}
              className="dsv2-month-v2__panel"
              role="dialog"
              aria-label="اختيار الشهر"
              data-placement={position.placement}
              style={{
                left: position.left,
                top: position.top,
                width: position.width,
                maxHeight: position.maxHeight,
              }}
            >
              <div className="dsv2-month-v2__header">
                <button
                  type="button"
                  aria-label="السنة السابقة"
                  onClick={() => setViewYear((year) => year - 1)}
                >
                  ‹
                </button>
                <strong dir="ltr">{viewYear}</strong>
                <button
                  type="button"
                  aria-label="السنة التالية"
                  onClick={() => setViewYear((year) => year + 1)}
                >
                  ›
                </button>
              </div>

              <div className="dsv2-month-v2__grid">
                {MONTHS.map((label, index) => {
                  const month = index + 1;
                  const key = monthKey(viewYear, month);
                  const selectedMonth = key === selectedValue;
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={isDisabledMonth(viewYear, month)}
                      data-selected={selectedMonth ? "true" : "false"}
                      onClick={() => {
                        commit(key);
                        setOpen(false);
                        requestAnimationFrame(() => triggerRef.current?.focus());
                      }}
                    >
                      <span>{label}</span>
                      <small dir="ltr">{String(month).padStart(2, "0")}</small>
                    </button>
                  );
                })}
              </div>

              {clearable ? (
                <div className="dsv2-month-v2__footer">
                  <button
                    type="button"
                    disabled={!selectedValue}
                    onClick={() => {
                      commit("");
                      setOpen(false);
                    }}
                  >
                    مسح
                  </button>
                </div>
              ) : null}
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div className={["dsv2-month-v2", className].filter(Boolean).join(" ")}>
      {name ? <input type="hidden" name={name} value={selectedValue} /> : null}
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className="dsv2-month-v2__trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-required={required}
        disabled={disabled}
        onClick={() => {
          setOpen((current) => !current);
          requestAnimationFrame(updatePosition);
        }}
      >
        <span
          className="dsv2-month-v2__value"
          data-placeholder={selected ? "false" : "true"}
        >
          {selected
            ? `${MONTHS[selected.month - 1]} ${selected.year}`
            : placeholder}
        </span>
        <span className="dsv2-month-v2__icon" aria-hidden="true">▣</span>
      </button>
      {panel}
    </div>
  );
}
