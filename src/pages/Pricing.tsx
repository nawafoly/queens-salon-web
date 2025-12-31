import React, { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCut,
  faPalette,
  faEye,
  faHandSparkles,
  faStar,
  faClock,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";

import "../styles/Pricing.css";

interface PriceItem {
  name: string;
  price: string; // مثل "50 ريال" أو "160-180 ريال"
  note?: string;
}

interface ServiceCategory {
  category: string;
  items: PriceItem[];
}

interface PricingSection {
  title: string;
  icon: any;
  color: string;
  services: ServiceCategory[];
}

/** ✅ مهم جدًا: لازم تكون export عشان Booking يقدر يستوردها */
export const pricingSections: Record<string, PricingSection> = {
  hair: {
    title: "قسم الشعر",
    icon: faCut,
    color: "primary",
    services: [
      {
        category: "الاستشوار",
        items: [
          { name: "شعر قصير", price: "50 ريال" },
          { name: "شعر وسط", price: "75 ريال" },
          { name: "شعر طويل", price: "120 ريال" },
          { name: "شعر طويل جداً", price: "150 ريال" },
        ],
      },
      {
        category: "التساريح",
        items: [
          { name: "شعر قصير", price: "120 ريال" },
          { name: "شعر وسط", price: "160-180 ريال" },
          { name: "شعر طويل جداً", price: "200-250 ريال" },
        ],
      },
      {
        category: "القص",
        items: [
          { name: "شعر قصير", price: "50 ريال" },
          { name: "شعر طويل جداً ومدرج", price: "100 ريال" },
          { name: "غرة", price: "25 ريال" },
          { name: "أطراف", price: "30 ريال" },
        ],
      },
    ],
  },
  coloring: {
    title: "قسم الصبغات والمعالجات",
    icon: faPalette,
    color: "secondary",
    services: [
      {
        category: "الصبغات",
        items: [
          { name: "صبغة لون واحد شعر قصير", price: "300 ريال" },
          { name: "صبغة لون واحد شعر وسط", price: "400 ريال" },
          { name: "صبغة لون واحد شعر طويل", price: "550 ريال" },
          { name: "سحب لون مع صبغة شعر قصير", price: "550 ريال" },
          { name: "سحب لون مع صبغة شعر متوسط", price: "650 ريال" },
          { name: "سحب لون مع صبغة شعر طويل", price: "850 ريال" },
        ],
      },
      {
        category: "خدمة الكافيار",
        items: [
          { name: "شعر قصير", price: "300 ريال" },
          { name: "شعر وسط", price: "400 ريال" },
          { name: "شعر طويل", price: "400 ريال" },
        ],
      },
      {
        category: "خدمة البروتين",
        items: [
          { name: "شعر قصير", price: "450 ريال" },
          { name: "شعر وسط", price: "600 ريال" },
          { name: "شعر طويل", price: "700-800 ريال" },
          { name: "شعر طويل جداً", price: "1000-1200 ريال" },
        ],
      },
      {
        category: "الفلر",
        items: [
          { name: "جلسة فلر شعر قصير", price: "150 ريال" },
          { name: "جلسة فلر شعر متوسط", price: "200 ريال" },
          { name: "جلسة فلر شعر طويل", price: "250 ريال" },
        ],
      },
    ],
  },
  makeup: {
    title: "قسم المكياج",
    icon: faEye,
    color: "accent",
    services: [
      {
        category: "المكياج",
        items: [
          { name: "رسمة آيلاينر", price: "35 ريال" },
          { name: "رسمة حواجب", price: "35 ريال" },
          { name: "رسمة عيون ناعمة", price: "85 ريال" },
          { name: "رسمة عيون سهرة", price: "109 ريال" },
          { name: "مكياج ناعم", price: "150 ريال" },
          { name: "مكياج سهرة", price: "185 ريال" },
          { name: "تركيب رموش من العملية", price: "20 ريال" },
          { name: "تركيب رموش من ملكات", price: "30 ريال" },
        ],
      },
    ],
  },
  nails: {
    title: "قسم البديكير والمناكير",
    icon: faHandSparkles,
    color: "info",
    services: [
      {
        category: "البديكير والمناكير",
        items: [
          {
            name: "بدكير ومناكير كامل يد ورجل (الأدوات مجاناً)",
            price: "190 ريال",
          },
          { name: "بدكير ومناكير يدين كامل (الأدوات 15 ريال)", price: "79 ريال" },
          { name: "بدكير قدمين كامل (الأدوات 15 ريال)", price: "90 ريال" },
        ],
      },
    ],
  },
  waxing: {
    title: "قسم الخدمات (الشمع وإزالة الشعر)",
    icon: faStar,
    color: "warning",
    services: [
      {
        category: "الشمع وإزالة الشعر",
        items: [
          { name: "تشقير أو صبغة", price: "50 ريال" },
          { name: "تشقير مع صبغة", price: "100 ريال" },
          { name: "شمع وجه", price: "100 ريال" },
          { name: "واكس يدين أو رجلين نصف", price: "125 ريال" },
          { name: "واكس يدين أو رجلين كامل", price: "250 ريال" },
          { name: "واكس ظهر أو بطن", price: "100 ريال" },
          { name: "واكس جسم كامل", price: "200 ريال", note: "من دون البكيني أو الأندر آرم" },
        ],
      },
    ],
  },
};

// ===== Helpers =====
function extractMinPrice(priceText: string): number | null {
  // يدعم: "50 ريال" أو "160-180 ريال"
  const cleaned = priceText.replace(/[^\d\-]/g, "");
  if (!cleaned) return null;
  const parts = cleaned.split("-").filter(Boolean).map((n) => Number(n));
  const valid = parts.filter((n) => Number.isFinite(n));
  if (!valid.length) return null;
  return Math.min(...valid);
}

function countItems(section: PricingSection): number {
  return section.services.reduce((acc, cat) => acc + cat.items.length, 0);
}

function minPriceInSection(section: PricingSection): number | null {
  const prices: number[] = [];
  section.services.forEach((cat) => {
    cat.items.forEach((it) => {
      const v = extractMinPrice(it.price);
      if (v !== null) prices.push(v);
    });
  });
  if (!prices.length) return null;
  return Math.min(...prices);
}

const Pricing: React.FC = () => {
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);

  const sectionCards = useMemo(() => {
    return Object.entries(pricingSections).map(([id, sec]) => ({
      id,
      title: sec.title,
      icon: sec.icon,
      color: sec.color,
      count: countItems(sec),
      minPrice: minPriceInSection(sec),
      section: sec,
    }));
  }, []);

  const active = useMemo(() => {
    if (!openSectionId) return null;
    const found = sectionCards.find((s) => s.id === openSectionId);
    return found || null;
  }, [openSectionId, sectionCards]);

  // اغلاق بالـ ESC
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenSectionId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="pricing-page">
      <div className="container">
        {/* Header */}
        <div className="pricing-header text-center">
          <h1 className="pricing-title">قائمة الأسعار</h1>
          <p className="pricing-subtitle">
            اختاري القسم واطلعي على التفاصيل بدون زحمة جداول طويلة
          </p>
        </div>

        {/* Cards */}
        <div className="pricing-cards">
          {sectionCards.map((s) => (
            <button
              key={s.id}
              type="button"
              className="pricing-card"
              onClick={() => setOpenSectionId(s.id)}
            >
              <div className="card-top">
                <div className={`card-icon card-icon-${s.color}`}>
                  <FontAwesomeIcon icon={s.icon} />
                </div>
                <div className="card-titleWrap">
                  <div className="card-title">{s.title}</div>
                  <div className="card-meta">
                    <span className="meta-pill">{s.count} خدمة</span>
                    <span className="meta-dot">•</span>
                    <span className="meta-pill">
                      يبدأ من {s.minPrice !== null ? `${s.minPrice} ريال` : "—"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="card-cta">
                <span className="cta-text">عرض الأسعار</span>
                <span className="cta-arrow">←</span>
              </div>
            </button>
          ))}
        </div>

        {/* Footer Note */}
        <div className="pricing-footer">
          <div className="note-item">
            <FontAwesomeIcon icon={faClock} />
            <span>يُرجى الحجز المسبق لضمان الموعد المناسب</span>
          </div>
          <div className="note-item">
            <FontAwesomeIcon icon={faStar} />
            <span>جميع الأسعار شاملة الضريبة</span>
          </div>
        </div>
      </div>

      {/* Modal / Bottom Sheet */}
      {active && (
        <div
          className="pricing-modal-overlay"
          role="presentation"
          onClick={() => setOpenSectionId(null)}
        >
          <div
            className="pricing-modal"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div className="modal-header-left">
                <div className={`modal-icon card-icon-${active.color}`}>
                  <FontAwesomeIcon icon={active.icon} />
                </div>
                <div>
                  <div className="modal-title">{active.title}</div>
                  <div className="modal-sub">
                    {active.count} خدمة • يبدأ من{" "}
                    {active.minPrice !== null ? `${active.minPrice} ريال` : "—"}
                  </div>
                </div>
              </div>

              <button
                type="button"
                className="modal-close"
                onClick={() => setOpenSectionId(null)}
                aria-label="إغلاق"
              >
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>

            <div className="modal-body">
              {active.section.services.map((cat, idx) => (
                <div key={idx} className="modal-category">
                  <div className="modal-category-title">{cat.category}</div>

                  <div className="modal-list">
                    {cat.items.map((it, i) => (
                      <div key={i} className="modal-row">
                        <div className="modal-name">
                          <div className="name-main">{it.name}</div>
                          {it.note ? (
                            <div className="name-note">{it.note}</div>
                          ) : null}
                        </div>
                        <div className="modal-price">{it.price}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="modal-primary"
                onClick={() => setOpenSectionId(null)}
              >
                تم
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Pricing;
