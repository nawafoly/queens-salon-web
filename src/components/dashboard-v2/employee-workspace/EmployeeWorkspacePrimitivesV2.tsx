import { Children, isValidElement, useState, type ReactNode } from "react";
import {
  DashboardDrawerV2,
  DashboardEmptyStateV2,
  DashboardErrorStateV2,
  DashboardSkeletonV2,
} from "../index";
import { resolveEmployeeWorkspaceHelpTopicV2 } from "./EmployeeWorkspaceHelpTopicsV2";

export type WorkspaceHelpStepV2 = {
  title: string;
  description: string;
};

export type WorkspaceHelpExampleV2 = {
  title: string;
  situation: string;
  action: string;
  result: string;
};

export type WorkspaceHelpTopicV2 = {
  title: string;
  description: string;
  purpose: string;
  useWhen?: string;
  notFor?: string;
  example?: WorkspaceHelpExampleV2;
  steps?: readonly WorkspaceHelpStepV2[];
  important?: string;
};

function containsWorkspaceHelpButtonV2(node: ReactNode): boolean {
  return Children.toArray(node).some((child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return false;
    if (child.type === WorkspaceHelpButtonV2) return true;
    return containsWorkspaceHelpButtonV2(child.props.children);
  });
}

export function WorkspaceCardV2({
  title,
  description,
  actions,
  children,
  className = "",
  helpTopic,
  hideHelp = false,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  helpTopic?: WorkspaceHelpTopicV2 | null;
  hideHelp?: boolean;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const hasManualHelp = containsWorkspaceHelpButtonV2(actions);
  const resolvedHelpTopic = hideHelp || hasManualHelp
    ? null
    : helpTopic === undefined
      ? resolveEmployeeWorkspaceHelpTopicV2(title)
      : helpTopic;
  const headerActions = actions || resolvedHelpTopic
    ? (
        <div className="dsv2-cluster dsv2-ew-card__actions">
          {actions}
          {resolvedHelpTopic ? (
            <WorkspaceHelpButtonV2
              label={`شرح ${typeof title === "string" ? title : "القسم"}`}
              onClick={() => setHelpOpen(true)}
            />
          ) : null}
        </div>
      )
    : null;

  return (
    <>
      <article className={["dsv2-card", "dsv2-card--padded", "dsv2-ew-card", className].filter(Boolean).join(" ")}>
        <header className="dsv2-section-head dsv2-ew-card__head">
          <div>
            <h3 className="dsv2-section-title dsv2-ew-card__title">{title}</h3>
            {description ? <p className="dsv2-section-caption">{description}</p> : null}
          </div>
          {headerActions}
        </header>
        <div className="dsv2-ew-card__body">{children}</div>
      </article>
      <WorkspaceHelpDrawerV2
        open={helpOpen}
        topic={resolvedHelpTopic}
        onClose={() => setHelpOpen(false)}
      />
    </>
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
  tone?: "neutral" | "gold" | "warning" | "success" | "danger" | "dark";
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
  tone?: "default" | "gold" | "warning" | "success" | "danger";
}) {
  const modifier = tone === "default" ? "" : ` dsv2-badge--${tone}`;
  return <span className={`dsv2-badge${modifier}`}>{children}</span>;
}


function WorkspaceHelpDocumentIconV2() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" width="17" height="17">
      <path
        d="M7.75 3.75h5.9l3.6 3.6v12.9H7.75a2 2 0 0 1-2-2V5.75a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M13.5 3.9v3.8h3.65M9 11h6M9 14.5h6M9 18h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function WorkspaceHelpButtonV2({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="dsv2-ew-icon-btn"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      <WorkspaceHelpDocumentIconV2 />
    </button>
  );
}

export function WorkspaceHelpDrawerV2({
  open,
  onClose,
  topic,
}: {
  open: boolean;
  onClose: () => void;
  topic: WorkspaceHelpTopicV2 | null;
}) {
  if (!topic) return null;

  return (
    <DashboardDrawerV2
      open={open}
      onClose={onClose}
      title={topic.title}
      description={topic.description}
      eyebrow="دليل الاستخدام"
      size="sm"
      side="end"
      footer={
        <button type="button" className="dsv2-btn dsv2-btn--primary" onClick={onClose}>
          فهمت
        </button>
      }
    >
      <div className="dsv2-stack">
        <WorkspaceNoticeV2
          title="ما الغرض من هذا القسم؟"
          description={topic.purpose}
          tone="neutral"
        />

        {topic.useWhen || topic.notFor ? (
          <WorkspaceCardV2 title="متى أستخدم هذا القسم؟" description="حدد الحالة الصحيحة قبل إجراء أي تعديل.">
            <div className="dsv2-stack dsv2-stack--sm">
              {topic.useWhen ? (
                <WorkspaceNoticeV2 title="استخدمه عندما" description={topic.useWhen} tone="success" />
              ) : null}
              {topic.notFor ? (
                <WorkspaceNoticeV2 title="لا تستخدمه من أجل" description={topic.notFor} tone="gold" />
              ) : null}
            </div>
          </WorkspaceCardV2>
        ) : null}

        {topic.example ? (
          <WorkspaceCardV2 title="مثال عملي" description="مثال مبسط يوضح المدخلات والنتيجة داخل النظام.">
            <div className="dsv2-stack dsv2-stack--sm">
              <WorkspaceNoticeV2 title={topic.example.title} description={topic.example.situation} tone="neutral" />
              <WorkspaceNoticeV2 title="ما الذي تفعله؟" description={topic.example.action} tone="gold" />
              <WorkspaceNoticeV2 title="النتيجة" description={topic.example.result} tone="success" />
            </div>
          </WorkspaceCardV2>
        ) : null}

        {topic.steps?.length ? (
          <WorkspaceCardV2 title="طريقة الاستخدام" description="اتبع الخطوات بالترتيب لتجنب تضارب الإعدادات.">
            <div className="dsv2-stack dsv2-stack--sm">
              {topic.steps.map((step, index) => (
                <WorkspaceNoticeV2
                  key={`${topic.title}-${index}`}
                  title={`${index + 1}. ${step.title}`}
                  description={step.description}
                  tone="neutral"
                />
              ))}
            </div>
          </WorkspaceCardV2>
        ) : null}

        {topic.important ? (
          <WorkspaceNoticeV2 title="مهم" description={topic.important} tone="gold" />
        ) : null}
      </div>
    </DashboardDrawerV2>
  );
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
  tone?: "gold" | "warning" | "success" | "danger" | "neutral";
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
  helpTopic,
  hideHelp = false,
}: {
  title: string;
  description: string;
  badge?: ReactNode;
  helpTopic?: WorkspaceHelpTopicV2 | null;
  hideHelp?: boolean;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const hasManualHelp = containsWorkspaceHelpButtonV2(badge);
  const resolvedHelpTopic = hideHelp || hasManualHelp
    ? null
    : helpTopic === undefined
      ? resolveEmployeeWorkspaceHelpTopicV2(title)
      : helpTopic;

  return (
    <>
      <header className="dsv2-ew-tab-head">
        <div>
          <span className="dsv2-ew-tab-head__eyebrow">ملف الموظفة الداخلي</span>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        {badge || resolvedHelpTopic ? (
          <div className="dsv2-ew-tab-head__badge">
            <div className="dsv2-cluster">
              {badge}
              {resolvedHelpTopic ? (
                <WorkspaceHelpButtonV2
                  label={`شرح ${title}`}
                  onClick={() => setHelpOpen(true)}
                />
              ) : null}
            </div>
          </div>
        ) : null}
      </header>
      <WorkspaceHelpDrawerV2
        open={helpOpen}
        topic={resolvedHelpTopic}
        onClose={() => setHelpOpen(false)}
      />
    </>
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
