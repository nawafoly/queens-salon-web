// src/pages/Offers.tsx
import { useEffect, useMemo, useState } from "react";
import "../styles/OffersMobile.css";
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
  faCopy,
  faEye,
  faEyeSlash,
} from "@fortawesome/free-solid-svg-icons";


// ✅ Modal بدل alert
import ConfirmModal from "../components/ConfirmModal";
import {
  listOffers,
  type Offer as CoreOffer,
} from "../services/firestoreOffers";
import { CoreCatalogService } from "../services/CoreCatalogService";
import {
  PackageService,
  type Package as CorePackage,
} from "../services/PackageService";

type PublicPackageOffer = {
  id: string;
  name: string;
  description?: string;
  imageUrl?: string;
  active: boolean;
  usageCount?: number;
  startDate?: string;
  endDate?: string;
  serviceIds: string[];
  services: Array<{ serviceId: string; serviceName: string }>;
  finalPrice: number;
  sessionsCount: number;
  validityDays?: number;
};

type DiscountType = "percent" | "fixed";
type OfferAppliesTo = "all" | "services";

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

  active: boolean;
  usageCount?: number;

  createdAt?: number;
  deletedAt?: number;
  packageLike?: boolean;
  appliesTo: OfferAppliesTo;
  serviceIds: string[];
  sequenceServiceNames: string[];
};

const SALON_ID = "main";

function isExpectedPublicPackageAuthError(error: unknown) {
  const code = String((error as any)?.code || "").trim().toLowerCase();
  const message = String((error as any)?.message || error || "").trim().toLowerCase();
  return (
    code === "unauthenticated" ||
    code === "auth/unauthenticated" ||
    message.includes("unauthenticated") ||
    message.includes("not authenticated") ||
    message.includes("يجب تسجيل الدخول")
  );
}

function toISODate(v: any): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (v?.toDate) {
    const d = v.toDate();
    if (Number.isNaN(d.getTime())) return "";
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  if (v?.seconds) {
    const d = new Date(v.seconds * 1000);
    if (Number.isNaN(d.getTime())) return "";
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
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

function normalizeOfferAppliesTo(raw: any): OfferAppliesTo {
  return String(raw || "").trim().toLowerCase() === "services" ? "services" : "all";
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

function isPackageActiveNow(p: PublicPackageOffer) {
  if (!p) return false;
  if (p.active === false) return false;
  if (!String(p.name || "").trim()) return false;
  if (Number(p.sessionsCount || 0) <= 0) return false;

  const today = todayISO();
  const start = toISODate(p.startDate);
  const end = toISODate(p.endDate);
  if (start && today < start) return false;
  if (end && today > end) return false;
  return true;
}

function normalizeOfferDoc(docId: string, raw: any): UiOffer {
  const discountType = normalizeDiscountType(raw?.discountType);
  const appliesTo = normalizeOfferAppliesTo(raw?.appliesTo);
  const serviceIds = Array.isArray(raw?.serviceIds)
    ? raw.serviceIds.map((x: any) => String(x || "").trim()).filter(Boolean)
    : [];
  const sequenceServiceNames = Array.isArray(raw?.sequenceSteps)
    ? raw.sequenceSteps
        .map((x: any) => String(x?.titleSnapshot || "").trim())
        .filter(Boolean)
    : [];

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
    discountType === "percent"
      ? Math.min(100, Math.max(0, Number(value || 0)))
      : 0;

  const code = String(raw?.code || "").trim().toUpperCase();

  const img =
    String(raw?.imageUrl || raw?.imageSrc || "").trim() ||
    pickFallbackImage(discountType);

  const badge =
    discountType === "percent"
      ? `خصم ${computedPercent}%`
      : `خصم ${Number(value || 0)} ريال`;

  const title = String(raw?.title || "عرض");
  const description = String(raw?.description || "").trim();

  const validUntil = endDate || "2099-12-31";

  const packageLike =
    Number(raw?.packageFinalPrice || 0) > 0 ||
    Number(raw?.packageBaseTotalPrice || 0) > 0 ||
    Number(raw?.packageTotalDurationMin || 0) > 0 ||
    String(docId || "").trim().toLowerCase().startsWith("pkg_");

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
    active,
    usageCount: Number(raw?.usageCount ?? 0),

    createdAt: toMillis(raw?.createdAt) || 0,
    deletedAt: toMillis(raw?.deletedAt) || 0,
    packageLike,
    appliesTo,
    serviceIds,
    sequenceServiceNames,
  };
}

const Offers = () => {
  const [offers, setOffers] = useState<UiOffer[]>([]);
  const [packageOffers, setPackageOffers] = useState<PublicPackageOffer[]>([]);
  const [serviceNameById, setServiceNameById] = useState<Record<string, string>>({});
  const [showEnded, setShowEnded] = useState(false);

  // ✅ Modal بدل alert
  const [modal, setModal] = useState({
    open: false,
    title: "",
    message: "",
    variant: "info" as "info" | "danger" | "success",
  });

  const openModal = (x: {
    title: string;
    message: string;
    variant?: "info" | "danger" | "success";
  }) => {
    setModal({
      open: true,
      title: x.title,
      message: x.message,
      variant: x.variant || "info",
    });
  };
  const closeModal = () => setModal((p) => ({ ...p, open: false }));

  // ✅✅ FIX: منع Scroll الخلفية وقت فتح المودال (يحل scroll داخل scroll بالجوال)
  useEffect(() => {
    if (!modal.open) return;

    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;

    // (اختياري) تعويض اختفاء scrollbar على الديسكتوب
    const scrollbarWidth =
      window.innerWidth - document.documentElement.clientWidth;
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = prevOverflow || "";
      document.body.style.paddingRight = prevPaddingRight || "";
    };
  }, [modal.open]);

  const copyCode = async (code: string) => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      openModal({
        title: "تم النسخ",
        message: `تم نسخ الكود: ${code}`,
        variant: "success",
      });
    } catch {
      openModal({
        title: "تعذر النسخ",
        message: "ما قدرت أنسخ الكود تلقائيًا. انسخيه يدويًا.",
        variant: "danger",
      });
    }
  };

  useEffect(() => {
    let cancelled = false;

    listOffers(SALON_ID, "core")
      .then((rows) => {
        if (cancelled) return;
        const mapped = rows
          .map((row: CoreOffer) => normalizeOfferDoc(row.id, row))
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        setOffers(mapped);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Core offers load failed:", error);
        setOffers([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    CoreCatalogService.listServices({ activeOnly: true })
      .then((rows) => {
        if (cancelled) return;
        const next: Record<string, string> = {};
        rows.forEach((service) => {
          const id = String(service.id || "").trim();
          const name = String(service.name || "").trim();
          if (id && name) next[id] = name;
        });
        setServiceNameById(next);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Core services load failed:", error);
        setServiceNameById({});
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const offerServiceNamesById = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const offer of offers) {
      if (offer.appliesTo !== "services") continue;
      const fromSeq = Array.isArray(offer.sequenceServiceNames) ? offer.sequenceServiceNames : [];
      const fromIds = (offer.serviceIds || [])
        .map((id) => serviceNameById[String(id || "").trim()])
        .filter(Boolean);
      out[offer.id] = Array.from(new Set([...fromSeq, ...fromIds]));
    }
    return out;
  }, [offers, serviceNameById]);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      PackageService.getActive(),
      CoreCatalogService.listServices({ activeOnly: true }),
    ])
      .then(([packages, services]) => {
        if (cancelled) return;

        const serviceNames = new Map(
          services.map((service) => [
            String(service.id || "").trim(),
            String(service.name || "").trim(),
          ])
        );

        const rows: PublicPackageOffer[] = packages.map((pkg: CorePackage) => {
          const serviceIds = Array.isArray(pkg.serviceIds)
            ? pkg.serviceIds
                .map((id) => String(id || "").trim())
                .filter(Boolean)
            : [];

          return {
            id: String(pkg.id || "").trim(),
            name: String(pkg.name || "").trim(),
            description: String(pkg.description || "").trim() || undefined,
            imageUrl: String(pkg.imageUrl || "").trim() || undefined,
            active: pkg.active !== false && pkg.saleEnabled !== false,
            usageCount: 0,
            startDate: String(pkg.startsAt || "").trim() || undefined,
            endDate: String(pkg.endsAt || "").trim() || undefined,
            serviceIds,
            services: serviceIds.map((serviceId) => ({
              serviceId,
              serviceName: serviceNames.get(serviceId) || serviceId,
            })),
            finalPrice: Math.max(0, Number(pkg.price || 0)),
            sessionsCount: Math.max(1, Number(pkg.sessionsCount || 1)),
            validityDays:
              pkg.validityDays == null
                ? undefined
                : Math.max(1, Number(pkg.validityDays)),
          };
        });

        setPackageOffers(rows);
      })
      .catch((error) => {
        if (cancelled) return;
        if (!isExpectedPublicPackageAuthError(error)) {
          console.error("Core package catalog load failed:", error);
        }
        setPackageOffers([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const { endedOrPaused, activeCount, maxPercent, gridOffers } = useMemo(() => {
    const onlyRealOffers = offers.filter((o) => !o.packageLike);
    const activeNow = onlyRealOffers.filter((o) => isActiveNow(o));
    const endedOrPaused = onlyRealOffers.filter((o) => !isActiveNow(o) && !o.deletedAt);

    const best = (arr: UiOffer[]) => {
      const percent = arr
        .filter((o) => o.discountType === "percent")
        .sort((a, b) => (b.discountPercent ?? 0) - (a.discountPercent ?? 0))[0];
      if (percent) return percent;

      return [...arr]
        .filter((o) => o.discountType === "fixed")
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0];
    };

    const hero =
      best(activeNow) ?? best(onlyRealOffers.filter((x) => !x.deletedAt)) ?? onlyRealOffers[0];
    const rest = hero
      ? onlyRealOffers.filter((o) => o.id !== hero.id && !o.deletedAt)
      : onlyRealOffers.filter((x) => !x.deletedAt);

    const maxP =
      onlyRealOffers.length > 0
        ? Math.min(50, Math.max(...onlyRealOffers.map((o) => o.discountPercent || 0)))
        : 0;

    // ترتيب العرض فقط: الساري الآن أولاً، ثم الباقي
    const ordered = [
      ...activeNow.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
      ...rest
        .filter((o) => !activeNow.some((x) => x.id === o.id))
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)),
    ];

    const grid = hero
      ? [{ ...hero, badge: "الأفضل اليوم" }, ...ordered.filter((o) => o.id !== hero.id)]
      : ordered;

    return {
      activeNow,
      endedOrPaused,
      activeCount: activeNow.length,
      maxPercent: maxP,
      gridOffers: grid,
    };
  }, [offers]);

  const activePackages = useMemo(() => {
    return (packageOffers || []).filter((p) => isPackageActiveNow(p));
  }, [packageOffers]);

  const totalOfferUsage = useMemo(() => {
    return (offers || [])
      .filter((o) => !o.packageLike)
      .reduce((sum, o) => sum + Math.max(0, Math.floor(Number(o.usageCount || 0))), 0);
  }, [offers]);

  const totalPackageUsage = useMemo(() => {
    return (packageOffers || []).reduce(
      (sum, p) => sum + Math.max(0, Math.floor(Number((p as any)?.usageCount || 0))),
      0
    );
  }, [packageOffers]);

  const beneficiariesCount = useMemo(() => {
    const base = 2592;
    return base + totalOfferUsage + totalPackageUsage;
  }, [totalOfferUsage, totalPackageUsage]);

  const liveOfferCards = useMemo(() => {
    return (gridOffers || []).filter((offer) => isActiveNow(offer));
  }, [gridOffers]);

  const featuredOffer = liveOfferCards[0] || null;

  const formatDateLabel = (value?: string) => {
    const iso = toISODate(value);
    if (!iso) return "بدون تاريخ محدد";
    return new Date(`${iso}T00:00:00`).toLocaleDateString("ar-SA-u-nu-latn", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const formatDiscountLabel = (offer: UiOffer) => {
    if (offer.discountType === "percent") return `${offer.discountPercent}% خصم`;
    return `${Number(offer.value || 0).toLocaleString("ar-SA-u-nu-latn")} ريال خصم`;
  };

  return (
    <div className="offers-page offers-premium-page">
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
      <section className="offers-hero offers-premium-hero bg-gradient-primary py-5">
        <div className="container">
          <div className="row align-items-center justify-content-center">
            <div className="col-lg-10">
              <div className="hero-content animate-fade-in text-center">
                <h1
                  className="display-4 fw-bold mb-3"
                  style={{ color: "#0d0d0d" }}
                >
                  <FontAwesomeIcon icon={faGift} className="me-3" />
                  عروض مليكات
                </h1>

                <p className="lead mb-4">
                  عروض مختارة لخدمات الشعر والجمال، اختاري العرض المناسب واحجزي مباشرة من نفس الصفحة.
                </p>

                <div className="hero-stats justify-content-center">
                  <div className="stat-item text-center">
                    <div className="stat-number">{maxPercent}%</div>
                    <div className="stat-label">أعلى خصم</div>
                  </div>
                  <div className="stat-item text-center">
                    <div className="stat-number">{activeCount}</div>
                    <div className="stat-label">عروض متاحة</div>
                  </div>
                  <div className="stat-item text-center">
                    <div className="stat-number">+{beneficiariesCount.toLocaleString("en-US")}</div>
                    <div className="stat-label">عميلة استفادت</div>
                  </div>
                </div>

                <div className="offers-premium-featured" aria-label="العرض الأبرز">
                  <div
                    className="offers-premium-featured__image"
                    style={{ backgroundImage: `url(${featuredOffer?.image || hair})` }}
                  />
                  <div className="offers-premium-featured__body">
                    <span className="offers-premium-kicker">العرض الأبرز</span>
                    <h2>{featuredOffer?.title || "عروض جديدة قريبًا"}</h2>
                    <p>
                      {featuredOffer?.description ||
                        "تابعي هذه الصفحة لاكتشاف أحدث عروض مليكات على الخدمات والباقات."}
                    </p>
                    {featuredOffer ? (
                      <div className="offers-premium-featured__meta">
                        <span>{formatDiscountLabel(featuredOffer)}</span>
                        <span>حتى {formatDateLabel(featuredOffer.validUntil)}</span>
                      </div>
                    ) : null}
                    <div className="offers-premium-featured__actions">
                      {featuredOffer?.code ? (
                        <button type="button" onClick={() => copyCode(featuredOffer.code)}>
                          <FontAwesomeIcon icon={faCopy} />
                          نسخ الكود
                        </button>
                      ) : null}
                      <Link
                        to={{
                          pathname: "/booking",
                          search: featuredOffer?.code
                            ? `?coupon=${encodeURIComponent(String(featuredOffer.code || "").trim())}&fromOffer=1`
                            : "",
                        }}
                      >
                        احجزي الآن
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* GRID */}
      <section className="offers-grid py-5">
        <div className="container">
          <div className="text-center mb-4">
            <span className="offers-premium-section-label">اختاري العرض</span>
            <h2 className="h1 fw-bold text-gradient mb-2">العروض السارية الآن</h2>
          </div>

          <div className="cards-grid-2">
            {liveOfferCards.map((offer, index) => {
              const offerServiceNames = offerServiceNamesById[offer.id] || [];

              return (
                <div key={offer.id}>
                  <div
                    className="offer-card-enhanced"
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
                            ? `${offer.discountPercent}% خصم`
                            : `${offer.value} ريال خصم`}
                        </span>

                        <span className="save-badge">
                          الكود: <b>{offer.code || "—"}</b>
                        </span>

                        <button
                          type="button"
                          className="btn btn-outline btn-sm offer-copy-btn"
                          onClick={() => copyCode(offer.code)}
                          disabled={!offer.code}
                        >
                          <FontAwesomeIcon icon={faCopy} className="me-2" />
                          نسخ الكود
                        </button>

                        <span className="status-pill active">فعال</span>
                        <span className={`offer-scope-pill ${offer.appliesTo === "services" ? "scope-services" : "scope-all"}`}>
                          {offer.appliesTo === "services" ? "خدمات محددة" : "كل الخدمات"}
                        </span>
                      </div>

                      <div className="offer-validity">
                          <FontAwesomeIcon icon={faCalendarAlt} className="me-2 text-primary" />
                          {offer.startDate
                            ? `من ${formatDateLabel(offer.startDate)} إلى `
                            : ""}
                          {formatDateLabel(offer.validUntil)}
                        </div>

                      <div className="offer-details">
                        {String(offer.description || "").trim() ? (
                          <p className="offer-description">{offer.description}</p>
                        ) : null}

                        {offer.appliesTo === "services" && (
                          <div className="pkg-services-block">
                            <div className="pkg-services-title">
                              <FontAwesomeIcon icon={faTag} className="me-2" />
                              الخدمات المشمولة
                            </div>
                            {offerServiceNames.length > 0 ? (
                              <div className="pkg-services-chips">
                                {offerServiceNames.map((serviceName: string, serviceIdx: number) => (
                                  <span key={`${offer.id}-offer-svc-${serviceIdx}`} className="pkg-service-chip">
                                    {serviceName}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <div className="pkg-services-empty">
                                ينطبق على {Array.isArray(offer.serviceIds) ? offer.serviceIds.length : 0} خدمة محددة.
                              </div>
                            )}
                          </div>
                        )}

                        <Link
                          to={{
                            pathname: "/booking",
                            search: `?coupon=${encodeURIComponent(String(offer.code || "").trim())}&fromOffer=1`,
                          }}
                          className="btn btn-primary w-100 btn-lg rounded-pill"
                        >
                          احجزي بهذا العرض
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {liveOfferCards.length === 0 && (
            <div className="offers-empty-state" role="status">
              <span className="offers-empty-state__icon">
                <FontAwesomeIcon icon={faTag} aria-hidden="true" />
              </span>

              <strong>لا توجد عروض سارية الآن</strong>

              <span>
                ستظهر العروض الجديدة هنا فور تفعيلها من لوحة الإدارة.
              </span>
            </div>
          )}

          {activePackages.length > 0 && (
            <div className="package-offers-wrap">
              <div className="text-center mb-4">
                <span className="offers-premium-section-label">باقات جاهزة</span>
                <h2 className="h1 fw-bold text-gradient mb-2">الباقات والعروض الخاصة</h2>
              </div>

              <div className="cards-grid-2">
                {activePackages.map((p, index) => {
                  const pkgStart = toISODate(p.startDate);
                  const pkgEnd = toISODate(p.endDate);
                  const packageDescription = String(p.description || "").trim();
                  const packageFinal = Math.max(0, Number(p.finalPrice || 0));
                  const packageServiceNames = Array.isArray(p.services)
                    ? p.services
                        .map((service) => String(service.serviceName || "").trim())
                        .filter(Boolean)
                    : [];
                  return (
                    <div key={`pkg-public-${p.id}`}>
                      <div
                        className="offer-card-enhanced"
                        style={{ animationDelay: `${index * 0.05}s` }}
                      >
                        <div
                          className="offer-image"
                          style={{ backgroundImage: `url(${String((p as any).imageUrl || "").trim() || emma})` }}
                          aria-label={String(p.name || "باقة")}
                        />

                        <div className="offer-content">
                          <h3 className="offer-title">{String(p.name || "باقة")}</h3>

                          <div className="offer-mini-row" style={{ flexWrap: "wrap" }}>
                            <span className="discount-badge">
                              {Math.max(1, Number(p.sessionsCount || 1))} جلسات
                            </span>
                            <span className="save-badge">{packageFinal.toLocaleString("ar-SA-u-nu-latn")} ريال</span>
                            {p.validityDays ? (
                              <span className="save-badge">
                                صلاحية {p.validityDays} يوم
                              </span>
                            ) : null}
                            <span className="status-pill active">فعال</span>
                            <span className="offer-scope-pill scope-services">باكيج متكامل</span>
                          </div>

                          <div className="offer-validity">
                            <FontAwesomeIcon icon={faCalendarAlt} className="me-2 text-primary" />
                            {pkgStart
                              ? `من ${formatDateLabel(pkgStart)} إلى `
                              : "من الآن إلى "}
                            {pkgEnd
                              ? formatDateLabel(pkgEnd)
                              : "بدون تاريخ انتهاء"}
                          </div>

                          <div className="offer-details">
                            {packageDescription ? (
                              <p className="offer-description">{packageDescription}</p>
                            ) : null}
                            <div className="pkg-services-block">
                              <div className="pkg-services-title">
                                <FontAwesomeIcon icon={faTag} className="me-2" />
                                الخدمات داخل الباقة
                              </div>
                              {packageServiceNames.length > 0 ? (
                                <div className="pkg-services-chips">
                                  {packageServiceNames.map((serviceName: string, serviceIdx: number) => (
                                    <span key={`${p.id}-svc-${serviceIdx}`} className="pkg-service-chip">
                                      {serviceName}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <div className="pkg-services-empty">
                                  عدد الخدمات: {Array.isArray(p.serviceIds) ? p.serviceIds.length : 0}
                                </div>
                              )}
                            </div>
                            <Link
                              to={{
                                pathname: "/booking",
                                search: `?scope=offers_packages&pick=${encodeURIComponent(`pkg:${String(p.id || "").trim()}`)}&autoAdd=1`,
                              }}
                              className="btn btn-primary w-100 btn-lg rounded-pill"
                            >
                              احجزي هذه الباقة
                            </Link>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ENDED / PAUSED */}
          {endedOrPaused.length > 0 && (
            <div className="offers-ended-wrap">
              <div className="offers-ended-head text-center">
                <button
                  type="button"
                  className={`offers-ended-toggle ${showEnded ? "is-open" : ""}`}
                  onClick={() => setShowEnded((s) => !s)}
                >
                  <span className="offers-ended-toggle-icon">
                    <FontAwesomeIcon icon={showEnded ? faEyeSlash : faEye} />
                  </span>
                  <span className="offers-ended-toggle-text">
                    {showEnded ? "إخفاء العروض السابقة" : "إظهار العروض السابقة"}
                  </span>
                  <span className="offers-ended-toggle-count" aria-label="عدد العروض السابقة">
                    {endedOrPaused.length}
                  </span>
                </button>
              </div>

              {showEnded && (
                <div className="offers-ended-panel">
                  <div className="text-center mb-3">
                    <h3 style={{ margin: 0 }}>عروض سابقة</h3>
                    <p style={{ opacity: 0.75, marginTop: 8 }}>
                      تظهر هنا للمتابعة فقط ولا يمكن تطبيقها في الحجز.
                    </p>
                  </div>

                  <div className="cards-grid-2">
                    {endedOrPaused.map((offer, index) => {
                      const endedBadge = !offer.active ? "موقوف" : "منتهي";

                      return (
                        <div key={offer.id}>
                          <div
                            className={[
                              "offer-card-enhanced",
                              "expired",
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
                                <span className={`offer-scope-pill ${offer.appliesTo === "services" ? "scope-services" : "scope-all"}`}>
                                  {offer.appliesTo === "services" ? "خدمات محددة" : "كل الخدمات"}
                                </span>
                              </div>

                              <div className="offer-validity">
                                <FontAwesomeIcon icon={faCalendarAlt} className="me-2 text-primary" />
                                {offer.startDate
                                  ? `من ${formatDateLabel(offer.startDate)} إلى `
                                  : ""}
                                {formatDateLabel(offer.validUntil)}
                              </div>
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
      <section className="offers-cta is-white py-5">
        <div className="container">
          <div className="row justify-content-center text-center">
            <div className="col-lg-8">
              <h2 className="h1 fw-bold text-gradient mb-3">ابدئي حجزك مع مليكات</h2>
              <p className="lead mb-4">
                اختاري الخدمة المناسبة، وطبقي الكود أثناء الحجز إذا كان العرض يتضمن كود خصم.
              </p>

              <div className="cta-actions">
                <Link to="/booking" className="btn btn-outline btn-lg rounded-pill offers-cta-btn">
                  <FontAwesomeIcon icon={faTag} className="me-2" />
                  الانتقال للحجز
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
