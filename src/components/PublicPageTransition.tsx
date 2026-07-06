import type { ReactNode } from "react";
import { useLocation, useNavigationType } from "react-router-dom";

import "../styles/PublicPageTransition.css";

type PublicPageTransitionProps = {
  children: ReactNode;
};

export default function PublicPageTransition({
  children,
}: PublicPageTransitionProps) {
  const location = useLocation();
  const navigationType = useNavigationType();

  const transitionDirection =
    navigationType === "POP"
      ? "back"
      : navigationType === "REPLACE"
        ? "replace"
        : "forward";

  return (
    <div className="public-page-transition-host">
      <div
        key={location.pathname}
        className={[
          "public-page-transition",
          `public-page-transition--${transitionDirection}`,
        ].join(" ")}
      >
        {children}
      </div>
    </div>
  );
}
