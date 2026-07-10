import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faUserTie } from "@fortawesome/free-solid-svg-icons";

import "../styles/DashboardHeader.css";

type DashboardHeaderTheme = "dashboard" | "admin" | "employee";

type DashboardHeaderProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  theme: DashboardHeaderTheme;
  leading?: ReactNode;
  actions?: ReactNode;
  className?: string;
  actionsClassName?: string;
  sticky?: boolean;
  ariaLabel?: string;
  showProfileButton?: boolean;
  profileLabel?: ReactNode;
};

function joinClassNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export default function DashboardHeader({
  title,
  subtitle,
  theme,
  leading,
  actions,
  className,
  actionsClassName,
  sticky = true,
  ariaLabel,
  showProfileButton = true,
  profileLabel = "البروفايل",
}: DashboardHeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const isProfilePage = location.pathname === "/employee/overview";

  const handleProfileClick = () => {
    if (!isProfilePage) {
      navigate("/employee/overview");
    }
  };

  return (
    <header
      className={joinClassNames(
        "dashboard-header",
        `dashboard-header--${theme}`,
        sticky && "dashboard-header--sticky",
        className
      )}
      aria-label={ariaLabel}
    >
      <div className="dashboard-header__primary dash-topbar-left">
        {leading ? (
          <div className="dashboard-header__leading">{leading}</div>
        ) : null}

        <div className="dashboard-header__copy dash-topbar-title">
          <h1>{title}</h1>
          {subtitle ? <span>{subtitle}</span> : null}
        </div>
      </div>

      <div className="dashboard-header__meta dash-topbar-right">
        {showProfileButton || actions ? (
          <div
            className={joinClassNames(
              "dashboard-header__actions",
              actionsClassName
            )}
          >
            {showProfileButton ? (
              <button
                type="button"
                className="dashboard-header__profile-button internal-portal-switcher__item"
                onClick={handleProfileClick}
                aria-label="فتح الملف الشخصي"
                aria-current={isProfilePage ? "page" : undefined}
                title="البروفايل"
              >
                <FontAwesomeIcon icon={faUserTie} />
                <span>{profileLabel}</span>
              </button>
            ) : null}

            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}
