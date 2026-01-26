// src/components/HomeServices.tsx
import { Link } from "react-router-dom";
import "../styles/HomeServices.css";

const HomeServices = () => {
  const services = [
    {
      title: "العناية بالشعر",
      desc: "خدمات متكاملة للشعر تشمل القص، الصبغ، التصفيف، والعلاجات المتخصصة.",
      price: "ابتداءً من 50 ريال",
    },
    {
      title: "العناية بالبشرة",
      desc: "جلسات تنظيف وتقشير وترطيب للبشرة مع علاجات متخصصة للمشاكل المختلفة.",
      price: "ابتداءً من 100 ريال",
    },
    {
      title: "العناية بالأظافر",
      desc: "خدمات المانيكير والباديكير مع تقنيات متطورة وألوان عصرية.",
      price: "ابتداءً من 79 ريال",
    },
    {
      title: "المكياج",
      desc: "مكياج احترافي للمناسبات الخاصة والأعراس مع خيارات متنوعة تناسب جميع الأذواق.",
      price: "ابتداءً من 85 ريال",
    },
    {
      title: "المعالجات المتخصصة",
      desc: "علاجات متطورة للشعر والبشرة باستخدام أحدث التقنيات والمنتجات العالمية.",
      price: "ابتداءً من 300 ريال",
    },
    {
      title: "باقات العروس",
      desc: "باقات شاملة للعروس تشمل جميع خدمات التجميل لإطلالة مثالية في يومك المميز.",
      price: "ابتداءً من 1000 ريال",
    },
  ];

  return (
    <section className="home-services-section" aria-label="خدماتنا">
      <div className="container">
        <div className="home-services-head">
          <h2 className="home-services-title">خدماتنا المميزة</h2>
          <p className="home-services-subtitle">
            نقدم لك مجموعة شاملة من خدمات التجميل بأعلى معايير الجودة
          </p>
        </div>

        <div className="home-services-grid">
          {services.map((s, idx) => (
            <div className="home-service-card" key={idx}>
              <div className="home-service-top">
                <h3 className="home-service-name">{s.title}</h3>
                <div className="home-service-price">{s.price}</div>
              </div>

              <p className="home-service-desc">{s.desc}</p>

              <Link to="/booking" className="home-service-btn">
                احجزي الآن
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default HomeServices;
