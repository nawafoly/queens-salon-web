import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  markEmployeeNotificationRead,
  markEmployeeNotificationsRead,
  type EmployeeNotification,
} from "../../services/employeeHub";
import {
  markAllEmployeeRequestNotificationsRead,
  markEmployeeRequestNotificationRead,
} from "../../services/employeeRequests";
import { cleanText, type HrSession } from "./shared";
import { formatNotificationTime, notificationTone, notificationTypeLabel, toMillis } from "./portalUtils";

type Props = {
  session: HrSession;
  notifications: EmployeeNotification[];
  onRefresh?: () => void | Promise<void>;
};

type FilterKey = "all" | "unread" | "message" | "file" | "leave" | "payroll" | "employee_request" | "system";

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "الكل" },
  { key: "unread", label: "غير مقروء" },
  { key: "message", label: "رسائل" },
  { key: "file", label: "ملفات" },
  { key: "leave", label: "إجازات" },
  { key: "payroll", label: "رواتب" },
  { key: "employee_request", label: "الطلبات" },
  { key: "system", label: "تنبيهات" },
];

export default function EmployeeNotificationsPage({ session, notifications, onRefresh }: Props) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterKey>("all");
  const [busyId, setBusyId] = useState("");

  const sorted = useMemo(
    () => [...notifications].sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)),
    [notifications]
  );

  const filtered = useMemo(() => {
    return sorted.filter((note) => {
      if (filter === "all") return true;
      if (filter === "unread") return !note.isRead;
      return cleanText(note.type).toLowerCase() === filter;
    });
  }, [filter, sorted]);

  const stats = useMemo(() => {
    const unread = notifications.filter((note) => !note.isRead);
    return {
      all: notifications.length,
      unread: unread.length,
      message: unread.filter((note) => note.type === "message").length,
      file: unread.filter((note) => note.type === "file").length,
      leave: unread.filter((note) => note.type === "leave").length,
      payroll: unread.filter((note) => note.type === "payroll").length,
      employee_request: unread.filter((note) => note.type === "employee_request").length,
    };
  }, [notifications]);

  const markAllRead = async () => {
    if (!session.uid) return;
    const unread = notifications.filter((note) => !note.isRead);
    if (!unread.length) return;
    const coreIds = unread.filter((note) => note.id.startsWith("request_notification_")).map((note) => note.id);
    const legacyIds = unread.filter((note) => !note.id.startsWith("request_notification_")).map((note) => note.id);
    setBusyId("all");
    try {
      await Promise.all([
        legacyIds.length ? markEmployeeNotificationsRead({ notificationIds: legacyIds, readerUid: session.uid }) : Promise.resolve(),
        coreIds.length ? markAllEmployeeRequestNotificationsRead() : Promise.resolve(),
      ]);
      await Promise.resolve(onRefresh?.());
    } finally {
      setBusyId("");
    }
  };

  const openNotification = async (note: EmployeeNotification) => {
    if (!session.uid) return;
    setBusyId(note.id);
    try {
      if (!note.isRead) {
        if (note.id.startsWith("request_notification_")) {
          await markEmployeeRequestNotificationRead(note.id);
        } else {
          await markEmployeeNotificationRead({ notificationId: note.id, readerUid: session.uid });
        }
      }
      await Promise.resolve(onRefresh?.());
      if (note.route) {
        navigate(note.route);
      }
    } finally {
      setBusyId("");
    }
  };

  return (
    <div className="employee-panel employee-notifications-page">
      <div className="employee-panel-head">
        <div>
          <p className="employee-panel-kicker">مركز التنبيهات</p>
          <h2>التنبيهات</h2>
          <p className="employee-panel-subtitle">
            راقب كل ما يصل إليك من رسائل وملفات وإجازات ورواتب في مساحة واحدة.
          </p>
        </div>

        <div className="employee-panel-actions">
          <button className="employee-button" type="button" onClick={() => void onRefresh?.()} disabled={busyId === "all"}>
            تحديث
          </button>
          <button
            className="employee-button employee-button--accent"
            type="button"
            onClick={() => void markAllRead()}
            disabled={busyId === "all" || !notifications.some((note) => !note.isRead)}
          >
            تأكيد الكل مقروء
          </button>
        </div>
      </div>

      <section className="employee-summary-grid">
        <article className="employee-summary-card">
          <span>كل التنبيهات</span>
          <strong>{stats.all}</strong>
        </article>
        <article className="employee-summary-card">
          <span>غير مقروء</span>
          <strong>{stats.unread}</strong>
        </article>
        <article className="employee-summary-card">
          <span>رسائل</span>
          <strong>{stats.message}</strong>
        </article>
        <article className="employee-summary-card">
          <span>ملفات</span>
          <strong>{stats.file}</strong>
        </article>
        <article className="employee-summary-card">
          <span>إجازات</span>
          <strong>{stats.leave}</strong>
        </article>
        <article className="employee-summary-card">
          <span>رواتب</span>
          <strong>{stats.payroll}</strong>
        </article>
        <article className="employee-summary-card">
          <span>الطلبات</span>
          <strong>{stats.employee_request}</strong>
        </article>
      </section>

      <div className="employee-filter-row">
        {FILTERS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`employee-filter-chip ${filter === item.key ? "is-active" : ""}`}
            onClick={() => setFilter(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <section className="employee-notification-list employee-notification-list--full">
        {filtered.map((note) => (
          <button
            key={note.id}
            type="button"
            className={`employee-notification-card employee-notification-card--full ${note.isRead ? "" : "is-unread"}`}
            onClick={() => void openNotification(note)}
            disabled={busyId === note.id}
          >
            <div className="employee-notification-card__head">
              <span className={`employee-notification-tone employee-notification-tone--${notificationTone(note.type)}`}>
                {notificationTypeLabel(note.type)}
              </span>
              <small>{formatNotificationTime(note.createdAt)}</small>
            </div>
            <strong>{note.title}</strong>
            {note.body ? <p>{note.body}</p> : null}
            <div className="employee-notification-card__foot">
              <span>{note.route || "بدون رابط"}</span>
              <em>{note.isRead ? "مقروء" : "غير مقروء"}</em>
            </div>
          </button>
        ))}
        {!filtered.length ? <div className="employee-muted">لا توجد تنبيهات مطابقة لهذا الفلتر.</div> : null}
      </section>
    </div>
  );
}

