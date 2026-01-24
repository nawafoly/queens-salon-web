// src/App.tsx
import React, { useEffect, useState } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";

import "react-toastify/dist/ReactToastify.css";
import "./App.css";

// Components
import Navbar from "./components/Navbar";
import Footer from "./components/Footer";
import WelcomeModal from "./components/WelcomeModal";
import ChatBot from "./components/ChatBot";

// Pages
import Home from "./pages/Home";
import Services from "./pages/Services";
import About from "./pages/About";
import Booking from "./pages/Booking";
import Success from "./pages/Success";
import Offers from "./pages/Offers";
import Reviews from "./pages/Reviews";
import Contact from "./pages/Contact";
import Login from "./pages/Login";
import Pricing from "./pages/Pricing";
import Dashboard from "./pages/Dashboard";
import Profile from "./pages/Profile";
import ForgotPassword from "./pages/ForgotPassword";
import Track from "./pages/Track";

import Pay from "./pages/Pay";
import PaymentCallback from "./pages/PaymentCallback";

// ✅ NEW: صفحة انتظار التفعيل
import DashboardPending from "./pages/DashboardPending";

/* ================================
   Types & Helpers
================================ */
type UiRole =
  | "owner"
  | "admin"
  | "reception"
  | "staff"
  | "client"
  | "pending" // ✅ NEW
  | "guest";

const KNOWN_ROLES: UiRole[] = [
  "owner",
  "admin",
  "reception",
  "staff",
  "client",
  "pending",
  "guest",
];

function normalizeRole(role: any): UiRole {
  const r = String(role || "").toLowerCase().trim();
  if (r === "administrator") return "admin";
  if (r === "receptionist") return "reception";
  if (r === "frontdesk") return "reception";
  if (r === "desk") return "reception";
  if (KNOWN_ROLES.includes(r as UiRole)) return r as UiRole;
  return "guest";
}

function isDashboardRole(role: UiRole) {
  return role === "owner" || role === "admin" || role === "reception" || role === "staff";
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
  } catch {}
  return String(localStorage.getItem("userName") || "").trim();
}

/* ================================
   Scroll To Top
================================ */
function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname]);

  return null;
}

/* ================================
   App Component
================================ */
const App: React.FC = () => {
  const [showWelcome, setShowWelcome] = useState(false);
  const [userName, setUserName] = useState("");
  const [userRole, setUserRole] = useState<UiRole>("guest");

  const location = useLocation();
  const isInDashboard = location.pathname.startsWith("/dashboard");

  const readWelcomeFromStorage = () => {
    const flag = localStorage.getItem("showWelcome");
    if (flag === "true") {
      setShowWelcome(true);
      setUserName(getNameFromStorage());
      setUserRole(normalizeRole(localStorage.getItem("userRole") || "guest"));
      localStorage.removeItem("showWelcome");
    }
  };

  const getRoleFromStorage = (): UiRole => {
    return normalizeRole(localStorage.getItem("userRole") || "guest");
  };

  useEffect(() => {
    readWelcomeFromStorage();
    setUserRole(getRoleFromStorage());
    setUserName(getNameFromStorage());

    const onAuthChanged = () => {
      readWelcomeFromStorage();
      setUserRole(getRoleFromStorage());
      setUserName(getNameFromStorage());
    };

    window.addEventListener("authChanged", onAuthChanged);
    return () => window.removeEventListener("authChanged", onAuthChanged);
  }, []);

  /* ================================
     Guards
  ================================ */

  const DashboardGuard = ({ children }: { children: React.ReactNode }) => {
    const role = getRoleFromStorage();

    // ✅ لو Pending → صفحة انتظار
    if (isPendingRole(role)) return <Navigate to="/dashboard-pending" replace />;

    if (isDashboardRole(role)) return <>{children}</>;
    if (isClientRole(role)) return <Navigate to="/client" replace />;
    return <Navigate to="/login" replace />;
  };

  const ClientGuard = ({ children }: { children: React.ReactNode }) => {
    const role = getRoleFromStorage();

    if (isClientRole(role)) return <>{children}</>;
    if (isPendingRole(role)) return <Navigate to="/dashboard-pending" replace />;
    if (isDashboardRole(role)) return <Navigate to="/dashboard" replace />;
    return <Navigate to="/login" replace />;
  };

  const ProfileGuard = ({ children }: { children: React.ReactNode }) => {
    const role = getRoleFromStorage();
    if (role === "guest") return <Navigate to="/login" replace />;
    return <>{children}</>;
  };

  return (
    <div className="app">
      {!isInDashboard && <Navbar />}

      <main className="main-content">
        <ScrollToTop />

        <Routes>
          {/* Public */}
          <Route path="/" element={<Home />} />
          <Route path="/services" element={<Services />} />
          <Route path="/about" element={<About />} />
          <Route path="/booking" element={<Booking />} />

          <Route path="/checkout" element={<Navigate to="/success" replace />} />

          <Route path="/success" element={<Success />} />
          <Route path="/offers" element={<Offers />} />
          <Route path="/reviews" element={<Reviews />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/login" element={<Login />} />
          <Route path="/pricing" element={<Pricing />} />

          {/* Track */}
          <Route path="/track" element={<Track />} />
          <Route path="/track/:trackId" element={<Track />} />

          {/* ✅ NEW: Pending */}
          <Route path="/dashboard-pending" element={<DashboardPending />} />

          {/* Client (Protected) */}
          <Route
            path="/client"
            element={
              <ClientGuard>
                <Profile />
              </ClientGuard>
            }
          />

          {/* Dashboard (Protected) */}
          <Route
            path="/dashboard/*"
            element={
              <DashboardGuard>
                <Dashboard />
              </DashboardGuard>
            }
          />

          {/* Profile (Protected) */}
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

      {!isInDashboard && <Footer />}
      {!isInDashboard && <ChatBot />}

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
