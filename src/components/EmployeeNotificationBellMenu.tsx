import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faBell, faChevronLeft } from "@fortawesome/free-solid-svg-icons";

import {
  isEmployeeRequestNotificationId,
  listEmployeeNotifications,
  markEmployeeNotificationRead,
  type EmployeeNotification,
} from "../services/employeeNotificationsCore";
import {
  listEmployeeRequestNotifications,
  markEmployeeRequestNotificationRead,
} from "../services/employeeRequests";
import { auth } from "../services/firebase";
import { usePermissions } from "../security/PermissionContext";
import {
  formatNotificationTime,
  notificationTone,
  notificationTypeLabel,
  toMillis,
} from "../pages/hr/portalUtils";

type Props = {
  initialUnreadCount?: number;
};

type MenuPosition = {
  top: number;
  right: number;
  width: number;
};

const MAX_PREVIEW_NOTIFICATIONS = 7;

export default function EmployeeNotificationBellMenu({ initialUnreadCount = 0 }: Props) {
  const navigate = useNavigate();
  const { hasPermission } = usePermissions();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [notifications, setNotifications] = useState<EmployeeNotification[]>([]);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [position, setPosition] = useState<MenuPosition>({ top: 0, right: 12, width: 360 });

  const unreadCount = useMemo(() => {
    if (!loadedOnce) return Math.max(0, Number(initialUnreadCount || 0));
    return notifications.filter((note) => !note.isRead).length;
  }, [initialUnreadCount, loadedOnce, notifications]);

  const previewRows = useMemo(
    () => [...notifications]
      .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
      .slice(0, MAX_PREVIEW_NOTIFICATIONS),
    [notifications]
  );

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const width = Math.min(360, Math.max(280, viewportWidth - 24));
    const right = Math.max(12, viewportWidth - rect.right);
    setPosition({
      top: Math.round(rect.bottom + 8),
      right: Math.min(right, Math.max(12, viewportWidth - width - 12)),
      width,
    });
  }, []);

  const loadNotifications = useCallback(async () => {
    const uid = String(auth.currentUser?.uid || "").trim();
    if (!uid) {
      setNotifications([]);
      setLoadedOnce(true);
      return;
    }

    setLoading(true);
    try {
      const [workforceRows, requestRows] = await Promise.all([
        listEmployeeNotifications({ targetUid: uid, limitCount: 80 }).catch(() => []),
        hasPermission("employee_requests.own.view")
          ? listEmployeeRequestNotifications(80).catch(() => [])
          : Promise.resolve([]),
      ]);

      const requestNotificationRows: EmployeeNotification[] = requestRows.map((row) => ({
        id: row.id,
        targetUid: row.target_uid,
        type: "employee_request",
        title: row.title,
        body: row.body || undefined,
        route: row.related_id ? `/employee/requests/${row.related_id}` : "/employee/requests",
        isRead: Number(row.is_read) === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        readAt: row.read_at || undefined,
      }));

      const merged = new Map<string, EmployeeNotification>();
      [...requestNotificationRows, ...workforceRows].forEach((row) => merged.set(row.id, row));
      setNotifications(Array.from(merged.values()));
      setLoadedOnce(true);
    } finally {
      setLoading(false);
    }
  }, [hasPermission]);

  useEffect(() => {
    if (!open) return;
    updatePosition();
    void loadNotifications();

    const handleViewportChange = () => updatePosition();
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("scroll", handleViewportChange, true);
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("resize", handleViewportChange);
      window.removeEventListener("scroll", handleViewportChange, true);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [loadNotifications, open, updatePosition]);

  const openNotification = async (note: EmployeeNotification) => {
    const uid = String(auth.currentUser?.uid || "").trim();
    if (!uid || busyId) return;

    setBusyId(note.id);
    try {
      if (!note.isRead) {
        if (isEmployeeRequestNotificationId(note.id)) {
          await markEmployeeRequestNotificationRead(note.id);
        } else {
          await markEmployeeNotificationRead({ notificationId: note.id, readerUid: uid });
        }
        setNotifications((current) =>
          current.map((row) => row.id === note.id ? { ...row, isRead: true } : row)
        );
      }

      setOpen(false);
      if (note.route) navigate(note.route);
    } finally {
      setBusyId("");
    }
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="employee-header-notification employee-notification-bell-v2"
        aria-label="التنبيهات"
        title="التنبيهات"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <FontAwesomeIcon icon={faBell} />
        {unreadCount > 0 ? (
          <span className="employee-header-notification__badge">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              className="dashboard-v2 employee-notification-popover-v2"
              role="menu"
              aria-label="آخر التنبيهات"
              style={{ top: position.top, right: position.right, width: position.width }}
            >
              <header className="employee-notification-popover-v2__header">
                <div>
                  <span>مركز التنبيهات</span>
                  <strong>آخر التنبيهات</strong>
                </div>
                {unreadCount > 0 ? <em>{unreadCount} غير مقروء</em> : <em>لا يوجد جديد</em>}
              </header>

              <div className="employee-notification-popover-v2__list">
                {loading && !loadedOnce ? (
                  <div className="employee-notification-popover-v2__state">جاري تحميل التنبيهات...</div>
                ) : previewRows.length ? (
                  previewRows.map((note) => (
                    <button
                      key={note.id}
                      type="button"
                      role="menuitem"
                      className={`employee-notification-popover-v2__item ${note.isRead ? "" : "is-unread"}`}
                      onClick={() => void openNotification(note)}
                      disabled={busyId === note.id}
                    >
                      <span className={`employee-notification-popover-v2__tone is-${notificationTone(note.type)}`}>
                        {notificationTypeLabel(note.type)}
                      </span>
                      <span className="employee-notification-popover-v2__copy">
                        <strong>{note.title}</strong>
                        {note.body ? <small>{note.body}</small> : null}
                        <time>{formatNotificationTime(note.createdAt)}</time>
                      </span>
                      {!note.isRead ? <i aria-label="غير مقروء" /> : null}
                    </button>
                  ))
                ) : (
                  <div className="employee-notification-popover-v2__state">لا توجد تنبيهات حاليًا.</div>
                )}
              </div>

              <button
                type="button"
                className="employee-notification-popover-v2__all"
                onClick={() => {
                  setOpen(false);
                  navigate("/employee/notifications");
                }}
              >
                <span>عرض كل التنبيهات</span>
                <FontAwesomeIcon icon={faChevronLeft} />
              </button>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
