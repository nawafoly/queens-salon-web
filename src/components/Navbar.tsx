// src/components/Navbar.tsx
import React, { useState, useEffect, useRef, useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import logoNavbar from "../assets/images/ssunnamed.png";
import "../styles/navbar.css";

// ✅ Firebase logout + Auth watcher
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { auth } from "../services/firebase";

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

const Navbar: React.FC = () => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const [userName, setUserName] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<UiRole>("guest");

  // ✅ Firebase auth
  const [authUser, setAuthUser] = useState<User | null>(null);

  const [hasScrolled, setHasScrolled] = useState(false);

  const location = useLocation();
  const navigate = useNavigate();

  const dropdownRef = useRef<HTMLDivElement>(null);
  const navMenuRef = useRef<HTMLElement>(null);

  // ✅ هل نحن داخل الداشبورد؟
  const isInDashboard = location.pathname.startsWith("/dashboard");

  const syncAuthFromStorage = () => {
    let profile: any = null;
    try {
      profile = JSON.parse(localStorage.getItem("user_profile_v1") || "null");
    } catch {
      profile = null;
    }

    const name =
      (profile?.name ? String(profile.name).trim() : "") ||
      (localStorage.getItem("userName")
        ? String(localStorage.getItem("userName")).trim()
        : "") ||
      (() => {
        try {
          const cu = JSON.parse(localStorage.getItem("currentUser") || "null");
          return cu?.name ? String(cu.name).trim() : "";
        } catch {
          return "";
        }
      })() ||
      null;

    const rawRole =
      (profile?.role ? String(profile.role).trim() : "") ||
      localStorage.getItem("userRole") ||
      "guest";

    const role = normalizeRole(rawRole);

    setUserName(name);
    setUserRole(role);
  };

  // ✅ Watch firebase auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setAuthUser(user);
      syncAuthFromStorage();
      if (!user) setIsDropdownOpen(false);
    });
    return () => unsub();
  }, []);

  // ✅ Listen for authChanged + storage changes
  useEffect(() => {
    syncAuthFromStorage();

    const onAuthChanged = () => syncAuthFromStorage();
    window.addEventListener("authChanged", onAuthChanged);

    const onStorage = () => syncAuthFromStorage();
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener("authChanged", onAuthChanged);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // ✅ مهم جدًا: إغلاق أي منيو/دروب داون عند تغيير الصفحة (هذا يحل “يبقى معلق”)
  useEffect(() => {
    setIsDropdownOpen(false);
    setIsMenuOpen(false);
  }, [location.pathname]);

  // ✅ غلق منيو النافبار داخل الداشبورد
  useEffect(() => {
    if (isInDashboard) setIsMenuOpen(false);
  }, [isInDashboard]);

  // ✅ shadow عند scroll
  useEffect(() => {
    const handleScroll = () => setHasScrolled(window.scrollY > 10);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // ✅ click outside dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ✅ click outside mobile menu
  useEffect(() => {
    const handleNavMenuClickOutside = (e: MouseEvent) => {
      if (
        isMenuOpen &&
        navMenuRef.current &&
        !navMenuRef.current.contains(e.target as Node) &&
        !(e.target instanceof Element && e.target.closest(".navbar-toggler"))
      ) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleNavMenuClickOutside);
    return () =>
      document.removeEventListener("mousedown", handleNavMenuClickOutside);
  }, [isMenuOpen]);

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch {}

    localStorage.removeItem("authToken");
    localStorage.removeItem("userRole");
    localStorage.removeItem("userName");
    localStorage.removeItem("currentUser");
    localStorage.removeItem("auth_user");
    localStorage.removeItem("userUid");
    localStorage.removeItem("showWelcome");
    localStorage.removeItem("userEmail");
    localStorage.removeItem("user_profile_v1");

    setUserName(null);
    setUserRole("guest");
    setIsDropdownOpen(false);

    window.dispatchEvent(new Event("authChanged"));
    navigate("/");
  };

  const navLinks = [
    { path: "/", label: "الرئيسية" },
    { path: "/about", label: "عن المشغل" },
    { path: "/services", label: "الخدمات" },
    { path: "/offers", label: "العروض" },
    { path: "/pricing", label: "الأسعار" },
    { path: "/track", label: "تتبع الحجز" },
    { path: "/contact", label: "تواصل معنا" },
  ];

  const isLoggedIn = !!authUser;

  const isClient = userRole === "client";
  const isStaff = userRole === "staff";
  const isAdmin = userRole === "admin";
  const isOwner = userRole === "owner";
  const isReception = userRole === "reception";

  const isDashboardUser =
    isLoggedIn && (isOwner || isAdmin || isReception || isStaff);

  // ✅ عناصر القائمة التي ستُعرض (مهم جدًا لمنع dropdown الفاضي)
  const dropdownItems = useMemo(() => {
    if (!isLoggedIn) {
      return (
        <>
          <Link to="/login" onClick={() => setIsDropdownOpen(false)}>
            تسجيل الدخول
          </Link>
          <Link to="/terms" onClick={() => setIsDropdownOpen(false)}>
            الشروط والأحكام
          </Link>
          <Link to="/privacy" onClick={() => setIsDropdownOpen(false)}>
            سياسة الخصوصية
          </Link>
          <Link to="/support" onClick={() => setIsDropdownOpen(false)}>
            الدعم
          </Link>
        </>
      );
    }

    // ✅ لو داخل Firebase لكن الرول طلعت guest… لا نخليه فاضي
    if (!isClient && !isDashboardUser) {
      return (
        <>
          <Link to="/profile" onClick={() => setIsDropdownOpen(false)}>
            بيانات العميل
          </Link>
          <button onClick={handleLogout} className="dropdown-logout-btn">
            تسجيل الخروج
          </button>
        </>
      );
    }

    if (isClient) {
      return (
        <>
          <Link to="/profile" onClick={() => setIsDropdownOpen(false)}>
            بيانات العميل
          </Link>
          <button onClick={handleLogout} className="dropdown-logout-btn">
            تسجيل الخروج
          </button>
        </>
      );
    }

    if (isDashboardUser) {
      return (
        <>
          <Link to="/dashboard" onClick={() => setIsDropdownOpen(false)}>
            لوحة التحكم
          </Link>
          <Link to="/profile" onClick={() => setIsDropdownOpen(false)}>
            بيانات العميل
          </Link>
          <button onClick={handleLogout} className="dropdown-logout-btn">
            تسجيل الخروج
          </button>
        </>
      );
    }

    return null;
  }, [isLoggedIn, isClient, isDashboardUser, handleLogout]);

  const hasDropdownContent = !!dropdownItems;

  return (
    <>
      <div className="topbar">
        <div className="topbar-content">
          <span className="lang">🌐 العربية</span>
        </div>
      </div>

      <header className={`navbar ${hasScrolled ? "scrolled" : ""}`}>
        <div className="container">
          <div className="nav-main-group">
            {/* ✅ زر ☰ يظهر فقط خارج الداشبورد */}
            {!isInDashboard && (
              <button
                className={`navbar-toggler ${isMenuOpen ? "open" : ""}`}
                onClick={() => setIsMenuOpen((prev) => !prev)}
                aria-label="Toggle navigation"
              >
                <span className="bar"></span>
                <span className="bar"></span>
                <span className="bar"></span>
              </button>
            )}

            <nav
              ref={navMenuRef}
              className={`navbar-nav ${isMenuOpen ? "open" : ""}`}
            >
              {navLinks.map((link) => (
                <Link
                  key={link.path}
                  to={link.path}
                  onClick={() => setIsMenuOpen(false)}
                  className={location.pathname === link.path ? "active" : ""}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>

          <Link to="/" className="logo-link" onClick={() => setIsMenuOpen(false)}>
            <img src={logoNavbar} alt="Body Salon Logo" className="logo" />
          </Link>

          <div className="profile-container" ref={dropdownRef}>
            <button
              className="user-profile"
              onClick={() => {
                // ✅ لا تفتح dropdown إذا ما فيه عناصر
                if (!hasDropdownContent) return;
                setIsDropdownOpen((prev) => !prev);
                setIsMenuOpen(false);
              }}
            >
              {isLoggedIn ? <>👤 {userName || "الملف الشخصي"}</> : <>تسجيل الدخول</>}
            </button>

            {/* ✅ لا ترسم dropdown إلا إذا: مفتوح + فيه عناصر */}
            {isDropdownOpen && hasDropdownContent && (
              <div className="dropdown-menu">{dropdownItems}</div>
            )}
          </div>
        </div>
      </header>
    </>
  );
};

export default Navbar;
