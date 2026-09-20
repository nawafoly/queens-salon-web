import type { ReactNode } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faChevronLeft,
  faChevronRight,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import "../styles/MalikatPortalSidebarTablet.css";
import type { DashboardLanguage } from "../helpers/dashboardLanguage";

type PortalSidebarVariant = "dashboard" | "admin" | "employee";

type MalikatPortalSidebarV2Props = {
  variant: PortalSidebarVariant;
  logoSrc: string;
  logoAlt?: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  navigation: ReactNode;
  profile?: ReactNode;
  primaryAction?: ReactNode;
  footer?: ReactNode;
  className?: string;
  ariaLabel?: string;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  loading?: boolean;
  profileTooltip?: string;
  primaryActionTooltip?: string;
  language?: DashboardLanguage;
};

const variantClasses: Record<
  PortalSidebarVariant,
  {
    outer: string;
    header: string;
    logo: string;
    toggle: string;
    mobileClose?: string;
  }
> = {
  dashboard: {
    outer: "dashboard-sidebar",
    header: "sidebar-header",
    logo: "sidebar-logo",
    toggle: "dash-sidebar-collapse",
    mobileClose: "dash-mobile-close",
  },
  admin: {
    outer: "hr-shell-sidebar",
    header: "hr-sidebar-header",
    logo: "hr-sidebar-logo",
    toggle: "hr-sidebar-collapse",
  },
  employee: {
    outer: "employee-portal-sidebar employee-portal-sidebar--desktop",
    header: "employee-sidebar-header",
    logo: "employee-sidebar-logo",
    toggle: "employee-sidebar-collapse",
  },
};

export default function MalikatPortalSidebarV2({
  variant,
  logoSrc,
  logoAlt = "Malikat",
  collapsed,
  onToggleCollapsed,
  navigation,
  profile,
  primaryAction,
  footer,
  className = "",
  ariaLabel = "التنقل داخل البوابة",
  mobileOpen = false,
  onMobileClose,
  loading = false,
  profileTooltip,
  primaryActionTooltip,
  language = "ar",
}: MalikatPortalSidebarV2Props) {
  const classes = variantClasses[variant];
  const expanded = !collapsed;
  const visibleFooter = variant === "employee" ? null : footer;
  const englishDashboard = variant === "dashboard" && language === "en";
  const collapseLabel = collapsed
    ? englishDashboard ? "Expand menu" : "توسيع القائمة"
    : englishDashboard ? "Collapse menu" : "طي القائمة";

  return (
    <aside
      className={[
        "malikat-portal-sidebar-v2",
        `malikat-portal-sidebar-v2--${variant}`,
        classes.outer,
        collapsed ? "is-collapsed" : "",
        mobileOpen ? "is-open" : "",
        loading ? "is-loading" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      aria-label={ariaLabel}
      data-portal-sidebar={variant}
    >
      {onMobileClose ? (
        <button
          type="button"
          className={`malikat-portal-sidebar-v2__mobile-close ${classes.mobileClose || ""}`}
          onClick={onMobileClose}
          aria-label={englishDashboard ? "Close menu" : "إغلاق القائمة"}
          title={englishDashboard ? "Close" : "إغلاق"}
        >
          <FontAwesomeIcon icon={faXmark} />
        </button>
      ) : null}

      <header className={`malikat-portal-sidebar-v2__header ${classes.header}`}>
        <img
          src={logoSrc}
          alt={logoAlt}
          className={`malikat-portal-sidebar-v2__logo ${classes.logo}`}
        />
        <button
          type="button"
          className={`malikat-portal-sidebar-v2__collapse ${classes.toggle}`}
          onClick={onToggleCollapsed}
          aria-expanded={expanded}
          aria-label={collapseLabel}
          title={collapseLabel}
        >
          <FontAwesomeIcon icon={englishDashboard ? (collapsed ? faChevronRight : faChevronLeft) : (collapsed ? faChevronLeft : faChevronRight)} />
        </button>
      </header>

      {profile ? (
        <div
          className="malikat-portal-sidebar-v2__profile"
          data-sidebar-tooltip={profileTooltip || undefined}
        >
          {profile}
        </div>
      ) : null}

      {primaryAction ? (
        <div
          className="malikat-portal-sidebar-v2__primary-action"
          data-sidebar-tooltip={primaryActionTooltip || undefined}
        >
          {primaryAction}
        </div>
      ) : null}

      <div className="malikat-portal-sidebar-v2__navigation">{navigation}</div>

      {visibleFooter ? (
        <footer className="malikat-portal-sidebar-v2__footer">{visibleFooter}</footer>
      ) : null}
    </aside>
  );
}
