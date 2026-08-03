import { createPortal } from "react-dom";
import { useId, useRef } from "react";
import type { ReactNode } from "react";
import useDashboardOverlayV2 from "./useDashboardOverlayV2";

export type DashboardDialogToneV2 = "default" | "gold" | "success" | "danger";
export type DashboardModalSizeV2 = "sm" | "md" | "lg" | "xl" | "fullscreen";

export type DashboardModalV2Props = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: DashboardModalSizeV2;
  tone?: DashboardDialogToneV2;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  showCloseButton?: boolean;
  closeLabel?: string;
  role?: "dialog" | "alertdialog";
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

export default function DashboardModalV2({
  open,
  onClose,
  title,
  description,
  eyebrow,
  children,
  footer,
  size = "md",
  tone = "default",
  closeOnBackdrop = true,
  closeOnEscape = true,
  showCloseButton = true,
  closeLabel = "إغلاق النافذة",
  role = "dialog",
  className = "",
}: DashboardModalV2Props) {
  const generatedId = useId();
  const titleId = `dsv2-modal-title-${generatedId}`;
  const descriptionId = description ? `dsv2-modal-description-${generatedId}` : undefined;
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

  const classes = ["dsv2-modal", `dsv2-modal--${size}`, className]
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

      <div className="dsv2-overlay-stage" role="presentation">
        <section
          ref={panelRef}
          className={classes}
          role={role}
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
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
      </div>
    </div>,
    document.body,
  );
}
