import React from "react";
import sophie from "../assets/images/sophie.jpg";
import emma from "../assets/images/emma.jpg";
import ava from "../assets/images/ava.jpg";

import "../styles/Testimonials.css";

interface TestimonialProps {
  name: string;
  role: string;
  image: string;
  content: string;
  rating: number;
}

const Testimonials: React.FC = () => {
  const testimonials: TestimonialProps[] = [
    {
      name: "سارة الأحمد",
      role: "عميلة دائمة",
      image: sophie,
      content:
        "تجربتي مع صالون ملكات كانت رائعة جداً. الخدمة ممتازة والنتائج مبهرة. أنصح به بشدة لكل من تبحث عن جودة عالية وأسعار معقولة.",
      rating: 5,
    },
    {
      name: "نورة العتيبي",
      role: "عميلة جديدة",
      image: emma,
      content:
        "زيارتي الأولى لصالون ملكات كانت تجربة لا تُنسى. الاهتمام بالتفاصيل والخدمة الشخصية جعلتني أشعر بالراحة والثقة. سأعود بالتأكيد!",
      rating: 5,
    },
    {
      name: "هند السعيد",
      role: "عميلة منتظمة",
      image: ava,
      content:
        "أحب الأجواء الهادئة والمريحة في صالون ملكات. الموظفات محترفات ودائماً يقدمن نصائح مفيدة للعناية بالبشرة والشعر.",
      rating: 4,
    },
  ];

  // render stars based on rating (0-5)
  const renderStars = (rating: number) => {
    return Array.from({ length: 5 }).map((_, i) => (
      <span
        key={i}
        className={`bs-star ${i < rating ? "is-filled" : "is-empty"}`}
        aria-hidden="true"
      >
        ★
      </span>
    ));
  };

  return (
    <section className="bs-testimonials">
      <div className="container">
        <h2 className="bs-testimonials-title">آراء عميلاتنا</h2>

        <div className="row g-4">
          {testimonials.map((t, index) => (
            <div key={index} className="col-12 col-sm-6 col-lg-4">
              <div className="bs-testimonial-card h-100">
                <div className="bs-testimonial-content">
                  <p className="bs-testimonial-text">{t.content}</p>

                  <div className="bs-testimonial-rating" aria-label={`تقييم ${t.rating} من 5`}>
                    {renderStars(t.rating)}
                  </div>
                </div>

                <div className="bs-testimonial-author">
                  <img
                    src={t.image}
                    alt={t.name}
                    className="bs-testimonial-avatar"
                    loading="lazy"
                  />

                  <div className="bs-testimonial-info">
                    <h4 className="bs-testimonial-name">{t.name}</h4>
                    <p className="bs-testimonial-role">{t.role}</p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Testimonials;
