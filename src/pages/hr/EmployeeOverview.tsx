import { Link, useNavigate } from "react-router-dom";

import { markEmployeeNotificationRead, type EmployeeNotification } from "../../services/employeeHub";
import { cleanText, formatShortDate, type HrSession } from "./shared";
import { formatNotificationTime, notificationTone, notificationTypeLabel, toMillis } from "./portalUtils";

type Props = {
  session: HrSession;
  notifications: EmployeeNotification[];
  onRefresh?: () => void | Promise<void>;
};

function roleLabel(role: string) {
  const normalized = cleanText(role).toLowerCase();
  if (normalized === "owner") return "مالك";
  if (normalized === "admin") return "مدير";
  if (normalized === "hr") return "موارد بشرية";
  if (normalized === "reception") return "استقبال";
  if (normalized === "staff") return "موظف";
  return "موظف";
}

function getProfileSource(session: HrSession) {
  return session.staffDoc || session.employeeDoc || session.userDoc || {};
}

export default function EmployeeOverviewPage({ session, notifications, onRefresh }: Props) {
  const navigate = useNavigate();
  const profile = getProfileSource(session);
  const displayName = cleanText(profile.displayName || profile.name || session.displayName || session.email || "Employee");
  const department = cleanText(profile.department || "");
  const title = cleanText(profile.title || "");
  const avatarUrl = cleanText(profile.avatarUrl || profile.photoURL || profile.photoUrl || "");
  const leaveUntil = cleanText(profile.leaveUntil || "");
  const onLeave = !!profile.onLeave && (!leaveUntil || leaveUntil >= new Date().toISOString().slice(0, 10));
  const active = profile.active !== false;

  const unread = notifications.filter((note) => !note.isRead);
  const summary = {
    all: unread.length,
    message: unread.filter((note) => note.type === "message" || note.route === "/employee/messages").length,
    file: unread.filter((note) => note.type === "file" || note.route === "/employee/files").length,
    leave: unread.filter((note) => note.type === "leave" || note.route === "/employee/leave").length,
    payroll: unread.filter((note) => note.type === "payroll" || note.route === "/employee/payroll").length,
  };

  const latestNotes = [...notifications]
    .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
    .slice(0, 6);

  const quickActions = [
    { label: "الرسائل", href: "/employee/messages", note: summary.message, description: "تابع محادثاتك الداخلية" },
    { label: "الملفات", href: "/employee/files", note: summary.file, description: "شاهد الملفات الجديدة والمرفوعة" },
    { label: "الإجازات", href: "/employee/leave", note: summary.leave, description: "اطّلع على طلباتك وحالتها" },
    { label: "الرواتب", href: "/employee/payroll", note: summary.payroll, description: "راجع مسيرات الرواتب" },
    { label: "التنبيهات", href: "/employee/notifications", note: summary.all, description: "عرض كل التحديثات" },
  ];

  const openNotification = async (note: EmployeeNotification) => {
    if (!session.uid) return;
    if (!note.isRead) {
      await markEmployeeNotificationRead({ notificationId: note.id, readerUid: session.uid }).catch(() => {});
      await Promise.resolve(onRefresh?.());
    }
    if (note.route) {
      navigate(note.route);
    }
  };

  const statusLabel = onLeave
    ? leaveUntil
      ? `في إجازة حتى ${formatShortDate(leaveUntil)}`
      : "في إجازة"
    : active
      ? "نشط"
      : "غير نشط";

  return (
    <div className="employee-panel employee-overview">
      <section className="employee-hero">
        <div className="employee-hero__copy">
          <p className="employee-panel-kicker">بوابة الموظف</p>
          <h2>مرحبًا {displayName}</h2>
          <p className="employee-panel-subtitle">
            هنا تتابع رسائلك، ملفاتك، إجازاتك، ومسيراتك في مكان واحد واضح وسريع.
          </p>
          <div className="employee-hero__chips">
            <span className="employee-status-chip">{statusLabel}</span>
            <span className="employee-status-chip employee-status-chip--soft">{roleLabel(session.role)}</span>
            <span className="employee-status-chip employee-status-chip--soft">
              {session.employeeId ? `الرقم الوظيفي ${session.employeeId}` : "لا يوجد رقم وظيفي"}
            </span>
          </div>
        </div>

        <div className="employee-hero__profile">
          <div className="employee-avatar employee-avatar--large">
            {avatarUrl ? <img src={avatarUrl} alt={displayName} /> : <span>{displayName.slice(0, 1).toUpperCase()}</span>}
          </div>
          <div>
            <strong>{displayName}</strong>
            <span>{department || "بدون قسم"}</span>
            <small>{title || "بدون مسمى وظيفي"}</small>
          </div>
          <div className="employee-hero__meta">
            <span>{session.email || "بدون بريد"}</span>
            <span>{session.uid ? `UID: ${session.uid}` : "غير متصل"}</span>
          </div>
        </div>
      </section>

      <section className="employee-summary-grid">
        <article className="employee-summary-card">
          <span>التنبيهات الجديدة</span>
          <strong>{summary.all}</strong>
          <small>كل ما لم يُقرأ بعد</small>
        </article>
        <article className="employee-summary-card">
          <span>رسائل جديدة</span>
          <strong>{summary.message}</strong>
          <small>التواصل الداخلي</small>
        </article>
        <article className="employee-summary-card">
          <span>ملفات جديدة</span>
          <strong>{summary.file}</strong>
          <small>مستندات وحزم موارد</small>
        </article>
        <article className="employee-summary-card">
          <span>إجازات</span>
          <strong>{summary.leave}</strong>
          <small>طلبات أو تحديثات الإجازة</small>
        </article>
        <article className="employee-summary-card">
          <span>رواتب</span>
          <strong>{summary.payroll}</strong>
          <small>مسيرات وأرشيف الرواتب</small>
        </article>
      </section>

      <section className="employee-actions-grid">
        {quickActions.map((action) => (
          <Link key={action.href} to={action.href} className="employee-action-card">
            <div>
              <span>{action.label}</span>
              <strong>{action.note}</strong>
            </div>
            <p>{action.description}</p>
          </Link>
        ))}
      </section>

      <section className="employee-card">
        <div className="employee-card-head">
          <h3>آخر التنبيهات</h3>
          <button className="employee-button employee-button--ghost" type="button" onClick={() => void onRefresh?.()}>
            تحديث
          </button>
        </div>

        <div className="employee-notification-list">
          {latestNotes.map((note) => (
            <button
              key={note.id}
              type="button"
              className={`employee-notification-card ${note.isRead ? "" : "is-unread"}`}
              onClick={() => void openNotification(note)}
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
                {!note.isRead ? <em>غير مقروء</em> : <em>مقروء</em>}
              </div>
            </button>
          ))}
          {!latestNotes.length ? <div className="employee-muted">لا توجد تنبيهات بعد.</div> : null}
        </div>
      </section>
    </div>
  );
}
