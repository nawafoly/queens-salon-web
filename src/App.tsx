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
import Checkout from "./pages/Checkout";
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
import EmployeePortal from "./pages/EmployeePortal";

import Pay from "./pages/Pay";
import PaymentCallback from "./pages/PaymentCallback";

/* ================================
   Types & Helpers
================================ */
type UiRole = "owner" | "admin" | "reception" | "staff" | "client" | "guest";

const KNOWN_ROLES: UiRole[] = [
  "owner",
  "admin",
  "reception",
  "staff",
  "client",
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
  return (
    role === "owner" ||
    role === "admin" ||
    role === "reception" ||
    role === "staff"
  );
}

function getNameFromStorage(): string {
  // أولوية الاسم: user_profile_v1 ثم userName
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
    // أول تشغيل
    readWelcomeFromStorage();
    setUserRole(getRoleFromStorage());
    setUserName(getNameFromStorage());

    // بعد تسجيل الدخول / الخروج
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
    if (!isDashboardRole(role)) return <Navigate to="/login" replace />;
    return <>{children}</>;
  };

  const ProfileGuard = ({ children }: { children: React.ReactNode }) => {
    const role = getRoleFromStorage();
    if (role === "guest") return <Navigate to="/login" replace />;
    return <>{children}</>;
  };

  return (
    <div className="app">
      {/* نخفي Navbar داخل الداشبورد */}
      {!isInDashboard && <Navbar />}

      <main className="main-content">
        <ScrollToTop />

        <Routes>
          {/* Public */}
          <Route path="/" element={<Home />} />
          <Route path="/services" element={<Services />} />
          <Route path="/about" element={<About />} />
          <Route path="/booking" element={<Booking />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/success" element={<Success />} />
          <Route path="/offers" element={<Offers />} />
          <Route path="/reviews" element={<Reviews />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/login" element={<Login />} />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/employee" element={<EmployeePortal />} />

          {/* Track */}
          <Route path="/track" element={<Track />} />
          <Route path="/track/:trackId" element={<Track />} />

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

          {/* ✅ مهم: أي /settings يروح للداشبورد */}
          <Route
            path="/settings"
            element={<Navigate to="/dashboard/settings" replace />}
          />

          {/* Payments */}
          <Route path="/pay" element={<Pay />} />
          <Route path="/payment-callback" element={<PaymentCallback />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <Footer />
      <ChatBot />

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
