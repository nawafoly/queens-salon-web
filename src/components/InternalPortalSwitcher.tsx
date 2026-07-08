import { NavLink, useLocation } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faRightFromBracket,
  faTableColumns,
  faUserShield,
  faUserTie,
} from "@fortawesome/free-solid-svg-icons";

import "../styles/InternalPortalSwitcher.css";

type InternalPortalSwitcherProps = {
  canOpenDashboard: boolean;
  canOpenHr: boolean;
  canOpenEmployee: boolean;
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
  canOpenEmployee,
  loggingOut = false,
  onLogout,
  className,
}: InternalPortalSwitcherProps) {
  const location = useLocation();
  const pathname = location.pathname;
  const isDashboardArea = pathname.startsWith("/dashboard");
  const isHrArea = pathname.startsWith("/admin");
  const isEmployeeArea = pathname.startsWith("/employee");

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
          to="/admin/overview"
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

      {canOpenEmployee && !isEmployeeArea ? (
        <NavLink
          to="/employee/profile"
          className={() =>
            joinClassNames(
              "internal-portal-switcher__item",
              "internal-portal-switcher__item--employee",
              isEmployeeArea && "is-current"
            )
          }
          aria-label="فتح بروفايل الموظف"
          title="بروفايل الموظف"
        >
          <FontAwesomeIcon icon={faUserTie} />
          <span>البروفايل</span>
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
