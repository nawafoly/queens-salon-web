import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  isEmployeeRequestNotificationId,
  markAllEmployeeNotificationsRead,
  markEmployeeNotificationRead,
  type EmployeeNotification,
} from "../../services/employeeNotificationsCore";
import {
  markAllEmployeeRequestNotificationsRead,
  markEmployeeRequestNotificationRead,
} from "../../services/employeeRequests";
import { cleanText, type HrSession } from "./shared";
import { formatNotificationTime, notificationTone, notificationTypeLabel, toMillis } from "./portalUtils";
import { useEmployeePortalLanguage } from "../../features/employee-portal/EmployeePortalLanguage";

type Props = {
  session: HrSession;
  notifications: EmployeeNotification[];
  onRefresh?: () => void | Promise<void>;
};

type FilterKey = "all" | "unread" | "message" | "file" | "leave" | "payroll" | "employee_request" | "system";

const FILTERS: Array<{ key: FilterKey; ar: string; en: string }> = [
  { key: "all", ar: "الكل", en: "All" },
  { key: "unread", ar: "غير مقروء", en: "Unread" },
  { key: "message", ar: "رسائل", en: "Messages" },
  { key: "file", ar: "ملفات", en: "Files" },
  { key: "leave", ar: "إجازات", en: "Leave" },
  { key: "payroll", ar: "رواتب", en: "Payroll" },
  { key: "employee_request", ar: "الطلبات", en: "Requests" },
  { key: "system", ar: "تنبيهات", en: "Alerts" },
];

export default function EmployeeNotificationsPage({ session, notifications, onRefresh }: Props) {
  const { language } = useEmployeePortalLanguage();
  const tr = (ar: string, en: string) => language === "en" ? en : ar;
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
    const hasRequestUnread = unread.some((note) => isEmployeeRequestNotificationId(note.id));
    const hasWorkforceUnread = unread.some((note) => !isEmployeeRequestNotificationId(note.id));
    setBusyId("all");
    try {
      await Promise.all([
        hasWorkforceUnread ? markAllEmployeeNotificationsRead() : Promise.resolve(),
        hasRequestUnread ? markAllEmployeeRequestNotificationsRead() : Promise.resolve(),
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
        if (isEmployeeRequestNotificationId(note.id)) {
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
    <div className="employee-panel employee-notifications-page" dir={language === "en" ? "ltr" : "rtl"} lang={language}>
      <div className="employee-panel-head">
        <div>
          <p className="employee-panel-kicker">{tr("مركز التنبيهات", "Notification center")}</p>
          <h2>{tr("التنبيهات", "Notifications")}</h2>
          <p className="employee-panel-subtitle">
            {tr("راقب كل ما يصل إليك من رسائل وملفات وإجازات ورواتب في مساحة واحدة.", "Keep track of your messages, files, leave and payroll in one place.")}
          </p>
        </div>

        <div className="employee-panel-actions">
          <button className="employee-button" type="button" onClick={() => void onRefresh?.()} disabled={busyId === "all"}>
            {tr("تحديث", "Refresh")}
          </button>
          <button
            className="employee-button employee-button--accent"
            type="button"
            onClick={() => void markAllRead()}
            disabled={busyId === "all" || !notifications.some((note) => !note.isRead)}
          >
            {tr("تأكيد الكل مقروء", "Mark all as read")}
          </button>
        </div>
      </div>

      <section className="employee-summary-grid">
        <article className="employee-summary-card">
          <span>{tr("كل التنبيهات", "All notifications")}</span>
          <strong>{stats.all}</strong>
        </article>
        <article className="employee-summary-card">
          <span>{tr("غير مقروء", "Unread")}</span>
          <strong>{stats.unread}</strong>
        </article>
        <article className="employee-summary-card">
          <span>{tr("رسائل", "Messages")}</span>
          <strong>{stats.message}</strong>
        </article>
        <article className="employee-summary-card">
          <span>{tr("ملفات", "Files")}</span>
          <strong>{stats.file}</strong>
        </article>
        <article className="employee-summary-card">
          <span>{tr("إجازات", "Leave")}</span>
          <strong>{stats.leave}</strong>
        </article>
        <article className="employee-summary-card">
          <span>{tr("رواتب", "Payroll")}</span>
          <strong>{stats.payroll}</strong>
        </article>
        <article className="employee-summary-card">
          <span>{tr("الطلبات", "Requests")}</span>
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
            {item[language]}
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
                {notificationTypeLabel(note.type, language)}
              </span>
              <small>{formatNotificationTime(note.createdAt, language)}</small>
            </div>
            <strong>{note.title}</strong>
            {note.body ? <p>{note.body}</p> : null}
            <div className="employee-notification-card__foot">
              <span>{note.route || tr("بدون رابط", "No link")}</span>
              <em>{note.isRead ? tr("مقروء", "Read") : tr("غير مقروء", "Unread")}</em>
            </div>
          </button>
        ))}
        {!filtered.length ? <div className="employee-muted">{tr("لا توجد تنبيهات مطابقة لهذا الفلتر.", "No notifications match this filter.")}</div> : null}
      </section>
    </div>
  );
}
