// src/pages/Profile.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../styles/Profile.css";

import { onAuthStateChanged, signOut, type User as FirebaseUser } from "firebase/auth";
import { auth, db } from "../services/firebase";
import LoadingBrand from "../components/LoadingBrand";

import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";

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
    phone: normalizeKsaPhone(cachedProfile?.phone || currentUser?.phone || localStorage.getItem("userPhone") || ""),
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

    const qy = query(colRef, where("userId", "==", firebaseUid), orderBy("createdAt", "desc"));

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const rows: BookingData[] = [];
        snap.forEach((d) => rows.push(mapFsBookingToUi(d.id, d.data() as any)));
        rows.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        setBookings(rows);
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
        const k = statusKey(b.status);
        if (k === "cancelled" || k === "completed") return false;
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

  const kpis = useMemo(() => {
    const total = bookings.length;
    const countBy = (key: "confirmed" | "pending" | "completed" | "cancelled") =>
      bookings.filter((b) => statusKey(b.status) === key).length;

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
    typeof (profileDoc as any)?.membershipPercent === "number" ? (profileDoc as any).membershipPercent : 0;

  const membershipId =
    (profileDoc as any)?.membershipId ||
    (profileMode === "firebase" && firebaseUid ? `client-${new Date().getFullYear()}-${firebaseUid.slice(0, 6)}` : "client-0000");

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
  // Avatar (محلي حالياً)
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
      const normalizedPhone = normalizeKsaPhone(editData.phone);

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
      clients = clients.map((u: any) => (u.phone === userData.phone ? { ...u, ...editData, phone: normalizedPhone } : u));
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
        {/* ✅ تنبيه لو Permission Denied */}
        {bookingsErr ? (
          <div className="p-alert">
            {bookingsErr}
            <div className="p-alert-sub">
              * إذا طلع Permission Denied: تأكد أن الحجز يحتوي userId = UID حق العميلة، والـ rules تسمح read للعميلة على حجوزاتها.
            </div>
          </div>
        ) : null}

        {/* ===== Header Card ===== */}
        <div className="p-card">
          <div className="p-main-info">
            <div className="p-user-section">
              <div className="p-avatar-box">
                <div className="p-avatar-circle">
                  {userData.avatar ? <img src={userData.avatar} alt="avatar" /> : <span>👩‍🦰</span>}
                </div>

                <button className="p-avatar-plus" type="button" title="تغيير الصورة" onClick={() => fileInputRef.current?.click()}>
                  +
                </button>

                <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleAvatarChange} />
              </div>

              <div>
                <h2 className="p-user-name">{userData.name || "عميلة"}</h2>

                <div className="p-user-sub">
                  {userData.phone ? <span>📱 {normalizeKsaPhone(userData.phone)}</span> : null}
                  {userData.email ? <span>✉️ {userData.email}</span> : null}
                  {userData.city ? <span>📍 {userData.city}</span> : null}
                </div>

                <div className="p-user-badges">
                  <span className="p-badge-id" title="رقم العضوية" role="button" tabIndex={0} onClick={copyMembershipId}>
                    {membershipId} <span style={{ marginInlineStart: 6 }}>📋</span>
                  </span>

                  <span className="p-badge-level">نسبة العضوية: {progress}%</span>
                </div>
              </div>
            </div>

            <div className="p-action-group">
              <button className="p-btn p-btn-ghost" type="button" onClick={() => setShowEditModal(true)}>
                ✏️ تعديل
              </button>

              <a className="p-btn p-btn-wa" href={getWhatsAppLink(SUPPORT_PHONE, SUPPORT_MSG)} target="_blank" rel="noreferrer">
                💬 واتساب
              </a>

              <button className="p-btn p-btn-out" type="button" onClick={handleLogout}>
                🚪 خروج
              </button>
            </div>
          </div>
        </div>

        {/* ===== Stats Row ===== */}
        <div className="p-stats-row">
          <div className="p-stat-item">
            <div className="p-stat-val">{kpis.total}</div>
            <div className="p-stat-lbl">إجمالي الحجوزات</div>
          </div>

          <div className="p-stat-item">
            <div className="p-stat-val p-c-green">{kpis.confirmed}</div>
            <div className="p-stat-lbl">مؤكدة</div>
          </div>

          <div className="p-stat-item">
            <div className="p-stat-val p-c-gold">{kpis.pending}</div>
            <div className="p-stat-lbl">انتظار</div>
          </div>

          <div className="p-stat-item">
            <div className="p-stat-val">{kpis.completed}</div>
            <div className="p-stat-lbl">مكتملة</div>
          </div>
        </div>

        {/* ===== Content Grid ===== */}
        <div className="p-content-grid">
          {/* Main column */}
          <div className="p-col-main">
            {/* Next booking */}
            <div className="p-card">
              <div className="p-card-header">
                <h3>الحجز القادم</h3>
                <button className="p-link" type="button" onClick={() => navigate("/booking")}>
                  حجز جديد ↩︎
                </button>
              </div>

              {!upcomingBooking ? (
                <div className="p-empty">ما عندك حجز قادم حالياً. ✨ احجزي موعدك الآن.</div>
              ) : (
                <div className="p-booking-card">
                  <div className="p-booking-top">
                    <div className="p-booking-title">{upcomingBooking.service}</div>
                    <span className={`p-status-tag p-${statusKey(upcomingBooking.status)}`}>
                      {statusLabelAr(upcomingBooking.status)}
                    </span>
                  </div>

                  <div className="p-booking-meta">
                    <span>👩‍💼 {upcomingBooking.employee || "-"}</span>
                    <span>📅 {formatDateAr(upcomingBooking.date)}</span>
                    <span>⏰ {upcomingBooking.time}</span>
                    {upcomingBooking.publicId ? <span>🧾 {upcomingBooking.publicId}</span> : null}
                  </div>

                  <div className="p-booking-actions">
                    <button className="p-btn p-btn-primary" type="button" onClick={() => navigate("/track")}>
                      تتبع الحجز
                    </button>

                    <a
                      className="p-btn p-btn-ghost"
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

            {/* Bookings table */}
            <div className="p-card">
              <div className="p-card-header">
                <h3>حجوزاتي</h3>

                <div className="p-tools">
                  <div className="p-table-filter">
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحثي (خدمة، موظفة، تاريخ...)" />
                  </div>

                  <select className="p-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                    <option value="all">كل الحالات</option>
                    <option value="confirmed">مؤكد</option>
                    <option value="pending">انتظار</option>
                    <option value="completed">مكتمل</option>
                    <option value="cancelled">ملغي</option>
                  </select>
                </div>
              </div>

              {bookingsFiltered.length === 0 ? (
                <div className="p-empty">لا يوجد نتائج مطابقة.</div>
              ) : (
                <div className="p-table-wrap">
                  <table className="p-table">
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
                          <td className="p-strong">{b.service}</td>
                          <td>{b.employee || "-"}</td>
                          <td>{formatDateAr(b.date)}</td>
                          <td>{b.time}</td>
                          <td>
                            <span className={`p-status-tag p-${statusKey(b.status)}`}>{statusLabelAr(b.status)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Side column */}
          <div className="p-col-side">
            {/* Loyalty */}
            <div className="p-card">
              <div className="p-card-header">
                <h3>العضوية</h3>
                <span className="p-hint">ولاء العميلة</span>
              </div>

              <div className="p-loyalty-box">
                <div className="p-loyalty-circle">
                  <div className="p-loyalty-percent">{progress}%</div>
                </div>
                <div className="p-muted">
                  رقم العضوية: <b>{membershipId}</b>
                </div>
              </div>
            </div>

            {/* Last booking */}
            <div className="p-card">
              <div className="p-card-header">
                <h3>آخر حجز</h3>
                <span className="p-hint">آخر نشاط لك عندنا 💗</span>
              </div>

              {!lastBooking ? (
                <div className="p-empty">ما عندك حجوزات سابقة مرتبطة بهذا الحساب.</div>
              ) : (
                <div className="p-booking-card p-booking-last">
                  <div className="p-booking-top">
                    <div className="p-booking-title">{lastBooking.service}</div>
                    <span className={`p-status-tag p-${statusKey(lastBooking.status)}`}>{statusLabelAr(lastBooking.status)}</span>
                  </div>

                  <div className="p-booking-meta">
                    <span>👩‍💼 {lastBooking.employee || "-"}</span>
                    <span>📅 {formatDateAr(lastBooking.date)}</span>
                    <span>⏰ {lastBooking.time}</span>
                    {lastBooking.publicId ? <span>🧾 {lastBooking.publicId}</span> : null}
                  </div>

                  <div className="p-booking-actions">
                    <button className="p-btn p-btn-ghost" type="button" onClick={() => navigate("/booking")}>
                      إعادة حجز مشابه
                    </button>
                    <button className="p-btn p-btn-primary" type="button" onClick={() => alert("قريباً: تقييم الخدمة ✨")}>
                      تقييم الخدمة
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ===== Edit Modal ===== */}
        {showEditModal && (
          <div className="p-modal-overlay" onClick={() => setShowEditModal(false)}>
            <div className="p-modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="p-modal-head">
                <h3 style={{ margin: 0 }}>تعديل بيانات العميلة</h3>
                <button className="p-x" type="button" onClick={() => setShowEditModal(false)} aria-label="close">
                  ✕
                </button>
              </div>

              <div className="p-form-group">
                <label>الاسم</label>
                <input value={editData.name} onChange={(e) => setEditData({ ...editData, name: e.target.value })} />
              </div>

              <div className="p-form-group">
                <label>الجوال</label>
                <input
                  value={editData.phone}
                  onChange={(e) => setEditData({ ...editData, phone: e.target.value })}
                  onBlur={() => setEditData((prev) => ({ ...prev, phone: normalizeKsaPhone(prev.phone) }))}
                  placeholder="05xxxxxxxx"
                />
                <div className="p-muted" style={{ marginTop: 6 }}>
                  سيتم حفظ الجوال بصيغة سعودية (مثال: 05xxxxxxxx) ✅
                </div>
              </div>

              <div className="p-form-group">
                <label>البريد</label>
                <input value={editData.email} onChange={(e) => setEditData({ ...editData, email: e.target.value })} />
              </div>

              <div className="p-form-group">
                <label>المدينة</label>
                <input value={editData.city} onChange={(e) => setEditData({ ...editData, city: e.target.value })} />
              </div>

              <div className="p-form-group">
                <label>تاريخ الميلاد</label>
                <input
                  type="date"
                  value={editData.birthdate}
                  onChange={(e) => setEditData({ ...editData, birthdate: e.target.value })}
                />
              </div>

              <div className="p-modal-actions">
                <button className="p-btn p-btn-primary" type="button" onClick={handleSaveEdit}>
                  حفظ
                </button>
                <button className="p-btn p-btn-ghost" type="button" onClick={() => setShowEditModal(false)}>
                  إلغاء
                </button>
              </div>

              <div className="p-note">ملاحظة: قريباً نضيف (نقاط، مكافآت، سجل خدمات مفصل، وفواتير) 😌✨</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Profile;
