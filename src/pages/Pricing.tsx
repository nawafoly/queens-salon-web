// src/pages/Pricing.tsx
import { useEffect, useMemo, useState, type FC } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCut,
  faPalette,
  faEye,
  faHandSparkles,
  faStar,
  faClock,
  faXmark,
  faMagic,
  faSpa,
} from "@fortawesome/free-solid-svg-icons";
import Modal from "../components/Modal";
import { AppSettingsService } from "../services/AppSettingsService";
import { pickEffectivePrice } from "../helpers/seasonPricing";

// ✅ Firestore
import { collection, getDocs, orderBy, query, where } from "firebase/firestore";
import { db } from "../services/firebase";

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

/** ✅ مهم: نخليها موجودة عشان أي صفحة ثانية تستوردها ما تنكسر */
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
          { name: "بدكير ومناكير كامل يد ورجل (الأدوات مجاناً)", price: "190 ريال" },
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
  const cleaned = priceText.replace(/[^\d\-]/g, "");
  if (!cleaned) return null;
  const parts = cleaned
    .split("-")
    .filter(Boolean)
    .map((n) => Number(n));
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

/** ===== Firestore Types (خفيفة) ===== */
type FsSection = {
  name?: string;
  active?: boolean;
  order?: number;
};

type FsService = {
  name?: string;
  active?: boolean;
  sectionId?: string;
  price?: number;
  seasonPrice?: number | null;
  // اختياري:
  categoryName?: string; // لو موجود عندك
  note?: string;
};

type FsSectionDoc = {
  id: string;
  data: FsSection;
};

type FsServiceDoc = {
  id: string;
  data: FsService;
};

const SALON_ID = "main";

function iconAndColorForSection(sectionIdOrName: string) {
  const key = String(sectionIdOrName || "").toLowerCase();

  if (key.includes("hair") || key.includes("شعر")) return { icon: faCut, color: "primary" };
  if (key.includes("color") || key.includes("صبغ") || key.includes("صبغات")) return { icon: faPalette, color: "secondary" };
  if (key.includes("make") || key.includes("مكياج")) return { icon: faEye, color: "accent" };
  if (key.includes("nail") || key.includes("اظافر") || key.includes("أظافر") || key.includes("مانيكير") || key.includes("بديكير")) {
    return { icon: faHandSparkles, color: "info" };
  }
  if (key.includes("wax") || key.includes("شمع") || key.includes("إزالة")) return { icon: faStar, color: "warning" };
  if (key.includes("skin") || key.includes("بشر") || key.includes("بشرة")) return { icon: faSpa, color: "secondary" };
  if (key.includes("massage") || key.includes("مساج")) return { icon: faHandSparkles, color: "primary" };
  if (key.includes("pack") || key.includes("باقات")) return { icon: faMagic, color: "accent" };

  return { icon: faStar, color: "primary" };
}

const Pricing: FC = () => {
  const [openSectionId, setOpenSectionId] = useState<string | null>(null);
  const [appSettings, setAppSettings] = useState<any>(() => AppSettingsService.getCached?.() || {});

  // ✅ Firestore (لو انقرأت)
  const [fsSections, setFsSections] = useState<Record<string, PricingSection> | null>(null);
  const [, setFsSectionDocs] = useState<FsSectionDoc[] | null>(null);
  const [, setFsServiceDocs] = useState<FsServiceDoc[] | null>(null);
  const [loadingFs, setLoadingFs] = useState(false);

  useEffect(() => {
    const unsub = AppSettingsService.subscribe((remote: any) => {
      setAppSettings(remote || {});
    });
    return () => unsub();
  }, []);

  // ===== Fetch from Firestore =====
  useEffect(() => {
    let mounted = true;

    const run = async () => {
      try {
        setLoadingFs(true);

        const sectionsRef = collection(db, "salons", SALON_ID, "service_sections");
        const servicesRef = collection(db, "salons", SALON_ID, "services");

        // Sections
        const sectionsSnap = await getDocs(query(sectionsRef, orderBy("order", "asc")));
        const sections: FsSectionDoc[] = sectionsSnap.docs.map((d) => ({
          id: d.id,
          data: d.data() as FsSection,
        }));

        // Services (active only)
        const servicesSnap = await getDocs(query(servicesRef, where("active", "==", true)));
        const services: FsServiceDoc[] = servicesSnap.docs.map((d) => ({
          id: d.id,
          data: d.data() as FsService,
        }));

        if (!sections.length || !services.length) {
          if (mounted) {
            setFsSectionDocs(null);
            setFsServiceDocs(null);
          }
          return;
        }

        // Group services by sectionId
        const bySection: Record<string, Array<FsService>> = {};
        services.forEach((s) => {
          const secId = String(s.data.sectionId || "").trim();
          if (!secId) return;
          if (!bySection[secId]) bySection[secId] = [];
          bySection[secId].push(s.data);
        });

        // Build PricingSections
        const built: Record<string, PricingSection> = {};

        sections.forEach((sec) => {
          const secId = sec.id;
          const secName = String(sec.data.name || secId);

          const iconMeta = iconAndColorForSection(`${secId} ${secName}`);

          const list = (bySection[secId] || [])
            .filter((x) => x && x.name && typeof x.price === "number")
            .sort((a, b) => (a.price ?? 0) - (b.price ?? 0));

          if (!list.length) return;

          const groupedByCat: Record<string, PriceItem[]> = {};

          list.forEach((srv) => {
            const displayPrice = pickEffectivePrice({
              basePrice: Number(srv.price || 0),
              seasonPrice:
                srv.seasonPrice === null || srv.seasonPrice === undefined || String(srv.seasonPrice) === ""
                  ? undefined
                  : Number(srv.seasonPrice || 0),
              appSettings,
            }).price;
            srv.price = Number(displayPrice || 0);
            const cat = String(srv.categoryName || "الخدمات");
            if (!groupedByCat[cat]) groupedByCat[cat] = [];
            groupedByCat[cat].push({
              name: String(srv.name),
              price: `${Number(srv.price)} ريال`,
              note: srv.note ? String(srv.note) : undefined,
            });
          });

          const servicesCats: ServiceCategory[] = Object.entries(groupedByCat).map(([catName, items]) => ({
            category: catName,
            items,
          }));

          built[secId] = {
            title: secName,
            icon: iconMeta.icon,
            color: iconMeta.color,
            services: servicesCats,
          };
        });

        if (mounted) setFsSections(Object.keys(built).length ? built : null);
      } catch (e) {
        console.error("Pricing Firestore load error:", e);
        if (mounted) setFsSections(null);
      } finally {
        if (mounted) setLoadingFs(false);
      }
    };

    run();
    return () => {
      mounted = false;
    };
  }, [appSettings]);

  // ✅ المصدر النهائي للعرض
  const sourceSections = fsSections ?? pricingSections;

  const sectionCards = useMemo(() => {
    return Object.entries(sourceSections).map(([id, sec]) => ({
      id,
      title: sec.title,
      icon: sec.icon,
      color: sec.color,
      count: countItems(sec),
      minPrice: minPriceInSection(sec),
      section: sec,
    }));
  }, [sourceSections]);

  const active = useMemo(() => {
    if (!openSectionId) return null;
    return sectionCards.find((s) => s.id === openSectionId) || null;
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
        <div className="pricing-header text-center">
          <h1 className="pricing-title">قائمة الأسعار</h1>
          <p className="pricing-subtitle">اختاري القسم واطلعي على التفاصيل بدون زحمة جداول طويلة</p>

          <p className="pricing-subtitle pricing-hint">
            {loadingFs
              ? "جاري تحميل الأسعار من النظام..."
              : fsSections
              ? "✅ الأسعار متزامنة من Firestore"
              : "ℹ️ عرض احتياطي (Fallback) حتى تكتمل بيانات Firestore"}
          </p>
        </div>

        <div className="pricing-cards">
          {sectionCards.map((s) => (
            <button key={s.id} type="button" className="pricing-card" onClick={() => setOpenSectionId(s.id)}>
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

      {active && (
        <Modal
          open={!!active}
          onClose={() => setOpenSectionId(null)}
          ariaLabel={active?.title || "تفاصيل الأسعار"}
          panelClassName="pricing-modal"
          size="lg"
        >
            <div className="modal-header">
              <div className="modal-header-left">
                <div className={`modal-icon card-icon-${active.color}`}>
                  <FontAwesomeIcon icon={active.icon} />
                </div>
                <div>
                  <div className="modal-title">{active.title}</div>
                  <div className="modal-sub">
                    {active.count} خدمة • يبدأ من {active.minPrice !== null ? `${active.minPrice} ريال` : "—"}
                  </div>
                </div>
              </div>

              <button type="button" className="modal-close" onClick={() => setOpenSectionId(null)} aria-label="إغلاق">
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
                          {it.note ? <div className="name-note">{it.note}</div> : null}
                        </div>
                        <div className="modal-price">{it.price}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="modal-footer">
              <button type="button" className="modal-primary" onClick={() => setOpenSectionId(null)}>
                تم
              </button>
            </div>
        </Modal>
      )}
    </div>
  );
};

export default Pricing;
