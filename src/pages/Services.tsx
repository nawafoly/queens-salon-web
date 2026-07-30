// src/pages/Services.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, MouseEvent } from "react";
import { Link } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowLeft,
  faCalendarCheck,
  faChevronDown,
  faChevronUp,
  faCut,
  faHandSparkles,
  faLayerGroup,
  faList,
  faMagic,
  faMagnifyingGlass,
  faPaintBrush,
  faSpa,
  faStar,
  faTag,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";

import "../styles/ServicesMobile.css";

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

import { CoreCatalogService } from "../services/CoreCatalogService";
import { AppSettingsService } from "../services/AppSettingsService";
import { isSeasonActiveNow, pickEffectivePrice } from "../helpers/seasonPricing";

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
    order: Number(raw?.order ?? raw?.sortOrder ?? 0),
  };
}

function normalizeCategoryRow(raw: any, id = ""): CategoryRow {
  return {
    id: String(id || raw?.id || "").trim(),
    sectionId: String(raw?.sectionId || "").trim(),
    name: String(raw?.name || "").trim(),
    active: Boolean(raw?.active ?? true),
    order: Number(raw?.order ?? raw?.sortOrder ?? 0),
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
    price: Math.max(0, Number(raw?.price ?? Number(raw?.priceHalalas ?? 0) / 100)),
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
    // Local cache is optional.
  }
}

function normalizeSearch(value: string) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("ar")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي");
}

function formatMoney(value: number | null | undefined) {
  return new Intl.NumberFormat("ar-SA-u-nu-latn", {
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function parseIsoDateLocal(dateISO: string): Date | null {
  const match = String(dateISO || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function formatSeasonDateGregorian(dateISO: string) {
  const date = parseIsoDateLocal(dateISO);
  if (!date) return dateISO;

  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

export default function Services() {
  const [loading, setLoading] = useState(true);
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [appSettings, setAppSettings] = useState<any>(() => AppSettingsService.getCached?.() || {});
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [openCatKeys, setOpenCatKeys] = useState<Record<string, true>>({});
  const [openHairGuideSectionId, setOpenHairGuideSectionId] = useState<string | null>(null);
  const scrollStabilizeTimersRef = useRef<number[]>([]);

  useEffect(() => {
    return () => {
      if (typeof window === "undefined") return;
      for (const timer of scrollStabilizeTimersRef.current) window.clearTimeout(timer);
      scrollStabilizeTimersRef.current = [];
    };
  }, []);

  const toggleCategoryDetails = (key: string, triggerEl?: HTMLButtonElement | null) => {
    if (typeof window !== "undefined") {
      for (const timer of scrollStabilizeTimersRef.current) window.clearTimeout(timer);
      scrollStabilizeTimersRef.current = [];
    }

    const previousWindowY =
      typeof window !== "undefined"
        ? Math.max(
            window.scrollY || 0,
            document.documentElement.scrollTop || 0,
            document.body.scrollTop || 0,
          )
        : 0;

    setOpenCatKeys((previous) => {
      const next = { ...previous };
      if (next[key]) delete next[key];
      else next[key] = true;
      return next;
    });

    if (typeof window === "undefined") return;

    const stabilizeScroll = () => {
      window.scrollTo({ top: Math.max(0, previousWindowY), behavior: "auto" });
      triggerEl?.blur();
    };

    window.requestAnimationFrame(stabilizeScroll);
    for (const delay of [50, 140, 280]) {
      const timer = window.setTimeout(stabilizeScroll, delay);
      scrollStabilizeTimersRef.current.push(timer);
    }
  };

  const uiBySectionId = useMemo(
    () =>
      ({
        "hair-care": {
          image: hair,
          icon: faCut,
          description: "قص وتصفيف وعناية متخصصة تمنح شعرك مظهرًا صحيًا ومتجددًا.",
        },
        "skin-care": {
          image: skin,
          icon: faSpa,
          description: "جلسات تنظيف وترطيب وعناية مختارة لبشرة أكثر نضارة وراحة.",
        },
        "nail-care": {
          image: nails,
          icon: faHandSparkles,
          description: "مانيكير وباديكير وتفاصيل أنيقة بلمسات دقيقة وألوان عصرية.",
        },
        makeup: {
          image: makeupImg,
          icon: faPaintBrush,
          description: "إطلالات مكياج احترافية للمناسبات والأعراس بمستويات متعددة.",
        },
        massage: {
          image: massageImg,
          icon: faStar,
          description: "جلسات استرخاء تساعد على تخفيف التوتر واستعادة الحيوية.",
        },
        "special-packages": {
          image: packagesImg,
          icon: faMagic,
          description: "باقات تجمع خدمات مختارة بقيمة أفضل وتجربة أكثر تكاملًا.",
        },
        services: {
          image: servicesImg,
          icon: faList,
          description: "مجموعة متنوعة من خدمات الصالون المنفذة بعناية واحترافية.",
        },
        "home-services": {
          image: homeServicesImg,
          icon: faStar,
          description: "خدمات مختارة تصل إليك في المنزل براحة وخصوصية أكبر.",
        },
        "hair-color-treatments": {
          image: hairColorTreatmentsImg,
          icon: faPaintBrush,
          description: "صبغات وعلاجات شعر متخصصة بتقنيات حديثة ونتائج مدروسة.",
        },
      }) as Record<string, { image: string; icon: any; description: string }>,
    [],
  );

  useEffect(() => {
    const unsubscribe = AppSettingsService.subscribe((remote: any) => {
      setAppSettings(remote || {});
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    let mounted = true;
    const cached = readServicesPageCache();
    const hasCached = Boolean(cached);

    if (cached) {
      setSections(cached.sections.filter((section) => section.active !== false));
      setCategories(cached.categories.filter((category) => category.active !== false));
      setServices(cached.services.filter((service) => service.active !== false));
      setLoading(false);
    }

    async function load() {
      if (!hasCached) setLoading(true);
      setError(null);

      try {
        const [sectionDocs, categoryDocs, serviceDocs] = await Promise.all([
          CoreCatalogService.listSections(true),
          CoreCatalogService.listCategories(true),
          CoreCatalogService.listServices({ activeOnly: true }),
        ]);

        const sectionRows: SectionRow[] = sectionDocs
          .map((row: any) => normalizeSectionRow(row, row.id))
          .filter((row: SectionRow) => row.id && row.name && row.active !== false);
        const categoryRows: CategoryRow[] = categoryDocs
          .map((row: any) => normalizeCategoryRow(row, row.id))
          .filter((row: CategoryRow) => row.id && row.sectionId && row.name && row.active !== false);
        const serviceRows: ServiceRow[] = serviceDocs
          .map((row: any) => normalizeServiceRow(row, row.id))
          .filter((row: ServiceRow) => row.id && row.sectionId && row.name && row.active !== false);

        if (!mounted) return;

        setSections(sectionRows);
        setCategories(categoryRows);
        setServices(serviceRows);
        writeServicesPageCache({
          sections: sectionRows,
          categories: categoryRows,
          services: serviceRows,
        });
      } catch (loadError: any) {
        if (!mounted) return;
        console.error("Core public services load error:", loadError);
        if (!hasCached) setError(loadError?.message || "تعذر تحميل الخدمات الآن.");
      } finally {
        if (mounted && !hasCached) setLoading(false);
      }
    }

    void load();
    return () => {
      mounted = false;
    };
  }, []);

  const uiSections = useMemo<UiSection[]>(() => {
    const catsBySection = new Map<string, CategoryRow[]>();
    for (const category of categories) {
      const list = catsBySection.get(category.sectionId) || [];
      list.push(category);
      catsBySection.set(category.sectionId, list);
    }

    const servicesByCategory = new Map<string, UiServiceItem[]>();
    const servicesBySectionNoCat = new Map<string, UiServiceItem[]>();

    for (const service of services) {
      const basePrice = Math.max(0, Number(service.price || 0));
      const hasSeasonPrice =
        service.seasonPrice !== null &&
        service.seasonPrice !== undefined &&
        String(service.seasonPrice) !== "";
      const seasonPrice = hasSeasonPrice ? Math.max(0, Number(service.seasonPrice || 0)) : null;
      const item: UiServiceItem = {
        id: service.id,
        name: service.name,
        basePrice,
        seasonPrice,
        displayPrice: pickEffectivePrice({
          basePrice,
          seasonPrice: seasonPrice ?? undefined,
          appSettings,
        }).price,
      };

      if (service.categoryId) {
        const list = servicesByCategory.get(service.categoryId) || [];
        list.push(item);
        servicesByCategory.set(service.categoryId, list);
      } else {
        const list = servicesBySectionNoCat.get(service.sectionId) || [];
        list.push(item);
        servicesBySectionNoCat.set(service.sectionId, list);
      }
    }

    return sections
      .slice()
      .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
      .map((section) => {
        const configuredUi = uiBySectionId[section.id];
        const icon =
          configuredUi?.icon ||
          (section.name.includes("شعر")
            ? faCut
            : section.name.includes("صبغ")
              ? faPaintBrush
              : section.name.includes("منزل")
                ? faStar
                : faList);
        const image = configuredUi?.image || packagesImg;
        const description =
          configuredUi?.description || `خدمات ${section.name} بخيارات متعددة وأسعار واضحة.`;

        const sectionCategories = (catsBySection.get(section.id) || [])
          .slice()
          .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
          .map((category) => ({
            id: category.id,
            name: category.name || category.id,
            items: (servicesByCategory.get(category.id) || [])
              .filter((item) => item.name)
              .sort((left, right) => left.name.localeCompare(right.name, "ar")),
          }));

        const uncategorized = (servicesBySectionNoCat.get(section.id) || [])
          .filter((item) => item.name)
          .sort((left, right) => left.name.localeCompare(right.name, "ar"));

        if (uncategorized.length) {
          sectionCategories.unshift({
            id: "__uncat__",
            name: "خدمات القسم",
            items: uncategorized,
          });
        }

        const visibleCategories = sectionCategories.filter((category) => category.items.length > 0);
        const totalServices = visibleCategories.reduce(
          (total, category) => total + category.items.length,
          0,
        );

        if (!totalServices) return null;

        return {
          id: section.id,
          title: section.name || section.id,
          icon,
          image,
          description,
          categories: visibleCategories,
          totalServices,
        } as UiSection;
      })
      .filter(Boolean) as UiSection[];
  }, [appSettings, categories, sections, services, uiBySectionId]);

  const normalizedQuery = normalizeSearch(searchQuery);

  const filteredSections = useMemo<UiSection[]>(() => {
    if (!normalizedQuery) return uiSections;

    return uiSections
      .map((section) => {
        const sectionMatches = normalizeSearch(`${section.title} ${section.description}`).includes(
          normalizedQuery,
        );

        const matchedCategories = section.categories
          .map((category) => {
            const categoryMatches = normalizeSearch(category.name).includes(normalizedQuery);
            const items =
              sectionMatches || categoryMatches
                ? category.items
                : category.items.filter((item) =>
                    normalizeSearch(item.name).includes(normalizedQuery),
                  );
            return { ...category, items };
          })
          .filter((category) => category.items.length > 0);

        const totalServices = matchedCategories.reduce(
          (total, category) => total + category.items.length,
          0,
        );

        return totalServices ? { ...section, categories: matchedCategories, totalServices } : null;
      })
      .filter(Boolean) as UiSection[];
  }, [normalizedQuery, uiSections]);

  const catalogSummary = useMemo(() => {
    const allItems = uiSections.flatMap((section) =>
      section.categories.flatMap((category) => category.items),
    );
    const prices = allItems.map((item) => item.displayPrice).filter((price) => price > 0);

    return {
      sections: uiSections.length,
      services: allItems.length,
      startingPrice: prices.length ? Math.min(...prices) : 0,
    };
  }, [uiSections]);

  const seasonInfo = useMemo(() => {
    const season = (appSettings as any)?.catalogSeasonPricing || {};
    const from = String(season?.startDate || season?.from || "").trim();
    const to = String(season?.endDate || season?.to || "").trim();
    const active = isSeasonActiveNow(appSettings);

    let range = "";
    if (from && to) {
      range = `${formatSeasonDateGregorian(from)} — ${formatSeasonDateGregorian(to)}`;
    } else if (from) {
      range = `يبدأ ${formatSeasonDateGregorian(from)}`;
    } else if (to) {
      range = `حتى ${formatSeasonDateGregorian(to)}`;
    }

    return { active, range };
  }, [appSettings]);

  const scrollToSection = (sectionId: string) => {
    const target = document.getElementById(`services-section-${sectionId}`);
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <main className="services-page" dir="rtl">
      <section className="services-hero" aria-labelledby="services-page-title">
        <div className="services-hero__glow services-hero__glow--one" />
        <div className="services-hero__glow services-hero__glow--two" />

        <div className="services-shell services-hero__inner">
          <div className="services-hero__copy">
            <span className="services-eyebrow">
              <FontAwesomeIcon icon={faMagic} />
              اختاري تجربتك
            </span>
            <h1 id="services-page-title">خدمات ملكات</h1>
            <p>
              قائمة واضحة ومحدثة لكل خدماتنا. ابحثي عن الخدمة، قارني السعر، ثم انتقلي
              للحجز بخطوة واحدة.
            </p>

            <div className="services-hero__actions">
              <Link to="/booking" className="services-primary-action">
                <FontAwesomeIcon icon={faCalendarCheck} />
                احجزي موعدك
                <FontAwesomeIcon icon={faArrowLeft} />
              </Link>
              <button
                type="button"
                className="services-secondary-action"
                onClick={() => document.getElementById("services-catalog")?.scrollIntoView({ behavior: "smooth" })}
              >
                تصفح الأسعار
              </button>
            </div>
          </div>

          <div className="services-hero__summary" aria-label="ملخص قائمة الخدمات">
            <div className="services-summary-card services-summary-card--wide">
              <span className="services-summary-card__icon">
                <FontAwesomeIcon icon={faLayerGroup} />
              </span>
              <div>
                <strong>{catalogSummary.sections}</strong>
                <span>أقسام متخصصة</span>
              </div>
            </div>
            <div className="services-summary-card">
              <strong>{catalogSummary.services}</strong>
              <span>خدمة متاحة</span>
            </div>
            <div className="services-summary-card">
              <strong>{catalogSummary.startingPrice ? formatMoney(catalogSummary.startingPrice) : "—"}</strong>
              <span>ريال تبدأ الأسعار</span>
            </div>
          </div>
        </div>
      </section>

      <section id="services-catalog" className="services-catalog-section">
        <div className="services-shell">
          <div className="services-toolbar">
            <label className="services-search">
              <FontAwesomeIcon icon={faMagnifyingGlass} />
              <input
                type="search"
                value={searchQuery}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setSearchQuery(event.target.value)}
                placeholder="ابحثي عن خدمة أو تصنيف..."
                aria-label="البحث في الخدمات"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  aria-label="مسح البحث"
                >
                  <FontAwesomeIcon icon={faXmark} />
                </button>
              )}
            </label>

            {!loading && !error && uiSections.length > 0 && (
              <div className="services-section-nav" aria-label="التنقل بين أقسام الخدمات">
                {uiSections.map((section) => (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => scrollToSection(section.id)}
                  >
                    <FontAwesomeIcon icon={section.icon} />
                    <span>{section.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {seasonInfo.active && (
            <div className="services-season-banner">
              <span className="services-season-banner__icon">
                <FontAwesomeIcon icon={faTag} />
              </span>
              <div>
                <strong>أسعار الموسم مفعلة الآن</strong>
                <span>{seasonInfo.range || "الأسعار الظاهرة هي الأسعار الموسمية الحالية."}</span>
              </div>
            </div>
          )}

          {loading ? (
            <div className="services-skeleton-grid" aria-label="جاري تحميل الخدمات">
              {[0, 1, 2].map((item) => (
                <div className="services-skeleton" key={item}>
                  <span className="services-skeleton__media" />
                  <div className="services-skeleton__body">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="services-state services-state--error">
              <strong>تعذر عرض الخدمات</strong>
              <span>{error}</span>
            </div>
          ) : filteredSections.length === 0 ? (
            <div className="services-state">
              <span className="services-state__icon">
                <FontAwesomeIcon icon={faMagnifyingGlass} />
              </span>
              <strong>ما لقينا نتيجة مطابقة</strong>
              <span>جرّبي كتابة اسم أقصر أو ابحثي باسم التصنيف.</span>
              <button type="button" onClick={() => setSearchQuery("")}>عرض كل الخدمات</button>
            </div>
          ) : (
            <div className="services-sections-list">
              {filteredSections.map((section, sectionIndex) => {
                const allSectionItems = section.categories.flatMap((category) => category.items);
                const startingPrice = Math.min(
                  ...allSectionItems.map((item) => item.displayPrice).filter((price) => price > 0),
                );
                const isHairSection =
                  /hair/i.test(section.id) || /شعر/i.test(section.title);
                const hairGuideOpen = openHairGuideSectionId === section.id;

                return (
                  <article
                    key={section.id}
                    id={`services-section-${section.id}`}
                    className="services-section-card"
                    style={{ animationDelay: `${sectionIndex * 45}ms` }}
                  >
                    <div className="services-section-card__media">
                      <img src={section.image} alt="" loading="lazy" />
                      <span className="services-section-card__shade" />
                      <span className="services-section-card__icon">
                        <FontAwesomeIcon icon={section.icon} />
                      </span>

                      <div className="services-section-card__media-copy">
                        <span>{section.categories.length} تصنيف</span>
                        <strong>{section.totalServices} خدمة</strong>
                      </div>

                      {isHairSection && (
                        <button
                          type="button"
                          className="services-hair-guide-button"
                          onClick={() =>
                            setOpenHairGuideSectionId((previous) =>
                              previous === section.id ? null : section.id,
                            )
                          }
                          aria-expanded={hairGuideOpen}
                        >
                          {hairGuideOpen ? "إغلاق دليل الأطوال" : "دليل أطوال الشعر"}
                        </button>
                      )}
                    </div>

                    <div className="services-section-card__content">
                      <header className="services-section-card__header">
                        <div>
                          <span className="services-section-card__kicker">قسم الجمال والعناية</span>
                          <h2>{section.title}</h2>
                          <p>{section.description}</p>
                        </div>
                        {Number.isFinite(startingPrice) && startingPrice > 0 && (
                          <div className="services-starting-price">
                            <span>تبدأ من</span>
                            <strong>{formatMoney(startingPrice)} <small>ريال</small></strong>
                          </div>
                        )}
                      </header>

                      {isHairSection && hairGuideOpen && (
                        <div className="services-hair-guide-panel">
                          <div className="services-hair-guide-panel__head">
                            <div>
                              <strong>دليل أطوال الشعر</strong>
                              <span>استخدمي الدليل لمعرفة فئة الطول المناسبة قبل الحجز.</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setOpenHairGuideSectionId(null)}
                              aria-label="إغلاق دليل أطوال الشعر"
                            >
                              <FontAwesomeIcon icon={faXmark} />
                            </button>
                          </div>
                          <img src={hairGuideImg} alt="دليل أطوال الشعر" />
                        </div>
                      )}

                      <div className="services-categories">
                        {section.categories.map((category, categoryIndex) => {
                          const key = `${section.id}__${category.id}`;
                          const expanded = Boolean(normalizedQuery) || Boolean(openCatKeys[key]);
                          const panelId = `services-panel-${section.id}-${category.id}`;

                          return (
                            <section
                              key={key}
                              className={`services-category ${expanded ? "is-open" : ""}`}
                            >
                              <button
                                type="button"
                                className="services-category__trigger"
                                onClick={(event: MouseEvent<HTMLButtonElement>) => toggleCategoryDetails(key, event.currentTarget)}
                                aria-expanded={expanded}
                                aria-controls={panelId}
                              >
                                <span className="services-category__number">
                                  {String(categoryIndex + 1).padStart(2, "0")}
                                </span>
                                <span className="services-category__title">
                                  <strong>{category.name}</strong>
                                  <small>{category.items.length} خدمة</small>
                                </span>
                                <span className="services-category__chevron">
                                  <FontAwesomeIcon icon={expanded ? faChevronUp : faChevronDown} />
                                </span>
                              </button>

                              {expanded && (
                                <div id={panelId} className="services-category__panel">
                                  <ul className="services-price-list">
                                    {category.items.map((item) => {
                                      const hasSeasonDiscount =
                                        seasonInfo.active &&
                                        item.seasonPrice !== null &&
                                        item.displayPrice !== item.basePrice;

                                      return (
                                        <li key={item.id} className="services-price-item">
                                          <div className="services-price-item__name">
                                            <span>{item.name}</span>
                                            {hasSeasonDiscount && <small>سعر موسمي</small>}
                                          </div>
                                          <div className="services-price-item__actions">
                                            <div className="services-price-item__price">
                                              {hasSeasonDiscount && (
                                                <del>{formatMoney(item.basePrice)}</del>
                                              )}
                                              <strong>
                                                {formatMoney(item.displayPrice)} <small>ريال</small>
                                              </strong>
                                            </div>
                                            <Link to="/booking" aria-label={`حجز خدمة ${item.name}`}>
                                              احجزي
                                              <FontAwesomeIcon icon={faArrowLeft} />
                                            </Link>
                                          </div>
                                        </li>
                                      );
                                    })}
                                  </ul>
                                </div>
                              )}
                            </section>
                          );
                        })}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {!loading && !error && uiSections.length > 0 && (
        <section className="services-final-cta">
          <div className="services-shell services-final-cta__inner">
            <div>
              <span>جاهزة لإطلالة جديدة؟</span>
              <h2>اختاري خدمتك واتركي الباقي علينا</h2>
              <p>الحجز الإلكتروني يتيح لك اختيار الخدمة والموظفة والوقت المناسب.</p>
            </div>
            <Link to="/booking" className="services-primary-action services-primary-action--light">
              <FontAwesomeIcon icon={faCalendarCheck} />
              ابدئي الحجز الآن
              <FontAwesomeIcon icon={faArrowLeft} />
            </Link>
          </div>
        </section>
      )}
    </main>
  );
}
