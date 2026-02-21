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
} from "@fortawesome/free-solid-svg-icons";
import { faWhatsapp } from "@fortawesome/free-brands-svg-icons";

import "../styles/Success.css";
import LoadingBrand from "../components/LoadingBrand";

// Firestore
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
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
  sectionLabel?: string;
  categoryLabel?: string;
  packageName?: string;
  packageServices?: Array<{
    serviceName: string;
    sectionLabel?: string;
    categoryLabel?: string;
    durationMin?: number;
    price?: number;
  }>;

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

function toArabicLabel(value: string, fallback = "-") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;

  const map: Record<string, string> = {
    makeup: "مكياج",
    "hair care": "العناية بالشعر",
    "hair-care": "العناية بالشعر",
    hair: "الشعر",
    nails: "الأظافر",
    skin: "البشرة",
    offers: "العروض",
    package: "باكيج",
    packages: "باكيجات",
    "auto assigned": "تعيين تلقائي",
    "auto-assigned": "تعيين تلقائي",
  };

  let s = raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  const lower = s.toLowerCase();

  Object.entries(map)
    .sort((a, b) => b[0].length - a[0].length)
    .forEach(([en, ar]) => {
      const re = new RegExp(`\\b${en.replace(/\s+/g, "\\s+")}\\b`, "gi");
      s = s.replace(re, ar);
    });

  s = s.replace(/\s+/g, " ").trim();
  return s || fallback;
}

function formatTime12ForClient(time24: string) {
  const m = String(time24 || "").trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return String(time24 || "-");
  const h24 = Number(m[1]);
  const mm = m[2];
  const h12 = h24 % 12 || 12;
  return `${String(h12).padStart(2, "0")}:${mm} ${h24 >= 12 ? "م" : "ص"}`;
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
    lines.push(`القسم: ${b.sectionLabel || "—"}`);
    lines.push(`التصنيف: ${b.categoryLabel || "—"}`);
    if (b.packageName) {
      lines.push(`الباكيج: ${b.packageName}`);
      const pkgServices = Array.isArray(b.packageServices) ? b.packageServices : [];
      if (pkgServices.length) {
        lines.push(`تفاصيل الباكيج:`);
        pkgServices.forEach((s, idx2) => {
          lines.push(`- ${idx2 + 1}) ${s.serviceName}${s.sectionLabel ? ` | ${s.sectionLabel}` : ""}${s.categoryLabel ? ` | ${s.categoryLabel}` : ""}`);
        });
      }
    }
    lines.push(`التاريخ: ${b.date || "—"}`);
    lines.push(`الوقت: ${formatTime12ForClient(b.time) || "—"}`);
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
          const serviceNameRaw = snapName || (await resolveServiceName(serviceId));
          const sectionLabelRaw = String(
            docData?.serviceSnapshot?.sectionTitleAtBooking ||
              docData?.serviceSnapshot?.sectionIdAtBooking ||
              ""
          ).trim();
          const categoryLabelRaw = String(
            docData?.serviceSnapshot?.categoryNameAtBooking ||
              docData?.serviceSnapshot?.categoryIdAtBooking ||
              ""
          ).trim();
          const packageNameRaw = String(docData?.packageSnapshot?.packageName || "").trim();
          const packageServices = Array.isArray(docData?.packageSnapshot?.services)
            ? docData.packageSnapshot.services
                .map((x: any) => ({
                  serviceName: toArabicLabel(String(x?.serviceName || x?.serviceId || "").trim(), "-"),
                  sectionLabel: toArabicLabel(String(x?.sectionTitle || x?.sectionId || "").trim(), "") || undefined,
                  categoryLabel: toArabicLabel(String(x?.categoryName || x?.categoryId || "").trim(), "") || undefined,
                  durationMin: Number.isFinite(Number(x?.durationMin)) ? Number(x.durationMin) : undefined,
                  price: Number.isFinite(Number(x?.price)) ? Number(x.price) : undefined,
                }))
                .filter((x: any) => !!x.serviceName)
            : [];

          const rawEmployeeName = toArabicLabel(String(docData.employeeName || "-"), "-");
          const shouldResolveFromSubs =
            rawEmployeeName === "تعيين تلقائي" ||
            rawEmployeeName === "-" ||
            rawEmployeeName === "غير محدد";

          let employeeNameResolved = rawEmployeeName;
          if (shouldResolveFromSubs) {
            try {
              const groupQ = query(
                collection(db, "salons", SALON_ID, "bookings"),
                where("bookingGroupId", "==", bookingId)
              );
              const subSnap = await getDocs(groupQ);
              const names = Array.from(
                new Set(
                  subSnap.docs
                    .filter((d) => String(d.id || "").trim() !== bookingId)
                    .map((d) => toArabicLabel(String((d.data() as any)?.employeeName || "").trim(), ""))
                    .filter((n) => n && n !== "تعيين تلقائي")
                )
              );
              if (names.length === 1) {
                employeeNameResolved = names[0];
              } else if (names.length > 1) {
                employeeNameResolved = "عدة موظفات";
              }
            } catch {
              // ignore and keep fallback employee name
            }
          }

          if (!mounted) return;

          results.push({
            id: docData.id || bookingId,
            publicId: normalizeMk(docData.publicId || ref.publicId || ""),
            clientName: docData.clientName || "-",
            clientPhone: docData.clientPhone || "-",

            serviceId,
            serviceName: toArabicLabel(serviceNameRaw, "-"),
            sectionLabel: toArabicLabel(sectionLabelRaw, "") || undefined,
            categoryLabel: toArabicLabel(categoryLabelRaw, "") || undefined,
            packageName: toArabicLabel(packageNameRaw, "") || undefined,
            packageServices,

            employeeName: employeeNameResolved,
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
                <span>تأكيد الحجز عبر واتساب</span>
              </div>
              <div className="success-cta-text qs-wine">
                يرجى التواصل عبر واتساب، وسيتم إرسال رابط الدفع لإتمام التأكيد 🤍
              </div>

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
              <div key={v.id} className={`success-booking-block ${idx > 0 ? "is-following" : ""}`}>
                {idx > 0 && <div className="success-sep is-soft" />}

                <div className="detail-row detail-row--full success-booking-id-row">
                  <div className="success-booking-id-pill">
                    <span className="success-booking-id-label">رقم الحجز:</span>
                    <span className="success-booking-id-value">{mk}</span>
                  </div>
                </div>

                <div className="detail-row">
                  <FontAwesomeIcon icon={faUser} className="detail-ico" />
                  <span className="detail-label">الملكة</span>
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
                  <FontAwesomeIcon icon={faCircleInfo} className="detail-ico" />
                  <span className="detail-label">القسم</span>
                  <span className="detail-value">{v.sectionLabel || "—"}</span>
                </div>
                <div className="detail-row">
                  <FontAwesomeIcon icon={faCircleInfo} className="detail-ico" />
                  <span className="detail-label">التصنيف</span>
                  <span className="detail-value">{v.categoryLabel || "—"}</span>
                </div>
                {v.packageName ? (
                  <div className="detail-row detail-row--full">
                    <span className="detail-label">تفاصيل الباكيج</span>
                    <span className="detail-value">
                      {v.packageName}
                      {Array.isArray(v.packageServices) && v.packageServices.length > 0 ? (
                        <div style={{ marginTop: 6 }}>
                          {v.packageServices.map((s, sIdx) => (
                            <div key={`pkg-svc-${v.id}-${sIdx}`} style={{ fontSize: 13 }}>
                              {sIdx + 1}) {s.serviceName}
                              {s.sectionLabel ? ` | ${s.sectionLabel}` : ""}
                              {s.categoryLabel ? ` | ${s.categoryLabel}` : ""}
                              {Number(s.durationMin || 0) > 0 ? ` | ${s.durationMin} د` : ""}
                              {Number(s.price || 0) > 0 ? ` | ${s.price} ر.س` : ""}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </span>
                  </div>
                ) : null}

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
                  <span className="detail-value">{formatTime12ForClient(v.time)}</span>
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
            <div className="total-row total-row--summary">
              <FontAwesomeIcon icon={faMoneyBill} />
              <span className="total-row-label">
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

          <div className="success-policy-top is-spaced">
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
