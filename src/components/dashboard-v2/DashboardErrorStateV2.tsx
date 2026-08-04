import type { ReactNode } from "react";

export type DashboardErrorStateV2Props = {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  details?: ReactNode;
  compact?: boolean;
  className?: string;
};

function ErrorIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" fill="none">
      <path d="M16 10v7.5m0 4h.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="16" cy="16" r="11" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export default function DashboardErrorStateV2({
  title,
  description,
  action,
  details,
  compact = false,
  className = "",
}: DashboardErrorStateV2Props) {
  const classes = ["dsv2-state", "dsv2-state--error", compact ? "dsv2-state--compact" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={classes} role="alert">
      <span className="dsv2-state__icon"><ErrorIcon /></span>
      <div className="dsv2-state__content">
        <h3 className="dsv2-state__title">{title}</h3>
        {description ? <p className="dsv2-state__description">{description}</p> : null}
        {details ? <div className="dsv2-state__details">{details}</div> : null}
      </div>
      {action ? <div className="dsv2-state__action">{action}</div> : null}
    </section>
  );
}
