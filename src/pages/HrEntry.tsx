import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { signInWithEmailAndPassword } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faBriefcase,
  faCalendarCheck,
  faClipboardList,
  faEnvelope,
  faEye,
  faFileLines,
  faGear,
  faGlobe,
  faHouse,
  faLock,
  faRightFromBracket,
  faUser,
  faUsers,
  faUserTie,
} from "@fortawesome/free-solid-svg-icons";

import logoMark from "../assets/images/ssunnamed2.png";
import { auth, db } from "../services/firebase";
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
import { resolvePostLoginRoute } from "../helpers/routePaths";
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
  weeklyReports: number;
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
  weeklyReports: 0,
};

const ADMIN_ROLES = new Set(["owner", "admin", "hr"]);

type HrAuthorizationState = {
  checking: boolean;
  role: string;
  active: boolean;
  source: "pending" | "firestore" | "fallback" | "none";
  userDoc: Record<string, any> | null;
};

function normalizeRoleName(role: unknown) {
  return cleanText(role).toLowerCase();
}

function writeHrAuthorizationCache(args: {
  uid: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  profile?: Record<string, any> | null;
}) {
  try {
    const currentProfile =
      JSON.parse(localStorage.getItem("user_profile_v1") || "null") || {};
    const sourceProfile =
      args.profile && typeof args.profile === "object" ? args.profile : {};
    const mergedProfile = {
      ...currentProfile,
      ...sourceProfile,
      uid: args.uid,
      email: args.email || sourceProfile.email || currentProfile.email || "",
      name: args.name || sourceProfile.name || sourceProfile.displayName || currentProfile.name || "",
      displayName:
        args.name ||
        sourceProfile.displayName ||
        sourceProfile.name ||
        currentProfile.displayName ||
        "",
      role: args.role,
      active: args.active,
    };

    localStorage.setItem("authToken", "firebase");
    localStorage.setItem("userUid", args.uid);
    localStorage.setItem("userRole", args.role);
    if (mergedProfile.email) localStorage.setItem("userEmail", String(mergedProfile.email));
    else localStorage.removeItem("userEmail");
    if (mergedProfile.name) localStorage.setItem("userName", String(mergedProfile.name));
    else localStorage.removeItem("userName");
    localStorage.setItem("user_profile_v1", JSON.stringify(mergedProfile));
    localStorage.setItem(
      "auth_user",
      JSON.stringify({
        uid: args.uid,
        email: mergedProfile.email || "",
        role: args.role,
        displayName: mergedProfile.displayName || mergedProfile.name || "",
      })
    );
    window.dispatchEvent(new Event("authChanged"));
  } catch {
    // Keep authorization rendering independent from localStorage failures.
  }
}

function roleLabel(role: string) {
  const normalized = normalizeRoleName(role);
  if (normalized === "owner") return "المالك";
  if (normalized === "admin") return "إدارة";
  if (normalized === "hr") return "الموارد البشرية";
  if (normalized === "reception") return "الاستقبال";
  if (normalized === "staff") return "موظف";
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

function getLoginErrorMessage(error: unknown) {
  const code = String((error as any)?.code || "");

  if (code.includes("auth/invalid-credential")) {
    return "بيانات الدخول غير صحيحة. تأكد من البريد وكلمة المرور.";
  }

  if (code.includes("auth/user-not-found")) {
    return "لا يوجد حساب بهذا البريد.";
  }

  if (code.includes("auth/wrong-password")) {
    return "كلمة المرور غير صحيحة.";
  }

  if (code.includes("auth/too-many-requests")) {
    return "تم إيقاف المحاولة مؤقتًا بسبب كثرة المحاولات. حاول لاحقًا.";
  }

  if (code.includes("auth/invalid-email")) {
    return "صيغة البريد الإلكتروني غير صحيحة.";
  }

  return "تعذر تسجيل الدخول. راجع البيانات وحاول مرة أخرى.";
}

export default function HrEntry() {
  const session = useEmployeeSession();
  const navigate = useNavigate();

  const [stats, setStats] = useState<HrEntryStats>(EMPTY_STATS);
  const [loadingStats, setLoadingStats] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [authorization, setAuthorization] = useState<HrAuthorizationState>({
    checking: true,
    role: "guest",
    active: false,
    source: "pending",
    userDoc: null,
  });

  const isSignedIn = Boolean(session.uid || session.user?.uid);
  const normalizedRole = normalizeRoleName(authorization.role || session.role);
  const canUseHr =
    isSignedIn &&
    !authorization.checking &&
    authorization.active !== false &&
    ADMIN_ROLES.has(normalizedRole);
  const displayName =
    cleanText(authorization.userDoc?.displayName || authorization.userDoc?.name || "") ||
    getProfileName(session);
  const effectiveEmail =
    cleanText(authorization.userDoc?.email || session.email || session.user?.email || "") ||
    session.email;

  const avatarUrl = cleanText(
    authorization.userDoc?.avatarUrl ||
      session.userDoc?.avatarUrl ||
      session.employeeDoc?.avatarUrl ||
      session.staffDoc?.avatarUrl ||
      session.user?.photoURL ||
      ""
  );

  useEffect(() => {
    let alive = true;

    async function verifyHrAuthorization() {
      if (session.loading) {
        setAuthorization((current) => ({ ...current, checking: true, source: "pending" }));
        return;
      }

      const uid = cleanText(session.user?.uid || session.uid || "");

      if (!uid) {
        setAuthorization({
          checking: false,
          role: "guest",
          active: false,
          source: "none",
          userDoc: null,
        });
        return;
      }

      setAuthorization((current) => ({ ...current, checking: true, source: "pending" }));

      try {
        const snap = await getDoc(doc(db, "salons", "main", "users", uid));
        if (!alive) return;

        if (!snap.exists()) {
          setAuthorization({
            checking: false,
            role: "guest",
            active: false,
            source: "firestore",
            userDoc: null,
          });
          return;
        }

        const userDoc = snap.data() as Record<string, any>;
        const role = normalizeRoleName(userDoc?.role || "guest") || "guest";
        const active = userDoc?.active !== false;
        const email = cleanText(userDoc?.email || session.email || session.user?.email || "");
        const name = cleanText(
          userDoc?.displayName || userDoc?.name || session.displayName || session.email || ""
        );

        writeHrAuthorizationCache({
          uid,
          email,
          name,
          role,
          active,
          profile: userDoc,
        });

        setAuthorization({
          checking: false,
          role,
          active,
          source: "firestore",
          userDoc,
        });
      } catch (error) {
        console.warn("[HrEntry] failed to verify live HR authorization", error);
        if (!alive) return;

        setAuthorization({
          checking: false,
          role: normalizeRoleName(session.role || "guest") || "guest",
          active: session.userDoc?.active !== false,
          source: "fallback",
          userDoc: session.userDoc,
        });
      }
    }

    void verifyHrAuthorization();

    return () => {
      alive = false;
    };
  }, [
    session.displayName,
    session.email,
    session.loading,
    session.role,
    session.uid,
    session.user?.email,
    session.user?.uid,
    session.userDoc,
  ]);

  useEffect(() => {
    if (session.loading || authorization.checking || !isSignedIn || canUseHr) return;

    const route = resolvePostLoginRoute(normalizedRole);

    navigate(route, { replace: true });
  }, [
    authorization.checking,
    canUseHr,
    isSignedIn,
    navigate,
    normalizedRole,
    session.loading,
  ]);

  useEffect(() => {
    let alive = true;

    async function loadStats() {
      if (authorization.checking || !isSignedIn || !canUseHr) {
        setStats(EMPTY_STATS);
        return;
      }

      setLoadingStats(true);

      try {
        const [applications, employees, leaveRequests, files, notifications] =
          await Promise.all([
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
          .map((employee) =>
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

        const pendingApplications = applications.filter((item) => {
          const status = cleanText(item.status || "new").toLowerCase();
          return status === "new" || status === "reviewing" || status === "pending";
        }).length;

        const pendingLeaves = leaveRequests.filter(
          (item) => cleanText(item.status || "pending").toLowerCase() === "pending"
        ).length;

        const unreadMessages = notifications.filter(
          (item) =>
            !item.isRead &&
            (item.type === "message" || item.route === "/employee/messages")
        ).length;

        setStats({
          applications: pendingApplications,
          employees: employees.filter((item) => item.active !== false).length,
          checkedIn: attendanceToday.filter((item) => item.status === "checked_in").length,
          checkedOut: attendanceToday.filter((item) => item.status === "checked_out").length,
          notStarted: Math.max(
            0,
            employeeIds.length -
              attendanceToday.filter((item) => item.status !== "not_started").length
          ),
          leavePending: pendingLeaves,
          unreadMessages,
          files: files.length,
          weeklyReports: 0,
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
  }, [
    authorization.checking,
    canUseHr,
    isSignedIn,
    session.employeeId,
    session.loading,
    session.uid,
  ]);

  const alertTiles = useMemo(
    () => [
      {
        title: "الدوام والإجازات",
        detail:
          stats.leavePending > 0
            ? `${stats.leavePending} تنبيه جديد على الإجازات`
            : "لا توجد تنبيهات جديدة على الإجازات",
        count: stats.leavePending,
        icon: faCalendarCheck,
      },
      {
        title: "التقارير الأسبوعية",
        detail:
          stats.weeklyReports > 0
            ? `${stats.weeklyReports} تقرير يحتاج ملاحظة`
            : "لا توجد تقارير تحتاج ملاحظة",
        count: stats.weeklyReports,
        icon: faClipboardList,
      },
      {
        title: "الرسائل الداخلية",
        detail:
          stats.unreadMessages > 0
            ? `${stats.unreadMessages} رسالة جديدة`
            : "لا توجد رسائل جديدة",
        count: stats.unreadMessages,
        icon: faEnvelope,
      },
      {
        title: "الملفات والرواتب",
        detail:
          stats.files > 0
            ? `${stats.files} ملف جديد يحتاج مراجعة`
            : "لا توجد ملفات تحتاج مراجعة",
        count: stats.files,
        icon: faFileLines,
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
        locked: !canUseHr,
      },
      {
        title: "إدارة الموظفين",
        description: "الدوام، الإجازات، الرواتب، الملفات والرسائل.",
        icon: faUsers,
        to: "/admin/employees",
        locked: !canUseHr,
      },
      {
        title: "الحضور والانصراف",
        description: "مراجعة سجلات الدوام والمواقع والأجهزة.",
        icon: faCalendarCheck,
        to: "/admin/overview",
        locked: !canUseHr,
      },
      {
        title: "التقارير الأسبوعية",
        description: "مراجعة تقارير الموظفين وكتابة ملاحظات المدير.",
        icon: faClipboardList,
        to: "/admin/overview",
        locked: !canUseHr,
      },
      {
        title: "المهام اليومية",
        description: "متابعة تحديثات الموظفين اليومية والصور المرفقة عند الحاجة.",
        icon: faCalendarCheck,
        to: "/admin/overview",
        locked: !canUseHr,
      },
      {
        title: "إعدادات الإدارة",
        description: "الأمان، الصلاحيات، حسابات الإدارة والتوظيف.",
        icon: faGear,
        to: "/admin/settings",
        locked: !canUseHr,
      },
    ],
    [canUseHr]
  );

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (loginLoading) return;

    const email = cleanText(loginEmail);
    const password = String(loginPassword || "");

    if (!email || !password) {
      setLoginError("اكتب البريد الإلكتروني وكلمة المرور.");
      return;
    }

    setLoginLoading(true);
    setLoginError("");

    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      setLoginError(getLoginErrorMessage(error));
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    if (loggingOut) return;

    setLoggingOut(true);

    try {
      await logoutFirebase();
      setLoginPassword("");
      setLoginError("");
    } finally {
      navigate("/hr", { replace: true });
      setLoggingOut(false);
    }
  };

  if (session.loading || (isSignedIn && authorization.checking)) {
    return (
      <main className="hr-entry" dir="rtl">
        <div className="hr-entry-loading">جاري التحقق من الصلاحية...</div>
      </main>
    );
  }

  if (isSignedIn && !canUseHr) {
    return (
      <main className="hr-entry" dir="rtl">
        <div className="hr-entry-loading">جاري فتح ملف الموظف...</div>
      </main>
    );
  }

  return (
    <main className={`hr-entry${!isSignedIn ? " hr-entry--login-only" : ""}`} dir="rtl">
      <div className={`hr-entry-shell${!isSignedIn ? " hr-entry-shell--login-only" : ""}`}>
        {!isSignedIn ? (
          <section className="hr-entry-menu-panel hr-entry-login-panel" aria-label="تسجيل الدخول">
            <div className="hr-entry-login-card">
              <span className="hr-entry-login-chip">دخول الموظفين</span>

              <div className="hr-entry-menu-head">
                <h1>تسجيل الدخول للمنصة الداخلية</h1>
                <p>استخدم بريدك الإداري أو حساب الإدارة المخصص لك.</p>
              </div>

              <form className="hr-entry-login-form" onSubmit={handleLogin}>
                <label>
                  <span>اسم المستخدم أو البريد الإلكتروني</span>
                  <input
                    type="email"
                    value={loginEmail}
                    onChange={(event) => setLoginEmail(event.target.value)}
                    autoComplete="email"
                    placeholder="example@malikat.com"
                    disabled={loginLoading}
                  />
                </label>

                <label>
                  <span>كلمة المرور</span>
                  <div className="hr-entry-password-field">
                    <input
                      type={showPassword ? "text" : "password"}
                      value={loginPassword}
                      onChange={(event) => setLoginPassword(event.target.value)}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      disabled={loginLoading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((current) => !current)}
                      aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                    >
                      <FontAwesomeIcon icon={faEye} />
                    </button>
                  </div>
                </label>

                {loginError ? <div className="hr-entry-login-error">{loginError}</div> : null}

                <button
                  type="submit"
                  className="hr-entry-login-submit"
                  disabled={loginLoading}
                >
                  <FontAwesomeIcon icon={faLock} />
                  {loginLoading ? "جاري الدخول..." : "دخول المنصة"}
                </button>
              </form>

              <div className="hr-entry-login-footer">
                <Link to="/forgot-password">نسيت كلمة المرور؟</Link>
                <span>الدخول مخصص لحسابات الموظفين والإدارة فقط.</span>
              </div>
            </div>
          </section>
        ) : (
          <section className="hr-entry-menu-panel" aria-label="اختصارات الإدارة">
            <div className="hr-entry-status-pill">تم تسجيل الدخول</div>

            <div className="hr-entry-menu-head">
              <h1>اختر وجهتك داخل المنصة</h1>
              <p>تظهر الاختصارات حسب صلاحيات حسابك الحالية.</p>
            </div>

            {canUseHr ? (
              <div className="hr-entry-menu-list">
{menuItems.map((item) => {
  if (item.locked) {
    return (
      <div
        key={item.title}
        className="hr-entry-menu-item is-locked"
        aria-disabled="true"
      >
        <span className="hr-entry-menu-icon">
          <FontAwesomeIcon icon={item.icon} />
        </span>

        <span>
          <strong>{item.title}</strong>
          <small>{item.description}</small>
        </span>

        <span className="hr-entry-lock-badge">
          <FontAwesomeIcon icon={faLock} />
          غير متاح
        </span>
      </div>
    );
  }

  return (
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
  );
})}
              </div>
            ) : (
              <div className="hr-entry-access-denied">
                <strong>هذا الحساب لا يملك صلاحية دخول HR.</strong>
                <small>سجّل الخروج وادخل بحساب إداري أو حساب موارد بشرية.</small>
                <button
                  type="button"
                  onClick={() => void handleLogout()}
                  disabled={loggingOut}
                >
                  <FontAwesomeIcon icon={faRightFromBracket} />
                  {loggingOut ? "جاري الخروج..." : "تسجيل خروج"}
                </button>
              </div>
            )}
          </section>
        )}

        <section className="hr-entry-hero-panel" aria-label="Queens HR">
          <div className="hr-entry-topbar">
            <div className="hr-entry-pills">
              <span>بوابة داخلية</span>
              <span>
                English
                <FontAwesomeIcon icon={faGlobe} />
              </span>
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
          {alertTiles.map((tile) => {
  const isActive = tile.count > 0;

  return (
    <div
      key={tile.title}
      className={`hr-entry-tile hr-entry-alert-tile ${
        isActive ? "is-active" : "is-idle"
      }`}
    >
      <span className="hr-entry-tile-icon">
        <FontAwesomeIcon icon={tile.icon} />
        {isActive ? <em>{tile.count}</em> : null}
      </span>

      <strong>{tile.title}</strong>
      <small>{tile.detail}</small>
    </div>
  );
})}
          </div>

          <div className="hr-entry-profile">
            {isSignedIn ? (
              <>
                <div className="hr-entry-profile-actions">
                  {canUseHr ? (
                    <Link to="/admin/overview" className="hr-entry-primary-action">
                      <FontAwesomeIcon icon={faUserTie} />
                      فتح البروفايل
                    </Link>
                  ) : null}

                  <button
                    type="button"
                    className="hr-entry-secondary-action"
                    onClick={() => void handleLogout()}
                    disabled={loggingOut}
                  >
                    <FontAwesomeIcon icon={faRightFromBracket} />
                    {loggingOut ? "جاري الخروج..." : "تسجيل خروج"}
                  </button>
                </div>

                <div className="hr-entry-profile-meta">
                  <span>{roleLabel(normalizedRole)}</span>
                  <strong>{displayName}</strong>
                  <small>{effectiveEmail || "بدون بريد"}</small>
                </div>

                <div className="hr-entry-avatar" aria-label={displayName}>
                  {avatarUrl ? (
                    <img src={avatarUrl} alt={displayName} />
                  ) : (
                    <span>{getInitials(displayName)}</span>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="hr-entry-profile-actions">
                  <button type="button" className="hr-entry-primary-action" disabled>
                    <FontAwesomeIcon icon={faLock} />
                    سجّل دخولك أولًا
                  </button>
                </div>

                <div className="hr-entry-profile-meta">
                  <span>بوابة الموظفين</span>
                  <strong>حساب الموارد البشرية</strong>
                  <small>Queens Staff Portal</small>
                </div>

                <div className="hr-entry-avatar" aria-label="حساب الموارد البشرية">
                  <span>HR</span>
                </div>
              </>
            )}
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
