// src/pages/Profile.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../styles/Profile.css";

import { onAuthStateChanged, signOut, type User as FirebaseUser } from "firebase/auth";
import { auth, db } from "../services/firebase";

import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";

import { createOrLoadUserProfile, updateUserProfile, type UserProfile } from "../services/userProfile";

// =======================
// دعم واتساب
// =======================
const SUPPORT_PHONE = "966573235247"; // ✅ بدون +
const SUPPORT_MSG = "مرحباً، أحتاج مساعدة في حسابي في صالون ملكات.";

function getWhatsAppLink(phoneDigits: string, msg: string) {
  return `https://wa.me/${phoneDigits}?text=${encodeURIComponent(msg)}`;
}

// =======================
// خدمات (عرض فقط) - مؤقتاً
// =======================
const services = [
  { id: "haircut", name: "قص الشعر" },
  { id: "coloring", name: "صبغة الشعر" },
  { id: "styling", name: "تسريحات الشعر" },
  { id: "treatment", name: "معالجات الشعر" },
  { id: "makeup", name: "مكياج" },
  { id: "nails", name: "العناية بالأظافر" },
  { id: "facial", name: "العناية بالبشرة" },
  { id: "waxing", name: "إزالة الشعر" },
];

const getServiceName = (id: string) => services.find((s) => s.id === id)?.name || id;

// =======================
interface BookingData {
  id: string; // ✅ صار مستخدم (key + ضمن البيانات)
  name: string;
  phone: string;
  service: string;   // عندنا نخليه اسم خدمة للعرض
  employee: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  status?: string;
  total?: number;
  finalPrice?: number;
  createdAt?: number; // millis
  publicId?: string;  // MK-xxxxx (اختياري للعرض)
}

type ProfileMode = "firebase" | "local";

function statusClass(status?: string) {
  const s = String(status || "").trim().toLowerCase();
  if (s === "مؤكد" || s === "confirmed") return "confirmed";
  if (s === "انتظار" || s === "pending") return "pending";
  if (s === "مكتمل" || s === "completed") return "completed";
  if (s === "ملغي" || s === "cancelled") return "cancelled";
  return "";
}

function normalizeKsaPhone(raw: string) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";

  if (digits.startsWith("9665") && digits.length === 12) return "0" + digits.slice(3);
  if (digits.startsWith("5") && digits.length === 9) return "0" + digits;
  if (digits.startsWith("05") && digits.length === 10) return digits;

  return digits;
}

function clearClientCacheOnly() {
  localStorage.removeItem("user_profile_v1");
  localStorage.removeItem("userAvatar");
}

// YYYY-MM-DD + HH:mm -> timestamp
function toTs(dateISO: string, timeHHmm: string) {
  const d = String(dateISO || "").trim();
  const t = String(timeHHmm || "").trim();
  if (!d || !t) return 0;
  const iso = `${d}T${t}:00`;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function formatDateAr(dateISO: string) {
  if (!dateISO) return "";
  // عرض بسيط: 2026-01-27 -> 27/01/2026
  const [y, m, d] = dateISO.split("-");
  if (!y || !m || !d) return dateISO;
  return `${d}/${m}/${y}`;
}

// ===== Firestore helpers =====
const SALON_ID = "main";

type FsBooking = {
  userId?: string | null;

  clientName?: string;
  clientPhone?: string;

  // legacy + new
  serviceName?: string;
  serviceId?: string;
  serviceSnapshot?: {
    serviceNameAtBooking?: string;
    priceAtBooking?: number;
    durationAtBooking?: number;
  };

  publicId?: string;

  employeeName?: string;
  employeeId?: string | null;
  employeeUid?: string | null;

  date?: string;
  time?: string;
  status?: string;

  total?: number;
  finalPrice?: number;

  createdAt?: any; // Timestamp
  updatedAt?: any; // Timestamp
};

function toMillisAny(v: any): number {
  if (!v) return 0;
  if (typeof v === "number") return v;
  if (typeof v?.toMillis === "function") return v.toMillis();
  if (v?.seconds) return Number(v.seconds) * 1000;
  return 0;
}

function mapFsBookingToUi(id: string, b: FsBooking): BookingData {
  const serviceId = String(b?.serviceId || "").trim();
  const legacyServiceName = String(b?.serviceName || "").trim();
  const snapName = String(b?.serviceSnapshot?.serviceNameAtBooking || "").trim();

  const serviceForDisplay =
    snapName ||
    legacyServiceName ||
    (serviceId ? getServiceName(serviceId) : "—");

  const createdAt =
    toMillisAny(b.createdAt) || toMillisAny(b.updatedAt) || Date.now();

  return {
    id, // ✅ صار مستخدم
    name: String(b.clientName || "عميلة"),
    phone: String(b.clientPhone || ""),
    service: serviceForDisplay,
    employee: String(b.employeeName || ""),
    date: String(b.date || ""),
    time: String(b.time || ""),
    status: String(b.status || "pending"),
    total: Number(b.total ?? 0) || 0,
    finalPrice: Number(b.finalPrice ?? 0) || 0,
    createdAt,
    publicId: String(b.publicId || ""),
  };
}

const Profile: React.FC = () => {
  const navigate = useNavigate();

  const [profileMode, setProfileMode] = useState<ProfileMode>("local");
  const [firebaseUid, setFirebaseUid] = useState<string | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [profileDoc, setProfileDoc] = useState<UserProfile | null>(null);

  const [authChecked, setAuthChecked] = useState(false);

  const cachedProfile = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("user_profile_v1") || "null");
    } catch {
      return null;
    }
  }, []);

  const currentUser = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("currentUser") || "null");
    } catch {
      return null;
    }
  }, []);

  const [userData, setUserData] = useState({
    name: cachedProfile?.name || currentUser?.name || localStorage.getItem("userName") || "",
    phone: normalizeKsaPhone(
      cachedProfile?.phone || currentUser?.phone || localStorage.getItem("userPhone") || ""
    ),
    email: cachedProfile?.email || currentUser?.email || localStorage.getItem("userEmail") || "",
    city: cachedProfile?.city || currentUser?.city || "",
    birthdate: cachedProfile?.birthdate || currentUser?.birthdate || "",
    avatar: localStorage.getItem("userAvatar") || "",
  });

  // =======================
  // Firebase / Local mode
  // =======================
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user || null);

      if (!user) {
        setProfileMode("local");
        setFirebaseUid(null);
        setProfileDoc(null);

        try {
          const cached = JSON.parse(localStorage.getItem("user_profile_v1") || "null");
          if (cached) {
            setUserData((prev) => ({
              ...prev,
              name: cached.name || prev.name,
              phone: normalizeKsaPhone(cached.phone || prev.phone),
              email: cached.email || prev.email,
              city: cached.city || prev.city,
              birthdate: cached.birthdate || prev.birthdate,
            }));
          }
        } catch {}

        setAuthChecked(true);
        return;
      }

      try {
        setProfileMode("firebase");
        setFirebaseUid(user.uid);

        const p = await createOrLoadUserProfile(user);

        const pr = String((p as any)?.role || "").toLowerCase().trim();
        if (pr && pr !== "client") {
          clearClientCacheOnly();
          navigate("/dashboard-pending", { replace: true });
          setAuthChecked(true);
          return;
        }

        setProfileDoc(p);
        setUserData((prev) => ({
          ...prev,
          name: p.name || prev.name,
          phone: normalizeKsaPhone(p.phone || prev.phone), // ✅ استخدام normalizeKsaPhone
          email: p.email || prev.email,
          city: p.city || prev.city,
          birthdate: p.birthdate || prev.birthdate,
        }));

        localStorage.setItem("user_profile_v1", JSON.stringify(p));
        if (p?.name) localStorage.setItem("userName", String(p.name));
        if (p?.email) localStorage.setItem("userEmail", String(p.email));
        if (p?.phone) localStorage.setItem("userPhone", normalizeKsaPhone(String(p.phone))); // ✅

        window.dispatchEvent(new Event("authChanged"));
      } catch (e) {
        console.error("Profile load error:", e);
        clearClientCacheOnly();
        navigate("/dashboard-pending", { replace: true });
      } finally {
        setAuthChecked(true);
      }
    });

    return () => unsub();
  }, [navigate]);

  useEffect(() => {
    if (!authChecked) return;

    const token = localStorage.getItem("authToken");
    const firebaseOk = !!firebaseUser;

    const localRole = String(localStorage.getItem("userRole") || "").toLowerCase().trim();
    if (localRole && localRole !== "client") {
      navigate("/dashboard-pending", { replace: true });
      return;
    }

    if (!token && !firebaseOk) {
      navigate("/login", { replace: true });
    }
  }, [authChecked, firebaseUser, navigate]);

  // =======================
  // ✅ الحجوزات (Realtime من Firestore بدل localStorage)
  // =======================
  const [bookings, setBookings] = useState<BookingData[]>([]);
  const [bookingsErr, setBookingsErr] = useState<string>("");

  useEffect(() => {
    // لو ما عندنا UID ما نقدر نجيب حجوزات Firestore
    if (profileMode !== "firebase" || !firebaseUid) {
      setBookings([]);
      return;
    }

    setBookingsErr("");
    console.log("[Profile] mode=", profileMode, "uid=", firebaseUid);

    const colRef = collection(db, "salons", SALON_ID, "bookings");

    // ✅ هنا استخدام orderBy فعلياً (يحل TS6133)
    const qy = query(
      colRef,
      where("userId", "==", firebaseUid),
      orderBy("createdAt", "desc")
    );

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const rows: BookingData[] = [];
        snap.forEach((d) => {
          rows.push(mapFsBookingToUi(d.id, d.data() as any));
        });

        // احتياط: رتب لو createdAt ناقص
        rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        setBookings(rows);

        console.log("[Profile] bookings snap size=", snap.size);
      },
      (err) => {
        console.error("Bookings snapshot error:", err);
        setBookingsErr("تعذر تحميل الحجوزات (صلاحيات/اتصال)");
        setBookings([]);
      }
    );

    return () => unsub();
  }, [profileMode, firebaseUid]);

  const nowTs = Date.now();

  const upcomingBooking = useMemo(() => {
    const list = bookings
      .filter((b) => {
        const s = String(b.status || "").toLowerCase().trim();
        if (s === "ملغي" || s === "cancelled") return false;
        if (s === "مكتمل" || s === "completed") return false;
        return toTs(b.date, b.time) >= nowTs;
      })
      .sort((a, b) => toTs(a.date, a.time) - toTs(b.date, b.time));

    return list[0] || null;
  }, [bookings, nowTs]);

  const lastBooking = useMemo(() => {
    const list = bookings
      .filter((b) => toTs(b.date, b.time) < nowTs)
      .sort((a, b) => toTs(b.date, b.time) - toTs(a.date, a.time));

    return list[0] || null;
  }, [bookings, nowTs]);

  // KPIs
  const kpis = useMemo(() => {
    const total = bookings.length;

    const countBy = (key: "confirmed" | "pending" | "completed" | "cancelled") =>
      bookings.filter((b) => statusClass(b.status) === key).length;

    return {
      total,
      confirmed: countBy("confirmed"),
      pending: countBy("pending"),
      completed: countBy("completed"),
      cancelled: countBy("cancelled"),
    };
  }, [bookings]);

  // =======================
  // عضوية / رقم عضوية
  // =======================
  const membershipPercent =
    typeof (profileDoc as any)?.membershipPercent === "number"
      ? (profileDoc as any).membershipPercent
      : 0;

  const membershipId =
    (profileDoc as any)?.membershipId ||
    (profileMode === "firebase" && firebaseUid
      ? `client-${new Date().getFullYear()}-${firebaseUid.slice(0, 6)}`
      : "client-0000");

  const progress = Math.min(Math.max(Number(membershipPercent) || 0, 0), 100);

  const copyMembershipId = async () => {
    try {
      await navigator.clipboard.writeText(String(membershipId));
      alert("تم نسخ رقم العضوية ✅");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = String(membershipId);
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      alert("تم نسخ رقم العضوية ✅");
    }
  };

  // =======================
  // Avatar
  // =======================
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = ev.target?.result as string;
      setUserData((prev) => ({ ...prev, avatar: img }));
      localStorage.setItem("userAvatar", img);
    };
    reader.readAsDataURL(file);
  };

  // =======================
  // Modal تعديل البيانات
  // =======================
  const [showEditModal, setShowEditModal] = useState(false);
  const [editData, setEditData] = useState({ ...userData });

  useEffect(() => setEditData({ ...userData }), [userData]);

  const handleSaveEdit = async () => {
    try {
      const normalizedPhone = normalizeKsaPhone(editData.phone); // ✅ استخدام normalizeKsaPhone

      if (profileMode === "firebase" && firebaseUid) {
        await updateUserProfile(firebaseUid, {
          name: editData.name,
          phone: normalizedPhone,
          email: editData.email,
          city: editData.city,
          birthdate: editData.birthdate,
        } as any);

        setUserData({ ...editData, phone: normalizedPhone });

        const merged = {
          ...(profileDoc || {}),
          uid: firebaseUid,
          name: editData.name,
          phone: normalizedPhone,
          email: editData.email,
          city: editData.city,
          birthdate: editData.birthdate,
        };

        localStorage.setItem("user_profile_v1", JSON.stringify(merged));
        localStorage.setItem("userName", editData.name);
        localStorage.setItem("userEmail", editData.email);
        localStorage.setItem("userPhone", normalizedPhone);
        window.dispatchEvent(new Event("authChanged"));

        setShowEditModal(false);
        return;
      }

      // Local mode
      let clients = JSON.parse(localStorage.getItem("clients") || "[]");
      clients = clients.map((u: any) =>
        u.phone === userData.phone ? { ...u, ...editData, phone: normalizedPhone } : u
      );
      localStorage.setItem("clients", JSON.stringify(clients));
      localStorage.setItem("currentUser", JSON.stringify({ ...(currentUser || {}), ...editData, phone: normalizedPhone }));
      localStorage.setItem("userName", editData.name);
      localStorage.setItem("userEmail", editData.email);
      localStorage.setItem("userPhone", normalizedPhone);
      window.dispatchEvent(new Event("authChanged"));

      setUserData({ ...editData, phone: normalizedPhone });
      setShowEditModal(false);
    } catch (e) {
      console.error("Save profile error:", e);
      alert("صار خطأ أثناء حفظ البيانات. حاول مرة ثانية.");
    }
  };

  // =======================
  // تسجيل الخروج
  // =======================
  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch {}

    localStorage.removeItem("authToken");
    localStorage.removeItem("userRole");
    localStorage.removeItem("userName");
    localStorage.removeItem("currentUser");
    localStorage.removeItem("auth_user");
    localStorage.removeItem("userUid");
    localStorage.removeItem("showWelcome");
    localStorage.removeItem("userEmail");
    localStorage.removeItem("userPhone");
    localStorage.removeItem("user_profile_v1");
    localStorage.removeItem("userAvatar");

    window.dispatchEvent(new Event("authChanged"));
    window.location.href = "/login";
  };

  // =======================
  // UI helpers: search + filter
  // =======================
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [q, setQ] = useState("");

  const bookingsFiltered = useMemo(() => {
    const qq = q.trim().toLowerCase();

    return bookings.filter((b) => {
      const st = statusClass(b.status);
      if (statusFilter !== "all" && st !== statusFilter) return false;

      if (!qq) return true;

      const blob = [
        b.service,
        b.employee,
        b.date,
        b.time,
        b.status,
        String(b.total || ""),
        String(b.finalPrice || ""),
        String(b.publicId || ""),
      ]
        .join(" ")
        .toLowerCase();

      return blob.includes(qq);
    });
  }, [bookings, statusFilter, q]);

  // =======================
  // لودر قبل فحص الدخول
  // =======================
  if (!authChecked) {
    return (
      <div className="profile-page">
        <div className="container" style={{ maxWidth: 980, textAlign: "center" }}>
          جاري تحميل الحساب...
        </div>
      </div>
    );
  }

  return (
    <div className="profile-page">
      <div className="container" style={{ maxWidth: 980 }}>
        {/* ===== Header / Quick Top ===== */}
        <div className="profile-hero">
          <div className="profile-hero-left">
            <div className="profile-avatar">
              {userData.avatar ? <img src={userData.avatar} alt="avatar" /> : <span>👩‍🦰</span>}

              <button
                type="button"
                className="avatar-upload-btn"
                title="تغيير الصورة"
                onClick={() => fileInputRef.current?.click()}
              >
                ✚
              </button>

              <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleAvatarChange} />
            </div>

            <div className="profile-hero-meta">
              <h2 className="profile-name">{userData.name || "عميلة"}</h2>
              <div className="profile-sub">
                {userData.phone ? <span>📱 {normalizeKsaPhone(userData.phone)}</span> : null}
                {userData.email ? <span>✉️ {userData.email}</span> : null}
                {userData.city ? <span>📍 {userData.city}</span> : null}
              </div>

              <div className="profile-id-row" title="رقم العضوية">
                <span className="profile-id">{membershipId}</span>
                <span
                  className="profile-id-copy"
                  role="button"
                  tabIndex={0}
                  onClick={copyMembershipId}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") copyMembershipId();
                  }}
                  title="نسخ رقم العضوية"
                >
                  📋
                </span>
              </div>
            </div>
          </div>

          <div className="profile-hero-right">
            <div className="profile-progress">
              <div className="profile-progress-bar" style={{ width: `${progress}%` }} />
              <div className="profile-points-label">نسبة العضوية: {progress}%</div>
            </div>

            <div className="profile-actions">
              <button className="qs-btn qs-btn--ghost" type="button" onClick={() => setShowEditModal(true)}>
                ✏️ تعديل البيانات
              </button>

              <a className="qs-btn qs-btn--wa" href={getWhatsAppLink(SUPPORT_PHONE, SUPPORT_MSG)} target="_blank" rel="noreferrer">
                💬 دعم واتساب
              </a>

              <button className="qs-btn qs-btn--danger" onClick={handleLogout}>
                🚪 تسجيل الخروج
              </button>
            </div>
          </div>
        </div>

        {/* ✅ تنبيه لو صار Permission Denied */}
        {bookingsErr ? (
          <div className="dash-alert" style={{ marginTop: 12 }}>
            {bookingsErr}
            <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6 }}>
              * إذا طلع Permission Denied: تأكد أن الحجز يحتوي userId = UID حق العميلة، والـ rules تسمح read للعميلة على حجوزاتها.
            </div>
          </div>
        ) : null}

        {/* ===== KPIs ===== */}
        <div className="profile-kpis">
          <div className="kpi-card">
            <div className="kpi-label">إجمالي الحجوزات</div>
            <div className="kpi-value">{kpis.total}</div>
          </div>

          <div className="kpi-card">
            <div className="kpi-label">مؤكدة</div>
            <div className="kpi-value">{kpis.confirmed}</div>
          </div>

          <div className="kpi-card">
            <div className="kpi-label">انتظار</div>
            <div className="kpi-value">{kpis.pending}</div>
          </div>

          <div className="kpi-card">
            <div className="kpi-label">مكتملة</div>
            <div className="kpi-value">{kpis.completed}</div>
          </div>

          <div className="kpi-card">
            <div className="kpi-label">ملغية</div>
            <div className="kpi-value">{kpis.cancelled}</div>
          </div>
        </div>

        {/* ===== Next + Last ===== */}
        <div className="profile-grid">
          <div className="profile-panel">
            <div className="panel-head">
              <h3>الحجز القادم</h3>
              <button className="qs-link" onClick={() => navigate("/booking")}>
                حجز جديد ↩︎
              </button>
            </div>

            {!upcomingBooking ? (
              <div className="panel-empty">ما عندك حجز قادم حالياً. ✨ احجزي موعدك الآن.</div>
            ) : (
              <div className="booking-cardx">
                <div className="booking-cardx-top">
                  <div className="booking-cardx-title">{upcomingBooking.service}</div>
                  <span className={`status-badge ${statusClass(upcomingBooking.status)}`}>
                    {upcomingBooking.status || "—"}
                  </span>
                </div>

                <div className="booking-cardx-meta">
                  <div>👩‍💼 {upcomingBooking.employee || "-"}</div>
                  <div>📅 {formatDateAr(upcomingBooking.date)}</div>
                  <div>⏰ {upcomingBooking.time}</div>
                  {upcomingBooking.publicId ? <div>🧾 {upcomingBooking.publicId}</div> : null}
                </div>

                <div className="booking-cardx-actions">
                  <button
                    className="qs-btn qs-btn--primary"
                    onClick={() => navigate("/track")}
                    type="button"
                  >
                    تتبع الحجز
                  </button>

                  <a
                    className="qs-btn qs-btn--ghost"
                    href={getWhatsAppLink(SUPPORT_PHONE, `مرحباً، عندي حجز بتاريخ ${upcomingBooking.date} الساعة ${upcomingBooking.time}.`)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    تواصل بخصوص الحجز
                  </a>
                </div>
              </div>
            )}
          </div>

          <div className="profile-panel">
            <div className="panel-head">
              <h3>آخر حجز</h3>
              <span className="panel-hint">آخر نشاط لك عندنا 💗</span>
            </div>

            {!lastBooking ? (
              <div className="panel-empty">ما عندك حجوزات سابقة مرتبطة بهذا الحساب.</div>
            ) : (
              <div className="booking-cardx is-last">
                <div className="booking-cardx-top">
                  <div className="booking-cardx-title">{lastBooking.service}</div>
                  <span className={`status-badge ${statusClass(lastBooking.status)}`}>
                    {lastBooking.status || "—"}
                  </span>
                </div>

                <div className="booking-cardx-meta">
                  <div>👩‍💼 {lastBooking.employee || "-"}</div>
                  <div>📅 {formatDateAr(lastBooking.date)}</div>
                  <div>⏰ {lastBooking.time}</div>
                  {lastBooking.publicId ? <div>🧾 {lastBooking.publicId}</div> : null}
                </div>

                <div className="booking-cardx-actions">
                  <button className="qs-btn qs-btn--ghost" onClick={() => navigate("/booking")} type="button">
                    إعادة حجز مشابه
                  </button>

                  <button
                    className="qs-btn qs-btn--primary"
                    type="button"
                    onClick={() => alert("قريباً: تقييم الخدمة ✨")}
                  >
                    تقييم الخدمة
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ===== Activity Timeline ===== */}
        <div className="profile-panel mt-3">
          <div className="panel-head">
            <h3>آخر النشاط</h3>
            <span className="panel-hint">أحدث 5 حجوزات</span>
          </div>

          {bookings.length === 0 ? (
            <div className="panel-empty">لا يوجد نشاط حتى الآن.</div>
          ) : (
            <div className="timeline">
              {bookings.slice(0, 5).map((b) => (
                <div className="timeline-item" key={b.id}>
                  <div className="timeline-dot" />
                  <div className="timeline-card">
                    <div className="timeline-top">
                      <div className="timeline-title">{b.service}</div>
                      <span className={`status-badge ${statusClass(b.status)}`}>{b.status || "—"}</span>
                    </div>
                    <div className="timeline-meta">
                      <span>📅 {formatDateAr(b.date)}</span>
                      <span>⏰ {b.time}</span>
                      <span>👩‍💼 {b.employee || "-"}</span>
                      {b.publicId ? <span>🧾 {b.publicId}</span> : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ===== Bookings Table ===== */}
        <div className="profile-panel mt-3">
          <div className="panel-head">
            <h3>حجوزاتي</h3>

            <div className="panel-tools">
              <div className="qs-input">
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="ابحثي (خدمة، موظفة، تاريخ...)"
                />
              </div>

              <div className="qs-select">
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="all">كل الحالات</option>
                  <option value="confirmed">مؤكد</option>
                  <option value="pending">انتظار</option>
                  <option value="completed">مكتمل</option>
                  <option value="cancelled">ملغي</option>
                </select>
              </div>
            </div>
          </div>

          {bookingsFiltered.length === 0 ? (
            <div className="panel-empty">لا يوجد نتائج مطابقة.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="qs-table">
                <thead>
                  <tr>
                    <th>الخدمة</th>
                    <th>الموظفة</th>
                    <th>التاريخ</th>
                    <th>الوقت</th>
                    <th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {bookingsFiltered.map((b) => (
                    <tr key={b.id}>
                      <td className="td-strong">{b.service}</td>
                      <td>{b.employee || "-"}</td>
                      <td>{formatDateAr(b.date)}</td>
                      <td>{b.time}</td>
                      <td>
                        <span className={`status-badge ${statusClass(b.status)}`}>
                          {b.status || "—"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ===== Edit Modal ===== */}
        {showEditModal && (
          <div className="profile-modal-overlay" onClick={() => setShowEditModal(false)}>
            <div className="profile-modal-dialog" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head">
                <h5>تعديل بيانات العميلة</h5>
                <button className="modal-x" onClick={() => setShowEditModal(false)} aria-label="close">
                  ✕
                </button>
              </div>

              <div className="modal-body">
                <div className="mb-2">
                  <label>الاسم</label>
                  <input
                    className="form-control"
                    value={editData.name}
                    onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                  />
                </div>

                <div className="mb-2">
                  <label>الجوال</label>
                  <input
                    className="form-control"
                    value={editData.phone}
                    onChange={(e) => setEditData({ ...editData, phone: e.target.value })}
                    onBlur={() =>
                      setEditData((prev) => ({
                        ...prev,
                        phone: normalizeKsaPhone(prev.phone),
                      }))
                    }
                    placeholder="05xxxxxxxx"
                  />
                  <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
                    سيتم حفظ الجوال بصيغة سعودية (مثال: 05xxxxxxxx) ✅
                  </div>
                </div>

                <div className="mb-2">
                  <label>البريد</label>
                  <input
                    className="form-control"
                    value={editData.email}
                    onChange={(e) => setEditData({ ...editData, email: e.target.value })}
                  />
                </div>

                <div className="mb-2">
                  <label>المدينة</label>
                  <input
                    className="form-control"
                    value={editData.city}
                    onChange={(e) => setEditData({ ...editData, city: e.target.value })}
                  />
                </div>

                <div className="mb-2">
                  <label>تاريخ الميلاد</label>
                  <input
                    type="date"
                    className="form-control"
                    value={editData.birthdate}
                    onChange={(e) => setEditData({ ...editData, birthdate: e.target.value })}
                  />
                </div>
              </div>

              <div className="modal-actions">
                <button className="qs-btn qs-btn--primary" onClick={handleSaveEdit} type="button">
                  حفظ
                </button>
                <button className="qs-btn qs-btn--ghost" onClick={() => setShowEditModal(false)} type="button">
                  إلغاء
                </button>
              </div>

              <div className="modal-note">
                ملاحظة: قريباً نضيف (نقاط، مكافآت، سجل خدمات مفصل، وفواتير) 😌✨
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Profile;
