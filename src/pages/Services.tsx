// src/pages/Services.tsx
import { useEffect, useMemo, useRef, useState } from "react";

// ✅ صور منتجات (لا تغيّر منطق الصور)
import hair from "../assets/images/hair.png";
import skin from "../assets/images/skin.png";
import nails from "../assets/images/nails.png";
import makeupImg from "../assets/images/makeup.png";
import massageImg from "../assets/images/massage.png";
import packagesImg from "../assets/images/packages.png";
import servicesImg from "../assets/images/services.png";
import homeServicesImg from "../assets/images/home-services.png";
import hairColorTreatmentsImg from "../assets/images/hair-color-treatments.png";
import hairGuideImg from "../assets/images/hair-length-guide.png";

import { Link } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCut,
  faSpa,
  faPaintBrush,
  faHandSparkles,
  faMagic,
  faStar,
  faChevronDown,
  faChevronUp,
  faList,
} from "@fortawesome/free-solid-svg-icons";
// ✅ نستعمل نفس شكل كرت العروض 1:1

// ✅ Firestore
import { collection, getDocs, query, orderBy, where } from "firebase/firestore";
import { db } from "../services/firebase";
import { AppSettingsService } from "../services/AppSettingsService";
import { isSeasonActiveNow, pickEffectivePrice } from "../helpers/seasonPricing";

const SALON_ID = "main";
const SERVICES_CACHE_KEY = "services_page_cache_v1";
const SERVICES_CACHE_TTL_MS = 10 * 60 * 1000;

type SectionRow = {
  id: string;
  name: string;
  active?: boolean;
  order?: number;
};

type CategoryRow = {
  id: string;
  sectionId: string;
  name: string;
  active?: boolean;
  order?: number;
};

type ServiceRow = {
  id: string;
  name: string;
  sectionId: string;
  categoryId?: string;
  price: number;
  seasonPrice?: number | null;
  active?: boolean;
};

type UiServiceItem = {
  id: string;
  name: string;
  basePrice: number;
  seasonPrice: number | null;
  displayPrice: number;
};

type UiCategory = {
  id: string;
  name: string;
  items: UiServiceItem[];
};

type UiSection = {
  id: string;
  title: string;
  icon: any;
  image: string;
  description: string;
  categories: UiCategory[];
  totalServices: number;
};

type ServicesPageCache = {
  savedAt: number;
  sections: SectionRow[];
  categories: CategoryRow[];
  services: ServiceRow[];
};

function normalizeSectionRow(raw: any, id = ""): SectionRow {
  return {
    id: String(id || raw?.id || "").trim(),
    name: String(raw?.name || "").trim(),
    active: Boolean(raw?.active ?? true),
    order: Number(raw?.order ?? 0),
  };
}

function normalizeCategoryRow(raw: any, id = ""): CategoryRow {
  return {
    id: String(id || raw?.id || "").trim(),
    sectionId: String(raw?.sectionId || "").trim(),
    name: String(raw?.name || "").trim(),
    active: Boolean(raw?.active ?? true),
    order: Number(raw?.order ?? 0),
  };
}

function normalizeServiceRow(raw: any, id = ""): ServiceRow {
  const seasonRaw = raw?.seasonPrice;
  const seasonPrice =
    seasonRaw === null || seasonRaw === undefined || String(seasonRaw).trim() === ""
      ? null
      : Math.max(0, Number(seasonRaw || 0));
  return {
    id: String(id || raw?.id || "").trim(),
    name: String(raw?.name || "").trim(),
    sectionId: String(raw?.sectionId || "").trim(),
    categoryId: raw?.categoryId ? String(raw.categoryId).trim() : undefined,
    price: Math.max(0, Number(raw?.price ?? 0)),
    seasonPrice,
    active: Boolean(raw?.active ?? true),
  };
}

function readServicesPageCache(): ServicesPageCache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SERVICES_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ServicesPageCache>;
    const savedAt = Number(parsed?.savedAt || 0);
    if (!savedAt || Date.now() - savedAt > SERVICES_CACHE_TTL_MS) return null;

    const sections = Array.isArray(parsed?.sections)
      ? parsed.sections.map((x: any) => normalizeSectionRow(x)).filter((x) => x.id && x.name)
      : [];
    const categories = Array.isArray(parsed?.categories)
      ? parsed.categories
          .map((x: any) => normalizeCategoryRow(x))
          .filter((x) => x.id && x.sectionId && x.name)
      : [];
    const services = Array.isArray(parsed?.services)
      ? parsed.services
          .map((x: any) => normalizeServiceRow(x))
          .filter((x) => x.id && x.sectionId && x.name)
      : [];

    if (!sections.length && !categories.length && !services.length) return null;
    return { savedAt, sections, categories, services };
  } catch {
    return null;
  }
}

function writeServicesPageCache(payload: Omit<ServicesPageCache, "savedAt">) {
  if (typeof window === "undefined") return;
  try {
    const snapshot: ServicesPageCache = {
      savedAt: Date.now(),
      sections: payload.sections,
      categories: payload.categories,
      services: payload.services,
    };
    window.localStorage.setItem(SERVICES_CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // ignore
  }
}

function formatMoney(n: number | null | undefined) {
  return Number(n || 0).toFixed(0);
}

function parseIsoDateLocal(dateISO: string): Date | null {
  const m = String(dateISO || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (
    dt.getFullYear() !== y ||
    dt.getMonth() !== mo - 1 ||
    dt.getDate() !== d
  ) {
    return null;
  }
  return dt;
}

function formatSeasonDateGregorian(dateISO: string) {
  const dt = parseIsoDateLocal(dateISO);
  if (!dt) return dateISO;
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(dt);
}

export default function Services() {
  const [loading, setLoading] = useState(true);
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [appSettings, setAppSettings] = useState<any>(() => AppSettingsService.getCached?.() || {});
  const [error, setError] = useState<string | null>(null);

  // ✅ فتح/إغلاق متعدد للتصنيفات لتفادي قفزات السكروول عند إغلاق تصنيف بعيد بالأعلى
  const [openCatKeys, setOpenCatKeys] = useState<Record<string, true>>({});
  const [openHairGuideSectionId, setOpenHairGuideSectionId] = useState<string | null>(null);
  const scrollStabilizeTimersRef = useRef<number[]>([]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const html = document.documentElement;
    const previous = html.style.scrollBehavior;
    html.style.scrollBehavior = "auto";
    return () => {
      html.style.scrollBehavior = previous;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (typeof window === "undefined") return;
      for (const t of scrollStabilizeTimersRef.current) {
        window.clearTimeout(t);
      }
      scrollStabilizeTimersRef.current = [];
    };
  }, []);

  const toggleCategoryDetails = (key: string, triggerEl?: HTMLButtonElement | null) => {
    if (typeof window !== "undefined") {
      for (const t of scrollStabilizeTimersRef.current) {
        window.clearTimeout(t);
      }
      scrollStabilizeTimersRef.current = [];
    }

    const winY =
      typeof window !== "undefined"
        ? Math.max(window.scrollY || 0, document.documentElement.scrollTop || 0, document.body.scrollTop || 0)
        : 0;
    const mainContent = typeof document !== "undefined"
      ? document.querySelector<HTMLElement>(".main-content")
      : null;
    const mainY = mainContent ? mainContent.scrollTop : 0;

    setOpenCatKeys((prev) => {
      const next = { ...prev };
      if (next[key]) {
        delete next[key];
      } else {
        next[key] = true;
      }
      return next;
    });

    if (typeof window === "undefined") return;

    const stabilizeScroll = () => {
      try {
        window.scrollTo(0, Math.max(0, winY));
      } catch {
        // ignore
      }
      document.documentElement.scrollTop = Math.max(0, winY);
      document.body.scrollTop = Math.max(0, winY);
      if (mainContent) mainContent.scrollTop = Math.max(0, mainY);
      if (triggerEl) {
        try {
          triggerEl.blur();
        } catch {
          // ignore
        }
      }
    };

    window.requestAnimationFrame(stabilizeScroll);
    const delays = [40, 110, 220, 360];
    for (const delay of delays) {
      const t = window.setTimeout(stabilizeScroll, delay);
      scrollStabilizeTimersRef.current.push(t);
    }
  };

  // ✅ ثوابت العرض حسب sectionId
  const uiBySectionId = useMemo(() => {
    return {
      "hair-care": {
        image: hair,
        icon: faCut,
        description:
          "خدمات متكاملة للعناية بالشعر تشمل القص، الصبغ، التصفيف، والعلاجات المتخصصة.",
      },
      "skin-care": {
        image: skin,
        icon: faSpa,
        description:
          "جلسات تنظيف وتقشير وترطيب للبشرة مع علاجات متخصصة للمشاكل المختلفة.",
      },
      "nail-care": {
        image: nails,
        icon: faHandSparkles,
        description: "خدمات المانيكير والباديكير مع تقنيات متطورة وألوان عصرية.",
      },
      makeup: {
        image: makeupImg,
        icon: faPaintBrush,
        description:
          "مكياج احترافي للمناسبات الخاصة والأعراس مع خيارات متنوعة تناسب جميع الأذواق.",
      },
      massage: {
        image: massageImg,
        icon: faStar,
        description:
          "جلسات مساج متنوعة للاسترخاء وتخفيف التوتر وتنشيط الدورة الدموية.",
      },
      "special-packages": {
        image: packagesImg,
        icon: faMagic,
        description: "باقات متكاملة تجمع بين خدمات متنوعة بأسعار مميزة.",
      },
      services: {
        image: servicesImg,
        icon: faList,
        description: "خدمات متنوعة مقدمة داخل الصالون.",
      },

      "home-services": {
        image: homeServicesImg,
        icon: faStar,
        description: "خدمات الصالون المقدمة في المنزل براحة واحترافية.",
      },

      "hair-color-treatments": {
        image: hairColorTreatmentsImg,
        icon: faPaintBrush,
        description: "صبغات الشعر والعلاجات المتخصصة بأحدث التقنيات.",
      },

    } as Record<string, { image: string; icon: any; description: string }>;
  }, []);

  useEffect(() => {
    const unsub = AppSettingsService.subscribe((remote: any) => {
      setAppSettings(remote || {});
    });
    return () => unsub();
  }, []);

  const seasonRangeLabelGregorian = useMemo(() => {
    const season = (appSettings as any)?.catalogSeasonPricing || {};
    const from = String(season?.startDate || season?.from || "").trim();
    const to = String(season?.endDate || season?.to || "").trim();

    if (from && to) {
      return `الميلادي: يبدأ من ${formatSeasonDateGregorian(from)} م وينتهي ${formatSeasonDateGregorian(to)} م`;
    }
    if (from) return `الميلادي: يبدأ من ${formatSeasonDateGregorian(from)} م`;
    if (to) return `الميلادي: ينتهي ${formatSeasonDateGregorian(to)} م`;
    return "الميلادي: غير محدد";
  }, [appSettings]);

  const seasonRangeTitle = useMemo(() => {
    const activeNow = isSeasonActiveNow(appSettings);
    return activeNow ? "تاريخ أسعار الموسم (فعال الآن)" : "تاريخ أسعار الموسم";
  }, [appSettings]);

  useEffect(() => {
    let mounted = true;
    const cached = readServicesPageCache();
    const hasCached = !!cached;

    if (cached) {
      setSections(cached.sections.filter((s) => s.active !== false));
      setCategories(cached.categories.filter((c) => c.active !== false));
      setServices(cached.services.filter((s) => s.active !== false));
      setLoading(false);
    }

    async function load() {
      if (!hasCached) setLoading(true);
      setError(null);

      try {
        // ✅ Fetch in parallel to reduce page-open latency.
        const sectionsRef = collection(db, "salons", SALON_ID, "service_sections");
        const catsRef = collection(db, "salons", SALON_ID, "service_categories");
        const servicesRef = collection(db, "salons", SALON_ID, "services");

        const sectionsQ = query(sectionsRef, orderBy("order", "asc"));
        const catsQ = query(catsRef, orderBy("order", "asc"));
        const servicesQ = query(servicesRef, where("active", "==", true));

        const [sectionsSnap, catsSnap, servicesSnap] = await Promise.all([
          getDocs(sectionsQ),
          getDocs(catsQ),
          getDocs(servicesQ),
        ]);

        const sectionsRows: SectionRow[] = sectionsSnap.docs
          .map((d) => normalizeSectionRow(d.data(), d.id))
          .filter((x) => x.id && x.name);

        const catsRows: CategoryRow[] = catsSnap.docs
          .map((d) => normalizeCategoryRow(d.data(), d.id))
          .filter((x) => x.id && x.sectionId && x.name);

        const servicesRows: ServiceRow[] = servicesSnap.docs
          .map((d) => normalizeServiceRow(d.data(), d.id))
          .filter((x) => x.id && x.sectionId && x.name);

        if (!mounted) return;

        const nextSections = sectionsRows.filter((s) => s.active !== false);
        const nextCategories = catsRows.filter((c) => c.active !== false);
        const nextServices = servicesRows.filter((s) => s.active !== false);

        setSections(nextSections);
        setCategories(nextCategories);
        setServices(nextServices);
        writeServicesPageCache({
          sections: nextSections,
          categories: nextCategories,
          services: nextServices,
        });
      } catch (e: any) {
        if (!mounted) return;
        console.error("Services load error:", e);
        if (!hasCached) {
          setError(e?.message || "صار خطأ أثناء تحميل الخدمات");
        }
      } finally {
        if (!mounted) return;
        if (!hasCached) setLoading(false);
      }
    }

    void load();
    return () => {
      mounted = false;
    };
  }, []);

  // ✅ Build: section -> categories -> services
  const uiSections: UiSection[] = useMemo(() => {
    const catsBySection = new Map<string, CategoryRow[]>();
    categories.forEach((c) => {
      if (!c.sectionId) return;
      const list = catsBySection.get(c.sectionId) || [];
      list.push(c);
      catsBySection.set(c.sectionId, list);
    });

    const servicesByCategory = new Map<string, UiServiceItem[]>();
    const servicesBySectionNoCat = new Map<string, UiServiceItem[]>();

    services.forEach((s) => {
      if (!s.sectionId) return;
      const basePrice = Math.max(0, Number(s.price || 0));
      const hasSeasonPrice =
        s.seasonPrice !== null && s.seasonPrice !== undefined && String(s.seasonPrice) !== "";
      const seasonPrice = hasSeasonPrice ? Math.max(0, Number(s.seasonPrice || 0)) : null;
      const item: UiServiceItem = {
        id: s.id,
        name: s.name,
        basePrice,
        seasonPrice,
        displayPrice: pickEffectivePrice({
          basePrice,
          seasonPrice: seasonPrice ?? undefined,
          appSettings,
        }).price,
      };

      if (s.categoryId) {
        const list = servicesByCategory.get(s.categoryId) || [];
        list.push(item);
        servicesByCategory.set(s.categoryId, list);
      } else {
        const list = servicesBySectionNoCat.get(s.sectionId) || [];
        list.push(item);
        servicesBySectionNoCat.set(s.sectionId, list);
      }
    });

    return sections
      .map((sec) => {
        const ui = uiBySectionId[sec.id];
        const icon =
          ui?.icon ||
          (sec.name.includes("شعر") ? faCut :
            sec.name.includes("صبغ") ? faPaintBrush :
              sec.name.includes("منزل") ? faStar :
                faList);
        const image = ui?.image || packagesImg;
        const description =
          ui?.description ||
          `اكتشفي أفضل خدمات ${sec.name} المتوفرة لدينا بجودة عالية.`;

        const cats = (catsBySection.get(sec.id) || []).sort(
          (a, b) => (a.order ?? 0) - (b.order ?? 0)
        );

        const uiCats: UiCategory[] = cats.map((cat) => {
          const items = (servicesByCategory.get(cat.id) || [])
            .filter((x) => x.name)
            .sort((a, b) => a.name.localeCompare(b.name, "ar"));
          return { id: cat.id, name: cat.name || cat.id, items };
        });

        // fallback: خدمات بدون categoryId
        const uncategorized = (servicesBySectionNoCat.get(sec.id) || [])
          .filter((x) => x.name)
          .sort((a, b) => a.name.localeCompare(b.name, "ar"));

        if (uncategorized.length > 0) {
          uiCats.unshift({ id: "__uncat__", name: "خدمات القسم", items: uncategorized });
        }

        const filteredCats = uiCats.filter((c) => c.items.length > 0);
        const totalServices = filteredCats.reduce((sum, c) => sum + c.items.length, 0);

        if (totalServices === 0) return null;

        return {
          id: sec.id,
          title: sec.name || sec.id,
          icon,
          image,
          description,
          categories: filteredCats,
          totalServices,
        } as UiSection;
      })
      .filter(Boolean) as UiSection[];
  }, [sections, categories, services, uiBySectionId, appSettings]);

  return (
    // ✅ مهم: offers-page عشان Offers.css (scoped) يشتغل 1:1
    <div className="services-page offers-page">
      {/* HERO بسيط */}
      <section className="bg-gradient-primary py-5">
        <div className="container">
          <div className="text-center">
            <h1 className="display-5 fw-bold text-gradient mb-2 qs-wine">خدماتنا</h1>
            <p className="lead text-gray fw-semibold mb-0">
              اختاري القسم ثم افتحي التصنيف وشوفي الخدمات والأسعار
            </p>
          </div>
        </div>
      </section>

      <section className="py-5">
        <div className="container">
          {loading ? (
            <div className="services-state">جاري تحميل الخدمات…</div>
          ) : error ? (
            <div className="services-state is-error">{error}</div>
          ) : uiSections.length === 0 ? (
            <div className="services-state">
              ما فيه خدمات ظاهرة حالياً (تأكدي إن الأقسام/التصنيفات/الخدمات active).
            </div>
          ) : (
            <div className="cards-grid-2">
              {uiSections.map((sec, index) => {
                const isHairSection =
                  /hair/i.test(String(sec.id || "")) || /شعر/i.test(String(sec.title || ""));
                const isHairGuideOpen = openHairGuideSectionId === sec.id;
                return (
                  <div key={sec.id}>
                    {/* ✅ نفس كرت العروض */}
                    <div
                      className="offer-card-enhanced"
                      style={{ animationDelay: `${index * 0.05}s` }}
                    >
                      {/* badge removed */}

                      {/* ✅ Image header مثل الصورة */}
                      <button
                        type="button"
                        className={[
                          "offer-image",
                          isHairSection ? "services-hair-guide-trigger" : "",
                          isHairGuideOpen ? "is-open" : "",
                        ].join(" ")}
                        style={{ backgroundImage: `url(${sec.image})` }}
                        aria-label={isHairSection ? `${sec.title} - دليل أطوال الشعر` : sec.title}
                        onClick={() => {
                          if (!isHairSection) return;
                          setOpenHairGuideSectionId((prev) => (prev === sec.id ? null : sec.id));
                        }}
                        title={isHairSection ? "اضغطي لعرض/إغلاق دليل أطوال الشعر" : sec.title}
                      >
                        {isHairSection && (
                          <span className="services-hair-guide-trigger-badge">
                            {isHairGuideOpen ? "إغلاق دليل الأطوال" : "عرض دليل الأطوال"}
                          </span>
                        )}
                      </button>

                      {isHairSection && isHairGuideOpen && (
                        <div className="services-hair-guide-panel">
                          <img
                            src={hairGuideImg}
                            alt="دليل أطوال الشعر"
                            className="services-hair-guide-image"
                          />
                        </div>
                      )}

                      <div className="offer-content">
                        {/* ✅ عنوان داخل الجسم مثل الصورة */}
                        <h3 className="offer-title">{sec.title}</h3>

                        {/* ✅ نفس mini-row كبسولات */}
                        <div className="offer-mini-row" style={{ flexWrap: "wrap" }}>
                          <span className="discount-badge">
                            <FontAwesomeIcon icon={faList} className="me-2" />
                            {sec.categories.length} تصنيف
                          </span>

                          <span className="save-badge">
                            عدد الخدمات: <b>{sec.totalServices}</b>
                          </span>

                          <span className="status-pill season-period season-period-title">
                            {seasonRangeTitle}
                          </span>
                          <span className="status-pill season-period season-period-greg">
                            {seasonRangeLabelGregorian}
                          </span>
                        </div>

                        {/* ✅ نفس شريط رمادي (بدل التاريخ) */}
                        <div className="offer-validity">{sec.description}</div>

                        {/* ✅ التصنيفات = نفس زر "عرض التفاصيل" لكن باسم التصنيف */}
                        <div className="services-cat-stack">
                          {sec.categories.map((cat) => {
                            const key = `${sec.id}__${cat.id}`;
                            const expanded = !!openCatKeys[key];

                            return (
                              <div key={key} className="services-cat-item">
                                <button
                                  type="button"
                                  className={["toggle-details", expanded ? "is-open" : ""].join(" ")}
                                  onClick={(e) => {
                                    toggleCategoryDetails(key, e.currentTarget);
                                  }}
                                >
                                  <span>{cat.name}</span>
                                  <FontAwesomeIcon icon={expanded ? faChevronUp : faChevronDown} />
                                </button>

                                {expanded && (
                                  <div className="offer-details services-cat-details">
                                    <ul className="services-items">
                                      {cat.items.map((it) => (
                                        <li key={it.id} className="services-li">
                                          <span className="services-item-name">{it.name}</span>
                                          <span className="services-item-price">
                                            {`${formatMoney(it.displayPrice)} ريال`}
                                          </span>
                                          {false && (
                                            <>
                                          <span className="services-item-price">
                                            {`العادي: ${formatMoney(it.basePrice)} ريال`}
                                          </span>
                                          <span
                                            className={[
                                              "services-item-price",
                                              "services-item-price-season",
                                            ].join(" ")}
                                          >
                                            {`الموسم: ${
                                              it.seasonPrice === null
                                                ? "غير محدد"
                                                : `${formatMoney(it.seasonPrice)} ريال`
                                            }`}
                                          </span>
                                            </>
                                          )}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ✅ زر واحد آخر الصفحة */}
          {!loading && !error && uiSections.length > 0 && (
            <div className="services-bottom-cta">
              <Link to="/booking" className="offers-cta-btn">
                الانتقال للحجز
              </Link>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
