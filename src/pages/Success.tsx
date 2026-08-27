// src/pages/Success.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import "../styles/SuccessMobile.css";
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
  faLayerGroup,
  faTags,
  faArrowRight,
  faCopy,
  faCircleCheck,
} from "@fortawesome/free-solid-svg-icons";
import { faWhatsapp } from "@fortawesome/free-brands-svg-icons";
import LoadingBrand from "../components/LoadingBrand";
import { readBookingTotalAmount } from "../helpers/bookingPaymentUtils";
import { printPackageDocument } from "../components/packages/packageFormat";

import { auth } from "../services/firebase";
import { CoreBookingService } from "../services/CoreBookingService";
import { ClientPortalService } from "../services/ClientPortalService";
import type { CoreBooking } from "../types/coreApi";
import type { ClientPortalBooking } from "../services/ClientPortalService";

/* =========================
   Types & Const
========================= */

type UiBookingView = {
  id: string; // داخلي فقط
  publicId?: string; // MK-xxxx للعرض
  bookingPublicId?: string;
  groupId?: string;
  parentId?: string;

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
  trackId?: string;
  publicId?: string;
  bookingPublicId?: string;
  groupId?: string;
  parentId?: string;
};

type LocalBookingSnapshot = {
  id?: string;
  bookingId?: string;
  trackId?: string;
  publicId?: string;
  clientName?: string;
  customerName?: string;
  name?: string;
  clientPhone?: string;
  customerPhone?: string;
  phone?: string;
  serviceId?: string;
  serviceName?: string;
  service?: string;
  employeeName?: string;
  employee?: string;
  date?: string;
  time?: string;
  total?: number;
  finalPrice?: number;
  status?: string;
  [key: string]: any;
};

type SuccessMode = "created" | "updated";
type SuccessLocationState = {
  mode?: SuccessMode;
  action?: string;
  updated?: boolean;
  isUpdate?: boolean;
  bookings?: LocalBookingSnapshot[];
  allBookings?: LocalBookingSnapshot[];
  bookingRefs?: LocalBookingRef[];
  allBookingRefs?: LocalBookingRef[];
  packageReceipt?: boolean;
  settlementLabel?: string;
  packageName?: string;
  packageBalanceBefore?: number;
  packageBalanceAfter?: number;
};

const BOOKING_KEY = "currentBooking";
const ALL_BOOKINGS_KEY = "allBookings";
const SUCCESS_MODE_KEY = "booking_success_mode";

const SALON_ID = "main";
const SALON_WHATSAPP = "966548440401";
const SALON_IBAN = "SA4710000001400007036306";

function shouldDebugSuccess(search: string) {
  try {
    const params = new URLSearchParams(String(search || ""));
    const flag = String(params.get("debugSuccess") || "").trim().toLowerCase();
    if (flag === "1" || flag === "true") return true;
  } catch {
    // ignore query parsing issues
  }

  try {
    const flag = String(localStorage.getItem("debug_success_page") || "").trim().toLowerCase();
    if (flag === "1" || flag === "true") return true;
  } catch {
    // ignore localStorage issues
  }

  return Boolean(import.meta.env?.DEV);
}

function logSuccessDebug(enabled: boolean, event: string, payload?: unknown) {
  if (!enabled) return;
  if (payload === undefined) {
    console.info(`[SuccessDebug] ${event}`);
    return;
  }
  console.info(`[SuccessDebug] ${event}`, payload);
}

function debugErrorInfo(error: unknown) {
  if (!error) return null;
  const err = error as Record<string, any>;
  return {
    name: String(err?.name || ""),
    code: String(err?.code || ""),
    message: String(err?.message || ""),
  };
}

/* =========================
   Helpers
========================= */

function normalizeMk(raw: string) {
  const s = String(raw || "").trim().toUpperCase();
  const digits = s.match(/\d{3,}/)?.[0] || "";
  if (!digits) return "";
  return `MK-${digits}`;
}

function normalizeMkLookup(raw: string) {
  const src = toEnglishDigits(String(raw || ""))
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!src) return "";
  const mk = src.match(/^MK-?(\d{3,})$/i);
  if (mk?.[1]) return `MK-${mk[1]}`;
  if (/^\d{3,}$/.test(src)) return `MK-${src}`;
  return "";
}

function asIdKey(raw: any) {
  const id = String(raw || "").trim();
  return id ? `id:${id}` : "";
}

function asMkKey(raw: any) {
  const mk = normalizeMkLookup(String(raw || ""));
  return mk ? `mk:${mk}` : "";
}

function collectSnapshotKeys(row: LocalBookingSnapshot): string[] {
  const keys = new Set<string>();

  [row?.id, row?.bookingId, row?.trackId, row?.groupId, row?.parentId].forEach((v) => {
    const k = asIdKey(v);
    if (k) keys.add(k);
  });

  [
    row?.publicId,
    row?.bookingPublicId,
    row?.id,
    row?.bookingId,
    row?.trackId,
  ].forEach((v) => {
    const k = asMkKey(v);
    if (k) keys.add(k);
  });

  return Array.from(keys);
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
  const raw = toEnglishDigits(String(time24 || "").trim());
  const m = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return raw || "-";
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

function toEnglishDigits(input: string) {
  const arabicIndic = "٠١٢٣٤٥٦٧٨٩";
  const easternArabic = "۰۱۲۳۴۵۶۷۸۹";
  return String(input || "")
    .replace(/[٠-٩]/g, (d) => String(arabicIndic.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(easternArabic.indexOf(d)));
}

function normalizeDisplayValue(value: string) {
  return toEnglishDigits(String(value || "")).replace(/\s+/g, " ").trim();
}

function isDisplayPlaceholder(value: string) {
  const v = normalizeDisplayValue(value);
  if (!v) return true;
  if (v === "-" || v === "—") return true;
  if (v === "غير محدد") return true;
  if (v === "تعيين تلقائي") return true;
  return false;
}

function uniqueDisplayValues(values: Array<string | undefined | null>) {
  const out: string[] = [];
  const seen = new Set<string>();

  values.forEach((raw) => {
    const v = normalizeDisplayValue(String(raw ?? ""));
    if (isDisplayPlaceholder(v)) return;
    const key = v.toLocaleLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(v);
  });

  return out;
}

function formatDisplayValues(values: string[], mode: "inline" | "stack" = "stack") {
  if (!values.length) return "—";
  if (values.length === 1) return values[0];
  if (mode === "inline") return values.join("،\u00A0\u00A0\u00A0");
  return values.map((v, idx) => `${idx + 1}. ${v}`).join("\n");
}

function formatDateForClient(dateRaw: string) {
  const s = normalizeDisplayValue(dateRaw);
  if (!s || s === "-" || s === "—") return "—";

  let d: Date | null = null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]) - 1;
    const day = Number(iso[3]);
    d = new Date(y, m, day, 12, 0, 0);
  } else {
    const parsed = Date.parse(s);
    if (Number.isFinite(parsed)) d = new Date(parsed);
  }

  if (!d || Number.isNaN(d.getTime())) return s;

  try {
    const gregorian = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    }).format(d);

    let hijri = "";
    try {
      hijri = new Intl.DateTimeFormat("ar-SA-u-ca-islamic-umalqura-nu-latn", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      }).format(d);
    } catch {
      hijri = "";
    }

    const g = toEnglishDigits(gregorian);
    const h = toEnglishDigits(hijri);
    if (!h || h === g) return g;
    return `${g} | ${h}`;
  } catch {
    return s;
  }
}

function formatNumberEn(value: number) {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("en-US").format(value);
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

function isMissingMergeValue(value: any) {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") {
    const normalized = normalizeDisplayValue(value);
    if (!normalized) return true;
    if (isDisplayPlaceholder(normalized)) return true;
  }
  return false;
}

function mergeWithLocalFallback(
  rawDoc: Record<string, any> | null | undefined,
  localHint: LocalBookingSnapshot | null | undefined
) {
  const merged: Record<string, any> = { ...(rawDoc || {}) };
  if (!localHint || typeof localHint !== "object") return merged;

  for (const [key, localValue] of Object.entries(localHint)) {
    if (isMissingMergeValue(merged[key])) {
      merged[key] = localValue;
    }
  }

  const mergeNested = (field: "serviceSnapshot" | "packageSnapshot") => {
    const localObj = (localHint as any)?.[field];
    if (!localObj || typeof localObj !== "object") return;

    const base: Record<string, any> =
      merged[field] && typeof merged[field] === "object" ? { ...merged[field] } : {};

    for (const [k, v] of Object.entries(localObj)) {
      if (isMissingMergeValue(base[k])) base[k] = v;
    }
    merged[field] = base;
  };

  mergeNested("serviceSnapshot");
  mergeNested("packageSnapshot");

  return merged;
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

function mergeBookingRefs(refs: LocalBookingRef[]) {
  const out: LocalBookingRef[] = [];
  const seen = new Set<string>();

  for (const row of refs) {
    const id = String(row?.id || "").trim();
    const bookingId = String(row?.bookingId || "").trim();
    const trackId = String(row?.trackId || "").trim();
    const publicId = String(row?.publicId || "").trim();
    const bookingPublicId = String(row?.bookingPublicId || "").trim();
    const groupId = String(row?.groupId || "").trim();
    const parentId = String(row?.parentId || "").trim();
    const key = `${id}|${bookingId}|${trackId}|${publicId}|${bookingPublicId}|${groupId}|${parentId}`.toLowerCase();
    if (!id && !bookingId && !trackId && !publicId && !bookingPublicId && !groupId && !parentId) continue;
    if (seen.has(key)) continue;

    seen.add(key);
    out.push({
      id: id || undefined,
      bookingId: bookingId || undefined,
      trackId: trackId || undefined,
      publicId: publicId || undefined,
      bookingPublicId: bookingPublicId || undefined,
      groupId: groupId || undefined,
      parentId: parentId || undefined,
    });
  }

  return out;
}

function splitRefValues(raw: string) {
  return String(raw || "")
    .split(/[,\s|;]+/g)
    .map((x) => String(x || "").trim())
    .filter(Boolean);
}

function readQueryBookingRefs(search: string): LocalBookingRef[] {
  try {
    const params = new URLSearchParams(String(search || ""));
    const refs: LocalBookingRef[] = [];

    const addRef = (partial: LocalBookingRef) => {
      refs.push({
        id: String(partial?.id || "").trim() || undefined,
        bookingId: String(partial?.bookingId || "").trim() || undefined,
        trackId: String(partial?.trackId || "").trim() || undefined,
        publicId: String(partial?.publicId || "").trim() || undefined,
        bookingPublicId: String(partial?.bookingPublicId || "").trim() || undefined,
        groupId: String(partial?.groupId || "").trim() || undefined,
        parentId: String(partial?.parentId || "").trim() || undefined,
      });
    };

    addRef({
      id: params.get("id") || undefined,
      bookingId: params.get("bookingId") || params.get("booking_id") || undefined,
      trackId: params.get("trackId") || params.get("track_id") || undefined,
      publicId: params.get("publicId") || params.get("public_id") || params.get("mk") || undefined,
      bookingPublicId: params.get("bookingPublicId") || undefined,
      groupId: params.get("groupId") || undefined,
      parentId: params.get("parentId") || undefined,
    });

    const multiGroupIds = [
      ...splitRefValues(params.get("groupIds") || ""),
    ];
    multiGroupIds.forEach((gid) => addRef({ groupId: gid, parentId: gid }));

    const multiPublic = [
      ...splitRefValues(params.get("publicIds") || ""),
      ...splitRefValues(params.get("public_ids") || ""),
      ...splitRefValues(params.get("mks") || ""),
    ];
    multiPublic.forEach((mk) => addRef({ publicId: mk }));

    const multiIds = [
      ...splitRefValues(params.get("bookingIds") || ""),
      ...splitRefValues(params.get("booking_ids") || ""),
      ...splitRefValues(params.get("ids") || ""),
    ];
    multiIds.forEach((id) => addRef({ id, bookingId: id, trackId: id }));

    return mergeBookingRefs(refs);
  } catch {
    return [];
  }
}

function readStateBookingRefs(state: unknown): LocalBookingRef[] {
  try {
    const raw = (state || {}) as Record<string, any>;
    const refs: LocalBookingRef[] = [];

    const addRef = (partial: LocalBookingRef) => {
      refs.push({
        id: String(partial?.id || "").trim() || undefined,
        bookingId: String(partial?.bookingId || "").trim() || undefined,
        trackId: String(partial?.trackId || "").trim() || undefined,
        publicId: String(partial?.publicId || "").trim() || undefined,
        bookingPublicId: String(partial?.bookingPublicId || "").trim() || undefined,
        groupId: String(partial?.groupId || "").trim() || undefined,
        parentId: String(partial?.parentId || "").trim() || undefined,
      });
    };

    addRef({
      id: raw?.id,
      bookingId: raw?.bookingId || raw?.booking_id,
      trackId: raw?.trackId || raw?.track_id,
      publicId: raw?.publicId || raw?.public_id || raw?.mk,
      bookingPublicId: raw?.bookingPublicId,
      groupId: raw?.groupId,
      parentId: raw?.parentId,
    });

    const refRows = Array.isArray(raw?.bookingRefs)
      ? raw.bookingRefs
      : Array.isArray(raw?.allBookingRefs)
        ? raw.allBookingRefs
        : [];

    refRows.forEach((row: any) =>
      addRef({
        id: row?.id,
        bookingId: row?.bookingId,
        trackId: row?.trackId,
        publicId: row?.publicId || row?.mk,
        bookingPublicId: row?.bookingPublicId,
        groupId: row?.groupId || row?.bookingGroupId,
        parentId: row?.parentId || row?.bookingGroupId,
      })
    );

    const rows = Array.isArray(raw?.bookings)
      ? raw.bookings
      : Array.isArray(raw?.allBookings)
        ? raw.allBookings
        : [];

    rows.forEach((row: any) =>
      addRef({
        id: row?.id,
        bookingId: row?.bookingId,
        trackId: row?.trackId,
        publicId: row?.publicId || row?.mk,
        bookingPublicId: row?.bookingPublicId,
        groupId: row?.groupId || row?.bookingGroupId,
        parentId: row?.parentId || row?.bookingGroupId,
      })
    );

    return mergeBookingRefs(refs);
  } catch {
    return [];
  }
}

function readStateBookingSnapshots(state: unknown): LocalBookingSnapshot[] {
  try {
    const raw = (state || {}) as Record<string, any>;
    const rows = Array.isArray(raw?.bookings)
      ? raw.bookings
      : Array.isArray(raw?.allBookings)
        ? raw.allBookings
        : [];

    return rows.filter((row) => row && typeof row === "object") as LocalBookingSnapshot[];
  } catch {
    return [];
  }
}

/** اقرأ allBookings (الجديد) ثم fallback لـ currentBooking (قديم) */
function readLocalBookingRefs(): LocalBookingRef[] {
  const refs: LocalBookingRef[] = [];

  // 1) allBookings
  try {
    const rawAll = localStorage.getItem(ALL_BOOKINGS_KEY);
    const parsedAll = rawAll ? JSON.parse(rawAll) : null;

    if (Array.isArray(parsedAll) && parsedAll.length) {
      refs.push(
        ...parsedAll.map((x: any) => ({
          id: x?.id,
          bookingId: x?.bookingId,
          trackId: x?.trackId,
          publicId: x?.publicId,
          bookingPublicId: x?.bookingPublicId,
          groupId: x?.groupId,
          parentId: x?.parentId,
        }))
      );
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
      trackId: parsed?.trackId,
      publicId: parsed?.publicId,
      bookingPublicId: parsed?.bookingPublicId,
      groupId: parsed?.groupId,
      parentId: parsed?.parentId,
    };
    refs.push(one);
  } catch {
    // ignore
  }

  return mergeBookingRefs(refs).filter((x) =>
    !!String(
      x?.id ||
      x?.bookingId ||
      x?.trackId ||
      x?.publicId ||
      x?.bookingPublicId ||
      x?.groupId ||
      x?.parentId ||
      ""
    ).trim()
  );
}

function readLocalBookingSnapshots(): LocalBookingSnapshot[] {
  const rows: LocalBookingSnapshot[] = [];

  try {
    const rawAll = localStorage.getItem(ALL_BOOKINGS_KEY);
    const parsedAll = rawAll ? JSON.parse(rawAll) : null;
    if (Array.isArray(parsedAll)) {
      parsedAll.forEach((row: any) => {
        if (row && typeof row === "object") rows.push(row as LocalBookingSnapshot);
      });
    }
  } catch {
    // ignore
  }

  try {
    const rawOne = localStorage.getItem(BOOKING_KEY);
    const parsedOne = rawOne ? JSON.parse(rawOne) : null;
    if (parsedOne && typeof parsedOne === "object") {
      rows.push(parsedOne as LocalBookingSnapshot);
    }
  } catch {
    // ignore
  }

  return rows;
}

function buildLocalBookingSnapshotIndex(rows: LocalBookingSnapshot[]) {
  const idx = new Map<string, LocalBookingSnapshot>();
  rows.forEach((row) => {
    collectSnapshotKeys(row).forEach((k) => {
      if (!idx.has(k)) idx.set(k, row);
    });
  });
  return idx;
}

function resolveLocalSnapshotForRef(
  ref: LocalBookingRef | null | undefined,
  idx: Map<string, LocalBookingSnapshot>
): LocalBookingSnapshot | null {
  if (!ref) return null;
  const keys = new Set<string>();
  [ref?.id, ref?.bookingId, ref?.trackId, ref?.groupId, ref?.parentId].forEach((v) => {
    const k = asIdKey(v);
    if (k) keys.add(k);
  });

  [
    ref?.publicId,
    ref?.bookingPublicId,
    ref?.id,
    ref?.bookingId,
    ref?.trackId,
  ].forEach((v) => {
    const k = asMkKey(v);
    if (k) keys.add(k);
  });
  for (const k of keys) {
    const row = idx.get(k);
    if (row) return row;
  }
  return null;
}

function readSuccessModeFromStorage(): SuccessMode {
  const raw = String(localStorage.getItem(SUCCESS_MODE_KEY) || "").trim().toLowerCase();
  return raw === "updated" ? "updated" : "created";
}

function resolveSuccessModeFromLocation(state: unknown): SuccessMode | null {
  const raw = (state || {}) as SuccessLocationState;
  if (raw.mode === "updated" || raw.mode === "created") return raw.mode;

  const action = String(raw.action || "").trim().toLowerCase();
  if (action === "update" || action === "updated" || action === "reschedule" || action === "rescheduled") {
    return "updated";
  }

  if (raw.updated === true || raw.isUpdate === true) return "updated";
  return null;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export default function Success() {
  const navigate = useNavigate();
  const location = useLocation();
  const debugEnabled = useMemo(() => shouldDebugSuccess(location.search), [location.search]);
  const locationSuccessMode = useMemo(
    () => resolveSuccessModeFromLocation(location.state),
    [location.state]
  );
  const successMode: SuccessMode = locationSuccessMode || readSuccessModeFromStorage();

  const [loading, setLoading] = useState(true);
  const [views, setViews] = useState<UiBookingView[]>([]);
  const [error, setError] = useState("");

  const [toastMsg, setToastMsg] = useState<string>("");
  const [toastType, setToastType] = useState<"success" | "error">("success");

  const activeRunRef = useRef(0);
  const resolvedOnceRef = useRef(false);

  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToastMsg(msg);
    setToastType(type);
    window.clearTimeout((showToast as any)._t);
    (showToast as any)._t = window.setTimeout(() => setToastMsg(""), 1600);
  };

  useEffect(() => {
    localStorage.setItem(SUCCESS_MODE_KEY, successMode);
  }, [successMode]);

  const queryBookingRefs = useMemo(() => readQueryBookingRefs(location.search), [location.search]);
  const stateBookingRefs = useMemo(() => readStateBookingRefs(location.state), [location.state]);
  const stateBookingSnapshots = useMemo(
    () => readStateBookingSnapshots(location.state),
    [location.state]
  );
  const storedBookingRefs = useMemo(
    () => readLocalBookingRefs(),
    [location.key, location.search, location.state]
  );
  const explicitBookingRefs = useMemo(
    () => mergeBookingRefs([...queryBookingRefs, ...stateBookingRefs]),
    [queryBookingRefs, stateBookingRefs]
  );
  const bookingRefs = explicitBookingRefs.length ? explicitBookingRefs : storedBookingRefs;

  useEffect(() => {
    logSuccessDebug(debugEnabled, "page.load", {
      pathname: location.pathname,
      search: location.search,
      state: location.state,
      successMode,
      queryBookingRefs,
      stateBookingRefs,
      stateBookingSnapshotCount: stateBookingSnapshots.length,
      storedBookingRefs,
      selectedBookingRefs: bookingRefs,
      usingExplicitRefs: explicitBookingRefs.length > 0,
    });
  }, [
    bookingRefs,
    debugEnabled,
    explicitBookingRefs.length,
    location.pathname,
    location.search,
    location.state,
    queryBookingRefs,
    stateBookingRefs,
    stateBookingSnapshots.length,
    storedBookingRefs,
    successMode,
  ]);

  useEffect(() => {
    let mounted = true;
    const runId = ++activeRunRef.current;

    async function run() {
      try {
        if (resolvedOnceRef.current) return;
        setLoading(true);
        setError("");

        const localSnapshots = [
          ...stateBookingSnapshots,
          ...readLocalBookingSnapshots(),
        ];
        const localSnapshotIndex = buildLocalBookingSnapshotIndex(localSnapshots);
        const log = (event: string, payload?: unknown) =>
          logSuccessDebug(debugEnabled, event, payload);

        const normalizeRefTokens = (ref: LocalBookingRef) =>
          Array.from(
            new Set(
              [
                ref.publicId,
                ref.bookingPublicId,
                ref.trackId,
                ref.bookingId,
                ref.id,
              ]
                .map((value) => String(value || "").trim())
                .filter(Boolean)
            )
          );

        const localHintForBooking = (booking: {
          id?: string;
          publicId?: string | null;
        }) =>
          resolveLocalSnapshotForRef(
            {
              id: booking.id,
              bookingId: booking.id,
              publicId: booking.publicId || undefined,
              bookingPublicId: booking.publicId || undefined,
            },
            localSnapshotIndex
          );

        const localHintForItem = (
          booking: { id?: string; publicId?: string | null },
          item: Record<string, any>,
          fallback?: LocalBookingSnapshot | null
        ) => {
          const serviceId = String(item?.serviceId || "").trim();
          const itemDate = String(item?.bookingDate || "").trim();
          const itemTime = String(item?.startTime || "").trim();
          const publicId = normalizeMkLookup(String(booking.publicId || ""));
          const exact = localSnapshots.find((row) => {
            const rowPublic = normalizeMkLookup(
              String(row?.publicId || row?.bookingPublicId || "")
            );
            const rowService = String(row?.serviceId || "").trim();
            const rowDate = String(row?.date || "").trim();
            const rowTime = String(row?.time || "").trim();
            return (
              (!publicId || !rowPublic || rowPublic === publicId) &&
              (!serviceId || !rowService || rowService === serviceId) &&
              (!itemDate || !rowDate || rowDate === itemDate) &&
              (!itemTime || !rowTime || rowTime === itemTime)
            );
          });
          return exact || fallback || null;
        };

        const packageServicesFromHint = (hint?: LocalBookingSnapshot | null) =>
          Array.isArray(hint?.packageSnapshot?.services)
            ? hint!.packageSnapshot.services
                .map((x: any) => ({
                  serviceName: toArabicLabel(
                    String(x?.serviceName || x?.serviceId || "").trim(),
                    "-"
                  ),
                  sectionLabel:
                    toArabicLabel(
                      String(x?.sectionTitle || x?.sectionId || "").trim(),
                      ""
                    ) || undefined,
                  categoryLabel:
                    toArabicLabel(
                      String(x?.categoryName || x?.categoryId || "").trim(),
                      ""
                    ) || undefined,
                  durationMin: Number.isFinite(Number(x?.durationMin))
                    ? Number(x.durationMin)
                    : undefined,
                  price: Number.isFinite(Number(x?.price))
                    ? Number(x.price)
                    : undefined,
                }))
                .filter((x: any) => Boolean(x.serviceName))
            : [];

        const coreBookingToViews = (booking: CoreBooking): UiBookingView[] => {
          const baseHint = localHintForBooking(booking);
          const items = Array.isArray(booking.items) && booking.items.length
            ? booking.items
            : ([{}] as any[]);

          return items.map((item: any, index: number) => {
            const hint = localHintForItem(booking, item, baseHint);
            const hintSnapshot = (hint || {}) as Record<string, any>;
            const serviceSnapshot = (hintSnapshot.serviceSnapshot || {}) as Record<string, any>;
            const packageSnapshot = (hintSnapshot.packageSnapshot || {}) as Record<string, any>;
            const itemTotalHalalas = Number(
              item?.finalTotalHalalas ?? item?.totalHalalas ?? 0
            );
            const fallbackTotal = readBookingTotalAmount(hintSnapshot);
            return {
              id: `${booking.id}${item?.id ? `:${item.id}` : `:${index}`}`,
              publicId: String(booking.publicId || hintSnapshot.publicId || "").trim() || undefined,
              bookingPublicId: String(booking.publicId || hintSnapshot.bookingPublicId || "").trim() || undefined,
              clientName:
                String(booking.clientName || hintSnapshot.clientName || hintSnapshot.customerName || "-").trim() || "-",
              clientPhone:
                String(booking.clientPhone || hintSnapshot.clientPhone || hintSnapshot.customerPhone || hintSnapshot.phone || "-").trim() || "-",
              serviceId: String(item?.serviceId || hintSnapshot.serviceId || "").trim(),
              serviceName: toArabicLabel(
                String(
                  item?.serviceNameSnapshot ||
                    hintSnapshot.serviceName ||
                    serviceSnapshot.serviceNameAtBooking ||
                    "-"
                ).trim(),
                "-"
              ),
              sectionLabel:
                toArabicLabel(
                  String(
                    item?.sectionName ||
                      serviceSnapshot.sectionTitleAtBooking ||
                      serviceSnapshot.sectionIdAtBooking ||
                      ""
                  ).trim(),
                  ""
                ) || undefined,
              categoryLabel:
                toArabicLabel(
                  String(
                    item?.categoryName ||
                      serviceSnapshot.categoryNameAtBooking ||
                      serviceSnapshot.categoryIdAtBooking ||
                      ""
                  ).trim(),
                  ""
                ) || undefined,
              packageName:
                toArabicLabel(String(packageSnapshot.packageName || "").trim(), "") || undefined,
              packageServices: packageServicesFromHint(hint),
              employeeName: toArabicLabel(
                String(item?.staffName || booking.staffName || hintSnapshot.employeeName || hintSnapshot.employee || "غير محدد").trim(),
                "غير محدد"
              ),
              date: String(item?.bookingDate || booking.bookingDate || hintSnapshot.date || "-").trim() || "-",
              time: String(item?.startTime || booking.startTime || hintSnapshot.time || "-").trim() || "-",
              total:
                Number.isFinite(itemTotalHalalas) && itemTotalHalalas > 0
                  ? itemTotalHalalas / 100
                  : fallbackTotal,
              status: String(booking.status || hintSnapshot.status || "pending").trim() || "pending",
            };
          });
        };

        const clientBookingToCoreShape = (
          booking: ClientPortalBooking
        ): CoreBooking => ({
          id: booking.id,
          publicId: booking.publicId || null,
          salonId: SALON_ID,
          clientId: booking.clientId,
          clientName: booking.clientName || null,
          clientPhone: booking.clientPhone || null,
          staffId: booking.staffId || null,
          staffName: booking.staffName || null,
          bookingDate: booking.bookingDate,
          startTime: booking.startTime,
          endTime: booking.endTime || null,
          status: booking.status,
          subtotalHalalas: booking.totalHalalas,
          discountHalalas: 0,
          totalHalalas: booking.totalHalalas,
          paymentStatus: booking.paymentStatus,
          paidHalalas: booking.paidHalalas,
          packageSessionsUsed: booking.packageSessionsUsed,
          createdAt: booking.createdAt || "",
          updatedAt: booking.updatedAt || "",
          items: booking.items.map((item) => ({
            id: item.id,
            bookingId: booking.id,
            salonId: SALON_ID,
            serviceId: item.serviceId,
            serviceNameSnapshot: item.serviceName,
            staffId: item.staffId || null,
            staffName: item.staffName || null,
            quantity: item.quantity,
            unitPriceHalalas: item.unitPriceHalalas,
            totalHalalas: item.totalHalalas,
            finalTotalHalalas: item.totalHalalas,
            packageCovered: item.packageCovered,
            clientPackageId: item.clientPackageId || null,
            bookingDate: item.bookingDate || booking.bookingDate,
            startTime: item.startTime || booking.startTime,
            endTime: item.endTime || booking.endTime || null,
            createdAt: booking.createdAt || "",
          })),
        } as CoreBooking);

        let selfBookingsPromise: Promise<ClientPortalBooking[]> | null = null;
        const selfBookings = async () => {
          if (!auth.currentUser?.uid) return [];
          if (!selfBookingsPromise) {
            selfBookingsPromise = ClientPortalService.snapshot()
              .then((snapshot) => snapshot.bookings || [])
              .catch((error) => {
                log("clientSelf.recovery.error", debugErrorInfo(error));
                return [];
              });
          }
          return selfBookingsPromise;
        };

        const resolveRef = async (ref: LocalBookingRef): Promise<CoreBooking | null> => {
          const tokens = normalizeRefTokens(ref);

          for (const token of tokens) {
            const publicId = normalizeMkLookup(token);
            if (!publicId) continue;
            try {
              const tracked = await CoreBookingService.trackPublic(publicId);
              log("core.publicTrack.hit", { incomingId: publicId, bookingId: tracked.id });
              return tracked;
            } catch (error) {
              log("core.publicTrack.miss", { incomingId: publicId, error: debugErrorInfo(error) });
            }
          }

          const mine = await selfBookings();
          if (!mine.length) return null;
          const normalizedPublicCandidates = new Set(
            tokens.map(normalizeMkLookup).filter(Boolean)
          );
          const exact = mine.find((booking) => {
            const id = String(booking.id || "").trim();
            const publicId = normalizeMkLookup(String(booking.publicId || ""));
            return (
              tokens.includes(id) ||
              (publicId && normalizedPublicCandidates.has(publicId))
            );
          });
          return exact ? clientBookingToCoreShape(exact) : null;
        };

        const refs = bookingRefs.length
          ? bookingRefs
          : mergeBookingRefs(
              localSnapshots.map((row) => ({
                id: row.id,
                bookingId: row.bookingId,
                trackId: row.trackId,
                publicId: row.publicId,
                bookingPublicId: row.bookingPublicId,
                groupId: row.groupId,
                parentId: row.parentId,
              }))
            );

        const resolved = new Map<string, CoreBooking>();
        const resolveIntoMap = async () => {
          for (const ref of refs) {
            const booking = await resolveRef(ref);
            if (booking?.id) resolved.set(booking.id, booking);
          }
          if (!refs.length && auth.currentUser?.uid) {
            const mine = await selfBookings();
            const recent = [...mine]
              .sort(
                (a, b) =>
                  Math.max(toMillisSafe(b.createdAt), toMillisSafe(b.updatedAt)) -
                  Math.max(toMillisSafe(a.createdAt), toMillisSafe(a.updatedAt))
              )
              .slice(0, 6);
            for (const booking of recent) {
              resolved.set(booking.id, clientBookingToCoreShape(booking));
            }
          }
        };

        for (let attempt = 1; attempt <= 4; attempt++) {
          resolved.clear();
          await resolveIntoMap();
          if (resolved.size) break;
          if (attempt < 4) await delay(350);
          if (!mounted || runId !== activeRunRef.current) return;
        }

        if (!resolved.size) {
          setError("لم يتم العثور على الحجز في النظام الأساسي");
          return;
        }

        const results = Array.from(resolved.values())
          .flatMap(coreBookingToViews)
          .sort((a, b) => {
            const byDateTime = `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`);
            if (byDateTime !== 0) return byDateTime;
            return `${a.publicId || ""}:${a.serviceId}`.localeCompare(
              `${b.publicId || ""}:${b.serviceId}`
            );
          });

        if (!mounted || runId !== activeRunRef.current) return;
        if (!results.length) {
          setError("لم يتم العثور على تفاصيل الحجز");
          return;
        }

        resolvedOnceRef.current = true;
        setViews(results);
        log("loader.done.core", {
          queryResultCount: results.length,
          finalMappedState: results,
        });
      } catch (e: any) {
        console.error(e);
        logSuccessDebug(debugEnabled, "loader.error", debugErrorInfo(e));
        if (mounted && runId === activeRunRef.current && !resolvedOnceRef.current) {
          setError(e?.message || "صار خطأ أثناء تحميل بيانات الحجز");
        }
      } finally {
        if (mounted && runId === activeRunRef.current) setLoading(false);
      }
    }

    run();
    return () => {
      mounted = false;
    };
  }, [bookingRefs, debugEnabled, stateBookingSnapshots]);

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

  const copyIban = async () => {
    try {
      await navigator.clipboard.writeText(SALON_IBAN);
      showToast("تم نسخ رقم الآيبان ✅", "success");
    } catch {
      showToast("تعذر نسخ رقم الآيبان", "error");
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

  const first = views[0];
  const st = normStatus(first?.status || "pending");
  const isConfirmed = st === "confirmed" || first?.status === "مؤكد";

  const heroTitle =
    successMode === "updated"
      ? views.length > 1
        ? "تم تحديث مواعيد الخدمات بنجاح"
        : "تم تحديث موعد الخدمة بنجاح"
      : views.length > 1
        ? isConfirmed
          ? "تم تأكيد حجوزاتك بنجاح"
          : "تم استلام طلب حجوزاتك بنجاح"
        : isConfirmed
          ? "تم تأكيد حجزك بنجاح"
          : "تم استلام طلب حجزك بنجاح";

  const heroDesc =
    successMode === "updated"
      ? "تم حفظ التحديث بنجاح. التفاصيل أدناه تعرض الموعد الجديد للخدمة."
      : isConfirmed
        ? "تفاصيل الموعد مؤكدة ويمكنك متابعة حالة الحجز أو التواصل عبر واتساب عند الحاجة."
        : "";
  const ctaTitle = successMode === "updated" ? "تأكيد تحديث الموعد عبر واتساب" : "تأكيد الحجز عبر واتساب";
  const ctaText =
    successMode === "updated"
      ? "تم تحديث الموعد. للتأكيد النهائي والمتابعة، يرجى التواصل عبر واتساب."
      : "رقم الآيبان مرفق بالأسفل لإتمام الدفع. بعد التحويل، يرجى إرسال إيصال الدفع عبر واتساب لتأكيد الحجز.";
  const confirmedNote =
    successMode === "updated"
      ? "تم اعتماد التحديث بنجاح، وهذه هي بيانات الموعد بعد التعديل."
      : "تم تأكيد الموعد، ننتظرك بكل حب.";

  const summary = useMemo(() => {
    const bookingIds = uniqueDisplayValues(views.map((v) => v.publicId));
    const clientNames = uniqueDisplayValues(views.map((v) => v.clientName));
    const clientPhones = uniqueDisplayValues(views.map((v) => v.clientPhone));
    const serviceNames = uniqueDisplayValues(views.map((v) => v.serviceName));
    const sectionValues = uniqueDisplayValues(views.map((v) => v.sectionLabel));
    const categoryValues = uniqueDisplayValues(views.map((v) => v.categoryLabel));
    const employeeNames = uniqueDisplayValues(views.map((v) => v.employeeName));
    const dateValues = uniqueDisplayValues(views.map((v) => formatDateForClient(v.date)));
    const timeValues = uniqueDisplayValues(views.map((v) => formatTime12ForClient(v.time)));
    const statusValues = uniqueDisplayValues(views.map((v) => statusLabel(v.status)));
    const total = views.reduce((s, v) => s + safeNum(v.total), 0);
    return {
      bookingIds,
      clientNames,
      clientPhones,
      serviceNames,
      sectionValues,
      categoryValues,
      employeeNames,
      dateValues,
      timeValues,
      statusValues,
      total,
    };
  }, [views]);

  const summaryStatus = summary.statusValues.length === 1 ? summary.statusValues[0] : "متعدد";
  const bookingIdLabel = summary.bookingIds.length > 1 ? "أرقام الحجز:" : "رقم الحجز:";
  const clientLabel = summary.clientNames.length > 1 ? "العميلات" : "الملكة";
  const phoneLabel = summary.clientPhones.length > 1 ? "أرقام الجوال" : "الجوال";
  const serviceLabel = summary.serviceNames.length > 1 ? "الخدمات" : "الخدمة";
  const sectionLabelText = summary.sectionValues.length > 1 ? "الأقسام" : "القسم";
  const categoryLabelText = summary.categoryValues.length > 1 ? "التصنيفات" : "التصنيف";
  const employeeLabel = summary.employeeNames.length > 1 ? "الموظفات" : "الموظفة";
  const dateLabel = summary.dateValues.length > 1 ? "التواريخ" : "التاريخ";
  const timeLabel = summary.timeValues.length > 1 ? "الأوقات" : "الوقت";
  const totalLabel = views.length > 1 ? "إجمالي الحجوزات" : "الإجمالي";
  const firstMk = summary.bookingIds[0] || String(first?.publicId || "").trim() || "—";
  const canTrack = firstMk !== "—";
  const successState = (location.state || {}) as SuccessLocationState;
  const isPackageReceipt = successState.packageReceipt === true;

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

  return (
    <div className="success-page">
      <div className="success-card">
        <div className="success-topline" />

        <div className="success-header">
          <div className="success-icon" aria-hidden="true">
            <span className="success-check">✓</span>
          </div>

          <h1 className="success-title">{heroTitle}</h1>
          {heroDesc ? <p className="success-subtitle">{heroDesc}</p> : null}


          {/* ✅ CTA واضح إذا Pending */}
          {!isConfirmed && (
            <div className="success-cta-box" role="note" aria-label="تنبيه تأكيد عبر واتساب">
              <div className="success-cta-title qs-wine">
                <span>{ctaTitle}</span>
              </div>
              <div className="success-cta-text qs-wine">
                {ctaText}
              </div>

            </div>
          )}

          {/* ✅ إذا Confirmed نقدر نعرض رسالة لطيفة */}
          {isConfirmed && (
            <div className="success-confirmed-note">
              <FontAwesomeIcon icon={faCircleCheck} />
              <span>{confirmedNote}</span>
            </div>
          )}
        </div>

        {/* ✅ ملخص حجوزات العملية في بطاقة واحدة */}
        <div className="success-details">
          <div className="success-booking-block">
            <div className="detail-row detail-row--full success-booking-id-row">
              <div className="success-booking-id-pill">
                <span className="success-booking-id-label">{bookingIdLabel}</span>
                <div className="success-booking-id-inline" dir="ltr">
                  <span className="success-booking-id-value">
                    {formatDisplayValues(summary.bookingIds, "inline")}
                  </span>
                  <button
                    type="button"
                    className="success-iban-copy-btn success-booking-copy-btn"
                    onClick={summary.bookingIds.length > 1 ? copyAll : () => copyOne(firstMk)}
                    title={summary.bookingIds.length > 1 ? "نسخ كل أرقام الحجوزات" : "نسخ رقم الحجز"}
                    aria-label={summary.bookingIds.length > 1 ? "نسخ كل أرقام الحجوزات" : "نسخ رقم الحجز"}
                  >
                    <FontAwesomeIcon icon={faCopy} />
                  </button>
                </div>
              </div>
            </div>

            <div className="detail-row">
              <FontAwesomeIcon icon={faUser} className="detail-ico" />
              <span className="detail-label">{clientLabel}</span>
              <span className="detail-value">{formatDisplayValues(summary.clientNames)}</span>
            </div>

            <div className="detail-row">
              <FontAwesomeIcon icon={faPhone} className="detail-ico" />
              <span className="detail-label">{phoneLabel}</span>
              <span className="detail-value">{formatDisplayValues(summary.clientPhones)}</span>
            </div>

            <div className="detail-row">
              <FontAwesomeIcon icon={faScissors} className="detail-ico" />
              <span className="detail-label">{serviceLabel}</span>
              <span className="detail-value">{formatDisplayValues(summary.serviceNames)}</span>
            </div>

            <div className="detail-row">
              <FontAwesomeIcon icon={faLayerGroup} className="detail-ico" />
              <span className="detail-label">{sectionLabelText}</span>
              <span className="detail-value">{formatDisplayValues(summary.sectionValues)}</span>
            </div>

            <div className="detail-row">
              <FontAwesomeIcon icon={faTags} className="detail-ico" />
              <span className="detail-label">{categoryLabelText}</span>
              <span className="detail-value">{formatDisplayValues(summary.categoryValues)}</span>
            </div>

            <div className="detail-row">
              <FontAwesomeIcon icon={faUserTie} className="detail-ico" />
              <span className="detail-label">{employeeLabel}</span>
              <span className="detail-value">{formatDisplayValues(summary.employeeNames)}</span>
            </div>

            <div className="detail-row">
              <FontAwesomeIcon icon={faCalendarAlt} className="detail-ico" />
              <span className="detail-label">{dateLabel}</span>
              <span className="detail-value">{formatDisplayValues(summary.dateValues)}</span>
            </div>

            <div className="detail-row">
              <FontAwesomeIcon icon={faClock} className="detail-ico" />
              <span className="detail-label">{timeLabel}</span>
              <span className="detail-value">{formatDisplayValues(summary.timeValues)}</span>
            </div>

            <div className="detail-row detail-row--full">
              <span className={`status-pill ${statusClass(summaryStatus)}`}>{statusLabel(summaryStatus)}</span>
            </div>

            <div className="total-row">
              <FontAwesomeIcon icon={faMoneyBill} />
              <span>{isPackageReceipt ? "القيمة المدفوعة: صفر — تمت التسوية من رصيد الباقة" : `${totalLabel}: ${summary.total ? `${formatNumberEn(summary.total)} ريال` : "—"}`}</span>
            </div>
            {isPackageReceipt ? (
              <button
                type="button"
                className="success-copy-btn"
                onClick={() => printPackageDocument(
                  `إيصال ${firstMk}`,
                  `<b>الخدمة:</b> ${summary.serviceNames[0] || "—"}<br><b>الموظفة:</b> ${summary.employeeNames[0] || "—"}<br><b>الموعد:</b> ${summary.dateValues[0] || "—"} ${summary.timeValues[0] || ""}<br><b>الباقة:</b> ${successState.packageName || "باقة جلسات"}<br><b>الرصيد قبل:</b> ${successState.packageBalanceBefore ?? "—"}<br><b>الرصيد بعد:</b> ${successState.packageBalanceAfter ?? "—"}<br><b>القيمة المدفوعة:</b> صفر<br>تمت التسوية من رصيد الباقة`
                )}
              >
                طباعة الإيصال الصفري
              </button>
            ) : null}
          </div>
        </div>

        {/* ✅ أزرار واتساب */}
        <div className="success-copy-actions is-single">
          <button type="button" className="success-copy-btn is-whatsapp is-green" onClick={openWhatsapp}>
            <FontAwesomeIcon icon={faWhatsapp} /> تأكيد الحجز عبر واتساب
          </button>
        </div>

        {/* ✅ ملاحظات مهمة */}
        <div className="success-policy">
          <div className="success-policy-top">
            <span className="success-policy-title">ملاحظات مهمة</span>
          </div>

          <p className="success-policy-note-line">
            سيتم التأكد من السعر النهائي بعد معاينة الشعر، وقد تكون هناك زيادة إذا كانت الأطوال مختلفة.
          </p>
          <p className="success-policy-note-line">يرجى الحضور قبل الموعد بـ 10 دقائق.</p>
          {!isPackageReceipt ? <p className="success-policy-note-line">نرجو منكم إتمام عملية الدفع لتأكيد حجزكم.</p> : null}
          {!isPackageReceipt ? <><p className="success-policy-iban-label">رقم آيبان البنك الأهلي:</p>
          <div className="success-policy-iban-inline" dir="ltr">
            <p className="success-policy-iban-value">{SALON_IBAN}</p>
            <button
              type="button"
              className="success-iban-copy-btn"
              onClick={copyIban}
              title="نسخ رقم الآيبان"
              aria-label="نسخ رقم الآيبان"
            >
              <FontAwesomeIcon icon={faCopy} />
            </button>
          </div></> : null}
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
