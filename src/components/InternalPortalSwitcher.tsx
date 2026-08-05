import { NavLink, useLocation } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faRightFromBracket,
  faTableColumns,
  faUserShield,
} from "@fortawesome/free-solid-svg-icons";

import "../styles/InternalPortalSwitcher.css";

const DASHBOARD_HR_SECTIONS = [
  "hr",
  "requests",
  "employees",
  "permissions",
  "recruitment-applications",
  "messages",
  "files",
  "create-staff",
];

type InternalPortalSwitcherProps = {
  canOpenDashboard: boolean;
  canOpenHr: boolean;
  loggingOut?: boolean;
  onLogout: () => void | Promise<void>;
  className?: string;
};

function joinClassNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export default function InternalPortalSwitcher({
  canOpenDashboard,
  canOpenHr,
  loggingOut = false,
  onLogout,
  className,
}: InternalPortalSwitcherProps) {
  const location = useLocation();
  const pathname = location.pathname;
  const dashboardSection = pathname.replace(/^\/dashboard\/?/, "").split("/")[0];
  const isHrArea =
    pathname.startsWith("/dashboard") &&
    DASHBOARD_HR_SECTIONS.includes(dashboardSection);
  const isDashboardArea = pathname.startsWith("/dashboard") && !isHrArea;

  return (
    <nav
      className={joinClassNames("internal-portal-switcher", className)}
      aria-label="التنقل بين الأنظمة الداخلية"
    >
      {canOpenDashboard && !isDashboardArea ? (
        <NavLink
          to="/dashboard/overview"
          className={({ isActive }) =>
            joinClassNames(
              "internal-portal-switcher__item",
              "internal-portal-switcher__item--dashboard",
              isActive && "is-current"
            )
          }
          aria-label="فتح لوحة التحكم"
          title="لوحة التحكم"
        >
          <FontAwesomeIcon icon={faTableColumns} />
          <span>لوحة التحكم</span>
        </NavLink>
      ) : null}

      {canOpenHr && !isHrArea ? (
        <NavLink
          to="/dashboard/hr"
          className={() =>
            joinClassNames(
              "internal-portal-switcher__item",
              "internal-portal-switcher__item--hr",
              isHrArea && "is-current"
            )
          }
          aria-label="فتح لوحة الموارد البشرية"
          title="لوحة HR"
        >
          <FontAwesomeIcon icon={faUserShield} />
          <span>HR</span>
        </NavLink>
      ) : null}

      <button
        type="button"
        className="internal-portal-switcher__item internal-portal-switcher__item--logout"
        onClick={() => void onLogout()}
        disabled={loggingOut}
        aria-label="تسجيل الخروج"
        title="تسجيل الخروج"
      >
        <FontAwesomeIcon icon={faRightFromBracket} />
        <span>{loggingOut ? "..." : "خروج"}</span>
      </button>
    </nav>
  );
}
