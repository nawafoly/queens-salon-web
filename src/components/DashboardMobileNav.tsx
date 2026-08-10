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
  faFileLines,
  faFingerprint,
  faHouse,
  faMoneyBillWave,
  faPaperPlane,
  faPercent,
  faStore,
  faTv,
  faUser,
  faUsers,
  faUserShield,
  faUserTie,
  faWallet,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";

import type { AppPermission } from "../helpers/permissions";
import { usePermissions } from "../security/PermissionContext";

type DashboardMobileNavProps = {
  missingExpenseNotesCount: number;
};

type PermissionRule = {
  permission?: AppPermission;
  anyOf?: AppPermission[];
  allOf?: AppPermission[];
};

type NavigationItem = PermissionRule & {
  to: string;
  label: string;
  icon: typeof faHouse;
  primary?: boolean;
};

type MoreItem = NavigationItem & {
  description?: string;
};

export default function DashboardMobileNav({
  missingExpenseNotesCount,
}: DashboardMobileNavProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { hasPermission, hasAnyPermission } = usePermissions();
  const [moreOpen, setMoreOpen] = useState(false);

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

  const canOpenItem = (item: PermissionRule) => {
    if (item.allOf?.length && !item.allOf.every((permission) => hasPermission(permission))) {
      return false;
    }
    if (item.anyOf?.length && !hasAnyPermission(item.anyOf)) {
      return false;
    }
    if (item.permission && !hasPermission(item.permission)) {
      return false;
    }
    return Boolean(item.permission || item.anyOf?.length || item.allOf?.length);
  };

  const primaryItems = useMemo<NavigationItem[]>(() => {
    const items: NavigationItem[] = [
      { to: "/dashboard/bookings", label: "الحجوزات", icon: faCalendarAlt, permission: "bookings.view" },
      { to: "/dashboard/income", label: "الإيرادات", icon: faWallet, permission: "income.view" },
      { to: "/dashboard/expenses", label: "المصروفات", icon: faMoneyBillWave, permission: "expenses.view", primary: true },
      { to: "/dashboard/reports", label: "التقارير", icon: faChartPie, permission: "reports.view" },
    ];
    return items.filter(canOpenItem);
  }, [hasPermission, hasAnyPermission]);

  const moreItems = useMemo<MoreItem[]>(() => {
    const items: MoreItem[] = [
      {
        to: "/dashboard/overview",
        label: "نظرة عامة",
        description: "ملخص لوحة التشغيل",
        icon: faHouse,
        permission: "workspace.dashboard.view",
      },
      {
        to: "/dashboard/booking-internal",
        label: "الحجز الإداري",
        description: "إنشاء حجز من داخل الإدارة",
        icon: faUserShield,
        permission: "bookings.create",
      },
      {
        to: "/dashboard/day-audit",
        label: "إغلاق اليوم والشفت",
        description: "مراجعة العمليات وإقفال اليوم",
        icon: faWallet,
        permission: "bookings.day_audit.manage",
      },
      {
        to: "/dashboard/tv-queue",
        label: "شاشة الحجوزات TV",
        description: "عرض نداء ومتابعة الحجوزات",
        icon: faTv,
        permission: "bookings.queue_tv.view",
      },
      {
        to: "/dashboard/clients",
        label: "العملاء",
        description: "ملفات العملاء والباقات",
        icon: faUser,
        permission: "clients.view",
      },

      /* الموظفات والموارد البشرية — نفس خريطة صلاحيات السايدبار */
      {
        to: "/dashboard/hr",
        label: "ملخص الموارد البشرية",
        description: "نظرة عامة على شؤون الموظفات",
        icon: faUserShield,
        permission: "employees.view",
      },
      {
        to: "/dashboard/employees",
        label: "إدارة الموظفات",
        description: "الملفات والبيانات الوظيفية",
        icon: faUsers,
        permission: "employees.view",
      },
      {
        to: "/dashboard/requests",
        label: "طلبات الموظفات",
        description: "متابعة الطلبات والقرارات",
        icon: faPaperPlane,
        permission: "employee_requests.view",
      },
      {
        to: "/dashboard/permissions",
        label: "الاستئذانات والإجازات",
        description: "مراجعة الاستئذانات والإجازات",
        icon: faFingerprint,
        permission: "attendance.leaves.manage",
      },
      {
        to: "/dashboard/attendance",
        label: "الحضور والبصمة",
        description: "متابعة البصمات والأجهزة والتنبيهات",
        icon: faFingerprint,
        permission: "attendance.view",
      },
      {
        to: "/dashboard/recruitment-applications",
        label: "طلبات التوظيف",
        description: "مراجعة طلبات التوظيف",
        icon: faUserTie,
        permission: "recruitment.view",
      },
      {
        to: "/dashboard/messages",
        label: "الرسائل الداخلية",
        description: "التواصل الداخلي مع الموظفات",
        icon: faPaperPlane,
        permission: "messages.manage",
      },
      {
        to: "/dashboard/files",
        label: "ملفات الموظفات",
        description: "العقود والمستندات والمرفقات",
        icon: faFileLines,
        permission: "employees.files.view",
      },
      {
        to: "/dashboard/create-staff",
        label: "إنشاء حساب موظفة",
        description: "إضافة حساب موظفة جديد",
        icon: faUserShield,
        allOf: ["admin_accounts.manage", "employees.create"],
      },
      {
        to: "/dashboard/payroll",
        label: "إدارة الرواتب",
        description: "مسيرات الرواتب الشهرية والاعتماد والدفع",
        icon: faMoneyBillWave,
        permission: "payroll.view",
      },
      {
        to: "/dashboard/employee-targets",
        label: "تارقت الموظفات",
        description: "متابعة المبيعات المؤهلة والشرائح وبونص الرواتب",
        icon: faChartPie,
        anyOf: ["targets.view", "targets.view_all", "payroll.view"],
      },
      {
        to: "/dashboard/staff-performance",
        label: "أداء الموظفات",
        description: "تحليل أداء ومبيعات الموظفات",
        icon: faChartLine,
        permission: "staffPerformance.view",
      },

      {
        to: "/dashboard/partners",
        label: "الشريكات والمساحات",
        description: "إدارة المستأجرات ومقاعد العمل",
        icon: faStore,
        permission: "partners.manage",
      },
      { to: "/dashboard/offers", label: "العروض والكوبونات", icon: faPercent, permission: "offers.manage" },
      { to: "/dashboard/logs", label: "سجل الحركات", icon: faClockRotateLeft, permission: "logs.view" },
      { to: "/dashboard/loyalty", label: "الولاء VIP", icon: faChartPie, permission: "clients.loyalty.manage" },
      { to: "/dashboard/admin-profile", label: "الملف الشخصي", icon: faUser, permission: "workspace.dashboard.view" },
      { to: "/dashboard/settings", label: "الإعدادات الأساسية", icon: faCog, permission: "settings.general.manage" },
      { to: "/dashboard/settings/bookings", label: "إعدادات الحجوزات", icon: faCalendarAlt, permission: "settings.booking.manage" },
      { to: "/dashboard/settings/catalog", label: "إدارة الكتالوج", icon: faPercent, permission: "catalog.manage" },
      {
        to: "/dashboard/settings/users",
        label: "إدارة الحسابات",
        icon: faUserShield,
        anyOf: ["admin_accounts.view", "admin_accounts.manage"],
      },
      { to: "/dashboard/settings/contact", label: "محتوى الموقع", icon: faHouse, permission: "settings.content.manage" },
      { to: "/dashboard/settings/attendance", label: "إعدادات البصمة والنطاقات", icon: faCog, permission: "attendance.settings.manage" },
    ];

    return items
      .filter(canOpenItem)
      .filter((item) => !primaryItems.some((primary) => primary.to === item.to))
      .map((item) =>
        item.to === "/dashboard/expenses" && missingExpenseNotesCount > 0
          ? { ...item, label: `المصروفات (${missingExpenseNotesCount})` }
          : item
      );
  }, [hasPermission, hasAnyPermission, missingExpenseNotesCount, primaryItems]);

  const isMoreActive = moreItems.some(
    (item) => item.to !== "/" && location.pathname.startsWith(item.to)
  );

  if (!primaryItems.length && !moreItems.length) return null;

  return (
    <>
      <nav className="dashboard-mobile-bottom-nav" aria-label="تنقل لوحة التحكم">
        {primaryItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              `dashboard-mobile-bottom-nav__item ${item.primary ? "dashboard-mobile-bottom-nav__item--primary" : ""} ${
                isActive ? "is-active" : ""
              }`
            }
          >
            {item.primary ? (
              <span className="dashboard-mobile-bottom-nav__primary-icon">
                <FontAwesomeIcon icon={item.icon} />
              </span>
            ) : (
              <FontAwesomeIcon icon={item.icon} />
            )}
            <span>{item.label}</span>
          </NavLink>
        ))}

        {moreItems.length ? (
          <button
            type="button"
            className={`dashboard-mobile-bottom-nav__item ${moreOpen || isMoreActive ? "is-active" : ""}`}
            onClick={() => setMoreOpen(true)}
            aria-expanded={moreOpen}
          >
            <FontAwesomeIcon icon={faBars} />
            <span>المزيد</span>
          </button>
        ) : null}
      </nav>

      {moreOpen ? (
        <div
          className="dashboard-mobile-more-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setMoreOpen(false);
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
                  <p>تظهر هنا كل الأقسام التي تسمح بها صلاحيات حسابك.</p>
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
                  key={`${item.to}:${item.label}`}
                  type="button"
                  className="dashboard-mobile-more-card"
                  onClick={() => {
                    setMoreOpen(false);
                    navigate(item.to);
                  }}
                >
                  <span className="dashboard-mobile-more-card__icon">
                    <FontAwesomeIcon icon={item.icon} />
                  </span>
                  <span className="dashboard-mobile-more-card__copy">
                    <strong>{item.label}</strong>
                    {item.description ? <small>{item.description}</small> : null}
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
