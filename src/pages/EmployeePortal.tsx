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
import {
  EmployeePortalLanguageProvider,
  useEmployeePortalLanguage,
  type EmployeePortalMessageKey,
} from "../features/employee-portal/EmployeePortalLanguage";
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

type EmployeePortalTranslate = (key: EmployeePortalMessageKey) => string;

function portalRoleLabel(role: unknown, t: EmployeePortalTranslate) {
  const normalized = cleanPortalText(role).toLowerCase();
  if (normalized === "owner") return t("role.owner");
  if (normalized === "admin") return t("role.admin");
  if (normalized === "hr") return t("role.hr");
  if (normalized === "reception") return t("role.reception");
  return t("role.staff");
}

function getEmployeePortalTitle(pathname: string, t: EmployeePortalTranslate) {
  const section = pathname.replace(/^\/employee\/?/, "").split("/")[0] || "overview";
  const titleKeys: Record<string, EmployeePortalMessageKey> = {
    overview: "title.overview",
    attendance: "title.attendance",
    notifications: "title.notifications",
    more: "title.more",
    profile: "title.profile",
    messages: "title.messages",
    files: "title.files",
    leave: "title.leave",
    permission: "title.permission",
    requests: "title.requests",
    payroll: "title.payroll",
    targets: "title.targets",
    consumption: "title.consumption",
  };

  return t(titleKeys[section] || "title.overview");
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
  onLogout: () => void | Promise<void>;
  loggingOut: boolean;
};

function EmployeeMorePage({
  displayName,
  roleLabel,
  avatarUrl,
  notificationCounts,
  onLogout,
  loggingOut,
}: EmployeeMorePageProps) {
  const { language, t } = useEmployeePortalLanguage();
  const tr = (ar: string, en: string) => language === "en" ? en : ar;
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
      setPushMessage(tr("تم تفعيل تنبيهات MALIKAT على هذا الجهاز.", "MALIKAT notifications are enabled on this device."));
    } catch (error) {
      setPushMessage(language === "en" ? "Could not enable notifications." : cleanPortalText((error as Error)?.message || "تعذر تفعيل التنبيهات."));
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
      setPushMessage(tr("تم إيقاف تنبيهات التطبيق على هذا الجهاز.", "App notifications are turned off on this device."));
    } catch (error) {
      setPushMessage(language === "en" ? "Could not turn off notifications." : cleanPortalText((error as Error)?.message || "تعذر إيقاف التنبيهات."));
    } finally {
      setPushBusy(false);
    }
  };

  const pushSummary = !pushState
    ? tr("جاري التحقق من حالة التنبيهات...", "Checking notification status...")
    : !pushState.supported
      ? pushState.standalone
        ? tr("هذا الجهاز لا يوفّر Web Push لهذا التطبيق.", "This device does not support push notifications for this app.")
        : tr("افتح MALIKAT من أيقونة الشاشة الرئيسية ثم فعّل التنبيهات.", "Open MALIKAT from the home screen icon to enable notifications.")
      : !pushState.serverEnabled
        ? tr("خدمة Web Push تحتاج تفعيل مفاتيح الخادم.", "Push notifications need server setup.")
        : pushState.permission === "denied"
          ? tr("التنبيهات مرفوضة من إعدادات الجهاز.", "Notifications are blocked in device settings.")
          : pushState.subscribed
            ? tr("مفعلة على هذا الجهاز، وسيظهر عدد التنبيهات على الأيقونة.", "Enabled on this device. The app icon will show the notification count.")
            : tr("غير مفعلة على هذا الجهاز.", "Not enabled on this device.");

  const items = [
    {
      to: "/employee/profile",
      label: t("nav.profile"),
      description: tr("بياناتك الشخصية والوظيفية", "Your personal and employment details"),
      icon: faUser,
      badge: notificationCounts.profile,
      permission: "workspace.employee_portal.view" as AppPermission,
    },
    {
      to: "/employee/notifications",
      label: t("nav.notifications"),
      description: tr("آخر التحديثات والتنبيهات", "Latest updates and alerts"),
      icon: faBell,
      badge: notificationCounts.all,
      permission: "workspace.employee_portal.view" as AppPermission,
    },
    {
      to: "/employee/requests",
      label: t("nav.myRequests"),
      description: tr("متابعة الطلبات والقرارات والتنفيذ", "Track requests, decisions and execution"),
      icon: faPaperPlane,
      badge: notificationCounts.requests,
      permission: "employee_requests.own.view" as AppPermission,
    },
    {
      to: "/employee/messages",
      label: t("nav.messages"),
      description: tr("التواصل الداخلي مع الإدارة", "Internal communication with management"),
      icon: faPaperPlane,
      badge: notificationCounts.messages,
      permission: "messages.view" as AppPermission,
    },
    {
      to: "/employee/files",
      label: t("nav.files"),
      description: tr("العقود والمستندات والمرفقات", "Contracts, documents and attachments"),
      icon: faFileLines,
      badge: notificationCounts.files,
      permission: "workspace.employee_portal.view" as AppPermission,
    },
    {
      to: "/employee/payroll",
      label: t("nav.payroll"),
      description: tr("التفاصيل والسجلات المالية", "Pay details and records"),
      icon: faWallet,
      badge: notificationCounts.payroll,
      permission: "workspace.employee_portal.view" as AppPermission,
    },
    {
      to: "/employee/targets",
      label: t("nav.targets"),
      description: t("nav.targetsDescription"),
      icon: faChartLine,
      badge: 0,
      permission: "targets.view_own" as AppPermission,
    },
  ];

  return (
    <section className="employee-more-page" dir={language === "en" ? "ltr" : "rtl"} lang={language}>
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
          <small>{tr("حساب الموظفة", "Employee account")}</small>
          <h1>{displayName}</h1>
          <p>{roleLabel}</p>
        </div>
      </header>

      <section className="employee-push-settings" aria-label={tr("تنبيهات التطبيق", "App notifications")}>
        <span className="employee-push-settings__icon">
          <FontAwesomeIcon icon={faBell} />
        </span>
        <div className="employee-push-settings__copy">
          <strong>{tr("تنبيهات التطبيق", "App notifications")}</strong>
          <span>{pushSummary}</span>
          {pushMessage ? <small>{pushMessage}</small> : null}
        </div>
        <div className="employee-push-settings__actions">
          {pushState?.subscribed ? (
            <button type="button" onClick={() => void handlePushDisable()} disabled={pushBusy}>
              {pushBusy ? tr("جارٍ التنفيذ...", "Updating...") : tr("إيقاف", "Turn off")}
            </button>
          ) : (
            <button
              type="button"
              className="is-primary"
              onClick={() => void handlePushEnable()}
              disabled={pushBusy || pushState?.serverEnabled === false || pushState?.supported === false}
            >
              {pushBusy ? tr("جارٍ التفعيل...", "Enabling...") : tr("تفعيل", "Enable")}
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

      <button
        type="button"
        className="employee-more-logout"
        onClick={() => void onLogout()}
        disabled={loggingOut}
      >
        <span className="employee-more-logout__icon" aria-hidden="true">
          <FontAwesomeIcon icon={faRightFromBracket} />
        </span>
        <span className="employee-more-logout__copy">
          <strong>{loggingOut ? tr("جاري تسجيل الخروج...", "Signing out...") : tr("تسجيل الخروج", "Sign out")}</strong>
          <small>{tr("الخروج من حساب الموظفة على هذا الجهاز", "Sign out of your employee account on this device")}</small>
        </span>
      </button>

    </section>
  );
}

function EmployeePortalContent() {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const { direction, language, t, toggleLanguage } = useEmployeePortalLanguage();
  const tr = (ar: string, en: string) => language === "en" ? en : ar;
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

  const displayName = cleanPortalText(session.displayName) || cleanPortalText(session.email) || t("role.staff");
  const avatarUrl = resolvePortalAvatarUrl(session);
  const role = cleanPortalText(session.role).toLowerCase();
  const roleLabel = portalRoleLabel(role, t);
  const portalSubtitle = t("portal.subtitle");
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
    { to: "/employee/overview", label: t("nav.home"), icon: faHouse, end: true, permission: "workspace.employee_portal.view" as AppPermission },
    { to: "/employee/attendance", label: t("nav.attendance"), icon: faCalendarDays, end: true, permission: "attendance.own.view" as AppPermission },
    { to: "/employee/consumption", label: t("nav.bookings"), icon: faCalendarDays, end: true, permission: "inventory.consume.confirm" as AppPermission },
    { to: "/employee/requests", label: t("nav.requests"), icon: faPaperPlane, permission: "employee_requests.own.view" as AppPermission },
    { to: "/employee/more", label: t("nav.more"), icon: faTableColumns, badge: notificationCounts.all, permission: "workspace.employee_portal.view" as AppPermission },
  ].filter((item) => hasPermission(item.permission));

  const desktopNavItems = [
    { to: "/employee/overview", label: t("nav.home"), description: t("nav.homeDescription"), icon: faHouse, end: true, permission: "workspace.employee_portal.view" as AppPermission },
    { to: "/employee/attendance", label: t("nav.attendanceFull"), description: t("nav.attendanceDescription"), icon: faFingerprint, end: true, permission: "attendance.own.view" as AppPermission },
    { to: "/employee/consumption", label: t("nav.bookings"), description: t("nav.bookingsDescription"), icon: faCalendarDays, end: true, permission: "inventory.consume.confirm" as AppPermission },
    { to: "/employee/requests", label: t("nav.myRequests"), description: t("nav.requestsDescription"), icon: faPaperPlane, permission: "employee_requests.own.view" as AppPermission },
    { to: "/employee/payroll", label: t("nav.payroll"), description: t("nav.payrollDescription"), icon: faWallet, badge: notificationCounts.payroll, permission: "workspace.employee_portal.view" as AppPermission },
    { to: "/employee/targets", label: t("nav.targets"), description: t("nav.targetsDescription"), icon: faChartLine, permission: "targets.view_own" as AppPermission },
    { to: "/employee/messages", label: t("nav.messages"), description: t("nav.messagesDescription"), icon: faPaperPlane, badge: notificationCounts.messages, permission: "messages.view" as AppPermission },
    { to: "/employee/files", label: t("nav.files"), description: t("nav.filesDescription"), icon: faFileLines, badge: notificationCounts.files, permission: "workspace.employee_portal.view" as AppPermission },
    { to: "/employee/profile", label: t("nav.profile"), description: t("nav.profileDescription"), icon: faUser, badge: notificationCounts.profile, permission: "workspace.employee_portal.view" as AppPermission },
    { to: "/employee/notifications", label: t("nav.notifications"), description: t("nav.notificationsDescription"), icon: faBell, badge: notificationCounts.all, permission: "workspace.employee_portal.view" as AppPermission },
  ].filter((item) => hasPermission(item.permission));

  const requestItems = [
    { label: tr("طلب تصحيح", "Attendance correction"), description: tr("تصحيح بصمة أو وقت حضور", "Correct a check-in or attendance time"), icon: faFingerprint, to: "/employee/requests?new=attendance_correction", permission: "employee_requests.own.create" as AppPermission },
    { label: tr("طلب استئذان", "Permission request"), description: tr("طلب خروج مؤقت أو تأخير", "Request a temporary exit or late arrival"), icon: faTriangleExclamation, to: "/employee/requests?new=permission", permission: "employee_requests.own.create" as AppPermission },
    { label: tr("طلب أوفرتايم", "Overtime request"), description: tr("تسجيل ساعات عمل إضافية", "Request additional working hours"), icon: faChartLine, to: "/employee/requests?new=overtime", permission: "employee_requests.own.create" as AppPermission },
    { label: tr("طلب سلفة", "Salary advance"), description: tr("طلب سلفة يراجع من الموارد البشرية", "Request an advance for HR review"), icon: faWallet, to: "/employee/requests?new=salary_advance", permission: "employee_requests.own.create" as AppPermission },
    { label: tr("تعريف بالراتب", "Salary certificate"), description: tr("طلب إصدار تعريف بالراتب", "Request a salary certificate"), icon: faFileLines, to: "/employee/requests?new=salary_certificate", permission: "employee_requests.own.create" as AppPermission },
    { label: tr("طلب إجازة", "Leave request"), description: tr("رفع طلب إجازة جديد", "Submit a new leave request"), icon: faPaperPlane, to: "/employee/requests?new=leave", permission: "employee_requests.own.create" as AppPermission },
    { label: tr("طلب خروج وعودة", "Exit and return request"), description: tr("طلب إداري للمتابعة", "Submit a request for management review"), icon: faRightFromBracket, to: "/employee/requests?new=exit_return", permission: "employee_requests.own.create" as AppPermission },
    { label: tr("طلب استقالة", "Resignation request"), description: tr("يرسل للإدارة للمراجعة", "Send to management for review"), icon: faFileLines, to: "/employee/requests?new=resignation", permission: "employee_requests.own.create" as AppPermission },
  ].filter((item) => hasPermission(item.permission));
  const employeeHeaderTitle = getEmployeePortalTitle(location.pathname, t);

  const renderLanguageAction = () => (
    <button
      type="button"
      className="employee-language-toggle employee-app-topbar__action"
      onClick={toggleLanguage}
      aria-label={t("language.switchAria")}
      title={t("language.switchAria")}
    >
      {t("language.switch")}
    </button>
  );

  const renderNotificationAction = () =>
    hasPermission("workspace.employee_portal.view") ? (
      <Link
        to="/employee/notifications"
        className="employee-header-notification employee-app-topbar__action employee-app-topbar__action--notifications"
        aria-label={t("portal.notifications")}
        title={t("portal.notifications")}
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
      {renderLanguageAction()}
      {renderNotificationAction()}
    </>
  );

  if (session.loading) {
    return (
      <div
        className={`employee-portal madan-employee-portal dashboard-v2 employee-portal--${language}`}
        dir={direction}
        lang={language}
      >
        <div className="employee-portal-layout employee-portal-layout--loading">
          <PortalSkeleton
            title={t("portal.loading")}
            subtitle={t("portal.loadingSubtitle")}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`employee-portal madan-employee-portal dashboard-v2 malikat-portal-shell-v2 employee-portal--${language}${isSidebarCollapsed ? " is-sidebar-collapsed" : ""}`}
      dir={direction}
      lang={language}
    >
      <DashboardHeader
        theme="employee"
        title={employeeHeaderTitle}
        subtitle="MALIKAT"
        className="employee-workspace-header--mobile dashboard-header--mobile-shell"
        actions={(
          <>
            {renderLanguageAction()}
            {renderNotificationAction()}
          </>
        )}
      />

      <div className="employee-portal-layout employee-portal-layout--app">
        <DashboardSidebarTooltipV2 enabled={isSidebarCollapsed} />
        <MalikatPortalSidebarV2
          variant="employee"
          logoSrc={logo1}
          collapsed={isSidebarCollapsed}
          onToggleCollapsed={() => setIsSidebarCollapsed((value) => !value)}
          ariaLabel={t("portal.aria")}
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
                <small>{t("portal.profileLabel")}</small>
                <strong>{displayName}</strong>
                <span>{roleLabel}</span>
              </div>
            </div>
          }
          primaryActionTooltip={t("portal.newRequest")}
          primaryAction={
            <button
              type="button"
              className="employee-sidebar-request"
              onClick={() => setRequestSheetOpen(true)}
            >
              <FontAwesomeIcon icon={faPlus} />
              <span>{t("portal.newRequest")}</span>
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
              <span>{notificationsLoading ? t("portal.notificationsUpdating") : portalSubtitle}</span>
              <div className="employee-portal-sidebar__switches">
                {canOpenHr ? (
                  <Link to="/dashboard/hr"><FontAwesomeIcon icon={faUserShield} /> {t("portal.hr")}</Link>
                ) : null}
                {canOpenDashboard ? (
                  <Link to="/dashboard/overview"><FontAwesomeIcon icon={faTableColumns} /> {t("portal.dashboard")}</Link>
                ) : null}
              </div>
              <button type="button" onClick={() => void handleLogout()} disabled={loggingOut}>
                <FontAwesomeIcon icon={faRightFromBracket} />
                {loggingOut ? t("portal.loggingOut") : t("portal.logout")}
              </button>
            </div>
          }
        />

        <main className="employee-portal-main">
          <DashboardHeader
            theme="employee"
            title={employeeHeaderTitle}
            subtitle="MALIKAT"
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
                    onLogout={handleLogout}
                    loggingOut={loggingOut}
                  />
                </PermissionRoute>
              }
            />
            <Route path="requests" element={<PermissionRoute permission="employee_requests.own.view"><EmployeeRequestsPage session={session} onPortalChange={loadNotifications} onNewRequest={() => setRequestSheetOpen(true)} /></PermissionRoute>} />
            <Route path="requests/:requestId" element={<PermissionRoute permission="employee_requests.own.view"><EmployeeRequestsPage session={session} onPortalChange={loadNotifications} onNewRequest={() => setRequestSheetOpen(true)} /></PermissionRoute>} />
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

      {hasPermission("employee_requests.own.create") && location.pathname !== "/employee/requests" ? (
        <button
          type="button"
          className="employee-floating-request"
          onClick={() => setRequestSheetOpen(true)}
          aria-label={t("portal.newRequest")}
        >
          <FontAwesomeIcon icon={faPlus} />
          <span>{t("portal.newRequest")}</span>
        </button>
      ) : null}

      <nav className="employee-bottom-nav" aria-label={t("portal.aria")}>
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
          dir={direction}
          lang={language}
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
              aria-label={tr("إغلاق", "Close")}
            >
              <FontAwesomeIcon icon={faXmark} />
            </button>
            <div className="employee-request-sheet__head">
              <span className="employee-request-sheet__icon">
                <FontAwesomeIcon icon={faPaperPlane} />
              </span>
              <div>
                <h2 id="employee-request-title">{tr("طلب جديد", "New request")}</h2>
                <p>{tr("اختر نوع الطلب الذي تريد إرساله إلى الإدارة", "Choose the request you want to send to management")}</p>
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

export default function EmployeePortal() {
  return (
    <EmployeePortalLanguageProvider>
      <EmployeePortalContent />
    </EmployeePortalLanguageProvider>
  );
}
