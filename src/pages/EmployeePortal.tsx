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
} from "../services/employeeNotificationsCore";
import { logoutFirebase } from "../services/authService";
import {
  detachEmployeeWebPushSubscription,
  disableEmployeeWebPush,
  enableEmployeeWebPush,
  getEmployeeWebPushState,
  syncEmployeeAppBadge,
  syncExistingEmployeeWebPushSubscription,
  type EmployeeWebPushState,
} from "../services/employeeWebPush";
import { listEmployeeRequestNotifications } from "../services/employeeRequests";
import EmployeeFilesPage from "./hr/EmployeeFiles";
import EmployeeMessagesPage from "./hr/EmployeeMessages";
import EmployeeNotificationsPage from "./hr/EmployeeNotifications";
import EmployeeOverviewPage from "./hr/EmployeeOverview";
import EmployeeServiceConsumption from "./EmployeeServiceConsumption";
import EmployeeRequestsPage from "./hr/EmployeeRequests";
import EmployeePayrollPage from "./hr/EmployeePayroll";
import EmployeeTargetsPage from "./hr/EmployeeTargets";
import EmployeeProfilePage from "./hr/EmployeeProfile";
import { useEmployeeSession, type HrSession } from "./hr/shared";
import EmployeeAvatar from "../components/EmployeeAvatar";
import DashboardHeader from "../components/DashboardHeader";
import DashboardSidebarTooltipV2 from "../components/DashboardSidebarTooltipV2";
import MalikatPortalSidebarV2 from "../components/MalikatPortalSidebarV2";
import InternalPortalSwitcher from "../components/InternalPortalSwitcher";
import PermissionRoute from "../components/PermissionRoute";
import { usePermissions } from "../security/PermissionContext";
import type { AppPermission } from "../helpers/permissions";
import "../styles/EmployeePortalMobileNav.css";
import "../styles/dashboard-v2/dashboard-v2.css";

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

function resolvePortalAvatarUrl(session: HrSession) {
  const records = [
    session.employeeDoc,
    session.staffDoc,
    session.userDoc,
  ].filter(Boolean) as Array<Record<string, any>>;

  for (const record of records) {
    const employeeProfile =
      record.employeeProfile && typeof record.employeeProfile === "object"
        ? record.employeeProfile
        : {};
    const personal =
      employeeProfile.personal && typeof employeeProfile.personal === "object"
        ? employeeProfile.personal
        : record.personal && typeof record.personal === "object"
          ? record.personal
          : {};

    const candidates = [
      record.avatarUrl,
      record.avatarURL,
      record.photoURL,
      record.photoUrl,
      record.imageUrl,
      record.imageURL,
      record.profileImageUrl,
      record.profileImage,
      record.picture,
      record.avatar,
      employeeProfile.avatarUrl,
      employeeProfile.avatarURL,
      employeeProfile.photoURL,
      employeeProfile.photoUrl,
      employeeProfile.imageUrl,
      employeeProfile.profileImageUrl,
      personal.avatarUrl,
      personal.photoURL,
      personal.photoUrl,
      personal.imageUrl,
      personal.profileImageUrl,
    ];

    const resolved = candidates.map(cleanPortalText).find(Boolean);
    if (resolved) return resolved;
  }

  return cleanPortalText(session.user?.photoURL);
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
    permission: "الاستئذانات",
    requests: "طلباتي",
    payroll: "الراتب",
    targets: "تارقتي",
  };

  return titles[section] || "بوابة الموظف";
}

type EmployeeMorePageProps = {
  displayName: string;
  roleLabel: string;
  avatarUrl: string;
  notificationCounts: {
    all: number;
    messages: number;
    files: number;
    leave: number;
    payroll: number;
    profile: number;
    requests: number;
  };
};

function EmployeeMorePage({
  displayName,
  roleLabel,
  avatarUrl,
  notificationCounts,
}: EmployeeMorePageProps) {
  const { hasPermission } = usePermissions();
  const [pushState, setPushState] = useState<EmployeeWebPushState | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMessage, setPushMessage] = useState("");

  useEffect(() => {
    let alive = true;
    void getEmployeeWebPushState()
      .then((state) => {
        if (alive) setPushState(state);
      })
      .catch(() => {
        if (alive) setPushState(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const handlePushEnable = async () => {
    if (pushBusy) return;
    setPushBusy(true);
    setPushMessage("");
    try {
      const state = await enableEmployeeWebPush();
      setPushState(state);
      await syncEmployeeAppBadge(notificationCounts.all);
      setPushMessage("تم تفعيل تنبيهات Queens Salon على هذا الجهاز.");
    } catch (error) {
      setPushMessage(cleanPortalText((error as Error)?.message || "تعذر تفعيل التنبيهات."));
    } finally {
      setPushBusy(false);
    }
  };

  const handlePushDisable = async () => {
    if (pushBusy) return;
    setPushBusy(true);
    setPushMessage("");
    try {
      const state = await disableEmployeeWebPush();
      setPushState(state);
      setPushMessage("تم إيقاف تنبيهات التطبيق على هذا الجهاز.");
    } catch (error) {
      setPushMessage(cleanPortalText((error as Error)?.message || "تعذر إيقاف التنبيهات."));
    } finally {
      setPushBusy(false);
    }
  };

  const pushSummary = !pushState
    ? "جاري التحقق من حالة التنبيهات..."
    : !pushState.supported
      ? pushState.standalone
        ? "هذا الجهاز لا يوفّر Web Push لهذا التطبيق."
        : "افتح Queens Salon من أيقونة الشاشة الرئيسية ثم فعّل التنبيهات."
      : !pushState.serverEnabled
        ? "خدمة Web Push تحتاج تفعيل مفاتيح الخادم."
        : pushState.permission === "denied"
          ? "التنبيهات مرفوضة من إعدادات الجهاز."
          : pushState.subscribed
            ? "مفعلة على هذا الجهاز، وسيظهر عدد التنبيهات على الأيقونة."
            : "غير مفعلة على هذا الجهاز.";

  const items = [
    {
      to: "/employee/profile",
      label: "الملف الشخصي",
      description: "بياناتك الشخصية والوظيفية",
      icon: faUser,
      badge: notificationCounts.profile,
      permission: "workspace.employee_portal.view" as AppPermission,
    },
    {
      to: "/employee/notifications",
      label: "التنبيهات",
      description: "آخر التحديثات والتنبيهات",
      icon: faBell,
      badge: notificationCounts.all,
      permission: "workspace.employee_portal.view" as AppPermission,
    },
    {
      to: "/employee/requests",
      label: "طلباتي",
      description: "متابعة الطلبات والقرارات والتنفيذ",
      icon: faPaperPlane,
      badge: notificationCounts.requests,
      permission: "employee_requests.own.view" as AppPermission,
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
    {
      to: "/employee/targets",
      label: "تارقتي",
      description: "المبيعات المؤهلة والبونص المتوقع",
      icon: faChartLine,
      badge: 0,
      permission: "targets.view_own" as AppPermission,
    },
  ];

  return (
    <section className="employee-more-page">
      <header className="employee-more-hero">
        <span className="employee-more-hero__avatar">
          <EmployeeAvatar
            src={avatarUrl}
            name={displayName}
            alt={displayName}
            loading="eager"
          />
        </span>

        <div>
          <small>حساب الموظفة</small>
          <h1>{displayName}</h1>
          <p>{roleLabel}</p>
        </div>
      </header>

      <section className="employee-push-settings" aria-label="تنبيهات التطبيق">
        <span className="employee-push-settings__icon">
          <FontAwesomeIcon icon={faBell} />
        </span>
        <div className="employee-push-settings__copy">
          <strong>تنبيهات التطبيق</strong>
          <span>{pushSummary}</span>
          {pushMessage ? <small>{pushMessage}</small> : null}
        </div>
        <div className="employee-push-settings__actions">
          {pushState?.subscribed ? (
            <button type="button" onClick={() => void handlePushDisable()} disabled={pushBusy}>
              {pushBusy ? "جارٍ التنفيذ..." : "إيقاف"}
            </button>
          ) : (
            <button
              type="button"
              className="is-primary"
              onClick={() => void handlePushEnable()}
              disabled={pushBusy || pushState?.serverEnabled === false || pushState?.supported === false}
            >
              {pushBusy ? "جارٍ التفعيل..." : "تفعيل"}
            </button>
          )}
        </div>
      </section>

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
      const [workforceRows, requestRows] = await Promise.all([
        listEmployeeNotifications({
          targetUid: session.uid,
          targetEmployeeId: session.employeeId,
          limitCount: 200,
        }).catch(() => []),
        hasPermission("employee_requests.own.view")
          ? listEmployeeRequestNotifications(200).catch(() => [])
          : Promise.resolve([]),
      ]);
      if (requestId !== notificationsRequestRef.current) return;
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
      const mergedNotifications = Array.from(merged.values());
      setNotifications(mergedNotifications);
      void syncEmployeeAppBadge(
        mergedNotifications.filter((note) => !note.isRead).length
      );
    } catch {
      if (requestId !== notificationsRequestRef.current) return;
      setNotifications([]);
    } finally {
      if (requestId === notificationsRequestRef.current) {
        setNotificationsLoading(false);
      }
    }
  }, [hasPermission, session.employeeId, session.uid]);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    const handleFocus = () => void loadNotifications();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [loadNotifications]);

  useEffect(() => {
    if (!session.uid) return;
    void syncExistingEmployeeWebPushSubscription().catch(() => false);
  }, [session.uid]);

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
      await detachEmployeeWebPushSubscription();
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
      requests: unread.filter((note) => note.type === "employee_request" || String(note.route || "").startsWith("/employee/requests")).length,
    };
  }, [notifications]);

  const displayName = cleanPortalText(session.displayName) || cleanPortalText(session.email) || "الموظفة";
  const avatarUrl = resolvePortalAvatarUrl(session);
  const role = cleanPortalText(session.role).toLowerCase();
  const roleLabel = portalRoleLabel(role);
  const portalSubtitle = "الدوام، الطلبات، الملفات والرسائل";
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
    { to: "/employee/consumption", label: "حجوزاتي", icon: faCalendarDays, end: true, permission: "inventory.consume.confirm" as AppPermission },
    { to: "/employee/requests", label: "الطلبات", icon: faPaperPlane, permission: "employee_requests.own.view" as AppPermission },
    { to: "/employee/more", label: "المزيد", icon: faTableColumns, badge: notificationCounts.all, permission: "workspace.employee_portal.view" as AppPermission },
  ].filter((item) => hasPermission(item.permission));

  const desktopNavItems = [
    { to: "/employee/overview", label: "الرئيسية", description: "ملخص يوم العمل", icon: faHouse, end: true, permission: "workspace.employee_portal.view" as AppPermission },
    { to: "/employee/attendance", label: "الحضور والانصراف", description: "السجل الشهري", icon: faFingerprint, end: true, permission: "attendance.own.view" as AppPermission },
    { to: "/employee/consumption", label: "حجوزاتي", description: "حجوزاتك وتأكيد المواد بعد التنفيذ", icon: faCalendarDays, end: true, permission: "inventory.consume.confirm" as AppPermission },
    { to: "/employee/requests", label: "طلباتي", description: "المتابعة والقرارات والتنفيذ", icon: faPaperPlane, permission: "employee_requests.own.view" as AppPermission },
    { to: "/employee/payroll", label: "الراتب", description: "التفاصيل المالية", icon: faWallet, badge: notificationCounts.payroll, permission: "workspace.employee_portal.view" as AppPermission },
    { to: "/employee/targets", label: "تارقتي", description: "المبيعات المؤهلة والبونص المتوقع", icon: faChartLine, permission: "targets.view_own" as AppPermission },
    { to: "/employee/messages", label: "الرسائل", description: "التواصل الداخلي", icon: faPaperPlane, badge: notificationCounts.messages, permission: "messages.view" as AppPermission },
    { to: "/employee/files", label: "الملفات", description: "المستندات والعقود", icon: faFileLines, badge: notificationCounts.files, permission: "workspace.employee_portal.view" as AppPermission },
    { to: "/employee/profile", label: "الملف الشخصي", description: "البيانات الوظيفية", icon: faUser, badge: notificationCounts.profile, permission: "workspace.employee_portal.view" as AppPermission },
    { to: "/employee/notifications", label: "التنبيهات", description: "آخر التحديثات", icon: faBell, badge: notificationCounts.all, permission: "workspace.employee_portal.view" as AppPermission },
  ].filter((item) => hasPermission(item.permission));

  const requestItems = [
    { label: "طلب تصحيح", description: "تصحيح بصمة أو وقت حضور", icon: faFingerprint, to: "/employee/requests?new=attendance_correction", permission: "employee_requests.own.create" as AppPermission },
    { label: "طلب استئذان", description: "طلب خروج مؤقت أو تأخير", icon: faTriangleExclamation, to: "/employee/requests?new=permission", permission: "employee_requests.own.create" as AppPermission },
    { label: "طلب أوفرتايم", description: "تسجيل ساعات عمل إضافية", icon: faChartLine, to: "/employee/requests?new=overtime", permission: "employee_requests.own.create" as AppPermission },
    { label: "طلب سلفة", description: "طلب سلفة يراجع من الموارد البشرية", icon: faWallet, to: "/employee/requests?new=salary_advance", permission: "employee_requests.own.create" as AppPermission },
    { label: "تعريف بالراتب", description: "طلب إصدار تعريف بالراتب", icon: faFileLines, to: "/employee/requests?new=salary_certificate", permission: "employee_requests.own.create" as AppPermission },
    { label: "طلب إجازة", description: "رفع طلب إجازة جديد", icon: faPaperPlane, to: "/employee/requests?new=leave", permission: "employee_requests.own.create" as AppPermission },
    { label: "طلب خروج وعودة", description: "طلب إداري للمتابعة", icon: faRightFromBracket, to: "/employee/requests?new=exit_return", permission: "employee_requests.own.create" as AppPermission },
    { label: "طلب استقالة", description: "يرسل للإدارة للمراجعة", icon: faFileLines, to: "/employee/requests?new=resignation", permission: "employee_requests.own.create" as AppPermission },
  ].filter((item) => hasPermission(item.permission));
  const employeeHeaderTitle = getEmployeePortalTitle(location.pathname);

  const renderNotificationAction = () =>
    hasPermission("workspace.employee_portal.view") ? (
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
    ) : null;

  const renderDesktopHeaderActions = () => (
    <>
      <InternalPortalSwitcher
        canOpenDashboard={canOpenDashboard}
        canOpenHr={canOpenHr}
        loggingOut={loggingOut}
        onLogout={handleLogout}
      />
      {renderNotificationAction()}
    </>
  );

  if (session.loading) {
    return (
      <div className="employee-portal madan-employee-portal dashboard-v2" dir="rtl">
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
    <div className={`employee-portal madan-employee-portal dashboard-v2 malikat-portal-shell-v2${isSidebarCollapsed ? " is-sidebar-collapsed" : ""}`} dir="rtl">
      <DashboardHeader
        theme="employee"
        title={employeeHeaderTitle}
        subtitle="Queens Salon"
        className="employee-workspace-header--mobile dashboard-header--mobile-shell"
        actions={renderNotificationAction()}
      />

      <div className="employee-portal-layout employee-portal-layout--app">
        <DashboardSidebarTooltipV2 enabled={isSidebarCollapsed} />
        <MalikatPortalSidebarV2
          variant="employee"
          logoSrc={logo1}
          collapsed={isSidebarCollapsed}
          onToggleCollapsed={() => setIsSidebarCollapsed((value) => !value)}
          ariaLabel="التنقل داخل بوابة الموظف"
          profileTooltip={`${displayName} — ${roleLabel}`}
          profile={
            <div className="malikat-sidebar-identity employee-portal-sidebar__profile">
              <span className="malikat-sidebar-identity__avatar employee-portal-sidebar__avatar">
                <EmployeeAvatar
                  src={avatarUrl}
                  name={displayName}
                  alt={displayName}
                  loading="eager"
                />
              </span>
              <div className="malikat-sidebar-identity__copy">
                <small>بوابة الموظف</small>
                <strong>{displayName}</strong>
                <span>{roleLabel}</span>
              </div>
            </div>
          }
          primaryActionTooltip="إنشاء طلب جديد"
          primaryAction={
            <button
              type="button"
              className="employee-sidebar-request"
              onClick={() => setRequestSheetOpen(true)}
            >
              <FontAwesomeIcon icon={faPlus} />
              <span>إنشاء طلب جديد</span>
            </button>
          }
          navigation={
            <nav className="employee-portal-desktop-nav">
              {desktopNavItems.map((item) => (
                <NavLink
                  key={`${item.to}-${item.label}`}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `employee-portal-desktop-link ${isActive ? "is-active" : ""}`}
                  data-sidebar-tooltip={item.label}
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
          }
          footer={
            <div className="employee-portal-sidebar__footer">
              <span>{notificationsLoading ? "جاري تحديث التنبيهات..." : portalSubtitle}</span>
              <div className="employee-portal-sidebar__switches">
                {canOpenHr ? (
                  <Link to="/dashboard/hr"><FontAwesomeIcon icon={faUserShield} /> لوحة HR</Link>
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
          }
        />

        <main className="employee-portal-main">
          <DashboardHeader
            theme="employee"
            title={employeeHeaderTitle}
            subtitle="Queens Salon"
            className="employee-workspace-header--desktop dashboard-header--desktop-shell"
            actions={renderDesktopHeaderActions()}
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
                  <EmployeeMorePage
                    displayName={displayName}
                    roleLabel={roleLabel}
                    avatarUrl={avatarUrl}
                    notificationCounts={notificationCounts}
                  />
                </PermissionRoute>
              }
            />
            <Route path="requests" element={<PermissionRoute permission="employee_requests.own.view"><EmployeeRequestsPage session={session} onPortalChange={loadNotifications} /></PermissionRoute>} />
            <Route path="requests/:requestId" element={<PermissionRoute permission="employee_requests.own.view"><EmployeeRequestsPage session={session} onPortalChange={loadNotifications} /></PermissionRoute>} />
            <Route path="profile" element={<PermissionRoute permission="workspace.employee_portal.view"><EmployeeProfilePage session={session} onPortalChange={loadNotifications} /></PermissionRoute>} />
            <Route path="messages" element={<PermissionRoute permission="messages.view"><EmployeeMessagesPage session={session} onPortalChange={loadNotifications} /></PermissionRoute>} />
            <Route path="files" element={<PermissionRoute permission="workspace.employee_portal.view"><EmployeeFilesPage session={session} onPortalChange={loadNotifications} /></PermissionRoute>} />
            <Route path="leave" element={<Navigate to="/employee/requests?new=leave" replace />} />
            <Route path="permission" element={<Navigate to="/employee/requests?new=permission" replace />} />
            <Route path="payroll" element={<PermissionRoute permission="workspace.employee_portal.view"><EmployeePayrollPage session={session} onPortalChange={loadNotifications} /></PermissionRoute>} />
            <Route path="targets" element={<PermissionRoute permission="targets.view_own"><EmployeeTargetsPage /></PermissionRoute>} />
            <Route path="consumption" element={<PermissionRoute permission="inventory.consume.confirm"><EmployeeServiceConsumption session={session} /></PermissionRoute>} />
            <Route path="*" element={<Navigate to="/employee/overview" replace />} />
          </Routes>
          </div>
        </main>
      </div>

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
