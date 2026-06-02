import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faChartLine, faHouse, faRightFromBracket } from "@fortawesome/free-solid-svg-icons";

import {
  listEmployeeNotifications,
  type EmployeeNotification,
} from "../services/employeeHub";
import { logoutFirebase } from "../services/authService";
import { resolveDashboardLandingPath } from "../helpers/routePaths";
import "../styles/EmployeePortal.css";
import EmployeeFilesPage from "./hr/EmployeeFiles";
import EmployeeMessagesPage from "./hr/EmployeeMessages";
import EmployeeNotificationsPage from "./hr/EmployeeNotifications";
import EmployeeOverviewPage from "./hr/EmployeeOverview";
import EmployeeProfilePage from "./hr/EmployeeProfile";
import { useEmployeeSession } from "./hr/shared";

function PortalSkeleton({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="employee-portal-card">
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </div>
  );
}

function roleLabel(role: string) {
  const normalized = String(role || "").toLowerCase().trim();
  if (normalized === "owner") return "المالك";
  if (normalized === "admin") return "الإدارة";
  if (normalized === "hr") return "الموارد البشرية";
  if (normalized === "reception") return "الاستقبال";
  if (normalized === "staff") return "الموظف";
  return "الموظف";
}

function PortalNavItem({
  to,
  label,
  badge,
}: {
  to: string;
  label: string;
  badge?: number;
}) {
  return (
    <NavLink
      to={to}
      end={to === "/employee/overview"}
      className={({ isActive }) => `employee-portal-link ${isActive ? "is-active" : ""}`}
    >
      <span>{label}</span>
      {typeof badge === "number" && badge > 0 ? <span className="employee-nav-badge">{badge}</span> : null}
    </NavLink>
  );
}

export default function EmployeePortal() {
  const session = useEmployeeSession();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<EmployeeNotification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const notificationsRequestRef = useRef(0);
  const dashboardPath = resolveDashboardLandingPath(session.role);
  const dashboardLabel = session.role === "hr" ? "لوحة HR" : "لوحة التحكم";

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

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await logoutFirebase();
    } finally {
      navigate("/login", { replace: true });
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

  if (session.loading) {
    return (
      <div className="employee-portal" dir="rtl">
        <div className="employee-portal-layout">
          <PortalSkeleton
            title="جاري تحميل بوابة الموظف"
            subtitle="نستعد لعرض الرسائل والملفات والإجازات والتنبيهات الخاصة بك."
          />
        </div>
      </div>
    );
  }

  return (
    <div className="employee-portal" dir="rtl">
      <div className="employee-portal-layout">
        <aside className="employee-portal-sidebar">
          <div className="employee-portal-brand">
            <span className="employee-portal-brand-mark">EM</span>
            <div>
              <strong>{session.displayName || "بوابة الموظف"}</strong>
              <small>{roleLabel(session.role)}</small>
            </div>
          </div>

          <div className="employee-portal-switcher" aria-label="التنقل السريع">
            <Link to="/" className="employee-portal-switch-link employee-portal-switch-link--soft">
              <FontAwesomeIcon icon={faHouse} />
              <span>الموقع الرئيسي</span>
            </Link>
            <Link to={dashboardPath} className="employee-portal-switch-link employee-portal-switch-link--accent">
              <FontAwesomeIcon icon={faChartLine} />
              <span>{dashboardLabel}</span>
            </Link>
            <button
              type="button"
              className="employee-portal-switch-link employee-portal-switch-link--danger"
              onClick={() => void handleLogout()}
              disabled={loggingOut}
            >
              <FontAwesomeIcon icon={faRightFromBracket} />
              <span>{loggingOut ? "جارِ الخروج..." : "تسجيل الخروج"}</span>
            </button>
          </div>

          <nav className="employee-portal-nav" aria-label="تنقل الموظف">
            <PortalNavItem to="/employee/overview" label="نظرة عامة" badge={notificationCounts.all} />
            <PortalNavItem to="/employee/notifications" label="التنبيهات" badge={notificationCounts.all} />
            <PortalNavItem to="/employee/messages" label="الرسائل" badge={notificationCounts.messages} />
            <PortalNavItem to="/employee/files" label="الملفات" badge={notificationCounts.files} />
            <PortalNavItem to="/employee/leave" label="الإجازات" badge={notificationCounts.leave} />
            <PortalNavItem to="/employee/payroll" label="الرواتب" badge={notificationCounts.payroll} />
            <PortalNavItem to="/employee/profile" label="الملف الشخصي" badge={notificationCounts.profile} />
          </nav>

          <div className="employee-portal-meta">
            <span>{session.email || "لا يوجد بريد"}</span>
            <span>{session.employeeId ? `الرقم الوظيفي: ${session.employeeId}` : "لم يرتبط الملف بعد"}</span>
            <small>{notificationsLoading ? "جاري تحديث التنبيهات..." : "التنبيهات محدّثة"}</small>
          </div>
        </aside>

        <main className="employee-portal-main">
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
              path="profile"
              element={<EmployeeProfilePage session={session} onPortalChange={loadNotifications} />}
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
              element={<EmployeeProfilePage session={session} initialTab="leave" onPortalChange={loadNotifications} />}
            />
            <Route
              path="payroll"
              element={<EmployeeProfilePage session={session} initialTab="payroll" onPortalChange={loadNotifications} />}
            />
            <Route path="*" element={<Navigate to="/employee/overview" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
