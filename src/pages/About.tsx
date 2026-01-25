// src/pages/About.tsx
import { useEffect, useMemo, useState } from "react";

import ava from "../assets/images/ava.webp";
import emma from "../assets/images/emma.webp";
import sophie from "../assets/images/sophie.webp";
import unnamed from "../assets/images/unnamed.png";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCheck,
  faStar,
  faAward,
  faHandHoldingHeart,
} from "@fortawesome/free-solid-svg-icons";

import "../styles/About.css";

// ✅ Firestore
import { collection, getDocs } from "firebase/firestore";
import { db } from "../services/firebase";

type TeamMember = {
  id: string;
  name: string;
  position: string;
  image: string; // placeholder image
  description: string;

  specialties?: string[];
  bio?: string;
  avatarUrl?: string;

  // ✅ flags
  active?: boolean;
  showOnAbout?: boolean; // ✅ NEW
};

const SALON_ID = "main";
const STAFF_PUBLIC_COLLECTION = ["salons", SALON_ID, "staff_public"] as const;

// ✅ ترجمة مفاتيح التخصصات لأسماء عربية (بدل ما يطلع skin-care للعميلات)
const SPECIALTY_LABELS: Record<string, string> = {
  "hair-care": "العناية بالشعر",
  "skin-care": "العناية بالبشرة",
  "nail-care": "العناية بالأظافر",
  makeup: "المكياج",
  massage: "المساج",
  "special-packages": "باقات خاصة",
};

function labelSpecialty(key: string) {
  return SPECIALTY_LABELS[key] || key;
}

function normalizeSpecialties(v: any): string[] {
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}

function buildPositionFromSpecialties(specialties: string[]) {
  if (!specialties.length) return "أخصائية";
  const nice = specialties.slice(0, 3).map(labelSpecialty);
  return `أخصائية: ${nice.join(" • ")}`;
}

// ✅ يقرأ isActive أو active عشان ما ننكسر مع الداتا القديمة
function readActiveFlag(x: any) {
  if (typeof x?.isActive === "boolean") return x.isActive;
  if (typeof x?.active === "boolean") return x.active;
  // default true
  return true;
}

const About = () => {
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamLoading, setTeamLoading] = useState(true);
  const [teamErr, setTeamErr] = useState("");

  const placeholders = useMemo(() => [ava, emma, sophie], []);

  const whyChooseUs = [
    {
      icon: faStar,
      title: "خدمة متميزة",
      description: "نقدم خدمة احترافية ومتميزة تلبي جميع احتياجاتك وتفوق توقعاتك.",
    },
    {
      icon: faAward,
      title: "فريق محترف",
      description: "فريقنا من الخبيرات المتخصصات في مجال التجميل والعناية بالجمال.",
    },
    {
      icon: faHandHoldingHeart,
      title: "منتجات طبيعية",
      description: "نستخدم منتجات طبيعية وآمنة على البشرة والشعر من أفضل الماركات العالمية.",
    },
  ];

  // ✅ تحميل الفريق من staff_public
  const loadTeam = async () => {
    try {
      setTeamLoading(true);
      setTeamErr("");

      const colRef = collection(db, ...STAFF_PUBLIC_COLLECTION);
      const snap = await getDocs(colRef);

      const rows: TeamMember[] = snap.docs
        .map((d, idx) => {
          const x: any = d.data();

          const name = String(x?.name || "").trim();
          const active = readActiveFlag(x); // ✅ fixed
          const showOnAbout = x?.showOnAbout !== false; // ✅ default true (fallback for old docs)

          const specialties = normalizeSpecialties(x?.specialties);
          const bio = String(x?.bio || "").trim();
          const avatarUrl = String(x?.avatarUrl || "").trim() || undefined;

          const position = buildPositionFromSpecialties(specialties);

          const desc =
            bio ||
            (specialties.length
              ? `متخصصة في: ${specialties.join(" • ")}`
              : "خبيرة ضمن فريق صالون ملكات.");

          return {
            id: d.id,
            name,
            active,
            showOnAbout,
            specialties,
            bio,
            avatarUrl,
            position,
            description: desc,
            image: placeholders[idx % placeholders.length], // fallback
          };
        })
        // ✅ فقط اللي active + showOnAbout + عنده اسم
        .filter((m) => m.name && m.active && m.showOnAbout !== false);

      // ✅ ترتيب محلي بالاسم
      rows.sort((a, b) => (a.name || "").localeCompare(b.name || "", "ar"));

      setTeamMembers(rows);

      if (rows.length === 0) {
        setTeamErr("لا يوجد فريق منشور في صفحة About حالياً. (staff_public)");
      }
    } catch (e: any) {
      console.error("About loadTeam error:", e);
      setTeamErr(e?.message || "تعذر تحميل فريق الصالون");
      setTeamMembers([]);
    } finally {
      setTeamLoading(false);
    }
  };

  useEffect(() => {
    loadTeam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="about-page py-5">
      <div className="container">
        <section className="about-intro mb-5">
          <div className="row align-items-center">
            <div className="col-lg-6 mb-4 mb-lg-0">
              <div className="about-image">
                <img src={unnamed} alt="Queens Salon" className="img-fluid rounded" />
              </div>
            </div>

            <div className="col-lg-6">
              <div className="about-content">
                <h1 className="about-title mb-4">عن صالون ملكات</h1>
                <p className="about-text mb-4">
                  تأسس صالون ملكات للتجميل في عام 2020 بهدف تقديم خدمات تجميلية
                  متكاملة وعالية الجودة للسيدات. نسعى دائماً لتوفير تجربة فريدة
                  ومميزة لعميلاتنا في جو من الراحة والخصوصية.
                </p>
                <p className="about-text mb-4">
                  يضم صالوننا فريقاً من الخبيرات المتخصصات في مجالات العناية بالشعر
                  والبشرة والمكياج والأظافر، ونستخدم أفضل المنتجات العالمية لضمان
                  نتائج مثالية.
                </p>
                <p className="about-text">
                  رؤيتنا هي أن نكون الوجهة الأولى للسيدات الباحثات عن التميز
                  والجودة في خدمات التجميل، ونسعى دائماً لمواكبة أحدث صيحات الموضة
                  والتجميل العالمية.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="about-team mb-5">
          <div className="text-center mb-5">
            <h2 className="section-title">فريقنا المتميز</h2>
            <p className="section-subtitle">تعرفي على فريق الخبيرات المتخصصات</p>
            <div className="about-team-hint">
              (يتم العرض تلقائياً من Firestore: <b>salons/main/staff_public</b>)
            </div>
          </div>

          {teamLoading ? (
            <p style={{ opacity: 0.75, textAlign: "center" }}>جاري تحميل الفريق…</p>
          ) : teamErr ? (
            <p style={{ color: "#991b1b", fontWeight: 900, textAlign: "center" }}>
              {teamErr}
            </p>
          ) : (
            <div className="team-grid">
              {teamMembers.map((member, index) => (
                <div key={member.id}>
                  <div
                    className="team-member-enhanced animate-fade-in"
                    style={{ animationDelay: `${index * 0.2}s` }}
                  >
                    <div className="team-member-image-container">
                      <img
                        src={member.avatarUrl || member.image}
                        alt={member.name}
                        className="team-member-image-enhanced"
                      />
                      <div className="team-member-overlay">
                        <div className="team-member-social">
                          <i className="fab fa-instagram"></i>
                          <i className="fab fa-twitter"></i>
                        </div>
                      </div>
                    </div>

                    <div className="team-member-content">
                      <h3 className="team-member-name-enhanced">{member.name}</h3>
                      <p className="team-member-position-enhanced">{member.position}</p>
                      <p className="team-member-description-enhanced">{member.description}</p>

                      {!!member.specialties?.length && (
                        <div className="team-member-chips">
                          {member.specialties.slice(0, 6).map((sp, i) => (
                            <span key={`${member.id}-sp-${i}`} className="team-chip">
                              {labelSpecialty(sp)}
                            </span>
                          ))}

                        </div>
                      )}

                      <div className="team-member-skills">
                        <span className="skill-tag">موظفة معتمدة</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="why-choose-us">
          <h2 className="section-title text-center mb-5">لماذا تختارين صالون ملكات</h2>
          <div className="row">
            {whyChooseUs.map((item, index) => (
              <div className="col-md-4 mb-4" key={index}>
                <div className="why-choose-item">
                  <div className="why-choose-icon">
                    <FontAwesomeIcon icon={item.icon} />
                  </div>
                  <h3 className="why-choose-title">{item.title}</h3>
                  <p className="why-choose-description">{item.description}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="about-features mt-5">
            <div className="row">
              <div className="col-lg-6 mb-4">
                <h3 className="about-features-title mb-4">ماذا يميزنا؟</h3>
                <ul className="features-list">
                  <li>
                    <FontAwesomeIcon icon={faCheck} className="feature-icon" /> أحدث التقنيات في مجال التجميل
                  </li>
                  <li>
                    <FontAwesomeIcon icon={faCheck} className="feature-icon" /> منتجات عالمية ذات جودة عالية
                  </li>
                  <li>
                    <FontAwesomeIcon icon={faCheck} className="feature-icon" /> أسعار مناسبة وعروض دورية
                  </li>
                  <li>
                    <FontAwesomeIcon icon={faCheck} className="feature-icon" /> خصوصية تامة وراحة مطلقة
                  </li>
                  <li>
                    <FontAwesomeIcon icon={faCheck} className="feature-icon" /> مواعيد مرنة تناسب جميع العميلات
                  </li>
                </ul>
              </div>

              <div className="col-lg-6">
                <h3 className="about-features-title mb-4">قيمنا</h3>
                <ul className="features-list">
                  <li>
                    <FontAwesomeIcon icon={faCheck} className="feature-icon" /> الاحترافية في تقديم الخدمات
                  </li>
                  <li>
                    <FontAwesomeIcon icon={faCheck} className="feature-icon" /> الالتزام بأعلى معايير النظافة
                  </li>
                  <li>
                    <FontAwesomeIcon icon={faCheck} className="feature-icon" /> الاهتمام بتفاصيل رغبات العميلات
                  </li>
                  <li>
                    <FontAwesomeIcon icon={faCheck} className="feature-icon" /> التطوير المستمر لمهارات الفريق
                  </li>
                  <li>
                    <FontAwesomeIcon icon={faCheck} className="feature-icon" /> الصدق والشفافية في التعامل
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default About;
