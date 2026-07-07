import logo from "../assets/images/ssunnamed.png";
import "../styles/LoadingBrand.css";

type Props = {
  text?: string;
  small?: boolean;
  fullScreen?: boolean;
};

export default function LoadingBrand({
  text = "جاري تجهيز مساحة العمل...",
  small = false,
  fullScreen = true,
}: Props) {
  const containerClasses = [
    "lb-root",
    "malikat-session-loader",
    small ? "is-small" : "",
    fullScreen ? "is-fullscreen" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={containerClasses}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={text || "جاري التحميل"}
    >
      <div className="malikat-loader__glow malikat-loader__glow--one" aria-hidden="true" />
      <div className="malikat-loader__glow malikat-loader__glow--two" aria-hidden="true" />

      <div className="malikat-loader__content">
        <div className="malikat-loader__logo-frame">
          <span className="malikat-loader__scan" aria-hidden="true" />

          <img
            src={logo}
            alt="ملكات"
            className="malikat-loader__logo"
            draggable={false}
            loading="eager"
          />
        </div>

        <div className="malikat-loader__copy">
          <strong>ملكات</strong>

          {text ? (
            <span className="malikat-loader__text">
              {text}
            </span>
          ) : null}
        </div>

        <div className="malikat-loader__wave" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>

        <div className="malikat-loader__track" aria-hidden="true">
          <span />
        </div>
      </div>
    </div>
  );
}