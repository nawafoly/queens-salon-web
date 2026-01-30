import React, { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

import {
  faMapMarkerAlt,
  faPhone,
  faEnvelope,
  faClock,
  faPaperPlane,
} from "@fortawesome/free-solid-svg-icons";

import "../styles/contact.css";
import "../styles/DashboardModals.css";

// ✅ Firebase
import { db } from "../services/firebase";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";

interface ContactFormData {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
}

type PublicSettings = {
  phone?: string;       // الجوال
  whatsapp?: string;    // واتساب
  email?: string;       // الإيميل
  city?: string;        // المدينة
  locationText?: string; // العنوان النصي
  hoursText?: string;    // سطور متعددة \n
  mapEmbedUrl?: string;  // رابط embed كامل أو pb فقط
};

const SALON_ID = "main";

function normalizeMapEmbedUrl(input?: string) {
  const raw = String(input || "").trim();
  if (!raw) return "";

  // إذا المستخدم لصق الرابط كامل
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;

  // إذا لصق pb فقط
  if (raw.startsWith("pb=")) {
    return `https://www.google.com/maps/embed?${raw}`;
  }

  // إذا لصق pb بدون pb=
  if (raw.startsWith("!1m")) {
    return `https://www.google.com/maps/embed?pb=${raw}`;
  }

  // fallback
  return raw;
}

const Contact: React.FC = () => {
  const [formData, setFormData] = useState<ContactFormData>({
    name: "",
    email: "",
    phone: "",
    subject: "",
    message: "",
  });

  const [publicSettings, setPublicSettings] = useState<PublicSettings | null>(null);
  const [sending, setSending] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
const [modalType, setModalType] = useState<"success" | "error">("success");
const [modalMsg, setModalMsg] = useState("");

  
  // ✅ اسحب بيانات التواصل من Firestore (Live)
  useEffect(() => {
    const ref = doc(db, "salons", SALON_ID, "settings", "public");
    const unsub = onSnapshot(
      ref,
      (snap) => setPublicSettings(snap.exists() ? (snap.data() as PublicSettings) : null),
      (err) => {
        console.error("public settings snapshot error:", err);
        setPublicSettings(null);
      }
    );
    return () => unsub();
  }, []);

  // ✅ ساعات العمل: hoursText -> قائمة
  const workingHours = useMemo(() => {
    const raw = publicSettings?.hoursText?.trim();
    if (!raw) {
      return [
        { day: "السبت - الأربعاء", hours: "10:00 صباحاً - 10:00 مساءً" },
        { day: "الخميس", hours: "10:00 صباحاً - 11:00 مساءً" },
        { day: "الجمعة", hours: "2:00 مساءً - 10:00 مساءً" },
      ];
    }

    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const idx = line.indexOf(":");
        if (idx === -1) return { day: line, hours: "" };
        return {
          day: line.slice(0, idx).trim(),
          hours: line.slice(idx + 1).trim(),
        };
      });
  }, [publicSettings?.hoursText]);

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

 // ✅ إرسال الرسالة إلى Firestore
const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
  e.preventDefault();
  if (sending) return;

  try {
    setSending(true);

    await addDoc(collection(db, "salons", SALON_ID, "contact_messages"), {
      ...formData,
      status: "new",
      createdAt: serverTimestamp(),
      source: "contact_page",
    });

    // ✅ مودال نجاح
    setModalType("success");
    setModalMsg("تم إرسال رسالتك بنجاح 🌸\nبنرد عليك في أقرب وقت بإذن الله.");
    setModalOpen(true);

    setFormData({
      name: "",
      email: "",
      phone: "",
      subject: "",
      message: "",
    });
  } catch (err) {
    console.error("contact submit error:", err);

    // ✅ مودال خطأ
    setModalType("error");
    setModalMsg("صار خطأ أثناء الإرسال.\nجرّبي مرة ثانية أو تواصلي معنا واتساب 💬");
    setModalOpen(true);
  } finally {
    setSending(false);
  }
};


  // ✅ بيانات العرض (مع fallback واضح)
  const locationText = publicSettings?.locationText || "لم يتم إعداد العنوان بعد";
  const phone = publicSettings?.phone || "لم يتم إعداد رقم الهاتف بعد";
  const email = publicSettings?.email || "لم يتم إعداد البريد بعد";
  const hoursText = publicSettings?.hoursText || "";

  const mapEmbedUrl = normalizeMapEmbedUrl(publicSettings?.mapEmbedUrl);
  const hasMap = !!mapEmbedUrl && mapEmbedUrl.includes("google.com/maps/embed");

  return (
    <div className="contact-page py-5">


{/* ✅ مودال بدل Alert المتصفح */}
{modalOpen ? (
  <div
    className="modal-overlay"
    role="dialog"
    aria-modal="true"
    onClick={() => setModalOpen(false)}
  >
    <div className="modal-box" onClick={(e) => e.stopPropagation()}>
      <div className="modal-head">
        <div className="modal-title-wrap">
          <div className="modal-icon">
            {modalType === "success" ? "✅" : "⚠️"}
          </div>
          <h3 className="modal-title">
            {modalType === "success" ? "تم الإرسال" : "تعذر الإرسال"}
          </h3>
        </div>

        <button className="modal-close" onClick={() => setModalOpen(false)} aria-label="إغلاق">
          ✕
        </button>
      </div>

      <div className="modal-body">
        <p className="modal-text">{modalMsg}</p>
      </div>

      <div className="modal-actions">
        <button className="btn-confirm" onClick={() => setModalOpen(false)}>
          حسناً
        </button>
      </div>
    </div>
  </div>
) : null}



      <div className="container">
        <h1 className="contact-title contact-title-gradient text-center mb-2">
          تواصلي معنا
        </h1>

        <p className="contact-subtitle text-center lead-strong mb-5">
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

                <button
                  type="submit"
                  className="btn-submit-enhanced"
                  disabled={sending}
                  style={{ opacity: sending ? 0.7 : 1 }}
                >
                  <FontAwesomeIcon icon={faPaperPlane} />
                  {sending ? " جاري الإرسال..." : " إرسال الرسالة"}
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
                  <p>{locationText}</p>
                </div>
              </div>

              <div className="contact-info-item">
                <div className="contact-info-icon">
                  <FontAwesomeIcon icon={faPhone} />
                </div>
                <div className="contact-info-content">
                  <h3>رقم الهاتف</h3>
                  <p>{phone}</p>
                </div>
              </div>

              <div className="contact-info-item">
                <div className="contact-info-icon">
                  <FontAwesomeIcon icon={faEnvelope} />
                </div>
                <div className="contact-info-content">
                  <h3>البريد الإلكتروني</h3>
                  <p>{email}</p>
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

                  {/* للتأكد بس: لو hoursText فاضي */}
                  {!hoursText?.trim() ? (
                    <div style={{ marginTop: 10, opacity: 0.65, fontSize: 13 }}>
                      (ملاحظة: ساعات العمل من لوحة التحكم غير مضافة بعد)
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <section style={{ background: "#fff", padding: "32px 0" }}>
              <div className="container ">
                <h3
                  style={{
                    textAlign: "center",
                    marginBottom: 16,
                    color: "#40010de6",
                  }}
                >
                  موقع صالون ملكات
                </h3>

                <div className="contact-map">
                  {hasMap ? (
                    <iframe
                      src={mapEmbedUrl}
                      width="100%"
                      height="340"
                      style={{
                        border: 0,
                        borderRadius: "18px",
                        boxShadow: "0 20px 50px rgba(0,0,0,0.1)",
                      }}
                      allowFullScreen
                      loading="lazy"
                      referrerPolicy="no-referrer-when-downgrade"
                      title="Queens Salon Location"
                    />
                  ) : (
                    <div
                      style={{
                        borderRadius: 18,
                        border: "1px dashed rgba(0,0,0,0.15)",
                        padding: 18,
                        textAlign: "center",
                        color: "rgba(0,0,0,0.65)",
                      }}
                    >
                      لم يتم إضافة رابط الخريطة بعد من لوحة التحكم.
                    </div>
                  )}
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Contact;
