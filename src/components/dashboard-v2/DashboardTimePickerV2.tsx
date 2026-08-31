import { forwardRef, useEffect, useState } from "react";
import { normalizeWesternDigits } from "../../helpers/displayLocalePolicy";

export type DashboardTimePickerV2Props = {
  id?: string;
  name?: string;
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  min?: string;
  max?: string;
  step?: number | string;
  onChange?: (value: string) => void;
};

function normalizeTimeDraft(value: string) {
  return normalizeWesternDigits(value)
    .replace(/[^0-9:]/g, "")
    .slice(0, 5);
}

function normalizeCommittedTime(value: string) {
  const clean = normalizeTimeDraft(value);
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(clean);
  if (!match) return clean;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return clean;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

const DashboardTimePickerV2 = forwardRef<HTMLInputElement, DashboardTimePickerV2Props>(function DashboardTimePickerV2({
  id,
  name,
  value,
  defaultValue = "",
  placeholder = "HH:MM",
  disabled = false,
  required = false,
  className = "",
  min,
  max,
  step,
  onChange,
}, ref) {
  const controlled = value !== undefined;
  const [internalValue, setInternalValue] = useState(
    normalizeCommittedTime(defaultValue)
  );
  const current = controlled
    ? normalizeWesternDigits(String(value ?? ""))
    : internalValue;

  useEffect(() => {
    if (!controlled) return;
  }, [controlled, value]);

  const commit = (next: string) => {
    if (!controlled) setInternalValue(next);
    onChange?.(next);
  };

  return (
    <div className={["dsv2-time-v2", className].filter(Boolean).join(" ")}>
      {name ? <input type="hidden" name={name} value={current} /> : null}
      <input
        ref={ref}
        id={id}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        lang="en"
        dir="ltr"
        className="dsv2-time-v2__input dsv2-input"
        value={current}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        aria-label={placeholder}
        data-min={min}
        data-max={max}
        data-step={step}
        onChange={(event) => commit(normalizeTimeDraft(event.target.value))}
        onBlur={(event) => {
          const normalized = normalizeCommittedTime(event.target.value);
          if (normalized !== current) commit(normalized);
        }}
      />
      <span className="dsv2-time-v2__icon" aria-hidden="true">◷</span>
    </div>
  );
});

export default DashboardTimePickerV2;
