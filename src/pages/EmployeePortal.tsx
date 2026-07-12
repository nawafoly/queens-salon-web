import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBell,
  faCalendarDays,
  faChartLine,
  faChevronLeft,
  faChevronRight,
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
import logo1 from "../assets/images/ssunnamed.png";

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
import DashboardHeader from "../components/DashboardHeader";
import InternalPortalSwitcher from "../components/InternalPortalSwitcher";
import PermissionRoute from "../components/PermissionRoute";
import { usePermissions } from "../security/PermissionContext";
import type { AppPermission } from "../helpers/permissions";
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

function getEmployeePortalTitle(pathname: string) {
  const section = pathname.replace(/^\/employee\/?/, "").split("/")[0] || "overview";
  const titles: Record<string, string> = {
    overview: "بوابة الموظف",
    attendance: "الحضور والانصراف",
    notifications: "التنبيهات",
    more: "المزيد",
    profile: "الملف الشخصي",
    messages: "الرسائل",
    files: "الملفات",
    leave: "الإجازات والطلبات",
    payroll: "الراتب",
  };

  return titles[section] || "بوابة الموظف";
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
  const { hasPermission } = usePermissions();
  const items = [
    {
      to: "/employee/notifications",
      label: "التنبيهات",
      description: "آخر التحديثات والتنبيهات",
      icon: faBell,
      badge: notificationCounts.all,
      permission: "workspace.employee_portal.view" as AppPermission,
    },
    {
      to: "/employee/messages",
      label: "الرسائل",
      description: "التواصل الداخلي مع الإدارة",
      icon: faPaperPlane,
      badge: notificationCounts.messages,
      permission: "messages.view" as AppPermission,
    },
    {
      to: "/employee/files",
      label: "الملفات",
      description: "العقود والمستندات والمرفقات",
      icon: faFileLines,
      badge: notificationCounts.files,
      permission: "workspace.employee_portal.view" as AppPermission,
    },
    {
      to: "/employee/payroll",
      label: "الراتب",
      description: "التفاصيل والسجلات المالية",
      icon: faWallet,
      badge: notificationCounts.payroll,
      permission: "workspace.employee_portal.view" as AppPermission,
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
        {items.filter((item) => hasPermission(item.permission)).map((item) => (
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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const session = useEmployeeSession();
  const navigate = useNavigate();
  const location = useLocation();
  const { hasPermission, hasAnyPermission } = usePermissions();
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
  const canOpenHr = hasAnyPermission([
    "employees.view",
    "attendance.view",
    "recruitment.view",
    "messages.manage",
    "employees.files.view",
    "admin_accounts.view",
  ]);
  const canOpenDashboard = hasPermission("workspace.dashboard.view");

  const bottomNavItems = [
    { to: "/employee/overview", label: "الرئيسية", icon: faHouse, end: true, permission: "workspace.employee_portal.view" as AppPermission },
    { to: "/employee/attendance", label: "الحضور", icon: faCalendarDays, end: true, permission: "attendance.own.view" as AppPermission },
    { to: "/employee/leave", label: "الطلبات", icon: faPaperPlane, permission: "workspace.employee_portal.view" as AppPermission },
    { to: "/employee/profile", label: "الملف الشخصي", icon: faUser, permission: "workspace.employee_portal.view" as AppPermission },
    { to: "/employee/more", label: "المزيد", icon: faTableColumns, badge: notificationCounts.all, permission: "workspace.employee_portal.view" as AppPermission },
  ].filter((item) => hasPermission(item.permission));

  const desktopNavItems = [
    { to: "/employee/overview", label: "الرئيسية", description: "ملخص يوم العمل", icon: faHouse, end: true, permission: "workspace.employee_portal.view" as AppPermission },
    { to: "/employee/attendance", label: "الحضور والانصراف", description: "السجل الشهري", icon: faFingerprint, end: true, permission: "attendance.own.view" as AppPermission },
    { to: "/employee/leave", label: "الإجازات والطلبات", description: "الرصيد والطلبات", icon: faCalendarDays, badge: notificationCounts.leave, permission: "workspace.employee_portal.view" as AppPermission },
    { to: "/employee/payroll", label: "الراتب", description: "التفاصيل المالية", icon: faWallet, badge: notificationCounts.payroll, permission: "workspace.employee_portal.view" as AppPermission },
    { to: "/employee/messages", label: "الرسائل", description: "التواصل الداخلي", icon: faPaperPlane, badge: notificationCounts.messages, permission: "messages.view" as AppPermission },
    { to: "/employee/files", label: "الملفات", description: "المستندات والعقود", icon: faFileLines, badge: notificationCounts.files, permission: "workspace.employee_portal.view" as AppPermission },
    { to: "/employee/profile", label: "الملف الشخصي", description: "البيانات الوظيفية", icon: faUser, badge: notificationCounts.profile, permission: "workspace.employee_portal.view" as AppPermission },
    { to: "/employee/notifications", label: "التنبيهات", description: "آخر التحديثات", icon: faBell, badge: notificationCounts.all, permission: "workspace.employee_portal.view" as AppPermission },
  ].filter((item) => hasPermission(item.permission));

  const requestItems = [
    { label: "طلب تصحيح", description: "تصحيح بصمة أو وقت حضور", icon: faFingerprint, to: "/employee/attendance", permission: "attendance.own.view" as AppPermission },
    { label: "طلب استئذان", description: "طلب خروج مؤقت أو تأخير", icon: faTriangleExclamation, to: "/employee/messages", permission: "messages.view" as AppPermission },
    { label: "طلب أوفرتايم", description: "تسجيل ساعات عمل إضافية", icon: faChartLine, to: "/employee/messages", permission: "messages.view" as AppPermission },
    { label: "صرف معجل للراتب", description: "طلب مالي يراجع من HR", icon: faWallet, to: "/employee/payroll", permission: "workspace.employee_portal.view" as AppPermission },
    { label: "طلب إجازة", description: "رفع طلب إجازة جديد", icon: faPaperPlane, to: "/employee/leave", permission: "workspace.employee_portal.view" as AppPermission },
    { label: "طلب خروج وعودة", description: "طلب إداري للمتابعة", icon: faRightFromBracket, to: "/employee/messages", permission: "messages.view" as AppPermission },
    { label: "طلب استقالة", description: "يرسل للإدارة للمراجعة", icon: faFileLines, to: "/employee/messages", permission: "messages.view" as AppPermission },
  ].filter((item) => hasPermission(item.permission));
  const employeeHeaderTitle = getEmployeePortalTitle(location.pathname);
  const renderEmployeeHeaderActions = () => (
    <>
      <InternalPortalSwitcher
        canOpenDashboard={canOpenDashboard}
        canOpenHr={canOpenHr}
        loggingOut={loggingOut}
        onLogout={handleLogout}
      />

      {hasPermission("workspace.employee_portal.view") ? (
        <Link
          to="/employee/notifications"
          className="employee-header-notification employee-app-topbar__action employee-app-topbar__action--notifications"
          aria-label="التنبيهات"
          title="التنبيهات"
        >
          <FontAwesomeIcon icon={faBell} />
          {notificationCounts.all > 0 ? (
            <span className="employee-header-notification__badge employee-app-topbar__badge">
              {notificationCounts.all}
            </span>
          ) : null}
        </Link>
      ) : null}
    </>
  );

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
    <div className={`employee-portal madan-employee-portal${isSidebarCollapsed ? " is-sidebar-collapsed" : ""}`} dir="rtl">
      <DashboardHeader
        theme="employee"
        title={employeeHeaderTitle}
        subtitle="Queens Salon"
        className="employee-workspace-header--mobile dashboard-header--mobile-shell"
        actions={renderEmployeeHeaderActions()}
      />

      <div className="employee-portal-layout employee-portal-layout--app">
        <aside className="employee-portal-sidebar employee-portal-sidebar--desktop" aria-label="التنقل داخل بوابة الموظف">
          <div className="employee-sidebar-header">
            <img src={logo1} alt="Malikat" className="employee-sidebar-logo" />
            <button
              type="button"
              className="employee-sidebar-collapse"
              onClick={() => setIsSidebarCollapsed((value) => !value)}
              aria-label={isSidebarCollapsed ? "توسيع القائمة" : "طي القائمة"}
            >
              <FontAwesomeIcon icon={isSidebarCollapsed ? faChevronLeft : faChevronRight} />
            </button>
          </div>
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
          <DashboardHeader
            theme="employee"
            title={employeeHeaderTitle}
            subtitle="Queens Salon"
            className="employee-workspace-header--desktop dashboard-header--desktop-shell"
            actions={renderEmployeeHeaderActions()}
          />

          <div className="employee-app-route-scroll">
          <Routes>
            <Route index element={<Navigate to="/employee/overview" replace />} />
            <Route
              path="overview"
              element={
                <PermissionRoute permission="workspace.employee_portal.view">
                  <EmployeeOverviewPage session={session} notifications={notifications} onRefresh={loadNotifications} />
                </PermissionRoute>
              }
            />
            <Route
              path="attendance"
              element={
                <PermissionRoute permission="attendance.own.view">
                  <EmployeeOverviewPage session={session} notifications={notifications} onRefresh={loadNotifications} attendanceOnly />
                </PermissionRoute>
              }
            />
            <Route
              path="notifications"
              element={
                <PermissionRoute permission="workspace.employee_portal.view">
                  <EmployeeNotificationsPage session={session} notifications={notifications} onRefresh={loadNotifications} />
                </PermissionRoute>
              }
            />
            <Route
              path="more"
              element={
                <PermissionRoute permission="workspace.employee_portal.view">
                  <EmployeeMorePage displayName={displayName} roleLabel={roleLabel} notificationCounts={notificationCounts} />
                </PermissionRoute>
              }
            />
            <Route path="profile" element={<PermissionRoute permission="workspace.employee_portal.view"><EmployeeProfilePage session={session} onPortalChange={loadNotifications} /></PermissionRoute>} />
            <Route path="messages" element={<PermissionRoute permission="messages.view"><EmployeeMessagesPage session={session} onPortalChange={loadNotifications} /></PermissionRoute>} />
            <Route path="files" element={<PermissionRoute permission="workspace.employee_portal.view"><EmployeeFilesPage session={session} onPortalChange={loadNotifications} /></PermissionRoute>} />
            <Route path="leave" element={<PermissionRoute permission="workspace.employee_portal.view"><EmployeeLeavePage session={session} onPortalChange={loadNotifications} /></PermissionRoute>} />
            <Route path="payroll" element={<PermissionRoute permission="workspace.employee_portal.view"><EmployeePayrollPage session={session} onPortalChange={loadNotifications} /></PermissionRoute>} />
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
