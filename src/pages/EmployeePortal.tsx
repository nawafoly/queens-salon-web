import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBell,
  faCalendarDays,
  faChartLine,
  faFileLines,
  faFingerprint,
  faGlobe,
  faHouse,
  faPaperPlane,
  faPlus,
  faRightFromBracket,
  faTableColumns,
  faTriangleExclamation,
  faUser,
  faWallet,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";

import {
  listEmployeeNotifications,
  type EmployeeNotification,
} from "../services/employeeHub";
import { logoutFirebase } from "../services/authService";
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

function cleanPortalText(value: unknown) {
  return String(value || "").trim();
}

function displayInitial(name: string, email: string) {
  const source = cleanPortalText(name) || cleanPortalText(email) || "M";
  return source.slice(0, 1).toUpperCase();
}

export default function EmployeePortal() {
  const session = useEmployeeSession();
  const navigate = useNavigate();
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

  const displayName = cleanPortalText(session.displayName) || "بوابة الموظف";
  const portalSubtitle = "الدوام، الإجازات، الملفات والرسائل";
  const bottomNavItems = [
    { to: "/employee/overview", label: "الرئيسية", icon: faHouse, end: true },
    { to: "/employee/attendance", label: "الحضور", icon: faCalendarDays, end: true },
    { to: "/employee/leave", label: "الطلبات", icon: faPaperPlane },
    { to: "/employee/profile", label: "الملف الشخصي", icon: faUser },
    { to: "/employee/notifications", label: "المزيد", icon: faTableColumns, badge: notificationCounts.all },
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
      <header className="employee-mobile-topbar" aria-label="بوابة الموظف">
        <div className="employee-mobile-topbar__identity">
          <span className="employee-mobile-avatar">{displayInitial(displayName, session.email)}</span>
          <div>
            <strong>بوابة الموظف</strong>
            <small>{portalSubtitle}</small>
          </div>
        </div>

        <div className="employee-mobile-topbar__actions">
          <button
            type="button"
            className="employee-top-pill employee-top-pill--danger"
            onClick={() => void handleLogout()}
            disabled={loggingOut}
          >
            <FontAwesomeIcon icon={faRightFromBracket} />
            <span>{loggingOut ? "..." : "خروج"}</span>
          </button>
          <button type="button" className="employee-top-pill">
            <FontAwesomeIcon icon={faGlobe} />
            <span>English</span>
          </button>
          <Link to="/employee/notifications" className="employee-top-icon" aria-label="التنبيهات">
            <FontAwesomeIcon icon={faBell} />
            {notificationCounts.all > 0 ? <span>{notificationCounts.all}</span> : null}
          </Link>
        </div>
      </header>

      <div className="employee-portal-layout employee-portal-layout--app">
        <main className="employee-portal-main">
          <Routes>
            <Route
              index
              element={<Navigate to="/employee/overview" replace />}
            />
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

      <button
        type="button"
        className="employee-floating-request"
        onClick={() => setRequestSheetOpen(true)}
      >
        <FontAwesomeIcon icon={faPlus} />
        <span>طلب جديد</span>
      </button>

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
        <div className="employee-request-sheet" role="dialog" aria-modal="true" aria-label="طلب جديد">
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
              <h2>طلب جديد</h2>
              <p>اختر نوع الطلب</p>
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
      ) : null}
    </div>
  );
}
