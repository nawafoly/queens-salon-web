import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faBriefcase,
  faCalendarCheck,
  faClipboardList,
  faEnvelope,
  faFileLines,
  faGear,
  faHouse,
  faRightFromBracket,
  faUser,
  faUsers,
  faUserTie,
} from "@fortawesome/free-solid-svg-icons";

import logoMark from "../assets/images/ssunnamed2.png";
import { useEmployeeSession, cleanText } from "./hr/shared";
import {
  listEmployeeFiles,
  listEmployeeLeaveRequests,
  listEmployeeNotifications,
  listRecruitmentApplications,
} from "../services/employeeHub";
import { listEmployeeDirectory } from "../services/employeeDirectory";
import {
  getTodayAttendanceDateKey,
  listStaffAttendanceForDate,
} from "../services/firestoreAttendance";
import { logoutFirebase } from "../services/authService";
import "../styles/HrEntry.css";

type HrEntryStats = {
  applications: number;
  employees: number;
  checkedIn: number;
  checkedOut: number;
  notStarted: number;
  leavePending: number;
  unreadMessages: number;
  files: number;
};

const EMPTY_STATS: HrEntryStats = {
  applications: 0,
  employees: 0,
  checkedIn: 0,
  checkedOut: 0,
  notStarted: 0,
  leavePending: 0,
  unreadMessages: 0,
  files: 0,
};

function roleLabel(role: string) {
  const normalized = cleanText(role).toLowerCase();
  if (normalized === "owner") return "المالك";
  if (normalized === "admin") return "الإدارة";
  if (normalized === "hr") return "الموارد البشرية";
  if (normalized === "reception") return "الاستقبال";
  return "إدارة";
}

function getProfileName(session: ReturnType<typeof useEmployeeSession>) {
  return (
    cleanText(session.displayName) ||
    cleanText(session.userDoc?.name) ||
    cleanText(session.staffDoc?.name) ||
    cleanText(session.email) ||
    "مستخدم الإدارة"
  );
}

function getInitials(name: string) {
  return cleanText(name).slice(0, 2).toUpperCase() || "HR";
}

export default function HrEntry() {
  const session = useEmployeeSession();
  const navigate = useNavigate();
  const [stats, setStats] = useState<HrEntryStats>(EMPTY_STATS);
  const [loadingStats, setLoadingStats] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const displayName = getProfileName(session);
  const avatarUrl = cleanText(
    session.userDoc?.avatarUrl ||
      session.employeeDoc?.avatarUrl ||
      session.staffDoc?.avatarUrl ||
      session.user?.photoURL ||
      ""
  );

  useEffect(() => {
    let alive = true;

    async function loadStats() {
      setLoadingStats(true);
      try {
        const [applications, employees, leaveRequests, files, notifications] = await Promise.all([
          listRecruitmentApplications(80),
          listEmployeeDirectory(),
          listEmployeeLeaveRequests(80),
          listEmployeeFiles(80),
          session.uid
            ? listEmployeeNotifications({
                targetUid: session.uid,
                targetEmployeeId: session.employeeId,
                limitCount: 100,
              }).catch(() => [])
            : Promise.resolve([]),
        ]);

        const employeeIds = employees
          .map(employee =>
            cleanText(
              employee.employeeId ||
                employee.employeeKey ||
                employee.linkedUid ||
                ""
            )
          )
          .filter(Boolean);
        const attendanceToday = await listStaffAttendanceForDate({
          employeeIds,
          date: getTodayAttendanceDateKey(),
        }).catch(() => []);

        if (!alive) return;
        setStats({
          applications: applications.filter(item => {
            const status = cleanText(item.status || "new").toLowerCase();
            return status === "new" || status === "reviewing" || status === "pending";
          }).length,
          employees: employees.filter(item => item.active !== false).length,
          checkedIn: attendanceToday.filter(item => item.status === "checked_in").length,
          checkedOut: attendanceToday.filter(item => item.status === "checked_out").length,
          notStarted: Math.max(
            0,
            employeeIds.length -
              attendanceToday.filter(item => item.status !== "not_started").length
          ),
          leavePending: leaveRequests.filter(item => cleanText(item.status || "pending") === "pending").length,
          unreadMessages: notifications.filter(item => !item.isRead && (item.type === "message" || item.route === "/employee/messages")).length,
          files: files.length,
        });
      } catch {
        if (alive) setStats(EMPTY_STATS);
      } finally {
        if (alive) setLoadingStats(false);
      }
    }

    if (!session.loading) void loadStats();
    return () => {
      alive = false;
    };
  }, [session.employeeId, session.loading, session.uid]);

  const quickTiles = useMemo(
    () => [
      {
        title: "الدوام والإجازات",
        detail: `${stats.checkedIn} حاضر الآن / ${stats.leavePending} طلب إجازة`,
        count: stats.leavePending,
        icon: faCalendarCheck,
        to: "/admin/overview",
      },
      {
        title: "الرسائل الداخلية",
        detail: `${stats.unreadMessages} رسالة جديدة`,
        count: stats.unreadMessages,
        icon: faEnvelope,
        to: "/admin/messages",
      },
      {
        title: "الملفات والرواتب",
        detail: `${stats.files} ملف في الأرشيف`,
        count: 0,
        icon: faFileLines,
        to: "/admin/files",
      },
      {
        title: "طلبات التوظيف",
        detail: `${stats.applications} طلب يحتاج مراجعة`,
        count: stats.applications,
        icon: faBriefcase,
        to: "/admin/recruitment-applications",
      },
    ],
    [stats]
  );

  const menuItems = useMemo(
    () => [
      {
        title: "طلبات التوظيف",
        description: "مراجعة طلبات المرشحين والمرفقات.",
        icon: faBriefcase,
        to: "/admin/recruitment-applications",
      },
      {
        title: "إدارة الموظفين",
        description: "الدوام، الإجازات، الرواتب، الملفات والرسائل.",
        icon: faUsers,
        to: "/admin/employees",
      },
      {
        title: "الحضور والانصراف",
        description: "مراجعة حضور اليوم وسجلات الانصراف.",
        icon: faCalendarCheck,
        to: "/admin/overview",
      },
      {
        title: "التقارير الأسبوعية",
        description: "متابعة تقارير الموظفين وملاحظات المدير.",
        icon: faClipboardList,
        to: "/admin/overview",
      },
      {
        title: "الرسائل الداخلية",
        description: "التواصل الإداري مع الفريق.",
        icon: faEnvelope,
        to: "/admin/messages",
      },
      {
        title: "إنشاء حساب موظف",
        description: "إضافة حساب داخلي وربطه بملف موظفة من بوابة HR.",
        icon: faGear,
        to: "/admin/create-staff",
      },
    ],
    []
  );

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

  if (session.loading) {
    return (
      <main className="hr-entry" dir="rtl">
        <div className="hr-entry-loading">جاري تحميل بوابة الإدارة...</div>
      </main>
    );
  }

  return (
    <main className="hr-entry" dir="rtl">
      <div className="hr-entry-shell">
        <section className="hr-entry-menu-panel" aria-label="اختصارات الإدارة">
          <div className="hr-entry-status-pill">تم تسجيل الدخول</div>
          <div className="hr-entry-menu-head">
            <h1>اختر وجهتك داخل المنصة</h1>
            <p>تظهر الاختصارات حسب صلاحيات حسابك الحالية.</p>
          </div>

          <div className="hr-entry-menu-list">
            {menuItems.map(item => (
              <Link key={item.title} to={item.to} className="hr-entry-menu-item">
                <span className="hr-entry-menu-icon">
                  <FontAwesomeIcon icon={item.icon} />
                </span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.description}</small>
                </span>
                <FontAwesomeIcon className="hr-entry-menu-arrow" icon={faArrowLeft} />
              </Link>
            ))}
          </div>
        </section>

        <section className="hr-entry-hero-panel" aria-label="Queens HR">
          <div className="hr-entry-topbar">
            <div className="hr-entry-pills">
              <span>بوابة داخلية</span>
              <span>Queens HR</span>
            </div>
            <div className="hr-entry-brand">
              <div>
                <strong>منصة الموارد البشرية</strong>
                <small>Queens Staff Portal</small>
              </div>
              <span className="hr-entry-logo">
                <img src={logoMark} alt="Queens" />
              </span>
            </div>
          </div>

          <div className="hr-entry-hero-copy">
            <span>نظام داخلي مستقل</span>
            <h2>بوابة الموارد البشرية للموظفين.</h2>
            <p>مساحة داخلية لمتابعة العمل اليومي، التنبيهات، الحضور، الملفات والموظفين.</p>
          </div>

          <div className="hr-entry-tile-grid" aria-busy={loadingStats}>
            {quickTiles.map(tile => (
              <Link key={tile.title} to={tile.to} className="hr-entry-tile">
                <span className="hr-entry-tile-icon">
                  <FontAwesomeIcon icon={tile.icon} />
                  {tile.count > 0 ? <em>{tile.count}</em> : null}
                </span>
                <strong>{tile.title}</strong>
                <small>{tile.detail}</small>
              </Link>
            ))}
          </div>

          <div className="hr-entry-profile">
            <div className="hr-entry-profile-actions">
              <Link to="/admin/overview" className="hr-entry-primary-action">
                <FontAwesomeIcon icon={faUserTie} />
                فتح لوحة HR
              </Link>
              <button type="button" className="hr-entry-secondary-action" onClick={() => void handleLogout()} disabled={loggingOut}>
                <FontAwesomeIcon icon={faRightFromBracket} />
                {loggingOut ? "جاري الخروج..." : "تسجيل خروج"}
              </button>
            </div>

            <div className="hr-entry-profile-meta">
              <span>{roleLabel(session.role)}</span>
              <strong>{displayName}</strong>
              <small>{session.email || "بدون بريد"}</small>
            </div>

            <div className="hr-entry-avatar" aria-label={displayName}>
              {avatarUrl ? <img src={avatarUrl} alt={displayName} /> : <span>{getInitials(displayName)}</span>}
            </div>
          </div>

          <div className="hr-entry-footer-links">
            <Link to="/">
              <FontAwesomeIcon icon={faHouse} />
              الموقع الرئيسي
            </Link>
            <Link to="/employee/overview">
              <FontAwesomeIcon icon={faUser} />
              بوابة الموظف
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
