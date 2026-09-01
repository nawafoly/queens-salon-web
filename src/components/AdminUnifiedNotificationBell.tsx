import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  fetchAttendanceSecurityDashboard,
  type AttendanceSecurityEvent,
} from "../services/attendanceWorkerService";
import "../styles/EmployeeRequests.css";
import "../styles/EmployeeRequestNotificationBell.css";

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function eventMillis(value: unknown) {
  const parsed = Date.parse(cleanText(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNotificationTime(value: unknown) {
  const raw = cleanText(value);
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

function securityEmployeeLabel(event: AttendanceSecurityEvent) {
  return cleanText(event.employeeName || event.employeeDocId || event.employeeUid) || "موظفة غير معروفة";
}

export default function AdminUnifiedNotificationBell() {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const canViewRequests = hasPermission("employee_requests.view");
  const canViewSecurity = hasPermission("attendance.view");
  const allowed = canViewRequests || canViewSecurity;

  const [requests, setRequests] = useState<CoreEmployeeRequestNotification[]>([]);
  const [securityAlerts, setSecurityAlerts] = useState<AttendanceSecurityEvent[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  const openSecurityAlerts = useMemo(
    () => [...securityAlerts].sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === "critical" ? -1 : 1;
      return eventMillis(b.createdAt) - eventMillis(a.createdAt);
    }),
    [securityAlerts]
  );

  const totalCount = requests.length + openSecurityAlerts.length;

  const refresh = useCallback(async () => {
    if (!allowed) {
      setRequests([]);
      setSecurityAlerts([]);
      return;
    }

    setLoading(true);
    try {
      const [requestRows, securityDashboard] = await Promise.all([
        canViewRequests
          ? listEmployeeRequestNotifications(100).catch(() => [])
          : Promise.resolve([] as CoreEmployeeRequestNotification[]),
        canViewSecurity
          ? fetchAttendanceSecurityDashboard({ alertStatus: "open", limit: 100 }).catch(() => null)
          : Promise.resolve(null),
      ]);

      setRequests(requestRows.filter((item) => Number(item.is_read) !== 1));
      setSecurityAlerts(securityDashboard?.alerts || []);
    } finally {
      setLoading(false);
    }
  }, [allowed, canViewRequests, canViewSecurity]);

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

  const openRequest = useCallback(async (notification: CoreEmployeeRequestNotification) => {
    try {
      await markEmployeeRequestNotificationRead(notification.id);
      setRequests((current) => current.filter((item) => item.id !== notification.id));
      window.dispatchEvent(new CustomEvent("employee-request-notifications-changed"));
    } catch {
      // Navigation remains available even when read-state sync fails.
    }
    setOpen(false);
    navigate(notification.related_id
      ? `/dashboard/requests?request=${encodeURIComponent(notification.related_id)}`
      : "/dashboard/requests");
  }, [navigate]);

  const openSecurity = useCallback((alert: AttendanceSecurityEvent) => {
    setOpen(false);
    navigate(`/dashboard/attendance?tab=alerts&alert=${encodeURIComponent(alert.id)}`);
  }, [navigate]);

  const markAllRequestsRead = useCallback(async () => {
    if (!requests.length || !canViewRequests) return;
    try {
      await markAllEmployeeRequestNotificationsRead();
      setRequests([]);
      window.dispatchEvent(new CustomEvent("employee-request-notifications-changed"));
    } catch {
      // Keep current request notifications when the operation fails.
    }
  }, [canViewRequests, requests.length]);

  if (!allowed) return null;

  return (
    <>
      <div className="hr-request-notification-shell dashboard-request-notification-shell">
        <button
          type="button"
          className={`hr-request-notification-button dashboard-request-notification-button ${open ? "is-open" : ""}`}
          onClick={() => {
            setOpen((value) => !value);
            if (!open) void refresh();
          }}
          aria-label={`تنبيهات الإدارة${totalCount ? `، ${totalCount} تنبيه` : ""}`}
          aria-expanded={open}
          title="التنبيهات"
        >
          <FontAwesomeIcon icon={faBell} />
          {totalCount > 0 ? <span>{totalCount > 99 ? "99+" : totalCount}</span> : null}
        </button>
      </div>

      {open && typeof document !== "undefined" ? createPortal(
        <section className="hr-request-notification-popover" aria-label="تنبيهات الإدارة">
          <header>
            <div>
              <small>إشعارات الإدارة</small>
              <strong>{totalCount ? `${totalCount} تنبيه` : "لا توجد تنبيهات جديدة"}</strong>
            </div>
            {requests.length > 0 ? (
              <button type="button" onClick={() => void markAllRequestsRead()}>
                تعليم الطلبات كمقروءة
              </button>
            ) : null}
          </header>

          <div className="hr-request-notification-popover__list">
            {loading && !totalCount ? (
              <p>جاري تحديث التنبيهات...</p>
            ) : totalCount ? (
              <>
                {openSecurityAlerts.slice(0, 8).map((item) => (
                  <button type="button" key={`security-${item.id}`} className="is-unread" onClick={() => openSecurity(item)}>
                    <span className="hr-request-notification-popover__dot" />
                    <span>
                      <small>أمان البصمة</small>
                      <strong>{item.title || "تنبيه أمني"}</strong>
                      <b>{securityEmployeeLabel(item)}</b>
                      {item.detail ? <small>{item.detail}</small> : null}
                      <time>{formatNotificationTime(item.createdAt)}</time>
                    </span>
                  </button>
                ))}

                {requests.slice(0, Math.max(0, 12 - Math.min(8, openSecurityAlerts.length))).map((item) => (
                  <button type="button" key={`request-${item.id}`} className="is-unread" onClick={() => void openRequest(item)}>
                    <span className="hr-request-notification-popover__dot" />
                    <span>
                      <small>طلبات الموظفات</small>
                      <strong>{item.title}</strong>
                      {item.body ? <small>{item.body}</small> : null}
                      <time>{formatNotificationTime(item.created_at)}</time>
                    </span>
                  </button>
                ))}
              </>
            ) : (
              <p>لا توجد تنبيهات جديدة.</p>
            )}
          </div>

          <footer style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {canViewRequests ? (
              <button type="button" onClick={() => { setOpen(false); navigate("/dashboard/requests"); }}>
                مركز الطلبات
              </button>
            ) : null}
            {canViewSecurity ? (
              <button type="button" onClick={() => { setOpen(false); navigate("/dashboard/attendance?tab=alerts"); }}>
                مركز حماية البصمة
              </button>
            ) : null}
          </footer>
        </section>,
        document.body
      ) : null}
    </>
  );
}
