import { NavLink } from "react-router-dom";
import {
  FiCalendar,
  FiGrid,
  FiHome,
  FiSearch,
  FiTag,
} from "react-icons/fi";

import "../styles/MobileBottomNav.css";

const navigationItems = [
  {
    to: "/",
    label: "الرئيسية",
    icon: FiHome,
    end: true,
  },
  {
    to: "/services",
    label: "الخدمات",
    icon: FiGrid,
  },
  {
    to: "/booking",
    label: "احجزي",
    icon: FiCalendar,
    primary: true,
  },
  {
    to: "/offers",
    label: "العروض",
    icon: FiTag,
  },
  {
    to: "/track",
    label: "تتبع",
    icon: FiSearch,
  },
];

export default function MobileBottomNav() {
  return (
    <nav
      className="mobile-bottom-nav"
      aria-label="التنقل الرئيسي"
    >
      <div className="mobile-bottom-nav__inner">
        {navigationItems.map((item) => {
          const Icon = item.icon;

          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                [
                  "mobile-bottom-nav__item",
                  item.primary
                    ? "mobile-bottom-nav__item--primary"
                    : "",
                  isActive
                    ? "mobile-bottom-nav__item--active"
                    : "",
                ]
                  .filter(Boolean)
                  .join(" ")
              }
            >
              <span className="mobile-bottom-nav__icon">
                <Icon aria-hidden="true" />
              </span>

              <span className="mobile-bottom-nav__label">
                {item.label}
              </span>
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
