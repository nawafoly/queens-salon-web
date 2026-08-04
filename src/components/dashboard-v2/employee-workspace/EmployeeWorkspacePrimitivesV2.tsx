import type { ReactNode } from "react";
import {
  DashboardEmptyStateV2,
  DashboardErrorStateV2,
  DashboardSkeletonV2,
} from "../index";

export function WorkspaceCardV2({
  title,
  description,
  actions,
  children,
  className = "",
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <article className={["dsv2-card", "dsv2-card--padded", "dsv2-ew-card", className].filter(Boolean).join(" ")}>
      <header className="dsv2-section-head dsv2-ew-card__head">
        <div>
          <h3 className="dsv2-section-title dsv2-ew-card__title">{title}</h3>
          {description ? <p className="dsv2-section-caption">{description}</p> : null}
        </div>
        {actions ? <div className="dsv2-cluster dsv2-ew-card__actions">{actions}</div> : null}
      </header>
      <div className="dsv2-ew-card__body">{children}</div>
    </article>
  );
}

export function WorkspaceSwitchV2({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label className="dsv2-ew-switch" data-disabled={disabled ? "true" : "false"}>
      <span className="dsv2-ew-switch__copy">
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="dsv2-ew-switch__track" aria-hidden="true">
        <span className="dsv2-ew-switch__thumb" />
      </span>
    </label>
  );
}

export function WorkspaceMetricV2({
  label,
  value,
  note,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  note?: string;
  tone?: "neutral" | "gold" | "success" | "danger" | "dark";
}) {
  return (
    <article className="dsv2-ew-metric" data-tone={tone}>
      <span>{label}</span>
      <strong>{value}</strong>
      {note ? <small>{note}</small> : null}
    </article>
  );
}

export function WorkspaceStatusBadgeV2({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "gold" | "success" | "danger";
}) {
  const modifier = tone === "default" ? "" : ` dsv2-badge--${tone}`;
  return <span className={`dsv2-badge${modifier}`}>{children}</span>;
}

export function WorkspaceTableV2({
  headers,
  rows,
  emptyText = "لا توجد بيانات للعرض.",
}: {
  headers: readonly string[];
  rows: readonly (readonly ReactNode[])[];
  emptyText?: string;
}) {
  return (
    <div className="dsv2-table-scroll dsv2-ew-table-wrap">
      <table className="dsv2-table dsv2-ew-table">
        <thead>
          <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row, rowIndex) => (
            <tr key={`row-${rowIndex}`}>
              {row.map((cell, cellIndex) => <td key={`cell-${rowIndex}-${cellIndex}`}>{cell}</td>)}
            </tr>
          )) : (
            <tr>
              <td colSpan={headers.length} className="dsv2-ew-table__empty">{emptyText}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function WorkspaceNoticeV2({
  title,
  description,
  tone = "gold",
  action,
}: {
  title: string;
  description: string;
  tone?: "gold" | "success" | "danger" | "neutral";
  action?: ReactNode;
}) {
  return (
    <aside className="dsv2-ew-notice" data-tone={tone}>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      {action ? <div className="dsv2-ew-notice__action">{action}</div> : null}
    </aside>
  );
}

export function WorkspaceStateShowcaseV2({
  compact = false,
}: {
  compact?: boolean;
}) {
  return (
    <div className="dsv2-ew-state-grid" data-compact={compact ? "true" : "false"}>
      <article className="dsv2-ew-skeleton" aria-label="نموذج التحميل">
        <DashboardSkeletonV2 variant="title" width="54%" />
        <DashboardSkeletonV2 lines={compact ? 2 : 3} />
        <DashboardSkeletonV2 variant="block" height={compact ? 54 : 82} />
        <span className="dsv2-sr-only">جارٍ تحميل بيانات التبويب</span>
      </article>
      <DashboardEmptyStateV2
        title="لا توجد بيانات بعد"
        description="تظهر هنا البيانات عند إضافتها أو توفرها للموظفة."
        tone="gold"
      />
      <DashboardErrorStateV2
        title="تعذر تحميل القسم"
        description="احتفظنا بالبيانات الحالية. أعد المحاولة بعد التحقق من الاتصال."
        details="تعذر جلب البيانات التجريبية"
      />
    </div>
  );
}

export function WorkspaceTabHeaderV2({
  title,
  description,
  badge,
}: {
  title: string;
  description: string;
  badge?: ReactNode;
}) {
  return (
    <header className="dsv2-ew-tab-head">
      <div>
        <span className="dsv2-ew-tab-head__eyebrow">ملف الموظفة الداخلي</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {badge ? <div className="dsv2-ew-tab-head__badge">{badge}</div> : null}
    </header>
  );
}

export function WorkspaceChoicePillsV2({
  options,
  value,
  onChange,
  disabled = false,
}: {
  options: readonly { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="dsv2-ew-pills" role="group">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="dsv2-ew-pill"
          data-active={value === option.value ? "true" : "false"}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
