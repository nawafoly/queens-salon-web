import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBell,
  faCalendarDays,
  faChartLine,
  faFileLines,
  faFingerprint,
  faHouse,
  faPaperPlane,
  faPlus,
  faRightFromBracket,
  faTableColumns,
  faTriangleExclamation,
  faUser,
  faUserShield,
  faWallet,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";

import {
  listEmployeeNotifications,
  type EmployeeNotification,
} from "../services/employeeHub";
import { logoutFirebase } from "../services/authService";
import EmployeeFilesPage from "./hr/EmployeeFiles";
import EmployeeMessagesPage from "./hr/EmployeeMessages";
import EmployeeNotificationsPage from "./hr/EmployeeNotifications";
import EmployeeOverviewPage from "./hr/EmployeeOverview";
import EmployeeLeavePage from "./hr/EmployeeLeave";
import EmployeePayrollPage from "./hr/EmployeePayroll";
import EmployeeProfilePage from "./hr/EmployeeProfile";
import { useEmployeeSession } from "./hr/shared";
import InternalPortalSwitcher from "../components/InternalPortalSwitcher";
import "../styles/EmployeePortalMobileNav.css";

function PortalSkeleton({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="employee-portal-card employee-portal-loading-card">
      <span className="employee-portal-loading-mark" aria-hidden="true" />
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </div>
  );
}

function cleanPortalText(value: unknown) {
  return String(value || "").trim();
}

function displayInitial(name: string, email: string) {
  const source = cleanPortalText(name) || cleanPortalText(email) || "M";
  return source.slice(0, 1).toUpperCase();
}

function portalRoleLabel(role: unknown) {
  const normalized = cleanPortalText(role).toLowerCase();
  if (normalized === "owner") return "المالك";
  if (normalized === "admin") return "الإدارة";
  if (normalized === "hr") return "الموارد البشرية";
  if (normalized === "reception") return "الاستقبال";
  return "موظفة";
}

type EmployeeMorePageProps = {
  displayName: string;
  roleLabel: string;
  notificationCounts: {
    all: number;
    messages: number;
    files: number;
    leave: number;
    payroll: number;
    profile: number;
  };
};

function EmployeeMorePage({
  displayName,
  roleLabel,
  notificationCounts,
}: EmployeeMorePageProps) {
  const items = [
    {
      to: "/employee/notifications",
      label: "التنبيهات",
      description: "آخر التحديثات والتنبيهات",
      icon: faBell,
      badge: notificationCounts.all,
    },
    {
      to: "/employee/messages",
      label: "الرسائل",
      description: "التواصل الداخلي مع الإدارة",
      icon: faPaperPlane,
      badge: notificationCounts.messages,
    },
    {
      to: "/employee/files",
      label: "الملفات",
      description: "العقود والمستندات والمرفقات",
      icon: faFileLines,
      badge: notificationCounts.files,
    },
    {
      to: "/employee/payroll",
      label: "الراتب",
      description: "التفاصيل والسجلات المالية",
      icon: faWallet,
      badge: notificationCounts.payroll,
    },
  ];

  return (
    <section className="employee-more-page">
      <header className="employee-more-hero">
        <span className="employee-more-hero__avatar">
          {displayInitial(displayName, "")}
        </span>

        <div>
          <small>حساب الموظفة</small>
          <h1>{displayName}</h1>
          <p>{roleLabel}</p>
        </div>
      </header>

      <div className="employee-more-grid">
        {items.map((item) => (
          <Link
            key={item.to}
            to={item.to}
            className="employee-more-card"
          >
            <span className="employee-more-card__icon">
              <FontAwesomeIcon icon={item.icon} />
            </span>

            <div>
              <strong>{item.label}</strong>
              <small>{item.description}</small>
            </div>

            {item.badge > 0 ? (
              <em>{item.badge}</em>
            ) : null}
          </Link>
        ))}
      </div>

    </section>
  );
}

export default function EmployeePortal() {
  const session = useEmployeeSession();
  const navigate = useNavigate();
  const location = useLocation();
  const [notifications, setNotifications] = useState<EmployeeNotification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [requestSheetOpen, setRequestSheetOpen] = useState(false);
  const notificationsRequestRef = useRef(0);

  const loadNotifications = useCallback(async () => {
    const requestId = ++notificationsRequestRef.current;
    if (!session.uid) {
      if (requestId !== notificationsRequestRef.current) return;
      setNotifications([]);
      setNotificationsLoading(false);
      return;
    }

    setNotificationsLoading(true);
    try {
      const rows = await listEmployeeNotifications({
        targetUid: session.uid,
        targetEmployeeId: session.employeeId,
        limitCount: 200,
      });
      if (requestId !== notificationsRequestRef.current) return;
      setNotifications(rows);
    } catch {
      if (requestId !== notificationsRequestRef.current) return;
      setNotifications([]);
    } finally {
      if (requestId === notificationsRequestRef.current) {
        setNotificationsLoading(false);
      }
    }
  }, [session.employeeId, session.uid]);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    const handleFocus = () => void loadNotifications();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [loadNotifications]);

  useEffect(() => {
    if (!requestSheetOpen) return;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setRequestSheetOpen(false);
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [requestSheetOpen]);

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logoutFirebase();
    } finally {
      navigate("/hr", { replace: true });
      setLoggingOut(false);
    }
  };

  const notificationCounts = useMemo(() => {
    const unread = notifications.filter((note) => !note.isRead);
    return {
      all: unread.length,
      messages: unread.filter((note) => note.type === "message" || note.route === "/employee/messages").length,
      files: unread.filter((note) => note.type === "file" || note.route === "/employee/files").length,
      leave: unread.filter((note) => note.type === "leave" || note.route === "/employee/leave").length,
      payroll: unread.filter((note) => note.type === "payroll" || note.route === "/employee/payroll").length,
      profile: unread.filter((note) => note.type === "system" || note.route === "/employee/profile").length,
    };
  }, [notifications]);

  const displayName = cleanPortalText(session.displayName) || cleanPortalText(session.email) || "الموظفة";
  const role = cleanPortalText(session.role).toLowerCase();
  const roleLabel = portalRoleLabel(role);
  const portalSubtitle = "الدوام، الإجازات، الملفات والرسائل";
  const canOpenHr = role === "owner" || role === "admin" || role === "hr";
  const canOpenDashboard =
    role === "owner" || role === "admin" || role === "hr" || role === "reception";

  const bottomNavItems = [
    { to: "/employee/overview", label: "الرئيسية", icon: faHouse, end: true },
    { to: "/employee/attendance", label: "الحضور", icon: faCalendarDays, end: true },
    { to: "/employee/leave", label: "الطلبات", icon: faPaperPlane },
    { to: "/employee/profile", label: "الملف الشخصي", icon: faUser },
    { to: "/employee/more", label: "المزيد", icon: faTableColumns, badge: notificationCounts.all },
  ];

  const desktopNavItems = [
    { to: "/employee/overview", label: "الرئيسية", description: "ملخص يوم العمل", icon: faHouse, end: true },
    { to: "/employee/attendance", label: "الحضور والانصراف", description: "السجل الشهري", icon: faFingerprint, end: true },
    { to: "/employee/leave", label: "الإجازات والطلبات", description: "الرصيد والطلبات", icon: faCalendarDays, badge: notificationCounts.leave },
    { to: "/employee/payroll", label: "الراتب", description: "التفاصيل المالية", icon: faWallet, badge: notificationCounts.payroll },
    { to: "/employee/messages", label: "الرسائل", description: "التواصل الداخلي", icon: faPaperPlane, badge: notificationCounts.messages },
    { to: "/employee/files", label: "الملفات", description: "المستندات والعقود", icon: faFileLines, badge: notificationCounts.files },
    { to: "/employee/profile", label: "الملف الشخصي", description: "البيانات الوظيفية", icon: faUser, badge: notificationCounts.profile },
    { to: "/employee/notifications", label: "التنبيهات", description: "آخر التحديثات", icon: faBell, badge: notificationCounts.all },
  ];

  const requestItems = [
    { label: "طلب تصحيح", description: "تصحيح بصمة أو وقت حضور", icon: faFingerprint, to: "/employee/attendance" },
    { label: "طلب استئذان", description: "طلب خروج مؤقت أو تأخير", icon: faTriangleExclamation, to: "/employee/messages" },
    { label: "طلب أوفرتايم", description: "تسجيل ساعات عمل إضافية", icon: faChartLine, to: "/employee/messages" },
    { label: "صرف معجل للراتب", description: "طلب مالي يراجع من HR", icon: faWallet, to: "/employee/payroll" },
    { label: "طلب إجازة", description: "رفع طلب إجازة جديد", icon: faPaperPlane, to: "/employee/leave" },
    { label: "طلب خروج وعودة", description: "طلب إداري للمتابعة", icon: faRightFromBracket, to: "/employee/messages" },
    { label: "طلب استقالة", description: "يرسل للإدارة للمراجعة", icon: faFileLines, to: "/employee/messages" },
  ];

  if (session.loading) {
    return (
      <div className="employee-portal madan-employee-portal" dir="rtl">
        <div className="employee-portal-layout employee-portal-layout--loading">
          <PortalSkeleton
            title="جاري تحميل بوابة الموظف"
            subtitle="نستعد لعرض الرسائل والملفات والإجازات والتنبيهات الخاصة بك."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="employee-portal madan-employee-portal" dir="rtl">
      <header
        className="employee-mobile-topbar employee-app-topbar"
        aria-label="بوابة الموظف"
      >
        <Link
          to="/employee/profile"
          className="employee-app-topbar__profile"
          aria-label="فتح الملف الشخصي"
        >
          <span className="employee-app-topbar__avatar">
            {displayInitial(displayName, session.email)}
          </span>

          <span className="employee-app-topbar__copy">
            <strong>بوابة الموظف</strong>
            <small>{displayName}</small>
          </span>
        </Link>

        <div
          className="employee-app-topbar__actions"
          aria-label="اختصارات بوابة الموظف"
        >
          <InternalPortalSwitcher
            canOpenDashboard={canOpenDashboard}
            canOpenHr={canOpenHr}
            canOpenEmployee={true}
            loggingOut={loggingOut}
            onLogout={handleLogout}
          />

          <Link
            to="/employee/notifications"
            className="employee-app-topbar__action employee-app-topbar__action--notifications"
            aria-label="التنبيهات"
            title="التنبيهات"
          >
            <FontAwesomeIcon icon={faBell} />

            {notificationCounts.all > 0 ? (
              <span className="employee-app-topbar__badge">
                {notificationCounts.all}
              </span>
            ) : null}
          </Link>
        </div>
      </header>

      <div className="employee-portal-layout employee-portal-layout--app">
        <aside className="employee-portal-sidebar employee-portal-sidebar--desktop" aria-label="التنقل داخل بوابة الموظف">
          <div className="employee-portal-sidebar__profile">
            <span className="employee-portal-sidebar__avatar">{displayInitial(displayName, session.email)}</span>
            <div>
              <small>بوابة الموظف</small>
              <strong>{displayName}</strong>
              <span>{roleLabel}</span>
            </div>
          </div>

          <button
            type="button"
            className="employee-sidebar-request"
            onClick={() => setRequestSheetOpen(true)}
          >
            <FontAwesomeIcon icon={faPlus} />
            <span>إنشاء طلب جديد</span>
          </button>

          <nav className="employee-portal-desktop-nav">
            {desktopNavItems.map((item) => (
              <NavLink
                key={`${item.to}-${item.label}`}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `employee-portal-desktop-link ${isActive ? "is-active" : ""}`}
              >
                <span className="employee-portal-desktop-link__icon">
                  <FontAwesomeIcon icon={item.icon} />
                </span>
                <span className="employee-portal-desktop-link__copy">
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
                {item.badge ? <em>{item.badge}</em> : null}
              </NavLink>
            ))}
          </nav>

          <div className="employee-portal-sidebar__footer">
            <span>{notificationsLoading ? "جاري تحديث التنبيهات..." : portalSubtitle}</span>
            <div className="employee-portal-sidebar__switches">
              {canOpenHr ? (
                <Link to="/admin"><FontAwesomeIcon icon={faUserShield} /> لوحة HR</Link>
              ) : null}
              {canOpenDashboard ? (
                <Link to="/dashboard/overview"><FontAwesomeIcon icon={faTableColumns} /> الداشبورد</Link>
              ) : null}
            </div>
            <button type="button" onClick={() => void handleLogout()} disabled={loggingOut}>
              <FontAwesomeIcon icon={faRightFromBracket} />
              {loggingOut ? "جاري الخروج..." : "تسجيل الخروج"}
            </button>
          </div>
        </aside>

        <main className="employee-portal-main">
          <div className="employee-app-route-scroll">
<Routes>
            <Route index element={<Navigate to="/employee/overview" replace />} />
            <Route
              path="overview"
              element={
                <EmployeeOverviewPage
                  session={session}
                  notifications={notifications}
                  onRefresh={loadNotifications}
                />
              }
            />
            <Route
              path="attendance"
              element={
                <EmployeeOverviewPage
                  session={session}
                  notifications={notifications}
                  onRefresh={loadNotifications}
                  attendanceOnly
                />
              }
            />
            <Route
              path="notifications"
              element={
                <EmployeeNotificationsPage
                  session={session}
                  notifications={notifications}
                  onRefresh={loadNotifications}
                />
              }
            />
            <Route
              path="more"
              element={
                <EmployeeMorePage
                  displayName={displayName}
                  roleLabel={roleLabel}
                  notificationCounts={notificationCounts}
                />
              }
            />
            <Route
              path="profile"
              element={
                <EmployeeProfilePage
                    session={session}
                    onPortalChange={loadNotifications}
                  />
              }
            />
            <Route
              path="messages"
              element={<EmployeeMessagesPage session={session} onPortalChange={loadNotifications} />}
            />
            <Route
              path="files"
              element={<EmployeeFilesPage session={session} onPortalChange={loadNotifications} />}
            />
            <Route
              path="leave"
              element={<EmployeeLeavePage session={session} onPortalChange={loadNotifications} />}
            />
            <Route
              path="payroll"
              element={<EmployeePayrollPage session={session} onPortalChange={loadNotifications} />}
            />
            <Route path="*" element={<Navigate to="/employee/overview" replace />} />
          </Routes>
</div>
        </main>
      </div>

      {location.pathname.startsWith("/employee/leave") ? (
        <button
          type="button"
          className="employee-floating-request"
          onClick={() => setRequestSheetOpen(true)}
        >
          <FontAwesomeIcon icon={faPlus} />
          <span>طلب جديد</span>
        </button>
      ) : null}

      <nav className="employee-bottom-nav" aria-label="تنقل بوابة الموظف">
        {bottomNavItems.map((item) => (
          <NavLink
            key={`${item.to}-${item.label}`}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `employee-bottom-nav__item ${isActive ? "is-active" : ""}`}
          >
            <FontAwesomeIcon icon={item.icon} />
            <span>{item.label}</span>
            {item.badge ? <em>{item.badge}</em> : null}
          </NavLink>
        ))}
      </nav>

      {requestSheetOpen ? (
        <div
          className="employee-request-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="employee-request-title"
          onMouseDown={() => setRequestSheetOpen(false)}
        >
          <div className="employee-request-sheet__panel" onMouseDown={(event) => event.stopPropagation()}>
            <button
              type="button"
              className="employee-request-sheet__close"
              onClick={() => setRequestSheetOpen(false)}
              aria-label="إغلاق"
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
            <div className="employee-request-sheet__head">
              <span className="employee-request-sheet__icon">
                <FontAwesomeIcon icon={faPaperPlane} />
              </span>
              <div>
                <h2 id="employee-request-title">طلب جديد</h2>
                <p>اختر نوع الطلب الذي تريد إرساله إلى الإدارة</p>
              </div>
            </div>
            <div className="employee-request-sheet__grid">
              {requestItems.map((item) => (
                <Link
                  key={item.label}
                  to={item.to}
                  className="employee-request-option"
                  onClick={() => setRequestSheetOpen(false)}
                >
                  <FontAwesomeIcon icon={item.icon} />
                  <strong>{item.label}</strong>
                  <span>{item.description}</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
