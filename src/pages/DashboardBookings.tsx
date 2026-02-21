// src/pages/DashboardBookings.tsx
import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import Modal from "../components/Modal";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faSearch,
  faFilter,
  faFileCsv,
  faXmark,
  faCircleInfo,
  faRotate,
  faPlus,
} from "@fortawesome/free-solid-svg-icons";

// ✅ Firestore Auth
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../services/firebase";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query as fsQuery,
  limit as fsLimit,
  where,
} from "firebase/firestore";

import {
  listAllBookings,
  watchAllBookings, // ✅ Realtime
  updateBookingStatus,
  createDashboardBooking,
  updateBookingDetails as updateBookingFields,
  deleteBooking,
  type BookingStatus,
} from "../services/firestoreBookings";

import type { UiRole } from "../services/userProfile";

// ✅ NEW: resolve service name (make it readable)
import { resolveServiceName } from "../services/serviceResolver";

// ✅ NEW: AppSettings from Firestore (source of truth)
import { AppSettingsService, type AppSettings } from "../services/AppSettingsService";

import { isStaffAvailableForDate } from "../helpers/staffAvailability";

// ✅ Styles
import "../styles/DashboardBookings.css";

/* =========================
   Constants / Types
========================= */

type StatusOption = BookingStatus | "all";

const NOTES_KEY = "dashboard_booking_notes_v1";

const statusLabel: Record<BookingStatus, string> = {
  confirmed: "مؤكد",
  pending: "في الانتظار",
  cancelled: "ملغي",
  completed: "مكتمل",
};

const allStatusOptions: BookingStatus[] = ["pending", "confirmed", "completed", "cancelled"];

/* =========================
   Helpers
========================= */

function safeISODate(d: string | undefined | null) {
  if (!d) return "";
  return d.trim();
}

function inDateRange(bookingDate: string, from: string, to: string) {
  const d = safeISODate(bookingDate);
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

function downloadCSV(filename: string, rows: string[][]) {
  const escapeCell = (cell: string) => {
    const s = (cell ?? "").toString();
    if (s.includes('"') || s.includes(",") || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const csv = rows.map((r) => r.map(escapeCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

function loadNotesMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed;
    return {};
  } catch {
    return {};
  }
}

function saveNotesMap(map: Record<string, string>) {
  localStorage.setItem(NOTES_KEY, JSON.stringify(map));
}

function getUiRole(): UiRole {
  try {
    const authUserRaw = localStorage.getItem("auth_user");
    if (authUserRaw) {
      const au = JSON.parse(authUserRaw);
      const r = String(au?.role || "").toLowerCase().trim();
      if (r === "owner") return "owner";
      if (r === "admin") return "admin";
      if (r === "reception") return "reception";
      if (r === "staff") return "staff";
      if (r === "client") return "client";
    }
  } catch {
    // ignore
  }
  const raw = (localStorage.getItem("userRole") || "").toLowerCase().trim();
  if (raw === "owner") return "owner";
  if (raw === "admin") return "admin";
  if (raw === "reception") return "reception";
  if (raw === "staff") return "staff";
  if (raw === "client") return "client";
  return "guest";
}

function getAuthUserSafe(): { displayName: string; email: string } {
  try {
    const raw = localStorage.getItem("auth_user");
    if (raw) {
      const au = JSON.parse(raw);
      const displayName = String(au?.name || au?.displayName || "").trim();
      const email = String(au?.email || "").trim();
      return { displayName, email };
    }
  } catch {
    // ignore
  }
  const u = auth.currentUser;
  const displayName = String(u?.displayName || "").trim();
  const email = String(u?.email || "").trim();
  return { displayName, email };
}

function formatTime12(time24: string) {
  const m = String(time24 || "").trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return String(time24 || "-");
  const h24 = Number(m[1]);
  const mm = m[2];
  const h12 = h24 % 12 || 12;
  return `${String(h12).padStart(2, "0")}:${mm} ${h24 >= 12 ? "م" : "ص"}`;
}

function bookingRef(b: Partial<Booking> | null | undefined) {
  const raw = String(b?.publicId || "").trim();
  if (!raw) return "—";
  const up = raw.toUpperCase();
  if (/^MK-\d+$/.test(up)) return up;
  if (/^\d+$/.test(up)) return `MK-${up}`;
  return up;
}

function toMillisSafe(v: any) {
  if (!v) return 0;
  if (typeof v?.toMillis === "function") return Number(v.toMillis()) || 0;
  if (typeof v?.seconds === "number") {
    const sec = Number(v.seconds || 0);
    const ns = Number(v.nanoseconds || 0);
    return sec * 1000 + Math.floor(ns / 1_000_000);
  }
  if (typeof v === "number") return Number(v) || 0;
  const parsed = Date.parse(String(v));
  return Number.isFinite(parsed) ? parsed : 0;
}

function bookingPublicBase(publicId?: string) {
  const up = String(publicId || "").trim().toUpperCase();
  if (!up) return "";
  const m = up.match(/^(MK-\d+)(?:-\d+)?$/i);
  return m ? m[1].toUpperCase() : up;
}

function resolveDashboardBookingBlockKey(b: Booking) {
  const groupId = String((b as any)?.bookingGroupId || (b as any)?.parentBookingId || "").trim();
  if (groupId) return `group:${groupId}`;

  const fullPublic = String(b?.publicId || "").trim().toUpperCase();
  const basePublic = bookingPublicBase(fullPublic);
  if (basePublic && fullPublic && fullPublic.startsWith(`${basePublic}-`)) {
    return `public:${basePublic}`;
  }

  const phone = digitsOnly(String(b?.phone || "").trim());
  const name = normalizeArabicName(String(b?.customerName || "").trim());
  const date = String(b?.date || "").trim();
  const createdMs = toMillisSafe((b as any)?.createdAt);
  if ((phone || name) && date && createdMs > 0) {
    const bucket = Math.floor(createdMs / (2 * 60 * 1000));
    const idPart = phone ? `p:${phone}` : `n:${name}`;
    return `batch:${String(b?.channel || "").trim()}:${idPart}:${date}:${bucket}`;
  }

  return `single:${String(b?.id || "").trim() || "unknown"}`;
}

function channelLabel(channel?: string) {
  if (channel === "client") return "موقع العميلات";
  if (channel === "dashboard") return "الداشبورد";
  if (channel === "internal") return "الحجز الداخلي";
  return "غير محدد";
}

function formatEventAt(v: any) {
  try {
    const ms =
      typeof v?.toMillis === "function"
        ? v.toMillis()
        : typeof v?.seconds === "number"
          ? Number(v.seconds) * 1000
          : 0;
    if (!ms) return "—";
    const d = new Date(ms);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${formatTime12(`${hh}:${mi}`)}`;
  } catch {
    return "—";
  }
}

function formatAnyDateTime(v: any) {
  try {
    if (!v) return "—";
    const ms =
      typeof v?.toMillis === "function"
        ? v.toMillis()
        : typeof v?.seconds === "number"
          ? Number(v.seconds) * 1000
          : typeof v === "number"
            ? v
            : Date.parse(String(v));
    if (!Number.isFinite(ms) || ms <= 0) return "—";
    const d = new Date(ms);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${formatTime12(`${hh}:${mi}`)}`;
  } catch {
    return "—";
  }
}

function digitsOnly(v: string) {
  return String(v || "").replace(/\D/g, "");
}

function actorLabelFromEvent(ev: any) {
  const email = String(ev?.byEmail || "").trim();
  if (email) return email.split("@")[0];
  const uid = String(ev?.byUid || "").trim();
  if (uid) return uid.slice(0, 8);
  return "غير معروف";
}

function normalizeArabicName(input: string) {
  const s = String(input || "").trim().toLowerCase();
  return s
    .replace(/[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED]/g, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

type BookingServiceItem = {
  serviceId?: string;
  serviceName?: string;
  price?: number;
  durationMin?: number;
  sectionLabel?: string;
  categoryLabel?: string;
};

function toArabicOnlyLabel(value: string, fallback = "—"): string {
  const raw = String(value || "").trim();
  if (!raw) return fallback;

  const dict: Record<string, string> = {
    makeup: "مكياج",
    "hair care": "العناية بالشعر",
    "hair-care": "العناية بالشعر",
    hair: "شعر",
    nails: "أظافر",
    skin: "بشرة",
    eyeliner: "ايلاينر",
  };

  let s = raw.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  Object.entries(dict)
    .sort((a, b) => b[0].length - a[0].length)
    .forEach(([en, ar]) => {
      const re = new RegExp(`\\b${en.replace(/\s+/g, "\\s+")}\\b`, "gi");
      s = s.replace(re, ar);
    });

  // منع أي كلمات إنجليزية متبقية من الظهور
  s = s.replace(/\b[A-Za-z]{2,}\b/g, " ").replace(/\s+/g, " ").trim();
  return s || fallback;
}

function toStringArray(v: any): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x ?? "").trim()).filter(Boolean);
  return [];
}

function extractServicesFromAny(anyB: any): BookingServiceItem[] {
  const pkgServices = Array.isArray(anyB?.packageSnapshot?.services) ? anyB.packageSnapshot.services : [];
  if (pkgServices.length) {
    return pkgServices
      .map((x: any) => ({
        serviceId: String(x?.serviceId ?? "").trim() || undefined,
        serviceName: toArabicOnlyLabel(String(x?.serviceName ?? "").trim(), "") || undefined,
        price: Number.isFinite(Number(x?.price)) ? Number(x?.price) : undefined,
        durationMin: Number.isFinite(Number(x?.durationMin)) ? Number(x?.durationMin) : undefined,
        sectionLabel: toArabicOnlyLabel(String(x?.sectionTitle || x?.sectionId || "").trim(), "") || undefined,
        categoryLabel: toArabicOnlyLabel(String(x?.categoryName || x?.categoryId || "").trim(), "") || undefined,
      }))
      .filter((x: any) => x.serviceId || x.serviceName);
  }

  const sArr = Array.isArray(anyB?.services) ? anyB.services : null;
  if (sArr && sArr.length) {
    return sArr.map((x: any) => ({
      serviceId: String(x?.serviceId ?? x?.id ?? x?.key ?? "").trim() || undefined,
      serviceName: toArabicOnlyLabel(String(x?.serviceName ?? x?.name ?? "").trim(), "") || undefined,
      price: Number.isFinite(Number(x?.price)) ? Number(x?.price) : undefined,
      durationMin: Number.isFinite(Number(x?.durationMin)) ? Number(x?.durationMin) : undefined,
      sectionLabel: toArabicOnlyLabel(String(x?.sectionTitle || x?.sectionId || "").trim(), "") || undefined,
      categoryLabel: toArabicOnlyLabel(String(x?.categoryName || x?.categoryId || "").trim(), "") || undefined,
    })).filter((x: any) => x.serviceId || x.serviceName);
  }
  const ids = toStringArray(anyB?.serviceIds);
  const names = toStringArray(anyB?.serviceNames);
  if (ids.length || names.length) {
    const max = Math.max(ids.length, names.length);
    const out: BookingServiceItem[] = [];
    for (let i = 0; i < max; i++) {
      if (ids[i] || names[i]) out.push({ serviceId: ids[i] || undefined, serviceName: names[i] || undefined });
    }
    return out;
  }
  const serviceId = String(anyB?.serviceId ?? anyB?.service ?? anyB?.serviceKey ?? "").trim();
  const serviceName = String(anyB?.serviceName ?? "").trim();
  if (serviceId || serviceName) {
    return [{
      serviceId: serviceId || undefined,
      serviceName: toArabicOnlyLabel(serviceName, "") || undefined,
      sectionLabel: toArabicOnlyLabel(String(anyB?.serviceSnapshot?.sectionTitleAtBooking || anyB?.serviceSnapshot?.sectionIdAtBooking || "").trim(), "") || undefined,
      categoryLabel: toArabicOnlyLabel(String(anyB?.serviceSnapshot?.categoryNameAtBooking || anyB?.serviceSnapshot?.categoryIdAtBooking || "").trim(), "") || undefined,
    }];
  }
  return [];
}

function serviceMetaSummaryForTable(b: Booking): string {
  const section = String(
    b?.serviceSnapshot?.sectionTitleAtBooking ||
      b?.serviceSnapshot?.sectionIdAtBooking ||
      ""
  ).trim();
  const category = String(
    b?.serviceSnapshot?.categoryNameAtBooking ||
      b?.serviceSnapshot?.categoryIdAtBooking ||
      ""
  ).trim();
  const pkgName = String(b?.packageSnapshot?.packageName || "").trim();
  const pkgCount = Array.isArray(b?.packageSnapshot?.services) ? b.packageSnapshot.services.length : 0;
  if (pkgName) return `${pkgName}${pkgCount > 0 ? ` (${pkgCount} خدمات)` : ""}`;
  if (section || category) return `${section || "—"}${category ? ` • ${category}` : ""}`;
  return "—";
}

function serviceSummaryForTable(b: Booking): string {
  const list = b.services || [];
  if (!list.length) return b.serviceName || b.serviceId || "—";
  const firstName = (list[0]?.serviceName || list[0]?.serviceId || "").trim();
  if (list.length <= 1) return firstName || b.serviceName || b.serviceId || "—";
  return `${firstName || (b.serviceName || b.serviceId || "خدمة")} + ${list.length - 1} خدمات`;
}

type Booking = {
  id: string;
  publicId?: string;
  bookingGroupId?: string;
  parentBookingId?: string;
  isParentBooking?: boolean;
  isSubBooking?: boolean;
  channel?: "client" | "dashboard" | "internal";
  createdBy?: string;
  customerName?: string;
  phone?: string;
  serviceName?: string;
  serviceId?: string;
  note?: string;
  services?: BookingServiceItem[];
  serviceSnapshot?: {
    serviceNameAtBooking?: string;
    priceAtBooking?: number;
    durationAtBooking?: number;
    sectionIdAtBooking?: string;
    sectionTitleAtBooking?: string;
    categoryIdAtBooking?: string;
    categoryNameAtBooking?: string;
  };
  packageSnapshot?: {
    packageId?: string;
    packageName?: string;
    finalPriceAtBooking?: number;
    baseTotalPriceAtBooking?: number;
    totalDurationMinAtBooking?: number;
    services?: Array<{
      serviceId?: string;
      serviceName?: string;
      sectionId?: string;
      sectionTitle?: string;
      categoryId?: string;
      categoryName?: string;
      price?: number;
      durationMin?: number;
    }>;
  };
  durationMin?: number;
  slotStepMinAtBooking?: number;
  bufferMinAtBooking?: number;
  employeeName?: string;
  employeeId?: string | null;
  employeeUid?: string | null;
  date: string;
  time: string;
  status: BookingStatus;
  total?: number;
  finalPrice?: number;
  createdAt?: any;
  updatedAt?: any;
};

type ClientLoyaltyInfo = {
  points: number;
  loyaltyScore: number;
  isVip: boolean;
};

type BookingLastUpdate = {
  by: string;
  at: string;
};

/* =========================
   Component
========================= */
export default function DashboardBookings() {
  const [loading, setLoading] = useState(true);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [error, setError] = useState("");

  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusOption>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [notesMap, setNotesMap] = useState<Record<string, string>>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [savedNoteId, setSavedNoteId] = useState("");
  const [clientLoyalty, setClientLoyalty] = useState<ClientLoyaltyInfo | null>(null);
  const [clientLoyaltyLoading, setClientLoyaltyLoading] = useState(false);
  const [lastUpdateMap, setLastUpdateMap] = useState<Record<string, BookingLastUpdate>>({});
  const [cancelTarget, setCancelTarget] = useState<Booking | null>(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const saveHintTimerRef = useRef<number | null>(null);

  const uiRole = getUiRole();
  const authUser = getAuthUserSafe();
  const closeBookingModal = useCallback(() => setSelectedBooking(null), []);
  const closeCancelModal = useCallback(() => setCancelTarget(null), []);

  useEffect(() => {
    return () => {
      if (saveHintTimerRef.current) window.clearTimeout(saveHintTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const loaded = loadNotesMap();
    setNotesMap(loaded);
    setNoteDrafts(loaded);
    const unsub = watchAllBookings((data) => {
      const baseList = data.map((b: any) => ({
        ...b,
        customerName: String(b?.customerName || b?.clientName || b?.name || "").trim() || "",
        phone: String(b?.phone || b?.clientPhone || b?.customerPhone || "").trim() || "",
        services: extractServicesFromAny(b),
      }));
      setBookings(
        baseList.map((x) => ({
          ...x,
          customerName: x.customerName || "غير متوفر",
          phone: x.phone || "غير متوفر",
        }))
      );
      setLoading(false);

      // fallback: بعض السجلات القديمة الاسم/الجوال موجودين فقط في booking_tracks
      const missing = baseList.filter((x) => !String(x.customerName || "").trim() || !String(x.phone || "").trim());
      if (!missing.length) return;

      Promise.all(
        missing.map(async (x) => {
          try {
            const t = await getDoc(doc(db, "salons", "main", "booking_tracks", x.id));
            if (!t.exists()) return x;
            const td: any = t.data() || {};
            const name = String(td?.clientName || td?.customerName || td?.name || "").trim();
            const phone = String(td?.clientPhone || td?.phone || td?.customerPhone || "").trim();
            return {
              ...x,
              customerName: x.customerName || name || "غير متوفر",
              phone: x.phone || phone || "غير متوفر",
            };
          } catch {
            return {
              ...x,
              customerName: x.customerName || "غير متوفر",
              phone: x.phone || "غير متوفر",
            };
          }
        })
      ).then((patched) => {
        const patchedMap = new Map(patched.map((p) => [p.id, p]));
        const finalList = baseList.map((x) => {
          const p = patchedMap.get(x.id);
          if (!p) {
            return {
              ...x,
              customerName: x.customerName || "غير متوفر",
              phone: x.phone || "غير متوفر",
            };
          }
          return p;
        });
        setBookings(finalList);
      });
    }, (err) => {
      setError("خطأ في تحميل الحجوزات");
      setLoading(false);
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadClientLoyalty = async () => {
      if (!selectedBooking) {
        setClientLoyalty(null);
        return;
      }
      setClientLoyaltyLoading(true);
      try {
        const phoneRaw = String(selectedBooking.phone || "");
        const phoneDigits = digitsOnly(phoneRaw);
        const nameNorm = normalizeArabicName(String(selectedBooking.customerName || ""));

        let found: any = null;

        if (phoneDigits) {
          const q1 = fsQuery(
            collection(db, "users"),
            where("role", "==", "client"),
            where("phone", "==", phoneDigits),
            fsLimit(1)
          );
          const s1 = await getDocs(q1);
          if (!s1.empty) found = s1.docs[0].data();
        }

        if (!found && phoneRaw && phoneRaw !== "غير متوفر") {
          const q2 = fsQuery(
            collection(db, "users"),
            where("role", "==", "client"),
            where("phone", "==", phoneRaw),
            fsLimit(1)
          );
          const s2 = await getDocs(q2);
          if (!s2.empty) found = s2.docs[0].data();
        }

        if (!found && nameNorm) {
          const allClients = await getDocs(fsQuery(collection(db, "users"), where("role", "==", "client")));
          const match = allClients.docs.find((d) => {
            const x: any = d.data() || {};
            return normalizeArabicName(String(x.name || "")) === nameNorm;
          });
          if (match) found = match.data();
        }

        if (cancelled) return;

        if (!found) {
          setClientLoyalty({ points: 0, loyaltyScore: 0, isVip: false });
          return;
        }

        setClientLoyalty({
          points: Number(found?.loyaltyPoints || 0),
          loyaltyScore: Number(found?.loyaltyStats?.loyaltyScore || 0),
          isVip: !!found?.vip?.isVip,
        });
      } catch {
        if (!cancelled) setClientLoyalty({ points: 0, loyaltyScore: 0, isVip: false });
      } finally {
        if (!cancelled) setClientLoyaltyLoading(false);
      }
    };
    loadClientLoyalty();
    return () => {
      cancelled = true;
    };
  }, [selectedBooking]);

  useEffect(() => {
    let cancelled = false;
    const loadLastUpdates = async () => {
      const rows = bookings.slice(0, 80);
      if (!rows.length) return;
      const entries = await Promise.all(
        rows.map(async (b) => {
          try {
            const q = fsQuery(
              collection(db, "salons", "main", "booking_logs", b.id, "events"),
              orderBy("at", "desc"),
              fsLimit(1)
            );
            const snap = await getDocs(q);
            if (snap.empty) {
              const fallbackAt = formatAnyDateTime((b as any)?.updatedAt || (b as any)?.createdAt);
              return [b.id, { by: "النظام", at: fallbackAt }] as const;
            }
            const ev = snap.docs[0].data();
            const eventAt = formatEventAt(ev?.at);
            const fallbackAt = formatAnyDateTime((b as any)?.updatedAt || (b as any)?.createdAt);
            return [b.id, { by: actorLabelFromEvent(ev), at: eventAt === "—" ? fallbackAt : eventAt }] as const;
          } catch {
            const fallbackAt = formatAnyDateTime((b as any)?.updatedAt || (b as any)?.createdAt);
            return [b.id, { by: "النظام", at: fallbackAt }] as const;
          }
        })
      );
      if (cancelled) return;
      setLastUpdateMap((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    };
    loadLastUpdates();
    return () => {
      cancelled = true;
    };
  }, [bookings]);

  const previousClientNotes = useMemo(() => {
    if (!selectedBooking) return [] as Array<{ id: string; ref: string; date: string; time: string; note: string }>;

    const targetPhone = digitsOnly(String(selectedBooking.phone || ""));
    const targetName = normalizeArabicName(String(selectedBooking.customerName || ""));

    return bookings
      .filter((b) => b.id !== selectedBooking.id)
      .map((b) => {
        const note = String(notesMap[b.id] || "").trim();
        if (!note) return null;

        const samePhone = !!targetPhone && digitsOnly(String(b.phone || "")) === targetPhone;
        const sameName =
          !!targetName &&
          normalizeArabicName(String(b.customerName || "")) === targetName;

        if (!samePhone && !sameName) return null;

        return {
          id: b.id,
          ref: bookingRef(b),
          date: String(b.date || ""),
          time: String(b.time || ""),
          note,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time)) as Array<{
      id: string; ref: string; date: string; time: string; note: string
    }>;
  }, [selectedBooking, bookings, notesMap]);

  const filtered = useMemo(() => {
    let list = [...bookings];
    if (statusFilter !== "all") {
      list = list.filter((b) => b.status === statusFilter);
    }
    if (dateFrom || dateTo) {
      list = list.filter((b) => inDateRange(b.date, dateFrom, dateTo));
    }
    const search = normalizeArabicName(q);
    if (search) {
      list = list.filter((b) => {
        const name = normalizeArabicName(b.customerName || "");
        const phone = (b.phone || "").toLowerCase();
        const emp = normalizeArabicName(b.employeeName || "");
        return name.includes(search) || phone.includes(search) || emp.includes(search);
      });
    }
    // Filter by role if staff
    if (uiRole === "staff") {
      list = list.filter((b) => {
        const bUid = String(b.employeeUid || "").trim();
        const bId = String(b.employeeId || "").trim();
        const bName = String(b.employeeName || "").trim();
        const myUid = auth.currentUser?.uid;
        if (myUid && bUid === myUid) return true;
        if (myUid && bId === myUid) return true;
        return bName && normalizeArabicName(bName).includes(normalizeArabicName(authUser.displayName));
      });
    }
    return list.sort((a, b) => b.date.localeCompare(a.date) || b.time.localeCompare(a.time));
  }, [bookings, q, statusFilter, dateFrom, dateTo, uiRole, authUser]);

  const groupedFiltered = useMemo(() => {
    const blocks = new Map<string, { key: string; label: string; rows: Booking[] }>();

    filtered.forEach((b) => {
      const key = resolveDashboardBookingBlockKey(b);
      const current = blocks.get(key);
      if (current) {
        current.rows.push(b);
        return;
      }

      const label = bookingPublicBase(String(b.publicId || "").trim()) || bookingRef(b);
      blocks.set(key, { key, label, rows: [b] });
    });

    const out = Array.from(blocks.values());
    out.forEach((block) => {
      block.rows.sort((a, b) => {
        const d = String(a.date || "").localeCompare(String(b.date || ""));
        if (d !== 0) return d;
        return String(a.time || "").localeCompare(String(b.time || ""));
      });
    });

    return out;
  }, [filtered]);

  const getAllowedStatusOptions = (b: Booking): BookingStatus[] => {
    if (uiRole === "owner") return allStatusOptions;
    if (uiRole === "admin" || uiRole === "reception") {
      if (b.status === "pending") return ["pending", "confirmed", "cancelled"];
      return [b.status];
    }
    return [b.status];
  };

  const handleUpdateStatus = async (id: string, newStatus: BookingStatus) => {
    const target = bookings.find((x) => x.id === id);
    if (!target) return;
    const allowed = getAllowedStatusOptions(target);
    if (!allowed.includes(newStatus)) {
      alert("غير مسموح لك بهذا التغيير.");
      return;
    }
    if (newStatus === "cancelled") {
      setCancelTarget(target);
      return;
    }
    try {
      await updateBookingStatus(id, newStatus);
    } catch (e) {
      alert("فشل تحديث الحالة");
    }
  };

  const confirmCancelBooking = async () => {
    if (!cancelTarget?.id) return;
    setCancelBusy(true);
    try {
      await updateBookingStatus(cancelTarget.id, "cancelled");
      setCancelTarget(null);
    } catch {
      alert("فشل إلغاء الحجز");
    } finally {
      setCancelBusy(false);
    }
  };

  const handleDeleteBooking = async (b: Booking) => {
    if (uiRole !== "owner") {
      alert("الحذف النهائي متاح للمالك فقط");
      return;
    }

    const ref = bookingRef(b);
    const ok = window.confirm(`تأكيد الحذف النهائي للحجز #${ref}؟ لا يمكن التراجع.`);
    if (!ok) return;

    try {
      await deleteBooking(b.id);
      if (selectedBooking?.id === b.id) setSelectedBooking(null);
    } catch (e) {
      alert("تعذر حذف الحجز نهائيًا");
    }
  };

  const handleExport = () => {
    const rows = [
      ["ID", "الزبون", "الهاتف", "الخدمة", "الموظفة", "التاريخ", "الوقت", "الحالة", "السعر"],
      ...filtered.map(b => [
        bookingRef(b),
        b.customerName || "—",
        b.phone || "—",
        serviceSummaryForTable(b),
        b.employeeName || "—",
        b.date,
        formatTime12(b.time),
        statusLabel[b.status],
        String(b.finalPrice || b.total || 0)
      ])
    ];
    downloadCSV(`bookings_${new Date().toISOString().slice(0,10)}.csv`, rows);
  };

  const updateNote = (id: string, note: string) => {
    setNoteDrafts((prev) => ({ ...prev, [id]: note }));
  };

  const saveNote = (id: string) => {
    const text = String(noteDrafts[id] ?? "").trim();
    const newMap = { ...notesMap, [id]: text };
    setNotesMap(newMap);
    setNoteDrafts(newMap);
    saveNotesMap(newMap);
    setSavedNoteId(id);
    if (saveHintTimerRef.current) window.clearTimeout(saveHintTimerRef.current);
    saveHintTimerRef.current = window.setTimeout(() => setSavedNoteId(""), 1800);
  };

  if (loading) return <div className="p-5 text-center">جاري التحميل...</div>;

  return (
    <div className="bk-page-wrapper">
      <div className="container-fluid">
        <div className="bookings-header">
          <h1>إدارة الحجوزات</h1>
          <p>عرض وتعديل كافة الحجوزات في النظام</p>
          {error && <div className="bookings-error">{error}</div>}
        </div>

        <div className="bk-mini">
          <div className="bk-filters">
            <div className="bk-field">
              <label>بحث</label>
              <input 
                type="text"
                className="bk-input bk-search-input" 
                autoComplete="new-password"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="none"
                placeholder="اسم، هاتف، أو موظفة..." 
                value={q} 
                onChange={e => setQ(e.target.value)} 
              />
            </div>
            <div className="bk-field">
              <label>الحالة</label>
              <select className="bk-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}>
                <option value="all">الكل</option>
                <option value="pending">قيد الانتظار</option>
                <option value="confirmed">مؤكد</option>
                <option value="completed">مكتمل</option>
                <option value="cancelled">ملغي</option>
              </select>
            </div>
            <div className="bk-field bk-field-date">
              <label>من تاريخ</label>
              <input
                type="date"
                className="bk-input bk-date-input"
                lang="ar-SA"
                dir="rtl"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                onClick={(e) => {
                  const el = e.currentTarget as HTMLInputElement & { showPicker?: () => void };
                  if (typeof el.showPicker === "function") el.showPicker();
                }}
              />
            </div>
            <div className="bk-field bk-field-date">
              <label>إلى تاريخ</label>
              <input
                type="date"
                className="bk-input bk-date-input"
                lang="ar-SA"
                dir="rtl"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                onClick={(e) => {
                  const el = e.currentTarget as HTMLInputElement & { showPicker?: () => void };
                  if (typeof el.showPicker === "function") el.showPicker();
                }}
              />
            </div>
          </div>
          <div className="bk-actions">
            <button className="exp-btn" onClick={handleExport}>
              <FontAwesomeIcon icon={faFileCsv} /> تصدير CSV
            </button>
            <button className="exp-btn ghost" onClick={() => { setQ(""); setStatusFilter("all"); setDateFrom(""); setDateTo(""); }}>
              <FontAwesomeIcon icon={faRotate} /> إعادة ضبط
            </button>
          </div>
        </div>

        <div className="bookings-table-card">
          <div className="bk-table-wrap">
            <table className="bookings-table">
              <thead>
                <tr>
                  <th>رقم الحجز</th>
                  <th>الزبون</th>
                  <th>الخدمة</th>
                  <th>الموظفة</th>
                  <th>التاريخ والوقت</th>
                  <th>آخر تحديث</th>
                  <th>السعر</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {groupedFiltered.flatMap((block) => {
                  const rows: any[] = [];
                  if (block.rows.length > 1) {
                    rows.push(
                      <tr key={`group-${block.key}`} className="bookings-group-row">
                        <td colSpan={8}>
                          <div className="bookings-group-row-inner">
                            <span className="bookings-group-title">حجز مجمّع</span>
                            <span className="bookings-group-meta">
                              المرجع: {block.label} - الخدمات: {block.rows.length}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  }

                  block.rows.forEach((b) => {
                    rows.push(
                      <tr key={b.id}>
                        <td style={{ fontWeight: 900 }}>{bookingRef(b)}</td>
                        <td>
                          <div style={{fontWeight: 800}}>{b.customerName || "—"}</div>
                          <div style={{fontSize: 11, opacity: 0.6}}>{b.phone || "—"}</div>
                          <div style={{fontSize: 11, opacity: 0.6}}>المصدر: {channelLabel(b.channel)}</div>
                        </td>
                        <td>
                          <div style={{ fontWeight: 700 }}>{serviceSummaryForTable(b)}</div>
                          <div style={{ fontSize: 11, opacity: 0.75 }}>{serviceMetaSummaryForTable(b)}</div>
                        </td>
                        <td>{b.employeeName || "—"}</td>
                        <td>
                          <div>{b.date}</div>
                          <div style={{fontSize: 11, opacity: 0.7}}>{formatTime12(b.time)}</div>
                        </td>
                        <td>
                          <div style={{ fontWeight: 800 }}>{lastUpdateMap[b.id]?.by || "—"}</div>
                          <div style={{ fontSize: 11, opacity: 0.7 }}>{lastUpdateMap[b.id]?.at || "—"}</div>
                        </td>
                        <td>{b.finalPrice || b.total || 0} ر.س</td>
                        <td>
                          <div style={{display: 'flex', gap: 6, justifyContent: 'center'}}>
                            <button className="exp-btn ghost sm" onClick={() => setSelectedBooking(b)}>
                              <FontAwesomeIcon icon={faCircleInfo} />
                            </button>
                            {uiRole === "owner" && (
                              <>
                                <button
                                  className="exp-btn danger sm"
                                  onClick={() => handleDeleteBooking(b)}
                                  title="حذف نهائي"
                                >
                                  حذف
                                </button>
                                <select
                                  className={`bk-select sm bk-owner-status-select bk-owner-status-${b.status}`}
                                  style={{ width: "auto", height: 40, padding: "0 12px", fontSize: 12 }}
                                  value={b.status}
                                  onChange={(e) => handleUpdateStatus(b.id, e.target.value as BookingStatus)}
                                >
                                  {allStatusOptions.map((s) => (
                                    <option key={`desk_${b.id}_${s}`} value={s}>
                                      {statusLabel[s]}
                                    </option>
                                  ))}
                                </select>
                              </>
                            )}
                            {(uiRole === "admin" || uiRole === "reception") && b.status === "pending" && (
                              <>
                                <button
                                  className="exp-btn sm"
                                  onClick={() => handleUpdateStatus(b.id, "confirmed")}
                                >
                                  تأكيد
                                </button>
                                <button
                                  className="exp-btn danger sm"
                                  onClick={() => handleUpdateStatus(b.id, "cancelled")}
                                >
                                  إلغاء
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  });

                  return rows;
                })}
              </tbody>
            </table>
          </div>

          <div className="bk-mobile-grid">
            {groupedFiltered.map((block) => (
              <div key={`mob-${block.key}`} className="bk-mobile-group">
                {block.rows.length > 1 ? (
                  <div className="bk-mobile-group-head">
                    <span>حجز مجمّع</span>
                    <span>{block.label} - {block.rows.length} خدمات</span>
                  </div>
                ) : null}
                {block.rows.map((b) => (
                  <div key={b.id} className="bk-mobile-card">
                    <div className="bk-mobile-row">
                      <span className="bk-mobile-label">رقم الحجز:</span>
                      <span className="bk-mobile-val" style={{fontWeight: 900}}>{bookingRef(b)}</span>
                    </div>
                    <div className="bk-mobile-row">
                      <span className="bk-mobile-label">الزبون:</span>
                      <span className="bk-mobile-val">{b.customerName || "—"}</span>
                    </div>
                    <div className="bk-mobile-row">
                      <span className="bk-mobile-label">الجوال:</span>
                      <span className="bk-mobile-val">{b.phone || "—"}</span>
                    </div>
                    <div className="bk-mobile-row">
                      <span className="bk-mobile-label">الخدمة:</span>
                      <span className="bk-mobile-val">
                        {serviceSummaryForTable(b)}
                        <div style={{ fontSize: 11, opacity: 0.75 }}>{serviceMetaSummaryForTable(b)}</div>
                      </span>
                    </div>
                    <div className="bk-mobile-row">
                      <span className="bk-mobile-label">الموظفة:</span>
                      <span className="bk-mobile-val">{b.employeeName || "—"}</span>
                    </div>
                    <div className="bk-mobile-row">
                      <span className="bk-mobile-label">التاريخ:</span>
                      <span className="bk-mobile-val bk-mobile-date-val">{b.date} {formatTime12(b.time)}</span>
                    </div>
                    <div className="bk-mobile-row">
                      <span className="bk-mobile-label">المصدر:</span>
                      <span className="bk-mobile-val">{channelLabel(b.channel)}</span>
                    </div>
                    <div className="bk-mobile-row">
                      <span className="bk-mobile-label">الحالة:</span>
                      <span className={`status-badge ${b.status}`}>{statusLabel[b.status]}</span>
                    </div>
                    <div className="bk-mobile-actions">
                       <button className="exp-btn ghost sm w-100" onClick={() => setSelectedBooking(b)}>تفاصيل</button>
                       {uiRole === "owner" && (
                         <>
                           <button className="exp-btn danger sm w-100" onClick={() => handleDeleteBooking(b)}>
                             حذف نهائي
                           </button>
                           <select
                             className={`bk-select sm bk-owner-status-select bk-owner-status-${b.status}`}
                             style={{ height: 40, padding: "0 12px", fontSize: 12 }}
                             value={b.status}
                             onChange={(e) => handleUpdateStatus(b.id, e.target.value as BookingStatus)}
                           >
                             {allStatusOptions.map((s) => (
                               <option key={`mob_${b.id}_${s}`} value={s}>
                                 {statusLabel[s]}
                               </option>
                             ))}
                           </select>
                         </>
                       )}
                       {(uiRole === "admin" || uiRole === "reception") && b.status === "pending" && (
                         <>
                           <button className="exp-btn sm w-100" onClick={() => handleUpdateStatus(b.id, "confirmed")}>
                             تأكيد
                           </button>
                           <button className="exp-btn danger sm w-100" onClick={() => handleUpdateStatus(b.id, "cancelled")}>
                             إلغاء
                           </button>
                         </>
                       )}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {selectedBooking && (
          <Modal
            open={!!selectedBooking}
            onClose={closeBookingModal}
            ariaLabel="تفاصيل الحجز"
            panelClassName="bk-modal"
            size="lg"
          >
            <div className="modal-head">
              <b>تفاصيل الحجز #{bookingRef(selectedBooking)}</b>
              <button className="exp-btn ghost" onClick={closeBookingModal}>
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
            <div className="modal-body">
              <div className="bk-details-grid">
                <div className="bk-item">
                  <span className="bk-item-label">رقم الحجز</span>
                  <span className="bk-item-val">{bookingRef(selectedBooking)}</span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">اسم الزبون</span>
                  <span className="bk-item-val">{selectedBooking.customerName || "—"}</span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">رقم الهاتف</span>
                  <span className="bk-item-val">{selectedBooking.phone || "—"}</span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">نقاط العميلة</span>
                  <span className="bk-item-val">
                    {clientLoyaltyLoading ? "..." : `${clientLoyalty?.points ?? 0} نقطة`}
                  </span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">ولاء العميلة</span>
                  <span className="bk-item-val">
                    {clientLoyaltyLoading
                      ? "..."
                      : `${clientLoyalty?.loyaltyScore ?? 0}${(clientLoyalty?.isVip ? " • VIP" : "")}`}
                  </span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">المصدر</span>
                  <span className="bk-item-val">{channelLabel(selectedBooking.channel)}</span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">التاريخ</span>
                  <span className="bk-item-val">{selectedBooking.date}</span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">الوقت</span>
                  <span className="bk-item-val">{formatTime12(selectedBooking.time)}</span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">الموظفة</span>
                  <span className="bk-item-val">{selectedBooking.employeeName || "—"}</span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">مدة الخدمة</span>
                  <span className="bk-item-val">
                    {Number(selectedBooking.durationMin || 0) > 0
                      ? `${selectedBooking.durationMin} دقيقة`
                      : "—"}
                  </span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">السعر الإجمالي</span>
                  <span className="bk-item-val">{selectedBooking.finalPrice || selectedBooking.total || 0} ر.س</span>
                </div>
                <div className="bk-item">
                  <span className="bk-item-label">الحالة</span>
                  <span className="bk-item-val">
                    <span className={`status-badge ${selectedBooking.status}`}>{statusLabel[selectedBooking.status]}</span>
                  </span>
                </div>
              </div>

              <div className="bk-note-area">
                <label className="bk-item-label">الخدمات داخل الحجز</label>
                <div className="bk-services-list">
                  {(selectedBooking.services && selectedBooking.services.length > 0
                    ? selectedBooking.services
                    : [{ serviceName: selectedBooking.serviceName, serviceId: selectedBooking.serviceId }]
                  ).map((s, idx) => (
                    <div key={`${selectedBooking.id}_svc_${idx}`} className="bk-service-row">
                      <span>
                        {toArabicOnlyLabel(String(s.serviceName || s.serviceId || ""), "خدمة")}
                        <div style={{ fontSize: 11, opacity: 0.75 }}>
                          {toArabicOnlyLabel(String(s.sectionLabel || ""), "—")} • {toArabicOnlyLabel(String(s.categoryLabel || ""), "—")}
                        </div>
                      </span>
                      <span>
                        {Number(s.durationMin || 0) > 0 ? `${s.durationMin} د` : "—"} · {Number(s.price || 0) > 0 ? `${s.price} ر.س` : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bk-note-area">
                <label className="bk-item-label">ملاحظات سابقة على العميلة</label>
                {previousClientNotes.length === 0 ? (
                  <div className="bk-events-empty">لا توجد ملاحظات سابقة لهذه العميلة.</div>
                ) : (
                  <div className="bk-events-list">
                    {previousClientNotes.map((n) => (
                      <div key={n.id} className="bk-event-row">
                        <div className="bk-event-top">
                          <strong>#{n.ref}</strong>
                          <span>{n.date} {formatTime12(n.time)}</span>
                        </div>
                        <div className="bk-event-note">{n.note}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bk-note-area">
                <label className="bk-item-label">ملاحظات الإدارة (خاصة)</label>
                <textarea 
                  className="bk-input" 
                  rows={3} 
                  placeholder="أضف ملاحظات هنا..."
                  value={noteDrafts[selectedBooking.id] ?? notesMap[selectedBooking.id] ?? ""}
                  onChange={e => updateNote(selectedBooking.id, e.target.value)}
                />
                <div className="bk-note-actions">
                  <button
                    type="button"
                    className="exp-btn"
                    onClick={() => saveNote(selectedBooking.id)}
                  >
                    حفظ الملاحظة
                  </button>
                  {savedNoteId === selectedBooking.id ? (
                    <span className="bk-note-saved">تم الحفظ</span>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="modal-foot">
              {uiRole === "owner" && (
                <button className="exp-btn danger" onClick={() => handleDeleteBooking(selectedBooking)}>
                  حذف نهائي
                </button>
              )}
              <button className="exp-btn bk-close-btn" onClick={closeBookingModal}>إغلاق</button>
            </div>
          </Modal>
        )}

        <Modal
          open={!!cancelTarget}
          onClose={() => (cancelBusy ? null : closeCancelModal())}
          ariaLabel="تأكيد إلغاء الحجز"
          panelClassName="bk-cancel-modal"
          size="sm"
        >
          <div className="bk-cancel-head">تأكيد إلغاء الحجز</div>
          <div className="bk-cancel-body">
            <p>هل تريد بالفعل إلغاء هذا الحجز؟</p>
            <div className="bk-cancel-meta">
              <span>رقم الحجز: {bookingRef(cancelTarget)}</span>
              <span>العميلة: {cancelTarget?.customerName || "—"}</span>
              <span>التاريخ: {cancelTarget?.date || "—"} - {formatTime12(cancelTarget?.time || "")}</span>
            </div>
          </div>
          <div className="bk-cancel-foot">
            <button
              type="button"
              className="exp-btn ghost"
              onClick={closeCancelModal}
              disabled={cancelBusy}
            >
              رجوع
            </button>
            <button
              type="button"
              className="exp-btn danger"
              onClick={confirmCancelBooking}
              disabled={cancelBusy}
            >
              {cancelBusy ? "جاري الإلغاء..." : "تأكيد الإلغاء"}
            </button>
          </div>
        </Modal>
      </div>
    </div>
  );
}
