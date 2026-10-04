import {
  Children,
  cloneElement,
  isValidElement,
} from "react";
import type { ReactElement, ReactNode } from "react";

export type DashboardFieldV2Props = {
  id: string;
  label: string;
  children: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
};

function joinIds(...values: Array<string | null | undefined | false>) {
  return values.filter(Boolean).join(" ") || undefined;
}

export default function DashboardFieldV2({
  id,
  label,
  children,
  hint,
  error,
  required = false,
  className = "",
}: DashboardFieldV2Props) {
  const classes = ["dsv2-field", className].filter(Boolean).join(" ");
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  let renderedChildren = children;

  if (Children.count(children) === 1 && isValidElement(children)) {
    const control = children as ReactElement<Record<string, unknown>>;
    const currentDescribedBy = control.props["aria-describedby"] as string | undefined;
    renderedChildren = cloneElement(control, {
      id: (control.props.id as string | undefined) ?? id,
      "aria-describedby": joinIds(currentDescribedBy, hintId, errorId),
      "aria-invalid": error ? true : control.props["aria-invalid"],
    });
  }

  return (
    <div className={classes} data-invalid={error ? "true" : "false"}>
      <label className="dsv2-field__label" htmlFor={id}>
        {label}
        {required ? (
          <span className="dsv2-field__required" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      {renderedChildren}
      {hint ? (
        <p id={hintId} className="dsv2-field__hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="dsv2-field__error" role="alert" aria-live="assertive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
