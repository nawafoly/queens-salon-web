// src/App.tsx
import React, { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";

import "react-toastify/dist/ReactToastify.css";

// Components
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import WelcomeModal from "./components/WelcomeModal";
import ChatBot from "./components/ChatBot";
import LoadingBrand from "./components/LoadingBrand";
import PublicAppShell from "./components/PublicAppShell";
import AccessDenied from "./components/AccessDenied";
import { PermissionProvider } from "./security/PermissionContext";

// Pages
import Home from "./pages/Home";
import Services from "./pages/Services";
import About from "./pages/About";
import Booking from "./pages/Booking";
import Checkout from "./pages/Checkout";
import Success from "./pages/Success";
import Offers from "./pages/Offers";
import Reviews from "./pages/Reviews";
import Contact from "./pages/Contact";
import Login from "./pages/Login";
import Pricing from "./pages/Pricing";
import Dashboard from "./pages/Dashboard";
import HrEntry from "./pages/HrEntry";
import EmployeePortal from "./pages/EmployeePortal";
import Profile from "./pages/Profile";
import ForgotPassword from "./pages/ForgotPassword";
import Track from "./pages/Track";
import SuccessInternal from "./pages/SuccessInternal";
import PrivacyPolicy from "./pages/PrivacyPolicy";
import PartnerLogin from "./pages/PartnerLogin";
import PartnerPortal from "./pages/PartnerPortal";

import Pay from "./pages/Pay";
import PaymentCallback from "./pages/PaymentCallback";
import { auth } from "./services/firebase";
import type { UiRole } from "./services/userProfile";
import { resolveDashboardLandingPath } from "./helpers/routePaths";
import {
  clearStoredAuthSession,
  isLegacyClientSession,
  readStoredAuthSession,
  writeStoredAuthSession,
} from "./services/localAuthSession";
import { isInternalAuthRole, normalizeAuthRole } from "./services/authAccess";
import { IS_CUSTOMER_APP, IS_STAFF_APP } from "./config/appVariant";
import { getEffectiveAppPermissions, type AppPermission } from "./helpers/permissions";
import { CoreAccountService } from "./services/CoreAccountService";
import { CoreApiError } from "./services/coreApiClient";

// Pending Dashboard
import DashboardPending from "./pages/DashboardPending";

const DASHBOARD_HR_SECTIONS = new Set([
  "hr",
  "requests",
  "employees",
  "permissions",
  "recruitment-applications",
  "messages",
  "files",
  "create-staff",
]);

function isDashboardHrPath(pathname: string) {
  const section = pathname.replace(/^\/dashboard\/?/, "").split("/")[0];
  return DASHBOARD_HR_SECTIONS.has(section);
}

function LegacyAdminRedirect() {
  const { pathname, search, hash } = useLocation();
  const suffix = pathname
    .replace(/^\/admin\/?/, "")
    .replace(/^\/+|\/+$/g, "");

  let targetPath = "/dashboard/hr";

  if (suffix === "users" || suffix.startsWith("users/")) {
    targetPath = `/dashboard/settings/${suffix}`;
  } else if (suffix && suffix !== "overview" && !suffix.startsWith("overview/")) {
    targetPath = `/dashboard/${suffix}`;
  }

  return <Navigate to={{ pathname: targetPath, search, hash }} replace />;
}

/* ================================
   Types & Helpers
================================ */
function isClientRole(role: UiRole) {
  return role === "client";
}

function isPendingRole(role: UiRole) {
  return role === "pending";
}

type LiveAccountState = "active" | "pending" | "disabled" | "archived" | "deleted";

const PRIVILEGED_INTERNAL_ROLES = new Set<UiRole>(["owner", "admin"]);

function cleanAccountStatus(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function isPrivilegedInternalRole(role: UiRole) {
  return PRIVILEGED_INTERNAL_ROLES.has(role);
}

function hasExplicitAccountBlock(profile: Record<string, unknown> | null | undefined) {
  const status = cleanAccountStatus(profile?.status || profile?.accountStatus);
  const employmentStatus = cleanAccountStatus(profile?.employmentStatus);

  return (
    status === "disabled" ||
    status === "inactive" ||
    status === "blocked" ||
    status === "archived" ||
    status === "deleted" ||
    employmentStatus === "archived" ||
    employmentStatus === "deleted" ||
    profile?.deleted === true ||
    profile?.disabled === true ||
    profile?.archived === true ||
    Boolean(profile?.deletedAt)
  );
}

function resolveOperationalAccountActive(
  profile: Record<string, unknown> | null | undefined,
  role: UiRole
) {
  const status = cleanAccountStatus(profile?.status || profile?.accountStatus);

  if (hasExplicitAccountBlock(profile)) return false;
  if (status === "pending") return false;
  if (status === "active") return true;

  if (isPrivilegedInternalRole(role)) {
    return true;
  }

  return profile?.active !== false;
}

function resolveLiveAccountState(
  profile: Record<string, unknown> | null | undefined,
  role: UiRole,
  active: boolean
): LiveAccountState {
  const accountStatus = cleanAccountStatus(profile?.status || profile?.accountStatus);
  if (accountStatus === "deleted") return "deleted";
  if (accountStatus === "archived") return "archived";
  if (accountStatus === "disabled") return "disabled";
  if (accountStatus === "pending") return "pending";
  const employmentStatus = cleanAccountStatus(profile?.employmentStatus);
  if (profile?.deleted === true || Boolean(profile?.deletedAt) || employmentStatus === "deleted") {
    return "deleted";
  }
  if (profile?.archived === true || profile?.removedFromStaff === true || employmentStatus === "archived") {
    return "archived";
  }
  if (role === "pending") return "pending";
  if (!active && isInternalAuthRole(role)) return "disabled";
  return "active";
}

function isBlockedInternalAccount(role: UiRole, accountState: LiveAccountState) {
  return (
    isInternalAuthRole(role) &&
    (accountState === "disabled" || accountState === "archived" || accountState === "deleted")
  );
}

function getNameFromStorage(): string {
  try {
    const p = JSON.parse(localStorage.getItem("user_profile_v1") || "null");
    const n = p?.name ? String(p.name).trim() : "";
    if (n) return n;
  } catch {
    // Ignore malformed legacy profile cache.
  }
  return String(localStorage.getItem("userName") || "").trim();
}

function hasCachedClientProfile(): boolean {
  try {
    const profile = JSON.parse(localStorage.getItem("user_profile_v1") || "null");
    if (!profile || typeof profile !== "object") return false;

    const role = profile?.role ? normalizeAuthRole(profile.role) : "client";
    return role === "client";
  } catch {
    return false;
  }
}

function writeLiveAuthCache(args: {
  uid: string;
  email: string;
  name: string;
  role: UiRole;
  active?: boolean;
  profile?: Record<string, unknown> | null;
}) {
  const profile = args.profile || {};
  writeStoredAuthSession({
    uid: args.uid,
    email: args.email,
    role: args.role,
    displayName: args.name,
    phone: String(profile?.phone || "").trim(),
    active: args.active,
    permissions: Array.isArray(profile?.permissions) ? profile.permissions : undefined,
    permissionOverrides:
      profile?.permissionOverrides && typeof profile.permissionOverrides === "object"
        ? (profile.permissionOverrides as Record<string, unknown>)
        : undefined,
    permissionVersion: Number(profile?.permissionVersion || 0) || undefined,
    profile,
  });
}

/* ================================
   Scroll To Top
================================ */
function ScrollToTop() {
  const location = useLocation();
  const timersRef = React.useRef<number[]>([]);

  const runScrollTop = (behavior: ScrollBehavior = "auto") => {
    if (typeof document !== "undefined") {
      const active = document.activeElement as HTMLElement | null;
      if (
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.tagName === "SELECT")
      ) {
        try {
          active.blur();
        } catch {
          // ignore
        }
      }
    }

    if (typeof document !== "undefined") {
      const nodes: Array<HTMLElement | null> = [
        document.scrollingElement as HTMLElement | null,
        document.documentElement,
        document.body,
        document.querySelector<HTMLElement>(".main-content"),
      ];
      for (const el of nodes) {
        if (!el) continue;
        try {
          el.scrollTo({ top: 0, behavior });
        } catch {
          el.scrollTop = 0;
        }
        el.scrollTop = 0;
      }
    }

    if (typeof window !== "undefined") {
      try {
        window.scrollTo({ top: 0, left: 0, behavior });
      } catch {
        window.scrollTo(0, 0);
      }
      window.scrollTo(0, 0);
    }
  };

  const forceScrollTop = () => {
    if (typeof window === "undefined") {
      runScrollTop("auto");
      return;
    }

    for (const t of timersRef.current) {
      window.clearTimeout(t);
    }
    timersRef.current = [];

    const isMobile = window.matchMedia("(max-width: 991px)").matches;
    const behavior: ScrollBehavior = isMobile ? "auto" : "auto";

    runScrollTop(behavior);
    window.requestAnimationFrame(() => runScrollTop(behavior));

    const delays = [80, 180, 320];
    for (const delay of delays) {
      const t = window.setTimeout(() => runScrollTop("auto"), delay);
      timersRef.current.push(t);
    }
  };

  useLayoutEffect(() => {
    forceScrollTop();
    return () => {
      if (typeof window === "undefined") return;
      for (const t of timersRef.current) {
        window.clearTimeout(t);
      }
      timersRef.current = [];
    };
  }, [location.pathname, location.search, location.hash, location.key]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onShow = () => {
      forceScrollTop();
    };

    window.addEventListener("pageshow", onShow);
    return () => {
      window.removeEventListener("pageshow", onShow);
      for (const t of timersRef.current) {
        window.clearTimeout(t);
      }
      timersRef.current = [];
    };
  }, [location.pathname, location.search, location.hash, location.key]);

  return null;
}

/* ================================
   App Component
================================ */
const App: React.FC = () => {
  const [storedSession, setStoredSession] = useState(() => readStoredAuthSession());
  const [authReady, setAuthReady] = useState(false);
  const [firebaseAuthReady, setFirebaseAuthReady] = useState(false);
  const [authUser, setAuthUser] = useState<FirebaseUser | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const [userName, setUserName] = useState(() => {
    const session = readStoredAuthSession();
    return isLegacyClientSession(session) ? session?.displayName || "" : "";
  });
  const [userRole, setUserRole] = useState<UiRole>(() => {
    const session = readStoredAuthSession();
    return isLegacyClientSession(session) ? "client" : "guest";
  });
  const [userActive, setUserActive] = useState(() => {
    const session = readStoredAuthSession();
    return isLegacyClientSession(session);
  });
  const [accountState, setAccountState] = useState<LiveAccountState>("active");

  const location = useLocation();
  const permissionSource = useMemo(
    () => ({
      role: userRole,
      permissions: storedSession?.permissions,
      permissionOverrides: storedSession?.permissionOverrides,
      permissionVersion: storedSession?.permissionVersion,
    }),
    [
      storedSession?.permissionOverrides,
      storedSession?.permissionVersion,
      storedSession?.permissions,
      userRole,
    ]
  );
  const effectivePermissions = useMemo(
    () => getEffectiveAppPermissions(permissionSource),
    [permissionSource]
  );
  const effectivePermissionSet = useMemo(
    () => new Set<AppPermission>(effectivePermissions),
    [effectivePermissions]
  );
  const hasPermission = (permission: AppPermission) => effectivePermissionSet.has(permission);
  const hasAnyPermission = (permissions: AppPermission[]) =>
    permissions.some((permission) => effectivePermissionSet.has(permission));

  const legacyClientSession = isLegacyClientSession(storedSession);
  const hasProfileShellCache =
    legacyClientSession || isClientRole(userRole) || hasCachedClientProfile();

  const effectiveSessionUser = authUser
    ? authUser
    : legacyClientSession && storedSession
      ? ({
          uid: storedSession.uid,
          email: storedSession.email,
          displayName: storedSession.displayName,
        } as FirebaseUser)
      : null;

  const isInDashboard =
    location.pathname.startsWith("/dashboard") ||
    location.pathname.startsWith("/dashboard-pending") ||
    location.pathname.startsWith("/account-disabled") ||
    location.pathname.startsWith("/hr") ||
    location.pathname.startsWith("/admin") ||
    location.pathname.startsWith("/employee") ||
    location.pathname.startsWith("/partner");

  const isProfilePage =
    location.pathname === "/profile" || location.pathname.startsWith("/client");
  const isAuthPage =
    location.pathname === "/login" ||
    location.pathname.startsWith("/hr") ||
    location.pathname === "/partner/login";

  const readWelcomeFromStorage = () => {
    const flag = localStorage.getItem("showWelcome");
    if (flag === "true") {
      setShowWelcome(true);
      setUserName(getNameFromStorage());
      localStorage.removeItem("showWelcome");
    }
  };

  useEffect(() => {
    readWelcomeFromStorage();
    const currentSession = readStoredAuthSession();
    setStoredSession(currentSession);

    if (isLegacyClientSession(currentSession)) {
      setUserRole("client");
      setUserName(currentSession?.displayName || getNameFromStorage());
      setUserActive(true);
      setAccountState("active");
    }
  }, []);

  useEffect(() => {
    let seq = 0;

    const unsub = onAuthStateChanged(auth, (user) => {
      const currentSeq = ++seq;

      setAuthUser(user);
      setFirebaseAuthReady(true);

      if (!user) {
        const currentSession = readStoredAuthSession();

        if (isLegacyClientSession(currentSession)) {
          setStoredSession(currentSession);
          setUserRole("client");
          setUserName(currentSession?.displayName || getNameFromStorage());
          setUserActive(true);
          setAccountState("active");
        } else {
          if (currentSession) clearStoredAuthSession();
          setStoredSession(null);
          setUserRole("guest");
          setUserName("");
          setUserActive(false);
          setAccountState("active");
        }

        setAuthReady(true);
        return;
      }

      setAuthReady(false);

      void (async () => {
        try {
          if (currentSeq !== seq) return;

          const me = await CoreAccountService.me();
          if (currentSeq !== seq) return;

          const account = me.user;
          const liveRole = normalizeAuthRole(account.role || account.primaryRole);
          const data: Record<string, unknown> = {
            ...account,
            uid: account.firebaseUid || account.uid || user.uid,
            role: liveRole,
            permissions: me.permissions,
            employeeLink: me.employeeLink,
          };
          const active = resolveOperationalAccountActive(data, liveRole);
          const liveAccountState = resolveLiveAccountState(data, liveRole, active);

          const liveName = String(
            account.displayName || user.displayName || ""
          ).trim();

          setUserRole(liveRole);
          setUserName(liveName);
          setUserActive(active);
          setAccountState(liveAccountState);

          writeLiveAuthCache({
            uid: user.uid,
            email: String(account.email || user.email || "").trim(),
            name: liveName,
            role: liveRole,
            active,
            profile: data,
          });
          setStoredSession(readStoredAuthSession());
          setAuthReady(true);
        } catch (error) {
          if (currentSeq !== seq) return;
          console.warn("[App] failed to load Core account access", error);
          clearStoredAuthSession();
          setStoredSession(null);
          const code = error instanceof CoreApiError ? error.code : "";
          if (code === "ACCOUNT_PENDING") {
            setUserRole("pending");
            setAccountState("pending");
          } else if (code === "ACCOUNT_DISABLED") {
            setUserRole("staff");
            setAccountState("disabled");
          } else if (code === "ACCOUNT_DELETED") {
            setUserRole("staff");
            setAccountState("deleted");
          } else {
            setUserRole("guest");
            setAccountState("active");
          }
          setUserName(user.displayName || "");
          setUserActive(false);
          setAuthReady(true);
        }
      })();
    });

    return () => {
      seq += 1;
      unsub();
    };
  }, []);

  useEffect(() => {
    const onAuthChanged = () => {
      if (document.documentElement.dataset.profileEditOpen === "true") {
        return;
      }

      readWelcomeFromStorage();
      const currentSession = readStoredAuthSession();
      setStoredSession(currentSession);

      if (!authUser && isLegacyClientSession(currentSession)) {
        setUserRole("client");
        setUserName(currentSession?.displayName || getNameFromStorage());
        setUserActive(true);
        setAccountState("active");
      }
    };

    window.addEventListener("authChanged", onAuthChanged);
    return () => window.removeEventListener("authChanged", onAuthChanged);
  }, [authUser]);

  /* ================================
     Guards
  ================================ */

  const renderDashboardRoute = (children: React.ReactElement) => {
    if (!authReady || !firebaseAuthReady) {
      return <LoadingBrand text="جاري تجهيز مساحة العمل..." />;
    }
    if (!authUser) return <Navigate to="/hr" replace />;

    const role = userRole;
    if (isBlockedInternalAccount(role, accountState)) return <Navigate to="/account-disabled" replace />;
    if (isPendingRole(role)) return <Navigate to="/dashboard-pending" replace />;
    if (hasPermission("workspace.dashboard.view")) return children;
    if (isClientRole(role)) return <Navigate to="/client" replace />;
    if (hasPermission("workspace.employee_portal.view")) {
      return <AccessDenied requiredPermission="workspace.dashboard.view" />;
    }
    return <Navigate to="/hr" replace />;
  };

  const renderAdminRoute = (children: React.ReactElement) => {
    if (!authReady || !firebaseAuthReady) {
      return <LoadingBrand text="جاري تجهيز مساحة العمل..." />;
    }
    if (!authUser) return <Navigate to="/hr" replace />;

    const role = userRole;
    if (isBlockedInternalAccount(role, accountState)) return <Navigate to="/account-disabled" replace />;
    if (isPendingRole(role)) return <Navigate to="/dashboard-pending" replace />;
    if (
      hasAnyPermission([
        "employees.view",
        "attendance.view",
        "attendance.leaves.manage",
        "employee_requests.view",
        "recruitment.view",
        "messages.manage",
        "employees.files.view",
        "admin_accounts.view",
        "admin_accounts.manage",
      ])
    ) {
      return children;
    }
    if (isClientRole(role)) return <Navigate to="/client" replace />;
    if (isInternalAuthRole(role)) {
      return <AccessDenied message="حسابك مسجل، لكنه لا يملك صلاحية دخول لوحة الموارد البشرية." />;
    }
    return <Navigate to="/hr" replace />;
  };

  const renderEmployeeRoute = (children: React.ReactElement) => {
    if (!authReady || !firebaseAuthReady) {
      return <LoadingBrand text="جاري تجهيز مساحة العمل..." />;
    }
    if (!authUser) return <Navigate to="/hr" replace />;

    const role = userRole;
    if (isBlockedInternalAccount(role, accountState)) return <Navigate to="/account-disabled" replace />;
    if (isPendingRole(role)) return <Navigate to="/dashboard-pending" replace />;
    if (hasPermission("workspace.employee_portal.view")) return children;
    if (isClientRole(role)) return <Navigate to="/client" replace />;
    if (isInternalAuthRole(role)) {
      return <AccessDenied requiredPermission="workspace.employee_portal.view" />;
    }
    return <Navigate to="/hr" replace />;
  };

  const renderClientRoute = (children: React.ReactElement) => {
    if (!authReady || !firebaseAuthReady) {
      if (hasProfileShellCache) return children;
      return <LoadingBrand text="جاري تجهيز مساحة العمل..." />;
    }

    if (!authUser && legacyClientSession) return children;
    if (!authUser) return <Navigate to="/login" replace />;

    const role = userRole;
    if (isClientRole(role) && userActive) return children;
    if (isBlockedInternalAccount(role, accountState)) return <Navigate to="/account-disabled" replace />;
    if (isPendingRole(role)) return <Navigate to="/dashboard-pending" replace />;
    if (isInternalAuthRole(role)) {
      return <Navigate to={resolveDashboardLandingPath(role)} replace />;
    }
    return <Navigate to="/login" replace />;
  };

  const renderPendingRoute = (children: React.ReactElement) => {
    if (!authReady || !firebaseAuthReady) {
      return <LoadingBrand text="جاري تجهيز مساحة العمل..." />;
    }
    if (!authUser) return <Navigate to="/hr" replace />;

    const role = userRole;
    if (isBlockedInternalAccount(role, accountState)) return <Navigate to="/account-disabled" replace />;
    if (isPendingRole(role)) return children;
    if (isInternalAuthRole(role)) {
      return <Navigate to={resolveDashboardLandingPath(role)} replace />;
    }
    if (isClientRole(role)) return <Navigate to="/client" replace />;
    return <Navigate to="/hr" replace />;
  };

  const renderDisabledAccountRoute = (children: React.ReactElement) => {
    if (!authReady || !firebaseAuthReady) {
      return <LoadingBrand text="جاري تجهيز مساحة العمل..." />;
    }
    if (!authUser) return <Navigate to="/hr" replace />;

    const role = userRole;
    if (isBlockedInternalAccount(role, accountState)) return children;
    if (isPendingRole(role)) return <Navigate to="/dashboard-pending" replace />;
    if (isInternalAuthRole(role)) {
      return <Navigate to={resolveDashboardLandingPath(role)} replace />;
    }
    if (isClientRole(role)) return <Navigate to="/client" replace />;
    return <Navigate to="/hr" replace />;
  };

  const showPublicAppShell =
    !IS_STAFF_APP && !isInDashboard && !isProfilePage && !isAuthPage;

  const appRoutes = (
    <main className="main-content">
      <ScrollToTop />

      <Routes>
        {/* Public */}
        <Route
          path="/"
          element={IS_STAFF_APP ? <Navigate to="/hr" replace /> : <Home />}
        />
        <Route
          path="/services"
          element={IS_STAFF_APP ? <Navigate to="/hr" replace /> : <Services />}
        />
        <Route
          path="/about"
          element={IS_STAFF_APP ? <Navigate to="/hr" replace /> : <About />}
        />

        {/* Client Booking Public */}
        <Route
          path="/booking"
          element={IS_STAFF_APP ? <Navigate to="/hr" replace /> : <Booking />}
        />

        {/* Old path compatibility */}
        <Route
          path="/booking/internal"
          element={
            <Navigate
              to={IS_STAFF_APP ? "/hr" : "/dashboard/booking-internal"}
              replace
            />
          }
        />

        {/* Checkout */}
        <Route
          path="/checkout"
          element={IS_STAFF_APP ? <Navigate to="/hr" replace /> : <Checkout />}
        />

        {/* Success */}
        <Route
          path="/success"
          element={IS_STAFF_APP ? <Navigate to="/hr" replace /> : <Success />}
        />
        <Route
          path="/success-internal"
          element={
            IS_CUSTOMER_APP ? (
              <Navigate to="/login" replace />
            ) : !authReady || !firebaseAuthReady ? (
              <LoadingBrand text="جاري تجهيز الفاتورة..." />
            ) : !authUser ? (
              <Navigate to="/hr" replace />
            ) : hasPermission("bookings.print") ? (
              <SuccessInternal />
            ) : (
              <AccessDenied requiredPermission="bookings.print" />
            )
          }
        />

        <Route
          path="/offers"
          element={IS_STAFF_APP ? <Navigate to="/hr" replace /> : <Offers />}
        />
        <Route
          path="/reviews"
          element={IS_STAFF_APP ? <Navigate to="/hr" replace /> : <Reviews />}
        />
        <Route
          path="/contact"
          element={IS_STAFF_APP ? <Navigate to="/hr" replace /> : <Contact />}
        />
        <Route
          path="/login"
          element={IS_STAFF_APP ? <Navigate to="/hr" replace /> : <Login />}
        />
        <Route
          path="/pricing"
          element={IS_STAFF_APP ? <Navigate to="/hr" replace /> : <Pricing />}
        />
        <Route path="/privacy-policy" element={<PrivacyPolicy />} />
        <Route path="/privacy" element={<Navigate to="/privacy-policy" replace />} />
        <Route path="/chat" element={<Navigate to="/" replace />} />

        {/* Track */}
        <Route
          path="/track"
          element={IS_STAFF_APP ? <Navigate to="/hr" replace /> : <Track />}
        />
        <Route
          path="/track/:trackId"
          element={IS_STAFF_APP ? <Navigate to="/hr" replace /> : <Track />}
        />

        {/* Disabled account */}
        <Route
          path="/account-disabled"
          element={
            IS_CUSTOMER_APP ? (
              <Navigate to="/login" replace />
            ) : (
              renderDisabledAccountRoute(<DashboardPending mode="disabled" />)
            )
          }
        />

        {/* Pending */}
        <Route
          path="/dashboard-pending"
          element={
            IS_CUSTOMER_APP ? (
              <Navigate to="/login" replace />
            ) : (
              renderPendingRoute(<DashboardPending />)
            )
          }
        />

        {/* Client */}
        <Route
          path="/client/booking"
          element={<Navigate to={IS_STAFF_APP ? "/hr" : "/booking"} replace />}
        />
        <Route
          path="/client/*"
          element={
            IS_STAFF_APP ? (
              <Navigate to="/hr" replace />
            ) : (
              renderClientRoute(<Profile />)
            )
          }
        />

        {/* Dashboard */}
        <Route
          path="/dashboard/*"
          element={
            IS_CUSTOMER_APP ? (
              <Navigate to="/login" replace />
            ) : isDashboardHrPath(location.pathname) ? (
              renderAdminRoute(
                <Dashboard
                  initialRole={userRole}
                  initialName={userName}
                  initialEmail={String(effectiveSessionUser?.email || "")}
                  authReady={authReady}
                />
              )
            ) : (
              renderDashboardRoute(
                <Dashboard
                  initialRole={userRole}
                  initialName={userName}
                  initialEmail={String(effectiveSessionUser?.email || "")}
                  authReady={authReady}
                />
              )
            )
          }
        />

        {/* Admin Dashboard - محمي بتسجيل دخول Firebase فعلي */}
        <Route
          path="/admin/*"
          element={
            IS_CUSTOMER_APP ? (
              <Navigate to="/login" replace />
            ) : (
              <LegacyAdminRedirect />
            )
          }
        />

        {/* Partner Portal */}
        <Route path="/partner/login" element={<PartnerLogin />} />
        <Route path="/partner/*" element={<PartnerPortal />} />

        {/* HR Entry - يرجع شكل بوابة الموارد البشرية كما هو */}
        <Route
          path="/hr"
          element={IS_CUSTOMER_APP ? <Navigate to="/login" replace /> : <HrEntry />}
        />
        <Route
          path="/hr/*"
          element={<Navigate to={IS_CUSTOMER_APP ? "/login" : "/hr"} replace />}
        />

        {/* Employee Portal */}
        <Route
          path="/employee/*"
          element={
            IS_CUSTOMER_APP ? (
              <Navigate to="/login" replace />
            ) : (
              renderEmployeeRoute(<EmployeePortal />)
            )
          }
        />

        {/* Profile */}
        <Route
          path="/profile"
          element={<Navigate to={IS_STAFF_APP ? "/hr" : "/client/profile"} replace />}
        />

        <Route path="/forgot-password" element={<ForgotPassword />} />

        <Route
          path="/settings"
          element={<Navigate to="/dashboard/settings" replace />}
        />

        {/* Payments */}
        <Route
          path="/pay"
          element={IS_STAFF_APP ? <Navigate to="/hr" replace /> : <Pay />}
        />
        <Route
          path="/payment-callback"
          element={IS_STAFF_APP ? <Navigate to="/hr" replace /> : <PaymentCallback />}
        />

        {/* Fallback */}
        <Route
          path="*"
          element={
            <Navigate
              to={IS_STAFF_APP ? "/hr" : IS_CUSTOMER_APP ? "/" : "/"}
              replace
            />
          }
        />
      </Routes>
    </main>
  );

  return (
    <PermissionProvider
      role={permissionSource.role}
      permissions={permissionSource.permissions}
      permissionOverrides={permissionSource.permissionOverrides}
      permissionVersion={permissionSource.permissionVersion}
    >
      <div className={`app ${isInDashboard ? "is-dashboard" : "is-public"}`}>
      {showPublicAppShell ? (
        <PublicAppShell
          header={
            <Navbar
              authUser={effectiveSessionUser}
              currentRole={userRole}
              currentUserName={userName}
            />
          }
          footer={<Footer />}
          chat={<ChatBot />}
        >
          {appRoutes}
        </PublicAppShell>
      ) : (
        appRoutes
      )}
      <WelcomeModal
        show={showWelcome}
        userName={userName}
        userRole={userRole}
        onClose={() => {
          setShowWelcome(false);
          localStorage.removeItem("showWelcome");
        }}
      />
      </div>
    </PermissionProvider>
  );
};

export default App;


