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
import { listAllIncomeFS, removeIncomeFS, upsertIncomeFS } from "../services/firestoreIncome";
import type { PaymentMethod } from "../types/finance";

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

function getAuthUserSafe(): { displayName: string; email: string } {
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
  paymentMethod?: string;
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

type RefundRecord = {
  incomeId: string;
  bookingId: string;
  amount: number;
  method: PaymentMethod;
  reason: string;
  details: string;
  date: string;
};

type RefundDraft = {
  amount: string;
  method: PaymentMethod;
  reason: string;
  details: string;
  date: string;
};

/* =========================
   Component
========================= */
type DashboardBookingsProps = {
  currentRole?: UiRole;
};

export default function DashboardBookings({ currentRole = "guest" }: DashboardBookingsProps) {
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
  const [refundBusyId, setRefundBusyId] = useState("");
  const [refundMapByBookingId, setRefundMapByBookingId] = useState<Record<string, RefundRecord>>({});
  const [refundTarget, setRefundTarget] = useState<Booking | null>(null);
  const [refundSaving, setRefundSaving] = useState(false);
  const [refundError, setRefundError] = useState("");
  const [refundDraft, setRefundDraft] = useState<RefundDraft>({
    amount: "",
    method: "transfer",
    reason: "",
    details: "",
    date: new Date().toISOString().slice(0, 10),
  });
  const saveHintTimerRef = useRef<number | null>(null);

  const uiRole = currentRole;
  const authUser = getAuthUserSafe();
  const closeBookingModal = useCallback(() => setSelectedBooking(null), []);
  const closeCancelModal = useCallback(() => setCancelTarget(null), []);
  const closeRefundModal = useCallback(() => {
    if (refundSaving) return;
    setRefundTarget(null);
    setRefundError("");
  }, [refundSaving]);

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

  const loadRefundState = useCallback(async () => {
    const incomeRows = await listAllIncomeFS();
    const next: Record<string, RefundRecord> = {};
    incomeRows.forEach((x) => {
      const bookingId = String(x.bookingId || "").trim();
      if (!bookingId) return;
      if (Number(x.amount || 0) >= 0) return;
      const source = String(x.source || "").trim().toLowerCase();
      if (source !== "استرجاع" && source !== "refund") return;
      const noteRaw = String(x.note || "").trim();
      const noteWithoutPrefix = noteRaw.replace(/^استرجاع للحجز\s+[^\-]+-\s*/i, "");
      const [reason, details] = noteWithoutPrefix
        .split("|")
        .map((p) => String(p || "").trim());
      next[bookingId] = {
        incomeId: String(x.id || `refund_${bookingId}`),
        bookingId,
        amount: Math.abs(Number(x.amount || 0)),
        method: (String(x.method || "").trim() as PaymentMethod) || "transfer",
        reason: reason || noteWithoutPrefix || noteRaw,
        details: details || "",
        date: String(x.date || ""),
      };
    });
    setRefundMapByBookingId(next);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadRefundState();
      } catch {
        if (!cancelled) setRefundMapByBookingId({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadRefundState]);

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
    const searchRaw = String(q || "").trim().toLowerCase();
    const searchDigits = digitsOnly(searchRaw);
    if (search || searchRaw) {
      list = list.filter((b) => {
        const name = normalizeArabicName(b.customerName || "");
        const phone = (b.phone || "").toLowerCase();
        const emp = normalizeArabicName(b.employeeName || "");
        const ref = bookingRef(b).toLowerCase();
        const refDigits = digitsOnly(ref);
        return (
          (search ? name.includes(search) || emp.includes(search) : false) ||
          phone.includes(searchRaw) ||
          ref.includes(searchRaw) ||
          (!!searchDigits && refDigits.includes(searchDigits))
        );
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

  const canManageRefund = (b: Booking) => {
    if (!(uiRole === "owner" || uiRole === "admin" || uiRole === "reception")) return false;
    if (!(b.status === "confirmed" || b.status === "completed")) return false;
    const amount = Number(b.finalPrice || b.total || 0);
    if (!Number.isFinite(amount) || amount <= 0) return false;
    return true;
  };

  const detectPaymentMethod = (b: Booking): PaymentMethod => {
    const stored = String((b as any)?.paymentMethod || "").toLowerCase().trim();
    if (stored === "card" || stored === "cash" || stored === "transfer") {
      return stored as PaymentMethod;
    }
    const s = String((b as any)?.note || "").toLowerCase();
    if (s.includes("شبكة") || s.includes("مدى") || s.includes("card")) return "card";
    if (s.includes("تحويل") || s.includes("transfer")) return "transfer";
    if (s.includes("كاش") || s.includes("cash") || s.includes("نقد")) return "cash";
    return "transfer";
  };

  const openRefundModal = (b: Booking) => {
    if (!canManageRefund(b)) return;
    const bookingId = String(b.id || "").trim();
    const existing = refundMapByBookingId[bookingId];
    const bookingAmount = Number(b.finalPrice || b.total || 0);
    const fallbackMethod = detectPaymentMethod(b);
    setRefundDraft({
      amount: existing ? String(existing.amount || "") : String(Math.abs(bookingAmount || 0)),
      method: existing?.method || fallbackMethod || "transfer",
      reason: existing?.reason || "",
      details: existing?.details || "",
      date: existing?.date || new Date().toISOString().slice(0, 10),
    });
    setRefundError("");
    setRefundTarget(b);
  };

  const handleSaveRefund = async () => {
    const b = refundTarget;
    if (!b) return;
    const bookingId = String(b.id || "").trim();
    if (!bookingId || !canManageRefund(b)) return;

    const bookingAmount = Number(b.finalPrice || b.total || 0);
    const amountInput = Number(refundDraft.amount || 0);
    if (!Number.isFinite(amountInput) || amountInput <= 0) {
      setRefundError("أدخل مبلغ استرجاع صحيح.");
      return;
    }
    if (amountInput > bookingAmount) {
      setRefundError("مبلغ الاسترجاع لا يمكن أن يتجاوز قيمة الحجز.");
      return;
    }
    const reason = String(refundDraft.reason || "").trim();
    if (!reason) {
      setRefundError("سبب الاسترجاع مطلوب.");
      return;
    }
    const details = String(refundDraft.details || "").trim();
    const note = details ? `${reason} | ${details}` : reason;
    const method = (refundDraft.method || "transfer") as PaymentMethod;
    const refundAmount = -Math.abs(amountInput);

    try {
      setRefundBusyId(bookingId);
      setRefundSaving(true);
      setRefundError("");
      await upsertIncomeFS({
        id: `refund_${bookingId}`,
        date: refundDraft.date || new Date().toISOString().slice(0, 10),
        amount: refundAmount,
        method,
        source: "استرجاع",
        note: `استرجاع للحجز ${bookingRef(b)} - ${note}`,
        bookingId,
        createdAt: Date.now(),
      });
      await loadRefundState();
      setRefundTarget(null);
    } catch {
      setRefundError("تعذر تسجيل الاسترجاع.");
    } finally {
      setRefundSaving(false);
      setRefundBusyId("");
    }
  };

  const handleCancelRefund = async () => {
    const b = refundTarget;
    if (!b) return;
    const bookingId = String(b.id || "").trim();
    const existing = refundMapByBookingId[bookingId];
    if (!existing?.incomeId) return;
    try {
      setRefundBusyId(bookingId);
      setRefundSaving(true);
      setRefundError("");
      await removeIncomeFS(existing.incomeId);
      await loadRefundState();
      setRefundTarget(null);
    } catch {
      setRefundError("تعذر إلغاء الاسترجاع.");
    } finally {
      setRefundSaving(false);
      setRefundBusyId("");
    }
  };

  const activeRefundForTarget = refundTarget
    ? refundMapByBookingId[String(refundTarget.id || "").trim()] || null
    : null;

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
                placeholder="اسم، هاتف، موظفة، أو رقم الحجز (MK)..." 
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
                    const safeStatus = (["pending", "confirmed", "completed", "cancelled"] as const).includes(
                      b.status as any
                    )
                      ? (b.status as BookingStatus)
                      : "pending";
                    rows.push(
                      <tr key={b.id} className={`bk-row bk-row-${safeStatus}`}>
                        <td>
                          <div className="bk-ref-cell">
                            <div className="bk-ref-code">{bookingRef(b)}</div>
                            <span className={`status-badge ${safeStatus}`}>{statusLabel[safeStatus]}</span>
                          </div>
                        </td>
                        <td>
                          <div className="bk-customer-name">{b.customerName || "—"}</div>
                          <div className="bk-customer-phone">{b.phone || "—"}</div>
                        </td>
                        <td>
                          <div className="bk-service-main">{serviceSummaryForTable(b)}</div>
                          <div className="bk-service-meta">{serviceMetaSummaryForTable(b)}</div>
                        </td>
                        <td>
                          <span className="bk-employee-pill">{b.employeeName || "—"}</span>
                        </td>
                        <td>
                          <div className="bk-datetime-date">{b.date}</div>
                          <div className="bk-datetime-time">{formatTime12(b.time)}</div>
                        </td>
                        <td>
                          <div className="bk-update-by">{lastUpdateMap[b.id]?.by || "—"}</div>
                          <div className="bk-update-at">{lastUpdateMap[b.id]?.at || "—"}</div>
                        </td>
                        <td>
                          <span className="bk-price-pill">{b.finalPrice || b.total || 0} ر.س</span>
                        </td>
                        <td className="bk-actions-cell">
                          <div className="bk-actions-row">
                            <button className="exp-btn ghost sm bk-info-btn" onClick={() => setSelectedBooking(b)} aria-label="تفاصيل الحجز">
                              <FontAwesomeIcon icon={faCircleInfo} />
                            </button>
                            <button
                              className="exp-btn ghost sm bk-refund-btn"
                              onClick={() => openRefundModal(b)}
                              disabled={!canManageRefund(b) || refundBusyId === b.id}
                              title={refundMapByBookingId[String(b.id || "").trim()] ? "تعديل/إلغاء الاسترجاع" : "تسجيل استرجاع"}
                            >
                              {refundMapByBookingId[String(b.id || "").trim()] ? "الاسترجاع" : "استرجاع"}
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
                                  className={`bk-select sm bk-owner-status-select bk-owner-status-compact bk-owner-status-${b.status}`}
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
                  <div key={b.id} className={`bk-mobile-card bk-mobile-card-${b.status || "pending"}`}>
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
                      <span className="bk-mobile-label">الحالة:</span>
                      <span className={`status-badge ${b.status}`}>{statusLabel[b.status]}</span>
                    </div>
                    <div className="bk-mobile-actions">
                       <button className="exp-btn ghost sm w-100" onClick={() => setSelectedBooking(b)}>تفاصيل</button>
                       <button
                         className="exp-btn ghost sm w-100 bk-refund-btn"
                         onClick={() => openRefundModal(b)}
                         disabled={!canManageRefund(b) || refundBusyId === b.id}
                       >
                         {refundMapByBookingId[String(b.id || "").trim()] ? "الاسترجاع" : "استرجاع"}
                       </button>
                       {uiRole === "owner" && (
                         <>
                           <button className="exp-btn danger sm w-100" onClick={() => handleDeleteBooking(b)}>
                             حذف نهائي
                           </button>
                           <select
                             className={`bk-select sm bk-owner-status-select bk-owner-status-compact bk-owner-status-${b.status}`}
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
              {canManageRefund(selectedBooking) && (
                <button className="exp-btn ghost" onClick={() => openRefundModal(selectedBooking)}>
                  {refundMapByBookingId[String(selectedBooking.id || "").trim()]
                    ? "إدارة الاسترجاع"
                    : "تسجيل استرجاع"}
                </button>
              )}
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
          open={!!refundTarget}
          onClose={closeRefundModal}
          ariaLabel="الاسترجاع"
          panelClassName="bk-refund-modal"
          size="sm"
        >
          <div className="bk-cancel-head">إدارة الاسترجاع</div>
          <div className="bk-cancel-body">
            <div className="bk-cancel-meta">
              <span>رقم الحجز: {bookingRef(refundTarget)}</span>
              <span>العميلة: {refundTarget?.customerName || "—"}</span>
              <span>قيمة الحجز: {refundTarget ? Number(refundTarget.finalPrice || refundTarget.total || 0) : 0} ر.س</span>
            </div>

            <div className={`bk-refund-status ${activeRefundForTarget ? "is-refunded" : "is-none"}`}>
              {activeRefundForTarget ? (
                <>
                  <strong>حالة الاسترجاع: تم الاسترجاع</strong>
                  <span>
                    المبلغ: {Number(activeRefundForTarget.amount || 0).toLocaleString()} ر.س
                    {" • "}
                    الطريقة: {activeRefundForTarget.method === "transfer" ? "تحويل" : activeRefundForTarget.method === "card" ? "شبكة" : "كاش"}
                    {" • "}
                    التاريخ: {activeRefundForTarget.date || "—"}
                  </span>
                </>
              ) : (
                <>
                  <strong>حالة الاسترجاع: غير مسترجع</strong>
                  <span>لا يوجد استرجاع مسجل لهذا الحجز حالياً.</span>
                </>
              )}
            </div>

            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
              <label>
                <div style={{ fontSize: 13, marginBottom: 4 }}>مبلغ الاسترجاع</div>
                <input
                  type="number"
                  className="bk-input"
                  value={refundDraft.amount}
                  onChange={(e) => setRefundDraft((p) => ({ ...p, amount: e.target.value }))}
                  placeholder="مثال: 120"
                  disabled={refundSaving}
                />
              </label>

              <label>
                <div style={{ fontSize: 13, marginBottom: 4 }}>طريقة الاسترجاع</div>
                <select
                  className="bk-select"
                  value={refundDraft.method}
                  onChange={(e) =>
                    setRefundDraft((p) => ({ ...p, method: e.target.value as PaymentMethod }))
                  }
                  disabled={refundSaving}
                >
                  <option value="transfer">تحويل</option>
                  <option value="cash">كاش</option>
                  <option value="card">شبكة</option>
                </select>
              </label>

              <label>
                <div style={{ fontSize: 13, marginBottom: 4 }}>تاريخ الاسترجاع</div>
                <input
                  type="date"
                  className="bk-input"
                  value={refundDraft.date}
                  onChange={(e) => setRefundDraft((p) => ({ ...p, date: e.target.value }))}
                  disabled={refundSaving}
                />
              </label>

              <label>
                <div style={{ fontSize: 13, marginBottom: 4 }}>سبب الاسترجاع</div>
                <input
                  type="text"
                  className="bk-input"
                  value={refundDraft.reason}
                  onChange={(e) => setRefundDraft((p) => ({ ...p, reason: e.target.value }))}
                  placeholder="مثال: إلغاء قبل الموعد"
                  disabled={refundSaving}
                />
              </label>

              <label>
                <div style={{ fontSize: 13, marginBottom: 4 }}>تفاصيل إضافية</div>
                <textarea
                  className="bk-input"
                  rows={3}
                  value={refundDraft.details}
                  onChange={(e) => setRefundDraft((p) => ({ ...p, details: e.target.value }))}
                  placeholder="أي تفاصيل داخلية للاسترجاع"
                  disabled={refundSaving}
                />
              </label>
            </div>

            {refundError ? (
              <div style={{ color: "#b42318", marginTop: 10, fontSize: 13 }}>{refundError}</div>
            ) : null}
          </div>
          <div className="bk-cancel-foot">
            <button
              type="button"
              className="exp-btn ghost"
              onClick={closeRefundModal}
              disabled={refundSaving}
            >
              رجوع
            </button>
            {refundTarget && refundMapByBookingId[String(refundTarget.id || "").trim()] ? (
              <button
                type="button"
                className="exp-btn danger"
                onClick={handleCancelRefund}
                disabled={refundSaving}
                title="يمكن التراجع عن الاسترجاع من هنا"
              >
                {refundSaving ? "جاري الإلغاء..." : "إلغاء الاسترجاع"}
              </button>
            ) : null}
            <button
              type="button"
              className="exp-btn"
              onClick={handleSaveRefund}
              disabled={refundSaving}
            >
              {refundSaving ? "جاري الحفظ..." : "حفظ الاسترجاع"}
            </button>
          </div>
        </Modal>

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
