// src/pages/Services.tsx
import { useEffect, useMemo, useState } from "react";

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

import "../styles/Services.css";
// ✅ نستعمل نفس شكل كرت العروض 1:1
import "../styles/Offers.css";

// ✅ Firestore
import { collection, getDocs, query, orderBy, where } from "firebase/firestore";
import { db } from "../services/firebase";

const SALON_ID = "main";

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
  active?: boolean;
};

type UiServiceItem = { id: string; name: string; price: number };

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

export default function Services() {
  const [loading, setLoading] = useState(true);
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // ✅ فتح/إغلاق (تصنيف) مثل "عرض التفاصيل"
  const [openCatKey, setOpenCatKey] = useState<string | null>(null);

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
    let mounted = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        // ✅ 1) Sections
        const sectionsRef = collection(db, "salons", SALON_ID, "service_sections");
        const sectionsQ = query(sectionsRef, orderBy("order", "asc"));
        const sectionsSnap = await getDocs(sectionsQ);

        const sectionsRows: SectionRow[] = sectionsSnap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            name: String(data?.name || ""),
            active: Boolean(data?.active ?? true),
            order: Number(data?.order ?? 0),
          };
        });

        // ✅ 2) Categories
        const catsRef = collection(db, "salons", SALON_ID, "service_categories");
        const catsQ = query(catsRef, orderBy("order", "asc"));
        const catsSnap = await getDocs(catsQ);

        const catsRows: CategoryRow[] = catsSnap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            sectionId: String(data?.sectionId || ""),
            name: String(data?.name || ""),
            active: Boolean(data?.active ?? true),
            order: Number(data?.order ?? 0),
          };
        });

        // ✅ 3) Services (active only)
        const servicesRef = collection(db, "salons", SALON_ID, "services");
        const servicesQ = query(servicesRef, where("active", "==", true));
        const servicesSnap = await getDocs(servicesQ);

        const servicesRows: ServiceRow[] = servicesSnap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            name: String(data?.name || ""),
            sectionId: String(data?.sectionId || ""),
            categoryId: data?.categoryId ? String(data.categoryId) : undefined,
            price: Number(data?.price ?? 0),
            active: Boolean(data?.active ?? true),
          };
        });

        if (!mounted) return;

        setSections(sectionsRows.filter((s) => s.active !== false));
        setCategories(catsRows.filter((c) => c.active !== false));
        setServices(servicesRows);
      } catch (e: any) {
        if (!mounted) return;
        console.error("Services load error:", e);
        setError(e?.message || "صار خطأ أثناء تحميل الخدمات");
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    }

    load();
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
      const item: UiServiceItem = { id: s.id, name: s.name, price: s.price };

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
  }, [sections, categories, services, uiBySectionId]);

  return (
    // ✅ مهم: offers-page عشان Offers.css (scoped) يشتغل 1:1
    <div className="services-page offers-page">
      {/* HERO بسيط */}
      <section className="bg-gradient-primary py-5">
        <div className="container">
          <div className="text-center">
            <h1 className="display-5 fw-bold text-gradient mb-2">خدماتنا</h1>
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
                return (
                  <div key={sec.id}>
                    {/* ✅ نفس كرت العروض */}
                    <div
                      className="offer-card-enhanced"
                      style={{ animationDelay: `${index * 0.05}s` }}
                    >
                      {/* badge removed */}

                      {/* ✅ Image header مثل الصورة */}
                      <div
                        className="offer-image"
                        style={{ backgroundImage: `url(${sec.image})` }}
                        aria-label={sec.title}
                      />

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

                          <span className="status-pill active">متاح</span>
                        </div>

                        {/* ✅ نفس شريط رمادي (بدل التاريخ) */}
                        <div className="offer-validity">{sec.description}</div>

                        {/* ✅ التصنيفات = نفس زر "عرض التفاصيل" لكن باسم التصنيف */}
                        <div className="services-cat-stack">
                          {sec.categories.map((cat) => {
                            const key = `${sec.id}__${cat.id}`;
                            const expanded = openCatKey === key;

                            return (
                              <div key={key} className="services-cat-item">
                                <button
                                  type="button"
                                  className={["toggle-details", expanded ? "is-open" : ""].join(" ")}
                                  onClick={() => setOpenCatKey(expanded ? null : key)}
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
                                            {it.price} ريال
                                          </span>
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
