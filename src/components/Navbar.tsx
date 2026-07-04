// src/components/Navbar.tsx
import React, { useState, useEffect, useRef, useMemo } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import logoNavbar from "../assets/images/ssunnamed.png";
import UserIcon from "./icons/UserIcon";
import { resolveDashboardLandingPath } from "../helpers/routePaths";

import { type User as FirebaseUser } from "firebase/auth";
import { logoutFirebase } from "../services/authService";

type UiRole = "owner" | "admin" | "hr" | "reception" | "staff" | "client" | "pending" | "guest";
const KNOWN_ROLES: UiRole[] = ["owner", "admin", "hr", "reception", "staff", "client", "pending", "guest"];

function normalizeRole(role: any): UiRole {
  const r = String(role || "").toLowerCase().trim();
  if (r === "administrator") return "admin";
  if (r === "employee") return "staff";
  if (r === "receptionist" || r === "frontdesk" || r === "desk") return "reception";
  if (KNOWN_ROLES.includes(r as UiRole)) return r as UiRole;
  return "guest";
}

function isInternalPortalRole(role: UiRole) {
  return role === "owner" || role === "admin" || role === "hr" || role === "reception" || role === "staff";
}

type NavbarProps = {
  authUser: FirebaseUser | null;
  currentRole: UiRole;
  currentUserName: string;
};

const Navbar: React.FC<NavbarProps> = ({ authUser, currentRole, currentUserName }) => {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

  const [userName, setUserName] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<UiRole>("guest");

  // ✅ scroll states
  const [hasScrolled, setHasScrolled] = useState(false);
  const [isHidden, setIsHidden] = useState(false);
  const lastScrollY = useRef(0);
  const lastScrollTarget = useRef<EventTarget | "page" | null>(null);

  const location = useLocation();
  const navigate = useNavigate();

  const dropdownRef = useRef<HTMLDivElement>(null);
  const navMenuRef = useRef<HTMLElement>(null);

  const isInDashboard = location.pathname.startsWith("/dashboard");
  const isChatPage = location.pathname.startsWith("/chat");

  useEffect(() => {
    const roleNow = normalizeRole(currentRole);
    const nameNow =
      String(currentUserName || "").trim() || String(authUser?.displayName || "").trim() || null;

    setUserRole(roleNow);
    setUserName(nameNow);
    if (!authUser) setIsDropdownOpen(false);
  }, [authUser, currentRole, currentUserName]);

  useEffect(() => {
    setIsDropdownOpen(false);
    setIsMenuOpen(false);
    setIsHidden(false);
  }, [location.pathname]);

  useEffect(() => {
    if (isInDashboard) setIsMenuOpen(false);
  }, [isInDashboard]);

  // ✅ track scroll for "scrolled" styling + hide/show on direction
  useEffect(() => {
    let ticking = false;

    const getScrollTop = (target?: EventTarget | null) => {
      if (target instanceof Element) {
        const el = target as HTMLElement;
        const style = window.getComputedStyle(el);
        const overflowY = style.overflowY;
        const isScrollable =
          (overflowY === "auto" || overflowY === "scroll") &&
          el.scrollHeight > el.clientHeight;
        if (isScrollable) return el.scrollTop;
      }

      const scroller = document.scrollingElement || document.documentElement;
      return scroller?.scrollTop ?? window.scrollY;
    };

    const normalizeTarget = (target?: EventTarget | null) => {
      if (!target) return "page";
      if (target === window) return "page";
      if (target === document || target === document.documentElement || target === document.body) {
        return "page";
      }
      return target;
    };

    const onScroll = (e?: Event) => {
      if (ticking) return;
      ticking = true;

      requestAnimationFrame(() => {
        const target = normalizeTarget(e?.target ?? null);
        const y = target === "page" ? getScrollTop(null) : getScrollTop(target);
        setHasScrolled(y > 10);

        // Keep navbar always visible on chat page.
        if (isChatPage) {
          setIsHidden(false);
          lastScrollTarget.current = target;
          lastScrollY.current = y;
          ticking = false;
          return;
        }

        if (target !== lastScrollTarget.current) {
          lastScrollTarget.current = target;
          lastScrollY.current = y;
          ticking = false;
          return;
        }

        const delta = y - lastScrollY.current;

        if (y <= 20) {
          setIsHidden(false);
        } else if (delta > 1) {
          setIsHidden(true);
        } else if (delta < -1) {
          setIsHidden(false);
        }

        lastScrollY.current = y;
        ticking = false;
      });
    };

    lastScrollY.current = getScrollTop(null);
    lastScrollTarget.current = null;
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("scroll", onScroll, true);
    };
  }, [isChatPage]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

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
    return () => document.removeEventListener("mousedown", handleNavMenuClickOutside);
  }, [isMenuOpen]);

  const handleLogout = async () => {
    try {
      await logoutFirebase();
    } catch {}

    setUserName(null);
    setUserRole("guest");
    setIsDropdownOpen(false);

    window.dispatchEvent(new Event("authChanged"));
    navigate(isInternalPortalRole(userRole) ? "/hr" : "/", { replace: true });
  };

  const navLinks = [
    { path: "/", label: "الرئيسية" },
    { path: "/about", label: "عن المشغل" },
    { path: "/booking", label: "احجزي" },
    { path: "/services", label: "الخدمات" },
    { path: "/offers", label: "العروض" },
    // { path: "/pricing", label: "الأسعار" },
    { path: "/track", label: "تتبع الحجز" },
    { path: "/contact", label: "تواصل معنا" },
  ];

  const isLoggedIn = !!authUser;

  const isClient = userRole === "client";
  const isStaff = userRole === "staff";
  const isAdmin = userRole === "admin";
  const isHr = userRole === "hr";
  const isOwner = userRole === "owner";
  const isReception = userRole === "reception";

  const isDashboardUser = isLoggedIn && (isOwner || isAdmin || isHr || isReception || isStaff);
  const dashboardPath = resolveDashboardLandingPath(userRole);

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

    if (isStaff) {
      return (
        <>
          <Link to="/employee/overview" onClick={() => setIsDropdownOpen(false)}>
            ط¨ظˆط§ط¨ط© ط§ظ„ظ…ظˆط¸ظپ
          </Link>
          <button onClick={handleLogout} className="dropdown-logout-btn">
            طھط³ط¬ظٹظ„ ط§ظ„ط®ط±ظˆط¬
          </button>
        </>
      );
    }

    if (isDashboardUser) {
      return (
        <>
          <Link to="/employee/overview" onClick={() => setIsDropdownOpen(false)}>
            بوابة الموظف
          </Link>

          <Link to={dashboardPath} onClick={() => setIsDropdownOpen(false)}>
            {isHr ? "لوحة HR" : "لوحة التحكم"}
          </Link>

          {(isOwner || isAdmin) && (
            <Link to="/admin" onClick={() => setIsDropdownOpen(false)}>
              لوحة HR
            </Link>
          )}

          <button onClick={handleLogout} className="dropdown-logout-btn">
            تسجيل الخروج
          </button>
        </>
      );
    }

    return null;
  }, [isLoggedIn, isClient, isStaff, isDashboardUser, dashboardPath, isHr, isOwner, isAdmin, handleLogout]);

  const hasDropdownContent = !!dropdownItems;

  return (
    <header
      className={`navbar ${hasScrolled ? "scrolled" : ""} ${isHidden && !isChatPage ? "is-hidden" : ""}`}
    >
      <div className="container">
        <div className="nav-main-group">
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

          <nav ref={navMenuRef} className={`navbar-nav ${isMenuOpen ? "open" : ""}`}>
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
          <img src={logoNavbar} alt="Body Salon Logo" className="navbar-logo" />
        </Link>

        <div className="profile-container" ref={dropdownRef}>
          <button
            className="user-profile"
            onClick={() => {
              if (!hasDropdownContent) return;
              setIsDropdownOpen((prev) => !prev);
              setIsMenuOpen(false);
            }}
          >
            <UserIcon />
            <span className="user-profile__text">
              {isLoggedIn ? (userName || "الملف الشخصي") : "تسجيل الدخول"}
            </span>
          </button>

          {isDropdownOpen && hasDropdownContent && <div className="dropdown-menu">{dropdownItems}</div>}
        </div>
      </div>
    </header>
  );
};

export default Navbar;
