// src/components/HomeServices.tsx
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

// ✅ صور (ثابتة حسب sectionId)
import hair from "../assets/images/hair.png";
import skin from "../assets/images/skin.png";
import nails from "../assets/images/nails.png";
import makeupImg from "../assets/images/makeup.png";
import massageImg from "../assets/images/massage.png";
import packagesImg from "../assets/images/packages.png";
import servicesImg from "../assets/images/services.png";
import homeServicesImg from "../assets/images/home-services.png";
import hairColorTreatmentsImg from "../assets/images/hair-color-treatments.png";

// Public catalog is served by Core D1 and does not require Firebase Auth.
import { CoreCatalogService } from "../services/CoreCatalogService";

const SALON_ID = "main";

type SectionRow = {
  id: string;
  name: string;
  active?: boolean;
  order?: number;
};

type UiCard = {
  id: string;
  title: string;
  image: string;
};

export default function HomeServices() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<SectionRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // ✅ نفس فكرة Services.tsx: mapping حسب sectionId
  const imageBySectionId = useMemo(() => {
    return {
      "hair-care": hair,
      "skin-care": skin,
      "nail-care": nails,
      makeup: makeupImg,
      massage: massageImg,
      "special-packages": packagesImg,
      services: servicesImg,
      "home-services": homeServicesImg,
      "hair-color-treatments": hairColorTreatmentsImg,
    } as Record<string, string>;
  }, []);

  useEffect(() => {
    let alive = true;

    (async () => {
      setLoading(true);
      setError(null);

      try {
        const rows = await CoreCatalogService.listSections(true);
        const list: SectionRow[] = rows.map((x: any) => ({
          id: String(x?.id || "").trim(),
          name: String(x?.name || "").trim(),
          active: x?.active !== false,
          order: Number(x?.sortOrder ?? x?.order ?? 0),
        }));

        if (!alive) return;

        setRows(list.filter((s) => s.active !== false && s.name.trim()));
      } catch (e: any) {
        if (!alive) return;
        console.error("Core home services load error:", e);
        setError(e?.message || "صار خطأ أثناء تحميل الأقسام");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const cards: UiCard[] = useMemo(() => {
    return rows.map((s) => ({
      id: s.id,
      title: s.name || s.id,
      image: imageBySectionId[s.id] || servicesImg, // ✅ fallback
    }));
  }, [rows, imageBySectionId]);

  return (
    <section className="home-services-section qs-wine" aria-label="خدماتنا">
      <div className="container">
        <div className="home-services-head">
          <h2 className="home-services-title">خدماتنا المميزة</h2>
          <p className="home-services-subtitle">
            اختاري القسم واستعرضي التفاصيل بأسلوب ناعم وفخم
          </p>
        </div>

        {loading ? (
          <div className="home-services-state">جاري تحميل الأقسام…</div>
        ) : error ? (
          <div className="home-services-state is-error">{error}</div>
        ) : cards.length === 0 ? (
          <div className="home-services-state">لا توجد أقسام ظاهرة حالياً.</div>
        ) : (
          <div className="home-services-grid">
            {cards.map((c) => (
              <Link
                key={c.id}
                to="/services"
                className="home-service-card is-reveal"
                style={{ textDecoration: "none" }}
              >
                <div
                  className="reveal-front"
                  style={{ backgroundImage: `url(${c.image})` }}
                >
                  <div className="reveal-overlay" />
                  <h3 className="home-service-name">{c.title}</h3>
                  <div className="reveal-hint">مرري لعرض التفاصيل</div>
                </div>

                <div className="reveal-back">
                  <h3 className="home-service-name">{c.title}</h3>
                  <p className="home-service-desc">
                    افتحي صفحة الخدمات وشوفي التصنيفات والأسعار بالتفصيل.
                  </p>
                  <div className="reveal-footnote">اضغطي للانتقال 👈</div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* زر واحد فقط تحت */}
        {!loading && !error && cards.length > 0 && (
          <div className="lead-strong" style={{ marginTop: 22, textAlign: "center" }}>
            <Link to="/booking" className="offers-cta-btn">
              الانتقال للحجز
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
