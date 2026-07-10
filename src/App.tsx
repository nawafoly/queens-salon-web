// src/App.tsx
import React, { useEffect, useLayoutEffect, useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";

import "react-toastify/dist/ReactToastify.css";

// Components
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import WelcomeModal from "./components/WelcomeModal";
import ChatBot from "./components/ChatBot";
import LoadingBrand from "./components/LoadingBrand";
import PublicAppShell from "./components/PublicAppShell";

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
import AdminHrDashboard from "./pages/AdminHrDashboard";
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
import { auth, db } from "./services/firebase";
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

// Pending Dashboard
import DashboardPending from "./pages/DashboardPending";

/* ================================
   Types & Helpers
================================ */
function isAdminPortalRole(role: UiRole) {
  return role === "owner" || role === "admin" || role === "hr";
}

function isEmployeePortalRole(role: UiRole) {
  return (
    role === "owner" ||
    role === "admin" ||
    role === "hr" ||
    role === "reception" ||
    role === "staff"
  );
}

function isClientRole(role: UiRole) {
  return role === "client";
}

function isPendingRole(role: UiRole) {
  return role === "pending";
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

  const location = useLocation();
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
    location.pathname.startsWith("/hr") ||
    location.pathname.startsWith("/admin") ||
    location.pathname.startsWith("/employee") ||
    location.pathname.startsWith("/partner");

  const isProfilePage =
    location.pathname === "/profile" || location.pathname === "/client";
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
    }
  }, []);

  useEffect(() => {
    let seq = 0;
    let unsubUserDoc: (() => void) | null = null;

    const unsub = onAuthStateChanged(auth, (user) => {
      const currentSeq = ++seq;

      try {
        unsubUserDoc?.();
      } catch {
        // noop
      }
      unsubUserDoc = null;

      setAuthUser(user);
      setFirebaseAuthReady(true);

      if (!user) {
        const currentSession = readStoredAuthSession();

        if (isLegacyClientSession(currentSession)) {
          setStoredSession(currentSession);
          setUserRole("client");
          setUserName(currentSession?.displayName || getNameFromStorage());
          setUserActive(true);
        } else {
          if (currentSession) clearStoredAuthSession();
          setStoredSession(null);
          setUserRole("guest");
          setUserName("");
          setUserActive(false);
        }

        setAuthReady(true);
        return;
      }

      setAuthReady(false);

      unsubUserDoc = onSnapshot(
        doc(db, "salons", "main", "users", user.uid),
        (snap) => {
          if (currentSeq !== seq) return;

          if (!snap.exists()) {
            clearStoredAuthSession();
            setStoredSession(null);
            setUserRole("guest");
            setUserName(user.displayName || "");
            setUserActive(false);
            setAuthReady(true);
            return;
          }

          const data = snap.data() as Record<string, unknown>;
          const active = data?.active !== false;
          let liveRole = normalizeAuthRole(data?.role);
          if (!active && isInternalAuthRole(liveRole)) liveRole = "pending";

          const liveName = String(
            data?.displayName || data?.name || user.displayName || ""
          ).trim();

          setUserRole(liveRole);
          setUserName(liveName);
          setUserActive(active);

          writeLiveAuthCache({
            uid: user.uid,
            email: String(data?.email || user.email || "").trim(),
            name: liveName,
            role: liveRole,
            active,
            profile: data,
          });
          setStoredSession(readStoredAuthSession());
          setAuthReady(true);
        },
        (error) => {
          if (currentSeq !== seq) return;
          console.warn("[App] failed to watch live user access", error);
          clearStoredAuthSession();
          setStoredSession(null);
          setUserRole("guest");
          setUserName(user.displayName || "");
          setUserActive(false);
          setAuthReady(true);
        }
      );
    });

    return () => {
      seq += 1;
      try {
        unsubUserDoc?.();
      } catch {
        // noop
      }
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
    if (isPendingRole(role)) return <Navigate to="/dashboard-pending" replace />;
    if (role === "staff") return <Navigate to="/employee/overview" replace />;
    if (role === "hr") return <Navigate to="/admin" replace />;
    if (role === "owner" || role === "admin" || role === "reception") {
      return children;
    }
    if (isClientRole(role)) return <Navigate to="/client" replace />;
    return <Navigate to="/hr" replace />;
  };

  const renderAdminRoute = (children: React.ReactElement) => {
    if (!authReady || !firebaseAuthReady) {
      return <LoadingBrand text="جاري تجهيز مساحة العمل..." />;
    }
    if (!authUser) return <Navigate to="/hr" replace />;

    const role = userRole;
    if (isPendingRole(role)) return <Navigate to="/dashboard-pending" replace />;
    if (isAdminPortalRole(role)) return children;
    if (role === "reception") return <Navigate to="/dashboard" replace />;
    if (role === "staff") return <Navigate to="/employee/overview" replace />;
    if (isClientRole(role)) return <Navigate to="/client" replace />;
    return <Navigate to="/hr" replace />;
  };

  const renderEmployeeRoute = (children: React.ReactElement) => {
    if (!authReady || !firebaseAuthReady) {
      return <LoadingBrand text="جاري تجهيز مساحة العمل..." />;
    }
    if (!authUser) return <Navigate to="/hr" replace />;

    const role = userRole;
    if (isPendingRole(role)) return <Navigate to="/dashboard-pending" replace />;
    if (isEmployeePortalRole(role)) return children;
    if (isClientRole(role)) return <Navigate to="/client" replace />;
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
    if (isPendingRole(role)) return children;
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
          element={IS_CUSTOMER_APP ? <Navigate to="/login" replace /> : <SuccessInternal />}
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
          path="/client"
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
              renderAdminRoute(<AdminHrDashboard />)
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
          element={
            IS_STAFF_APP ? (
              <Navigate to="/hr" replace />
            ) : (
              renderClientRoute(<Profile />)
            )
          }
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
  );
};

export default App;


