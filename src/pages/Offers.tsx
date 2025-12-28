// src/pages/Offers.tsx
import React, { useEffect, useMemo, useState } from "react";
import emma from "../assets/images/emma.jpg";
import hair from "../assets/images/hair.png";
import skin from "../assets/images/skin.jpg";
import nails from "../assets/images/nails.jpg";
import { Link } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faTag,
  faCalendarAlt,
  faPercent,
  faGift,
  faChevronDown,
  faChevronUp,
  faCopy,
} from "@fortawesome/free-solid-svg-icons";
import "../styles/Offers.css";

// ✅ Realtime from Firestore
import { onSnapshot, collection, query, orderBy } from "firebase/firestore";
import { db } from "../services/firebase";

import type { Offer as StoredOffer, DiscountType } from "../services/firestoreOffers";

// ✅ UI Offer shape (compatible with your card template)
type UiOffer = {
  id: string;
  title: string;
  description: string;
  discountType: DiscountType;
  value: number;
  discountPercent: number; // percent offers use it, fixed offers use 0
  validUntil: string; // endDate
  startDate?: string;
  code: string;
  image: string;
  badge: string;
  features: string[];
  active: boolean;
  usageCount?: number;
};

const SALON_ID = "main";

const Offers = () => {
  const [offers, setOffers] = useState<UiOffer[]>([]);
  const [openOfferId, setOpenOfferId] = useState<string | null>(null);

  // ✅ Helpers
  const isExpired = (date: string) => {
    const end = new Date(date);
    end.setHours(23, 59, 59, 999);
    return end.getTime() < Date.now();
  };

  const copyCode = async (code: string) => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      alert("تم نسخ الكود ✅");
    } catch {
      alert("ما قدرت أنسخ الكود.. انسخه يدويًا");
    }
  };

  // ✅ Firestore Realtime: salons/main/offers
  useEffect(() => {
    const pickFallbackImage = (discountType: DiscountType) => {
      if (discountType === "percent") return hair;
      return skin;
    };

    const q = query(
      collection(db, "salons", SALON_ID, "offers"),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const raw = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })) as unknown as StoredOffer[] as any[];

        const mapped: UiOffer[] = raw.map((o: any) => {
          const discountType: DiscountType = o.discountType ?? "fixed";
          const value = Number(o.value ?? 0);

          const endDate = String(o.endDate ?? "");
          const startDate = String(o.startDate ?? "");

          const img = String(o.imageUrl || "") || pickFallbackImage(discountType);

          const computedPercent =
            discountType === "percent" ? Math.min(100, Math.max(0, value)) : 0;

          const active = Boolean(o.active);

          const badge =
            discountType === "percent"
              ? `خصم ${computedPercent}%`
              : `خصم ${value} ريال`;

          return {
            id: String(o.id),
            title: String(o.title || "عرض"),
            description:
              discountType === "percent"
                ? `استخدمي كود الخصم للحصول على خصم ${computedPercent}% على خدمات الصالون.`
                : `استخدمي كود الخصم للحصول على خصم ${value} ريال على خدمات الصالون.`,
            discountType,
            value,
            discountPercent: computedPercent,
            validUntil: endDate || "2099-12-31",
            startDate,
            code: String(o.code || "").toUpperCase(),
            image: img || emma,
            badge,
            features: [
              `الكود: ${String(o.code || "").toUpperCase()}`,
              discountType === "percent"
                ? `قيمة الخصم: ${computedPercent}%`
                : `قيمة الخصم: ${value} ريال`,
              startDate
                ? `يبدأ من: ${new Date(startDate).toLocaleDateString("ar-SA")}`
                : "ساري الآن",
              endDate
                ? `ينتهي في: ${new Date(endDate).toLocaleDateString("ar-SA")}`
                : "بدون تاريخ نهاية",
            ],
            active,
            usageCount: Number(o.usageCount ?? 0),
          };
        });

        setOffers(mapped);
      },
      (err) => {
        console.error("❌ offers snapshot error:", err);
        setOffers([]);
      }
    );

    return () => unsub();
  }, []);

  // ✅ Smart pick -> put "best today" as first card in grid
  const { gridOffers, activeCount, maxPercent } = useMemo(() => {
    const valid = offers.filter((o) => o.active && !isExpired(o.validUntil));

    const best = (arr: UiOffer[]) => {
      const percent = arr
        .filter((o) => o.discountType === "percent")
        .sort((a, b) => (b.discountPercent ?? 0) - (a.discountPercent ?? 0))[0];
      if (percent) return percent;

      return [...arr]
        .filter((o) => o.discountType === "fixed")
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0];
    };

    const hero = best(valid) ?? best(offers) ?? offers[0];
    const rest = hero ? offers.filter((o) => o.id !== hero.id) : offers;

    const maxP =
      offers.length > 0
        ? Math.min(50, Math.max(...offers.map((o) => o.discountPercent || 0)))
        : 0;

    // ✅ "أفضل اليوم" أول بطاقة
    const grid = hero ? [{ ...hero, badge: "الأفضل اليوم" }, ...rest] : rest;

    return {
      gridOffers: grid,
      activeCount: valid.length,
      maxPercent: maxP,
    };
  }, [offers]);

  return (
    <div className="offers-page">
      {/* ✅ HERO (Simple - no offer details) */}
      <section className="offers-hero bg-gradient-primary py-5">
        <div className="container">
          <div className="row align-items-center justify-content-center">
            <div className="col-lg-10">
              <div className="hero-content animate-fade-in text-center">
                <h1 className="display-4 fw-bold mb-3">
                  <FontAwesomeIcon icon={faGift} className="me-3" />
                  عروضنا الخاصة
                </h1>

                <p className="lead mb-4">
                  العروض تُدار من لوحة الأونر وتظهر هنا تلقائيًا… اختاري العرض وطبّقي الكود عند
                  الحجز
                </p>

                <div className="hero-stats justify-content-center">
                  <div className="stat-item text-center">
                    <div className="stat-number">{maxPercent}%</div>
                    <div className="stat-label">خصم يصل إلى</div>
                  </div>
                  <div className="stat-item text-center">
                    <div className="stat-number">{activeCount}</div>
                    <div className="stat-label">عروض سارية</div>
                  </div>
                  <div className="stat-item text-center">
                    <div className="stat-number">+100</div>
                    <div className="stat-label">عميلة استفادت</div>
                  </div>
                </div>

                <Link to="/booking" className="btn btn-primary btn-lg rounded-pill mt-4">
                  احجزي الآن
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ✅ OFFERS GRID */}
      <section className="offers-grid py-5">
        <div className="container">
          <div className="text-center mb-5">
            <h2 className="h1 fw-bold text-gradient mb-2">كل العروض</h2>
            <p className="lead text-gray">رتّبيها واقرئيها بسهولة… واختاري الأفضل لك</p>
          </div>

          <div className="cards-grid-2">
            {gridOffers.map((offer, index) => {
              const expired = isExpired(offer.validUntil) || !offer.active;
              const expanded = openOfferId === offer.id;

              return (
                <div key={offer.id}>
                  <div
                    className={[
                      "offer-card-enhanced",
                      expired ? "expired" : "",
                      expanded ? "expanded" : "collapsed",
                    ].join(" ")}
                    style={{ animationDelay: `${index * 0.06}s` }}
                  >
                    <div className="offer-badge">
                      <FontAwesomeIcon icon={faPercent} className="me-1" />
                      {offer.badge}
                    </div>

                    <div
                      className="offer-image"
                      style={{ backgroundImage: `url(${offer.image || emma})` }}
                      aria-label={offer.title}
                    />

                    {/* ✅ Always-visible summary row */}
                    <div className="offer-content">
                      <h3 className="offer-title">{offer.title}</h3>

                      <div className="offer-mini-row" style={{ flexWrap: "wrap" }}>
                        <span className="discount-badge">
                          {offer.discountType === "percent"
                            ? `وفّري ${offer.discountPercent}%`
                            : `خصم ${offer.value} ريال`}
                        </span>

                        <span className="save-badge">
                          الكود: <b>{offer.code}</b>
                        </span>

                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={() => copyCode(offer.code)}
                          style={{ borderRadius: 999, padding: "6px 12px" }}
                        >
                          <FontAwesomeIcon icon={faCopy} className="me-2" />
                          نسخ
                        </button>

                        {expired ? (
                          <span className="status-pill ended">
                            {offer.active ? "منتهي" : "موقوف"}
                          </span>
                        ) : (
                          <span className="status-pill active">فعال</span>
                        )}
                      </div>

                      <div className="offer-validity">
                        <FontAwesomeIcon icon={faCalendarAlt} className="me-2 text-primary" />
                        ساري حتى: {new Date(offer.validUntil).toLocaleDateString("ar-SA")}
                      </div>

                      {/* ✅ Collapsible details */}
                      <div className="offer-details">
                        <p className="offer-description">{offer.description}</p>

                        <div className="offer-features mb-3">
                          <h5 className="fw-bold mb-2">
                            <FontAwesomeIcon icon={faTag} className="me-2" />
                            تفاصيل العرض:
                          </h5>
                          <ul>
                            {offer.features.map((feature, idx) => (
                              <li key={idx}>
                                <span className="check-dot" />
                                {feature}
                              </li>
                            ))}
                          </ul>
                        </div>

                        {!expired && (
                          <Link to="/booking" className="btn btn-primary w-100 btn-lg rounded-pill">
                            احجزي واستعملي الكود
                          </Link>
                        )}
                      </div>

                      {/* ✅ Toggle (disabled on expired) */}
                      <button
                        type="button"
                        className={`toggle-details ${expired ? "disabled" : ""}`}
                        disabled={expired}
                        onClick={() => setOpenOfferId(expanded ? null : offer.id)}
                      >
                        <span>{expanded ? "إخفاء التفاصيل" : "عرض التفاصيل"}</span>
                        <FontAwesomeIcon icon={expanded ? faChevronUp : faChevronDown} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ✅ Empty state */}
          {offers.length === 0 && (
            <div style={{ textAlign: "center", marginTop: 20, opacity: 0.8 }}>
              لا توجد عروض من لوحة التحكم حالياً — أضيفي عرض من Dashboard وسيظهر هنا تلقائيًا.
            </div>
          )}
        </div>
      </section>

      {/* ✅ CTA */}
      <section className="offers-cta bg-gradient-hero py-5">
        <div className="container">
          <div className="row justify-content-center text-center">
            <div className="col-lg-8">
              <h2 className="h1 fw-bold text-gradient mb-3">لا تفوتي الفرصة!</h2>
              <p className="lead mb-4">
                عروضنا محدودة الوقت. احجزي موعدك الآن واستمتعي بأفضل خدمات التجميل بأسعار مميزة
              </p>

              <div className="d-flex gap-3 justify-content-center flex-wrap">
                <Link to="/booking" className="btn btn-primary btn-lg rounded-pill">
                  <FontAwesomeIcon icon={faCalendarAlt} className="me-2" />
                  احجزي موعدك
                </Link>

                <Link to="/contact" className="btn btn-outline btn-lg rounded-pill">
                  <FontAwesomeIcon icon={faTag} className="me-2" />
                  استفسري عن العروض
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Offers;
