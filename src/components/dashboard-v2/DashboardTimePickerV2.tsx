import { forwardRef, useEffect, useMemo, useState } from "react";
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
  clock?: "24h" | "12h";
  onChange?: (value: string) => void;
};

type TimePeriod = "am" | "pm";

type Time12Parts = {
  draft: string;
  period: TimePeriod;
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

function to12HourParts(value: string): Time12Parts {
  const normalized = normalizeCommittedTime(value);
  const match = /^(\d{2}):(\d{2})$/.exec(normalized);
  if (!match) {
    return {
      draft: "",
      period: "pm",
    };
  }

  const hour24 = Number(match[1]);
  const hour12 = hour24 % 12 || 12;
  return {
    draft: `${hour12}:${match[2]}`,
    period: hour24 >= 12 ? "pm" : "am",
  };
}

function to24HourTime(value: string, period: TimePeriod) {
  const clean = normalizeTimeDraft(value);
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(clean);
  if (!match) return null;

  const hour12 = Number(match[1]);
  const minute = Number(match[2]);
  if (hour12 < 1 || hour12 > 12 || minute < 0 || minute > 59) return null;

  const hour24 =
    period === "pm"
      ? (hour12 % 12) + 12
      : hour12 % 12;

  return `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

const DashboardTimePickerV2 = forwardRef<HTMLInputElement, DashboardTimePickerV2Props>(function DashboardTimePickerV2({
  id,
  name,
  value,
  defaultValue = "",
  placeholder,
  disabled = false,
  required = false,
  className = "",
  min,
  max,
  step,
  clock = "24h",
  onChange,
}, ref) {
  const controlled = value !== undefined;
  const normalizedDefault = normalizeCommittedTime(defaultValue);
  const [internalValue, setInternalValue] = useState(normalizedDefault);
  const current = controlled
    ? normalizeCommittedTime(String(value ?? ""))
    : internalValue;

  const initial12 = useMemo(
    () => to12HourParts(current || normalizedDefault),
    []
  );
  const [draft12, setDraft12] = useState(initial12.draft);
  const [period12, setPeriod12] = useState<TimePeriod>(initial12.period);

  useEffect(() => {
    if (clock !== "12h") return;
    if (!current) {
      setDraft12("");
      return;
    }
    const next = to12HourParts(current);
    setDraft12(next.draft);
    setPeriod12(next.period);
  }, [clock, current]);

  const commit = (next: string) => {
    if (!controlled) setInternalValue(next);
    onChange?.(next);
  };

  const commit12Draft = (nextDraft: string, nextPeriod = period12) => {
    const normalizedDraft = normalizeTimeDraft(nextDraft);
    setDraft12(normalizedDraft);

    if (!normalizedDraft) {
      commit("");
      return;
    }

    const canonical = to24HourTime(normalizedDraft, nextPeriod);
    if (canonical) commit(canonical);
  };

  const changePeriod = (nextPeriod: TimePeriod) => {
    setPeriod12(nextPeriod);
    const canonical = to24HourTime(draft12, nextPeriod);
    if (canonical) commit(canonical);
  };

  const resolvedPlaceholder =
    placeholder || (clock === "12h" ? "3:00" : "HH:MM");

  return (
    <div
      className={[
        "dsv2-time-v2",
        clock === "12h" ? "dsv2-time-v2--12h" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
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
        value={clock === "12h" ? draft12 : current}
        placeholder={resolvedPlaceholder}
        disabled={disabled}
        required={required}
        aria-label={resolvedPlaceholder}
        data-min={min}
        data-max={max}
        data-step={step}
        onChange={(event) => {
          if (clock === "12h") {
            commit12Draft(event.target.value);
            return;
          }
          commit(normalizeTimeDraft(event.target.value));
        }}
        onBlur={(event) => {
          if (clock === "12h") {
            const canonical = to24HourTime(event.target.value, period12);
            if (canonical) {
              const normalized = to12HourParts(canonical);
              setDraft12(normalized.draft);
              if (canonical !== current) commit(canonical);
              return;
            }

            const fallback = to12HourParts(current);
            setDraft12(fallback.draft);
            setPeriod12(fallback.period);
            return;
          }

          const normalized = normalizeCommittedTime(event.target.value);
          if (normalized !== current) commit(normalized);
        }}
      />

      {clock === "12h" ? (
        <select
          className="dsv2-time-v2__period"
          value={period12}
          disabled={disabled}
          aria-label="الفترة الزمنية"
          onChange={(event) =>
            changePeriod(event.target.value as TimePeriod)
          }
        >
          <option value="am">ص</option>
          <option value="pm">م</option>
        </select>
      ) : (
        <span className="dsv2-time-v2__icon" aria-hidden="true">◷</span>
      )}
    </div>
  );
});

export default DashboardTimePickerV2;
