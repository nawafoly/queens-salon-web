// src/pages/Success.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faCalendarAlt,
  faClock,
  faUser,
  faPhone,
  faScissors,
  faUserTie,
  faMoneyBill,
  faCircleInfo,
  faArrowRight,
  faCopy,
  faCircleCheck,
  faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import { faWhatsapp } from "@fortawesome/free-brands-svg-icons";

import "../styles/Success.css";
import LoadingBrand from "../components/LoadingBrand";

// Firestore
import { doc, getDoc } from "firebase/firestore";
import { db } from "../services/firebase";
import { getBookingById } from "../services/firestoreBookings";

/* =========================
   Types & Const
========================= */

type UiBookingView = {
  id: string; // داخلي فقط
  publicId?: string; // MK-xxxx للعرض

  clientName: string;
  clientPhone: string;

  serviceId: string;
  serviceName: string;

  employeeName: string;
  date: string;
  time: string;

  total: number;
  status: string;
};

type LocalBookingRef = {
  id?: string;
  bookingId?: string;
  publicId?: string;
};

const BOOKING_KEY = "currentBooking";
const ALL_BOOKINGS_KEY = "allBookings";

const SALON_ID = "main";
const SALON_WHATSAPP = "966548440401";

/* =========================
   Helpers
========================= */

function normalizeMk(raw: string) {
  const s = String(raw || "").trim().toUpperCase();
  const digits = s.match(/\d{3,}/)?.[0] || "";
  if (!digits) return "";
  return `MK-${digits}`;
}

function safeNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function normStatus(s: string) {
  return String(s || "").toLowerCase().trim();
}

function statusLabel(s: string) {
  const v = normStatus(s);
  if (v === "confirmed" || s === "مؤكد") return "مؤكد";
  if (v === "pending" || s === "بانتظار" || s === "بالانتظار") return "بالانتظار";
  if (v === "completed" || s === "مكتمل") return "مكتمل";
  if (v === "cancelled" || s === "ملغي") return "ملغي";
  return s || "-";
}

function statusClass(s: string) {
  const v = normStatus(s);
  if (v === "confirmed" || s === "مؤكد") return "confirmed";
  if (v === "pending" || s === "بانتظار" || s === "بالانتظار") return "pending";
  if (v === "completed" || s === "مكتمل") return "completed";
  if (v === "cancelled" || s === "ملغي") return "cancelled";
  return "default";
}

function buildWhatsappMessageAll(bookings: UiBookingView[]) {
  const lines: string[] = [];
  lines.push("مرحباً 🌷");
  lines.push("أود تأكيد حجزي/حجوزاتي في صالون ملكات");
  lines.push("");

  bookings.forEach((b, i) => {
    const mk = String(b.publicId || "").trim() || "—";
    lines.push(`(${i + 1}) رقم الحجز: ${mk}`);
    lines.push(`الخدمة: ${b.serviceName || "—"}`);
    lines.push(`التاريخ: ${b.date || "—"}`);
    lines.push(`الوقت: ${b.time || "—"}`);
    lines.push(`الموظفة: ${b.employeeName || "—"}`);
    lines.push("");
  });

  lines.push("شكراً لكم 🤍");
  return lines.join("\n");
}

// اختياري: لو ما عندك snapshot أو تبي احتياط
async function resolveServiceName(serviceId: string): Promise<string> {
  if (!serviceId) return "—";

  // إذا واضح إنه اسم مو ID
  if (serviceId.length < 10) return serviceId;

  try {
    const ref = doc(db, "salons", SALON_ID, "services", serviceId);
    const snap = await getDoc(ref);
    if (!snap.exists()) return "—";
    return (snap.data() as any)?.name || (snap.data() as any)?.الاسم || "—";
  } catch {
    return "—";
  }
}

/** اقرأ allBookings (الجديد) ثم fallback لـ currentBooking (قديم) */
function readLocalBookingRefs(): LocalBookingRef[] {
  // 1) allBookings
  try {
    const rawAll = localStorage.getItem(ALL_BOOKINGS_KEY);
    const parsedAll = rawAll ? JSON.parse(rawAll) : null;

    if (Array.isArray(parsedAll) && parsedAll.length) {
      return parsedAll
        .map((x: any) => ({
          id: x?.id,
          bookingId: x?.bookingId,
          publicId: x?.publicId,
        }))
        .filter((x) => String(x?.id || x?.bookingId || "").trim());
    }
  } catch {
    // ignore
  }

  // 2) fallback currentBooking
  try {
    const raw = localStorage.getItem(BOOKING_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const one: LocalBookingRef = {
      id: parsed?.id,
      bookingId: parsed?.bookingId,
      publicId: parsed?.publicId,
    };
    if (String(one?.id || one?.bookingId || "").trim()) return [one];
  } catch {
    // ignore
  }

  return [];
}

export default function Success() {
  const navigate = useNavigate();
  const location = useLocation();
  void location;

  const [loading, setLoading] = useState(true);
  const [views, setViews] = useState<UiBookingView[]>([]);
  const [error, setError] = useState("");

  const [toastMsg, setToastMsg] = useState<string>("");
  const [toastType, setToastType] = useState<"success" | "error">("success");

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToastMsg(msg);
    setToastType(type);
    window.clearTimeout((showToast as any)._t);
    (showToast as any)._t = window.setTimeout(() => setToastMsg(""), 1600);
  };

  const bookingRefs = useMemo(() => readLocalBookingRefs(), []);

  useEffect(() => {
    let mounted = true;

    async function run() {
      try {
        setLoading(true);
        setError("");
        setViews([]);

        if (!bookingRefs.length) {
          setError("رقم الحجز غير موجود");
          return;
        }

        const results: UiBookingView[] = [];

        for (const ref of bookingRefs) {
          const bookingId = String(ref?.id || ref?.bookingId || "").trim();
          if (!bookingId) continue;

          const docData: any = await getBookingById(bookingId);
          if (!docData) continue;

          const serviceId = String(docData.serviceId ?? docData.serviceName ?? "").trim();
          const snapName = String(docData.serviceSnapshot?.serviceNameAtBooking ?? "").trim();
          const serviceName = snapName || (await resolveServiceName(serviceId));

          if (!mounted) return;

          results.push({
            id: docData.id || bookingId,
            publicId: normalizeMk(docData.publicId || ref.publicId || ""),
            clientName: docData.clientName || "-",
            clientPhone: docData.clientPhone || "-",

            serviceId,
            serviceName,

            employeeName: docData.employeeName || "-",
            date: docData.date || "-",
            time: docData.time || "-",

            total: safeNum(docData.finalPrice ?? docData.total),
            status: docData.status || "pending",
          });
        }

        if (!results.length) {
          setError("لم يتم العثور على الحجز");
          return;
        }

        results.sort((a, b) => {
          const ad = `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`);
          if (ad !== 0) return ad;
          return String(a.publicId || "").localeCompare(String(b.publicId || ""));
        });

        setViews(results);
      } catch (e: any) {
        console.error(e);
        setError(e?.message || "صار خطأ أثناء تحميل بيانات الحجز");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    run();
    return () => {
      mounted = false;
    };
  }, [bookingRefs]);

  const copyOne = async (publicIdRaw: string) => {
    const publicId = String(publicIdRaw || "").trim();
    if (!publicId) return showToast("رقم الحجز غير متوفر", "error");
    try {
      await navigator.clipboard.writeText(publicId);
      showToast("تم نسخ رقم الحجز ✅", "success");
    } catch {
      showToast("تعذر النسخ", "error");
    }
  };

  const copyAll = async () => {
    const ids = views
      .map((v) => String(v.publicId || "").trim())
      .filter((x) => x && x !== "—");

    if (!ids.length) return showToast("ما فيه أرقام MK للنسخ", "error");

    const text = ids.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      showToast("تم نسخ كل أرقام الحجوزات ✅", "success");
    } catch {
      showToast("تعذر النسخ", "error");
    }
  };

  const openWhatsapp = () => {
    if (!views.length) return showToast("بيانات الحجز غير متوفرة", "error");

    const hasAnyMk = views.some((v) => String(v.publicId || "").trim());
    if (!hasAnyMk) return showToast("رقم الحجز غير متوفر لإرسال الواتساب", "error");

    const msg = buildWhatsappMessageAll(views);
    const url = `https://wa.me/${SALON_WHATSAPP}?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  if (loading) {
    return <LoadingBrand text="جاري تحميل البيانات..." />;
  }

  if (error) {
    return (
      <div className="success-page">
        <div className="success-card">
          <div className="success-alert">
            <FontAwesomeIcon icon={faCircleInfo} />
            <span>{error}</span>
          </div>

          <div className="success-actions">
            <button
              className="success-btn success-home"
              onClick={() => navigate("/booking")}
              type="button"
            >
              <FontAwesomeIcon icon={faArrowRight} /> رجوع للحجز
            </button>
          </div>
        </div>
      </div>
    );
  }

  const first = views[0];
  const st = normStatus(first?.status || "pending");
  const isConfirmed = st === "confirmed" || first?.status === "مؤكد";

  const heroTitle =
    views.length > 1
      ? isConfirmed
        ? "تم تأكيد حجوزاتك بنجاح! 🎉"
        : "تم استلام طلب حجوزاتك بنجاح"
      : isConfirmed
      ? "تم تأكيد حجزك بنجاح! 🎉"
      : "تم استلام طلب حجزك بنجاح";

  // ✅ هنا النص اللي أرسلته أنت
  const heroDesc = isConfirmed
  const mkList = views
    .map((v) => String(v.publicId || "").trim())
    .filter(Boolean);

  const firstMk = String(first?.publicId || "").trim() || "—";
  const canTrack = firstMk !== "—";

  const totalAll = views.reduce((s, v) => s + safeNum(v.total), 0);

  return (
    <div className="success-page">
      <div className="success-card">
        <div className="success-topline" />

        <div className="success-header">
          <div className="success-icon" aria-hidden="true">
            <span className="success-check">✓</span>
          </div>

          <h1 className="success-title">{heroTitle}</h1>
          <p className="success-subtitle">{heroDesc}</p>


          {/* ✅ CTA واضح إذا Pending */}
          {!isConfirmed && (
            <div className="success-cta-box" role="note" aria-label="تنبيه تأكيد عبر واتساب">
              <div className="success-cta-title qs-wine">
                <FontAwesomeIcon icon={faTriangleExclamation} />
                <span>مهم: لازم تأكيد عبر واتساب</span>
              </div>
              <div className="success-cta-text qs-wine">
              لتثبيت الموعد، يرجى التواصل عبر واتساب حيث سيتم إرسال رابط الدفع لتأكيد الحجز 🤍              </div>

            </div>
          )}

          {/* ✅ إذا Confirmed نقدر نعرض رسالة لطيفة */}
          {isConfirmed && (
            <div className="success-confirmed-note">
              <FontAwesomeIcon icon={faCircleCheck} />
              <span>تم تأكيد الموعد ✅ ننتظرك بكل حب</span>
            </div>
          )}
        </div>

        {/* ✅ قائمة/بطاقات الحجوزات */}
        <div className="success-details">
          {views.map((v, idx) => {
            const mk = String(v.publicId || "").trim() || "—";
            return (
              <div key={v.id} style={{ paddingTop: idx ? 14 : 0 }}>
                {idx > 0 && <div className="success-sep" style={{ opacity: 0.15 }} />}

                <div className="detail-row detail-row--full" style={{ justifyContent: "space-between" }}>
                  <span className="mono qs-black" style={{ fontWeight: 800 }}>
                    {mk}
                  </span>

                  <button
                    type="button"
                    className="success-mini-copy qs-black"
                    onClick={() => copyOne(mk)}
                    title="نسخ رقم الحجز"
                    style={{
                      border: "1px solid rgba(13,13,13,0.15)",
                      background: "#fff",
                      borderRadius: 10,
                      padding: "6px 10px",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <FontAwesomeIcon icon={faCopy} /> نسخ
                  </button>
                </div>

                <div className="detail-row">
                  <FontAwesomeIcon icon={faUser} className="detail-ico" />
                  <span className="detail-label">العميلة</span>
                  <span className="detail-value">{v.clientName}</span>
                </div>

                <div className="detail-row">
                  <FontAwesomeIcon icon={faPhone} className="detail-ico" />
                  <span className="detail-label">الجوال</span>
                  <span className="detail-value">{v.clientPhone}</span>
                </div>

                <div className="detail-row">
                  <FontAwesomeIcon icon={faScissors} className="detail-ico" />
                  <span className="detail-label">الخدمة</span>
                  <span className="detail-value">{v.serviceName}</span>
                </div>

                <div className="detail-row">
                  <FontAwesomeIcon icon={faUserTie} className="detail-ico" />
                  <span className="detail-label">الموظفة</span>
                  <span className="detail-value">{v.employeeName}</span>
                </div>

                <div className="detail-row">
                  <FontAwesomeIcon icon={faCalendarAlt} className="detail-ico" />
                  <span className="detail-label">التاريخ</span>
                  <span className="detail-value">{v.date}</span>
                </div>

                <div className="detail-row">
                  <FontAwesomeIcon icon={faClock} className="detail-ico" />
                  <span className="detail-label">الوقت</span>
                  <span className="detail-value">{v.time}</span>
                </div>

                <div className="detail-row detail-row--full">
                  <span className={`status-pill ${statusClass(v.status)}`}>{statusLabel(v.status)}</span>
                </div>

                <div className="total-row">
                  <FontAwesomeIcon icon={faMoneyBill} />
                  <span>{v.total ? `${v.total.toLocaleString()} ريال` : "—"}</span>
                </div>
              </div>
            );
          })}

          {views.length > 1 && (
            <div className="total-row" style={{ marginTop: 14 }}>
              <FontAwesomeIcon icon={faMoneyBill} />
              <span style={{ fontWeight: 800 }}>
                الإجمالي لكل الحجوزات: {totalAll ? `${totalAll.toLocaleString()} ريال` : "—"}
              </span>
            </div>
          )}
        </div>

        {/* ✅ أزرار النسخ/واتساب (Grid) */}
        <div className="success-copy-actions">
          <button
            type="button"
            className="success-copy-btn"
            onClick={views.length > 1 ? copyAll : () => copyOne(firstMk)}
          >
            <FontAwesomeIcon icon={faCopy} /> {views.length > 1 ? "نسخ كل أرقام الحجوزات (MK)" : "نسخ رقم الحجز (MK)"}
          </button>

          <button type="button" className="success-copy-btn is-whatsapp is-green" onClick={openWhatsapp}>
            <FontAwesomeIcon icon={faWhatsapp} /> تأكيد الحجز عبر واتساب
          </button>
        </div>

        {/* ✅ سياسة التأكيد + الملاحظات */}
        <div className="success-policy">
          <div className="success-policy-top">
            <span className="success-policy-title">سياسة التأكيد</span>
          </div>

          <p className="success-policy-lead">
            يتطلب تأكيد الحجز دفع المبلغ المستحق خلال مدة أقصاها ساعتان من وقت إنشاء الحجز.
            في حال عدم إتمام الدفع خلال هذه الفترة، سيتم إلغاء الحجز تلقائيًا.
            في حال تم تأكيد الحجز المبلغ غير قابل للاسترداد، ويمكن نقل قيمته إلى موعد آخر عند إعادة الجدولة خلال مدة شهر واحد.
          </p>

          <div className="success-policy-top" style={{ marginTop: 10 }}>
            <span className="success-policy-title">ملاحظات مهمة</span>
          </div>

          <ul className="success-policy-list">
            <li>يرجى الحضور قبل الموعد بـ 10 دقائق.</li>
            <li>في حال التأخير لأكثر من 10 دقائق قد يتم اعتبار الموعد ملغيًا.</li>
            <li>يمنع دخول الأطفال حرصًا على راحة جميع العميلات.</li>
          </ul>

          <div className="success-policy-footer">شكرًا لاختيارك صالون ملكات، نسعد بخدمتك دائمًا ✨</div>
        </div>

        {/* ✅ أكشنز */}
        <div className="success-actions">
          <button
            className="success-btn success-primary"
            onClick={() => navigate(`/track/${encodeURIComponent(firstMk)}`)}
            type="button"
            disabled={!canTrack}
            title={canTrack ? "تتبع الحجز" : "رقم التتبع غير متوفر"}
          >
            تتبع الحجز
          </button>

          <button className="success-btn success-home" onClick={() => navigate("/")} type="button">
            الرئيسية
          </button>

          <button className="success-btn success-booking" onClick={() => navigate("/booking")} type="button">
            حجز جديد
          </button>
        </div>

        {toastMsg && <div className={`success-toast ${toastType}`}>{toastMsg}</div>}
      </div>
    </div>
  );
}
