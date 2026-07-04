import { useEffect, useMemo, useState } from "react";

import heroBg from "../assets/images/malikat_header_v2.png";

// ✅ تاريخ التأسيس
const SALON_START = new Date("1996-01-01T00:00:00");

function diffYears(start: Date, end: Date) {
  let years = end.getFullYear() - start.getFullYear();

  const m = end.getMonth() - start.getMonth();
  if (m < 0 || (m === 0 && end.getDate() < start.getDate())) {
    years--;
  }

  return Math.max(0, years);
}

function SalonAgeTicker() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000); // تحديث كل دقيقة فقط (خفيف)
    return () => clearInterval(t);
  }, []);

  const years = useMemo(() => diffYears(SALON_START, now), [now]);

  return (
    <div className="heroV2__ageLine" dir="rtl">
      <span className="heroV2__agePrefix">خبرة</span>
      <span className="heroV2__brand heroV2__ageText">{years} سنة</span>
      </div>
  );
}

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
      <div className="heroV2__overlay" />

      <div className="heroV2__container">
        <div className={`heroV2__content ${isVisible ? "is-visible" : ""}`}>
          <h1 className="heroV2__title">
            مرحباً بكم
            <br />
            في صالون <span className="heroV2__brand">ملكات</span>
          </h1>

          {/* ✅ بسيط + فخم */}
          <SalonAgeTicker />
        </div>
      </div>
    </section>
  );
}
