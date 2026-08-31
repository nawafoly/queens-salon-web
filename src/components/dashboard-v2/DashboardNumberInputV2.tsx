import {
  forwardRef,
  type InputHTMLAttributes,
} from "react";
import { normalizeWesternDigits } from "../../helpers/displayLocalePolicy";

export type DashboardNumberInputV2Props = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type" | "value" | "defaultValue"
> & {
  value?: string | number | readonly string[];
  defaultValue?: string | number | readonly string[];
};

function scalarValue(value: DashboardNumberInputV2Props["value"]): string {
  if (Array.isArray(value)) return String(value[0] ?? "");
  return String(value ?? "");
}

export function normalizeDashboardNumberDraft(value: unknown): string {
  return normalizeWesternDigits(String(value ?? ""))
    .replace(/[−–—]/g, "-")
    .replace(/٬/g, "")
    .replace(/[٫,]/g, ".")
    .replace(/\s+/g, "")
    .replace(/[^0-9eE+.\-]/g, "");
}

const DashboardNumberInputV2 = forwardRef<
  HTMLInputElement,
  DashboardNumberInputV2Props
>(function DashboardNumberInputV2(
  {
    value,
    defaultValue,
    className,
    inputMode,
    lang: _lang,
    dir: _dir,
    role,
    min,
    max,
    step,
    onChange,
    ...rest
  },
  ref
) {
  const controlled = value !== undefined;
  const displayValue = controlled
    ? normalizeDashboardNumberDraft(scalarValue(value))
    : undefined;
  const initialValue = !controlled
    ? normalizeDashboardNumberDraft(scalarValue(defaultValue))
    : undefined;

  const numericValue =
    displayValue !== undefined && displayValue !== ""
      ? Number(displayValue)
      : undefined;
  const numericMin =
    min !== undefined && min !== "" ? Number(min) : undefined;
  const numericMax =
    max !== undefined && max !== "" ? Number(max) : undefined;

  return (
    <input
      {...rest}
      ref={ref}
      type="text"
      inputMode={inputMode ?? "decimal"}
      lang="en-US"
      dir="ltr"
      role={role ?? "spinbutton"}
      className={["dsv2-number-v2", "dsv2-input", className]
        .filter(Boolean)
        .join(" ")}
      value={displayValue}
      defaultValue={initialValue}
      min={min}
      max={max}
      step={step}
      aria-valuenow={Number.isFinite(numericValue) ? numericValue : undefined}
      aria-valuemin={Number.isFinite(numericMin) ? numericMin : undefined}
      aria-valuemax={Number.isFinite(numericMax) ? numericMax : undefined}
      onChange={(event) => {
        const normalized = normalizeDashboardNumberDraft(event.currentTarget.value);
        if (normalized !== event.currentTarget.value) {
          event.currentTarget.value = normalized;
        }
        onChange?.(event);
      }}
    />
  );
});

export default DashboardNumberInputV2;
