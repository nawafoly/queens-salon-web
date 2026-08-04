import type { ReactNode } from "react";

export type DashboardFieldV2Props = {
  id: string;
  label: string;
  children: ReactNode;
  hint?: string;
  required?: boolean;
  className?: string;
};

export default function DashboardFieldV2({
  id,
  label,
  children,
  hint,
  required = false,
  className = "",
}: DashboardFieldV2Props) {
  const classes = ["dsv2-field", className].filter(Boolean).join(" ");

  return (
    <div className={classes}>
      <label className="dsv2-field__label" htmlFor={id}>
        {label}
        {required ? (
          <span className="dsv2-field__required" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-hint`} className="dsv2-field__hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
