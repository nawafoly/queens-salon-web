import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";

export type DashboardActionFeedbackToneV2 =
  | "success"
  | "danger"
  | "warning"
  | "info";

export type DashboardActionFeedbackV2Props = {
  id?: string;
  tone: DashboardActionFeedbackToneV2;
  title: ReactNode;
  description?: ReactNode;
  details?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  revealOnMount?: boolean;
  focusOnMount?: boolean;
  className?: string;
};

function FeedbackIcon({ tone }: { tone: DashboardActionFeedbackToneV2 }) {
  if (tone === "success") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
        <path
          d="m6.5 12.5 3.4 3.4 7.6-8"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  if (tone === "danger") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
        <path
          d="M12 7.5v5.25m0 3.75h.01"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
      </svg>
    );
  }

  if (tone === "warning") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
        <path
          d="M12 8v5m0 3h.01M10.4 4.9 3.5 17a1.5 1.5 0 0 0 1.3 2.25h14.4A1.5 1.5 0 0 0 20.5 17L13.6 4.9a1.85 1.85 0 0 0-3.2 0Z"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
      <path d="M12 10.5V17m0-10h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function isFullyVisible(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return true;

  let top = 0;
  let bottom = window.innerHeight || document.documentElement.clientHeight;
  let current = element.parentElement;

  while (current) {
    const style = window.getComputedStyle(current);
    const overflowY = style.overflowY;
    const scrollContainer = /(auto|scroll|overlay)/.test(overflowY);
    if (scrollContainer) {
      const containerRect = current.getBoundingClientRect();
      top = Math.max(top, containerRect.top);
      bottom = Math.min(bottom, containerRect.bottom);
    }
    current = current.parentElement;
  }

  return rect.top >= top && rect.bottom <= bottom;
}

export default function DashboardActionFeedbackV2({
  id,
  tone,
  title,
  description,
  details,
  action,
  compact = false,
  revealOnMount = false,
  focusOnMount = false,
  className = "",
}: DashboardActionFeedbackV2Props) {
  const generatedId = useId();
  const feedbackId = id ?? `dsv2-action-feedback-${generatedId}`;
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = rootRef.current;
    if (!element || (!revealOnMount && !focusOnMount)) return;

    const frame = window.requestAnimationFrame(() => {
      if (revealOnMount && !isFullyVisible(element)) {
        const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
        element.scrollIntoView({
          block: "nearest",
          inline: "nearest",
          behavior: reduceMotion ? "auto" : "smooth",
        });
      }

      if (focusOnMount) {
        element.focus({ preventScroll: true });
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [focusOnMount, revealOnMount, title, description]);

  const classes = [
    "dsv2-action-feedback",
    compact ? "dsv2-action-feedback--compact" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section
      ref={rootRef}
      id={feedbackId}
      className={classes}
      data-tone={tone}
      role={tone === "danger" ? "alert" : "status"}
      aria-live={tone === "danger" ? "assertive" : "polite"}
      aria-atomic="true"
      tabIndex={focusOnMount ? -1 : undefined}
    >
      <span className="dsv2-action-feedback__icon">
        <FeedbackIcon tone={tone} />
      </span>

      <div className="dsv2-action-feedback__content">
        <strong className="dsv2-action-feedback__title">{title}</strong>
        {description ? (
          <div className="dsv2-action-feedback__description">{description}</div>
        ) : null}
        {details ? <div className="dsv2-action-feedback__details">{details}</div> : null}
      </div>

      {action ? <div className="dsv2-action-feedback__action">{action}</div> : null}
    </section>
  );
}
