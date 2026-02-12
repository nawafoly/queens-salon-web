// src/pages/Profile.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../styles/Profile.css";

import { onAuthStateChanged, signOut, type User as FirebaseUser } from "firebase/auth";
import { auth, db } from "../services/firebase";


import { collection, onSnapshot, query, where } from "firebase/firestore";

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
  id: string;
  name: string;
  phone: string;
  service: string;
  employee: string;
  date: string;
  time: string;
  status?: string;
  total?: number;
  finalPrice?: number;
  createdAt?: number;
  publicId?: string;
}

type ProfileMode = "firebase" | "local";

function statusKey(status?: string) {
  const s = String(status || "").trim().toLowerCase();
  if (s === "مؤكد" || s === "confirmed") return "confirmed";
  if (s === "انتظار" || s === "pending") return "pending";
  if (s === "مكتمل" || s === "completed") return "completed";
  if (s === "ملغي" || s === "cancelled") return "cancelled";
  return "pending";
}

function statusLabelAr(status?: string) {
  const k = statusKey(status);
  if (k === "confirmed") return "مؤكد";
  if (k === "pending") return "انتظار";
  if (k === "completed") return "مكتمل";
  if (k === "cancelled") return "ملغي";
  return String(status || "انتظار");
}

function normalizeKsaPhone(raw: string) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";

  if (digits.startsWith("9665") && digits.length === 12) return "0" + digits.slice(3);
  if (digits.startsWith("5") && digits.length === 9) return "0" + digits;
  if (digits.startsWith("05") && digits.length === 10) return digits;

  return digits;
}

function isValidISODate(value: string) {
  const v = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map((n) => Number(n));
  if (!y || !m || !d) return false;
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
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

  createdAt?: any;
  updatedAt?: any;
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
    snapName || legacyServiceName || (serviceId ? getServiceName(serviceId) : "—");

  const createdAt = toMillisAny(b.createdAt) || toMillisAny(b.updatedAt) || Date.now();

  return {
    id,
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
        } catch { }

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
          phone: normalizeKsaPhone(p.phone || prev.phone),
          email: p.email || prev.email,
          city: p.city || prev.city,
          birthdate: p.birthdate || prev.birthdate,
        }));

        localStorage.setItem("user_profile_v1", JSON.stringify(p));
        if (p?.name) localStorage.setItem("userName", String(p.name));
        if (p?.email) localStorage.setItem("userEmail", String(p.email));
        if (p?.phone) localStorage.setItem("userPhone", normalizeKsaPhone(String(p.phone)));

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
  // ✅ الحجوزات (Realtime من Firestore)
  // =======================
  const [bookings, setBookings] = useState<BookingData[]>([]);
  const [bookingsErr, setBookingsErr] = useState<string>("");

  useEffect(() => {
    if (profileMode !== "firebase" || !firebaseUid) {
      setBookings([]);
      return;
    }

    setBookingsErr("");

    const colRef = collection(db, "salons", SALON_ID, "bookings");
    const q = query(colRef, where("userId", "==", firebaseUid));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const arr: BookingData[] = [];
        snap.forEach((d) => {
          arr.push(mapFsBookingToUi(d.id, d.data() as FsBooking));
        });

        arr.sort((a, b) => {
          const tsA = toTs(a.date, a.time);
          const tsB = toTs(b.date, b.time);
          return tsB - tsA;
        });

        setBookings(arr);
        setBookingsErr("");
      },
      (err) => {
        console.error("Bookings snapshot error:", err);
        setBookingsErr(`خطأ في تحميل الحجوزات: ${err.message}`);
        setBookings([]);
      }
    );

    return () => unsub();
  }, [profileMode, firebaseUid]);

  // =======================
  // KPIs
  // =======================
  const kpis = useMemo(() => {
    const total = bookings.length;
    const confirmed = bookings.filter((b) => statusKey(b.status) === "confirmed").length;
    const pending = bookings.filter((b) => statusKey(b.status) === "pending").length;
    const completed = bookings.filter((b) => statusKey(b.status) === "completed").length;

    return { total, confirmed, pending, completed };
  }, [bookings]);

  // =======================
  // Upcoming booking
  // =======================
  const upcomingBooking = useMemo(() => {
    const now = Date.now();

    const future = bookings.filter((b) => {
      const st = statusKey(b.status);
      if (st === "cancelled" || st === "completed") return false;
      const ts = toTs(b.date, b.time);
      return ts > now;
    });

    if (!future.length) return null;

    future.sort((a, b) => toTs(a.date, a.time) - toTs(b.date, b.time));
    return future[0];
  }, [bookings]);

  // =======================
  // Last booking
  // =======================
  const lastBooking = useMemo(() => {
    const completed = bookings.filter((b) => statusKey(b.status) === "completed");
    if (!completed.length) return null;

    completed.sort((a, b) => {
      const tsA = toTs(a.date, a.time);
      const tsB = toTs(b.date, b.time);
      return tsB - tsA;
    });

    return completed[0];
  }, [bookings]);

  // =======================
  // Loyalty
  // =======================
  const membershipId = useMemo(() => {
    const raw = firebaseUid || userData.phone || "0000";
    return raw.slice(-6).toUpperCase();
  }, [firebaseUid, userData.phone]);

  const progress = useMemo(() => {
    const base = kpis.completed * 10;
    return Math.min(base, 100);
  }, [kpis.completed]);

  // =======================
  // Avatar
  // =======================
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = String(ev.target?.result || "");
      setUserData((prev) => ({ ...prev, avatar: dataUrl }));
      localStorage.setItem("userAvatar", dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const copyMembershipId = () => {
    navigator.clipboard.writeText(membershipId).then(() => {
      alert(`تم نسخ رقم العضوية: ${membershipId}`);
    });
  };

  // =======================
  // Edit Modal
  // =======================
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({
    name: "",
    phone: "",
    email: "",
    city: "",
    birthdate: "",
  });

  useEffect(() => {
    if (showEditModal) {
      setEditForm({
        name: userData.name,
        phone: userData.phone,
        email: userData.email,
        city: userData.city,
        birthdate: userData.birthdate,
      });
    }
  }, [showEditModal, userData]);

  const handleSaveProfile = async () => {
    const trimmedName = editForm.name.trim();
    const trimmedEmail = editForm.email.trim();
    const trimmedCity = editForm.city.trim();
    const trimmedBd = editForm.birthdate.trim();

    if (!trimmedName) {
      alert("الاسم مطلوب.");
      return;
    }

    if (trimmedBd && !isValidISODate(trimmedBd)) {
      alert("تاريخ الميلاد يجب أن يكون بصيغة YYYY-MM-DD (مثال: 1995-07-20).");
      return;
    }

    const updated = {
      name: trimmedName,
      phone: normalizeKsaPhone(editForm.phone),
      email: trimmedEmail,
      city: trimmedCity,
      birthdate: trimmedBd,
    };

    try {
      if (profileMode === "firebase" && firebaseUid && profileDoc) {
        await updateUserProfile(firebaseUid, updated);
      }

      setUserData((prev) => ({ ...prev, ...updated }));

      const cached = JSON.parse(localStorage.getItem("user_profile_v1") || "{}");
      const merged = { ...cached, ...updated };
      localStorage.setItem("user_profile_v1", JSON.stringify(merged));

      if (updated.name) localStorage.setItem("userName", updated.name);
      if (updated.email) localStorage.setItem("userEmail", updated.email);
      if (updated.phone) localStorage.setItem("userPhone", updated.phone);

      window.dispatchEvent(new Event("authChanged"));

      alert("تم حفظ البيانات بنجاح ✅");
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
    } catch { }

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
      const st = statusKey(b.status);
      if (statusFilter !== "all" && st !== statusFilter) return false;
      if (!qq) return true;

      const blob = [
        b.service,
        b.employee,
        b.date,
        b.time,
        statusLabelAr(b.status),
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
      <div className="p-root">
        <div className="p-wrapper">
          <div className="p-loader">جاري تحميل الحساب...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-root">
      <div className="p-wrapper">

        {/* Top Navigation / Header */}
        <div className="p-nav-header">
          <button className="p-icon-btn" onClick={() => navigate("/", { replace: true })}>
            <span className="p-icon-back"></span>
          </button>
          <h1 className="p-nav-title">الملف الشخصي</h1>
          <button className="p-icon-btn" onClick={() => setShowEditModal(true)}>
            <span className="p-icon-settings"></span>
          </button>
        </div>

        {/* ✅ تنبيه لو Permission Denied */}
        {bookingsErr ? (
          <div className="p-alert">
            {bookingsErr}
            <div className="p-alert-sub">
              * تأكد من صلاحيات الوصول لحجوزاتك.
            </div>
          </div>
        ) : null}

        {/* ===== User Profile Section ===== */}
        <div className="p-profile-hero">
          <div className="p-avatar-wrapper">
            <div className="p-avatar-main">
              {userData.avatar ? <img src={userData.avatar} alt="avatar" /> : <span>👩‍🦰</span>}
            </div>
            <button className="p-avatar-edit" onClick={() => fileInputRef.current?.click()}>+</button>
            <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleAvatarChange} />
          </div>
          <h2 className="p-user-name-hero">{userData.name || "عميلة"}</h2>
          <div className="p-user-info-chips">
            {userData.city && <span className="p-info-chip">📍 {userData.city}</span>}
            {userData.phone && <span className="p-info-chip">📱 {normalizeKsaPhone(userData.phone)}</span>}
          </div>
        </div>

        {/* ===== Stats Grid (Inspired by image) ===== */}
        <div className="p-stats-grid">
          <div className="p-stat-card">
            <div className="p-stat-icon p-icon-total">⚡</div>
            <div className="p-stat-content">
              <span className="p-stat-value">{kpis.total}</span>
              <span className="p-stat-label">الحجوزات</span>
            </div>
          </div>
          <div className="p-stat-card">
            <div className="p-stat-icon p-icon-confirmed">✅</div>
            <div className="p-stat-content">
              <span className="p-stat-value">{kpis.confirmed}</span>
              <span className="p-stat-label">مؤكدة</span>
            </div>
          </div>
          <div className="p-stat-card">
            <div className="p-stat-icon p-icon-pending">⏳</div>
            <div className="p-stat-content">
              <span className="p-stat-value">{kpis.pending}</span>
              <span className="p-stat-label">انتظار</span>
            </div>
          </div>
          <div className="p-stat-card">
            <div className="p-stat-icon p-icon-completed">⭐</div>
            <div className="p-stat-content">
              <span className="p-stat-value">{kpis.completed}</span>
              <span className="p-stat-label">مكتملة</span>
            </div>
          </div>
        </div>

        {/* ===== Achievement / Loyalty Section (Inspired by image) ===== */}
        <div className="p-section-container">
          <div className="p-section-header">
            <h3>مستوى العضوية</h3>
            <span className="p-badge-id-hero" onClick={copyMembershipId}>ID: {membershipId} 📋</span>
          </div>
          <div className="p-loyalty-card-new">
            <div className="p-loyalty-info-new">
              <div className="p-level-badge">Lv. {Math.floor(kpis.completed / 5) + 1}</div>
              <div className="p-progress-text">{progress}% نحو المستوى التالي</div>
            </div>
            <div className="p-progress-bar-container">
              <div className="p-progress-bar-fill" style={{ width: `${progress}%` }}></div>
            </div>
          </div>
        </div>

        {/* ===== Next Booking Card (Inspired by image) ===== */}
        <div className="p-section-container">
          <div className="p-section-header">
            <h3>الحجز القادم</h3>
            <button className="p-link-action" onClick={() => navigate("/booking")}>حجز جديد +</button>
          </div>
          {!upcomingBooking ? (
            <div className="p-empty-state">لا يوجد حجز قادم حالياً ✨</div>
          ) : (
            <div className="p-modern-booking-card">
              <div className="p-booking-main-info">
                <div className="p-booking-service-icon">✂️</div>
                <div className="p-booking-details">
                  <span className="p-booking-service-name">{upcomingBooking.service}</span>
                  <span className="p-booking-employee-name">مع {upcomingBooking.employee || "موظفة ملكات"}</span>
                </div>
                <div className={`p-status-pill status-${statusKey(upcomingBooking.status)}`}>
                  {statusLabelAr(upcomingBooking.status)}
                </div>
              </div>
              <div className="p-booking-footer-info">
                <div className="p-footer-item">📅 {formatDateAr(upcomingBooking.date)}</div>
                <div className="p-footer-item">⏰ {upcomingBooking.time}</div>
              </div>
              <div className="p-booking-actions-modern">
                <button className="p-btn-modern primary" onClick={() => navigate("/track")}>تتبع الحجز</button>
                <a className="p-btn-modern ghost" href={getWhatsAppLink(SUPPORT_PHONE, `مرحباً، استفسار عن حجز ${upcomingBooking.service}`)} target="_blank" rel="noreferrer">واتساب</a>
              </div>
            </div>
          )}
        </div>

        {/* ===== My Bookings (List view for mobile) ===== */}
        <div className="p-section-container">
          <div className="p-section-header">
            <h3>سجل الحجوزات</h3>
            <div className="p-filter-tools">
              <select className="p-modern-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="all">الكل</option>
                <option value="confirmed">مؤكد</option>
                <option value="pending">انتظار</option>
                <option value="completed">مكتمل</option>
                <option value="cancelled">ملغي</option>
              </select>
            </div>
          </div>

          <div className="p-bookings-list-modern">
            {bookingsFiltered.length === 0 ? (
              <div className="p-empty-state">لا توجد حجوزات تطابق البحث</div>
            ) : (
              bookingsFiltered.map((b) => (
                <div key={b.id} className="p-list-item-modern">
                  <div className="p-list-icon">✨</div>
                  <div className="p-list-content">
                    <div className="p-list-row-top">
                      <span className="p-list-service">{b.service}</span>
                      <span className={`p-list-status status-${statusKey(b.status)}`}>{statusLabelAr(b.status)}</span>
                    </div>
                    <div className="p-list-row-bottom">
                      <span>📅 {formatDateAr(b.date)}</span>
                      <span>⏰ {b.time}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Logout Button */}
        <div className="p-logout-container">
          <button className="p-btn-logout" onClick={handleLogout}>تسجيل الخروج</button>
        </div>

      </div>

      {/* ===== Edit Modal (Modernized) ===== */}
      {showEditModal ? (
        <div className="p-modal-overlay-modern" onClick={() => setShowEditModal(false)}>
          <div className="p-modal-content-modern" onClick={(e) => e.stopPropagation()}>
            <div className="p-modal-header-modern">
              <h3>تعديل الملف الشخصي</h3>
              <button className="p-close-modal" onClick={() => setShowEditModal(false)}>✕</button>
            </div>
            <div className="p-modal-body-modern">
              <div className="p-input-group-modern">
                <label>الاسم</label>
                <input value={editForm.name} onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="p-input-group-modern">
                <label>الجوال</label>
                <input value={editForm.phone} onChange={(e) => setEditForm((p) => ({ ...p, phone: e.target.value }))} />
              </div>
              <div className="p-input-group-modern">
                <label>المدينة</label>
                <input value={editForm.city} onChange={(e) => setEditForm((p) => ({ ...p, city: e.target.value }))} />
              </div>
              <div className="p-input-group-modern">
                <label>تاريخ الميلاد</label>
                <input type="date" value={editForm.birthdate} onChange={(e) => setEditForm((p) => ({ ...p, birthdate: e.target.value }))} />
              </div>
            </div>
            <div className="p-modal-footer-modern">
              <button className="p-btn-save-modern" onClick={handleSaveProfile}>حفظ التغييرات</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default Profile;
