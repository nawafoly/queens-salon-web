import "../styles/LoadingBrand.css";
import logo from "../assets/images/ssunnamed1.png"; // عدل الاسم إذا مختلف

type Props = {
  text?: string;
  small?: boolean;
};

export default function LoadingBrand({
  text = "جاري التحميل...",
  small,
}: Props) {
  return (
    <div className={`lb-root ${small ? "is-small" : ""}`}>
      <div className="lb-content">
        <img
          src={logo}
          alt="Malikat"
          className="lb-logo"
          draggable={false}
        />

        <div className="lb-text">{text}</div>
      </div>
    </div>
  );
}
