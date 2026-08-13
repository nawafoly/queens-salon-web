import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBell } from "@fortawesome/free-solid-svg-icons";
import { useNavigate } from "react-router-dom";

import { usePermissions } from "../security/PermissionContext";
import {
  fetchAttendanceSecurityDashboard,
  type AttendanceSecurityEvent,
  type AttendanceWorkerRecord,
} from "../services/attendanceWorkerService";
import "../styles/AdminAttendanceSecurityBell.css";

const POLL_INTERVAL_MS = 15_000;
const OUTSIDE_ZONE_BURST_WINDOW_MS = 10 * 60_000;
const OUTSIDE_ZONE_BURST_THRESHOLD = 3;

type SecurityNotification = {
  id: string;
  severity: "warning" | "critical";
  title: string;
  body: string;
  employeeName: string;
  createdAt: string;
  eventIds: string[];
  count: number;
};

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function eventMillis(value: unknown) {
  const parsed = Date.parse(cleanText(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNotificationTime(value: unknown) {
  const parsed = eventMillis(value);
  if (!parsed) return "";
  try {
    return new Intl.DateTimeFormat("ar-SA", {
      timeZone: "Asia/Riyadh",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(parsed));
  } catch {
    return cleanText(value);
  }
}

function employeeLabel(event: AttendanceSecurityEvent) {
  return cleanText(event.employeeName || event.employeeDocId || event.employeeUid) || "موظفة غير معروفة";
}

function deviceLabel(event: AttendanceSecurityEvent) {
  const value = cleanText(event.deviceId);
  if (!value) return "جهاز غير معروف";
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

function collapseDirectSecurityEvents(
  alerts: AttendanceSecurityEvent[],
  recordsById: Map<string, AttendanceWorkerRecord>
): SecurityNotification[] {
  const groups = new Map<string, AttendanceSecurityEvent[]>();

  for (const event of alerts) {
    let actionable = false;

    if (event.eventType === "shared_device" || event.eventType === "blocked_device_attempt") {
      actionable = true;
    } else if (event.eventType === "device_changed") {
      const record = event.recordId ? recordsById.get(event.recordId) : undefined;
      // لا نزعج الإدارة بتغيير جهاز ناتج عن محاولة مرفوضة متكررة.
      // نرفع التحذير هنا فقط إذا نجحت البصمة فعليًا من الجهاز المختلف.
      actionable = record?.result === "allowed";
    }

    if (!actionable) continue;

    const key = [event.eventType, event.employeeUid, cleanText(event.deviceId)].join(":");
    const current = groups.get(key) || [];
    current.push(event);
    groups.set(key, current);
  }

  const output: SecurityNotification[] = [];

  for (const [key, rows] of groups.entries()) {
    const sorted = [...rows].sort((a, b) => eventMillis(b.createdAt) - eventMillis(a.createdAt));
    const latest = sorted[0];
    if (!latest) continue;

    let title = latest.title;
    let body = latest.detail || "تم رصد حدث أمني في نظام البصمة.";
    let severity: SecurityNotification["severity"] = latest.severity === "critical" ? "critical" : "warning";

    if (latest.eventType === "shared_device") {
      title = "اشتباه استخدام جهاز مشترك في البصمة";
      body = `ظهر معرّف الجهاز نفسه في أكثر من حساب. الجهاز: ${deviceLabel(latest)}.`;
      severity = "critical";
    } else if (latest.eventType === "blocked_device_attempt") {
      title = "محاولة بصمة من جهاز محظور";
      body = `تم منع محاولة بصمة من جهاز محظور. الجهاز: ${deviceLabel(latest)}.`;
      severity = "critical";
    } else if (latest.eventType === "device_changed") {
      title = "بصمة ناجحة من جهاز مختلف";
      body = `تم قبول بصمة من جهاز مختلف عن الجهاز الناجح السابق. الجهاز: ${deviceLabel(latest)}.`;
      severity = "warning";
    }

    if (sorted.length > 1) {
      body += ` يوجد ${sorted.length} أحداث مفتوحة مرتبطة بنفس الحالة.`;
    }

    output.push({
      id: `direct:${key}`,
      severity,
      title,
      body,
      employeeName: employeeLabel(latest),
      createdAt: latest.createdAt,
      eventIds: sorted.map((item) => item.id),
      count: sorted.length,
    });
  }

  return output;
}

function buildOutsideZoneBurstNotifications(alerts: AttendanceSecurityEvent[]): SecurityNotification[] {
  const groups = new Map<string, AttendanceSecurityEvent[]>();

  for (const event of alerts) {
    if (event.eventType !== "rejected_punch") continue;
    if (cleanText(event.metadata?.rejectionReason) !== "outside_zone") continue;

    const key = [event.employeeUid, cleanText(event.deviceId)].join(":");
    const current = groups.get(key) || [];
    current.push(event);
    groups.set(key, current);
  }

  const output: SecurityNotification[] = [];

  for (const [key, rows] of groups.entries()) {
    const sorted = [...rows].sort((a, b) => eventMillis(a.createdAt) - eventMillis(b.createdAt));
    const latest = sorted[sorted.length - 1];
    const latestMs = eventMillis(latest?.createdAt);
    if (!latest || !latestMs) continue;

    const burst = sorted.filter((item) => {
      const timestamp = eventMillis(item.createdAt);
      return timestamp > 0 && latestMs - timestamp <= OUTSIDE_ZONE_BURST_WINDOW_MS;
    });

    if (burst.length < OUTSIDE_ZONE_BURST_THRESHOLD) continue;

    output.push({
      id: `outside-zone-burst:${key}:${Math.floor(latestMs / OUTSIDE_ZONE_BURST_WINDOW_MS)}`,
      severity: "warning",
      title: "محاولات بصمة متكررة خارج نطاق العمل",
      body: `${burst.length} محاولات مرفوضة خلال آخر 10 دقائق من الجهاز ${deviceLabel(latest)}. راجع الموقع والجهاز قبل اتخاذ إجراء إداري.`,
      employeeName: employeeLabel(latest),
      createdAt: latest.createdAt,
      eventIds: burst.map((item) => item.id),
      count: burst.length,
    });
  }

  return output;
}

function buildSecurityNotifications(
  alerts: AttendanceSecurityEvent[],
  records: AttendanceWorkerRecord[]
) {
  const recordsById = new Map(records.map((record) => [record.id, record]));
  const direct = collapseDirectSecurityEvents(alerts, recordsById);
  const outsideZoneBursts = buildOutsideZoneBurstNotifications(alerts);

  return [...direct, ...outsideZoneBursts].sort((left, right) => {
    if (left.severity !== right.severity) {
      return left.severity === "critical" ? -1 : 1;
    }
    return eventMillis(right.createdAt) - eventMillis(left.createdAt);
  });
}

export default function AdminAttendanceSecurityBell() {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const allowed = hasPermission("attendance.view");
  const [alerts, setAlerts] = useState<AttendanceSecurityEvent[]>([]);
  const [records, setRecords] = useState<AttendanceWorkerRecord[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const notifications = useMemo(
    () => buildSecurityNotifications(alerts, records),
    [alerts, records]
  );

  const criticalCount = useMemo(
    () => notifications.filter((item) => item.severity === "critical").length,
    [notifications]
  );

  const refresh = useCallback(async () => {
    if (!allowed) {
      setAlerts([]);
      setRecords([]);
      return;
    }

    setLoading(true);
    try {
      const dashboard = await fetchAttendanceSecurityDashboard({
        alertStatus: "open",
        limit: 200,
      });
      setAlerts(dashboard.alerts);
      setRecords(dashboard.records);
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useEffect(() => {
    if (!allowed) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [allowed, refresh]);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        !target?.closest(".admin-attendance-security-bell") &&
        !target?.closest(".admin-attendance-security-popover")
      ) {
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

  const openSecurityCenter = useCallback((eventId?: string) => {
    setOpen(false);
    const query = eventId ? `?tab=alerts&alert=${encodeURIComponent(eventId)}` : "?tab=alerts";
    navigate(`/dashboard/attendance${query}`);
  }, [navigate]);

  if (!allowed) return null;

  return (
    <>
      <div className="admin-attendance-security-bell">
        <button
          type="button"
          className={`internal-portal-switcher__item admin-attendance-security-bell__button ${criticalCount ? "has-critical" : notifications.length ? "has-warning" : ""} ${open ? "is-open" : ""}`}
          onClick={() => {
            setOpen((current) => !current);
            if (!open) void refresh();
          }}
          aria-label={`تنبيهات أمان البصمة${notifications.length ? `، ${notifications.length} حالة مفتوحة` : ""}`}
          aria-expanded={open}
          title="تنبيهات أمان البصمة"
        >
          <FontAwesomeIcon icon={faBell} />
          <span className="admin-attendance-security-bell__label">أمان</span>
          {notifications.length ? (
            <em className="admin-attendance-security-bell__badge">
              {notifications.length > 99 ? "99+" : notifications.length}
            </em>
          ) : null}
        </button>
      </div>

      {open && typeof document !== "undefined" ? createPortal(
        <section className="admin-attendance-security-popover" aria-label="تنبيهات أمان البصمة">
          <header>
            <div>
              <small>إشعارات الإدارة</small>
              <strong>أمان البصمة</strong>
            </div>
            <button type="button" onClick={() => void refresh()} disabled={loading}>
              {loading ? "جاري التحديث..." : "تحديث"}
            </button>
          </header>

          <div className="admin-attendance-security-popover__summary">
            <span>الحالات المفتوحة <strong>{notifications.length}</strong></span>
            <span>حرجة <strong>{criticalCount}</strong></span>
          </div>

          <div className="admin-attendance-security-popover__list">
            {loadError && !notifications.length ? (
              <p>تعذر تحديث تنبيهات أمان البصمة الآن.</p>
            ) : notifications.length ? (
              notifications.slice(0, 12).map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`admin-attendance-security-popover__item is-${item.severity}`}
                  onClick={() => openSecurityCenter(item.eventIds[0])}
                >
                  <span className="admin-attendance-security-popover__dot" />
                  <span className="admin-attendance-security-popover__copy">
                    <strong>{item.title}</strong>
                    <b>{item.employeeName}</b>
                    <small>{item.body}</small>
                    <time>{formatNotificationTime(item.createdAt)}</time>
                  </span>
                </button>
              ))
            ) : (
              <p>لا توجد حالات تلاعب أو اشتباه مفتوحة حاليًا.</p>
            )}
          </div>

          <footer>
            <button type="button" onClick={() => openSecurityCenter()}>
              فتح مركز حماية البصمة
            </button>
            <small>يبقى التنبيه مفتوحًا حتى تتم معالجته أو تجاهله من مركز الحماية.</small>
          </footer>
        </section>,
        document.body
      ) : null}
    </>
  );
}
