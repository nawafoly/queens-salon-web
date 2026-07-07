import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBars,
  faCalendarAlt,
  faChartLine,
  faChartPie,
  faClockRotateLeft,
  faCog,
  faFingerprint,
  faHouse,
  faMoneyBillWave,
  faPercent,
  faSignOutAlt,
  faTv,
  faUser,
  faUsers,
  faUserShield,
  faUserTie,
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
  onLogout: () => void;
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
  onLogout,
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

    if (isStaff || hasAdminPower || isReception) {
      items.push({
        to: "/employee/overview",
        label: "بوابة الموظف",
        description: "الحضور والطلبات والملف الوظيفي",
        icon: faUserTie,
      });
    }

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
        },
        {
          to: "/admin",
          label: "لوحة HR",
          description: "إدارة الموارد البشرية والموظفات",
          icon: faUserShield,
        }
      );
    }

    items.push(
      {
        to: "/",
        label: "الموقع الرئيسي",
        icon: faHouse,
      },
      {
        label: "تسجيل الخروج",
        icon: faSignOutAlt,
        danger: true,
        action: onLogout,
      }
    );

    return items;
  }, [
    allowStaffViewClients,
    canManageAdminUsers,
    hasAdminPower,
    isReception,
    isStaff,
    missingExpenseNotesCount,
    onLogout,
  ]);

  const isMoreActive =
    moreItems.some(
      (item) =>
        item.to &&
        item.to !== "/" &&
        location.pathname.startsWith(item.to)
    ) &&
    !location.pathname.startsWith("/dashboard/overview") &&
    !location.pathname.startsWith("/dashboard/bookings") &&
    !location.pathname.startsWith("/dashboard/employees") &&
    !location.pathname.startsWith("/dashboard/clients");

  return (
    <>
      <nav
        className="dashboard-mobile-bottom-nav"
        aria-label="تنقل لوحة التحكم"
      >
        <NavLink
          to="/dashboard/overview"
          className={({ isActive }) =>
            `dashboard-mobile-bottom-nav__item ${
              isActive ? "is-active" : ""
            }`
          }
        >
          <FontAwesomeIcon icon={faHouse} />
          <span>الرئيسية</span>
        </NavLink>

        {(hasAdminPower || isReception) && (
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
        )}

        {hasAdminPower && (
          <NavLink
            to="/dashboard/employees"
            className={({ isActive }) =>
              `dashboard-mobile-bottom-nav__item dashboard-mobile-bottom-nav__item--primary ${
                isActive ? "is-active" : ""
              }`
            }
          >
            <span className="dashboard-mobile-bottom-nav__primary-icon">
              <FontAwesomeIcon icon={faUserTie} />
            </span>
            <span>الموظفات</span>
          </NavLink>
        )}

        {canViewClients && (
          <NavLink
            to="/dashboard/clients"
            className={({ isActive }) =>
              `dashboard-mobile-bottom-nav__item ${
                isActive ? "is-active" : ""
              }`
            }
          >
            <FontAwesomeIcon icon={faUsers} />
            <span>العملاء</span>
          </NavLink>
        )}

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
              <div>
                <span>لوحة التحكم</span>
                <h2>المزيد</h2>
                <p>الإدارة والتقارير والإعدادات في مكان واحد.</p>
              </div>

              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="إغلاق"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
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
