import { useEffect, useState } from "react";

import heroBg from "../assets/images/malikat_header_v2.png";
import "../styles/Hero.css";

export default function Hero() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
  }, []);

  return (
    <section
      className="heroV2"
      style={{ backgroundImage: `url(${heroBg})` }}
      aria-label="هيدر صالون ملكات"
    >
      <div className="heroV2__overlay" aria-hidden="true" />

      <div className="heroV2__container">
        <div className={`heroV2__content ${isVisible ? "is-visible" : ""}`}>
          <h1 className="heroV2__title">
            مرحباً بكم
            <br />
            في صالون <span className="heroV2__brand">ملكات</span>
          </h1>

          

          <p className="heroV2__desc lead-strong">
            تجربة عناية فاخرة للشعر والبشرة والجسم، بخبرة فريق محترف ولمسة راقية
            تليق بكِ.
          </p>
        </div>
      </div>

      <div className="hero-scroll-indicator">
        <span className="scroll-text">اسحبي للأسفل</span>
        <div className="scroll-arrow">
          <span />
          <span />
          <span />
        </div>
      </div>
    </section>
  );
}
