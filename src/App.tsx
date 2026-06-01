// src/App.tsx
import React, { useEffect, useLayoutEffect, useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";

import "react-toastify/dist/ReactToastify.css";
import "./App.css";

// Components
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import WelcomeModal from "./components/WelcomeModal";
import ChatBot from "./components/ChatBot";
import LoadingBrand from "./components/LoadingBrand";

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
import EmployeePortal from "./pages/EmployeePortal";
import Profile from "./pages/Profile";
import ForgotPassword from "./pages/ForgotPassword";
import Track from "./pages/Track";
import SuccessInternal from "./pages/SuccessInternal";

import Pay from "./pages/Pay";
import PaymentCallback from "./pages/PaymentCallback";
import { auth, db } from "./services/firebase";
import { createOrLoadUserProfile } from "./services/userProfile";
import { resolveDashboardLandingPath } from "./helpers/routePaths";
import { readStoredAuthSession } from "./services/localAuthSession";

// Pending Dashboard
import DashboardPending from "./pages/DashboardPending";

/* ================================
   Types & Helpers
================================ */
type UiRole =
  | "owner"
  | "admin"
  | "hr"
  | "reception"
  | "staff"
  | "client"
  | "pending"
  | "guest";

const KNOWN_ROLES: UiRole[] = [
  "owner",
  "admin",
  "hr",
  "reception",
  "staff",
  "client",
  "pending",
  "guest",
];

function normalizeRole(role: any): UiRole {
  const r = String(role || "").toLowerCase().trim();
  if (r === "administrator") return "admin";
  if (r === "hr" || r === "human resources" || r === "humanresources") return "hr";
  if (r === "receptionist") return "reception";
  if (r === "frontdesk") return "reception";
  if (r === "desk") return "reception";
  if (KNOWN_ROLES.includes(r as UiRole)) return r as UiRole;
  return "guest";
}

function isDashboardRole(role: UiRole) {
  return (
    role === "owner" ||
    role === "admin" ||
    role === "reception" ||
    role === "staff"
  );
}

function isAdminPortalRole(role: UiRole) {
  return role === "owner" || role === "admin" || role === "hr";
}

function isEmployeePortalRole(role: UiRole) {
  return role === "owner" || role === "admin" || role === "hr" || role === "reception" || role === "staff";
}

function isClientRole(role: UiRole) {
  return role === "client";
}

function isPendingRole(role: UiRole) {
  return role === "pending";
}

function isMalikatAdminEmail(email: unknown) {
  return String(email || "")
    .toLowerCase()
    .trim()
    .endsWith("@malikat.com");
}

function getNameFromStorage(): string {
  try {
    const p = JSON.parse(localStorage.getItem("user_profile_v1") || "null");
    const n = p?.name ? String(p.name).trim() : "";
    if (n) return n;
  } catch {}
  return String(localStorage.getItem("userName") || "").trim();
}

function writeLiveAuthCache(args: {
  uid: string;
  email: string;
  name: string;
  role: UiRole;
  active?: boolean;
}) {
  try {
    const current = JSON.parse(localStorage.getItem("user_profile_v1") || "null") || {};
    const merged = {
      ...current,
      uid: args.uid,
      email: args.email || current?.email || "",
      name: args.name || current?.name || "",
      role: args.role,
      ...(typeof args.active === "boolean" ? { active: args.active } : {}),
    };

    localStorage.setItem("user_profile_v1", JSON.stringify(merged));
    if (merged.name) localStorage.setItem("userName", String(merged.name));
    else localStorage.removeItem("userName");
    if (merged.email) localStorage.setItem("userEmail", String(merged.email));
    else localStorage.removeItem("userEmail");
    localStorage.setItem("userRole", String(args.role));
    localStorage.setItem(
      "auth_user",
      JSON.stringify({
        uid: args.uid,
        email: merged.email || "",
        role: args.role,
        displayName: merged.name || "",
      })
    );
    window.dispatchEvent(new Event("authChanged"));
  } catch {
    // noop
  }
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
    }
  }, [location.pathname, location.search, location.hash, location.key]);

  return null;
}

/* ================================
   App Component
================================ */
const App: React.FC = () => {
  const [storedSession, setStoredSession] = useState(() => readStoredAuthSession());
  const [authReady, setAuthReady] = useState(() => !!readStoredAuthSession());
  const [authUser, setAuthUser] = useState<FirebaseUser | null>(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const [userName, setUserName] = useState(() => readStoredAuthSession()?.displayName || "");
  const [userRole, setUserRole] = useState<UiRole>(() => readStoredAuthSession()?.role || "guest");

  const location = useLocation();
  const effectiveSessionUser = storedSession?.temp
    ? ({
        uid: storedSession.uid,
        email: storedSession.email,
        displayName: storedSession.displayName,
      } as FirebaseUser)
    : authUser
      ? authUser
      : storedSession
        ? ({
            uid: storedSession.uid,
            email: storedSession.email,
            displayName: storedSession.displayName,
          } as FirebaseUser)
        : null;

  const isInDashboard =
    location.pathname.startsWith("/dashboard") ||
    location.pathname.startsWith("/dashboard-pending") ||
    location.pathname.startsWith("/admin") ||
    location.pathname.startsWith("/employee");
  const isProfilePage =
    location.pathname === "/profile" || location.pathname === "/client";

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
    if (currentSession?.temp || (!authUser && currentSession)) {
      setUserName(currentSession.displayName || getNameFromStorage());
      setUserRole(currentSession.role);
      if (!authUser) {
        setAuthReady(true);
      }
      return;
    }
    setUserName(getNameFromStorage());
  }, []);

  useEffect(() => {
    let seq = 0;
    let unsubUserDoc: (() => void) | null = null;
    const unsub = onAuthStateChanged(auth, async (user) => {
      const currentSeq = ++seq;
      try {
        unsubUserDoc?.();
      } catch {
        // noop
      }
      unsubUserDoc = null;
      setAuthUser(user);

      if (!user) {
        const currentSession = readStoredAuthSession();
        setStoredSession(currentSession);
        if (currentSession) {
          setUserRole(currentSession.role);
          setUserName(currentSession.displayName || getNameFromStorage());
          setAuthReady(true);
          return;
        }
        setUserRole("guest");
        setUserName("");
        setAuthReady(true);
        return;
      }

      try {
        const isMalikatAuth = isMalikatAdminEmail(user.email);
        const profile = await createOrLoadUserProfile(user);
        if (currentSeq !== seq) return;
        let nextRole = normalizeRole(profile.role);
        if (isMalikatAuth && (nextRole === "client" || nextRole === "guest")) {
          nextRole = "pending";
        }
        const nextName = profile.name || user.displayName || "";
        setUserRole(nextRole);
        setUserName(nextName);
        writeLiveAuthCache({
          uid: user.uid,
          email: String(profile.email || user.email || "").trim(),
          name: nextName,
          role: nextRole,
          active: profile.active,
        });

        unsubUserDoc = onSnapshot(
          doc(db, "salons", "main", "users", user.uid),
          (snap) => {
            if (currentSeq !== seq || !snap.exists()) return;
            const data = snap.data() as any;
            const active = data?.active !== false;
            let liveRole = normalizeRole(data?.role || nextRole);
            if (isMalikatAuth && (liveRole === "client" || liveRole === "guest")) {
              liveRole = "pending";
            }
            if (!active) liveRole = "pending";

            const liveName =
              String(data?.displayName || data?.name || nextName || user.displayName || "").trim();

            setUserRole(liveRole);
            setUserName(liveName);
            writeLiveAuthCache({
              uid: user.uid,
              email: String(data?.email || profile.email || user.email || "").trim(),
              name: liveName,
              role: liveRole,
              active,
            });
          },
          () => {
            // noop
          }
        );
      } catch {
        if (currentSeq !== seq) return;
        // For admin-domain users, fail-safe to pending instead of client/login loops.
        if (isMalikatAdminEmail(user.email)) {
          setUserRole("pending");
        } else {
          // Fail-closed: never keep admin permissions if profile lookup fails.
          setUserRole("guest");
        }
        setUserName(user.displayName || "");
      } finally {
        if (currentSeq !== seq) return;
        setAuthReady(true);
      }
    });

    return () => {
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
      readWelcomeFromStorage();
      const currentSession = readStoredAuthSession();
      setStoredSession(currentSession);
      if (currentSession?.temp || (!authUser && currentSession)) {
        setUserRole(currentSession.role);
        setUserName(currentSession.displayName || getNameFromStorage());
        setAuthReady(true);
        return;
      }
      if (!authUser) setUserName(getNameFromStorage());
    };

    window.addEventListener("authChanged", onAuthChanged);
    return () => window.removeEventListener("authChanged", onAuthChanged);
  }, [authUser]);

  /* ================================
     Guards
  ================================ */

  const DashboardGuard = ({ children }: { children: React.ReactNode }) => {
    if (!authReady) return <LoadingBrand text="جاري التحقق من الجلسة..." />;
    const role = userRole;
    const isMalikatAuth = isMalikatAdminEmail(effectiveSessionUser?.email);
    const isDashboardRoot =
      location.pathname === "/dashboard" || location.pathname === "/dashboard/";

    if (isAdminPortalRole(role) && !isDashboardRole(role)) {
      return <Navigate to="/admin" replace />;
    }

    if (isMalikatAuth) {
      if (isDashboardRole(role)) {
        if (role === "staff" && isDashboardRoot) {
          return <Navigate to={resolveDashboardLandingPath(role)} replace />;
        }
        return <>{children}</>;
      }
      return <Navigate to="/dashboard-pending" replace />;
    }

    if (isPendingRole(role))
      return <Navigate to="/dashboard-pending" replace />;

    if (isDashboardRole(role)) {
      if (role === "staff" && isDashboardRoot) {
        return <Navigate to={resolveDashboardLandingPath(role)} replace />;
      }
      return <>{children}</>;
    }
    if (isClientRole(role)) return <Navigate to="/client" replace />;
    return <Navigate to="/login" replace />;
  };

  const AdminGuard = ({ children }: { children: React.ReactNode }) => {
    if (!authReady) return <LoadingBrand text="جاري التحقق من الجلسة..." />;
    const role = userRole;
    const isMalikatAuth = isMalikatAdminEmail(effectiveSessionUser?.email);

    if (isPendingRole(role) || (isMalikatAuth && (role === "client" || role === "guest"))) {
      return <Navigate to="/dashboard-pending" replace />;
    }

    if (isAdminPortalRole(role)) return <>{children}</>;
    if (isDashboardRole(role)) return <Navigate to={resolveDashboardLandingPath(role)} replace />;
    if (isClientRole(role)) return <Navigate to="/client" replace />;
    return <Navigate to="/login" replace />;
  };

  const EmployeeGuard = ({ children }: { children: React.ReactNode }) => {
    if (!authReady) return <LoadingBrand text="جاري التحقق من الجلسة..." />;
    const role = userRole;
    const isMalikatAuth = isMalikatAdminEmail(effectiveSessionUser?.email);

    if (isPendingRole(role) || (isMalikatAuth && (role === "client" || role === "guest"))) {
      return <Navigate to="/dashboard-pending" replace />;
    }

    if (isEmployeePortalRole(role)) return <>{children}</>;
    if (isClientRole(role)) return <Navigate to="/client" replace />;
    return <Navigate to="/login" replace />;
  };

  const ClientGuard = ({ children }: { children: React.ReactNode }) => {
    if (!authReady) return <LoadingBrand text="جاري التحقق من الجلسة..." />;
    const role = userRole;
    const isMalikatAuth = isMalikatAdminEmail(effectiveSessionUser?.email);

    if (isMalikatAuth) {
      if (isAdminPortalRole(role)) return <Navigate to="/admin" replace />;
      if (isDashboardRole(role))
        return <Navigate to={resolveDashboardLandingPath(role)} replace />;
      return <Navigate to="/dashboard-pending" replace />;
    }

    if (isAdminPortalRole(role)) return <Navigate to="/admin" replace />;
    if (isDashboardRole(role)) return <Navigate to={resolveDashboardLandingPath(role)} replace />;
    if (isClientRole(role)) return <>{children}</>;
    if (isPendingRole(role))
      return <Navigate to="/dashboard-pending" replace />;
    return <Navigate to="/login" replace />;
  };

  const ProfileGuard = ({ children }: { children: React.ReactNode }) => {
    if (!authReady) return <LoadingBrand text="جاري التحقق من الجلسة..." />;
    const role = userRole;
    const isMalikatAuth = isMalikatAdminEmail(effectiveSessionUser?.email);

    if (isMalikatAuth) {
      if (isAdminPortalRole(role)) return <Navigate to="/admin" replace />;
      if (isDashboardRole(role))
        return <Navigate to={resolveDashboardLandingPath(role)} replace />;
      return <Navigate to="/dashboard-pending" replace />;
    }

    if (isAdminPortalRole(role)) return <Navigate to="/admin" replace />;
    if (isDashboardRole(role)) return <Navigate to={resolveDashboardLandingPath(role)} replace />;
    if (isClientRole(role)) return <>{children}</>;
    if (isPendingRole(role))
      return <Navigate to="/dashboard-pending" replace />;
    return <Navigate to="/login" replace />;
  };

  const PendingGuard = ({ children }: { children: React.ReactNode }) => {
    if (!authReady) return <LoadingBrand text="جاري التحقق من الجلسة..." />;
    const role = userRole;
    const isMalikatAuth = isMalikatAdminEmail(effectiveSessionUser?.email);

    if (isMalikatAuth) {
      if (isAdminPortalRole(role)) return <Navigate to="/admin" replace />;
      if (isDashboardRole(role))
        return <Navigate to={resolveDashboardLandingPath(role)} replace />;
      return <>{children}</>;
    }

    if (isPendingRole(role)) return <>{children}</>;
    if (isAdminPortalRole(role)) return <Navigate to="/admin" replace />;
    if (isDashboardRole(role))
      return <Navigate to={resolveDashboardLandingPath(role)} replace />;
    if (isClientRole(role)) return <Navigate to="/client" replace />;
    return <Navigate to="/login" replace />;
  };

  return (
    <div className={`app ${isInDashboard ? "is-dashboard" : "is-public"}`}>
      {!isInDashboard && !isProfilePage && (
        <Navbar
          authUser={effectiveSessionUser}
          currentRole={userRole}
          currentUserName={userName}
        />
      )}

      <main className="main-content">
        <ScrollToTop />

        <Routes>
          {/* Public */}
          <Route path="/" element={<Home />} />
          <Route path="/services" element={<Services />} />
          <Route path="/about" element={<About />} />

          {/* ✅ Client Booking (Public) */}
          <Route path="/booking" element={<Booking />} />

          {/* ✅ OLD path (keep for backward compatibility) -> redirect into dashboard route */}
          <Route path="/booking/internal" element={<Navigate to="/dashboard/booking-internal" replace />} />

          {/* Checkout */}
          <Route path="/checkout" element={<Checkout />} />

          {/* Success */}
          <Route path="/success" element={<Success />} />
          <Route path="/success-internal" element={<SuccessInternal />} />

          <Route path="/offers" element={<Offers />} />
          <Route path="/reviews" element={<Reviews />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/login" element={<Login />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/chat" element={<Navigate to="/" replace />} />

          {/* Track */}
          <Route path="/track" element={<Track />} />
          <Route path="/track/:trackId" element={<Track />} />

          {/* Pending */}
          <Route
            path="/dashboard-pending"
            element={
              <PendingGuard>
                <DashboardPending />
              </PendingGuard>
            }
          />

          {/* Client */}
          <Route
            path="/client"
            element={
              <ClientGuard>
                <Profile />
              </ClientGuard>
            }
          />

          {/* Dashboard */}
          <Route
            path="/dashboard/*"
            element={
              <DashboardGuard>
                <Dashboard />
              </DashboardGuard>
            }
          />

          <Route
            path="/admin/*"
            element={
              <AdminGuard>
                <AdminHrDashboard />
              </AdminGuard>
            }
          />

          <Route
            path="/employee/*"
            element={
              <EmployeeGuard>
                <EmployeePortal />
              </EmployeeGuard>
            }
          />

          {/* Profile */}
          <Route
            path="/profile"
            element={
              <ProfileGuard>
                <Profile />
              </ProfileGuard>
            }
          />

          <Route path="/forgot-password" element={<ForgotPassword />} />

          <Route path="/settings" element={<Navigate to="/dashboard/settings" replace />} />

          {/* Payments */}
          <Route path="/pay" element={<Pay />} />
          <Route path="/payment-callback" element={<PaymentCallback />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {!isInDashboard && !isProfilePage && <Footer />}
      {!isInDashboard && !isProfilePage && <ChatBot />}

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
