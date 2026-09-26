// src/pages/Profile.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
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
  LuImage,
  LuLogOut,
  LuMapPin,
  LuMessageCircle,
  LuPackage,
  LuBadgePercent,
  LuPencil,
  LuPhone,
  LuReceipt,
  LuScissors,
  LuUser,
} from "react-icons/lu";

import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import { auth } from "../services/firebase";
import { logoutFirebase } from "../services/authService";

import { formatTime12 } from "../helpers/timeDisplay";
import MyPackagesPanel from "../components/packages/MyPackagesPanel";
import ClientConnectPanel from "../components/client/ClientConnectPanel";
import {
  ClientPortalService,
  type ClientPortalCashback,
  type ClientPortalOffer,
  type ClientPortalLoyalty,
  type ClientPortalPreferences,
} from "../services/ClientPortalService";

// =======================
// دعم واتساب
// =======================
const SUPPORT_PHONE = "966573235247"; // ✅ بدون +
const SUPPORT_MSG = "مرحباً، أحتاج مساعدة في حسابي في صالون ملكات.";

function getWhatsAppLink(phoneDigits: string, msg: string) {
  return `https://wa.me/${phoneDigits}?text=${encodeURIComponent(msg)}`;
}


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
  paid?: number;
  refunded?: number;
  paymentStatus?: string;
  paymentMethod?: string;
  packageSessionsUsed?: number;
  packageName?: string;
  createdAt?: number;
  publicId?: string;
  invoiceNumber?: string;
  serviceDetails?: string[];
}

type ProfileMode = "firebase" | "local";
type ProfileTab = "profile" | "loyalty" | "bookings" | "packages" | "offers" | "connect";
type ProfileViewData = {
  name: string;
  phone: string;
  email: string;
  city: string;
  birthdate: string;
  avatar: string;
};

type EditProfileForm = {
  name: string;
  phone: string;
  email: string;
  city: string;
  birthdate: string;
};

const PROFILE_ACTIVE_TAB_STORAGE_KEY = "profile_active_tab_v1";

function isProfileTab(value: string | null): value is ProfileTab {
  return value === "profile" || value === "loyalty" || value === "bookings" || value === "packages" || value === "offers" || value === "connect";
}

function writeStoredProfileTab(tab: ProfileTab) {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(PROFILE_ACTIVE_TAB_STORAGE_KEY, tab);
  } catch {
    // Session storage can be unavailable in restricted browser modes.
  }
}

function profileTabFromPath(pathname: string): ProfileTab {
  const path = String(pathname || "").replace(/\/+$/, "");
  if (path.endsWith("/bookings")) return "bookings";
  if (path.endsWith("/packages")) return "packages";
  if (path.endsWith("/offers")) return "offers";
  if (path.endsWith("/connect")) return "connect";
  if (path.endsWith("/profile")) return "loyalty";
  return "profile";
}

function profilePathForTab(tab: ProfileTab): string {
  if (tab === "bookings") return "/client/bookings";
  if (tab === "packages") return "/client/packages";
  if (tab === "offers") return "/client/offers";
  if (tab === "connect") return "/client/connect";
  if (tab === "loyalty") return "/client/profile";
  return "/client";
}

function clearStoredProfileTab() {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.removeItem(PROFILE_ACTIVE_TAB_STORAGE_KEY);
  } catch {
    // noop
  }
}

function sameProfileViewData(a: ProfileViewData, b: ProfileViewData) {
  return (
    a.name === b.name &&
    a.phone === b.phone &&
    a.email === b.email &&
    a.city === b.city &&
    a.birthdate === b.birthdate &&
    a.avatar === b.avatar
  );
}

function statusKey(status?: string) {
  const s = String(status || "").trim().toLowerCase();
  if (s === "مؤكد" || s === "confirmed") return "confirmed";
  if (s === "انتظار" || s === "pending") return "pending";
  if (s === "مكتمل" || s === "completed") return "completed";
  if (s === "ملغي" || s === "cancelled" || s === "canceled") return "cancelled";
  if (s === "مسترجع" || s === "refunded") return "refunded";
  if (s === "استرجاع جزئي" || s === "partially_refunded") return "partially_refunded";
  if (s === "لم تحضر" || s === "no_show") return "no_show";
  return "pending";
}

function statusLabelAr(status?: string) {
  const k = statusKey(status);
  if (k === "confirmed") return "مؤكد";
  if (k === "pending") return "انتظار";
  if (k === "completed") return "مكتمل";
  if (k === "cancelled") return "ملغي";
  if (k === "refunded") return "مسترجع";
  if (k === "partially_refunded") return "استرجاع جزئي";
  if (k === "no_show") return "لم تحضر";
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

// ===== Profile media helpers =====
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

function mapPortalBookingToUi(row: import("../services/ClientPortalService").ClientPortalBooking): BookingData {
  const firstItem = row.items[0];
  const serviceNames = row.items.map((item) => item.serviceName).filter(Boolean);
  const packageItem = row.items.find((item) => item.packageCovered || item.clientPackageId);
  return {
    id: row.id,
    name: row.clientName || "عميلة",
    phone: row.clientPhone || "",
    service: serviceNames.join(" + ") || "خدمة",
    employee: row.staffName || firstItem?.staffName || "",
    date: row.bookingDate,
    time: row.startTime,
    status: row.status,
    total: row.totalHalalas / 100,
    finalPrice: row.totalHalalas / 100,
    paid: row.paidHalalas / 100,
    refunded: row.refundedHalalas / 100,
    paymentStatus: row.paymentStatus,
    paymentMethod: row.paymentMethod,
    packageSessionsUsed: row.packageSessionsUsed,
    packageName: packageItem?.clientPackageId,
    createdAt: row.createdAt ? Date.parse(row.createdAt) : 0,
    publicId: row.publicId,
    invoiceNumber: row.invoiceNumber,
    serviceDetails: serviceNames,
  };
}

function displayBookingRef(booking: BookingData) {
  const publicId = String(booking.publicId || "").trim();
  if (publicId) return publicId.toUpperCase();

  const rawId = String(booking.id || "").trim();
  return rawId ? rawId.slice(-6).toUpperCase() : "—";
}

const Profile: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const leavingForBookingRef = useRef(false);

  const [profileMode, setProfileMode] = useState<ProfileMode>("local");
  const [firebaseUid, setFirebaseUid] = useState<string | null>(null);
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);

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

  const [userData, setUserData] = useState<ProfileViewData>({
    name: cachedProfile?.name || currentUser?.name || localStorage.getItem("userName") || "",
    phone: normalizeKsaPhone(
      cachedProfile?.phone || currentUser?.phone || localStorage.getItem("userPhone") || ""
    ),
    email: cachedProfile?.email || currentUser?.email || localStorage.getItem("userEmail") || "",
    city: cachedProfile?.city || currentUser?.city || "",
    birthdate: cachedProfile?.birthdate || currentUser?.birthdate || "",
    avatar: resolveStableAvatarUrl(localStorage.getItem("userAvatar")) || "",
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
    setUserData((prev) => {
      if (prev.avatar === stableAvatar) return prev;
      return { ...prev, avatar: stableAvatar };
    });

    if (localStorage.getItem("userAvatar") !== stableAvatar) {
      localStorage.setItem("userAvatar", stableAvatar);
    }
  }, []);

  useEffect(() => {
    let alive = true;

    const applyProfileData = (raw: Record<string, any> | null | undefined) => {
      if (!raw || !alive) return;

      const stableAvatar = resolveStableAvatarUrl(raw?.avatarUrl);
      const fallbackAvatar = resolveStableAvatarUrl(localStorage.getItem("userAvatar"));

      setUserData((prev) => {
        const next = {
          ...prev,
          name: String(raw.name || prev.name || ""),
          phone: normalizeKsaPhone(String(raw.phone || prev.phone || "")),
          email: String(raw.email || prev.email || ""),
          city: String(raw.city || prev.city || ""),
          birthdate: String(raw.birthdate || prev.birthdate || ""),
          avatar: stableAvatar || fallbackAvatar || prev.avatar || "",
        };

        return sameProfileViewData(prev, next) ? prev : next;
      });

      if (stableAvatar && localStorage.getItem("userAvatar") !== stableAvatar) {
        localStorage.setItem("userAvatar", stableAvatar);
      }
    };

    const unsub = onAuthStateChanged(auth, (user) => {
      if (!alive) return;

      setFirebaseUser(user || null);

      if (!user) {
        setProfileMode("local");
        setFirebaseUid(null);

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

      // /client authorization is decided by App.tsx from the Core account role.
      // Cache is only a warm-start presentation layer. The authenticated
      // /client route is authorized in App.tsx and the canonical profile is
      // immediately replaced by ClientPortalService.snapshot() from Core D1.
      if (
        cachedProfile &&
        String(cachedProfile?.uid || "").trim() === user.uid
      ) {
        applyProfileData(cachedProfile);
      }
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
  // Client portal snapshot — Core D1 source of truth
  // =======================
  const [bookings, setBookings] = useState<BookingData[]>([]);
  const [bookingsErr, setBookingsErr] = useState<string>("");
  const [portalLoading, setPortalLoading] = useState(false);
  const [loyaltyData, setLoyaltyData] = useState<ClientPortalLoyalty | null>(null);
  const [cashbackData, setCashbackData] = useState<ClientPortalCashback | null>(null);
  const [clientOffers, setClientOffers] = useState<ClientPortalOffer[]>([]);
  const [preferencesData, setPreferencesData] = useState<ClientPortalPreferences | null>(null);
  const [preferenceStaffOptions, setPreferenceStaffOptions] = useState<Array<{ id: string; name: string }>>([]);
  const [preferenceSaving, setPreferenceSaving] = useState(false);
  const [preferenceMessage, setPreferenceMessage] = useState("");

  useEffect(() => {
    if (profileMode !== "firebase" || !firebaseUid || !firebaseUser) {
      setBookings([]);
      setLoyaltyData(null);
      setCashbackData(null);
      setClientOffers([]);
      setPreferencesData(null);
      setPreferenceStaffOptions([]);
      setPreferenceMessage("");
      return;
    }

    let alive = true;
    let loading = false;
    const loadPortal = async (silent = false) => {
      if (loading) return;
      loading = true;
      if (!silent) setPortalLoading(true);
      try {
        const snapshot = await ClientPortalService.snapshot();
        if (!alive) return;
        const rows = snapshot.bookings.map(mapPortalBookingToUi).sort((a, b) => {
          const tsA = toTs(a.date, a.time) || a.createdAt || 0;
          const tsB = toTs(b.date, b.time) || b.createdAt || 0;
          return tsB - tsA;
        });
        setBookings(rows);
        setLoyaltyData(snapshot.loyalty);
        setCashbackData(snapshot.cashback ?? null);
        setClientOffers(snapshot.offers);
        setPreferencesData(snapshot.preferences);
        const specialistOptions = new Map<string, string>();
        if (
          snapshot.preferences.preferredStaffId &&
          snapshot.preferences.preferredStaffName
        ) {
          specialistOptions.set(
            snapshot.preferences.preferredStaffId,
            snapshot.preferences.preferredStaffName
          );
        }
        for (const booking of snapshot.bookings) {
          if (booking.staffId && booking.staffName) {
            specialistOptions.set(booking.staffId, booking.staffName);
          }
          for (const item of booking.items) {
            if (item.staffId && item.staffName) {
              specialistOptions.set(item.staffId, item.staffName);
            }
          }
        }
        setPreferenceStaffOptions(
          [...specialistOptions.entries()]
            .map(([id, name]) => ({ id, name }))
            .sort((left, right) => left.name.localeCompare(right.name, "ar"))
        );
        setBookingsErr("");
        const canonicalProfile = {
          name: snapshot.profile.name || "عميلة",
          phone: normalizeKsaPhone(snapshot.profile.phoneNormalized || ""),
          email: snapshot.profile.email || "",
          city: snapshot.profile.city || "",
          birthdate: snapshot.profile.birthdate || "",
          avatar: resolveStableAvatarUrl(snapshot.profile.avatarUrl) || "",
        };
        setUserData((prev) =>
          sameProfileViewData(prev, canonicalProfile) ? prev : canonicalProfile
        );

        try {
          const cached = JSON.parse(
            localStorage.getItem("user_profile_v1") || "{}"
          );
          localStorage.setItem(
            "user_profile_v1",
            JSON.stringify({
              ...cached,
              name: canonicalProfile.name,
              phone: canonicalProfile.phone,
              email: canonicalProfile.email,
              city: canonicalProfile.city,
              birthdate: canonicalProfile.birthdate,
              avatarUrl: canonicalProfile.avatar,
            })
          );
          localStorage.setItem("userName", canonicalProfile.name);
          if (canonicalProfile.phone) localStorage.setItem("userPhone", canonicalProfile.phone);
          else localStorage.removeItem("userPhone");
          if (canonicalProfile.email) localStorage.setItem("userEmail", canonicalProfile.email);
          else localStorage.removeItem("userEmail");
          if (canonicalProfile.avatar) localStorage.setItem("userAvatar", canonicalProfile.avatar);
          else localStorage.removeItem("userAvatar");
        } catch {
          // Local cache is presentation-only; Core D1 remains authoritative.
        }
      } catch (error: any) {
        if (!alive) return;
        console.error("Client portal load error:", error);
        const message = String(error?.message || "تعذر تحميل بيانات الحساب.");
        setBookingsErr(message);
      } finally {
        loading = false;
        if (alive && !silent) setPortalLoading(false);
      }
    };

    const refreshWhenActive = () => {
      if (!alive || document.visibilityState === "hidden") return;
      void loadPortal(true);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshWhenActive();
    };

    void loadPortal(false);
    window.addEventListener("focus", refreshWhenActive);
    window.addEventListener("online", refreshWhenActive);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      alive = false;
      window.removeEventListener("focus", refreshWhenActive);
      window.removeEventListener("online", refreshWhenActive);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [profileMode, firebaseUid, firebaseUser]);

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

  const lastVisit = useMemo(() => {
    const visitStatuses = new Set(["completed", "refunded", "partially_refunded"]);
    return [...bookings]
      .filter((booking) => visitStatuses.has(statusKey(booking.status)))
      .sort((a, b) => (toTs(b.date, b.time) || b.createdAt || 0) - (toTs(a.date, a.time) || a.createdAt || 0))[0] || null;
  }, [bookings]);

  const mostVisitedSpecialist = useMemo(() => {
    const counts = new Map<string, number>();
    for (const booking of bookings) {
      if (!["completed", "refunded", "partially_refunded"].includes(statusKey(booking.status))) continue;
      const specialist = String(booking.employee || "").trim();
      if (!specialist) continue;
      counts.set(specialist, (counts.get(specialist) || 0) + 1);
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ar"));
    return ranked[0] ? { name: ranked[0][0], visits: ranked[0][1] } : null;
  }, [bookings]);

  // =======================
  // Loyalty — persisted, idempotent Core D1 ledger
  // =======================
  const membershipId = loyaltyData?.membershipId || "—";
  const loyalty = useMemo(() => ({
    points: loyaltyData?.balance ?? 0,
    earned: loyaltyData?.earned ?? 0,
    used: loyaltyData?.used ?? 0,
    reversed: loyaltyData?.reversed ?? 0,
    level: loyaltyData?.level ?? 1,
    loyaltyTitle: loyaltyData?.levelLabel || "برونزي",
    progress: loyaltyData?.progress ?? 0,
    pointsToNext: loyaltyData?.pointsToNext ?? 0,
    completedCount: bookings.filter((booking) => statusKey(booking.status) === "completed").length,
  }), [loyaltyData, bookings]);

  const savePreferredSpecialist = async (preferredStaffId: string) => {
    if (preferenceSaving) return;
    setPreferenceSaving(true);
    setPreferenceMessage("");
    try {
      const updated = await ClientPortalService.updatePreferences({
        preferredStaffId: preferredStaffId || null,
      });
      setPreferencesData(updated);
      if (updated.preferredStaffId && updated.preferredStaffName) {
        setPreferenceStaffOptions((current) => {
          const next = new Map<string, string>(
            current.map((row) => [row.id, row.name] as const)
          );
          next.set(updated.preferredStaffId!, updated.preferredStaffName!);
          return [...next.entries()]
            .map(([id, name]) => ({ id, name }))
            .sort((left, right) => left.name.localeCompare(right.name, "ar"));
        });
      }
      setPreferenceMessage("تم تحديث المختصة المفضلة.");
    } catch (error: any) {
      setPreferenceMessage(
        String(error?.message || "تعذر تحديث المختصة المفضلة.")
      );
    } finally {
      setPreferenceSaving(false);
    }
  };

  const saveMarketingConsent = async (marketingConsent: boolean) => {
    if (preferenceSaving) return;
    setPreferenceSaving(true);
    setPreferenceMessage("");
    try {
      const updated = await ClientPortalService.updatePreferences({
        marketingConsent,
      });
      setPreferencesData(updated);
      setPreferenceMessage("تم تحديث تفضيلات العروض والتسويق.");
    } catch (error: any) {
      setPreferenceMessage(
        String(error?.message || "تعذر تحديث تفضيلات العروض والتسويق.")
      );
    } finally {
      setPreferenceSaving(false);
    }
  };

  // =======================
  // Avatar
  // =======================
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const effectiveUid =
        String(firebaseUid || firebaseUser?.uid || cachedProfile?.uid || "").trim();

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

      // 5) Core D1 هو مصدر الحقيقة للصورة؛ R2 يحفظ الملف فقط.
      const canonical = await ClientPortalService.patchProfile({
        avatarUrl: publicUrl,
      });
      const canonicalAvatar =
        resolveStableAvatarUrl(canonical.avatarUrl) || publicUrl;

      setUserData((prev) => ({
        ...prev,
        avatar: canonicalAvatar,
      }));
      localStorage.setItem("userAvatar", canonicalAvatar);

      try {
        const cached =
          JSON.parse(localStorage.getItem("user_profile_v1") || "null") || {};
        localStorage.setItem(
          "user_profile_v1",
          JSON.stringify({
            ...cached,
            uid: effectiveUid,
            avatarUrl: canonicalAvatar,
          })
        );
      } catch {
        // Presentation cache only.
      }

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

  const [activeTab, setActiveTab] = useState<ProfileTab>(() => profileTabFromPath(location.pathname));

  useEffect(() => {
    const tab = profileTabFromPath(location.pathname);
    writeStoredProfileTab(tab);
    setActiveTab(tab);
  }, [location.pathname]);

  const selectProfileTab = (tab: ProfileTab) => {
    writeStoredProfileTab(tab);
    setActiveTab(tab);
    navigate(profilePathForTab(tab));
  };

  const handleBottomLoyalty = () => selectProfileTab("loyalty");
  const handleBottomBookings = () => selectProfileTab("bookings");
  const handleBottomProfile = () => selectProfileTab("profile");
  const handleBottomPackages = () => selectProfileTab("packages");

  // =======================
  // Edit Modal
  // =======================
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [editForm, setEditForm] = useState<EditProfileForm>({
    name: "",
    phone: "",
    email: "",
    city: "",
    birthdate: "",
  });

  const openEditProfile = () => {
    const nextForm = {
      name: userData.name,
      phone: userData.phone,
      email: userData.email,
      city: userData.city,
      birthdate: userData.birthdate,
    };

    setEditForm(nextForm);
    setIsEditOpen(true);
  };

  const closeEditProfile = () => {
    setIsEditOpen(false);
  };

  useEffect(() => {
    if (!isEditOpen) return;

    document.documentElement.dataset.profileEditOpen = "true";

    return () => {
      delete document.documentElement.dataset.profileEditOpen;
    };
  }, [isEditOpen]);

  const handleSaveProfile = async (event?: React.FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    if (isSavingProfile) return;

    setIsSavingProfile(true);

    const trimmedName = editForm.name.trim();
    const trimmedEmail = editForm.email.trim();
    const trimmedCity = editForm.city.trim();
    const trimmedBd = editForm.birthdate.trim();

    if (!trimmedName) {
      alert("الاسم مطلوب.");
      setIsSavingProfile(false);
      return;
    }

    if (trimmedBd && !isValidISODate(trimmedBd)) {
      alert("تاريخ الميلاد يجب أن يكون بصيغة YYYY-MM-DD (مثال: 1995-07-20).");
      setIsSavingProfile(false);
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
      if (profileMode !== "firebase" || !firebaseUid || !firebaseUser) {
        throw new Error("يلزم تسجيل الدخول لحفظ بيانات الحساب.");
      }

      const canonical = await ClientPortalService.patchProfile({
        name: updated.name,
        phone: updated.phone,
        email: updated.email,
        city: updated.city,
        birthdate: updated.birthdate,
      });
      const next = {
        name: canonical.name || "عميلة",
        phone: normalizeKsaPhone(canonical.phoneNormalized || ""),
        email: canonical.email || "",
        city: canonical.city || "",
        birthdate: canonical.birthdate || "",
        avatar: resolveStableAvatarUrl(canonical.avatarUrl) || userData.avatar,
      };

      setUserData((prev) =>
        sameProfileViewData(prev, next) ? prev : next
      );
      const cached = JSON.parse(localStorage.getItem("user_profile_v1") || "{}");
      localStorage.setItem(
        "user_profile_v1",
        JSON.stringify({
          ...cached,
          name: next.name,
          phone: next.phone,
          email: next.email,
          city: next.city,
          birthdate: next.birthdate,
          avatarUrl: next.avatar,
        })
      );

      localStorage.setItem("userName", next.name);
      if (next.email) localStorage.setItem("userEmail", next.email);
      else localStorage.removeItem("userEmail");
      if (next.phone) localStorage.setItem("userPhone", next.phone);
      else localStorage.removeItem("userPhone");

      setIsEditOpen(false);
      window.setTimeout(() => {
        window.dispatchEvent(new Event("authChanged"));
      }, 0);

      alert("تم حفظ البيانات بنجاح ✅");
    } catch (e) {
      console.error("Save profile error:", e);
      alert("صار خطأ أثناء حفظ البيانات. حاول مرة ثانية.");
    } finally {
      setIsSavingProfile(false);
    }
  };

  // =======================
  // تسجيل الخروج
  // =======================
  const handleLogout = async () => {
    try {
      await logoutFirebase();
    } catch { }

    clearStoredProfileTab();
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
  if (!authChecked && !cachedProfile && !currentUser && !auth.currentUser) {
    return (
      <div className="p-root">
        <div className="p-wrapper">
          <div className="p-loader">جاري تحميل الحساب...</div>
        </div>
      </div>
    );
  }

  const pageTitle = activeTab === "bookings"
    ? "حجوزاتي"
    : activeTab === "packages"
      ? "باقاتي"
      : activeTab === "offers"
        ? "العروض الخاصة"
        : activeTab === "connect"
          ? "تواصلي مع مختصتك"
          : activeTab === "loyalty"
            ? "حسابي"
            : "الرئيسية";

  const money = (value?: number) => `${Number(value || 0).toFixed(2).replace(/\.00$/, "")} ريال`;
  const paymentMethodLabel = (value?: string) => {
    const key = String(value || "").toLowerCase();
    if (key === "cash") return "كاش";
    if (["card", "pos_card", "mada_online"].includes(key)) return "شبكة/مدى";
    if (key === "transfer") return "تحويل بنكي";
    return value || "غير محددة";
  };
  const paymentStatusLabel = (value?: string) => {
    const key = String(value || "").toLowerCase();
    if (key === "paid") return "مدفوع";
    if (key === "partial") return "مدفوع جزئيًا";
    if (key === "refunded") return "مسترجع";
    return "غير مدفوع";
  };

  return (
    <div className="p-root client-app-shell">
      <div className="p-wrapper client-mobile-page">
        <div className="p-nav-header">
          <button className="p-icon-btn" type="button" onClick={() => navigate(-1)} aria-label="رجوع">
            <LuArrowLeft />
          </button>
          <h1 className="p-nav-title">{pageTitle}</h1>
          <button className="p-icon-btn" type="button" onClick={handleLogout} aria-label="تسجيل الخروج">
            <LuLogOut />
          </button>
        </div>

        {bookingsErr ? (
          <div className="p-alert" role="alert">
            <strong>تعذر تحميل بيانات حسابك</strong>
            <div className="p-alert-sub">{bookingsErr}</div>
          </div>
        ) : null}

        <div className="p-profile-hero">
          <div className="p-avatar-wrapper">
            <div className="p-avatar-main">
              {userData.avatar ? <img src={userData.avatar} alt="صورة العميلة" /> : <span><LuImage /></span>}
            </div>
            {!userData.avatar ? (
              <button className="p-avatar-edit" type="button" onClick={() => fileInputRef.current?.click()} aria-label="إضافة صورة">+</button>
            ) : null}
            <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleAvatarChange} />
          </div>
          <h2 className="p-user-name-hero">{userData.name || "عميلة"}</h2>
          {activeTab === "loyalty" ? (
            <div className="p-user-info-chips">
              <button type="button" className="p-info-chip" onClick={copyMembershipId} dir="ltr">ID {membershipId}</button>
              {userData.phone ? <span className="p-info-chip" dir="ltr">{userData.phone}</span> : null}
              {userData.city ? <span className="p-info-chip">{userData.city}</span> : null}
            </div>
          ) : null}
        </div>

        {portalLoading && !bookingsErr ? <div className="p-loader">جاري تحميل بيانات حسابك...</div> : null}

        {activeTab === "profile" ? (
          <>
            <div className="p-stats-grid">
              <div className="p-stat-card">
                <div className="p-stat-icon p-icon-total"><LuCalendarDays /></div>
                <div className="p-stat-content"><span className="p-stat-value">{kpis.total}</span><span className="p-stat-label">الحجوزات</span></div>
              </div>
              <div className="p-stat-card">
                <div className="p-stat-icon p-icon-confirmed"><LuCalendarCheck /></div>
                <div className="p-stat-content"><span className="p-stat-value">{kpis.confirmed}</span><span className="p-stat-label">مؤكدة</span></div>
              </div>
              <div className="p-stat-card">
                <div className="p-stat-icon p-icon-pending"><LuHourglass /></div>
                <div className="p-stat-content"><span className="p-stat-value">{kpis.pending}</span><span className="p-stat-label">انتظار</span></div>
              </div>
              <div className="p-stat-card">
                <div className="p-stat-icon p-icon-completed"><LuAward /></div>
                <div className="p-stat-content"><span className="p-stat-value">{kpis.completed}</span><span className="p-stat-label">مكتملة</span></div>
              </div>
            </div>

            <section className="p-quick-booking">
              <div className="p-quick-booking-head">
                <h3>اختصاراتك السريعة</h3>
                <p>احجزي موعدًا جديدًا أو راجعي حجوزاتك وباقاتك.</p>
              </div>
              <div className="p-quick-booking-actions">
                <button className="p-link-action p-link-action-wide" onClick={() => navigate("/booking")} type="button">
                  <span className="p-link-action-plus">+</span><span>حجز جديد</span>
                </button>
                <button className="p-link-action p-link-action-soft" onClick={() => selectProfileTab("bookings")} type="button">حجوزاتي</button>
                <button className="p-link-action p-link-action-soft" onClick={() => selectProfileTab("connect")} type="button"><LuMessageCircle /> تواصلي مع مختصتك</button>
                <button className="p-link-action p-link-action-ghost" onClick={() => selectProfileTab("packages")} type="button">باقاتي</button>
              </div>
            </section>

            <section className="p-section-container">
              <div className="p-section-header"><h3>حجزك القادم</h3><button type="button" className="p-text-link" onClick={() => selectProfileTab("bookings")}>كل الحجوزات</button></div>
              {upcomingBooking ? (
                <div className="p-modern-booking-card">
                  <div className="p-booking-main-info">
                    <div className="p-booking-service-icon"><LuScissors /></div>
                    <div className="p-booking-details"><span className="p-booking-service-name">{upcomingBooking.service}</span><span className="p-booking-employee-name">مع {upcomingBooking.employee || "سيتم تحديد الموظفة"}</span></div>
                    <div className={`p-status-pill status-${statusKey(upcomingBooking.status)}`}>{statusLabelAr(upcomingBooking.status)}</div>
                  </div>
                  <div className="p-booking-footer-info">
                    <div className="p-footer-item"><LuCalendarDays /> {formatDateAr(upcomingBooking.date)}</div>
                    <div className="p-footer-item"><LuClock3 /> {formatTime12(upcomingBooking.time, "-")}</div>
                  </div>
                  <div className="p-booking-actions-modern"><button className="p-btn-modern primary" type="button" onClick={() => navigate(`/track/${encodeURIComponent(upcomingBooking.publicId || upcomingBooking.id)}`)}>تتبع الحجز</button></div>
                </div>
              ) : !portalLoading && !bookingsErr ? <div className="p-empty-state">لا يوجد حجز قادم حاليًا.</div> : null}
            </section>

            <section className="p-section-container">
              <div className="p-section-header"><h3>آخر زيارة</h3><button type="button" className="p-text-link" onClick={() => selectProfileTab("bookings")}>السجل</button></div>
              {lastVisit ? (
                <div className="p-modern-booking-card">
                  <div className="p-booking-main-info">
                    <div className="p-booking-service-icon"><LuReceipt /></div>
                    <div className="p-booking-details"><span className="p-booking-service-name">{lastVisit.service}</span><span className="p-booking-employee-name">مع {lastVisit.employee || "غير محددة"}</span></div>
                  </div>
                  <div className="p-booking-footer-info">
                    <div className="p-footer-item"><LuCalendarDays /> {formatDateAr(lastVisit.date)}</div>
                    <div className="p-footer-item"><LuClock3 /> {formatTime12(lastVisit.time, "-")}</div>
                  </div>
                </div>
              ) : !portalLoading && !bookingsErr ? <div className="p-empty-state">لا توجد زيارة مكتملة حتى الآن.</div> : null}
            </section>

            {mostVisitedSpecialist ? (
              <section className="p-section-container">
                <div className="p-section-header"><h3>مختصتك الأكثر زيارة</h3></div>
                <div className="p-account-rows">
                  <div><span>المختصة</span><strong>{mostVisitedSpecialist.name}</strong></div>
                  <div><span>عدد الزيارات معها</span><strong>{mostVisitedSpecialist.visits}</strong></div>
                </div>
              </section>
            ) : null}

            {preferencesData ? (
              <section className="p-section-container">
                <div className="p-section-header"><h3>تفضيلاتي</h3></div>
                <div className="p-account-rows">
                  <div>
                    <span>المختصة المفضلة</span>
                    <select
                      className="p-modern-select"
                      value={preferencesData.preferredStaffId || ""}
                      onChange={(event) => void savePreferredSpecialist(event.target.value)}
                      disabled={preferenceSaving}
                      aria-label="المختصة المفضلة"
                    >
                      <option value="">بدون مختصة مفضلة</option>
                      {preferenceStaffOptions.map((staff) => (
                        <option key={staff.id} value={staff.id}>{staff.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <span>العروض والرسائل التسويقية</span>
                    <label>
                      <input
                        type="checkbox"
                        checked={preferencesData.marketingConsent}
                        onChange={(event) => void saveMarketingConsent(event.target.checked)}
                        disabled={preferenceSaving}
                      />{" "}
                      {preferencesData.marketingConsent ? "مسموح" : "غير مسموح"}
                    </label>
                  </div>
                  <div>
                    <span>رسائل الخدمة</span>
                    <strong>{preferencesData.serviceMessagesEnabled ? "مفعلة" : "موقفة"}</strong>
                  </div>
                  <div>
                    <span>MALIKAT Connect</span>
                    <strong>{preferencesData.connectEnabled ? "مفعّل" : "موقوف"}</strong>
                  </div>
                </div>
                <p className="p-section-caption">
                  اختيار مختصة مفضلة يساعد ملكات في تخصيص تجربتك، ولا ينقل ملكية ملفك لأي موظفة.
                </p>
                {preferenceMessage ? <div className="p-empty-state">{preferenceMessage}</div> : null}
              </section>
            ) : null}

            <section className="p-section-container p-home-loyalty-summary">
              <div className="p-section-header"><h3>{cashbackData?.enabled ? "رصيد الكاش باك" : "النقاط والولاء"}</h3><button type="button" className="p-text-link" onClick={() => selectProfileTab("loyalty")}>عرض الحساب</button></div>
              <div className="p-home-summary-grid">
                {cashbackData?.enabled ? (
                  <>
                    <div><strong>{money(cashbackData.balanceHalalas / 100)}</strong><span>رصيد متاح داخل ملكات</span></div>
                    <div><strong>{money(cashbackData.earnedHalalas / 100)}</strong><span>إجمالي الكاش باك المكتسب</span></div>
                  </>
                ) : (
                  <>
                    <div><strong>{loyalty.points}</strong><span>نقطة متاحة</span></div>
                    <div><strong>{loyalty.loyaltyTitle}</strong><span>المستوى الحالي</span></div>
                  </>
                )}
              </div>
            </section>

            <section className="p-section-container">
              <div className="p-section-header"><h3>العروض الخاصة</h3><button type="button" className="p-text-link" onClick={() => selectProfileTab("offers")}>عرض الكل</button></div>
              {clientOffers.length ? (
                <div className="p-offers-grid">
                  {clientOffers.slice(0, 2).map((offer) => (
                    <button key={offer.id} type="button" className="p-offer-card p-offer-card--compact" onClick={() => navigate(`/booking?scope=offers&pick=${encodeURIComponent(`offer:${offer.id}`)}`)}>
                      {offer.imageUrl ? <img src={offer.imageUrl} alt="" /> : <span className="p-offer-icon"><LuBadgePercent /></span>}
                      <span><strong>{offer.title}</strong><small>{offer.description || (offer.discountType === "percent" ? `خصم ${offer.value}%` : `خصم ${money(offer.value / 100)}`)}</small></span>
                    </button>
                  ))}
                </div>
              ) : !portalLoading && !bookingsErr ? <div className="p-empty-state">لا توجد عروض متاحة حاليًا.</div> : null}
            </section>
          </>
        ) : null}

        {activeTab === "connect" ? (
          <ClientConnectPanel enabled={preferencesData?.connectEnabled === true} />
        ) : null}

        {activeTab === "loyalty" ? (
          <>
            <section className="p-section-container p-account-card">
              <div className="p-section-header"><h3>بيانات الحساب</h3><button type="button" className="p-text-link" onClick={openEditProfile}>تعديل</button></div>
              <div className="p-account-rows">
                <div><span>الاسم</span><strong>{userData.name || "—"}</strong></div>
                <div><span>رقم العميلة</span><strong dir="ltr">{membershipId}</strong></div>
                <div><span>رقم الجوال</span><strong dir="ltr">{userData.phone || "—"}</strong></div>
                <div><span>البريد الإلكتروني</span><strong dir="ltr">{userData.email || "—"}</strong></div>
                <div><span>المدينة</span><strong>{userData.city || "—"}</strong></div>
                <div><span>تاريخ الميلاد</span><strong dir="ltr">{userData.birthdate || "—"}</strong></div>
              </div>
            </section>

            <section className="p-section-container">
              <div className="p-section-header">
                <h3>{cashbackData?.enabled ? "الكاش باك" : "النقاط والولاء"}</h3>
                <button type="button" className="p-badge-id-hero" onClick={copyMembershipId}><LuIdCard className="p-inline-icon" /> ID: {membershipId}</button>
              </div>
              {cashbackData?.enabled ? (
                <>
                  <div className="p-points-card">
                    <div className="p-points-head"><h4>رصيد الكاش باك</h4><span className="p-points-badge">Cashback</span></div>
                    <div className="p-points-value-row"><strong>{money(cashbackData.balanceHalalas / 100)}</strong><span>متاح للاستخدام داخل صالون ملكات</span></div>
                    <div className="p-home-summary-grid" style={{ marginTop: 12 }}><div><strong>{money(cashbackData.earnedHalalas / 100)}</strong><span>مكتسب</span></div><div><strong>{money(cashbackData.redeemedHalalas / 100)}</strong><span>مستخدم</span></div><div><strong>{money(cashbackData.reversedHalalas / 100)}</strong><span>معكوس / منتهي</span></div><div><strong>داخل ملكات</strong><span>لا سحب نقدي ولا تحويل</span></div></div>
                  </div>
                  {cashbackData.transactions.length ? (
                    <div className="p-loyalty-transactions">
                      <h4>آخر الحركات</h4>{cashbackData.transactions.slice(0, 10).map((tx) => (<div key={tx.id}><span>{tx.reason}{tx.createdAt ? <small style={{ display: "block", opacity: 0.7 }}>{formatDateAr(String(tx.createdAt).slice(0, 10))}</small> : null}</span><strong className={tx.amountHalalas >= 0 ? "is-positive" : "is-negative"}>{tx.amountHalalas > 0 ? "+" : ""}{money(tx.amountHalalas / 100)}</strong></div>))}
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <div className="p-points-card">
                    <div className="p-points-head"><h4>رصيد النقاط</h4><span className="p-points-badge">Points</span></div>
                    <div className="p-points-value-row"><strong>{loyalty.points}</strong><span>نقطة متاحة</span></div>
                    <div className="p-points-meta">
                      <span>مكتسبة: {loyalty.earned}</span>
                      <span>مستخدمة: {loyalty.used}</span>
                      <span>معكوسة بالاسترجاع: {loyalty.reversed}</span>
                      <span>{loyalty.pointsToNext > 0 ? `متبقي ${loyalty.pointsToNext} نقطة للمستوى التالي` : "أعلى مستوى حالي"}</span>
                    </div>
                  </div>
                  <div className="p-loyalty-card">
                    <div className="p-loyalty-head"><h4>حالة الولاء</h4><div className="p-level-badge">Lv. {loyalty.level}</div></div>
                    <div className="p-loyalty-tier-line"><span>التصنيف الحالي: {loyalty.loyaltyTitle}</span><span>{loyalty.progress}%</span></div>
                    <div className="p-progress-bar-container"><div className="p-progress-bar-fill" style={{ width: `${loyalty.progress}%` }} /></div>
                    <p className="p-loyalty-note">تُحتسب النقاط من قيمة الحجوزات المكتملة، وتُعكس تلقائيًا عند الاسترجاع.</p>
                  </div>
                  {loyaltyData?.transactions?.length ? (
                    <div className="p-loyalty-transactions">
                      <h4>آخر حركات النقاط</h4>
                      {loyaltyData.transactions.slice(0, 10).map((tx) => (
                        <div key={tx.id}><span>{tx.reason}</span><strong className={tx.points >= 0 ? "is-positive" : "is-negative"}>{tx.points > 0 ? "+" : ""}{tx.points}</strong></div>
                      ))}
                    </div>
                  ) : null}
                </>
              )}
            </section>
          </>
        ) : null}

        {activeTab === "bookings" ? (
          <>
            <section className="p-section-container">
              <div className="p-section-header"><h3>الحجز القادم</h3></div>
              {!upcomingBooking && !portalLoading && !bookingsErr ? (
                <div className="p-empty-state">لا يوجد حجز قادم حاليًا.</div>
              ) : upcomingBooking ? (
                <div className="p-modern-booking-card">
                  <div className="p-booking-main-info">
                    <div className="p-booking-service-icon"><LuScissors /></div>
                    <div className="p-booking-details"><span className="p-booking-service-name">{upcomingBooking.service}</span><span className="p-booking-employee-name">مع {upcomingBooking.employee || "سيتم تحديد الموظفة"}</span></div>
                    <div className={`p-status-pill status-${statusKey(upcomingBooking.status)}`}>{statusLabelAr(upcomingBooking.status)}</div>
                  </div>
                  <div className="p-booking-footer-info">
                    <div className="p-footer-item"><LuCalendarDays /> {formatDateAr(upcomingBooking.date)}</div>
                    <div className="p-footer-item"><LuClock3 /> {formatTime12(upcomingBooking.time, "-")}</div>
                  </div>
                  <div className="p-booking-actions-modern"><button className="p-btn-modern primary" type="button" onClick={() => navigate(`/track/${encodeURIComponent(upcomingBooking.publicId || upcomingBooking.id)}`)}>تتبع الحجز</button></div>
                </div>
              ) : null}
            </section>

            <section className="p-section-container">
              <div className="p-section-header p-bookings-section-head">
                <h3>سجل الحجوزات</h3>
                <select className="p-modern-select" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="فلترة الحجوزات">
                  <option value="all">الكل</option><option value="confirmed">مؤكد</option><option value="pending">انتظار</option><option value="completed">مكتمل</option><option value="cancelled">ملغي</option><option value="refunded">مسترجع</option><option value="partially_refunded">استرجاع جزئي</option><option value="no_show">لم تحضر</option>
                </select>
              </div>
              <div className="p-bookings-list-modern">
                {!bookingsFiltered.length && !portalLoading && !bookingsErr ? <div className="p-empty-state">لا توجد حجوزات تطابق الفلتر.</div> : null}
                {bookingsFiltered.map((booking) => (
                  <article key={booking.id} className="p-list-item-modern p-booking-history-card">
                    <div className="p-list-icon"><LuReceipt /></div>
                    <div className="p-list-content">
                      <div className="p-list-row-top"><span className="p-list-service">{booking.service}</span><span className={`p-list-status status-${statusKey(booking.status)}`}>{statusLabelAr(booking.status)}</span></div>
                      <div className="p-list-row-bottom">
                        <span><LuIdCard /> <bdi dir="ltr">{displayBookingRef(booking)}</bdi></span><span><LuCalendarDays /> {formatDateAr(booking.date)}</span><span><LuClock3 /> {formatTime12(booking.time, "-")}</span>
                      </div>
                      <div className="p-booking-financial-row">
                        <span>الموظفة: <strong>{booking.employee || "غير محددة"}</strong></span>
                        <span>السعر: <strong>{money(booking.finalPrice)}</strong></span>
                        <span>الدفع: <strong>{paymentMethodLabel(booking.paymentMethod)} · {paymentStatusLabel(booking.paymentStatus)}</strong></span>
                        {booking.packageSessionsUsed ? <span>الباقة: <strong>{booking.packageSessionsUsed} جلسة</strong></span> : null}
                        {booking.refunded ? <span>المسترجع: <strong>{money(booking.refunded)}</strong></span> : null}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </>
        ) : null}

        {activeTab === "packages" ? (
          <section className="p-section-container p-packages-page-section">
            <div className="p-section-header"><h3>باقاتي</h3><button type="button" className="p-text-link" onClick={() => navigate("/offers")}>استعراض الباقات المتاحة</button></div>
            <MyPackagesPanel
              enabled={profileMode === "firebase" && !!firebaseUser}
              onBrowse={() => navigate("/offers")}
              onSelectAvailable={(packageId) => navigate(`/booking?scope=offers_packages&pick=${encodeURIComponent(`pkg:${packageId}`)}&autoAdd=1`)}
            />
          </section>
        ) : null}

        {activeTab === "offers" ? (
          <section className="p-section-container">
            <div className="p-section-header"><h3>العروض الخاصة</h3></div>
            {!clientOffers.length && !portalLoading && !bookingsErr ? <div className="p-empty-state">لا توجد عروض متاحة حاليًا.</div> : null}
            <div className="p-offers-grid p-offers-grid--full">
              {clientOffers.map((offer) => (
                <article className="p-offer-card p-offer-card--full" key={offer.id}>
                  {offer.imageUrl ? <img src={offer.imageUrl} alt={offer.title} /> : <div className="p-offer-image-placeholder"><LuBadgePercent /></div>}
                  <div className="p-offer-body">
                    <div className="p-offer-title-row"><h4>{offer.title}</h4><span>{offer.discountType === "percent" ? `${offer.value}%` : money(offer.value / 100)}</span></div>
                    {offer.description ? <p>{offer.description}</p> : null}
                    {offer.priceAfterHalalas != null ? (
                      <div className="p-offer-prices">{offer.priceBeforeHalalas != null ? <del>{money(offer.priceBeforeHalalas / 100)}</del> : null}<strong>{money(offer.priceAfterHalalas / 100)}</strong></div>
                    ) : null}
                    {offer.endsAt ? <small>ينتهي في {formatDateAr(offer.endsAt.slice(0, 10))}</small> : null}
                    <button type="button" onClick={() => navigate(`/booking?scope=offers&pick=${encodeURIComponent(`offer:${offer.id}`)}`)}>{offer.ctaLabel || "احجزي الآن"}</button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <nav className="p-bottom-nav client-bottom-navigation" aria-label="تنقل بوابة العميلة">
        <button className={`p-bottom-item ${activeTab === "profile" ? "is-active" : ""}`} type="button" onClick={handleBottomProfile} aria-label="الرئيسية"><LuHouse /></button>
        <button className={`p-bottom-item ${activeTab === "bookings" ? "is-active" : ""}`} type="button" onClick={handleBottomBookings} aria-label="حجوزاتي"><LuCalendarCheck /></button>
        <button className="p-bottom-center" type="button" onClick={() => navigate("/booking")} aria-label="حجز جديد"><LuScissors /></button>
        <button className={`p-bottom-item ${activeTab === "packages" ? "is-active" : ""}`} type="button" onClick={handleBottomPackages} aria-label="باقاتي"><LuPackage /></button>
        <button className={`p-bottom-item ${activeTab === "loyalty" ? "is-active" : ""}`} type="button" onClick={handleBottomLoyalty} aria-label="حسابي"><LuUser /></button>
      </nav>

      {/* ===== Edit Modal (Modernized) ===== */}
      {isEditOpen ? (
        <div className="p-modal-overlay-modern">
          <div
            className="p-modal-content-modern"
            role="dialog"
            aria-modal="true"
            aria-labelledby="profile-edit-title"
          >
            <form className="p-modal-form-modern" onSubmit={handleSaveProfile}>
            <div className="p-modal-header-modern">
              <h3 id="profile-edit-title">تعديل الملف الشخصي</h3>
              <button
                className="p-close-modal"
                type="button"
                onClick={closeEditProfile}
                aria-label="إغلاق نافذة تعديل الملف الشخصي"
              >
                ✕
              </button>
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
                <input dir="ltr" lang="en" type="date" value={editForm.birthdate} onChange={(e) => setEditForm((p) => ({ ...p, birthdate: e.target.value }))} />
              </div>
            </div>
            <div className="p-modal-footer-modern">
              <button className="p-btn-save-modern" type="submit" disabled={isSavingProfile}>
                {isSavingProfile ? "جاري الحفظ..." : "حفظ التغييرات"}
              </button>
            </div>
            </form>
          </div>
        </div>
      ) : null}

    </div>
  );
};

export default Profile;
