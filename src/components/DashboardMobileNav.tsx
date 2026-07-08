import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBars,
  faCalendarAlt,
  faChartPie,
  faClockRotateLeft,
  faCog,
  faFingerprint,
  faHouse,
  faMoneyBillWave,
  faPercent,
  faTv,
  faUser,
  faUsers,
  faUserShield,
  faWallet,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";

type DashboardMobileNavProps = {
  hasAdminPower: boolean;
  isReception: boolean;
  isStaff: boolean;
  canManageAdminUsers: boolean;
  allowStaffViewClients: boolean;
  missingExpenseNotesCount: number;
};

type MoreItem = {
  to?: string;
  label: string;
  description?: string;
  icon: typeof faHouse;
  danger?: boolean;
  action?: () => void;
};

export default function DashboardMobileNav({
  hasAdminPower,
  isReception,
  isStaff,
  canManageAdminUsers,
  allowStaffViewClients,
  missingExpenseNotesCount,
}: DashboardMobileNavProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!moreOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };

    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [moreOpen]);

  const canViewClients =
    hasAdminPower || (isReception && allowStaffViewClients);

  const moreItems = useMemo<MoreItem[]>(() => {
    const items: MoreItem[] = [];

    if (hasAdminPower || isReception) {
      items.push(
        {
          to: "/dashboard/booking-internal",
          label: "الحجز الإداري",
          description: "إنشاء حجز من داخل الإدارة",
          icon: faUserShield,
        },
        {
          to: "/dashboard/day-audit",
          label: "إغلاق اليوم والشفت",
          description: "مراجعة العمليات وإقفال اليوم",
          icon: faWallet,
        },
        {
          to: "/dashboard/tv-queue",
          label: "شاشة الحجوزات TV",
          description: "عرض نداء ومتابعة الحجوزات",
          icon: faTv,
        }
      );
    }

    if (hasAdminPower) {
      items.push(
        {
          to: "/dashboard/offers",
          label: "العروض والكوبونات",
          icon: faPercent,
        },
        {
          to: "/dashboard/reports",
          label: "التقارير",
          icon: faChartPie,
        },
        {
          to: "/dashboard/income",
          label: "الإيرادات",
          icon: faWallet,
        },
        {
          to: "/dashboard/expenses",
          label:
            missingExpenseNotesCount > 0
              ? `المصروفات (${missingExpenseNotesCount})`
              : "المصروفات",
          icon: faMoneyBillWave,
        },
        {
          to: "/dashboard/logs",
          label: "سجل الحركات",
          icon: faClockRotateLeft,
        },
        {
          to: "/dashboard/loyalty",
          label: "الولاء VIP",
          icon: faChartPie,
        },
        {
          to: "/dashboard/admin-profile",
          label: "الملف الشخصي",
          icon: faUser,
        },
        {
          to: "/dashboard/settings",
          label: "الإعدادات الأساسية",
          icon: faCog,
        },
        {
          to: "/dashboard/settings/bookings",
          label: "إعدادات الحجوزات",
          icon: faCalendarAlt,
        },
        {
          to: "/dashboard/settings/catalog",
          label: "إدارة الكتالوج",
          icon: faPercent,
        }
      );

      if (canManageAdminUsers) {
        items.push({
          to: "/dashboard/settings/users",
          label: "إدارة الحسابات",
          icon: faUserShield,
        });
      }

      items.push(
        {
          to: "/dashboard/settings/contact",
          label: "محتوى الموقع",
          icon: faHouse,
        },
        {
          to: "/dashboard/settings/attendance",
          label: "الحضور والبصمة",
          icon: faFingerprint,
        }
      );
    }

    return items;
  }, [
    allowStaffViewClients,
    canManageAdminUsers,
    hasAdminPower,
    isReception,
    isStaff,
    missingExpenseNotesCount,
  ]);

  const isMoreActive =
    moreItems.some(
      (item) =>
        item.to &&
        item.to !== "/" &&
        location.pathname.startsWith(item.to)
    ) &&
    !location.pathname.startsWith("/dashboard/bookings") &&
    !location.pathname.startsWith("/dashboard/income") &&
    !location.pathname.startsWith("/dashboard/expenses") &&
    !location.pathname.startsWith("/dashboard/reports");

  return (
    <>
      <nav
        className="dashboard-mobile-bottom-nav"
        aria-label="تنقل لوحة التحكم"
      >
        <NavLink
          to="/dashboard/bookings"
          className={({ isActive }) =>
            `dashboard-mobile-bottom-nav__item ${
              isActive ? "is-active" : ""
            }`
          }
        >
          <FontAwesomeIcon icon={faCalendarAlt} />
          <span>الحجوزات</span>
        </NavLink>

        <NavLink
          to="/dashboard/income"
          className={({ isActive }) =>
            `dashboard-mobile-bottom-nav__item ${
              isActive ? "is-active" : ""
            }`
          }
        >
          <FontAwesomeIcon icon={faWallet} />
          <span>الإيرادات</span>
        </NavLink>

        <NavLink
          to="/dashboard/expenses"
          className={({ isActive }) =>
            `dashboard-mobile-bottom-nav__item dashboard-mobile-bottom-nav__item--primary ${
              isActive ? "is-active" : ""
            }`
          }
        >
          <span className="dashboard-mobile-bottom-nav__primary-icon">
            <FontAwesomeIcon icon={faMoneyBillWave} />
          </span>
          <span>المصروفات</span>
        </NavLink>

        <NavLink
          to="/dashboard/reports"
          className={({ isActive }) =>
            `dashboard-mobile-bottom-nav__item ${
              isActive ? "is-active" : ""
            }`
          }
        >
          <FontAwesomeIcon icon={faChartPie} />
          <span>التقارير</span>
        </NavLink>

        <button
          type="button"
          className={`dashboard-mobile-bottom-nav__item ${
            moreOpen || isMoreActive ? "is-active" : ""
          }`}
          onClick={() => setMoreOpen(true)}
          aria-expanded={moreOpen}
        >
          <FontAwesomeIcon icon={faBars} />
          <span>المزيد</span>
        </button>
      </nav>
      {moreOpen ? (
        <div
          className="dashboard-mobile-more-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setMoreOpen(false);
            }
          }}
        >
          <section
            className="dashboard-mobile-more-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="المزيد من أقسام لوحة التحكم"
          >
            <header className="dashboard-mobile-more-header">
              <div className="dashboard-mobile-more-header__top">
                <div className="dashboard-mobile-more-header__title">
                  <span>القائمة الإدارية</span>
                  <h2>المزيد</h2>
                  <p>الإدارة والتقارير والإعدادات في مكان واحد.</p>
                </div>

                <button
                  type="button"
                  className="dashboard-mobile-more-header__close"
                  onClick={() => setMoreOpen(false)}
                  aria-label="إغلاق"
                >
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              </div>

            </header>

            <div className="dashboard-mobile-more-grid">
              {moreItems.map((item) => (
                <button
                  key={`${item.label}:${item.to || "action"}`}
                  type="button"
                  className={`dashboard-mobile-more-card ${
                    item.danger ? "is-danger" : ""
                  }`}
                  onClick={() => {
                    setMoreOpen(false);

                    if (item.action) {
                      item.action();
                      return;
                    }

                    if (item.to) navigate(item.to);
                  }}
                >
                  <span className="dashboard-mobile-more-card__icon">
                    <FontAwesomeIcon icon={item.icon} />
                  </span>

                  <span className="dashboard-mobile-more-card__content">
                    <strong>{item.label}</strong>
                    {item.description ? (
                      <small>{item.description}</small>
                    ) : null}
                  </span>

                  <span
                    className="dashboard-mobile-more-card__arrow"
                    aria-hidden="true"
                  >
                    ‹
                  </span>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}


