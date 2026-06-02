// src/pages/Profile.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  LuArrowLeft,
  LuAward,
  LuCalendarCheck,
  LuCalendarDays,
  LuCalendarRange,
  LuClock3,
  LuHourglass,
  LuHouse,
  LuIdCard,
  LuInstagram,
  LuImage,
  LuMapPin,
  LuPencil,
  LuPhone,
  LuReceipt,
  LuScissors,
  LuSettings,
  LuStar,
  LuUser,
} from "react-icons/lu";
import "../styles/Profile.css";

import { onAuthStateChanged, signOut, type User as FirebaseUser } from "firebase/auth";
import { auth, db } from "../services/firebase";


import { collection, onSnapshot, query, where } from "firebase/firestore";

import { createOrLoadUserProfile, updateUserProfile, type UserProfile } from "../services/userProfile";
import { formatTime12 } from "../helpers/timeDisplay";

// =======================
// دعم واتساب
// =======================
const SUPPORT_PHONE = "966573235247"; // ✅ بدون +
const SUPPORT_MSG = "مرحباً، أحتاج مساعدة في حسابي في صالون ملكات.";

function isMalikatAdminEmail(email: unknown) {
  return String(email || "")
    .toLowerCase()
    .trim()
    .endsWith("@malikat.com");
}

function getWhatsAppLink(phoneDigits: string, msg: string) {
  return `https://wa.me/${phoneDigits}?text=${encodeURIComponent(msg)}`;
}

const INSTAGRAM_URL =
  "https://www.instagram.com/malikat_sallon?utm_source=ig_web_button_share_sheet&igsh=ZDNlZDc0MzIxNw==";


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
const PUBLIC_DEV_BASE = "https://pub-6ee7ebda32364985aa26e0386b7fbe28.r2.dev";
const PUBLIC_DEV_BASE_CLEAN = PUBLIC_DEV_BASE.replace(/\/+$/, "");

function resolveStableAvatarUrl(raw: unknown): string {
  const input = String(raw || "").trim();
  if (!input) return "";
  if (input.startsWith(`${PUBLIC_DEV_BASE_CLEAN}/`)) return input;

  const lower = input.toLowerCase();
  const isPresigned =
    lower.includes("cloudflarestorage.com") || lower.includes("x-amz-");

  if (!isPresigned) return input;

  try {
    const u = new URL(input);
    const parts = u.pathname.replace(/^\/+/, "").split("/").filter(Boolean);
    if (!parts.length) return "";

    const miscIdx = parts.findIndex((p) => p === "misc");
    const key = miscIdx >= 0 ? parts.slice(miscIdx).join("/") : parts.join("/");
    return key ? `${PUBLIC_DEV_BASE_CLEAN}/${key}` : "";
  } catch {
    return "";
  }
}

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
  const leavingForBookingRef = useRef(false);

  const [profileMode, setProfileMode] = useState<ProfileMode>("local");
  const [firebaseUid, setFirebaseUid] = useState<string | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [profileDoc, setProfileDoc] = useState<UserProfile | null>(null);

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

  const [authChecked, setAuthChecked] = useState(
    () => !!auth.currentUser || !!cachedProfile || !!currentUser
  );
  const [showQrCamera, setShowQrCamera] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);

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
    const cachedAvatar = String(localStorage.getItem("userAvatar") || "").trim();
    if (!cachedAvatar) return;
    const stableAvatar = resolveStableAvatarUrl(cachedAvatar);
    if (!stableAvatar) {
      localStorage.removeItem("userAvatar");
      return;
    }
    setUserData((prev) => ({ ...prev, avatar: stableAvatar }));
    localStorage.setItem("userAvatar", stableAvatar);
  }, []);

  useEffect(() => {
    let alive = true;

    const applyProfileData = (raw: Partial<UserProfile> | null | undefined) => {
      if (!raw || !alive) return;

      const stableAvatar = resolveStableAvatarUrl((raw as any)?.avatarUrl);
      const fallbackAvatar = resolveStableAvatarUrl(localStorage.getItem("userAvatar"));

      setUserData((prev) => ({
        ...prev,
        name: String(raw.name || prev.name || ""),
        phone: normalizeKsaPhone(String(raw.phone || prev.phone || "")),
        email: String(raw.email || prev.email || ""),
        city: String(raw.city || prev.city || ""),
        birthdate: String(raw.birthdate || prev.birthdate || ""),
        avatar: stableAvatar || fallbackAvatar || prev.avatar || "",
      }));

      if (stableAvatar) localStorage.setItem("userAvatar", stableAvatar);
    };

    const unsub = onAuthStateChanged(auth, (user) => {
      if (!alive) return;

      setFirebaseUser(user || null);

      if (!user) {
        setProfileMode("local");
        setFirebaseUid(null);
        setProfileDoc(null);

        try {
          const cached = JSON.parse(localStorage.getItem("user_profile_v1") || "null");
          applyProfileData(cached);
        } catch (e) {
          console.error("Error restoring cached profile:", e);
        }

        setAuthChecked(true);
        return;
      }

      setProfileMode("firebase");
      setFirebaseUid(user.uid);
      setAuthChecked(true);

      // Hard block: admin-domain accounts should never open client profile UI.
      if (isMalikatAdminEmail(user.email)) {
        if (leavingForBookingRef.current) return;
        clearClientCacheOnly();
        navigate("/dashboard-pending", { replace: true });
        return;
      }

      if (cachedProfile && String((cachedProfile as any)?.uid || "").trim() === user.uid) {
        setProfileDoc(cachedProfile as UserProfile);
        applyProfileData(cachedProfile as UserProfile);
      }

      void createOrLoadUserProfile(user)
        .then((p) => {
          if (!alive) return;

          const pr = String((p as any)?.role || "").toLowerCase().trim();
          if (pr && pr !== "client") {
            if (leavingForBookingRef.current) return;
            clearClientCacheOnly();
            navigate("/dashboard-pending", { replace: true });
            return;
          }

          setProfileDoc(p);
          applyProfileData(p);

          localStorage.setItem("user_profile_v1", JSON.stringify(p));
          if (p?.name) localStorage.setItem("userName", String(p.name));
          if (p?.email) localStorage.setItem("userEmail", String(p.email));
          if (p?.phone) localStorage.setItem("userPhone", normalizeKsaPhone(String(p.phone)));

          window.dispatchEvent(new Event("authChanged"));
        })
        .catch((e) => {
          if (!alive) return;
          if (leavingForBookingRef.current) return;
          console.error("Profile load error:", e);
          clearClientCacheOnly();
          navigate("/dashboard-pending", { replace: true });
        });
    });

    return () => {
      alive = false;
      unsub();
    };
  }, [cachedProfile, currentUser, navigate]);

  useEffect(() => {
    if (!authChecked) return;

    const token = localStorage.getItem("authToken");
    const firebaseOk = !!firebaseUser;

    if (!token && !firebaseOk) {
      if (leavingForBookingRef.current) return;
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

  const loyalty = useMemo(() => {
    const completedBookings = bookings.filter((b) => statusKey(b.status) === "completed");
    const completedCount = completedBookings.length;
    const pointsFromBookings = completedCount * 50;
    const points = pointsFromBookings;

    const pointsPerLevel = 300;
    const level = Math.max(1, Math.floor(points / pointsPerLevel) + 1);
    const levelStart = (level - 1) * pointsPerLevel;
    const nextLevelPoints = level * pointsPerLevel;
    const pointsIntoLevel = points - levelStart;
    const progress = Math.max(0, Math.min(100, Math.round((pointsIntoLevel / pointsPerLevel) * 100)));
    const pointsToNext = Math.max(0, nextLevelPoints - points);
    const loyaltyTitle = level >= 5 ? "VIP" : level >= 3 ? "ذهبي" : level >= 2 ? "فضي" : "برونزي";

    return {
      points,
      level,
      loyaltyTitle,
      progress,
      pointsToNext,
      completedCount,
    };
  }, [bookings]);

  // =======================
  // Avatar
  // =======================
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const effectiveUid =
        String(firebaseUid || firebaseUser?.uid || profileDoc?.uid || cachedProfile?.uid || "").trim();

      if (!effectiveUid) {
        throw new Error("تعذر تحديد الحساب الحالي. افتحي الصفحة مرة ثانية ثم حاولي مجددًا.");
      }

      // 1) تجهيز اسم الملف
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const safeExt = ext.replace(/[^a-z0-9]/g, "") || "jpg";

      const ownerId =
        (effectiveUid.replace(/\D/g, "") || userData.phone || "unknown")
          .replace(/\D/g, "") || "unknown";

      const fileName = `avatar-${Date.now()}.${safeExt}`;

      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, "0");
      const ym = `${yyyy}-${mm}`;

      const key = `misc/${ym}/${ownerId}/${fileName}`;

      // ✅ مهم: مسار نسبي (proxy)
      const presignRes = await fetch("/api/r2-presign", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          key,
          contentType: file.type || "image/jpeg",
        }),
      });

      if (!presignRes.ok) {
        const t = await presignRes.text();
        throw new Error(`presign failed: ${presignRes.status} ${t}`);
      }

      const { putUrl } = await presignRes.json();
      if (!putUrl) throw new Error("presign missing putUrl");

      // 3) رفع الملف مباشرة إلى R2
      const putRes = await fetch(putUrl, {
        method: "PUT",
        headers: {
          "Content-Type": file.type || "image/jpeg",
        },
        body: file,
      });

      if (!putRes.ok) {
        const t = await putRes.text();
        throw new Error(`upload failed: ${putRes.status} ${t}`);
      }

      // 4) رابط العرض
      const publicUrl = `${PUBLIC_DEV_BASE.replace(/\/+$/, "")}/${key}`;

      // 5) تحديث UI
      setUserData((prev) => ({
        ...prev,
        avatar: publicUrl,
      }));

      localStorage.setItem("userAvatar", publicUrl);
      setProfileDoc((prev) => (prev ? { ...prev, avatarUrl: publicUrl } : prev));

      try {
        const cached = JSON.parse(localStorage.getItem("user_profile_v1") || "null") || {};
        localStorage.setItem(
          "user_profile_v1",
          JSON.stringify({
            ...cached,
            uid: effectiveUid,
            avatarUrl: publicUrl,
          })
        );
      } catch {
        // ignore
      }

      // 6) حفظ في Firestore بشكل مؤكد
      await updateUserProfile(effectiveUid, {
        avatarUrl: publicUrl,
      } as any);

      alert("تم رفع الصورة وحفظها ✅");
    } catch (err: any) {
      console.error(err);
      alert(`فشل رفع الصورة: ${err?.message || err}`);
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };



  const copyMembershipId = () => {
    navigator.clipboard.writeText(membershipId).then(() => {
      alert(`تم نسخ رقم العضوية: ${membershipId}`);
    });
  };

  const handleBottomQr = () => {
    setActiveTab("qr");
  };

  const handleBottomBookings = () => {
    setActiveTab("bookings");
  };

  const handleBottomProfile = () => {
    setActiveTab("profile");
  };

  const closeQrCamera = () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
    }
    setShowQrCamera(false);
  };

  const openQrCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      cameraStreamRef.current = stream;
      setShowQrCamera(true);

      window.setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 0);
    } catch (err) {
      console.error("Camera open failed:", err);
      alert("تعذر فتح الكاميرا. تأكد من السماح بالوصول للكاميرا.");
    }
  };

  const handleRepeatLastBooking = () => {
    if (!lastBooking) {
      alert("ما فيه حجز مكتمل سابق للتكرار حالياً.");
      return;
    }
    leavingForBookingRef.current = true;
    navigate("/booking", {
      state: {
        repeatFromBookingId: lastBooking.id,
        prefillServiceName: lastBooking.service,
      },
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
  const [activeTab, setActiveTab] = useState<"profile" | "qr" | "bookings">("profile");
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
  if (!authChecked && !cachedProfile && !currentUser && !auth.currentUser) {
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
            <LuArrowLeft />
          </button>
          <h1 className="p-nav-title">الملف الشخصي</h1>
          <button className="p-icon-btn" onClick={() => setShowEditModal(true)}>
            <LuSettings />
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
              {userData.avatar ? <img src={userData.avatar} alt="avatar" /> : <span><LuImage /></span>}
            </div>
            {!userData.avatar ? (
              <button className="p-avatar-edit" onClick={() => fileInputRef.current?.click()}>+</button>
            ) : null}
            <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleAvatarChange} />
          </div>
          <h2 className="p-user-name-hero">{userData.name || "عميلة"}</h2>
        </div>

        {activeTab === "profile" ? (
        <>
          <div className="p-stats-grid">
            <div className="p-stat-card">
              <div className="p-stat-icon p-icon-total"><LuCalendarDays /></div>
              <div className="p-stat-content">
                <span className="p-stat-value">{kpis.total}</span>
                <span className="p-stat-label">الحجوزات</span>
              </div>
            </div>
            <div className="p-stat-card">
              <div className="p-stat-icon p-icon-confirmed"><LuCalendarCheck /></div>
              <div className="p-stat-content">
                <span className="p-stat-value">{kpis.confirmed}</span>
                <span className="p-stat-label">مؤكدة</span>
              </div>
            </div>
            <div className="p-stat-card">
              <div className="p-stat-icon p-icon-pending"><LuHourglass /></div>
              <div className="p-stat-content">
                <span className="p-stat-value">{kpis.pending}</span>
                <span className="p-stat-label">انتظار</span>
              </div>
            </div>
            <div className="p-stat-card">
              <div className="p-stat-icon p-icon-completed"><LuAward /></div>
              <div className="p-stat-content">
                <span className="p-stat-value">{kpis.completed}</span>
                <span className="p-stat-label">مكتملة</span>
              </div>
            </div>
          </div>
          <section className="p-quick-booking">
            <div className="p-quick-booking-head">
              <h3>ابدئي حجزك بسرعة</h3>
              <p>اختاري حجز جديد أو كرري آخر موعد لك.</p>
            </div>
            <div className="p-quick-booking-actions">
              <button
                className="p-link-action p-link-action-wide"
                onClick={() => {
                  leavingForBookingRef.current = true;
                  navigate("/booking");
                }}
                type="button"
                aria-label="حجز جديد"
              >
                <span className="p-link-action-plus">+</span>
                <span>حجز جديد</span>
              </button>
              <button
                className="p-link-action p-link-action-soft"
                onClick={handleRepeatLastBooking}
                type="button"
                aria-label="تكرار آخر حجز"
              >
                <span>تكرار آخر حجز</span>
              </button>
              <button
                className="p-link-action p-link-action-ghost"
                onClick={openQrCamera}
                type="button"
                aria-label="QR"
              >
                <span>QR</span>
              </button>
            </div>
          </section>
        </>
        ) : null}

        {/* ===== Achievement / Loyalty Section (Inspired by image) ===== */}
        {activeTab === "qr" ? (
        <div className="p-section-container">
          <div className="p-section-header">
            <h3>النقاط والولاء</h3>
            <span className="p-badge-id-hero" onClick={copyMembershipId}><LuIdCard className="p-inline-icon" /> ID: {membershipId}</span>
          </div>

          <div className="p-points-card">
            <div className="p-points-head">
              <h4>رصيد النقاط</h4>
              <span className="p-points-badge">Points</span>
            </div>
            <div className="p-points-value-row">
              <strong>{loyalty.points}</strong>
              <span>نقطة متاحة</span>
            </div>
            <div className="p-points-meta">
              <span>حجوزات مكتملة محتسبة: {loyalty.completedCount}</span>
              <span>متبقي {loyalty.pointsToNext} نقطة للمستوى التالي</span>
            </div>
          </div>

          <div className="p-loyalty-card">
            <div className="p-loyalty-head">
              <h4>حالة الولاء</h4>
              <div className="p-level-badge">Lv. {loyalty.level}</div>
            </div>
            <div className="p-loyalty-tier-line">
              <span>التصنيف الحالي: {loyalty.loyaltyTitle}</span>
              <span>{loyalty.progress}%</span>
            </div>
            <div className="p-progress-bar-container">
              <div className="p-progress-bar-fill" style={{ width: `${loyalty.progress}%` }}></div>
            </div>
            <p className="p-loyalty-note">كلما زادت نقاطك ينتقل حسابك لمستوى أعلى تلقائيًا.</p>
          </div>
        </div>
        ) : null}

        {/* ===== Next Booking Card (Inspired by image) ===== */}
        {activeTab === "bookings" ? (
        <div className="p-section-container">
          <div className="p-section-header">
            <h3>الحجز القادم</h3>
          </div>
          {!upcomingBooking ? (
            <div className="p-empty-state">لا يوجد حجز قادم حالياً <LuStar className="p-inline-icon" /></div>
          ) : (
            <div className="p-modern-booking-card">
              <div className="p-booking-main-info">
                <div className="p-booking-service-icon"><LuScissors /></div>
                <div className="p-booking-details">
                  <span className="p-booking-service-name">{upcomingBooking.service}</span>
                  <span className="p-booking-employee-name">مع {upcomingBooking.employee || "موظفة ملكات"}</span>
                </div>
                <div className={`p-status-pill status-${statusKey(upcomingBooking.status)}`}>
                  {statusLabelAr(upcomingBooking.status)}
                </div>
              </div>
              <div className="p-booking-footer-info">
                <div className="p-footer-item"><LuCalendarDays className="p-inline-icon" /> {formatDateAr(upcomingBooking.date)}</div>
                <div className="p-footer-item"><LuClock3 className="p-inline-icon" /> {formatTime12(upcomingBooking.time, "-")}</div>
              </div>
              <div className="p-booking-actions-modern">
                <button className="p-btn-modern primary" onClick={() => navigate("/track")}>تتبع الحجز</button>
                <a className="p-btn-modern ghost" href={getWhatsAppLink(SUPPORT_PHONE, `مرحباً، استفسار عن حجز ${upcomingBooking.service}`)} target="_blank" rel="noreferrer">واتساب</a>
              </div>
            </div>
          )}
        </div>
        ) : null}

        {/* ===== My Bookings (List view for mobile) ===== */}
        {activeTab === "bookings" ? (
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
                  <div className="p-list-icon"><LuReceipt /></div>
                  <div className="p-list-content">
                    <div className="p-list-row-top">
                      <span className="p-list-service">{b.service}</span>
                      <span className={`p-list-status status-${statusKey(b.status)}`}>{statusLabelAr(b.status)}</span>
                    </div>
                    <div className="p-list-row-bottom">
                      <span><LuCalendarDays className="p-inline-icon" /> {formatDateAr(b.date)}</span>
                      <span><LuClock3 className="p-inline-icon" /> {formatTime12(b.time, "-")}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        ) : null}

        {activeTab === "bookings" ? (
        <div className="p-section-container">
          <div className="p-section-header">
            <h3>العروض الخاصة</h3>
          </div>
          <div className="p-empty-state">قريبًا: عروض مخصصة للعميلات المميزات <LuStar className="p-inline-icon" /></div>
        </div>
        ) : null}

      </div>

      <nav className="p-bottom-nav" aria-label="Profile quick navigation">
        <button className={`p-bottom-item ${activeTab === "qr" ? "is-active" : ""}`} type="button" onClick={handleBottomQr} aria-label="Loyalty">
          <LuAward />
        </button>
        <button className={`p-bottom-item ${activeTab === "bookings" ? "is-active" : ""}`} type="button" onClick={handleBottomBookings} aria-label="Bookings">
          <LuCalendarCheck />
        </button>
        <button
          className={`p-bottom-center ${activeTab === "profile" ? "is-active" : ""}`}
          type="button"
          onClick={handleBottomProfile}
          aria-label="Profile Home"
        >
          <LuHouse />
        </button>
        <a className="p-bottom-item is-instagram" href={INSTAGRAM_URL} target="_blank" rel="noopener noreferrer" aria-label="Instagram">
          <LuInstagram />
        </a>
        <button className="p-bottom-item" type="button" onClick={() => setShowEditModal(true)} aria-label="Settings">
          <LuSettings />
        </button>
      </nav>

      {/* ===== Edit Modal (Modernized) ===== */}
      {showEditModal ? (
        <div className="p-modal-overlay-modern" onClick={() => setShowEditModal(false)}>
          <div className="p-modal-content-modern" onClick={(e) => e.stopPropagation()}>
            <div className="p-modal-header-modern">
              <h3>تعديل الملف الشخصي</h3>
              <button className="p-close-modal" onClick={() => setShowEditModal(false)}>✕</button>
            </div>
            <div className="p-modal-body-modern">
              <button
                className="p-avatar-settings-action"
                type="button"
                onClick={() => fileInputRef.current?.click()}
              >
                <span className="p-avatar-settings-preview">
                  {userData.avatar ? (
                    <img src={userData.avatar} alt="صورة الملف الشخصي" />
                  ) : (
                    <LuImage />
                  )}
                </span>
                <span className="p-avatar-settings-copy">
                  <strong>تعديل الصورة</strong>
                  <small>{userData.avatar ? "اختاري صورة جديدة" : "أضيفي صورة للملف الشخصي"}</small>
                </span>
                <span className="p-avatar-settings-icon">
                  <LuPencil />
                </span>
              </button>
              <div className="p-input-group-modern">
                <label className="p-label-with-icon"><LuUser /> الاسم</label>
                <input value={editForm.name} onChange={(e) => setEditForm((p) => ({ ...p, name: e.target.value }))} />
              </div>
              <div className="p-input-group-modern">
                <label className="p-label-with-icon"><LuPhone /> الجوال</label>
                <input value={editForm.phone} onChange={(e) => setEditForm((p) => ({ ...p, phone: e.target.value }))} />
              </div>
              <div className="p-input-group-modern">
                <label className="p-label-with-icon"><LuMapPin /> المدينة</label>
                <input value={editForm.city} onChange={(e) => setEditForm((p) => ({ ...p, city: e.target.value }))} />
              </div>
              <div className="p-input-group-modern">
                <label className="p-label-with-icon"><LuCalendarRange /> تاريخ الميلاد</label>
                <input type="date" value={editForm.birthdate} onChange={(e) => setEditForm((p) => ({ ...p, birthdate: e.target.value }))} />
              </div>
            </div>
            <div className="p-modal-footer-modern">
              <button className="p-btn-save-modern" onClick={handleSaveProfile}>حفظ التغييرات</button>
              <button className="p-btn-logout-modal" onClick={handleLogout}>تسجيل الخروج</button>
            </div>
          </div>
        </div>
      ) : null}

      {showQrCamera ? (
        <div className="p-camera-overlay" onClick={closeQrCamera}>
          <div className="p-camera-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="p-camera-head">
              <h3>QR</h3>
              <button className="p-close-modal" onClick={closeQrCamera}>✕</button>
            </div>
            <video ref={videoRef} className="p-camera-video" autoPlay playsInline muted />
          </div>
        </div>
      ) : null}

    </div>
  );
};

export default Profile;
