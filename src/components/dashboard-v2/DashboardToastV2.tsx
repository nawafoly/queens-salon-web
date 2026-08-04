import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { CSSProperties, ReactNode } from "react";
import { createPortal } from "react-dom";

export type DashboardToastToneV2 = "success" | "danger" | "warning" | "info";
export type DashboardToastPositionV2 =
  | "top-start"
  | "top-end"
  | "bottom-start"
  | "bottom-end";

export type DashboardToastActionV2 = {
  label: string;
  onClick: () => void;
  dismissAfterClick?: boolean;
};

export type DashboardToastInputV2 = {
  id?: string;
  title: ReactNode;
  description?: ReactNode;
  tone?: DashboardToastToneV2;
  duration?: number;
  persistent?: boolean;
  action?: DashboardToastActionV2;
};

type DashboardToastRecordV2 = Required<
  Pick<DashboardToastInputV2, "id" | "tone" | "duration" | "persistent">
> &
  Omit<DashboardToastInputV2, "id" | "tone" | "duration" | "persistent">;

export type DashboardToastContextValueV2 = {
  pushToast: (toast: DashboardToastInputV2) => string;
  dismissToast: (id: string) => void;
  clearToasts: () => void;
};

export type DashboardToastProviderV2Props = {
  children: ReactNode;
  position?: DashboardToastPositionV2;
  maxToasts?: number;
  defaultDuration?: number;
};

const DashboardToastContextV2 = createContext<DashboardToastContextValueV2 | null>(null);

type DashboardToastShellInsetsV2 = {
  inlineStart: number;
  inlineEnd: number;
};

const EMPTY_SHELL_INSETS: DashboardToastShellInsetsV2 = {
  inlineStart: 0,
  inlineEnd: 0,
};

function readDashboardShellInsets(): DashboardToastShellInsetsV2 {
  if (typeof window === "undefined" || window.innerWidth < 992) {
    return EMPTY_SHELL_INSETS;
  }

  const shell = document.querySelector<HTMLElement>(
    ".dashboard-skin.madan-admin-shell.dashboard-page",
  );
  const sidebar = shell?.querySelector<HTMLElement>(".dashboard-sidebar");

  if (!shell || !sidebar) {
    return EMPTY_SHELL_INSETS;
  }

  const sidebarStyle = window.getComputedStyle(sidebar);
  const sidebarRect = sidebar.getBoundingClientRect();

  if (
    sidebarStyle.display === "none" ||
    sidebarStyle.visibility === "hidden" ||
    sidebarRect.width <= 1
  ) {
    return EMPTY_SHELL_INSETS;
  }

  const edgeTolerance = 6;
  const occupiedLeft =
    sidebarRect.left <= edgeTolerance ? Math.max(0, sidebarRect.right) : 0;
  const occupiedRight =
    sidebarRect.right >= window.innerWidth - edgeTolerance
      ? Math.max(0, window.innerWidth - sidebarRect.left)
      : 0;
  const isRtl = window.getComputedStyle(shell).direction === "rtl";

  return isRtl
    ? { inlineStart: occupiedRight, inlineEnd: occupiedLeft }
    : { inlineStart: occupiedLeft, inlineEnd: occupiedRight };
}

function useDashboardToastShellInsetsV2() {
  const [insets, setInsets] = useState<DashboardToastShellInsetsV2>(EMPTY_SHELL_INSETS);

  useEffect(() => {
    let frame = 0;
    let resizeObserver: ResizeObserver | null = null;
    let shellObserver: MutationObserver | null = null;
    let discoveryObserver: MutationObserver | null = null;

    const update = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const next = readDashboardShellInsets();
        setInsets((current) =>
          current.inlineStart === next.inlineStart && current.inlineEnd === next.inlineEnd
            ? current
            : next,
        );
      });
    };

    const connectObservers = () => {
      resizeObserver?.disconnect();
      shellObserver?.disconnect();
      discoveryObserver?.disconnect();

      const shell = document.querySelector<HTMLElement>(
        ".dashboard-skin.madan-admin-shell.dashboard-page",
      );
      const sidebar = shell?.querySelector<HTMLElement>(".dashboard-sidebar");

      if (!shell || !sidebar) {
        if (typeof MutationObserver !== "undefined") {
          discoveryObserver = new MutationObserver(() => {
            const discoveredShell = document.querySelector<HTMLElement>(
              ".dashboard-skin.madan-admin-shell.dashboard-page",
            );
            const discoveredSidebar =
              discoveredShell?.querySelector<HTMLElement>(".dashboard-sidebar");

            if (discoveredShell && discoveredSidebar) {
              connectObservers();
              update();
            }
          });
          discoveryObserver.observe(document.body, { childList: true, subtree: true });
        }
        return;
      }

      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(update);
        resizeObserver.observe(shell);
        resizeObserver.observe(sidebar);
      }

      if (typeof MutationObserver !== "undefined") {
        shellObserver = new MutationObserver(update);
        shellObserver.observe(shell, {
          attributes: true,
          attributeFilter: ["class", "style"],
        });
        shellObserver.observe(sidebar, {
          attributes: true,
          attributeFilter: ["class", "style"],
        });
      }
    };

    connectObservers();
    update();
    window.addEventListener("resize", update, { passive: true });

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      resizeObserver?.disconnect();
      shellObserver?.disconnect();
      discoveryObserver?.disconnect();
    };
  }, []);

  return insets;
}

function createToastId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `dsv2-toast-${crypto.randomUUID()}`;
  }

  return `dsv2-toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function ToastIcon({ tone }: { tone: DashboardToastToneV2 }) {
  if (tone === "success") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
        <path d="m6.5 12.5 3.4 3.4 7.6-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (tone === "danger") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
        <path d="M12 7.5v5.25m0 3.75h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }

  if (tone === "warning") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none">
        <path d="M12 8v5m0 3h.01M10.4 4.9 3.5 17a1.5 1.5 0 0 0 1.3 2.25h14.4A1.5 1.5 0 0 0 20.5 17L13.6 4.9a1.85 1.85 0 0 0-3.2 0Z" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
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

function CloseIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none">
      <path d="m5.25 5.25 9.5 9.5m0-9.5-9.5 9.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

type DashboardToastItemV2Props = {
  toast: DashboardToastRecordV2;
  onDismiss: (id: string) => void;
};

function DashboardToastItemV2({ toast, onDismiss }: DashboardToastItemV2Props) {
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef(0);
  const remainingRef = useRef(toast.duration);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleDismiss = useCallback(() => {
    if (toast.persistent || remainingRef.current <= 0) {
      return;
    }

    clearTimer();
    startedAtRef.current = Date.now();
    timerRef.current = window.setTimeout(() => {
      onDismiss(toast.id);
    }, remainingRef.current);
  }, [clearTimer, onDismiss, toast.id, toast.persistent]);

  useEffect(() => {
    remainingRef.current = toast.duration;
    scheduleDismiss();
    return clearTimer;
  }, [clearTimer, scheduleDismiss, toast.duration]);

  const pauseTimer = () => {
    if (toast.persistent || timerRef.current === null) {
      return;
    }

    const elapsed = Date.now() - startedAtRef.current;
    remainingRef.current = Math.max(0, remainingRef.current - elapsed);
    clearTimer();
  };

  const resumeTimer = () => {
    if (!toast.persistent) {
      scheduleDismiss();
    }
  };

  const handleAction = () => {
    toast.action?.onClick();
    if (toast.action?.dismissAfterClick !== false) {
      onDismiss(toast.id);
    }
  };

  return (
    <article
      className="dsv2-toast"
      data-tone={toast.tone}
      role={toast.tone === "danger" ? "alert" : "status"}
      aria-live={toast.tone === "danger" ? "assertive" : "polite"}
      onMouseEnter={pauseTimer}
      onMouseLeave={resumeTimer}
      onFocusCapture={pauseTimer}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          resumeTimer();
        }
      }}
    >
      <span className="dsv2-toast__icon">
        <ToastIcon tone={toast.tone} />
      </span>

      <div className="dsv2-toast__content">
        <strong className="dsv2-toast__title">{toast.title}</strong>
        {toast.description ? (
          <p className="dsv2-toast__description">{toast.description}</p>
        ) : null}
        {toast.action ? (
          <button type="button" className="dsv2-toast__action" onClick={handleAction}>
            {toast.action.label}
          </button>
        ) : null}
      </div>

      <button
        type="button"
        className="dsv2-toast__close"
        aria-label="إغلاق الإشعار"
        onClick={() => onDismiss(toast.id)}
      >
        <CloseIcon />
      </button>
    </article>
  );
}

export function useDashboardToastV2() {
  const context = useContext(DashboardToastContextV2);

  if (!context) {
    throw new Error("useDashboardToastV2 must be used inside DashboardToastProviderV2");
  }

  return context;
}

export default function DashboardToastProviderV2({
  children,
  position = "top-start",
  maxToasts = 4,
  defaultDuration = 4800,
}: DashboardToastProviderV2Props) {
  const [toasts, setToasts] = useState<DashboardToastRecordV2[]>([]);
  const shellInsets = useDashboardToastShellInsetsV2();
  const rootStyle = {
    "--dsv2-toast-shell-inline-start": `${shellInsets.inlineStart}px`,
    "--dsv2-toast-shell-inline-end": `${shellInsets.inlineEnd}px`,
  } as CSSProperties;

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const clearToasts = useCallback(() => {
    setToasts([]);
  }, []);

  const pushToast = useCallback(
    (input: DashboardToastInputV2) => {
      const id = input.id ?? createToastId();
      const nextToast: DashboardToastRecordV2 = {
        ...input,
        id,
        tone: input.tone ?? "info",
        duration: Math.max(1200, input.duration ?? defaultDuration),
        persistent: input.persistent ?? false,
      };

      setToasts((current) => {
        const withoutDuplicate = current.filter((toast) => toast.id !== id);
        return [...withoutDuplicate, nextToast].slice(-Math.max(1, maxToasts));
      });

      return id;
    },
    [defaultDuration, maxToasts],
  );

  const contextValue = useMemo<DashboardToastContextValueV2>(
    () => ({ pushToast, dismissToast, clearToasts }),
    [clearToasts, dismissToast, pushToast],
  );

  return (
    <DashboardToastContextV2.Provider value={contextValue}>
      {children}
      {typeof document !== "undefined"
        ? createPortal(
            <div
              className="dashboard-v2 dsv2-page dsv2-toast-root"
              data-position={position}
              style={rootStyle}
            >
              <div className="dsv2-toast-viewport" aria-label="الإشعارات">
                {toasts.map((toast) => (
                  <DashboardToastItemV2 key={toast.id} toast={toast} onDismiss={dismissToast} />
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </DashboardToastContextV2.Provider>
  );
}
