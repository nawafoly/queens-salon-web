// src/pages/Offers.tsx
import { useEffect, useMemo, useState } from "react";
import emma from "../assets/images/emma.webp";
import hair from "../assets/images/hair1.webp";
import skin from "../assets/images/skin1.webp";
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
  faEye,
  faEyeSlash,
} from "@fortawesome/free-solid-svg-icons";
import "../styles/Offers.css";

// ✅ Realtime from Firestore
import { onSnapshot, collection, query, orderBy } from "firebase/firestore";
import { db } from "../services/firebase";

// ✅ Modal بدل alert
import ConfirmModal from "../components/ConfirmModal";

type DiscountType = "percent" | "fixed";

type UiOffer = {
  id: string;
  title: string;
  description: string;
  discountType: DiscountType;
  value: number;
  discountPercent: number;

  startDate?: string;
  validUntil: string; // endDate
  code: string;

  image: string;
  badge: string;
  features: string[];

  active: boolean;
  usageCount?: number;

  createdAt?: number;
  deletedAt?: number;
};

const SALON_ID = "main";

function toISODate(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (v?.toDate) return v.toDate().toISOString().slice(0, 10);
  if (v?.seconds) return new Date(v.seconds * 1000).toISOString().slice(0, 10);
  return "";
}

function toMillis(v: any): number {
  if (!v) return 0;
  if (typeof v === "number") return v;
  if (typeof v?.toMillis === "function") return v.toMillis();
  if (v?.seconds) return Number(v.seconds) * 1000;
  const t = Date.parse(String(v));
  return Number.isFinite(t) ? t : 0;
}

function normalizeDiscountType(raw: any): DiscountType {
  const s = String(raw || "").toLowerCase().trim();
  if (s === "percent" || s === "percentage" || s === "p") return "percent";
  if (s === "fixed" || s === "amount" || s === "f") return "fixed";
  if (String(raw || "").toUpperCase() === "PERCENT") return "percent";
  if (String(raw || "").toUpperCase() === "FIXED") return "fixed";
  return "fixed";
}

function pickFallbackImage(discountType: DiscountType) {
  return discountType === "percent" ? hair : skin;
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isActiveNow(o: UiOffer) {
  if (o.deletedAt) return false;
  if (!o.active) return false;

  const today = todayISO();
  if (o.startDate && today < o.startDate) return false;
  if (o.validUntil && today > o.validUntil) return false;

  return true;
}

function normalizeOfferDoc(docId: string, raw: any): UiOffer {
  const discountType = normalizeDiscountType(raw?.discountType);

  const active =
    raw?.active === true ||
    raw?.isActive === true ||
    String(raw?.status || "").toUpperCase() === "ACTIVE";

  const startDate = toISODate(raw?.startDate);
  const endDate = toISODate(raw?.endDate || raw?.validUntil);

  const v1 = Number(raw?.value ?? raw?.discountValue ?? 0);
  const vPercent = Number(raw?.discountPercent ?? 0);

  const value =
    discountType === "percent"
      ? Number.isFinite(v1) && v1 > 0
        ? v1
        : vPercent
      : Number.isFinite(v1) && v1 > 0
      ? v1
      : Number(raw?.discountPrice ?? 0);

  const computedPercent =
    discountType === "percent" ? Math.min(100, Math.max(0, Number(value || 0))) : 0;

  const code = String(raw?.code || "").trim().toUpperCase();

  const img = String(raw?.imageUrl || raw?.imageSrc || "").trim() || pickFallbackImage(discountType);

  const badge = discountType === "percent" ? `خصم ${computedPercent}%` : `خصم ${Number(value || 0)} ريال`;

  const title = String(raw?.title || "عرض");
  const description =
    String(raw?.description || "").trim() ||
    (discountType === "percent"
      ? `استخدمي كود الخصم للحصول على خصم ${computedPercent}% على خدمات الصالون.`
      : `استخدمي كود الخصم للحصول على خصم ${Number(value || 0)} ريال على خدمات الصالون.`);

  const validUntil = endDate || "2099-12-31";

  const features: string[] = [
    code ? `الكود: ${code}` : "الكود: —",
    discountType === "percent" ? `قيمة الخصم: ${computedPercent}%` : `قيمة الخصم: ${Number(value || 0)} ريال`,
    startDate ? `يبدأ من: ${new Date(startDate).toLocaleDateString("ar-SA")}` : "ساري الآن",
    endDate ? `ينتهي في: ${new Date(endDate).toLocaleDateString("ar-SA")}` : "بدون تاريخ نهاية",
  ];

  return {
    id: String(docId),
    title,
    description,
    discountType,
    value: Number(value || 0),
    discountPercent: computedPercent,
    validUntil,
    startDate,
    code,
    image: img || emma,
    badge,
    features,
    active,
    usageCount: Number(raw?.usageCount ?? 0),

    createdAt: toMillis(raw?.createdAt) || 0,
    deletedAt: toMillis(raw?.deletedAt) || 0,
  };
}

const Offers = () => {
  const [offers, setOffers] = useState<UiOffer[]>([]);
  const [openOfferId, setOpenOfferId] = useState<string | null>(null);
  const [showEnded, setShowEnded] = useState(false);

  // ✅ Modal بدل alert
  const [modal, setModal] = useState({
    open: false,
    title: "",
    message: "",
    variant: "info" as "info" | "danger" | "success",
  });

  const openModal = (x: { title: string; message: string; variant?: "info" | "danger" | "success" }) => {
    setModal({ open: true, title: x.title, message: x.message, variant: x.variant || "info" });
  };
  const closeModal = () => setModal((p) => ({ ...p, open: false }));

  const copyCode = async (code: string) => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      openModal({ title: "تم النسخ ✅", message: `تم نسخ الكود: ${code}`, variant: "success" });
    } catch {
      openModal({
        title: "تعذر النسخ",
        message: "ما قدرت أنسخ الكود تلقائيًا… انسخيه يدويًا.",
        variant: "danger",
      });
    }
  };

  useEffect(() => {
    const q1 = query(collection(db, "salons", SALON_ID, "offers"), orderBy("createdAt", "desc"));

    const unsub1 = onSnapshot(
      q1,
      (snap) => {
        const mapped = snap.docs.map((d) => normalizeOfferDoc(d.id, d.data()));
        setOffers(mapped);
      },
      (err) => {
        console.warn("offers snapshot (orderBy) failed, fallback:", err?.message || err);

        const q2 = query(collection(db, "salons", SALON_ID, "offers"));
        const unsub2 = onSnapshot(
          q2,
          (snap) => {
            const mapped = snap.docs.map((d) => normalizeOfferDoc(d.id, d.data()));
            mapped.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            setOffers(mapped);
          },
          (err2) => {
            console.error("❌ offers snapshot error:", err2);
            setOffers([]);
          }
        );

        unsub1();
        return unsub2;
      }
    );

    return () => unsub1();
  }, []);

  const { activeNow, endedOrPaused, activeCount, maxPercent } = useMemo(() => {
    const activeNow = offers.filter((o) => isActiveNow(o));
    const endedOrPaused = offers.filter((o) => !isActiveNow(o) && !o.deletedAt);

    const best = (arr: UiOffer[]) => {
      const percent = arr
        .filter((o) => o.discountType === "percent")
        .sort((a, b) => (b.discountPercent ?? 0) - (a.discountPercent ?? 0))[0];
      if (percent) return percent;

      return [...arr]
        .filter((o) => o.discountType === "fixed")
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0];
    };

    const hero = best(activeNow) ?? best(offers.filter((x) => !x.deletedAt)) ?? offers[0];
    const rest = hero ? offers.filter((o) => o.id !== hero.id && !o.deletedAt) : offers.filter((x) => !x.deletedAt);

    const maxP =
      offers.length > 0
        ? Math.min(50, Math.max(...offers.map((o) => o.discountPercent || 0)))
        : 0;

    // ✅ القائمة الأساسية: الساري الآن أولاً، ثم الباقي
    const ordered = [
      ...activeNow.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
      ...rest.filter((o) => !activeNow.some((x) => x.id === o.id)).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    ];

    const grid = hero ? [{ ...hero, badge: "الأفضل اليوم" }, ...ordered.filter((o) => o.id !== hero.id)] : ordered;

    return {
      activeNow,
      endedOrPaused,
      activeCount: activeNow.length,
      maxPercent: maxP,
      gridOffers: grid,
    };
  }, [offers]);

  return (
    <div className="offers-page">
      <ConfirmModal
        open={modal.open}
        title={modal.title}
        message={modal.message}
        variant={modal.variant}
        onConfirm={closeModal}
        onCancel={closeModal}
        confirmText="حسنًا"
      />

      {/* HERO */}
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
                  العروض تُدار من لوحة الأونر وتظهر هنا تلقائيًا… اختاري العرض وطبّقي الكود عند الحجز
                </p>

                <div className="hero-stats justify-content-center">
                  <div className="stat-item text-center">
                    <div className="stat-number">{maxPercent}%</div>
                    <div className="stat-label">خصم يصل إلى</div>
                  </div>
                  <div className="stat-item text-center">
                    <div className="stat-number">{activeCount}</div>
                    <div className="stat-label">عروض سارية الآن</div>
                  </div>
                  <div className="stat-item text-center">
                    <div className="stat-number">+100</div>
                    <div className="stat-label">عميلة استفادت</div>
                  </div>
                </div>

                <Link to="/booking" className="offers-cta-btn mt-4">
                  احجزي الآن
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* GRID */}
      <section className="offers-grid py-5">
        <div className="container">
          <div className="text-center mb-4">
            <h2 className="h1 fw-bold text-gradient mb-2">العروض السارية الآن</h2>
            <p className="lead text-gray">هذه العروض فقط اللي تنطبق الآن حسب التاريخ + الحالة</p>
          </div>

          <div className="cards-grid-2">
            {activeNow.map((offer, index) => {
              const expanded = openOfferId === offer.id;

              return (
                <div key={offer.id}>
                  <div
                    className={["offer-card-enhanced", expanded ? "expanded" : "collapsed"].join(" ")}
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

                    <div className="offer-content">
                      <h3 className="offer-title">{offer.title}</h3>

                      <div className="offer-mini-row" style={{ flexWrap: "wrap" }}>
                        <span className="discount-badge">
                          {offer.discountType === "percent"
                            ? `وفّري ${offer.discountPercent}%`
                            : `خصم ${offer.value} ريال`}
                        </span>

                        <span className="save-badge">
                          الكود: <b>{offer.code || "—"}</b>
                        </span>

                        <button
                          type="button"
                          className="btn btn-outline btn-sm"
                          onClick={() => copyCode(offer.code)}
                          style={{ borderRadius: 999, padding: "6px 12px" }}
                          disabled={!offer.code}
                        >
                          <FontAwesomeIcon icon={faCopy} className="me-2" />
                          نسخ
                        </button>

                        <span className="status-pill active">فعال</span>
                      </div>

                      <div className="offer-validity">
                        <FontAwesomeIcon icon={faCalendarAlt} className="me-2 text-primary" />
                        {offer.startDate ? `يبدأ: ${new Date(offer.startDate).toLocaleDateString("ar-SA")} — ` : ""}
                        ساري حتى: {new Date(offer.validUntil).toLocaleDateString("ar-SA")}
                      </div>

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

                        <Link to="/booking" className="btn btn-primary w-100 btn-lg rounded-pill">
                          احجزي واستعملي الكود
                        </Link>
                      </div>

                      <button
                        type="button"
                        className="toggle-details"
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

          {activeNow.length === 0 && (
            <div style={{ textAlign: "center", marginTop: 20, opacity: 0.8 }}>
              لا توجد عروض سارية الآن — أضيفي عرض من Dashboard وحددي التواريخ وسيظهر هنا تلقائيًا.
            </div>
          )}

          {/* ENDED / PAUSED */}
          {endedOrPaused.length > 0 && (
            <div style={{ marginTop: 28 }}>
              <div className="text-center">
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => setShowEnded((s) => !s)}
                  style={{ borderRadius: 999, padding: "10px 16px" }}
                >
                  <FontAwesomeIcon icon={showEnded ? faEyeSlash : faEye} className="me-2" />
                  {showEnded ? "إخفاء العروض المنتهية/الموقوفة" : "إظهار العروض المنتهية/الموقوفة"}
                </button>
              </div>

              {showEnded && (
                <div style={{ marginTop: 18 }}>
                  <div className="text-center mb-3">
                    <h3 style={{ margin: 0 }}>عروض منتهية أو موقوفة</h3>
                    <p style={{ opacity: 0.75, marginTop: 8 }}>
                      للعرض فقط — لن تظهر كعروض سارية ولن يمكن تطبيقها في الحجز.
                    </p>
                  </div>

                  <div className="cards-grid-2">
                    {endedOrPaused.map((offer, index) => {
                      const expanded = openOfferId === offer.id;
                      const endedBadge = !offer.active ? "موقوف" : "منتهي";

                      return (
                        <div key={offer.id}>
                          <div
                            className={[
                              "offer-card-enhanced",
                              "expired",
                              expanded ? "expanded" : "collapsed",
                            ].join(" ")}
                            style={{ animationDelay: `${index * 0.04}s` }}
                          >
                            <div className="offer-badge">
                              <FontAwesomeIcon icon={faPercent} className="me-1" />
                              {endedBadge}
                            </div>

                            <div
                              className="offer-image"
                              style={{ backgroundImage: `url(${offer.image || emma})` }}
                              aria-label={offer.title}
                            />

                            <div className="offer-content">
                              <h3 className="offer-title">{offer.title}</h3>

                              <div className="offer-mini-row" style={{ flexWrap: "wrap" }}>
                                <span className="discount-badge">
                                  {offer.discountType === "percent"
                                    ? `خصم ${offer.discountPercent}%`
                                    : `خصم ${offer.value} ريال`}
                                </span>

                                <span className="save-badge">
                                  الكود: <b>{offer.code || "—"}</b>
                                </span>

                                <span className="status-pill ended">{endedBadge}</span>
                              </div>

                              <div className="offer-validity">
                                <FontAwesomeIcon icon={faCalendarAlt} className="me-2 text-primary" />
                                {offer.startDate ? `يبدأ: ${new Date(offer.startDate).toLocaleDateString("ar-SA")} — ` : ""}
                                ينتهي: {new Date(offer.validUntil).toLocaleDateString("ar-SA")}
                              </div>

                              <div className="offer-details">
                                <p className="offer-description">{offer.description}</p>
                              </div>

                              <button
                                type="button"
                                className="toggle-details"
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
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* CTA */}
      <section className="offers-cta bg-gradient-hero py-5">
        <div className="container">
          <div className="row justify-content-center text-center">
            <div className="col-lg-8">
              <h2 className="h1 fw-bold text-gradient mb-3">لا تفوتي الفرصة!</h2>
              <p className="lead mb-4">
                عروضنا محدودة الوقت. احجزي موعدك الآن واستمتعي بأفضل خدمات التجميل بأسعار مميزة
              </p>

              <div className="cta-actions">
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
