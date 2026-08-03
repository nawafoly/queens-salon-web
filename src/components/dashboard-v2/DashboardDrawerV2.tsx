import { createPortal } from "react-dom";
import { useId, useRef } from "react";
import type { ReactNode } from "react";
import useDashboardOverlayV2 from "./useDashboardOverlayV2";
import type { DashboardDialogToneV2 } from "./DashboardModalV2";

export type DashboardDrawerSizeV2 = "sm" | "md" | "lg";
export type DashboardDrawerSideV2 = "start" | "end";

export type DashboardDrawerV2Props = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: DashboardDrawerSizeV2;
  side?: DashboardDrawerSideV2;
  tone?: DashboardDialogToneV2;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  showCloseButton?: boolean;
  closeLabel?: string;
  className?: string;
};

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path
        d="m5.25 5.25 9.5 9.5m0-9.5-9.5 9.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function DashboardDrawerV2({
  open,
  onClose,
  title,
  description,
  eyebrow,
  children,
  footer,
  size = "md",
  side = "end",
  tone = "default",
  closeOnBackdrop = true,
  closeOnEscape = true,
  showCloseButton = true,
  closeLabel = "إغلاق اللوحة الجانبية",
  className = "",
}: DashboardDrawerV2Props) {
  const generatedId = useId();
  const titleId = `dsv2-drawer-title-${generatedId}`;
  const descriptionId = description ? `dsv2-drawer-description-${generatedId}` : undefined;
  const panelRef = useRef<HTMLElement>(null);

  useDashboardOverlayV2({
    open,
    onClose,
    containerRef: panelRef,
    closeOnEscape,
  });

  if (!open || typeof document === "undefined") {
    return null;
  }

  const classes = ["dsv2-drawer", `dsv2-drawer--${size}`, className]
    .filter(Boolean)
    .join(" ");

  return createPortal(
    <div className="dashboard-v2 dsv2-page dsv2-overlay-root" data-tone={tone}>
      <button
        type="button"
        className="dsv2-overlay-backdrop"
        aria-label={closeOnBackdrop ? closeLabel : undefined}
        tabIndex={-1}
        onClick={closeOnBackdrop ? onClose : undefined}
      />

      <section
        ref={panelRef}
        className={classes}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-side={side}
        tabIndex={-1}
      >
        <header className="dsv2-dialog__head">
          <div className="dsv2-dialog__heading">
            {eyebrow ? <span className="dsv2-dialog__eyebrow">{eyebrow}</span> : null}
            <h2 id={titleId} className="dsv2-dialog__title">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="dsv2-dialog__description">
                {description}
              </p>
            ) : null}
          </div>

          {showCloseButton ? (
            <button
              type="button"
              className="dsv2-dialog__close"
              aria-label={closeLabel}
              onClick={onClose}
            >
              <CloseIcon />
            </button>
          ) : null}
        </header>

        <div className="dsv2-dialog__body">{children}</div>

        {footer ? <footer className="dsv2-dialog__foot">{footer}</footer> : null}
      </section>
    </div>,
    document.body,
  );
}
