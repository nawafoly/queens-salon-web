import React from "react";
import logo from "../assets/images/ssunnamed.png";

/**
 * Props for the LoadingBrand component.
 */
type Props = {
  text?: string;
  small?: boolean;
  fullScreen?: boolean;
};

/**
 * LoadingBrand Component
 * مكون شاشة التحميل المطور مع الحفاظ على الهيكل الأصلي وإضافة تحسينات تقنية.
 */
export default function LoadingBrand({
  text = "جاري التحميل...",
  small = false,
  fullScreen = false,
}: Props) {
  // دمج الفئات (Classes) بناءً على الخصائص (Props)
  const containerClasses = [
    "lb-root",
    small ? "is-small" : "",
    fullScreen ? "is-fullscreen" : "",
  ].filter(Boolean).join(" ");

  return (
    <div className={containerClasses} aria-live="polite" aria-busy="true">
      <div className="lb-content">
        <div className="lb-logo-container">
          <img
            src={logo}
            alt="Malikat Logo"
            className="lb-logo"
            draggable={false}
            loading="eager"
          />
          {/* حلقة تحميل اختيارية يمكن تفعيلها عبر CSS */}
          <div className="lb-loader-ring"></div>
        </div>

        {text && <div className="lb-text">{text}</div>}
      </div>
    </div>
  );
}
