// src/pages/Services.tsx
import { useEffect, useMemo, useState } from "react";

// ✅ صور منتجات (لا تغيّر منطق الصور)
import hair from "../assets/images/hair.png";
import skin from "../assets/images/skin.png";
import nails from "../assets/images/nails.png";
import makeupImg from "../assets/images/makeup.png";
import massageImg from "../assets/images/massage.png";
import packagesImg from "../assets/images/packages.png";

import { Link } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCut,
  faSpa,
  faPaintBrush,
  faHandSparkles,
  faMagic,
  faStar,
} from "@fortawesome/free-solid-svg-icons";

import "../styles/Services.css";

// ✅ Firestore
import { collection, getDocs, query, orderBy, where } from "firebase/firestore";
import { db } from "../services/firebase";

const SALON_ID = "main";

type UiServiceItem = { name: string; price: number };

type UiServiceCategory = {
  id: string;
  title: string;
  icon: any;
  image: string;
  description: string;
  services: UiServiceItem[];
};

type SectionRow = {
  id: string;
  name: string;
  active?: boolean;
  order?: number;
};

type ServiceRow = {
  id: string;
  name: string;
  sectionId: string;
  price: number;
  active?: boolean;
};

export default function Services() {
  const [loading, setLoading] = useState(true);
  const [sections, setSections] = useState<SectionRow[]>([]);
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // ✅ ثوابت العرض (صور/وصف/أيقونة) حسب sectionId
  // مهم: sectionId هنا = doc.id داخل salons/main/service_sections
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
    } as Record<
      string,
      { image: string; icon: any; description: string }
    >;
  }, []);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        // ✅ 1) جلب الأقسام
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

        // ✅ 2) جلب الخدمات (active فقط)
        const servicesRef = collection(db, "salons", SALON_ID, "services");
        const servicesQ = query(servicesRef, where("active", "==", true));
        const servicesSnap = await getDocs(servicesQ);

        const servicesRows: ServiceRow[] = servicesSnap.docs.map((d) => {
          const data = d.data() as any;
          return {
            id: d.id,
            name: String(data?.name || ""),
            sectionId: String(data?.sectionId || ""),
            price: Number(data?.price ?? 0),
            active: Boolean(data?.active ?? true),
          };
        });

        if (!mounted) return;
        setSections(sectionsRows.filter((s) => s.active !== false));
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

  // ✅ بناء العرض النهائي: كل section + خدماته
  const serviceCategories: UiServiceCategory[] = useMemo(() => {
    const bySection = new Map<string, UiServiceItem[]>();
    services.forEach((s) => {
      if (!s.sectionId) return;
      const list = bySection.get(s.sectionId) || [];
      list.push({ name: s.name, price: s.price });
      bySection.set(s.sectionId, list);
    });

    return sections
      .map((sec) => {
        const ui = uiBySectionId[sec.id];
        const icon = ui?.icon || faStar;
        const image = ui?.image || packagesImg;
        const description = ui?.description || "خدمات متنوعة ومميزة داخل هذا القسم.";

        const items = (bySection.get(sec.id) || [])
          .filter((it) => it.name)
          .sort((a, b) => a.name.localeCompare(b.name, "ar"));

        return {
          id: sec.id,
          title: sec.name || sec.id,
          icon,
          image,
          description,
          services: items,
        };
      })
      .filter((c) => c.services.length > 0); // نخفي الأقسام الفاضية
  }, [sections, services, uiBySectionId]);

  return (
    <div className="services-page py-5">
      <div className="container">
        <h1 className="services-title text-center mb-2">خدماتنا</h1>
        <p className="services-subtitle text-center mb-5">
          نقدم لكِ مجموعة متكاملة من خدمات التجميل والعناية بالجمال
        </p>

        {loading ? (
          <div className="services-state">
            جاري تحميل الخدمات…
          </div>
        ) : error ? (
          <div className="services-state is-error">
            {error}
          </div>
        ) : serviceCategories.length === 0 ? (
          <div className="services-state">
            ما فيه خدمات ظاهرة حالياً (تأكدي إن الخدمات active ومربوطة بـ sectionId صحيح).
          </div>
        ) : (
          serviceCategories.map((category, idx) => (
            <div
              className={`service-category mb-5 ${idx % 2 === 1 ? "reverse" : ""}`}
              key={category.id}
              id={category.id}
            >
              <div className="row align-items-center">
                <div className="col-lg-6 mb-4 mb-lg-0">
                  <div className="service-category-image product-bg">
                    <img
                      src={category.image}
                      alt={category.title}
                      className="img-fluid rounded product-img"
                      loading="lazy"
                    />
                  </div>
                </div>

                <div className="col-lg-6">
                  <div className="service-category-content">
                    <div className="service-category-icon">
                      <FontAwesomeIcon icon={category.icon} />
                    </div>

                    <h2 className="service-category-title">{category.title}</h2>
                    <p className="service-category-description">
                      {category.description}
                    </p>

                    <div className="service-list">
                      {category.services.map((service, index) => (
                        <div className="service-item" key={index}>
                          <span className="service-name">{service.name}</span>
                          <span className="service-price">
                            {service.price} ريال
                          </span>
                        </div>
                      ))}
                    </div>

                    <Link
                      to="/booking"
                      className="services-primary-btn rounded-pill mt-4"
                    >
                      احجزي الآن
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
