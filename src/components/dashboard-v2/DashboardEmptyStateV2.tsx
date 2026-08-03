import type { ReactNode } from "react";

export type DashboardEmptyStateToneV2 = "neutral" | "gold";

export type DashboardEmptyStateV2Props = {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  tone?: DashboardEmptyStateToneV2;
  compact?: boolean;
  className?: string;
};

function EmptyIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 32 32" fill="none">
      <path d="M7 10.5h18v14H7z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M11 10.5V8.75A2.75 2.75 0 0 1 13.75 6h4.5A2.75 2.75 0 0 1 21 8.75v1.75M11.5 17h9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export default function DashboardEmptyStateV2({
  title,
  description,
  action,
  icon,
  tone = "neutral",
  compact = false,
  className = "",
}: DashboardEmptyStateV2Props) {
  const classes = ["dsv2-state", "dsv2-state--empty", compact ? "dsv2-state--compact" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <section className={classes} data-tone={tone} role="status">
      <span className="dsv2-state__icon">{icon ?? <EmptyIcon />}</span>
      <div className="dsv2-state__content">
        <h3 className="dsv2-state__title">{title}</h3>
        {description ? <p className="dsv2-state__description">{description}</p> : null}
      </div>
      {action ? <div className="dsv2-state__action">{action}</div> : null}
    </section>
  );
}
