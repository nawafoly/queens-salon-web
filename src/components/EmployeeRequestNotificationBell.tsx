import { createPortal } from "react-dom";
import { useCallback, useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBell } from "@fortawesome/free-solid-svg-icons";
import { useNavigate } from "react-router-dom";
import { usePermissions } from "../security/PermissionContext";
import {
  listEmployeeRequestNotifications,
  markAllEmployeeRequestNotificationsRead,
  markEmployeeRequestNotificationRead,
  type CoreEmployeeRequestNotification,
} from "../services/employeeRequests";
import "../styles/EmployeeRequests.css";
import "../styles/EmployeeRequestNotificationBell.css";

type Props = {
  enabled?: boolean;
  className?: string;
};

function formatNotificationTime(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return raw;
  try {
    return new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
      timeZone: "Asia/Riyadh",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(parsed));
  } catch {
    return raw;
  }
}

export default function EmployeeRequestNotificationBell({ enabled = true, className = "" }: Props) {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const allowed = enabled && hasPermission("employee_requests.view");
  const [notifications, setNotifications] = useState<CoreEmployeeRequestNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!allowed) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }
    setLoading(true);
    try {
      const rows = await listEmployeeRequestNotifications(100);
      const unreadRows = rows.filter((item) => Number(item.is_read) !== 1);
      setNotifications(unreadRows);
      setUnreadCount(unreadRows.length);
    } catch {
      setNotifications([]);
      setUnreadCount(0);
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useEffect(() => {
    if (!allowed) return;
    const refreshWhenActive = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const handleChanged = () => void refresh();

    void refresh();
    window.addEventListener("employee-request-notifications-changed", handleChanged);
    window.addEventListener("focus", refreshWhenActive);
    window.addEventListener("online", refreshWhenActive);
    document.addEventListener("visibilitychange", refreshWhenActive);
    return () => {
      window.removeEventListener("employee-request-notifications-changed", handleChanged);
      window.removeEventListener("focus", refreshWhenActive);
      window.removeEventListener("online", refreshWhenActive);
      document.removeEventListener("visibilitychange", refreshWhenActive);
    };
  }, [allowed, refresh]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".hr-request-notification-shell") && !target?.closest(".hr-request-notification-popover")) {
        setOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const openNotification = useCallback(async (notification: CoreEmployeeRequestNotification) => {
    if (Number(notification.is_read) !== 1) {
      try {
        await markEmployeeRequestNotificationRead(notification.id);
        setNotifications((current) => current.filter((item) => item.id !== notification.id));
        setUnreadCount((count) => Math.max(0, count - 1));
        window.dispatchEvent(new CustomEvent("employee-request-notifications-changed"));
      } catch {
        // Keep navigation available even if the read state cannot be synchronized.
      }
    }
    setOpen(false);
    if (notification.related_id) {
      navigate(`/dashboard/requests?request=${encodeURIComponent(notification.related_id)}`);
    } else {
      navigate("/dashboard/requests");
    }
  }, [navigate]);

  const markAllRead = useCallback(async () => {
    if (!unreadCount) return;
    try {
      await markAllEmployeeRequestNotificationsRead();
      setNotifications([]);
      setUnreadCount(0);
      window.dispatchEvent(new CustomEvent("employee-request-notifications-changed"));
    } catch {
      // Preserve the current badge when the server rejects the action.
    }
  }, [unreadCount]);

  if (!allowed) return null;

  return (
    <>
      <div className={`hr-request-notification-shell dashboard-request-notification-shell ${className}`.trim()}>
        <button
          type="button"
          className={`hr-request-notification-button dashboard-request-notification-button ${open ? "is-open" : ""}`}
          onClick={() => {
            setOpen((value) => !value);
            if (!open) void refresh();
          }}
          aria-label={`تنبيهات طلبات الموظفات${unreadCount ? `، ${unreadCount} غير مقروء` : ""}`}
          aria-expanded={open}
          title="التنبيهات"
        >
          <FontAwesomeIcon icon={faBell} />
          {unreadCount > 0 ? <span>{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
        </button>
      </div>

      {open && typeof document !== "undefined" ? createPortal(
        <section className="hr-request-notification-popover" aria-label="تنبيهات طلبات الموظفات">
          <header>
            <div>
              <small>التنبيهات</small>
              <strong>طلبات الموظفات</strong>
            </div>
            {unreadCount > 0 ? (
              <button type="button" onClick={() => void markAllRead()}>
                تعليم الكل كمقروء
              </button>
            ) : null}
          </header>
          <div className="hr-request-notification-popover__list">
            {loading ? (
              <p>جاري تحديث التنبيهات...</p>
            ) : notifications.length ? (
              notifications.slice(0, 12).map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className="is-unread"
                  onClick={() => void openNotification(item)}
                >
                  <span className="hr-request-notification-popover__dot" />
                  <span>
                    <strong>{item.title}</strong>
                    {item.body ? <small>{item.body}</small> : null}
                    <time>{formatNotificationTime(item.created_at)}</time>
                  </span>
                </button>
              ))
            ) : (
              <p>لا توجد تنبيهات جديدة.</p>
            )}
          </div>
          <footer>
            <button type="button" onClick={() => { setOpen(false); navigate("/dashboard/requests"); }}>
              فتح مركز الطلبات
            </button>
          </footer>
        </section>,
        document.body
      ) : null}
    </>
  );
}
