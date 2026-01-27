import React, { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faMapMarkerAlt,
  faPhone,
  faEnvelope,
  faClock,
  faPaperPlane,
} from "@fortawesome/free-solid-svg-icons";
import "../styles/contact.css";

interface ContactFormData {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
}

const Contact: React.FC = () => {
  const [formData, setFormData] = useState<ContactFormData>({
    name: "",
    email: "",
    phone: "",
    subject: "",
    message: "",
  });

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;

    // ✅ جوال سعودي 10 أرقام
    if (name === "phone") {
      const digitsOnly = value.replace(/\D/g, "").slice(0, 10);
      setFormData((p) => ({ ...p, phone: digitsOnly }));
      return;
    }

    setFormData((prevState) => ({
      ...prevState,
      [name]: value,
    }));
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    console.log("Form submitted:", formData);

    alert("تم إرسال رسالتك بنجاح! سنتواصل معك قريباً.");

    setFormData({
      name: "",
      email: "",
      phone: "",
      subject: "",
      message: "",
    });
  };

  const workingHours = [
    { day: "السبت - الأربعاء", hours: "10:00 صباحاً - 10:00 مساءً" },
    { day: "الخميس", hours: "10:00 صباحاً - 11:00 مساءً" },
    { day: "الجمعة", hours: "2:00 مساءً - 10:00 مساءً" },
  ];

  return (
    <div className="contact-page py-5">
      <div className="container">
        <h1 className="contact-title contact-title-gradient text-center mb-2">
          تواصلي معنا
        </h1>

        <p className="contact-subtitle text-center mb-5">
          نحن هنا للإجابة على جميع استفساراتك ومساعدتك في حجز موعدك
        </p>

        <div className="row">
          <div className="col-lg-6 mb-5 mb-lg-0">
            <div className="contact-form-container">
              <h2 className="contact-form-title mb-4">أرسلي لنا رسالة</h2>

              <form className="contact-form-enhanced" onSubmit={handleSubmit}>
                <div className="form-group">
                  <label htmlFor="name" className="form-label">
                    الاسم الكامل *
                  </label>
                  <input
                    type="text"
                    id="name"
                    className="form-control-enhanced"
                    placeholder="أدخلي اسمك الكامل"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    required
                  />
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="email" className="form-label">
                      البريد الإلكتروني *
                    </label>
                    <input
                      type="email"
                      id="email"
                      className="form-control-enhanced"
                      placeholder="example@email.com"
                      name="email"
                      value={formData.email}
                      onChange={handleChange}
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label htmlFor="phone" className="form-label">
                      رقم الهاتف *
                    </label>
                    <input
                      type="tel"
                      inputMode="numeric"
                      id="phone"
                      className="form-control-enhanced"
                      placeholder="05xxxxxxxx"
                      name="phone"
                      value={formData.phone}
                      onChange={handleChange}
                      required
                      maxLength={10}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="subject" className="form-label">
                    الموضوع *
                  </label>
                  <select
                    id="subject"
                    className="form-control-enhanced"
                    name="subject"
                    value={formData.subject}
                    onChange={handleChange}
                    required
                  >
                    <option value="">اختاري الموضوع</option>
                    <option value="booking">حجز موعد</option>
                    <option value="inquiry">استفسار عن الخدمات</option>
                    <option value="complaint">شكوى أو اقتراح</option>
                    <option value="pricing">استفسار عن الأسعار</option>
                    <option value="other">أخرى</option>
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="message" className="form-label">
                    رسالتك *
                  </label>
                  <textarea
                    id="message"
                    className="form-control-enhanced"
                    placeholder="اكتبي رسالتك هنا..."
                    name="message"
                    value={formData.message}
                    onChange={handleChange}
                    rows={6}
                    required
                  />
                </div>

                <button type="submit" className="btn-submit-enhanced">
                  <FontAwesomeIcon icon={faPaperPlane} />
                  إرسال الرسالة
                </button>
              </form>
            </div>
          </div>

          <div className="col-lg-6">
            <div className="contact-info-container">
              <h2 className="contact-info-title mb-4">معلومات الاتصال</h2>

              <div className="contact-info-item">
                <div className="contact-info-icon">
                  <FontAwesomeIcon icon={faMapMarkerAlt} />
                </div>
                <div className="contact-info-content">
                  <h3>العنوان</h3>
                  <p>123 شارع الجمال، حي الروضة، الرياض، المملكة العربية السعودية</p>
                </div>
              </div>

              <div className="contact-info-item">
                <div className="contact-info-icon">
                  <FontAwesomeIcon icon={faPhone} />
                </div>
                <div className="contact-info-content">
                  <h3>رقم الهاتف</h3>
                  <p>+966 123 456 7890</p>
                </div>
              </div>

              <div className="contact-info-item">
                <div className="contact-info-icon">
                  <FontAwesomeIcon icon={faEnvelope} />
                </div>
                <div className="contact-info-content">
                  <h3>البريد الإلكتروني</h3>
                  <p>info@bodysalon.com</p>
                </div>
              </div>

              <div className="contact-info-item">
                <div className="contact-info-icon">
                  <FontAwesomeIcon icon={faClock} />
                </div>
                <div className="contact-info-content">
                  <h3>ساعات العمل</h3>
                  <ul className="working-hours">
                    {workingHours.map((item, index) => (
                      <li key={index}>
                        <span className="day">{item.day}:</span>
                        <span className="hours">{item.hours}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            <div className="contact-map mt-4">
              <iframe
                src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3624.674457239337!2d46.675291075361825!3d24.713454274656!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x3e2f03890d489399%3A0xa11ce0e317979d56!2sRiyadh%20Saudi%20Arabia!5e0!3m2!1sen!2sus!4v1686058545929!5m2!1sen!2sus"
                width="100%"
                height="300"
                style={{ border: 0, borderRadius: "14px" }}
                allowFullScreen={true}
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                title="Queens Salon Location"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Contact;
