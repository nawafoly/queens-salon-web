import hair from "../assets/images/hair.webp";
import skin from "../assets/images/skin.webp";

import nails from "../assets/images/nails.webp";
import emma from "../assets/images/emma.webp";
import sophie from "../assets/images/sophie.webp";
import ava from "../assets/images/ava.webp";
import { Link } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCut,
  faSpa,
  faPaintBrush,
  faHandSparkles,
  faMagic,
} from "@fortawesome/free-solid-svg-icons";
import "../styles/Services.css";

const Services = () => {
  const serviceCategories = [
    {
      id: "hair-care",
      title: "العناية بالشعر",
      icon: faCut,
      image: hair,
      description:
        "خدمات متكاملة للعناية بالشعر تشمل القص، الصبغ، التصفيف، والعلاجات المتخصصة.",
      services: [
        { name: "قص الشعر", price: 75 },
        { name: "صبغ الشعر", price: 150 },
        { name: "تصفيف الشعر", price: 100 },
        { name: "علاجات الشعر", price: 200 },
        { name: "فرد الشعر", price: 300 },
        { name: "تجعيد الشعر", price: 250 },
      ],
    },
    {
      id: "skin-care",
      title: "العناية بالبشرة",
      icon: faSpa,
      image: skin,
      description:
        "جلسات تنظيف وتقشير وترطيب للبشرة مع علاجات متخصصة للمشاكل المختلفة.",
      services: [
        { name: "تنظيف البشرة العميق", price: 120 },
        { name: "تقشير البشرة", price: 150 },
        { name: "ترطيب البشرة", price: 100 },
        { name: "علاج حب الشباب", price: 180 },
        { name: "ماسكات للبشرة", price: 90 },
        { name: "علاج تصبغات البشرة", price: 200 },
      ],
    },
    {
      id: "nail-care",
      title: "العناية بالأظافر",
      icon: faHandSparkles,
      image: nails,
      description: "خدمات المانيكير والباديكير مع تقنيات متطورة وألوان عصرية.",
      services: [
        { name: "مانيكير", price: 50 },
        { name: "باديكير", price: 60 },
        { name: "مانيكير وباديكير", price: 90 },
        { name: "طلاء الأظافر الدائم", price: 120 },
        { name: "أظافر اصطناعية", price: 150 },
        { name: "رسومات على الأظافر", price: 30 },
      ],
    },
    {
      id: "makeup",
      title: "المكياج",
      icon: faPaintBrush,
      image: emma,
      description:
        "مكياج احترافي للمناسبات الخاصة والأعراس مع خيارات متنوعة تناسب جميع الأذواق.",
      services: [
        { name: "مكياج يومي", price: 150 },
        { name: "مكياج سهرة", price: 200 },
        { name: "مكياج عروس", price: 500 },
        { name: "رسم حواجب", price: 70 },
        { name: "تركيب رموش", price: 80 },
        { name: "دروس مكياج شخصية", price: 300 },
      ],
    },
    {
      id: "massage",
      title: "المساج",
      icon: faHandSparkles,
      image: sophie,
      description:
        "جلسات مساج متنوعة للاسترخاء وتخفيف التوتر وتنشيط الدورة الدموية.",
      services: [
        { name: "مساج استرخائي", price: 180 },
        { name: "مساج علاجي", price: 200 },
        { name: "مساج الظهر والرقبة", price: 120 },
        { name: "مساج الوجه", price: 100 },
        { name: "مساج بالزيوت العطرية", price: 220 },
        { name: "مساج الأحجار الساخنة", price: 250 },
      ],
    },
    {
      id: "special-packages",
      title: "باقات خاصة",
      icon: faMagic,
      image: ava,
      description: "باقات متكاملة تجمع بين خدمات متنوعة بأسعار مميزة.",
      services: [
        { name: "باقة العروس الكاملة", price: 1000 },
        { name: "باقة التجديد الشاملة", price: 500 },
        { name: "باقة الاسترخاء", price: 350 },
        { name: "باقة العناية بالبشرة", price: 300 },
        { name: "باقة العناية بالشعر", price: 350 },
        { name: "باقة المناسبات الخاصة", price: 450 },
      ],
    },
  ];

  return (
    <div className="services-page py-5">
      <div className="container">
        <h1 className="services-title text-center mb-2">خدماتنا</h1>
        <p className="services-subtitle text-center mb-5">
          نقدم لكِ مجموعة متكاملة من خدمات التجميل والعناية بالجمال
        </p>

        {serviceCategories.map((category, idx) => (
          <div
            className={`service-category mb-5 ${idx % 2 === 1 ? "reverse" : ""
              }`}
            key={category.id}
            id={category.id}
          >
            <div className="row align-items-center">
              <div className="col-lg-6 mb-4 mb-lg-0">
                <div className="service-category-image">
                  <img
                    src={category.image}
                    alt={category.title}
                    className="img-fluid rounded"
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
        ))}
      </div>
    </div>
  );
};

export default Services;
