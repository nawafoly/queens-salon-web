import { Children, isValidElement, useState, type ReactNode } from "react";
import {
  DashboardDrawerV2,
  DashboardEmptyStateV2,
  DashboardErrorStateV2,
  DashboardSkeletonV2,
} from "../index";
import { resolveEmployeeWorkspaceHelpTopicV2 } from "./EmployeeWorkspaceHelpTopicsV2";
import { useEmployeeLanguage } from "../../../pages/dashboardEmployees/employeeLanguage";

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

function containsArabicWorkspaceTextV2(value: string): boolean {
  return /[\u0600-\u06FF]/.test(value);
}

function buildEnglishWorkspaceHelpTopicV2(
  topic: WorkspaceHelpTopicV2,
  translate: (value: string) => string
): WorkspaceHelpTopicV2 {
  const rawBaseTitle = topic.title.replace(/^شرح\s+/, "").trim();
  const translatedBaseTitle = translate(rawBaseTitle);
  const sectionName = translatedBaseTitle && !containsArabicWorkspaceTextV2(translatedBaseTitle)
    ? translatedBaseTitle
    : "this Staff Management section";
  const sectionPhrase = sectionName === "this Staff Management section"
    ? sectionName
    : `the ${sectionName} section`;

  return {
    title: sectionName === "this Staff Management section" ? "Staff Management help" : `Help: ${sectionName}`,
    description: `Guidance for ${sectionPhrase}.`,
    purpose: `Use ${sectionPhrase} to review and manage the related staff information and operational settings.`,
    useWhen: `Use it when the selected staff member's ${sectionName === "this Staff Management section" ? "information" : sectionName.toLowerCase()} needs to be reviewed or updated.`,
    notFor: "Use the dedicated Staff Management section for changes that belong to another operational area.",
    example: {
      title: `Example: ${sectionName === "this Staff Management section" ? "staff record review" : sectionName}`,
      situation: "A staff record requires review or an operational setting needs to be updated.",
      action: "Review the current values, make the required change, save it, then verify the resulting staff record.",
      result: "The staff record is updated while its existing operational and audit history remains intact.",
    },
    steps: [
      { title: "Review", description: "Check the current staff data and confirm that you are editing the correct record." },
      { title: "Update", description: "Change only the fields or settings required for this operation." },
      { title: "Save and verify", description: "Save the change and confirm that the resulting staff state is correct." },
    ],
    important: "Verify the selected staff member and the operational impact before saving any change.",
  };
}

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
  const { t, tr } = useEmployeeLanguage();
  const displayTitle = typeof title === "string" ? t(title) : title;
  const displayDescription = typeof description === "string" ? t(description) : description;
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
              label={typeof title === "string" ? tr(`شرح ${title}`, `Explain ${t(title)}`) : tr("شرح القسم", "Explain section")}
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
            <h3 className="dsv2-section-title dsv2-ew-card__title">{displayTitle}</h3>
            {displayDescription ? <p className="dsv2-section-caption">{displayDescription}</p> : null}
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
  const { t } = useEmployeeLanguage();
  return (
    <label className="dsv2-ew-switch" data-disabled={disabled ? "true" : "false"}>
      <span className="dsv2-ew-switch__copy">
        <strong>{t(label)}</strong>
        {description ? <small>{t(description)}</small> : null}
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
  const { t } = useEmployeeLanguage();
  return (
    <article className="dsv2-ew-metric" data-tone={tone}>
      <span>{t(label)}</span>
      <strong>{value}</strong>
      {note ? <small>{t(note)}</small> : null}
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
  const { t } = useEmployeeLanguage();
  const modifier = tone === "default" ? "" : ` dsv2-badge--${tone}`;
  const content = typeof children === "string" ? t(children) : children;
  return <span className={`dsv2-badge${modifier}`}>{content}</span>;
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
  const { t } = useEmployeeLanguage();
  const translatedLabel = t(label);
  return (
    <button
      type="button"
      className="dsv2-ew-icon-btn"
      aria-label={translatedLabel}
      title={translatedLabel}
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
  const { language, t } = useEmployeeLanguage();
  if (!topic) return null;
  const displayTopic = language === "en" ? buildEnglishWorkspaceHelpTopicV2(topic, t) : topic;

  return (
    <DashboardDrawerV2
      open={open}
      onClose={onClose}
      title={t(displayTopic.title)}
      description={t(displayTopic.description)}
      eyebrow={t("دليل الاستخدام")}
      size="sm"
      side="end"
      footer={
        <button type="button" className="dsv2-btn dsv2-btn--primary" onClick={onClose}>
          {t("فهمت")}
        </button>
      }
    >
      <div className="dsv2-stack">
        <WorkspaceNoticeV2
          title={t("ما الغرض من هذا القسم؟")}
          description={t(displayTopic.purpose)}
          tone="neutral"
        />

        {displayTopic.useWhen || displayTopic.notFor ? (
          <WorkspaceCardV2 title={t("متى أستخدم هذا القسم؟")} description={t("حدد الحالة الصحيحة قبل إجراء أي تعديل.")}>
            <div className="dsv2-stack dsv2-stack--sm">
              {displayTopic.useWhen ? (
                <WorkspaceNoticeV2 title={t("استخدمه عندما")} description={t(displayTopic.useWhen)} tone="success" />
              ) : null}
              {displayTopic.notFor ? (
                <WorkspaceNoticeV2 title={t("لا تستخدمه من أجل")} description={t(displayTopic.notFor)} tone="gold" />
              ) : null}
            </div>
          </WorkspaceCardV2>
        ) : null}

        {displayTopic.example ? (
          <WorkspaceCardV2 title={t("مثال عملي")} description={t("مثال مبسط يوضح المدخلات والنتيجة داخل النظام.")}>
            <div className="dsv2-stack dsv2-stack--sm">
              <WorkspaceNoticeV2 title={t(displayTopic.example.title)} description={t(displayTopic.example.situation)} tone="neutral" />
              <WorkspaceNoticeV2 title={t("ما الذي تفعله؟")} description={t(displayTopic.example.action)} tone="gold" />
              <WorkspaceNoticeV2 title={t("النتيجة")} description={t(displayTopic.example.result)} tone="success" />
            </div>
          </WorkspaceCardV2>
        ) : null}

        {displayTopic.steps?.length ? (
          <WorkspaceCardV2 title={t("طريقة الاستخدام")} description={t("اتبع الخطوات بالترتيب لتجنب تضارب الإعدادات.")}>
            <div className="dsv2-stack dsv2-stack--sm">
              {displayTopic.steps.map((step, index) => (
                <WorkspaceNoticeV2
                  key={`${displayTopic.title}-${index}`}
                  title={`${index + 1}. ${t(step.title)}`}
                  description={t(step.description)}
                  tone="neutral"
                />
              ))}
            </div>
          </WorkspaceCardV2>
        ) : null}

        {displayTopic.important ? (
          <WorkspaceNoticeV2 title={t("مهم")} description={t(displayTopic.important)} tone="gold" />
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
  const { t } = useEmployeeLanguage();
  return (
    <div className="dsv2-table-scroll dsv2-ew-table-wrap">
      <table className="dsv2-table dsv2-ew-table">
        <thead>
          <tr>{headers.map((header) => <th key={header}>{t(header)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length ? rows.map((row, rowIndex) => (
            <tr key={`row-${rowIndex}`}>
              {row.map((cell, cellIndex) => <td key={`cell-${rowIndex}-${cellIndex}`}>{cell}</td>)}
            </tr>
          )) : (
            <tr>
              <td colSpan={headers.length} className="dsv2-ew-table__empty">{t(emptyText)}</td>
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
  const { t } = useEmployeeLanguage();
  return (
    <aside className="dsv2-ew-notice" data-tone={tone}>
      <div>
        <strong>{t(title)}</strong>
        <p>{t(description)}</p>
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
  const { t } = useEmployeeLanguage();
  return (
    <div className="dsv2-ew-state-grid" data-compact={compact ? "true" : "false"}>
      <article className="dsv2-ew-skeleton" aria-label={t("نموذج التحميل")}>
        <DashboardSkeletonV2 variant="title" width="54%" />
        <DashboardSkeletonV2 lines={compact ? 2 : 3} />
        <DashboardSkeletonV2 variant="block" height={compact ? 54 : 82} />
        <span className="dsv2-sr-only">{t("جارٍ تحميل بيانات التبويب")}</span>
      </article>
      <DashboardEmptyStateV2
        title={t("لا توجد بيانات بعد")}
        description={t("تظهر هنا البيانات عند إضافتها أو توفرها للموظفة.")}
        tone="gold"
      />
      <DashboardErrorStateV2
        title={t("تعذر تحميل القسم")}
        description={t("احتفظنا بالبيانات الحالية. أعد المحاولة بعد التحقق من الاتصال.")}
        details={t("تعذر جلب البيانات التجريبية")}
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
  const { t, tr } = useEmployeeLanguage();
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
          <span className="dsv2-ew-tab-head__eyebrow">{t("ملف الموظفة الداخلي")}</span>
          <h2>{t(title)}</h2>
          <p>{t(description)}</p>
        </div>
        {badge || resolvedHelpTopic ? (
          <div className="dsv2-ew-tab-head__badge">
            <div className="dsv2-cluster">
              {badge}
              {resolvedHelpTopic ? (
                <WorkspaceHelpButtonV2
                  label={tr(`شرح ${title}`, `Explain ${t(title)}`)}
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
  const { t } = useEmployeeLanguage();
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
          {t(option.label)}
        </button>
      ))}
    </div>
  );
}
