import {
  Children,
  Fragment,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faTableColumns, faUserTie } from "@fortawesome/free-solid-svg-icons";

import EmployeeNotificationBellMenu from "./EmployeeNotificationBellMenu";
import AdminUnifiedNotificationBell from "./AdminUnifiedNotificationBell";
import { usePermissions } from "../security/PermissionContext";
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
  profileAriaLabel?: string;
};

function joinClassNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function elementClassName(node: ReactNode) {
  if (!isValidElement(node)) return "";
  return typeof (node.props as { className?: unknown }).className === "string"
    ? String((node.props as { className?: string }).className)
    : "";
}

function isLegacyEmployeeNotificationAction(node: ReactNode) {
  return elementClassName(node)
    .split(/\s+/)
    .includes("employee-header-notification");
}

function removeLegacyEmployeeNotificationAction(node: ReactNode): ReactNode {
  if (!isValidElement(node)) return node;
  if (isLegacyEmployeeNotificationAction(node)) return null;

  if (node.type === Fragment) {
    const element = node as ReactElement<{ children?: ReactNode }>;
    return cloneElement(
      element,
      undefined,
      Children.map(element.props.children, removeLegacyEmployeeNotificationAction)
    );
  }

  return node;
}

function extractEmployeeNotificationUnreadCount(node: ReactNode): number {
  if (!isValidElement(node)) return 0;
  const element = node as ReactElement<{ className?: string; children?: ReactNode }>;
  const classes = String(element.props.className || "").split(/\s+/);

  if (classes.includes("employee-header-notification__badge")) {
    const raw = Children.toArray(element.props.children).join("").trim();
    const count = Number(raw.replace(/[^0-9]/g, ""));
    return Number.isFinite(count) ? count : 0;
  }

  return Children.toArray(element.props.children).reduce<number>(
    (max, child) => Math.max(max, extractEmployeeNotificationUnreadCount(child)),
    0
  );
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
  profileAriaLabel = "فتح الملف الشخصي",
}: DashboardHeaderProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { hasPermission } = usePermissions();
  const isEmployeePortal = location.pathname.startsWith("/employee");
  const isProfilePage = location.pathname === "/employee/overview";
  const isEmployeeMobileShell =
    theme === "employee" &&
    isEmployeePortal &&
    String(className || "")
      .split(/\s+/)
      .includes("dashboard-header--mobile-shell");
  const shouldShowDashboardReturn =
    isEmployeeMobileShell && hasPermission("workspace.dashboard.view");
  const shouldShowProfileButton = showProfileButton && !isEmployeePortal;
  const shouldUseEmployeeNotificationMenu = theme === "employee" && isEmployeePortal;
  const shouldUseDashboardNotificationBell =
    theme === "dashboard" &&
    location.pathname.startsWith("/dashboard") &&
    !location.pathname.startsWith("/dashboard/tv-queue");
  const employeeUnreadCount = shouldUseEmployeeNotificationMenu
    ? extractEmployeeNotificationUnreadCount(actions)
    : 0;
  const visibleActions = shouldUseEmployeeNotificationMenu
    ? removeLegacyEmployeeNotificationAction(actions)
    : actions;

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
        {shouldShowProfileButton || shouldShowDashboardReturn || visibleActions || shouldUseEmployeeNotificationMenu || shouldUseDashboardNotificationBell ? (
          <div
            className={joinClassNames(
              "dashboard-header__actions",
              actionsClassName
            )}
          >
            {shouldShowProfileButton ? (
              <button
                type="button"
                className="dashboard-header__profile-button internal-portal-switcher__item"
                onClick={handleProfileClick}
                aria-label={profileAriaLabel}
                aria-current={isProfilePage ? "page" : undefined}
                title={typeof profileLabel === "string" ? profileLabel : profileAriaLabel}
              >
                <FontAwesomeIcon icon={faUserTie} />
                <span>{profileLabel}</span>
              </button>
            ) : null}

            {shouldShowDashboardReturn ? (
              <button
                type="button"
                className="employee-app-topbar__action employee-app-topbar__action--dashboard"
                onClick={() => navigate("/dashboard/overview")}
                aria-label="العودة إلى لوحة التحكم"
                title="لوحة التحكم"
              >
                <FontAwesomeIcon icon={faTableColumns} />
              </button>
            ) : null}

            {shouldUseDashboardNotificationBell ? (
              <AdminUnifiedNotificationBell />
            ) : null}
            {visibleActions}
            {shouldUseEmployeeNotificationMenu ? (
              <EmployeeNotificationBellMenu initialUnreadCount={employeeUnreadCount} />
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}
