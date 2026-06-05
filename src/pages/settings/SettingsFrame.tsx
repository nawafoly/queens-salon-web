import type { ReactNode } from "react";

function joinClasses(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export type SettingsStatItem = {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
};

export type SettingsPageHeaderProps = {
  eyebrow?: ReactNode;
  title: ReactNode;
  hint?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  compact?: boolean;
  className?: string;
};

export function SettingsPageHeader({
  eyebrow,
  title,
  hint,
  badges,
  actions,
  compact = false,
  className,
}: SettingsPageHeaderProps) {
  const headerClass = compact ? "settings-shell__subhead" : "settings-shell__hero";
  const copyClass = compact ? "settings-shell__subhead-copy" : "settings-shell__hero-copy";
  const metaClass = compact ? "settings-shell__subhead-meta" : "settings-shell__hero-meta";

  return (
    <section className={joinClasses(headerClass, className)}>
      <div className={copyClass}>
        {eyebrow ? <span className="settings-shell__eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        {hint ? <p>{hint}</p> : null}
        {!compact && badges ? <div className="settings-shell__badges">{badges}</div> : null}
      </div>

      {actions || compact ? (
        <div className={metaClass}>
          {compact && badges ? <div className="settings-shell__badges">{badges}</div> : null}
          {actions}
        </div>
      ) : null}
    </section>
  );
}

export function SettingsStats({ items, className }: { items: SettingsStatItem[]; className?: string }) {
  if (!items.length) return null;

  return (
    <section className={joinClasses("settings-shell__metrics", className)} aria-label="ملخص الصفحة">
      {items.map((item) => (
        <article key={String(item.label)} className="settings-shell__metric">
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          {item.hint ? <small>{item.hint}</small> : null}
        </article>
      ))}
    </section>
  );
}

export function SettingsToolbar({
  title,
  hint,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={joinClasses("settings-toolbar", className)}>
      {(title || hint || actions) ? (
        <div className="settings-toolbar__head">
          <div className="settings-toolbar__copy">
            {title ? <h2 className="settings-toolbar__title">{title}</h2> : null}
            {hint ? <p className="settings-toolbar__hint">{hint}</p> : null}
          </div>
          {actions ? <div className="settings-toolbar__actions">{actions}</div> : null}
        </div>
      ) : null}

      {children ? <div className="settings-toolbar__body">{children}</div> : null}
    </section>
  );
}

export function SettingsSection({
  eyebrow,
  title,
  hint,
  actions,
  children,
  className,
  bodyClassName,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={joinClasses("settings-card", className)}>
      <div className="settings-section-head">
        <div>
          {eyebrow ? <span className="settings-section-eyebrow">{eyebrow}</span> : null}
          <h3 className="settings-title">{title}</h3>
          {hint ? <p className="settings-section-hint">{hint}</p> : null}
        </div>
        {actions ? <div className="settings-section-actions">{actions}</div> : null}
      </div>

      {children ? <div className={joinClasses("settings-section-body", bodyClassName)}>{children}</div> : null}
    </section>
  );
}

export function SettingsSplitLayout({
  main,
  aside,
  className,
  reverse = false,
}: {
  main: ReactNode;
  aside: ReactNode;
  className?: string;
  reverse?: boolean;
}) {
  return (
    <div className={joinClasses("settings-split", reverse && "settings-split--reverse", className)}>
      <div className="settings-split__main">{main}</div>
      <div className="settings-split__aside">{aside}</div>
    </div>
  );
}

export function SettingsMasterDetail({
  list,
  detail,
  className,
  reverse = false,
}: {
  list: ReactNode;
  detail: ReactNode;
  className?: string;
  reverse?: boolean;
}) {
  return (
    <div className={joinClasses("settings-master-detail", reverse && "settings-master-detail--reverse", className)}>
      <div className="settings-master-detail__list">{list}</div>
      <div className="settings-master-detail__detail">{detail}</div>
    </div>
  );
}

export function SettingsState({
  title,
  hint,
  actions,
  className,
  loading = false,
}: {
  title: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  className?: string;
  loading?: boolean;
}) {
  return (
    <div className={joinClasses("settings-state", loading && "settings-state--loading", className)}>
      <strong>{title}</strong>
      {hint ? <p>{hint}</p> : null}
      {actions ? <div className="settings-state__actions">{actions}</div> : null}
    </div>
  );
}

export function SettingsPageFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={joinClasses("settings-page-frame", className)}>{children}</div>;
}

export function SettingsPageActions({
  note,
  actions,
  className,
}: {
  note?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={joinClasses("settings-page-actions", className)}>
      <div className="settings-page-actions__copy">{note}</div>
      {actions}
    </div>
  );
}

export function SettingsTabs({
  items,
  activeId,
  onChange,
  variant = "pills",
  className,
}: {
  items: Array<{ id: string; title: ReactNode; hint?: ReactNode; index?: ReactNode }>;
  activeId: string;
  onChange: (id: string) => void;
  variant?: "pills" | "cards";
  className?: string;
}) {
  return (
    <div className={joinClasses(variant === "cards" ? "settings-tabs--cards" : "settings-tabs", className)}>
      {items.map((item, index) => {
        const active = item.id === activeId;

        if (variant === "cards") {
          return (
            <button
              key={item.id}
              type="button"
              className={joinClasses("settings-tab-card", active && "is-active")}
              onClick={() => onChange(item.id)}
            >
              <span className="settings-tab-card__index">{item.index ?? String(index + 1).padStart(2, "0")}</span>
              <span className="settings-tab-card__copy">
                <strong>{item.title}</strong>
                {item.hint ? <small>{item.hint}</small> : null}
              </span>
            </button>
          );
        }

        return (
          <button
            key={item.id}
            type="button"
            className={joinClasses("exp-btn", active ? "primary" : "")}
            onClick={() => onChange(item.id)}
          >
            {item.title}
            {item.hint ? <small style={{ display: "block", fontWeight: 700 }}>{item.hint}</small> : null}
          </button>
        );
      })}
    </div>
  );
}
