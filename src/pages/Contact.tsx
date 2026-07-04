import React, { useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { formatTime12 } from "../helpers/timeDisplay";

import {
  faMapMarkerAlt,
  faPhone,
  faEnvelope,
  faClock,
  faPaperPlane,
} from "@fortawesome/free-solid-svg-icons";
import Modal from "../components/Modal";

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

type WeekdayKey = "sat" | "sun" | "mon" | "tue" | "wed" | "thu" | "fri";
type BookingHourOverrideMode = "hours" | "closed";
type BookingHourOverride = {
  id?: string;
  fromDate: string;
  toDate: string;
  mode: BookingHourOverrideMode;
  start?: string;
  end?: string;
  includeWeekdays?: WeekdayKey[];
  blockedWeekdays?: WeekdayKey[];
};

type BusinessHoursMap = Record<WeekdayKey, { enabled: boolean; start: string; end: string }>;

const WEEKDAY_KEYS: WeekdayKey[] = ["sat", "sun", "mon", "tue", "wed", "thu", "fri"];
const WEEKDAY_LABEL_AR: Record<WeekdayKey, string> = {
  sat: "السبت",
  sun: "الأحد",
  mon: "الإثنين",
  tue: "الثلاثاء",
  wed: "الأربعاء",
  thu: "الخميس",
  fri: "الجمعة",
};

const SALON_ID = "main";

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function safeTimeHHMM(v: unknown, fallback: string): string {
  const s = String(v || "").trim();
  if (!/^\d{1,2}:\d{2}$/.test(s)) return fallback;
  const [h, m] = s.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return fallback;
  if (h < 0 || h > 23 || m < 0 || m > 59) return fallback;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function resolveWeekdayFromISO(dateISO: string): WeekdayKey {
  const m = String(dateISO || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "sat";
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const jsDay = dt.getDay(); // 0=Sun .. 6=Sat
  const map: WeekdayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return map[jsDay] || "sat";
}

function defaultBusinessHoursMap(): BusinessHoursMap {
  return {
    sat: { enabled: true, start: "12:00", end: "22:00" },
    sun: { enabled: true, start: "12:00", end: "22:00" },
    mon: { enabled: true, start: "12:00", end: "22:00" },
    tue: { enabled: true, start: "12:00", end: "22:00" },
    wed: { enabled: true, start: "12:00", end: "22:00" },
    thu: { enabled: true, start: "12:00", end: "22:00" },
    fri: { enabled: false, start: "12:00", end: "22:00" },
  };
}

function readBusinessHours(raw: Record<string, unknown> | null | undefined): BusinessHoursMap {
  const fallback = defaultBusinessHoursMap();
  return WEEKDAY_KEYS.reduce((acc, day) => {
    const x = (raw?.[day] || {}) as Record<string, unknown>;
    acc[day] = {
      enabled: typeof x.enabled === "boolean" ? x.enabled : fallback[day].enabled,
      start: safeTimeHHMM(x.start, fallback[day].start),
      end: safeTimeHHMM(x.end, fallback[day].end),
    };
    return acc;
  }, {} as BusinessHoursMap);
}

function normalizeWeekdayList(v: unknown): WeekdayKey[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((d: unknown) => String(d || "").trim().toLowerCase() as WeekdayKey)
    .filter((d) => WEEKDAY_KEYS.includes(d))
    .filter((d, idx, arr) => arr.indexOf(d) === idx);
}

function readBookingHourOverrides(raw: unknown): BookingHourOverride[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x: unknown) => {
      const row = (x || {}) as Record<string, unknown>;
      const fromDate = String(row?.fromDate || "").trim();
      const toDate = String(row?.toDate || "").trim();
      if (!fromDate || !toDate) return null;
      const mode: BookingHourOverrideMode = String(row?.mode || "").trim() === "closed" ? "closed" : "hours";
      return {
        id: String(row?.id || "").trim() || undefined,
        fromDate,
        toDate,
        mode,
        start: String(row?.start || "").trim() || undefined,
        end: String(row?.end || "").trim() || undefined,
        includeWeekdays: normalizeWeekdayList(row?.includeWeekdays),
        blockedWeekdays: normalizeWeekdayList(row?.blockedWeekdays),
      };
    })
    .filter(Boolean) as BookingHourOverride[];
}

function isDateWithinRange(dateISO: string, fromDate: string, toDate: string) {
  const d = String(dateISO || "").trim();
  const from = String(fromDate || "").trim();
  const to = String(toDate || "").trim();
  if (!d || !from || !to) return false;
  return d >= from && d <= to;
}

function getDaySettingsForDate(
  dateISO: string,
  businessHours: BusinessHoursMap,
  bookingHourOverrides: BookingHourOverride[]
) {
  const dayKey = resolveWeekdayFromISO(dateISO);
  const dayHoursBase = businessHours?.[dayKey] || { enabled: true, start: "10:00", end: "22:00" };

  for (let i = bookingHourOverrides.length - 1; i >= 0; i--) {
    const ov = bookingHourOverrides[i];
    if (!isDateWithinRange(dateISO, ov.fromDate, ov.toDate)) continue;

    const includeDays = Array.isArray(ov.includeWeekdays) ? ov.includeWeekdays : [];
    if (includeDays.length > 0 && !includeDays.includes(dayKey)) continue;

    const blockedDays = Array.isArray(ov.blockedWeekdays) ? ov.blockedWeekdays : [];
    if (blockedDays.includes(dayKey) || String(ov?.mode || "").trim() === "closed") {
      return {
        dayKey,
        enabled: false,
        openTime: safeTimeHHMM(dayHoursBase?.start, "10:00"),
        closeTime: safeTimeHHMM(dayHoursBase?.end, "22:00"),
      };
    }

    return {
      dayKey,
      enabled: true,
      openTime: safeTimeHHMM(String(ov?.start || ""), safeTimeHHMM(dayHoursBase?.start, "10:00")),
      closeTime: safeTimeHHMM(String(ov?.end || ""), safeTimeHHMM(dayHoursBase?.end, "22:00")),
    };
  }

  return {
    dayKey,
    enabled: dayHoursBase?.enabled !== false,
    openTime: safeTimeHHMM(dayHoursBase?.start, "10:00"),
    closeTime: safeTimeHHMM(dayHoursBase?.end, "22:00"),
  };
}

function dateToISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getNextDateISOForWeekday(target: WeekdayKey, startISO: string): string {
  const m = String(startISO || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return todayISO();
  const start = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  for (let i = 0; i <= 13; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = dateToISO(d);
    if (resolveWeekdayFromISO(iso) === target) return iso;
  }
  return startISO;
}

function compressWorkingHoursRows(rows: Array<{ dayKey: WeekdayKey; day: string; hours: string }>) {
  if (!rows.length) return [] as Array<{ day: string; hours: string }>;
  const out: Array<{ day: string; hours: string }> = [];
  let groupStart = 0;
  for (let i = 1; i <= rows.length; i++) {
    const sameAsGroup = i < rows.length && rows[i].hours === rows[groupStart].hours;
    if (sameAsGroup) continue;
    const first = rows[groupStart];
    const last = rows[i - 1];
    const day = groupStart === i - 1 ? first.day : `${first.day} - ${last.day}`;
    out.push({ day, hours: first.hours });
    groupStart = i;
  }
  return out;
}

function parseWorkingHourLine(lineRaw: string) {
  const line = String(lineRaw || "").trim();
  if (!line) return { day: "", hours: "" };

  // الحالة الطبيعية: "اليوم: 03:00 مساء - 10:00 مساء"
  const firstColon = line.indexOf(":");
  if (firstColon > -1) {
    const left = line.slice(0, firstColon).trim();
    const right = line.slice(firstColon + 1).trim();
    // لو الجهة اليسار فيها أرقام فغالبًا هذا ":" تبع الوقت وليس فاصل اليوم
    if (left && !/\d/.test(left)) {
      return { day: left, hours: right };
    }
  }

  // fallback: "السبت - الجمعة 03:00 مساء - 10:00 مساء"
  const timeMatch = line.match(/\d{1,2}:\d{2}/);
  if (timeMatch?.index !== undefined) {
    const idx = timeMatch.index;
    const day = line.slice(0, idx).trim().replace(/[:\-–—\s]+$/, "").trim();
    const hours = line.slice(idx).trim();
    return { day: day || line, hours };
  }

  return { day: line, hours: "" };
}

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
  const [appSettings, setAppSettings] = useState<Record<string, unknown> | null>(null);
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

  useEffect(() => {
    const ref = doc(db, "salons", SALON_ID, "settings", "app");
    const unsub = onSnapshot(
      ref,
      (snap) => setAppSettings(snap.exists() ? snap.data() : null),
      (err) => {
        console.error("app settings snapshot error:", err);
        setAppSettings(null);
      }
    );
    return () => unsub();
  }, []);

  // ✅ ساعات العمل من settings/app/booking (Single Source of Truth)
  const bookingWorkingHours = useMemo(() => {
    const app = (appSettings || {}) as Record<string, unknown>;
    const booking = (app.booking || {}) as Record<string, unknown>;
    const rawBusinessHours = booking.businessHours as Record<string, unknown> | undefined;
    const bookingHourOverrides = readBookingHourOverrides(booking.bookingHourOverrides);

    const hasBusinessHours =
      !!rawBusinessHours &&
      typeof rawBusinessHours === "object" &&
      WEEKDAY_KEYS.some((dayKey) =>
        Object.prototype.hasOwnProperty.call(rawBusinessHours, dayKey)
      );
    const hasOverrides = bookingHourOverrides.length > 0;

    if (!hasBusinessHours && !hasOverrides) return [];

    const businessHours = readBusinessHours(rawBusinessHours || {});
    const today = todayISO();

    const rows = WEEKDAY_KEYS.map((dayKey) => {
      const dateISO = getNextDateISOForWeekday(dayKey, today);
      const daySettings = getDaySettingsForDate(dateISO, businessHours, bookingHourOverrides);
      const hours =
        daySettings.enabled === false
          ? "مغلق"
          : `${formatTime12(daySettings.openTime, daySettings.openTime)} - ${formatTime12(
              daySettings.closeTime,
              daySettings.closeTime
            )}`;
      return { dayKey, day: WEEKDAY_LABEL_AR[dayKey], hours };
    });

    return compressWorkingHoursRows(rows);
  }, [appSettings]);

  // ✅ fallback مؤقت من settings/public (hoursText) إذا بيانات الحجز غير متوفرة
  const fallbackWorkingHours = useMemo(() => {
    const raw = publicSettings?.hoursText?.trim();
    if (!raw) return [] as Array<{ day: string; hours: string }>;
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => parseWorkingHourLine(line));
  }, [publicSettings?.hoursText]);

  const workingHours =
    bookingWorkingHours.length > 0 ? bookingWorkingHours : fallbackWorkingHours;

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
  const mapEmbedUrl = normalizeMapEmbedUrl(publicSettings?.mapEmbedUrl);
  const hasMap = !!mapEmbedUrl && mapEmbedUrl.includes("google.com/maps/embed");

  return (
    <div className="contact-page py-5">


      {/* ✅ مودال بدل Alert المتصفح */}
      {modalOpen ? (
        <Modal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          ariaLabel={modalType === "success" ? "تم الإرسال" : "تعذر الإرسال"}
          panelClassName="modal-box"
          size="sm"
        >
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
        </Modal>
      ) : null}



      <div className="container">
        <h1 className="contact-title contact-title-gradient text-center mb-2 qs-wine">
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
                </div>
              </div>
            </div>

            <section className="contact-map-section">
              <div className="container ">
                <h3 className="contact-map-title">
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
                      title="MALIKAT SALON Location"
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

