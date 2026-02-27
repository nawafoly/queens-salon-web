import { useEffect, useMemo, useState, useRef } from "react";
import type React from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import type { IconType } from "react-icons";
import {
  FiScissors,
  FiDroplet,
  FiWind,
  FiStar,
  FiPenTool,
  FiEye,
  FiEdit3,
  FiSun,
  FiHeart,
  FiZap,
  FiGift,
  FiShoppingBag,
} from "react-icons/fi";
import logo from "../assets/images/ssunnamed2.png";
import hairGuideImg from "../assets/images/hair-length-guide.png";

import {
  faCalendarAlt,
  faUser,
  faPhone,
  faSpinner,
  faUserTie,
  faSearch,
  faTimesCircle,
} from "@fortawesome/free-solid-svg-icons";

import {
  generateSalonTimeSlots,
  filterSlotsByServiceEnd,
  toMinutes,
  type TimeSlot,
} from "../helpers/timeSlots";
import { formatTime12 } from "../helpers/timeDisplay";
import {
  isStaffAvailableForDate,
  filterStaffSlotsByWorkingHours,
  isStaffWorkingAtTime,
  isStaffEmploymentEndedForDate,
} from "../helpers/staffAvailability";

import { AppSettingsService } from "../services/AppSettingsService";
import Modal from "../components/Modal";

// Firestore
import {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  orderBy,
  setDoc,
  limit,
  updateDoc, // ✅ NEW
} from "firebase/firestore";

import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../services/firebase";
import { upsertIncomeFS } from "../services/firestoreIncome";
import { writeAuditLog } from "../services/logService";

// Auth
import { getAuth, onAuthStateChanged } from "firebase/auth";

// fallback Pricing
import { pricingSections } from "./Pricing";

// Staff
import {
  listActiveStaffAll,
  type StaffPublicWithId,
} from "../services/firestoreStaffPublic";

// Catalog
import {
  listActiveSections,
  type SectionDoc,
  type CategoryDoc,
  type ServiceDoc,
} from "../services/firestoreCatalog";
import {
  listActivePackages,
  type ServicePackageDoc,
  type PackageServiceItem,
} from "../services/firestorePackages";

// Create booking
import { createBooking } from "../services/firestoreBookings";
import * as firestoreBookings from "../services/firestoreBookings";

// Profile loader (للعميلة لما تكون مسجلة دخول بالصفحات العامة)
// ✅ ملاحظة: intentionally unused هنا (الاستقبال)
// import { createOrLoadUserProfile } from "../services/userProfile";

// Modal
import ConfirmModal from "../components/ConfirmModal";
import "../styles/BookingInternal.css";

const createBookingGroup = (
  firestoreBookings as {
    createBookingGroup?: (data: any) => Promise<{
      parentId: string;
      parentPublicId: string;
      itemIds: string[];
    }>;
  }
).createBookingGroup;


/* =========================
   Types
========================= */

type CartItem = {
  id: string; // local id
  packageRunId?: string;
  serviceId: string;
  serviceName: string;
  packageId?: string;
  packageSnapshot?: {
    packageId: string;
    packageName: string;
    finalPriceAtBooking: number;
    baseTotalPriceAtBooking: number;
    totalDurationMinAtBooking: number;
    serviceIds: string[];
    services: PackageServiceItem[];
  };
  serviceSectionId: string;
  serviceSectionTitle?: string;
  serviceCategoryId?: string;
  serviceCategoryName?: string;

  serviceBasePrice?: number;
  basePrice: number;
  priceText: string;
  toolsSource?: "client" | "salon";
  toolsFeeApplied?: number;
  durationMin: number;

  employeeId: string; // staff_public doc id
  employeeUid?: string; // linkedUid
  employeeName?: string;

  date: string; // YYYY-MM-DD
  time: string; // ✅ نخزن 24h "HH:MM" (value24)
  locked?: boolean;
};

interface BookingFormData {
  name: string;
  phone: string;
  note?: string;
  items: CartItem[];
}

type AppliedOfferResult = {
  discountType: "fixed" | "percent" | null;
  discountValue: number;
  title: string;
  discountAmount: number;
  finalPrice: number;
};

function extractMinPrice(priceText: string): number {
  const cleaned = priceText.replace(/[^\d\-]/g, "");
  if (!cleaned) return 0;

  const parts = cleaned
    .split("-")
    .filter(Boolean)
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n));

  if (!parts.length) return 0;
  return Math.min(...parts);
}

function readDisplayLabel(raw: any, fallback = ""): string {
  const obj = raw && typeof raw === "object" ? raw : {};
  const directKeys = ["name", "title", "category", "categoryName", "الاسم", "العنوان"];
  for (const k of directKeys) {
    const v = String((obj as any)?.[k] ?? "").trim();
    if (v) return v;
  }
  const entries = Object.entries(obj as Record<string, any>);
  for (const [k, v] of entries) {
    const key = String(k || "").toLowerCase();
    if (/(name|title|اسم|عنوان)/i.test(key)) {
      const txt = String(v ?? "").trim();
      if (txt) return txt;
    }
  }
  return String(fallback || "").trim();
}

type FlatService = {
  id: string;
  kind: "service" | "package";
  sectionId: string;
  sectionTitle: string;

  categoryId?: string;
  category: string;
  name: string;

  priceText: string;
  basePrice: number;
  seasonPrice?: number;

  durationMin?: number;
  packageId?: string;
  packageServiceIds?: string[];
  packageServices?: PackageServiceItem[];
  packageBaseTotalPrice?: number;

  source: "firestore" | "pricing";
};

type PriceLookupItem = {
  id: string;
  name: string;
  price: number;
  seasonPrice?: number;
  imageUrl: string;
  searchText: string;
};

type CategoryOption = { id: string; name: string };
type PickerScope = "services" | "packages";
type FsSectionCatalogCacheRow = {
  categories: CategoryDoc[];
  services: ServiceDoc[];
};

const QUICK_CLIENT_HISTORY_KEY = "internal_quick_clients_history_v1";

const SALON_ID = "main";
const DEFAULT_SERVICE_DURATION_MIN = 60;
const PACKAGE_SECTION_ID = "service-packages";
const PACKAGE_SECTION_TITLE = "البكيجات";
const ALLOW_OVERTIME_MIN = 20;
const TAKEN_TIMES_CACHE_TTL_MS = 20_000;
const BOOKED_META_CACHE_TTL_MS = 20_000;
const MANI_PEDI_SECTION_KEYWORDS = [
  "manicure",
  "pedicure",
  "mani",
  "pedi",
  "body care",
  "bodycare",
  "mni",
  "مناكير",
  "منيكير",
  "بديكير",
  "بوديكير",
  "بدكير",
  "بوديكير",
];
type WeekdayKey = "sat" | "sun" | "mon" | "tue" | "wed" | "thu" | "fri";
type DateCalendar = "gregory" | "hijri";
type BookingHourOverrideMode = "hours" | "closed";
type BookingHourOverride = {
  id?: string;
  fromDate: string;
  toDate: string;
  mode: BookingHourOverrideMode;
  start?: string;
  end?: string;
  includeWeekdays?: WeekdayKey[];
  blockedWeekdays?: WeekdayKey[];
  reason?: string;
};
const JS_DAY_TO_WEEKDAY: WeekdayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const WEEKDAY_LABEL_AR: Record<WeekdayKey, string> = {
  sat: "السبت",
  sun: "الأحد",
  mon: "الإثنين",
  tue: "الثلاثاء",
  wed: "الأربعاء",
  thu: "الخميس",
  fri: "الجمعة",
};

// نفس منطق slotId
function safeKey(v: string) {
  return String(v || "").trim().replaceAll("/", "-").replace(/\s+/g, "_");
}

function resolveEmployeeKey(it: { employeeUid?: string; employeeId: string }) {
  const uid = String(it.employeeUid || "").trim();
  if (uid) return uid;
  return String(it.employeeId || "").trim();
}

function buildSlotId(
  salonId: string,
  employeeKey: string,
  date: string,
  time: string
) {
  return `${safeKey(salonId)}__${safeKey(date)}__${safeKey(time)}__${safeKey(
    employeeKey
  )}`;
}

function buildEmployeeLookupKeys(args: {
  employeeKey?: string;
  employeeIdFallback?: string;
  employeeUidFallback?: string;
  employeeNameFallback?: string;
}) {
  const primaryKey = String(args.employeeKey || "").trim();
  const primaryId = String(args.employeeIdFallback || "").trim();
  const uid = String(args.employeeUidFallback || "").trim();
  const nameKey = safeKey(String(args.employeeNameFallback || "").trim());

  const primaryEmployeeKeyKeys = new Set<string>();
  const primaryEmployeeIdKeys = new Set<string>();
  if (primaryKey) primaryEmployeeKeyKeys.add(primaryKey);
  if (primaryId) primaryEmployeeIdKeys.add(primaryId);
  if (primaryId && primaryId !== primaryKey) primaryEmployeeKeyKeys.add(primaryId);

  const fallbackEmployeeKeyKeys = new Set<string>();
  const fallbackEmployeeIdKeys = new Set<string>();
  if (uid && !primaryEmployeeKeyKeys.has(uid)) fallbackEmployeeKeyKeys.add(uid);
  if (uid && !primaryEmployeeIdKeys.has(uid)) fallbackEmployeeIdKeys.add(uid);
  if (nameKey && !primaryEmployeeKeyKeys.has(nameKey)) fallbackEmployeeKeyKeys.add(nameKey);

  const slotKeys = Array.from(
    new Set<string>([
      ...Array.from(primaryEmployeeKeyKeys),
      ...Array.from(primaryEmployeeIdKeys),
      ...Array.from(fallbackEmployeeKeyKeys),
      ...Array.from(fallbackEmployeeIdKeys),
    ])
  );

  return {
    primaryEmployeeKeyKeys: Array.from(primaryEmployeeKeyKeys),
    primaryEmployeeIdKeys: Array.from(primaryEmployeeIdKeys),
    fallbackEmployeeKeyKeys: Array.from(fallbackEmployeeKeyKeys),
    fallbackEmployeeIdKeys: Array.from(fallbackEmployeeIdKeys),
    slotKeys,
  };
}

function getTimesToLock(
  allSlots: TimeSlot[],
  slotStepMin: number,
  startTime24: string, // ✅ "HH:MM"
  durationMin: number,
  bufferMin: number
) {
  const step = Math.max(1, Number(slotStepMin || 0));

  const totalMin =
    Math.max(0, Number(durationMin || 0)) + Math.max(0, Number(bufferMin || 0));

  if (totalMin <= 0) return [startTime24];

  const slotsToLock = Math.max(1, Math.ceil(totalMin / step));
  const startIdx = allSlots.findIndex(
    (s) => String(s.value24 || "").trim() === String(startTime24 || "").trim()
  );

  if (startIdx < 0) return [startTime24];

  const locked: string[] = [];
  for (let i = 0; i < slotsToLock; i++) {
    const slot = allSlots[startIdx + i];
    if (!slot) break;
    locked.push(slot.value24);
  }

  return locked.length ? locked : [startTime24];
}

function getGreenStartTimes(args: {
  allSlots: TimeSlot[];
  slotStepMin: number;
  durationMin: number;
  bufferMin: number;
  takenAll: Set<string>; // ✅ times 24h
}) {
  const greens = new Set<string>(); // ✅ نخزن value24

  for (const slot of args.allSlots) {
    const start24 = slot.value24;

    const needed = getTimesToLock(
      args.allSlots,
      args.slotStepMin,
      start24,
      args.durationMin,
      args.bufferMin
    );

    let ok = true;
    for (const t of needed) {
      if (args.takenAll.has(t)) {
        ok = false;
        break;
      }
    }

    if (ok) greens.add(start24);
  }

  return greens;
}

function sortTimesBySlotOrder(times: string[], allSlots: TimeSlot[]) {
  const order = new Map<string, number>();
  allSlots.forEach((s, idx) => {
    const k = String(s.value24 || "").trim();
    if (k && !order.has(k)) order.set(k, idx);
  });
  return [...times].sort(
    (a, b) =>
      (order.get(String(a || "").trim()) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(String(b || "").trim()) ?? Number.MAX_SAFE_INTEGER)
  );
}

function buildUniformReasonByStarts(starts: string[], reason: string) {
  const out: Record<string, string> = {};
  for (const t of starts) out[t] = reason;
  return out;
}

type BlockedReasonSummary = {
  from: string;
  to: string;
  reasonKey: string;
  reasonLabel: string;
  reasonDetail?: string;
  count: number;
};

const BLOCKED_TIME_TOKEN_RE = /\d{1,2}:\d{2}\s*(?:AM|PM|am|pm|ص|م|a\.m\.|p\.m\.)?/g;

function normalizeBlockedReasonKey(reason: string) {
  return String(reason || "")
    .trim()
    .replace(BLOCKED_TIME_TOKEN_RE, "<time>")
    .replace(/\s+/g, " ");
}

function parseBlockedReason(reason: string) {
  const raw = String(reason || "").trim();
  if (!raw) {
    return {
      key: "unknown",
      label: "غير متاح",
      detail: "",
    };
  }

  if (raw.includes("لا يكفي")) {
    return {
      key: "end-limit",
      label: "لا يكفي الوقت لإنهاء الخدمة قبل الإغلاق.",
      detail: "",
    };
  }

  if (raw.includes("خدمة أخرى في السلة")) {
    return {
      key: "cart-conflict",
      label: "يتعارض مع خدمة أخرى في السلة.",
      detail: "",
    };
  }

  if (raw.includes("حجز/قفل فعلي")) {
    return {
      key: "booking-conflict",
      label: "يتعارض مع حجز/قفل فعلي.",
      detail: "",
    };
  }

  if (raw.includes("يتعارض عند")) {
    const meta = String(raw.split(":").slice(1).join(":") || "")
      .trim()
      .replace(/\.+$/g, "");
    return {
      key: "booking-conflict",
      label: "يتعارض مع وقت محجوز مسبقًا.",
      detail: meta,
    };
  }

  const cleaned = raw
    .replace(/\s+(?:at|عند)\s*\d{1,2}:\d{2}\s*(?:AM|PM|am|pm|ص|م|a\.m\.|p\.m\.)?/g, "")
    .replace(BLOCKED_TIME_TOKEN_RE, "")
    .replace(/\s+([:.,،؛])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  return {
    key: normalizeBlockedReasonKey(raw),
    label: cleaned || raw,
    detail: "",
  };
}

function formatBlockedRangeLabel(from: string, to: string) {
  const fromLabel = formatTime12(from, from);
  if (from === to) return `عند ${fromLabel}`;
  return `من ${fromLabel} إلى ${formatTime12(to, to)}`;
}

function summarizeBlockedReasons(
  entries: [string, string][],
  slotStepMin: number
): BlockedReasonSummary[] {
  const sorted = [...entries].sort((a, b) => {
    const am = toMinutes(a[0]);
    const bm = toMinutes(b[0]);
    const safeA = Number.isFinite(am) ? am : Number.MAX_SAFE_INTEGER;
    const safeB = Number.isFinite(bm) ? bm : Number.MAX_SAFE_INTEGER;
    return safeA - safeB;
  });

  const step = Math.max(1, Number(slotStepMin || 0));
  const out: BlockedReasonSummary[] = [];

  for (const [time24, reason] of sorted) {
    const minute = toMinutes(time24);
    const parsed = parseBlockedReason(reason);
    const reasonKey = parsed.key;
    const reasonLabel = parsed.label;
    const reasonDetail = parsed.detail;
    const prev = out[out.length - 1];

    if (prev) {
      const prevMin = toMinutes(prev.to);
      if (
        prev.reasonKey === reasonKey &&
        Number.isFinite(prevMin) &&
        Number.isFinite(minute) &&
        minute >= prevMin &&
        minute - prevMin <= step
      ) {
        prev.to = time24;
        prev.count += 1;
        if (!prev.reasonDetail && reasonDetail) {
          prev.reasonDetail = reasonDetail;
        } else if (
          prev.reasonDetail &&
          reasonDetail &&
          prev.reasonDetail !== reasonDetail &&
          reasonKey === "booking-conflict"
        ) {
          prev.reasonDetail = "تفاصيل متعددة.";
        }
        continue;
      }
    }

    out.push({
      from: time24,
      to: time24,
      reasonKey,
      reasonLabel,
      reasonDetail,
      count: 1,
    });
  }

  return out;
}

function calcManualDiscount(
  basePrice: number,
  discountType: "fixed" | "percent" | null,
  discountValue: number
) {
  const value = Math.max(0, Number(discountValue || 0));
  if (!discountType || value <= 0 || basePrice <= 0) {
    return { discountAmount: 0, finalPrice: Math.max(0, basePrice) };
  }

  if (discountType === "percent") {
    const percent = Math.min(100, value);
    const discount = Math.round((basePrice * percent) / 100);
    return { discountAmount: discount, finalPrice: Math.max(0, basePrice - discount) };
  }

  const discount = Math.min(basePrice, value);
  return { discountAmount: discount, finalPrice: Math.max(0, basePrice - discount) };
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeIsoDate(v: any) {
  const s = String(v || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function formatDateByCalendar(v: any, calendar: DateCalendar = "gregory") {
  const iso = normalizeIsoDate(v);
  if (!iso) return "-";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  const locale =
    calendar === "hijri" ? "ar-SA-u-ca-islamic-umalqura" : "ar-SA-u-ca-gregory";
  const raw = d.toLocaleDateString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const clean = String(raw || "")
    .replace(/\s*(م|هـ|AD|AH)\.?$/iu, "")
    .trim();
  return `\u200E${clean}\u200E`;
}

function addDaysISO(startISO: string, addDays: number) {
  const d = new Date(startISO + "T00:00:00");
  d.setDate(d.getDate() + addDays);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function hijriNumericParts(iso: string): { day: number; month: number; year: number } | null {
  const dateISO = normalizeIsoDate(iso);
  if (!dateISO) return null;
  const d = new Date(`${dateISO}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).formatToParts(d);
  const day = Number(parts.find((p) => p.type === "day")?.value || NaN);
  const month = Number(parts.find((p) => p.type === "month")?.value || NaN);
  const year = Number(parts.find((p) => p.type === "year")?.value || NaN);
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null;
  return { day, month, year };
}

function findHijriMonthStartISO(anchorISO: string) {
  const anchor = normalizeIsoDate(anchorISO) || todayISO();
  const base = hijriNumericParts(anchor);
  if (!base) return anchor;
  let cursor = anchor;
  for (let i = 0; i < 35; i++) {
    const prev = addDaysISO(cursor, -1);
    const prevParts = hijriNumericParts(prev);
    if (!prevParts || prevParts.month !== base.month || prevParts.year !== base.year) {
      return cursor;
    }
    cursor = prev;
  }
  return cursor;
}

function buildHijriMonthDays(anchorISO: string) {
  const start = findHijriMonthStartISO(anchorISO);
  const base = hijriNumericParts(start);
  if (!base) return [] as Array<{ iso: string; hijriDay: number }>;
  const out: Array<{ iso: string; hijriDay: number }> = [];
  let cursor = start;
  for (let i = 0; i < 35; i++) {
    const p = hijriNumericParts(cursor);
    if (!p || p.month !== base.month || p.year !== base.year) break;
    out.push({ iso: cursor, hijriDay: p.day });
    cursor = addDaysISO(cursor, 1);
  }
  return out;
}

function shiftHijriMonthStartISO(currentMonthStartISO: string, delta: number) {
  const currentStart = findHijriMonthStartISO(currentMonthStartISO);
  if (delta === 0) return currentStart;
  if (delta > 0) {
    let nextStart = currentStart;
    for (let i = 0; i < delta; i++) {
      const days = buildHijriMonthDays(nextStart);
      if (!days.length) return nextStart;
      nextStart = addDaysISO(days[days.length - 1].iso, 1);
    }
    return findHijriMonthStartISO(nextStart);
  }
  let prevStart = currentStart;
  for (let i = 0; i < Math.abs(delta); i++) {
    prevStart = findHijriMonthStartISO(addDaysISO(prevStart, -1));
  }
  return prevStart;
}

function toHijriMonthYearLabel(iso: string) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  return d
    .toLocaleDateString("ar-SA-u-ca-islamic-umalqura", {
      month: "long",
      year: "numeric",
    })
    .replace(/\s*(م|هـ|AD|AH)\.?$/iu, "")
    .trim();
}

function safeInt(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function safeTimeHHMM(v: any, fallback: string) {
  const s = String(v || "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;

  const hh = Number(m[1]);
  const mm = Number(m[2]);

  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return fallback;
  if (hh < 0 || hh > 23) return fallback;
  if (mm < 0 || mm > 59) return fallback;

  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function resolveWeekdayFromISO(dateISO: string): WeekdayKey {
  const s = String(dateISO || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return JS_DAY_TO_WEEKDAY[new Date().getDay()] || "sat";

  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, Math.max(0, mo - 1), d);
  return JS_DAY_TO_WEEKDAY[dt.getDay()] || "sat";
}

function normalizeWeekdayList(v: any): WeekdayKey[] {
  if (!Array.isArray(v)) return [];
  const allowed = new Set<WeekdayKey>(["sat", "sun", "mon", "tue", "wed", "thu", "fri"]);
  const out: WeekdayKey[] = [];
  for (const d0 of v) {
    const d = String(d0 || "").trim().toLowerCase() as WeekdayKey;
    if (allowed.has(d) && !out.includes(d)) out.push(d);
  }
  return out;
}

function readBookingHourOverrides(raw: any): BookingHourOverride[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x: any) => {
      const fromDate = String(x?.fromDate || "").trim();
      const toDate = String(x?.toDate || "").trim();
      if (!fromDate || !toDate) return null;
      const mode: BookingHourOverrideMode = String(x?.mode || "").trim() === "closed" ? "closed" : "hours";
      return {
        id: String(x?.id || "").trim() || undefined,
        fromDate,
        toDate,
        mode,
        start: String(x?.start || "").trim() || undefined,
        end: String(x?.end || "").trim() || undefined,
        includeWeekdays: normalizeWeekdayList(x?.includeWeekdays),
        blockedWeekdays: normalizeWeekdayList(x?.blockedWeekdays),
        reason: String(x?.reason || "").trim() || undefined,
      };
    })
    .filter(Boolean) as BookingHourOverride[];
}

const ARABIC_DIGIT_MAP: Record<string, string> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
};

function normalizeDigits(raw: string) {
  return String(raw || "").replace(/[٠-٩۰-۹]/g, (d) => ARABIC_DIGIT_MAP[d] || d);
}

function normalizeSearchText(raw: string) {
  const text = normalizeDigits(String(raw || "").trim().toLowerCase())
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ؤئ]/g, "ء");

  return text
    .replace(/[^a-z0-9\u0600-\u06ff\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isManiPediSectionByInfo(sectionId: string, sectionTitle?: string) {
  const hay = normalizeSearchText(`${sectionId || ""} ${sectionTitle || ""}`);
  if (!hay) return false;
  return MANI_PEDI_SECTION_KEYWORDS.some((k) => hay.includes(normalizeSearchText(k)));
}

function toArabicCatalogLabel(raw: string) {
  const original = String(raw || "").trim();
  if (!original) return "";
  if (/[\u0600-\u06FF]/.test(original)) return original;

  const normalized = normalizeSearchText(original).replace(/[_-]+/g, " ");
  const aliases: Array<{ re: RegExp; ar: string }> = [
    { re: /\bhair\b|blow\s*dry|color|styling|treatment/, ar: "الشعر" },
    { re: /\bnail|manicure|pedicure\b/, ar: "الأظافر" },
    { re: /\bmakeup|bridal\b/, ar: "المكياج" },
    { re: /\bskin|facial\b/, ar: "العناية بالبشرة" },
    { re: /\bbody|spa|massage\b/, ar: "العناية بالجسم" },
    { re: /\bwax|thread|laser|hair\s*removal\b/, ar: "إزالة الشعر" },
    { re: /\beyelash|brow|eyebrow|lash\b/, ar: "الرموش والحواجب" },
    { re: /\bpackage|packages|bundle\b/, ar: "البكيجات" },
    { re: /\boffers?|discounts?\b/, ar: "العروض" },
  ];

  for (const a of aliases) {
    if (a.re.test(normalized)) return a.ar;
  }

  return original;
}

type PriceLookupIcon = {
  Icon: IconType;
  label: string;
};

function pickPriceLookupIcon(serviceName: string): PriceLookupIcon {
  const hay = normalizeSearchText(String(serviceName || ""));
  const has = (keys: string[]) =>
    keys.some((k) => {
      const n = normalizeSearchText(k);
      return !!n && hay.includes(n);
    });

  if (has(["قص", "حلاقة", "اطراف", "أطراف", "غرة", "trim", "cut", "hair cut"])) {
    return { Icon: FiScissors, label: "قص" };
  }
  if (has(["صبغ", "صبغة", "لون", "ألوان", "هايلايت", "balayage", "color", "dye"])) {
    return { Icon: FiDroplet, label: "صبغات" };
  }
  if (has(["استشوار", "سشوار", "سيشوار", "blow dry", "blowdry", "dryer"])) {
    return { Icon: FiWind, label: "استشوار" };
  }
  if (has(["تسريحة", "تساريح", "تصفيف", "فير", "updo", "styling", "style"])) {
    return { Icon: FiStar, label: "تساريح" };
  }
  if (has(["مكياج", "ميك اب", "ميكاب", "makeup", "bridal"])) {
    return { Icon: FiPenTool, label: "مكياج" };
  }
  if (has(["رموش", "حواجب", "لاش", "eyelash", "lash", "brow"])) {
    return { Icon: FiEye, label: "رموش" };
  }
  if (has(["أظافر", "اظافر", "مناكير", "بدكير", "بديكير", "nail", "manicure", "pedicure"])) {
    return { Icon: FiEdit3, label: "أظافر" };
  }
  if (has(["بشرة", "عناية", "facial", "skin", "clean"])) {
    return { Icon: FiSun, label: "عناية" };
  }
  if (has(["مساج", "تدليك", "حمام", "spa", "massage", "body"])) {
    return { Icon: FiHeart, label: "عناية جسم" };
  }
  if (has(["واكس", "ليزر", "ازالة", "إزالة", "thread", "wax", "laser"])) {
    return { Icon: FiZap, label: "إزالة شعر" };
  }
  if (has(["باكيج", "عرض", "package", "bundle", "offer"])) {
    return { Icon: FiGift, label: "باكيج" };
  }
  return { Icon: FiShoppingBag, label: "خدمة" };
}

function normalizeKsaPhone(raw: string) {
  const digits = normalizeDigits(String(raw || "")).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("9665") && digits.length === 12) return "0" + digits.slice(3);
  if (digits.startsWith("5") && digits.length === 9) return "0" + digits;
  if (digits.startsWith("05") && digits.length === 10) return digits;
  return digits;
}

function phone10Digits(raw: string) {
  return normalizeKsaPhone(raw).replace(/\D/g, "").slice(0, 10);
}

function mapBookingStatusAr(raw: any) {
  if (isRefundedBooking(raw)) return "مسترجع";
  const statusRaw =
    typeof raw === "string" ? raw : String((raw as any)?.status || "");
  const s = String(statusRaw || "").trim().toLowerCase();
  if (s === "refunded") return "مسترجع";
  if (s === "confirmed") return "مؤكد";
  if (s === "pending") return "بالانتظار";
  if (s === "cancelled" || s === "canceled") return "ملغي";
  if (s === "completed") return "مكتمل";
  return String(statusRaw || "—");
}

function bookingStatusClass(raw: any) {
  if (isRefundedBooking(raw)) return "bk-status-refunded";
  const statusRaw =
    typeof raw === "string" ? raw : String((raw as any)?.status || "");
  const s = String(statusRaw || "").trim().toLowerCase();
  if (s === "refunded") return "bk-status-refunded";
  if (s === "confirmed") return "bk-status-confirmed";
  if (s === "pending") return "bk-status-pending";
  if (s === "cancelled" || s === "canceled") return "bk-status-cancelled";
  if (s === "completed") return "bk-status-completed";
  return "bk-status-default";
}

function mapBookingChannelAr(raw: any) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "—";
  if (s === "client") return "عميلة";
  if (s === "internal") return "استقبال";
  if (s === "dashboard") return "إدارة";
  if (s === "online") return "أونلاين";
  return String(raw);
}

function normalizeExistingPaymentMethod(raw: any): "cash" | "card" | "transfer" {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "cash" || s.includes("كاش") || s.includes("نقد")) return "cash";
  if (s === "card" || s === "pos_card" || s === "mada_online" || s.includes("شبكة") || s.includes("مدى")) {
    return "card";
  }
  return "transfer";
}

function isRefundedBooking(raw: any) {
  const s = String(raw?.status || "").trim().toLowerCase();
  if (s === "refunded") return true;
  return !!raw?.refundedAt || !!raw?.refundIncomeId || String(raw?.refundReason || "").trim().length > 0;
}

function isCompletedStatus(raw: any) {
  if (isRefundedBooking(raw)) return false;
  const statusRaw =
    typeof raw === "string" ? raw : String((raw as any)?.status || "");
  return String(statusRaw || "").trim().toLowerCase() === "completed";
}

function isCancelledStatus(raw: any) {
  const statusRaw =
    typeof raw === "string" ? raw : String((raw as any)?.status || "");
  const s = String(statusRaw || "").trim().toLowerCase();
  return s === "cancelled" || s === "canceled" || s === "rejected";
}

function canRefundBooking(raw: any) {
  if (isRefundedBooking(raw)) return false;
  const statusRaw =
    typeof raw === "string" ? raw : String((raw as any)?.status || "");
  const s = String(statusRaw || "").trim().toLowerCase();
  return s === "confirmed" || s === "completed";
}

type UiModalState = {
  open: boolean;
  title: string;
  message: string;
  variant: "info" | "danger" | "success";
  confirmText?: string;
};

function makeLocalId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

type BusyState = {
  busyTimes: Set<string>;
  disabledStartTimes: Set<string>;
  loading: boolean;
  hint: string;
  suggestedSlot?: string;
  disabledReasonByStart: Record<string, string>;

  // ✅ تفاصيل الحجز الموجود على الوقت (يطلع في الـ UI)
  bookedMetaByTime: Record<string, string>;
};

const emptyBusyState = (): BusyState => ({
  busyTimes: new Set(),
  disabledStartTimes: new Set(),
  loading: false,
  hint: "",
  suggestedSlot: "",
  disabledReasonByStart: {},
  bookedMetaByTime: {},
});

const BookingInternal = ({ internalMode = true }: { internalMode?: boolean }) => {
  const navigate = useNavigate();
  const dateRef = useRef<HTMLInputElement>(null);
  const hijriPickerRef = useRef<HTMLDivElement>(null);
  const serviceSectionCardRef = useRef<HTMLDivElement>(null);
  const priceListCardRef = useRef<HTMLDivElement>(null);
  const hairGuideCardRef = useRef<HTMLDivElement>(null);

  // =========================
  // Settings (live)
  // =========================
  const [appSettings, setAppSettings] = useState<any>(
    () => AppSettingsService.getCached?.() || {}
  );
  const booking = (appSettings as any)?.booking || {};
  const seasonPricing = (appSettings as any)?.catalogSeasonPricing || {};
  const seasonCfg = seasonPricing;
  const sequentialBooking = !!(booking as any)?.sequentialBooking;
  // ✅ الاستقبال يختار التاريخ أول
  const [bookingDate, setBookingDate] = useState<string>(() => todayISO());
  const [bookingDateCalendar, setBookingDateCalendar] = useState<DateCalendar>("gregory");
  const [hijriPickerOpen, setHijriPickerOpen] = useState(false);
  const [hijriViewMonthISO, setHijriViewMonthISO] = useState<string>(() =>
    findHijriMonthStartISO(todayISO())
  );
  const bookingDateInputDisplay = useMemo(() => {
    if (!bookingDate) return "";
    return formatDateByCalendar(bookingDate, bookingDateCalendar);
  }, [bookingDate, bookingDateCalendar]);
  const hijriMonthTitle = useMemo(() => toHijriMonthYearLabel(hijriViewMonthISO), [hijriViewMonthISO]);
  const hijriMonthDays = useMemo(() => buildHijriMonthDays(hijriViewMonthISO), [hijriViewMonthISO]);

  useEffect(() => {
    if (!hijriPickerOpen) return;
    const onDocClick = (ev: MouseEvent) => {
      const root = hijriPickerRef.current;
      if (!root) return;
      const target = ev.target as Node | null;
      if (target && root.contains(target)) return;
      setHijriPickerOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [hijriPickerOpen]);

  const businessHours = (booking as any)?.businessHours || {};
  const bookingHourOverrides = useMemo(
    () => readBookingHourOverrides((booking as any)?.bookingHourOverrides),
    [(booking as any)?.bookingHourOverrides]
  );

  const getDaySettingsForDate = (dateISO: string) => {
    const dayKey = resolveWeekdayFromISO(String(dateISO || "").trim() || todayISO());
    const dayHoursBase = (businessHours as any)?.[dayKey] || {
      enabled: true,
      start: "10:00",
      end: "22:00",
    };

    for (let i = bookingHourOverrides.length - 1; i >= 0; i--) {
      const ov = bookingHourOverrides[i];
      const fromDate = String(ov?.fromDate || "").trim();
      const toDate = String(ov?.toDate || "").trim();
      if (!fromDate || !toDate) continue;
      if (dateISO < fromDate || dateISO > toDate) continue;

      const includeDays = Array.isArray(ov?.includeWeekdays) ? ov.includeWeekdays : [];
      if (includeDays.length > 0 && !includeDays.includes(dayKey)) continue;

      const blockedDays = Array.isArray(ov?.blockedWeekdays) ? ov.blockedWeekdays : [];
      if (blockedDays.includes(dayKey) || String(ov?.mode || "").trim() === "closed") {
        return {
          dayKey,
          dayLabel: WEEKDAY_LABEL_AR[dayKey],
          enabled: false,
          openTime: safeTimeHHMM((dayHoursBase as any)?.start, "10:00"),
          closeTime: safeTimeHHMM((dayHoursBase as any)?.end, "22:00"),
        };
      }

      return {
        dayKey,
        dayLabel: WEEKDAY_LABEL_AR[dayKey],
        enabled: true,
        openTime: safeTimeHHMM(String(ov?.start || ""), safeTimeHHMM((dayHoursBase as any)?.start, "10:00")),
        closeTime: safeTimeHHMM(String(ov?.end || ""), safeTimeHHMM((dayHoursBase as any)?.end, "22:00")),
      };
    }

    return {
      dayKey,
      dayLabel: WEEKDAY_LABEL_AR[dayKey],
      enabled: dayHoursBase?.enabled !== false,
      openTime: safeTimeHHMM((dayHoursBase as any)?.start, "10:00"),
      closeTime: safeTimeHHMM((dayHoursBase as any)?.end, "22:00"),
    };
  };
  const selectedDaySettings = useMemo(
    () => getDaySettingsForDate(String(bookingDate || "").trim() || todayISO()),
    [bookingDate, businessHours, bookingHourOverrides]
  );
  const selectedDayKey = selectedDaySettings.dayKey;
  const selectedDayOpen = selectedDaySettings.enabled !== false;
  const openTime = selectedDaySettings.openTime;
  const closeTime = selectedDaySettings.closeTime;

  const slotStepMin = useMemo(() => {
    const v = safeInt((booking as any)?.slotStepMin, 10);
    return [5, 10, 15, 30].includes(v) ? v : 10;
  }, [(booking as any)?.slotStepMin]);

  const bufferMin = useMemo(() => {
    return Math.max(0, safeInt((booking as any)?.bufferMin, 5));
  }, [(booking as any)?.bufferMin]);
  const maniPediToolsFee = useMemo(() => {
    return Math.max(0, safeInt((booking as any)?.maniPediToolsFee, 15));
  }, [(booking as any)?.maniPediToolsFee]);

  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);

  useEffect(() => {
    if (!selectedDayOpen) {
      setTimeSlots([]);
      return;
    }

    setTimeSlots(generateSalonTimeSlots(openTime, closeTime, slotStepMin));
  }, [selectedDayOpen, openTime, closeTime, slotStepMin]);

  useEffect(() => {
    const unsub = AppSettingsService.subscribe((remote: any) => {
      setAppSettings(remote || {});
    });
    return () => unsub();
  }, []);

  // =========================
  // Catalog mode
  // =========================
  const [catalogMode, setCatalogMode] = useState<"firestore" | "pricing">(
    "pricing"
  );
  const [catalogLoading, setCatalogLoading] = useState(false);

  const [fsSections, setFsSections] = useState<SectionDoc[]>([]);
  const [fsCategories, setFsCategories] = useState<CategoryDoc[]>([]);
  const [fsServices, setFsServices] = useState<ServiceDoc[]>([]);
  const [fsPackages, setFsPackages] = useState<ServicePackageDoc[]>([]);
  const fsSectionCatalogCacheRef = useRef<Record<string, FsSectionCatalogCacheRow>>({});
  const fsSectionCatalogInFlightRef = useRef<
    Record<string, Promise<FsSectionCatalogCacheRow>>
  >({});

  const [selectedSectionId, setSelectedSectionId] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [servicePicker, setServicePicker] = useState<string>("");
  const [pickerScope, setPickerScope] = useState<PickerScope>("services");

  const [priceLookupQuery, setPriceLookupQuery] = useState("");
  const [priceLookupLoading, setPriceLookupLoading] = useState(false);
  const [priceLookupServices, setPriceLookupServices] = useState<PriceLookupItem[]>([]);
  const [priceLookupImageModal, setPriceLookupImageModal] = useState<{
    open: boolean;
    name: string;
    imageUrl: string;
  }>({
    open: false,
    name: "",
    imageUrl: "",
  });

  const [hairGuideUrl, setHairGuideUrl] = useState<string>(hairGuideImg);
  const [isOwner, setIsOwner] = useState(false);
  const [uploadingGuide, setUploadingGuide] = useState(false);

  const [formData, setFormData] = useState<BookingFormData>({
    name: "",
    phone: "",
    note: "",
    items: [],
  });

  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [manualDiscountType, setManualDiscountType] = useState<"" | "fixed" | "percent">("");
  const [manualDiscountValue, setManualDiscountValue] = useState("");
  const [discountMsg, setDiscountMsg] = useState("");
  const [applied, setApplied] = useState<AppliedOfferResult>({
    discountType: null,
    discountValue: 0,
    title: "",
    discountAmount: 0,
    finalPrice: 0,
  });

  const [busyByItem, setBusyByItem] = useState<Record<string, BusyState>>({});
  const busyQueryKeyByItemRef = useRef<Record<string, string>>({});
  const takenTimesCacheRef = useRef<Record<string, { ts: number; values: string[] }>>({});
  const takenTimesInFlightRef = useRef<Record<string, Promise<Set<string>>>>({});
  const bookedMetaCacheRef = useRef<Record<string, { ts: number; values: Record<string, string> }>>({});
  const bookedMetaInFlightRef = useRef<Record<string, Promise<Record<string, string>>>>({});
  const [expandedConfirmedCartItems, setExpandedConfirmedCartItems] = useState<
    Record<string, true>
  >({});
  const [expandedPreviewRows, setExpandedPreviewRows] = useState<Record<string, true>>({});
  const [serviceSectionHeightPx, setServiceSectionHeightPx] = useState(0);

  // =========================
  // ✅ NEW: Future availability (للأيام القادمة)
  // =========================
  const [futureAnyStaff, setFutureAnyStaff] = useState(true);
  const [futureSelectedEmployeeKey, setFutureSelectedEmployeeKey] = useState<string>("");
  const [futureStaffNameQuery, setFutureStaffNameQuery] = useState("");
  const [futureLoading, setFutureLoading] = useState(false);
  const [futureServiceId, setFutureServiceId] = useState("");
  const [futureTargetItemId, setFutureTargetItemId] = useState("");
  const [futureResult, setFutureResult] = useState<
    { date: string; times: string[]; note?: string; contributors?: string[] }[]
  >([]);

  const [futureMsg, setFutureMsg] = useState("");
  const futureSearchRef = useRef<HTMLDivElement | null>(null);
  const autoFutureSearchKeyRef = useRef("");

  useEffect(() => {
    const measureServiceSectionHeight = () => {
      if (typeof window === "undefined" || window.innerWidth < 992) {
        setServiceSectionHeightPx(0);
        return;
      }
      const serviceHeight = Math.max(
        0,
        Math.round(serviceSectionCardRef.current?.getBoundingClientRect().height || 0)
      );
      const priceHeight = Math.max(
        0,
        Math.round(priceListCardRef.current?.getBoundingClientRect().height || 0)
      );
      const guideHeight = Math.max(
        0,
        Math.round(hairGuideCardRef.current?.getBoundingClientRect().height || 0)
      );
      const next = serviceHeight > 0 ? serviceHeight : Math.max(priceHeight, guideHeight);
      setServiceSectionHeightPx((prev) => (prev === next ? prev : next));
    };

    measureServiceSectionHeight();
    requestAnimationFrame(measureServiceSectionHeight);
    setTimeout(measureServiceSectionHeight, 120);

    const observedNodes = [
      serviceSectionCardRef.current,
      priceListCardRef.current,
      hairGuideCardRef.current,
    ].filter(Boolean) as HTMLDivElement[];
    let observer: ResizeObserver | null = null;
    if (observedNodes.length && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => {
        measureServiceSectionHeight();
      });
      observedNodes.forEach((node) => observer?.observe(node));
    }

    window.addEventListener("resize", measureServiceSectionHeight);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measureServiceSectionHeight);
    };
  }, []);

  const [staffByService, setStaffByService] = useState<
    Record<string, StaffPublicWithId[]>
  >({});

  const [staffLoadingByService, setStaffLoadingByService] = useState<
    Record<string, boolean>
  >({});

  const [staffErrorByService, setStaffErrorByService] = useState<
    Record<string, string>
  >({});
  const staffAllCacheRef = useRef<StaffPublicWithId[] | null>(null);
  const staffByResolverCacheRef = useRef<Record<string, StaffPublicWithId[]>>({});
  const staffByResolverInFlightRef = useRef<Record<string, Promise<StaffPublicWithId[]>>>({});

  const resolvedFutureServiceId = useMemo(() => {
    const picked = String(servicePicker || "").trim();
    if (picked) return picked;
    const fixed = String(futureServiceId || "").trim();
    if (fixed) return fixed;
    const targetItem = (formData.items || []).find(
      (it) => String(it.id || "").trim() === String(futureTargetItemId || "").trim()
    );
    const fromTarget = String(targetItem?.serviceId || "").trim();
    if (fromTarget) return fromTarget;
    const fromCart = (formData.items || [])
      .map((it) => String(it?.serviceId || "").trim())
      .find(Boolean);
    return String(fromCart || "").trim();
  }, [futureServiceId, servicePicker, futureTargetItemId, formData.items]);

  useEffect(() => {
    const targetId = String(futureTargetItemId || "").trim();
    if (!targetId) return;
    const exists = (formData.items || []).some(
      (it) => String(it?.id || "").trim() === targetId
    );
    if (!exists) setFutureTargetItemId("");
  }, [futureTargetItemId, formData.items]);

  useEffect(() => {
    setExpandedConfirmedCartItems((prev) => {
      const prevIds = Object.keys(prev);
      if (!prevIds.length) return prev;

      const items = formData.items || [];
      const itemById = new Map(items.map((it) => [String(it.id), it]));
      const next: Record<string, true> = {};
      let changed = false;

      prevIds.forEach((id) => {
        const item = itemById.get(id);
        if (!item || !item.locked) {
          changed = true;
          return;
        }
        next[id] = true;
      });

      return changed ? next : prev;
    });
  }, [formData.items]);

  useEffect(() => {
    const sid = String(futureServiceId || "").trim();
    if (!sid) return;
    if (String(servicePicker || "").trim() === sid) return;
    const existsInCart = (formData.items || []).some(
      (it) => String(it?.serviceId || "").trim() === sid
    );
    if (!existsInCart) setFutureServiceId("");
  }, [futureServiceId, servicePicker, formData.items]);

  const [uiModal, setUiModal] = useState<UiModalState>({
    open: false,
    title: "",
    message: "",
    variant: "info",
    confirmText: "حسنًا",
  });

  const [onUiConfirm, setOnUiConfirm] = useState<null | (() => void)>(null);

  const openModal = (
    data: Omit<UiModalState, "open">,
    onConfirmAction?: () => void
  ) => {
    setOnUiConfirm(() => onConfirmAction ?? null);
    setUiModal({ open: true, ...data });
  };

  const closeModal = () => {
    setUiModal((p) => ({ ...p, open: false }));
    setOnUiConfirm(null);
  };

  // =========================
  // ✅ NEW: بحث العميلة (اسم/جوال)
  // =========================
  const [clientSearch, setClientSearch] = useState("");
  const [clientSearching, setClientSearching] = useState(false);
  const [clientSearchMsg, setClientSearchMsg] = useState("");
  const [selectedClient, setSelectedClient] = useState<any>(null);
  const [clientSearchResults, setClientSearchResults] = useState<any[]>([]);
  const [quickClientQuery, setQuickClientQuery] = useState("");

  function toClientCandidateFromBooking(b: any) {
    const name = String(b?.clientName || b?.name || b?.fullName || "").trim();
    const phone = phone10Digits(b?.clientPhone || b?.phone || b?.mobile || "");
    if (!name && !phone) return null;

    const bid = String(b?.id || "").trim();
    const pub = String(b?.publicId || b?.trackPublicId || b?.mk || "").trim();
    return {
      id: bid ? `booking:${bid}` : `booking:${pub || makeLocalId()}`,
      name,
      fullName: name,
      phone,
      mobile: phone,
      bookingId: bid,
      publicId: pub,
      bookingDate: String(b?.date || "").trim(),
      source: "booking",
    };
  }

  function getClientIdentityKey(raw: any): string {
    const phone = phone10Digits(raw?.phone || raw?.mobile || raw?.clientPhone || "");
    if (phone) return `p:${phone}`;
    const name = normalizeSearchText(String(raw?.name || raw?.fullName || raw?.clientName || ""));
    return name ? `n:${name}` : "";
  }

  function readQuickClientHistory(): Record<
    string,
    { name: string; phone: string; usedCount: number; lastUsedAt: number; source?: string }
  > {
    try {
      const raw = localStorage.getItem(QUICK_CLIENT_HISTORY_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeQuickClientHistory(
    history: Record<string, { name: string; phone: string; usedCount: number; lastUsedAt: number; source?: string }>
  ) {
    try {
      localStorage.setItem(QUICK_CLIENT_HISTORY_KEY, JSON.stringify(history));
    } catch {
      // ignore localStorage errors
    }
  }

  function markQuickClientUsage(raw: any) {
    const key = getClientIdentityKey(raw);
    if (!key) return;
    const history = readQuickClientHistory();
    const prev = history[key];
    history[key] = {
      name: String(raw?.name || raw?.fullName || raw?.clientName || prev?.name || "").trim(),
      phone: phone10Digits(raw?.phone || raw?.mobile || raw?.clientPhone || prev?.phone || ""),
      usedCount: Math.max(1, Number(prev?.usedCount || 0) + 1),
      lastUsedAt: Date.now(),
      source: String(raw?.source || prev?.source || "manual"),
    };
    writeQuickClientHistory(history);
  }

  function formatQuickClientLastUsed(lastUsedAt: number): string {
    if (!Number.isFinite(lastUsedAt) || lastUsedAt <= 0) return "";
    try {
      return new Intl.DateTimeFormat("ar-SA", { day: "2-digit", month: "2-digit" }).format(
        new Date(lastUsedAt)
      );
    } catch {
      return "";
    }
  }

  function formatQuickClientButtonLabel(candidate: any): string {
    const name = String(candidate?.name || candidate?.fullName || "بدون اسم").trim();
    const phone = phone10Digits(candidate?.phone || candidate?.mobile || candidate?.clientPhone || "");
    const phoneTail = phone ? phone.slice(-4) : "";
    const lastUsed = formatQuickClientLastUsed(Number(candidate?.quickLastUsedAt || 0));
    const pieces = [name];
    if (phoneTail) pieces.push(phoneTail);
    if (lastUsed) pieces.push(lastUsed);
    return pieces.join(" • ");
  }

  function applyClientSelection(found: any) {
    const name = String(found?.name || found?.fullName || "").trim();
    const phone = phone10Digits(found?.phone || found?.mobile || found?.clientPhone || "");

    setSelectedClient(found);
    setFormData((prev) => ({
      ...prev,
      name: name || prev.name,
      phone: phone || prev.phone,
    }));
    markQuickClientUsage(found);
  }

  const quickClientOptions = useMemo(() => {
    try {
      const history = readQuickClientHistory();
      const raw = localStorage.getItem("allBookings");
      const parsed = raw ? JSON.parse(raw) : [];
      const rows = Array.isArray(parsed) ? (parsed as any[]) : [];
      const byKey = new Map<string, any>();

      for (let i = rows.length - 1; i >= 0; i--) {
        const c = toClientCandidateFromBooking(rows[i]);
        if (!c) continue;
        const key = getClientIdentityKey(c);
        if (!key || byKey.has(key)) continue;
        const h = history[key];
        byKey.set(key, {
          ...c,
          quickKey: key,
          quickUsedCount: Number(h?.usedCount || 0),
          quickLastUsedAt: Number(h?.lastUsedAt || 0),
        });
      }

      Object.entries(history).forEach(([key, h]) => {
        if (byKey.has(key)) return;
        const name = String(h?.name || "").trim();
        const phone = phone10Digits(h?.phone || "");
        if (!name && !phone) return;
        byKey.set(key, {
          id: `history:${key}`,
          name: name || "بدون اسم",
          fullName: name || "بدون اسم",
          phone,
          mobile: phone,
          source: String(h?.source || "history"),
          quickKey: key,
          quickUsedCount: Math.max(0, Number(h?.usedCount || 0)),
          quickLastUsedAt: Math.max(0, Number(h?.lastUsedAt || 0)),
        });
      });

      return Array.from(byKey.values())
        .sort((a, b) => {
          const byLast = Number(b.quickLastUsedAt || 0) - Number(a.quickLastUsedAt || 0);
          if (byLast !== 0) return byLast;
          const byCount = Number(b.quickUsedCount || 0) - Number(a.quickUsedCount || 0);
          if (byCount !== 0) return byCount;
          return String(a.name || "").localeCompare(String(b.name || ""), "ar");
        })
        .slice(0, 10);
    } catch {
      return [] as any[];
    }
  }, [selectedClient, clientSearchResults.length]);

  const filteredQuickClientOptions = useMemo(() => {
    const q = normalizeSearchText(String(quickClientQuery || "").trim());
    const qDigits = phone10Digits(String(quickClientQuery || "").trim());
    if (!q && !qDigits) return quickClientOptions;
    return quickClientOptions.filter((candidate) => {
      const name = normalizeSearchText(String(candidate?.name || candidate?.fullName || ""));
      const phone = phone10Digits(candidate?.phone || candidate?.mobile || candidate?.clientPhone || "");
      return (!!q && name.includes(q)) || (!!qDigits && phone.includes(qDigits));
    });
  }, [quickClientOptions, quickClientQuery]);

  async function tryFindClientByPhoneOrName(raw: string) {
    const qRaw = String(raw || "").trim();
    const parsed = classifySearchKey(qRaw);
    const qDigits = parsed.kind === "phone" ? parsed.value : "";
    const qNameNeedle = normalizeSearchText(qRaw);

    const profileCollections = [
      collection(db, "salons", SALON_ID, "clients"),
      collection(db, "salons", SALON_ID, "users"),
      collection(db, "users"),
    ];
    const out: any[] = [];
    const seen = new Set<string>();

    const toCandidate = (rawCandidate: any) => {
      const name = String(
        rawCandidate?.name || rawCandidate?.fullName || rawCandidate?.clientName || ""
      ).trim();
      const phone = phone10Digits(
        rawCandidate?.phone || rawCandidate?.mobile || rawCandidate?.clientPhone || ""
      );
      const publicId = String(
        rawCandidate?.publicId || rawCandidate?.trackPublicId || rawCandidate?.mk || ""
      ).trim();
      const bookingId = String(rawCandidate?.bookingId || rawCandidate?.id || "").trim();
      const rawId = String(rawCandidate?.id || "").trim();
      const source = String(rawCandidate?.source || "profile").trim();

      if (!name && !phone && !publicId) return null;

      const normalizedName = normalizeSearchText(name);
      const identity = phone
        ? `phone:${normalizedName}|${phone}`
        : publicId
        ? `public:${normalizeSearchText(publicId)}`
        : `name:${normalizedName}|id:${rawId || bookingId || source}`;
      if (seen.has(identity)) return null;
      seen.add(identity);

      return {
        ...rawCandidate,
        id: rawId || `${source}:${bookingId || publicId || makeLocalId()}`,
        name: name || "بدون اسم",
        fullName: name || "بدون اسم",
        phone,
        mobile: phone,
        publicId,
        bookingId,
        source,
      };
    };

    const pushCandidate = (rawCandidate: any) => {
      const c = toCandidate(rawCandidate);
      if (c) out.push(c);
    };

    const runProfileEq = async (field: string, value: string, take = 20) => {
      const val = String(value || "").trim();
      if (!val) return;
      for (const col of profileCollections) {
        try {
          const snap = await getDocs(query(col, where(field, "==", val), limit(take)));
          snap.docs.forEach((d) =>
            pushCandidate({ id: d.id, ...(d.data() as any), source: "profile" })
          );
        } catch {
          // ignore
        }
      }
    };

    const runProfilePrefix = async (field: string, prefix: string, take = 25) => {
      const val = String(prefix || "").trim();
      if (!val) return;
      for (const col of profileCollections) {
        try {
          const snap = await getDocs(
            query(
              col,
              where(field, ">=", val),
              where(field, "<=", val + "\uf8ff"),
              orderBy(field, "asc"),
              limit(take)
            )
          );
          snap.docs.forEach((d) =>
            pushCandidate({ id: d.id, ...(d.data() as any), source: "profile" })
          );
        } catch {
          // ignore
        }
      }
    };

    const runProfileContainsFallback = async (needle: string, take = 120) => {
      const val = normalizeSearchText(needle);
      if (!val) return;

      for (const col of profileCollections) {
        try {
          const snap = await getDocs(query(col, limit(take)));
          snap.docs.forEach((d) => {
            const data = d.data() as any;
            const candidateName = String(
              data?.name || data?.fullName || data?.clientName || ""
            ).trim();
            if (!candidateName) return;
            if (normalizeSearchText(candidateName).includes(val)) {
              pushCandidate({ id: d.id, ...data, source: "profile" });
            }
          });
        } catch {
          // ignore
        }
      }
    };

    if (qDigits) {
      await runProfileEq("phone", qDigits, 25);
      await runProfileEq("mobile", qDigits, 25);
    }

    if (qNameNeedle) {
      const rawName = normalizeDigits(qRaw);
      await runProfileEq("name", rawName, 20);
      await runProfileEq("fullName", rawName, 20);
      await runProfileEq("nameLower", qNameNeedle, 20);
      await runProfilePrefix("nameLower", qNameNeedle, 35);
      await runProfileContainsFallback(qNameNeedle, 120);
    }

    // Include matches that exist only on bookings
    const bookings = await searchBookingsForReception(qRaw);
    bookings.forEach((b) => {
      const c = toClientCandidateFromBooking(b);
      if (c) pushCandidate(c);
    });

    const phoneNeedle = phone10Digits(qRaw);
    const nameNeedle = normalizeSearchText(qRaw);
    const publicNeedles = (parsed.kind === "publicId" ? parsed.publicIdCandidates : [])
      .map((x) => normalizeSearchText(x))
      .filter(Boolean);

    const idNeedle = normalizeSearchText(qRaw);

    const scoreCandidate = (candidate: any) => {
      let score = 0;
      const cName = normalizeSearchText(String(candidate?.name || candidate?.fullName || ""));
      const cPhone = phone10Digits(candidate?.phone || candidate?.mobile || "");
      const cPublic = normalizeSearchText(
        String(candidate?.publicId || candidate?.bookingId || "")
      );
      const cId = normalizeSearchText(
        String(candidate?.bookingId || candidate?.id || candidate?.publicId || "")
      );

      if (phoneNeedle) {
        if (cPhone === phoneNeedle) score -= 40;
        else if (cPhone.includes(phoneNeedle)) score -= 20;
      }

      if (nameNeedle) {
        if (cName === nameNeedle) score -= 35;
        else if (cName.startsWith(nameNeedle)) score -= 25;
        else if (cName.includes(nameNeedle)) score -= 10;
      }

      if (publicNeedles.length && publicNeedles.some((n) => cPublic.includes(n))) {
        score -= 30;
      }

      if (parsed.kind === "id" && idNeedle) {
        if (cId === idNeedle) score -= 45;
        else if (cId.includes(idNeedle)) score -= 20;
      }

      return score;
    };

    const scored = out
      .map((candidate) => ({ candidate, score: scoreCandidate(candidate) }))
      .filter((x) => x.score < 0);

    if (!scored.length) return [];

    scored.sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return String(a.candidate?.name || "").localeCompare(
        String(b.candidate?.name || ""),
        "ar"
      );
    });

    return scored.map((x) => x.candidate).slice(0, 25);
  }

  const handleSearchClient = async () => {
    const q = String(clientSearch || "").trim();
    if (!q) {
      setClientSearchMsg("اكتبي اسم أو رقم جوال للبحث.");
      return;
    }

    const qKind = classifySearchKey(q).kind;
    if (qKind === "publicId" || qKind === "id") {
      setClientSearchMsg("في بيانات العميلة، البحث يكون بالاسم أو رقم الجوال فقط.");
      return;
    }

    setClientSearching(true);
    setClientSearchMsg("");
    setSelectedClient(null);
    setClientSearchResults([]);

    try {
      const found = await tryFindClientByPhoneOrName(q);

      if (!found.length) {
        setClientSearchMsg("ما لقينا بيانات مطابقة. ابحثي بالاسم أو الجوال.");
        return;
      }

      setClientSearchResults(found);

      if (found.length === 1) {
        applyClientSelection(found[0]);
        setClientSearchMsg("تم جلب بيانات العميلة ✅");
        return;
      }

      setClientSearchMsg(`تم العثور على ${found.length} نتائج. اختاري العميلة الصحيحة من القائمة.`);
    } catch {
      setClientSearchMsg("صار خطأ أثناء البحث.");
    } finally {
      setClientSearching(false);
    }
  };

  // =========================
  // ✅ NEW: بحث الحجز الموجود (جوال / MK / bookingId)
  // =========================
  const [bookingSearch, setBookingSearch] = useState("");
  const [bookingSearching, setBookingSearching] = useState(false);
  const [bookingSearchMsg, setBookingSearchMsg] = useState("");
  const [internalPaymentModalOpen, setInternalPaymentModalOpen] = useState(false);
  const [internalPaymentMethodDraft, setInternalPaymentMethodDraft] = useState<
    "" | "cash" | "card" | "transfer"
  >("");
  const internalPaymentMethodRef = useRef<"cash" | "card" | "transfer" | null>(null);
  const internalSubmitModeRef = useRef<"payment" | "future">("payment");
  const internalBookingFormRef = useRef<HTMLFormElement | null>(null);
  const pendingInvoicePopupRef = useRef<Window | null>(null);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [confirmTargetBooking, setConfirmTargetBooking] = useState<any | null>(null);
  const [confirmPaymentMethod, setConfirmPaymentMethod] = useState<"cash" | "card">("cash");
  const [refundModalOpen, setRefundModalOpen] = useState(false);
  const [refundTargetBooking, setRefundTargetBooking] = useState<any | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [refundDetails, setRefundDetails] = useState("");
  const [foundBookings, setFoundBookings] = useState<any[]>([]);
  const [selectedExistingBooking, setSelectedExistingBooking] = useState<any>(null);
  const [bookingNameChoices, setBookingNameChoices] = useState<
    { key: string; name: string; phone: string; count: number }[]
  >([]);
  const [selectedBookingNameKey, setSelectedBookingNameKey] = useState("");

  const displayFoundBookings = useMemo(() => {
    if (bookingNameChoices.length > 1 && !selectedBookingNameKey) return [] as any[];
    if (!selectedBookingNameKey) return foundBookings;
    return foundBookings.filter((b) => {
      const name = String(b?.clientName || b?.name || b?.fullName || "").trim();
      return normalizeSearchText(name) === selectedBookingNameKey;
    });
  }, [foundBookings, selectedBookingNameKey, bookingNameChoices.length]);

  const displayFoundBookingBlocks = useMemo(() => {
    const blocks = new Map<string, { key: string; label: string; bookings: any[] }>();

    (displayFoundBookings || []).forEach((b) => {
      const key = resolveBookingBlockKey(b);
      const current = blocks.get(key);
      if (current) {
        current.bookings.push(b);
        return;
      }

      const label =
        extractBookingPublicIdBase(b) ||
        String(b?.publicId || b?.trackPublicId || b?.mk || "").trim() ||
        "بدون رقم";

      blocks.set(key, { key, label, bookings: [b] });
    });

    const out = Array.from(blocks.values());
    out.forEach((block) => {
      block.bookings.sort((a, b) => {
        const da = String(a?.date || "");
        const db = String(b?.date || "");
        if (da !== db) return da.localeCompare(db);
        const ta = toMinutes(String(a?.time || ""));
        const tb = toMinutes(String(b?.time || ""));
        const ma = Number.isFinite(ta) ? ta : Number.MAX_SAFE_INTEGER;
        const mb = Number.isFinite(tb) ? tb : Number.MAX_SAFE_INTEGER;
        return ma - mb;
      });
    });

    return out;
  }, [displayFoundBookings]);

  type ReceptionSearchKind = "empty" | "phone" | "publicId" | "name" | "id";

  function normalizeSearchKey(raw: string) {
    return normalizeDigits(String(raw || "").trim());
  }

  function classifySearchKey(q: string): {
    kind: ReceptionSearchKind;
    value: string;
    publicIdCandidates: string[];
  } {
    const s = normalizeSearchKey(q);
    if (!s) return { kind: "empty", value: "", publicIdCandidates: [] };

    // 1) phone
    const digits10 = phone10Digits(s);
    if (/^05\d{8}$/.test(digits10)) {
      return { kind: "phone", value: digits10, publicIdCandidates: [] };
    }

    // 2) MK / QS / any prefixed publicId
    const compact = s.replace(/\s+/g, "").replace(/_/g, "-");
    const prefixed = compact.match(/^([A-Za-z]{2})-?(\d{1,12})$/);
    if (prefixed) {
      const prefix = prefixed[1].toUpperCase();
      const num = prefixed[2];
      const candidates = Array.from(
        new Set<string>([
          `${prefix}-${num}`,
          `${prefix}${num}`,
          compact.toUpperCase(),
        ])
      );
      return {
        kind: "publicId",
        value: `${prefix}-${num}`,
        publicIdCandidates: candidates,
      };
    }

    if (/^(mk|qs)\b/i.test(s) || /^mk[-_ ]?/i.test(s) || /^qs[-_ ]?/i.test(s)) {
      const cleaned = compact.toUpperCase();
      const m = cleaned.match(/^([A-Z]{2})-?(\d+)$/);
      if (m) {
        const prefix = m[1];
        const num = m[2];
        return {
          kind: "publicId",
          value: `${prefix}-${num}`,
          publicIdCandidates: [`${prefix}-${num}`, `${prefix}${num}`, cleaned],
        };
      }
      return { kind: "publicId", value: cleaned, publicIdCandidates: [cleaned] };
    }

    // 3) digits only => treat as MK number
    const onlyDigits = compact.replace(/\D/g, "");
    if (onlyDigits && onlyDigits.length >= 3 && onlyDigits.length <= 12) {
      return {
        kind: "publicId",
        value: `MK-${onlyDigits}`,
        publicIdCandidates: [`MK-${onlyDigits}`, `MK${onlyDigits}`, onlyDigits],
      };
    }

    // 4) otherwise treat as name
    const hasLetters = /[A-Za-z\u0600-\u06FF]/.test(s);
    if (hasLetters) return { kind: "name", value: s.trim(), publicIdCandidates: [] };

    // 5) fallback: doc id
    return { kind: "id", value: s, publicIdCandidates: [] };
  }

  function readBookingSectionLabel(booking: any) {
    return String(
      booking?.serviceSectionTitle ||
        booking?.serviceSnapshot?.sectionTitleAtBooking ||
        booking?.serviceSnapshot?.sectionIdAtBooking ||
        booking?.serviceSectionId ||
        ""
    ).trim();
  }

  function readBookingCategoryLabel(booking: any) {
    return String(
      booking?.serviceCategoryName ||
        booking?.serviceSnapshot?.categoryNameAtBooking ||
        booking?.serviceSnapshot?.categoryIdAtBooking ||
        booking?.serviceCategoryId ||
        ""
    ).trim();
  }

  function extractBookingPublicIdBase(booking: any) {
    const raw = String(booking?.publicId || booking?.trackPublicId || booking?.mk || "")
      .trim()
      .toUpperCase();
    if (!raw) return "";
    const m = raw.match(/^(MK-\d+)(?:-\d+)?$/i);
    return m ? m[1].toUpperCase() : raw;
  }

  function resolveBookingBlockKey(booking: any) {
    const groupId = String(booking?.bookingGroupId || booking?.parentBookingId || "").trim();
    if (groupId) return `group:${groupId}`;

    const raw = String(booking?.publicId || booking?.trackPublicId || booking?.mk || "")
      .trim()
      .toUpperCase();
    const base = extractBookingPublicIdBase(booking);
    if (base && raw && raw.startsWith(`${base}-`)) return `public:${base}`;

    const id = String(booking?.id || booking?.bookingId || raw || "").trim();
    return `single:${id || "unknown"}`;
  }

  async function searchBookingsForReception(raw: string) {
    const q0 = normalizeSearchKey(raw);
    const q = classifySearchKey(q0);
    if (q.kind === "empty") return [];

    const colBookings = collection(db, "salons", SALON_ID, "bookings");
    const out: any[] = [];
    const seen = new Set<string>();

    const pushDoc = (id: string, data: any) => {
      const safeId = String(id || "").trim();
      if (!safeId || seen.has(safeId)) return;
      seen.add(safeId);
      out.push({ id: safeId, ...(data || {}) });
    };

    const appendSnapshot = (snap: any) => {
      snap.docs.forEach((d: any) => pushDoc(d.id, d.data() as any));
    };

    const runEq = async (field: string, value: string, take = 25) => {
      const v = String(value || "").trim();
      if (!v) return;
      try {
        const snap = await getDocs(query(colBookings, where(field, "==", v), limit(take)));
        appendSnapshot(snap);
      } catch {
        // ignore
      }
    };

    const runPrefix = async (field: string, prefix: string, take = 25) => {
      const p = String(prefix || "").trim();
      if (!p) return;
      try {
        const snap = await getDocs(
          query(
            colBookings,
            where(field, ">=", p),
            where(field, "<=", p + "\uf8ff"),
            orderBy(field, "asc"),
            limit(take)
          )
        );
        appendSnapshot(snap);
      } catch {
        // ignore
      }
    };

    const runRecent = async (take = 160) => {
      try {
        const snap = await getDocs(
          query(colBookings, orderBy("createdAt", "desc"), limit(take))
        );
        appendSnapshot(snap);
      } catch {
        try {
          const snap = await getDocs(query(colBookings, limit(take)));
          appendSnapshot(snap);
        } catch {
          // ignore
        }
      }
    };

    // 1) by phone
    if (q.kind === "phone") {
      await runEq("clientPhone", q.value, 40);
      await runEq("phone", q.value, 40);
    }

    // 2) by public id
    if (q.kind === "publicId") {
      for (const candidate of q.publicIdCandidates) {
        await runEq("publicId", candidate, 25);
        await runEq("trackPublicId", candidate, 25);
        await runEq("mk", candidate, 25);
      }
    }

    // 3) by name (case-insensitive, Arabic/English)
    if (q.kind === "name") {
      const nameRaw = String(q.value || "").trim();
      const nameLower = normalizeDigits(nameRaw).toLowerCase();
      const nameNeedle = normalizeSearchText(nameRaw);

      await runPrefix("clientNameLower", nameLower, 30);
      await runPrefix("nameLower", nameLower, 30);
      if (nameNeedle && nameNeedle !== nameLower) {
        await runPrefix("clientNameLower", nameNeedle, 30);
        await runPrefix("nameLower", nameNeedle, 30);
      }
      await runEq("clientName", nameRaw, 20);
      await runEq("name", nameRaw, 20);
    }

    // 4) by doc id direct (always try as fallback)
    const idCandidates = Array.from(
      new Set<string>([q.value, q0, String(raw || "").trim()].filter(Boolean))
    );
    for (const idCandidate of idCandidates) {
      try {
        const snap = await getDoc(doc(db, "salons", SALON_ID, "bookings", idCandidate));
        if (snap.exists()) pushDoc(snap.id, snap.data() as any);
      } catch {
        // ignore
      }
    }

    // 5) broad fallback (helps when lower fields are missing or casing differs)
    if (q.kind === "name" || out.length === 0) {
      await runRecent(160);

      const qName = normalizeSearchText(q0);
      const qPhone = phone10Digits(q0);
      const qPublicIds = (q.kind === "publicId" ? q.publicIdCandidates : [q0])
        .map((v) => normalizeSearchText(v))
        .filter(Boolean);

      const filtered = out.filter((b) => {
        const nameCandidate = normalizeSearchText(
          String(b?.clientName || b?.name || b?.fullName || "")
        );
        const phoneCandidate = phone10Digits(
          String(b?.clientPhone || b?.phone || b?.mobile || "")
        );
        const publicIdCandidate = normalizeSearchText(
          String(b?.publicId || b?.trackPublicId || b?.mk || "")
        );

        if (q.kind === "phone") return !!qPhone && phoneCandidate.includes(qPhone);
        if (q.kind === "publicId") {
          return qPublicIds.some((needle) => publicIdCandidate.includes(needle));
        }
        if (q.kind === "name") return !!qName && nameCandidate.includes(qName);

        return (
          (!!qPhone && phoneCandidate.includes(qPhone)) ||
          (!!qName && (nameCandidate.includes(qName) || publicIdCandidate.includes(qName)))
        );
      });

      if (filtered.length) {
        out.splice(0, out.length, ...filtered);
      }
    }

    const toEpoch = (v: any) => {
      if (!v) return 0;
      if (typeof v === "number") return v;
      if (typeof v === "string") {
        const t = Date.parse(v);
        return Number.isFinite(t) ? t : 0;
      }
      if (typeof v?.toDate === "function") {
        const t = v.toDate();
        return t instanceof Date ? t.getTime() : 0;
      }
      if (Number.isFinite(v?.seconds)) {
        const sec = Number(v.seconds);
        const ns = Number(v.nanoseconds || 0);
        return sec * 1000 + Math.floor(ns / 1_000_000);
      }
      return 0;
    };

    out.sort((a, b) => toEpoch(b?.createdAt) - toEpoch(a?.createdAt));
    return out.slice(0, 25);
  }

  async function applyFutureTimeSelection(dateISO: string, time24: string) {
    const serviceId = String(resolvedFutureServiceId || futureServiceId || "").trim();
    if (!serviceId || !dateISO || !time24) return;

    applyBookingDate(dateISO);

    const target =
      (formData.items || []).find(
        (it) =>
          String(it.id || "").trim() === String(futureTargetItemId || "").trim() &&
          String(it.serviceId || "").trim() === serviceId
      ) ||
      (formData.items || []).find(
        (it) => String(it.serviceId || "").trim() === serviceId && !it.locked
      ) ||
      (formData.items || []).find((it) => String(it.serviceId || "").trim() === serviceId);

    if (!target) return;
    const targetItemId = String(target.id || "").trim();

    const sv = getServiceById(serviceId);
    const durationMin = Number(
      sv?.durationMin ||
      target?.durationMin ||
      DEFAULT_SERVICE_DURATION_MIN
    );

    let staffList = (staffByService[serviceId] || []) as StaffPublicWithId[];
    if (!Object.prototype.hasOwnProperty.call(staffByService, serviceId)) {
      const res = await listStaffForService(serviceId, sv);
      staffList = (res || []) as StaffPublicWithId[];
      setStaffByService((p) => ({ ...p, [serviceId]: staffList }));
    }

    const preferredEmployeeKey = String(
      futureSelectedEmployeeKey ||
      target.employeeUid ||
      target.employeeId ||
      ""
    ).trim();

    let chosenStaff: StaffPublicWithId | null = null;

    if (!futureAnyStaff) {
      const fixedKey = String(futureSelectedEmployeeKey || "").trim();
      if (fixedKey) {
        chosenStaff =
          staffList.find((s: any) => String(s.linkedUid || s.id || "").trim() === fixedKey) ||
          staffList.find((s: any) => String(s.id || "").trim() === fixedKey) ||
          null;
      }
    } else {
      const availableStaffRaw = staffList.filter((st: any) =>
        isStaffAvailableForDate(st, dateISO, { requireShowOnBooking: true })
      );
      const availableStaff = preferredEmployeeKey
        ? [
          ...availableStaffRaw.filter(
            (st: any) =>
              String(st?.linkedUid || st?.id || "").trim() === preferredEmployeeKey ||
              String(st?.id || "").trim() === preferredEmployeeKey
          ),
          ...availableStaffRaw.filter(
            (st: any) =>
              String(st?.linkedUid || st?.id || "").trim() !== preferredEmployeeKey &&
              String(st?.id || "").trim() !== preferredEmployeeKey
          ),
        ]
        : availableStaffRaw;

      for (const st of availableStaff) {
        const empKey = String((st as any)?.linkedUid || "").trim() || String((st as any)?.id || "").trim();
        const empIdFallback = String((st as any)?.id || "").trim();
        if (!empKey) continue;
        const localTaken = targetItemId
          ? getLocalTakenTimesForItem(
            formData.items || [],
            targetItemId,
            empKey,
            dateISO,
            empIdFallback
          )
          : new Set<string>();

        const starts = await getAvailableStartsForDay({
          salonId: SALON_ID,
          employeeKey: empKey,
          employeeIdFallback: empIdFallback,
          employeeUidFallback: String((st as any)?.linkedUid || (st as any)?.uid || "").trim(),
          employeeNameFallback: String((st as any)?.name || "").trim(),
          dateISO,
          durationMin,
          take: 288,
          localTakenTimes: localTaken,
          staff: st,
        });
        if (starts.includes(time24)) {
          chosenStaff = st;
          break;
        }
      }
    }

    if (!futureAnyStaff && chosenStaff) {
      const chosenKey =
        String((chosenStaff as any)?.linkedUid || "").trim() ||
        String((chosenStaff as any)?.id || "").trim();
      const chosenId = String((chosenStaff as any)?.id || "").trim();
      const localTaken = targetItemId
        ? getLocalTakenTimesForItem(
          formData.items || [],
          targetItemId,
          chosenKey,
          dateISO,
          chosenId
        )
        : new Set<string>();
      const starts = await getAvailableStartsForDay({
        salonId: SALON_ID,
        employeeKey: chosenKey,
        employeeIdFallback: chosenId,
        employeeUidFallback: String((chosenStaff as any)?.linkedUid || "").trim(),
        employeeNameFallback: String((chosenStaff as any)?.name || "").trim(),
        dateISO,
        durationMin,
        take: 288,
        localTakenTimes: localTaken,
        staff: chosenStaff,
      });
      if (!starts.includes(time24)) {
        chosenStaff = null;
      }
    }

    if (!chosenStaff) {
      setFutureMsg("تم تحديد اليوم والوقت. اختاري الموظفة لإكمال الخدمة.");
      updateItem(target.id, { date: dateISO, time: time24, locked: false });
      return;
    }

    updateItem(target.id, {
      date: dateISO,
      time: time24,
      employeeId: String((chosenStaff as any)?.id || "").trim(),
      employeeUid: String((chosenStaff as any)?.linkedUid || "").trim(),
      employeeName: String((chosenStaff as any)?.name || "").trim(),
      locked: false,
    });
  }

  async function handleFutureSlotPick(dateISO: string, time24: string) {
    const d = String(dateISO || "").trim();
    const t = String(time24 || "").trim();
    if (!d || !t) return;

    try {
      await applyFutureTimeSelection(d, t);
      const timeLabel = formatTime12(t, t);
      openModal({
        title: "تم اختيار الموعد ✅",
        message: `التاريخ: ${d} - الوقت: ${timeLabel}`,
        variant: "info",
        confirmText: "تمام",
      });
    } catch (e: any) {
      openModal({
        title: "تعذر اختيار الموعد",
        message:
          `صار خطأ أثناء تثبيت الموعد.\n\n` +
          `code: ${String(e?.code || "—")}\n` +
          `message: ${String(e?.message || "—")}`,
        variant: "danger",
        confirmText: "حسنًا",
      });
    }
  }

  async function runFutureAvailabilitySearch(overrides?: {
    serviceId?: string;
    anyStaff?: boolean;
    employeeKey?: string;
    employeeName?: string;
    startISO?: string;
    targetItemId?: string;
  }) {
    setFutureMsg("");
    setFutureResult([]);

    const cartItems = formData.items || [];
    const explicitTargetItemId = String(
      overrides?.targetItemId || futureTargetItemId || ""
    ).trim();
    const targetItemById = explicitTargetItemId
      ? cartItems.find((it) => String(it?.id || "").trim() === explicitTargetItemId) || null
      : null;
    const fallbackServiceIdFromCart = String(
      targetItemById?.serviceId || cartItems[0]?.serviceId || ""
    ).trim();
    const serviceId = String(
      overrides?.serviceId ?? servicePicker ?? futureServiceId ?? fallbackServiceIdFromCart ?? ""
    ).trim();
    if (!serviceId) {
      setFutureMsg("اختاري خدمة أولاً.");
      return;
    }

    if (serviceId !== String(futureServiceId || "").trim()) {
      setFutureServiceId(serviceId);
    }
    if (explicitTargetItemId && explicitTargetItemId !== String(futureTargetItemId || "").trim()) {
      setFutureTargetItemId(explicitTargetItemId);
    } else if (!explicitTargetItemId) {
      const currentTarget = (cartItems || []).find(
        (it) => String(it?.id || "").trim() === String(futureTargetItemId || "").trim()
      );
      if (
        currentTarget &&
        String(currentTarget.serviceId || "").trim() !== serviceId
      ) {
        setFutureTargetItemId("");
      }
    }

    const sv = getServiceById(serviceId);
    const itemFromCart =
      (targetItemById &&
        String(targetItemById.serviceId || "").trim() === serviceId
        ? targetItemById
        : null) ||
      cartItems.find((it) => String(it?.serviceId || "").trim() === serviceId) ||
      null;
    const targetItemId = String(
      overrides?.targetItemId ||
      ((targetItemById &&
        String(targetItemById.serviceId || "").trim() === serviceId)
        ? targetItemById.id
        : "") ||
      itemFromCart?.id ||
      ""
    ).trim();

    const durationMin = Number(
      sv?.durationMin ||
      itemFromCart?.durationMin ||
      DEFAULT_SERVICE_DURATION_MIN
    );
    if (!durationMin || durationMin <= 0) {
      setFutureMsg("مدة الخدمة غير صحيحة.");
      return;
    }

    let staffList = (staffByService[serviceId] || []) as StaffPublicWithId[];
    const hasStaffCache = Object.prototype.hasOwnProperty.call(staffByService, serviceId);
    if (!hasStaffCache) {
      const res = await listStaffForService(serviceId, sv);
      staffList = (res || []).filter((st: any) => String(st?.name || "").trim()) as any;

      setStaffByService((p) => ({ ...p, [serviceId]: staffList }));
    }

    const anyStaff =
      typeof overrides?.anyStaff === "boolean" ? overrides.anyStaff : futureAnyStaff;
    const desiredEmployeeName = String(
      overrides?.employeeName ?? futureStaffNameQuery ?? ""
    ).trim();
    let fixedEmployeeKey = String(
      overrides?.employeeKey || futureSelectedEmployeeKey || ""
    ).trim();
    if (!fixedEmployeeKey && !anyStaff && desiredEmployeeName) {
      const lowerName = desiredEmployeeName.toLowerCase();
      const hit = staffList.find(
        (s: any) => String(s?.name || "").trim().toLowerCase() === lowerName
      );
      fixedEmployeeKey = String((hit as any)?.linkedUid || (hit as any)?.uid || hit?.id || "").trim();
    }
    if (!anyStaff && !fixedEmployeeKey) {
      setFutureMsg("اختاري موظفة محددة أو اختاري (أي موظفة للخدمة).");
      return;
    }

    const startISO = String(overrides?.startISO || bookingDate || "").trim() || todayISO();
    const scanDays = 60;

    setFutureLoading(true);
    try {
      const results: { date: string; times: string[]; note?: string; contributors?: string[] }[] = [];
      const baseSlots =
        timeSlots.length > 0
          ? timeSlots
          : generateSalonTimeSlots(openTime, closeTime, slotStepMin);

      for (let i = 0; i < scanDays; i++) {
        const dateISO = addDaysISO(startISO, i);
        let dayTimes: string[] = [];
        let dayNote = "";

        if (!anyStaff && fixedEmployeeKey) {
          const staff =
            staffList.find((s: any) => String(s.linkedUid || s.id || "") === fixedEmployeeKey) ||
            staffList.find((s: any) => String(s.id || "") === fixedEmployeeKey);
          const employeeIdFallback = String(staff?.id || "").trim();
          const fixedName = String((staff as any)?.name || "").trim();
          const fixedAvailable = staff
            ? isStaffAvailableForDate(staff as any, dateISO, { requireShowOnBooking: true })
            : false;

          if (!fixedAvailable) {
            dayTimes = [];
            dayNote = "";
          } else {
            const localTaken = targetItemId
              ? getLocalTakenTimesForItem(
                formData.items || [],
                targetItemId,
                fixedEmployeeKey,
                dateISO,
                employeeIdFallback
              )
              : new Set<string>();
            dayTimes = await getAvailableStartsForDay({
              salonId: SALON_ID,
              employeeKey: fixedEmployeeKey,
              employeeIdFallback,
              employeeUidFallback: String((staff as any)?.linkedUid || (staff as any)?.uid || "").trim(),
              employeeNameFallback: fixedName,
              dateISO,
              durationMin,
              take: 5,
              localTakenTimes: localTaken,
              staff: staff || null,
            });

            if (dayTimes.length && fixedName) {
              dayNote = `المتاح لدى: ${fixedName}`;
            }
          }
          const fixedContributors = fixedName ? [fixedName] : [];
          if (dayTimes.length) {
            results.push({ date: dateISO, times: dayTimes, note: dayNote, contributors: fixedContributors });
            if (results.length >= 5) break;
          }
        } else {
          const merged = new Set<string>();
          const timeToStaff = new Map<string, Set<string>>();
          const availableStaff = staffList.filter((st) =>
            isStaffAvailableForDate(st as any, dateISO, { requireShowOnBooking: true })
          );
          for (const st of availableStaff) {
            const empKey = String((st as any)?.linkedUid || "").trim() || String((st as any)?.id || "").trim();
            const empIdFallback = String((st as any)?.id || "").trim();
            if (!empKey) continue;
            const localTaken = targetItemId
              ? getLocalTakenTimesForItem(
                formData.items || [],
                targetItemId,
                empKey,
                dateISO,
                empIdFallback
              )
              : new Set<string>();

            const times = await getAvailableStartsForDay({
              salonId: SALON_ID,
              employeeKey: empKey,
              employeeIdFallback: empIdFallback,
              employeeUidFallback: String((st as any)?.linkedUid || (st as any)?.uid || "").trim(),
              employeeNameFallback: String((st as any)?.name || "").trim(),
              dateISO,
              durationMin,
              take: 5,
              localTakenTimes: localTaken,
              staff: st,
            });
            if (times.length) {
              const stName = String((st as any)?.name || "").trim();
              times.forEach((t) => {
                merged.add(t);
                if (!stName) return;
                const owners = timeToStaff.get(t) || new Set<string>();
                owners.add(stName);
                timeToStaff.set(t, owners);
              });
            }
          }

          dayTimes = sortTimesBySlotOrder(Array.from(merged.values()), baseSlots).slice(0, 5);

          if (dayTimes.length) {
            const visibleContributors = new Set<string>();
            dayTimes.forEach((t) => {
              const owners = timeToStaff.get(t);
              if (!owners) return;
              owners.forEach((name) => visibleContributors.add(name));
            });
            if (visibleContributors.size) {
              dayNote = `المتاح لدى: ${Array.from(visibleContributors).slice(0, 3).join("، ")}`;
            }
            results.push({
              date: dateISO,
              times: dayTimes,
              note: dayNote,
              contributors: Array.from(visibleContributors),
            });
            if (results.length >= 5) break;
          }
        }
      }

      if (!results.length) {
        setFutureMsg("ما لقينا أوقات متاحة ضمن الفترة.");
        return;
      }

      setFutureResult(results);
    } catch (e: any) {
      setFutureMsg(`صار خطأ أثناء البحث: ${String(e?.message || e)}`);
    } finally {
      setFutureLoading(false);
    }
  }

  const handleSearchBooking = async () => {
    const q = String(bookingSearch || "").trim();
    if (!q) {
      setBookingSearchMsg("اكتب اسم أو رقم جوال أو رقم الحجز (MK) أو رقم الوثيقة.");
      return;
    }

    setBookingSearching(true);
    setBookingSearchMsg("");
    setFoundBookings([]);
    setSelectedExistingBooking(null);
    setBookingNameChoices([]);
    setSelectedBookingNameKey("");

    try {
      const res = await searchBookingsForReception(q);
      if (!res.length) {
        setBookingSearchMsg("ما لقينا حجوزات مطابقة.");
        return;
      }
      const queryKind = classifySearchKey(q).kind;
      const nameChoicesMap = new Map<string, { key: string; name: string; phone: string; count: number }>();
      res.forEach((b: any) => {
        const rawName = String(b?.clientName || b?.name || b?.fullName || "").trim();
        const key = normalizeSearchText(rawName);
        if (!key) return;
        const phone = phone10Digits(String(b?.clientPhone || b?.phone || b?.mobile || ""));
        const prev = nameChoicesMap.get(key);
        if (!prev) {
          nameChoicesMap.set(key, {
            key,
            name: rawName || "بدون اسم",
            phone,
            count: 1,
          });
          return;
        }
        prev.count += 1;
      });

      const nameChoices = Array.from(nameChoicesMap.values()).sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return a.name.localeCompare(b.name, "ar");
      });

      setFoundBookings(res);

      if (queryKind === "name" && nameChoices.length > 1) {
        setBookingNameChoices(nameChoices);
        setSelectedBookingNameKey("");
        setBookingSearchMsg(
          `تم العثور على ${res.length} حجز لنفس البحث. اختاري الاسم الصحيح من القائمة.`
        );
      } else {
        setBookingNameChoices([]);
        setSelectedBookingNameKey("");
        setBookingSearchMsg(`تم العثور على ${res.length} حجز ✅`);
      }
    } catch {
      setBookingSearchMsg("صار خطأ أثناء البحث عن الحجز.");
    } finally {
      setBookingSearching(false);
    }
  };

  function todayISO() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  }

  function openConfirmAndPrintModal(b: any) {
    setConfirmTargetBooking(b || null);
    setConfirmPaymentMethod("cash");
    setPaymentModalOpen(true);
  }

  function primeInternalPrintPopup() {
    const current = pendingInvoicePopupRef.current;
    if (current && !current.closed) {
      current.focus();
      return true;
    }
    const popup = window.open(
      "about:blank",
      "internal_print_popup",
      "width=980,height=900,menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes"
    );
    if (popup) {
      pendingInvoicePopupRef.current = popup;
      try {
        popup.document.title = "جاري تجهيز الفاتورة";
      } catch {
        // ignore
      }
      popup.focus();
      return true;
    }
    return false;
  }

  function closePendingInvoicePopup() {
    const popup = pendingInvoicePopupRef.current;
    if (popup && !popup.closed) {
      try {
        popup.close();
      } catch {
        // ignore
      }
    }
    pendingInvoicePopupRef.current = null;
  }

  function openInternalPrintPopup() {
    const invoiceUrl = `${window.location.origin}/success-internal`;
    const pending = pendingInvoicePopupRef.current;
    if (pending && !pending.closed) {
      try {
        pending.location.href = invoiceUrl;
      } catch {
        // ignore and fallback to fresh popup
      }
      pending.focus();
      pendingInvoicePopupRef.current = null;
      return true;
    }
    const popup = window.open(
      invoiceUrl,
      "internal_print_popup",
      "width=980,height=900,menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes"
    );
    if (popup) {
      popup.focus();
      return true;
    }
    return false;
  }

  function notifyInvoicePopupBlocked() {
    closePendingInvoicePopup();
    openModal({
      title: "تعذر فتح الفاتورة",
      message: "تم منع فتح نافذة الفاتورة. فعلي فتح النوافذ المنبثقة (Pop-ups) للموقع ثم المحاولة مرة أخرى.",
      variant: "danger",
      confirmText: "تمام",
    });
  }

  function enrichBookingForPrint(rawBooking: any) {
    const booking = rawBooking || {};
    const serviceId = String(booking?.serviceId || booking?.service || "").trim();
    const sv = serviceId ? getServiceById(serviceId) : null;

    const sectionId = String(
      booking?.serviceSectionId ||
        booking?.serviceSnapshot?.sectionIdAtBooking ||
        sv?.sectionId ||
        ""
    ).trim();
    const sectionTitle = String(
      booking?.serviceSectionTitle ||
        booking?.serviceSnapshot?.sectionTitleAtBooking ||
        sv?.sectionTitle ||
        sectionId ||
        ""
    ).trim();
    const categoryId = String(
      booking?.serviceCategoryId ||
        booking?.serviceSnapshot?.categoryIdAtBooking ||
        sv?.categoryId ||
        ""
    ).trim();
    const categoryName = String(
      booking?.serviceCategoryName ||
        booking?.serviceSnapshot?.categoryNameAtBooking ||
        sv?.category ||
        categoryId ||
        ""
    ).trim();
    const serviceName = String(
      booking?.serviceName ||
        booking?.serviceSnapshot?.serviceNameAtBooking ||
        sv?.name ||
        ""
    ).trim();

    return {
      ...booking,
      serviceSectionId: sectionId || undefined,
      serviceSectionTitle: sectionTitle || undefined,
      serviceCategoryId: categoryId || undefined,
      serviceCategoryName: categoryName || undefined,
      serviceSnapshot: {
        ...(booking?.serviceSnapshot || {}),
        serviceNameAtBooking: serviceName || undefined,
        sectionIdAtBooking: sectionId || undefined,
        sectionTitleAtBooking: sectionTitle || undefined,
        categoryIdAtBooking: categoryId || undefined,
        categoryNameAtBooking: categoryName || undefined,
      },
    };
  }

  async function completeAndPrintExistingBooking(
    b: any,
    paymentMethodOverride?: "cash" | "card" | "transfer"
  ) {
    const id = String(b?.id || "").trim();
    if (!id) return;
    if (isCancelledStatus(b) || isRefundedBooking(b)) {
      openModal({
        title: "لا يمكن تأكيد هذا الحجز",
        message: "الحجز ملغي/مسترجع ولا يمكن تنفيذ (تأكيد + طباعة) عليه.",
        variant: "danger",
        confirmText: "حسنًا",
      });
      return;
    }

    const authNow = getAuth();
    const staffUid = authNow.currentUser?.uid || "";
    if (!staffUid) {
      openModal({
        title: "تسجيل دخول الموظف مطلوب",
        message: "لازم موظفة الاستقبال/الإدارة تكون مسجلة دخول.",
        variant: "danger",
        confirmText: "تمام",
      });
      return;
    }

    setIsLoading(true);
    try {
      const now = Date.now();
      const amount = Number(b?.finalPrice ?? b?.total ?? 0) || 0;
      const nextPaymentMethod =
        paymentMethodOverride || normalizeExistingPaymentMethod((b as any)?.paymentMethod);

      await updateDoc(doc(db, "salons", SALON_ID, "bookings", id), {
        status: "completed",
        confirmedAt: now,
        confirmedByUid: staffUid,
        completedAt: now,
        completedByUid: staffUid,
        paidAt: now,
        paidByUid: staffUid,
        paymentMethod: nextPaymentMethod,
        invoiceIssuedAt: now,
        channel: b?.channel || b?.source || "online",
      } as any);

      await upsertIncomeFS(
        {
          id,
          date: todayISO(),
          amount,
          method: nextPaymentMethod,
          source: "invoice",
          bookingId: id,
          note: `invoice_from_reception:${String(nextPaymentMethod)}`,
          createdAt: now,
        } as any,
        SALON_ID
      );

      void writeAuditLog({
        salonId: SALON_ID,
        action: "booking_completed",
        entityType: "booking",
        entityId: id,
        description: "تم تأكيد الحجز وإصدار الفاتورة من الاستقبال",
        source: "internal_booking",
        after: {
          status: "completed",
          paymentMethod: nextPaymentMethod,
          amount,
          paidAt: now,
          invoiceIssuedAt: now,
        },
        meta: {
          bookingId: id,
          paymentMethod: nextPaymentMethod,
          amount,
        },
      });

      const refreshed = {
        ...b,
        status: "completed",
        paymentMethod: nextPaymentMethod,
        paidAt: now,
      };
      const printReady = enrichBookingForPrint(refreshed);

      setFoundBookings((prev) =>
        prev.map((row) => (String((row as any)?.id || "") === id ? { ...row, ...refreshed } : row))
      );
      setSelectedExistingBooking((prev: any) =>
        String(prev?.id || "") === id ? { ...prev, ...refreshed } : prev
      );

      localStorage.setItem("currentBooking", JSON.stringify(printReady));
      localStorage.setItem("allBookings", JSON.stringify([printReady]));
      setPaymentModalOpen(false);
      setConfirmTargetBooking(null);
      if (!openInternalPrintPopup()) notifyInvoicePopupBlocked();
    } catch (e: any) {
      closePendingInvoicePopup();
      openModal({
        title: "تعذر إصدار الفاتورة",
        message:
          `code: ${String(e?.code || "—")}\n` +
          `message: ${String(e?.message || "—")}`,
        variant: "danger",
        confirmText: "تمام",
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function confirmAndPrintExistingBooking() {
    if (!confirmTargetBooking) return;
    await completeAndPrintExistingBooking(confirmTargetBooking, confirmPaymentMethod);
  }

  function openRefundModal(b: any) {
    if (!canRefundBooking(b)) {
      openModal({
        title: "لا يمكن تنفيذ الاسترجاع",
        message: "الاسترجاع متاح فقط للحجز المؤكد أو المكتمل.",
        variant: "danger",
        confirmText: "حسنًا",
      });
      return;
    }
    setRefundTargetBooking(b || null);
    setRefundReason("");
    setRefundDetails("");
    setRefundModalOpen(true);
  }

  async function confirmRefundExistingBooking() {
    const b = refundTargetBooking;
    const id = String(b?.id || "").trim();
    if (!id) return;
    if (!canRefundBooking(b)) {
      openModal({
        title: "لا يمكن تنفيذ الاسترجاع",
        message: "الاسترجاع متاح فقط للحجز المؤكد أو المكتمل.",
        variant: "danger",
        confirmText: "حسنًا",
      });
      return;
    }

    const reason = String(refundReason || "").trim();
    if (!reason) {
      openModal({
        title: "سبب الاسترجاع مطلوب",
        message: "اكتب سبب الاسترجاع قبل التأكيد.",
        variant: "danger",
        confirmText: "تمام",
      });
      return;
    }

    const authNow = getAuth();
    const staffUid = authNow.currentUser?.uid || "";
    if (!staffUid) {
      openModal({
        title: "تسجيل دخول الموظف مطلوب",
        message: "لازم موظفة الاستقبال/الإدارة تكون مسجلة دخول.",
        variant: "danger",
        confirmText: "تمام",
      });
      return;
    }

    setIsLoading(true);
    try {
      const now = Date.now();
      const amount = Math.abs(Number(b?.finalPrice ?? b?.total ?? 0) || 0);
      const method = normalizeExistingPaymentMethod((b as any)?.paymentMethod);
      const details = String(refundDetails || "").trim();
      const refundNote = details ? `${reason} | ${details}` : reason;

      await updateDoc(doc(db, "salons", SALON_ID, "bookings", id), {
        status: "cancelled",
        cancelledAt: now,
        cancelledByUid: staffUid,
        refundedAt: now,
        refundedByUid: staffUid,
        refundReason: reason,
        refundDetails: details || null,
        refundAmount: amount,
        updatedAt: now,
      } as any);

      await upsertIncomeFS(
        {
          id: `refund_${id}`,
          date: todayISO(),
          amount: -Math.abs(amount),
          method,
          source: "استرجاع",
          bookingId: id,
          note: `استرجاع للحجز ${String(b?.publicId || id)} - ${refundNote}`,
          createdAt: now,
        } as any,
        SALON_ID
      );

      void writeAuditLog({
        salonId: SALON_ID,
        action: "booking_cancelled",
        entityType: "booking",
        entityId: id,
        description: "تم استرجاع الحجز من شاشة الاستقبال",
        source: "internal_booking",
        after: {
          status: "cancelled",
          refundedAt: now,
          refundedByUid: staffUid,
          refundReason: reason,
          refundAmount: amount,
          refundIncomeId: `refund_${id}`,
        },
        meta: {
          bookingId: id,
          refundReason: reason,
          refundAmount: amount,
          refundIncomeId: `refund_${id}`,
        },
      });

      const refreshed = {
        ...b,
        status: "cancelled",
        refundedAt: now,
        refundedByUid: staffUid,
        refundReason: reason,
        refundDetails: details || "",
        refundAmount: amount,
        refundIncomeId: `refund_${id}`,
      };

      setFoundBookings((prev) =>
        prev.map((row) => (String((row as any)?.id || "") === id ? { ...row, ...refreshed } : row))
      );
      setSelectedExistingBooking((prev: any) =>
        String(prev?.id || "") === id ? { ...prev, ...refreshed } : prev
      );

      setRefundModalOpen(false);
      setRefundTargetBooking(null);
      setRefundReason("");
      setRefundDetails("");
    } catch (e: any) {
      openModal({
        title: "تعذر تنفيذ الاسترجاع",
        message:
          `code: ${String(e?.code || "—")}\n` +
          `message: ${String(e?.message || "—")}`,
        variant: "danger",
        confirmText: "تمام",
      });
    } finally {
      setIsLoading(false);
    }
  }

  function printExistingBooking(b: any) {
    const printReady = enrichBookingForPrint(b);
    localStorage.setItem("currentBooking", JSON.stringify(printReady));
    localStorage.setItem("allBookings", JSON.stringify([printReady]));
    if (!openInternalPrintPopup()) notifyInvoicePopupBlocked();
  }

  // =========================
  // Helper: تعارض داخل السلة
  // =========================
  function getLocalTakenTimesForItem(
    items: CartItem[],
    currentItemId: string,
    employeeKey: string,
    date: string,
    employeeIdFallback?: string
  ) {
    const taken = new Set<string>();
    const targetKey = String(employeeKey || "").trim();
    const targetEmployeeId = String(employeeIdFallback || "").trim();

    for (const other of items) {
      if (!other) continue;
      if (other.id === currentItemId) continue;

      const otherKey = resolveEmployeeKey(other);
      const otherEmployeeId = String(other.employeeId || "").trim();
      const d = String(other.date || "").trim();
      const t = String(other.time || "").trim();

      if ((!otherKey && !otherEmployeeId) || !d || !t) continue;
      const sameByKey = !!targetKey && otherKey === targetKey;
      const sameByEmployeeId = !!targetEmployeeId && otherEmployeeId === targetEmployeeId;
      const crossKeyMatch =
        (!!targetEmployeeId && otherKey === targetEmployeeId) ||
        (!!targetKey && otherEmployeeId === targetKey);
      if (!sameByKey && !sameByEmployeeId && !crossKeyMatch) continue;
      if (d !== date) continue;

      const dur = Number(other.durationMin || DEFAULT_SERVICE_DURATION_MIN);
      const locked = getTimesToLock(timeSlots, slotStepMin, t, dur, bufferMin);
      locked.forEach((x) => taken.add(x));
    }

    return taken;
  }

  function isCartItemStaffAvailable(it: CartItem) {
    const date = String(it?.date || "").trim();
    if (!date) return true;

    const serviceId = String(it?.serviceId || "").trim();
    if (!serviceId) return true;

    const staffList = (staffByService[serviceId] || []) as StaffPublicWithId[];
    if (!staffList.length) return true;

    const empId = String(it?.employeeId || "").trim();
    const empUid = String(it?.employeeUid || "").trim();
    const empKey = resolveEmployeeKey(it);

    const staff =
      staffList.find((st: any) => String(st?.id || "").trim() === empId) ||
      (empUid
        ? staffList.find((st: any) => String(st?.linkedUid || st?.uid || "").trim() === empUid)
        : null) ||
      staffList.find((st: any) => String(st?.linkedUid || st?.id || "").trim() === empKey) ||
      null;

    if (!staff) return true;
    return isStaffAvailableForDate(staff as any, date, { requireShowOnBooking: true });
  }

  // =========================
  // Season enabled
  // =========================
  function isDateInRange(dateISO: string, startISO: string, endISO: string) {
    if (!dateISO) return false;
    if (startISO && dateISO < startISO) return false;
    if (endISO && dateISO > endISO) return false;
    return true;
  }

  function isSeasonEnabledForDate(appSettings: any, dateISO: string) {
    const season = (appSettings as any)?.catalogSeasonPricing || {};
    const enabled = !!season.enabled;

    const start = String(season.startDate || season.from || "").trim();
    const end = String(season.endDate || season.to || "").trim();

    if (!enabled) return { ok: false, start, end };
    if (!start && !end) return { ok: true, start, end };

    return { ok: isDateInRange(dateISO, start, end), start, end };
  }

  function pickEffectivePrice(args: {
    basePrice: number;
    seasonPrice?: number;
    appSettings: any;
    dateISO: string;
  }) {
    const base = Math.max(0, Number(args.basePrice || 0));
    const season = Math.max(0, Number(args.seasonPrice || 0));

    const seasonState = isSeasonEnabledForDate(args.appSettings, args.dateISO);
    const seasonActive = seasonState.ok;

    if (seasonActive && season > 0) {
      return { price: season, label: "سعر موسم ✅", usedSeason: true };
    }

    return {
      price: base,
      label: seasonActive ? "سعر عادي (لا يوجد سعر موسم)" : "سعر عادي",
      usedSeason: false,
    };
  }

  function findCartOverlap(items: CartItem[]) {
    const list = (items || []).map((x) => ({ ...x }));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];

        const empA = resolveEmployeeKey(a);
        const empB = resolveEmployeeKey(b);
        const dateA = String(a.date || "").trim();
        const dateB = String(b.date || "").trim();
        const timeA = String(a.time || "").trim();
        const timeB = String(b.time || "").trim();

        if (!empA || !empB || !dateA || !dateB || !timeA || !timeB) continue;
        if (empA !== empB) continue;
        if (dateA !== dateB) continue;

        const aLocked = new Set(
          getTimesToLock(
            timeSlots,
            slotStepMin,
            timeA,
            Number(a.durationMin || DEFAULT_SERVICE_DURATION_MIN),
            bufferMin
          )
        );
        const bLocked = new Set(
          getTimesToLock(
            timeSlots,
            slotStepMin,
            timeB,
            Number(b.durationMin || DEFAULT_SERVICE_DURATION_MIN),
            bufferMin
          )
        );

        let overlap = false;
        for (const t of aLocked) {
          if (bLocked.has(t)) {
            overlap = true;
            break;
          }
        }

        if (overlap) return { ok: false as const, a, b };
      }
    }
    return { ok: true as const, a: null as any, b: null as any };
  }

  // =========================
  // Use local hair guide image + role
  // =========================
  useEffect(() => {
    let cancelled = false;
    setHairGuideUrl(hairGuideImg);

    const auth = getAuth();
    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      try {
        if (!u || (u as any).isAnonymous) {
          if (!cancelled) setIsOwner(false);
          return;
        }

        const userRef = doc(db, "salons", SALON_ID, "users", u.uid);
        const userSnap = await getDoc(userRef);
        const role = String((userSnap.data() as any)?.role || "").toLowerCase();

        if (!cancelled) setIsOwner(role === "owner" || role === "admin");
      } catch {
        if (!cancelled) setIsOwner(false);
      }
    });

    return () => {
      cancelled = true;
      unsubAuth();
    };
  }, []);

  async function uploadHairGuide(file: File) {
    setUploadingGuide(true);
    try {
      const path = `salons/${SALON_ID}/booking/hair-guide_${Date.now()}`;
      const storageRef = ref(storage, path);
      await uploadBytes(storageRef, file);

      const url = await getDownloadURL(storageRef);

      const guideRef = doc(db, "salons", SALON_ID, "settings", "booking");
      await setDoc(guideRef, { hairGuideUrl: url }, { merge: true });

      setHairGuideUrl(url);

      openModal({
        title: "تم ✅",
        message: "تم رفع صورة دليل أطوال الشعر وتحديثها.",
        variant: "success",
        confirmText: "تمام",
      });
    } catch (e: any) {
      openModal({
        title: "فشل الرفع",
        message:
          `صار خطأ أثناء رفع الصورة\n\n` +
          `code: ${String(e?.code || "—")}\n` +
          `message: ${String(e?.message || "—")}`,
        variant: "danger",
        confirmText: "حسنًا",
      });
    } finally {
      setUploadingGuide(false);
    }
  }

  // =========================
  // Read-only: price lookup list
  // =========================
  useEffect(() => {
    let cancelled = false;

    async function loadPriceLookupServices() {
      try {
        setPriceLookupLoading(true);
        const snap = await getDocs(collection(db, "salons", SALON_ID, "services"));
        if (cancelled) return;

        const rows = snap.docs
          .map((d) => {
            const raw = d.data() as any;
            const name = readDisplayLabel(raw, String(d.id || ""));
            const priceRaw =
              (raw as any)?.["السعر"] ??
              raw?.price ??
              raw?.basePrice ??
              raw?.finalPrice ??
              0;
            const price = Number(String(priceRaw).replace(/[^\d.]/g, "")) || 0;
            const seasonPriceRaw =
              raw?.seasonPrice ??
              (raw as any)?.["سعر_الموسم"] ??
              raw?.season_price ??
              raw?.seasonPriceValue ??
              0;
            const seasonPriceNum = Number(String(seasonPriceRaw).replace(/[^\d.]/g, "")) || 0;
            const seasonPrice = seasonPriceNum > 0 ? seasonPriceNum : undefined;
            const imageUrl = String(
              raw?.imageUrl ??
                raw?.imageURL ??
                raw?.image ??
                raw?.photoUrl ??
                raw?.photoURL ??
                ""
            ).trim();
            const variantTerms = Array.isArray(raw?.variants)
              ? raw.variants
                  .map((v: any) => String(v?.name || v?.label || v?.title || "").trim())
                  .filter(Boolean)
                  .join(" ")
              : "";

            return {
              id: String(d.id || "").trim(),
              active: raw?.active === true,
              name: String(name || "").trim(),
              price,
              seasonPrice,
              imageUrl,
              searchText: normalizeSearchText(`${name} ${variantTerms}`),
            };
          })
          .filter((x) => x.active && x.id && x.name)
          .map(({ active, ...rest }) => rest)
          .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ar"));

        setPriceLookupServices(rows);
      } catch {
        if (!cancelled) setPriceLookupServices([]);
      } finally {
        if (!cancelled) setPriceLookupLoading(false);
      }
    }

    loadPriceLookupServices();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadSectionCatalogFromFirestore = async (
    sectionIdRaw: string
  ): Promise<FsSectionCatalogCacheRow> => {
    const sectionId = String(sectionIdRaw || "").trim();
    if (!sectionId || sectionId === PACKAGE_SECTION_ID) {
      return { categories: [], services: [] };
    }

    const cached = fsSectionCatalogCacheRef.current[sectionId];
    if (cached) return cached;

    const inFlight = fsSectionCatalogInFlightRef.current[sectionId];
    if (inFlight) return inFlight;

    const loadPromise: Promise<FsSectionCatalogCacheRow> = (async () => {
      const catsCol = collection(db, "salons", SALON_ID, "service_categories");

      let catsSnap;
      try {
        catsSnap = await getDocs(
          query(
            catsCol,
            where("sectionId", "==", sectionId),
            orderBy("order", "asc")
          )
        );
      } catch {
        catsSnap = await getDocs(query(catsCol, where("sectionId", "==", sectionId)));
      }

      const safeCats: any[] = catsSnap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .filter((c) => String((c as any)?.["الاسم"] ?? c?.name ?? "").trim())
        .filter((c) => c?.active !== false);

      const catIds = safeCats
        .map((c: any) => String(c.categoryId ?? c.key ?? c.id ?? "").trim())
        .filter(Boolean);

      const colRef = collection(db, "salons", SALON_ID, "services");
      const merged: any[] = [];

      if (catIds.length === 0) {
        const snap = await getDocs(query(colRef, where("sectionId", "==", sectionId)));
        snap.docs.forEach((d) => merged.push({ id: d.id, ...(d.data() as any) }));
      } else {
        const chunks: string[][] = [];
        for (let i = 0; i < catIds.length; i += 10) {
          chunks.push(catIds.slice(i, i + 10));
        }

        const snaps = await Promise.all(
          chunks.map((arr) => getDocs(query(colRef, where("categoryId", "in", arr))))
        );
        snaps.forEach((sn) => {
          sn.docs.forEach((d) => merged.push({ id: d.id, ...(d.data() as any) }));
        });

        const secSnap = await getDocs(query(colRef, where("sectionId", "==", sectionId)));
        secSnap.docs.forEach((d) => merged.push({ id: d.id, ...(d.data() as any) }));
      }

      const uniq = new Map<string, any>();
      merged.forEach((x) => uniq.set(String(x.id), x));
      const activeOnly = Array.from(uniq.values()).filter((x) => x?.active !== false);

      const payload: FsSectionCatalogCacheRow = {
        categories: safeCats as CategoryDoc[],
        services: activeOnly as ServiceDoc[],
      };
      fsSectionCatalogCacheRef.current[sectionId] = payload;
      return payload;
    })();

    fsSectionCatalogInFlightRef.current[sectionId] = loadPromise;
    try {
      return await loadPromise;
    } finally {
      delete fsSectionCatalogInFlightRef.current[sectionId];
    }
  };

  // =========================
  // Load sections
  // =========================
  useEffect(() => {
    let cancelled = false;

    async function loadSectionsFirstTime() {
      try {
        setCatalogLoading(true);
        const [secs, packs] = await Promise.all([
          listActiveSections(SALON_ID),
          listActivePackages(SALON_ID),
        ]);
        if (cancelled) return;

        setFsPackages(Array.isArray(packs) ? packs : []);
        const safeSections = Array.isArray(secs) ? secs : [];

        if (safeSections.length > 0 || (packs && packs.length > 0)) {
          setCatalogMode("firestore");
          setFsSections(safeSections);
          // Warm up cache in background so section/category/service open faster.
          safeSections
            .map((s: any) => String((s as any)?.id || "").trim())
            .filter(Boolean)
            .forEach((sid) => {
              void loadSectionCatalogFromFirestore(sid);
            });
        } else {
          setCatalogMode("pricing");
          setFsSections([]);
          setFsPackages([]);
        }
      } catch {
        if (!cancelled) {
          setCatalogMode("pricing");
          setFsSections([]);
          setFsPackages([]);
        }
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    }

    loadSectionsFirstTime();
    return () => {
      cancelled = true;
    };
  }, []);

  // =========================
  // Load cats + services for section (Firestore)
  // =========================
  useEffect(() => {
    let cancelled = false;

    async function loadCatalogForSection() {
      if (catalogMode !== "firestore") return;

      if (!selectedSectionId) {
        setFsCategories([]);
        setFsServices([]);
        return;
      }

      if (String(selectedSectionId).trim() === PACKAGE_SECTION_ID) {
        setFsCategories([]);
        setFsServices([]);
        return;
      }

      try {
        setCatalogLoading(true);
        const payload = await loadSectionCatalogFromFirestore(String(selectedSectionId || "").trim());
        if (cancelled) return;
        setFsCategories(Array.isArray(payload.categories) ? payload.categories : []);
        setFsServices(Array.isArray(payload.services) ? payload.services : []);
      } catch {
        if (!cancelled) {
          setFsCategories([]);
          setFsServices([]);
          setCatalogMode("pricing");
        }
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    }

    loadCatalogForSection();
    return () => {
      cancelled = true;
    };
  }, [catalogMode, selectedSectionId]);

  // =========================
  // FS services filtered
  // =========================
  const fsServicesFiltered = useMemo(() => {
    if (catalogMode !== "firestore") return [];
    if (!selectedSectionId) return [];

    const sid = String(selectedSectionId || "").trim();
    const cid = String(selectedCategory || "").trim();

    if (!fsCategories.length) {
      const base = fsServices.filter((s: any) => String(s.sectionId || "").trim() === sid);
      if (!cid) return base;

      return base.filter((s: any) => {
        const catName = String(
          s.category ?? s.categoryName ?? (s as any)?.["التصنيف"] ?? ""
        ).trim();
        return catName === cid;
      });
    }

    const catIdsInSection = new Set(
      fsCategories
        .filter((c: any) => String(c.sectionId || "").trim() === sid)
        .map((c: any) => String(c.id || "").trim())
        .filter(Boolean)
    );

    return fsServices.filter((s: any) => {
      const catId = String(s.categoryId || "").trim();
      if (!catIdsInSection.has(catId)) return false;
      if (!cid) return true;
      return catId === cid;
    });
  }, [catalogMode, fsServices, fsCategories, selectedSectionId, selectedCategory]);

  // =========================
  // One source services list
  // =========================
  const servicesFlat: FlatService[] = useMemo(() => {
    if (catalogMode === "firestore" && (fsSections.length > 0 || fsPackages.length > 0)) {
      const secMap = new Map<string, string>();
      fsSections.forEach((s: any) => secMap.set(String(s.id), readDisplayLabel(s, String(s.id || ""))));

      const catMap = new Map<string, string>();
      fsCategories.forEach((c: any) => catMap.set(String(c.id), readDisplayLabel(c, String(c.id || ""))));

      const catById = new Map<string, any>();
      fsCategories.forEach((c: any) => catById.set(String(c.id), c));

      const hasCats = fsCategories.length > 0;

      const list = (selectedSectionId ? fsServicesFiltered : []).map((x: any) => {
        if (!hasCats) {
          const sectionId = String(x.sectionId || selectedSectionId || "").trim();
          const sectionTitle = secMap.get(sectionId) || sectionId || "—";

          const catName =
            readDisplayLabel(
              { name: x.category, categoryName: x.categoryName, label: (x as any)?.["التصنيف"] },
              "عام"
            ) || "عام";
          const name = readDisplayLabel(x, String(x.id || ""));
          const priceNum = Number((x as any)?.["السعر"] ?? x.price ?? 0);

          const seasonPriceRaw =
            (x as any).seasonPrice ??
            (x as any)?.["سعر_الموسم"] ??
            (x as any).season_price ??
            (x as any).seasonPriceValue ??
            0;

          const seasonPriceNum = Number(String(seasonPriceRaw).replace(/[^\d.]/g, "")) || 0;
          const seasonPrice = seasonPriceNum > 0 ? seasonPriceNum : undefined;

          const durationMin = Number(
            (x as any)?.["المدة"] ?? x.durationMin ?? DEFAULT_SERVICE_DURATION_MIN
          );

          return {
            id: String(x.id),
            kind: "service" as const,
            sectionId,
            sectionTitle,
            categoryId: "",
            category: catName,
            name,
            priceText: `${priceNum} ريال`,
            basePrice: priceNum,
            seasonPrice,
            durationMin,
            source: "firestore" as const,
          };
        }

        const catId = String(x.categoryId || "").trim();
        const catDoc = catById.get(catId);

        const sectionId = String(catDoc?.sectionId || "").trim();
        const sectionTitle = secMap.get(sectionId) || sectionId || "—";

        const catName = catId ? catMap.get(catId) || "عام" : "عام";
        const name = readDisplayLabel(x, String(x.id || ""));
        const priceNum = Number((x as any)?.["السعر"] ?? x.price ?? 0);

        const seasonPriceRaw =
          (x as any).seasonPrice ??
          (x as any)?.["سعر_الموسم"] ??
          (x as any).season_price ??
          (x as any).seasonPriceValue ??
          0;

        const seasonPriceNum = Number(String(seasonPriceRaw).replace(/[^\d.]/g, "")) || 0;
        const seasonPrice = seasonPriceNum > 0 ? seasonPriceNum : undefined;

        const durationMin = Number(
          (x as any)?.["المدة"] ?? x.durationMin ?? DEFAULT_SERVICE_DURATION_MIN
        );

        return {
          id: String(x.id),
          kind: "service" as const,
          sectionId,
          sectionTitle,
          categoryId: catId,
          category: String(catName || "عام"),
          name,
          priceText: `${priceNum} ريال`,
          basePrice: priceNum,
          seasonPrice,
          durationMin,
          source: "firestore" as const,
        };
      });

      const packageRows: FlatService[] = (fsPackages || []).map((pkg) => ({
        id: `pkg:${String(pkg.id)}`,
        kind: "package" as const,
        sectionId: PACKAGE_SECTION_ID,
        sectionTitle: PACKAGE_SECTION_TITLE,
        categoryId: PACKAGE_SECTION_ID,
        category: PACKAGE_SECTION_TITLE,
        name: String(pkg.name || "").trim(),
        priceText: `${Number(pkg.finalPrice || 0)} ريال`,
        basePrice: Number(pkg.finalPrice || 0),
        durationMin: Number(pkg.totalDurationMin || DEFAULT_SERVICE_DURATION_MIN),
        packageId: String(pkg.id || "").trim(),
        packageServiceIds: Array.isArray(pkg.serviceIds)
          ? pkg.serviceIds.map((x) => String(x || "").trim()).filter(Boolean)
          : [],
        packageServices: Array.isArray(pkg.services) ? pkg.services : [],
        packageBaseTotalPrice: Number(pkg.baseTotalPrice || 0),
        source: "firestore" as const,
      }));

      return [...list, ...packageRows];
    }

    const out: FlatService[] = [];
    Object.entries(pricingSections).forEach(([sectionId, section]) => {
      section.services.forEach((cat, catIdx) => {
        cat.items.forEach((it, itemIdx) => {
          const id = `${sectionId}-${catIdx}-${itemIdx}`;
          const basePrice = extractMinPrice(it.price);

          out.push({
            id,
            kind: "service" as const,
            sectionId,
            sectionTitle: section.title,
            categoryId: "",
            category: cat.category,
            name: `${cat.category} - ${it.name}`,
            priceText: it.price,
            basePrice,
            durationMin: DEFAULT_SERVICE_DURATION_MIN,
            source: "pricing",
          });
        });
      });
    });

    return out;
  }, [catalogMode, fsSections, fsCategories, fsServicesFiltered, selectedSectionId, fsPackages]);

  const sectionOptions = useMemo(() => {
    if (catalogMode === "firestore" && (fsSections.length > 0 || fsPackages.length > 0)) {
      const rows = fsSections.map((s: any) => ({
        id: String(s.id),
        title: readDisplayLabel(s, String(s?.id || "").trim()),
      }));
      if ((fsPackages || []).length > 0) {
        rows.push({ id: PACKAGE_SECTION_ID, title: PACKAGE_SECTION_TITLE });
      }
      return rows;
    }

    return Object.entries(pricingSections).map(([id, sec]) => ({ id, title: sec.title }));
  }, [catalogMode, fsSections, fsPackages]);

  const categoryOptions: CategoryOption[] = useMemo(() => {
    if (!selectedSectionId) return [];
    if (String(selectedSectionId).trim() === PACKAGE_SECTION_ID) return [];

    if (catalogMode === "firestore" && fsSections.length > 0) {
      if (fsCategories.length) {
        const sid = String(selectedSectionId).trim();

        const cats = fsCategories
          .filter((c: any) => String(c.sectionId || "").trim() === sid)
          .map((c: any) => ({
            id: String(c.id),
            name: readDisplayLabel(c, String(c?.id || "").trim()),
          }))
          .filter((x) => x.id && x.name);

        const seen = new Set<string>();
        return cats.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
      }

      const sid = String(selectedSectionId).trim();
      const base = fsServices
        .filter((s: any) => String(s.sectionId || "").trim() === sid)
        .map((s: any) =>
          String(
            s.category ?? s.categoryName ?? (s as any)?.["التصنيف"] ?? "عام"
          ).trim()
        )
        .filter(Boolean);

      const seen = new Set<string>();
      return base
        .filter((n) => (seen.has(n) ? false : (seen.add(n), true)))
        .map((n) => ({ id: n, name: n }));
    }

    const cats = servicesFlat
      .filter((s) => s.sectionId === selectedSectionId)
      .map((s) => ({ id: s.category, name: s.category }))
      .filter((x) => x.id && x.name);

    const seen = new Set<string>();
    return cats.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
  }, [catalogMode, fsSections.length, fsCategories, fsServices, servicesFlat, selectedSectionId]);

  const servicesInSection = useMemo(() => {
    if (!selectedSectionId) return [];

    const sid = String(selectedSectionId || "").trim();
    const sel = String(selectedCategory || "").trim();

    const all = servicesFlat.filter((s) => String(s.sectionId || "").trim() === sid);
    if (!sel) return all;

    if (catalogMode === "firestore") {
      const hasCats = fsCategories.length > 0;
      if (hasCats) return all.filter((s) => String(s.categoryId || "").trim() === sel);
      return all.filter((s) => String(s.category || "").trim() === sel);
    }

    return all.filter((s) => String(s.category || "").trim() === sel);
  }, [servicesFlat, selectedSectionId, selectedCategory, catalogMode, fsCategories.length]);

  const servicesGrouped = useMemo(() => {
    const map = new Map<string, FlatService[]>();
    servicesInSection.forEach((sv) => {
      const arr = map.get(sv.category) || [];
      arr.push(sv);
      map.set(sv.category, arr);
    });
    return Array.from(map.entries());
  }, [servicesInSection]);

  function servicePickerPriceText(sv: FlatService) {
    const dateISO = String(bookingDate || "").trim();
    if (!dateISO) return sv.priceText;

    const eff = pickEffectivePrice({
      basePrice: Number(sv.basePrice || 0),
      seasonPrice: Number((sv as any).seasonPrice || 0) || undefined,
      appSettings,
      dateISO,
    });

    const price = Number(eff.price || 0);
    return `${price} ريال`;
  }

  const packageOptions = useMemo(() => {
    return servicesFlat
      .filter((s) => s.kind === "package")
      .map((s) => ({
        id: String(s.id || "").trim(),
        title: toArabicCatalogLabel(String(s.name || "").trim() || "باكيج"),
        priceText: servicePickerPriceText(s),
      }))
      .filter((x) => x.id);
  }, [servicesFlat, bookingDate, appSettings]);

  const priceLookupNeedle = useMemo(
    () => normalizeSearchText(String(priceLookupQuery || "").trim()),
    [priceLookupQuery]
  );

  const priceLookupResults = useMemo(() => {
    if (!priceLookupNeedle) return priceLookupServices;
    return priceLookupServices.filter((s) => String(s.searchText || "").includes(priceLookupNeedle));
  }, [priceLookupServices, priceLookupNeedle]);

  const futureStaffOptions = useMemo(() => {
    const sid = String(resolvedFutureServiceId || "").trim();
    if (!sid) return [] as { key: string; name: string }[];

    const base = (staffByService[sid] || []) as StaffPublicWithId[];
    const seen = new Set<string>();

    return base
      .map((st: any) => {
        const key = String(st?.linkedUid || st?.uid || st?.id || "").trim();
        const name = String(st?.name || st?.displayName || st?.id || "").trim();
        return { key, name };
      })
      .filter((x) => x.key && x.name)
      .filter((x) => (seen.has(x.key) ? false : (seen.add(x.key), true)));
  }, [resolvedFutureServiceId, staffByService]);

  const filteredFutureStaffOptions = useMemo(() => {
    const q = String(futureStaffNameQuery || "").trim().toLowerCase();
    if (!q) return futureStaffOptions;
    return futureStaffOptions.filter((x) =>
      String(x.name || "").toLowerCase().includes(q)
    );
  }, [futureStaffOptions, futureStaffNameQuery]);

  useEffect(() => {
    let cancelled = false;

    async function loadFutureStaffForPickedService() {
      const sid = String(resolvedFutureServiceId || "").trim();
      if (!sid) return;
      const hasCache = Object.prototype.hasOwnProperty.call(staffByService, sid);
      if (hasCache) return;
      const sv = getServiceById(sid);
      const resolverKey = buildStaffResolverKey(sid, sv);
      const cachedRows = staffByResolverCacheRef.current[resolverKey];
      if (Array.isArray(cachedRows)) {
        setStaffByService((p) => ({ ...p, [sid]: cachedRows as any }));
        return;
      }

      try {
        setStaffLoadingByService((p) => ({ ...p, [sid]: true }));
        setStaffErrorByService((p) => ({ ...p, [sid]: "" }));
        const res = await listStaffForService(sid, sv);

        if (cancelled) return;

        const normalized = (res || []).filter((st: any) => {
          const name = String(st?.name || "").trim();
          if (!name) return false;
          return true;
        });

        setStaffByService((p) => ({ ...p, [sid]: normalized as any }));
      } catch {
        if (!cancelled) {
          setStaffByService((p) => ({ ...p, [sid]: [] }));
          setStaffErrorByService((p) => ({
            ...p,
            [sid]: "تعذر تحميل الموظفات لهذه الخدمة.",
          }));
        }
      } finally {
        if (!cancelled) {
          setStaffLoadingByService((p) => ({ ...p, [sid]: false }));
        }
      }
    }

    loadFutureStaffForPickedService();
    return () => {
      cancelled = true;
    };
  }, [resolvedFutureServiceId, staffByService]);

  useEffect(() => {
    if (futureAnyStaff) return;
    if (!futureSelectedEmployeeKey) return;

    const exists = futureStaffOptions.some((x) => x.key === futureSelectedEmployeeKey);
    if (!exists) {
      setFutureSelectedEmployeeKey("");
      setFutureStaffNameQuery("");
    }
  }, [futureAnyStaff, futureSelectedEmployeeKey, futureStaffOptions]);

  useEffect(() => {
    if (!futureAnyStaff) return;
    if (!futureSelectedEmployeeKey && !futureStaffNameQuery) return;
    setFutureSelectedEmployeeKey("");
    setFutureStaffNameQuery("");
  }, [futureAnyStaff, futureSelectedEmployeeKey, futureStaffNameQuery]);

  const serviceByIdMap = useMemo(() => {
    const out = new Map<string, FlatService>();
    (servicesFlat || []).forEach((sv) => {
      const id = String((sv as any)?.id || "").trim();
      if (id && !out.has(id)) out.set(id, sv);
    });
    return out;
  }, [servicesFlat]);

  function getServiceById(id: string) {
    const key = String(id || "").trim();
    if (!key) return null;
    return serviceByIdMap.get(key) || null;
  }

  function normalizeSpecialty(v: string) {
    return String(v || "").trim().toLowerCase();
  }

  function normalizeStaffSpecialties(st: any) {
    return Array.isArray(st?.specialties)
      ? st.specialties.map((x: any) => normalizeSpecialty(String(x || ""))).filter(Boolean)
      : [];
  }

  function buildStaffResolverKey(serviceId: string, target: FlatService | null) {
    const sid = normalizeSpecialty(serviceId);
    if (target?.kind === "package") {
      const needed = Array.from(
        new Set(
          [
            ...(target.packageServiceIds || []),
            ...((target.packageServices || []).map((x: any) => String(x?.serviceId || "").trim())),
          ]
            .map((x) => normalizeSpecialty(String(x || "")))
            .filter(Boolean)
        )
      ).sort();
      return needed.length ? `pkg:${needed.join("|")}` : `pkg:${sid}`;
    }
    return `srv:${sid}`;
  }

  async function getAllActiveStaffCached() {
    if (Array.isArray(staffAllCacheRef.current)) return staffAllCacheRef.current;
    const all = await listActiveStaffAll(SALON_ID);
    staffAllCacheRef.current = Array.isArray(all) ? all : [];
    return staffAllCacheRef.current;
  }

  async function listStaffForService(serviceId: string, service?: FlatService | null) {
    const sid = String(serviceId || "").trim();
    if (!sid) return [] as StaffPublicWithId[];

    const target = service || getServiceById(sid);
    const resolverKey = buildStaffResolverKey(sid, target);

    const cached = staffByResolverCacheRef.current[resolverKey];
    if (Array.isArray(cached)) return cached;

    const inFlight = staffByResolverInFlightRef.current[resolverKey];
    if (inFlight) return inFlight;

    const loadPromise: Promise<StaffPublicWithId[]> = (async () => {
      const all = await getAllActiveStaffCached();
      if (target?.kind === "package") {
        const needed = Array.from(
          new Set(
            [
              ...(target.packageServiceIds || []),
              ...((target.packageServices || []).map((x: any) => String(x?.serviceId || "").trim())),
            ]
              .map((x) => normalizeSpecialty(String(x || "")))
              .filter(Boolean)
          )
        );
        if (!needed.length) return [] as StaffPublicWithId[];

        const strict = (all || []).filter((st: any) => {
          const specs = normalizeStaffSpecialties(st);
          return needed.every((n) => specs.includes(n));
        });
        if (strict.length) return strict;

        // Fallback: at least one package service specialty.
        return (all || []).filter((st: any) => {
          const specs = normalizeStaffSpecialties(st);
          return needed.some((n) => specs.includes(n));
        });
      }

      const wanted = normalizeSpecialty(sid);
      if (!wanted) return [] as StaffPublicWithId[];
      return (all || []).filter((st: any) => normalizeStaffSpecialties(st).includes(wanted));
    })();

    staffByResolverInFlightRef.current[resolverKey] = loadPromise;
    try {
      const rows = await loadPromise;
      staffByResolverCacheRef.current[resolverKey] = rows;
      return rows;
    } finally {
      delete staffByResolverInFlightRef.current[resolverKey];
    }
  }

  useEffect(() => {
    void getAllActiveStaffCached();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isToolsOptionEligibleForService = (sv: FlatService | null) => {
    if (!sv) return false;
    return isManiPediSectionByInfo(
      String(sv.sectionId || "").trim(),
      String(sv.sectionTitle || "").trim()
    );
  };

  const isToolsOptionEligibleForItem = (it: CartItem) => {
    const byItem = isManiPediSectionByInfo(
      String(it.serviceSectionId || "").trim(),
      String(it.serviceSectionTitle || "").trim()
    );
    if (byItem) return true;

    const sv = getServiceById(String(it.serviceId || "").trim());
    return isToolsOptionEligibleForService(sv);
  };

  const buildItemPriceWithTools = (
    serviceBasePrice: number,
    toolsSource: "client" | "salon" | undefined,
    toolsEligible: boolean
  ) => {
    const safeServiceBase = Math.max(0, Number(serviceBasePrice || 0));
    const toolsFee = toolsEligible && toolsSource === "salon" ? maniPediToolsFee : 0;
    const total = safeServiceBase + toolsFee;

    return {
      serviceBasePrice: safeServiceBase,
      toolsFeeApplied: toolsFee,
      basePrice: total,
      priceText: `${total} ريال`,
    };
  };

  const buildItemToolsNote = (it: CartItem) => {
    if (!isToolsOptionEligibleForItem(it)) return "";

    const source = String(it.toolsSource || "").trim() === "salon" ? "salon" : "client";
    if (source === "salon") {
      const fee = Math.max(0, Number(it.toolsFeeApplied || maniPediToolsFee || 0));
      return `الأدوات: من المشغل (+${fee} ريال)`;
    }
    return "الأدوات: من العميلة (بدون رسوم)";
  };

  function focusFutureSearchForCartItem(
    it: CartItem,
    options?: { scroll?: boolean }
  ) {
    const serviceId = String(it.serviceId || "").trim();
    const employeeKey = resolveEmployeeKey(it);
    const employeeName = String(it.employeeName || "").trim();
    const dateISO = String(it.date || bookingDate || "").trim();
    if (!serviceId || !employeeKey) return;

    const contextKey = `${serviceId}|${employeeKey}|${dateISO}|${String(it.id || "").trim()}`;
    if (autoFutureSearchKeyRef.current === contextKey) return;
    autoFutureSearchKeyRef.current = contextKey;

    const sv = getServiceById(serviceId);
    if (sv) {
      const sectionId = String(sv.sectionId || "").trim();
      if (sectionId) setSelectedSectionId(sectionId);

      if (catalogMode === "firestore") {
        const catId = String((sv as any).categoryId || "").trim();
        setSelectedCategory(catId || "");
      } else {
        const catName = String((sv as any).category || "").trim();
        if (catName) setSelectedCategory(catName);
      }
    }

    setFutureServiceId(serviceId);
    setFutureTargetItemId(String(it.id || "").trim());
    setServicePicker(serviceId);
    setFutureAnyStaff(false);
    setFutureSelectedEmployeeKey(employeeKey);
    setFutureStaffNameQuery(employeeName);

    if (options?.scroll) {
      requestAnimationFrame(() => {
        futureSearchRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
      });
    }

    void runFutureAvailabilitySearch({
      serviceId,
      anyStaff: false,
      employeeKey,
      employeeName,
      startISO: dateISO || String(bookingDate || "").trim() || todayISO(),
      targetItemId: String(it.id || "").trim(),
    });
  }

  function canEditByLockedPrev(items: CartItem[], itemId: string) {
    const list = items || [];
    const idx = list.findIndex((x) => x.id === itemId);
    if (idx < 0) return false;
    if (idx === 0) return true;
    return !!list[idx - 1]?.locked;
  }

  function toggleConfirmedCartItem(itemId: string) {
    setExpandedConfirmedCartItems((prev) => {
      const next = { ...prev };
      if (next[itemId]) {
        delete next[itemId];
      } else {
        next[itemId] = true;
      }
      return next;
    });
  }

  function togglePreviewRow(rowId: string) {
    setExpandedPreviewRows((prev) => {
      const next = { ...prev };
      if (next[rowId]) {
        delete next[rowId];
      } else {
        next[rowId] = true;
      }
      return next;
    });
  }

  // =========================
  // Cart actions
  // =========================
  const addServiceToCart = (idRaw: string) => {
    const id = String(idRaw || "").trim();
    if (!id) return;

    const sv = getServiceById(id);
    if (!sv) return;

    if (sv.kind === "package") {
      const pkgServices = Array.isArray(sv.packageServices) ? sv.packageServices : [];
      const pkgServiceIds = (Array.isArray(sv.packageServiceIds) ? sv.packageServiceIds : [])
        .map((x) => String(x || "").trim())
        .filter(Boolean);
      const serviceIds = pkgServices.length
        ? pkgServices.map((x: any) => String(x?.serviceId || "").trim()).filter(Boolean)
        : pkgServiceIds;
      if (!serviceIds.length) return;

      const baseByService = serviceIds.map((serviceId, idx) => {
        const meta = pkgServices[idx] || {};
        const serviceDoc = getServiceById(serviceId);
        const base = Math.max(
          0,
          Number((meta as any)?.price ?? (serviceDoc as any)?.basePrice ?? 0)
        );
        return { serviceId, meta, serviceDoc, base };
      });

      const baseTotal = baseByService.reduce((sum, x) => sum + Number(x.base || 0), 0);
      const packageFinal = Math.max(0, Number(sv.basePrice || 0));
      const targetTotal = packageFinal > 0 ? packageFinal : baseTotal;

      const splitCount = Math.max(1, baseByService.length);
      const equalShare = Math.floor((targetTotal / splitCount) * 100) / 100;
      const remaining = Math.round((targetTotal - equalShare * splitCount) * 100) / 100;
      const distributed = baseByService.map((row, idx) => {
        if (idx === splitCount - 1) {
          const last = Math.max(0, Number((equalShare + remaining).toFixed(2)));
          return { ...row, price: last };
        }
        return { ...row, price: Math.max(0, Number(equalShare.toFixed(2))) };
      });
      const packageRunId = makeLocalId();

      const packageSnapshot = {
        packageId: String(sv.packageId || "").trim(),
        packageName: sv.name,
        finalPriceAtBooking: targetTotal,
        baseTotalPriceAtBooking: Number(sv.packageBaseTotalPrice || baseTotal || targetTotal),
        totalDurationMinAtBooking: Number(sv.durationMin || DEFAULT_SERVICE_DURATION_MIN),
        serviceIds: serviceIds,
        services: pkgServices,
      };

      const nextItems: CartItem[] = distributed.map((row) => {
        const serviceDoc = row.serviceDoc;
        const serviceName = String(
          (row.meta as any)?.serviceName ||
            serviceDoc?.name ||
            row.serviceId
        ).trim();
        const durationMin = Math.max(
          1,
          Number((row.meta as any)?.durationMin || serviceDoc?.durationMin || DEFAULT_SERVICE_DURATION_MIN)
        );
        const sectionId = String((row.meta as any)?.sectionId || serviceDoc?.sectionId || "").trim();
        const sectionTitle = String(serviceDoc?.sectionTitle || sectionId).trim();
        const categoryId = String((row.meta as any)?.categoryId || serviceDoc?.categoryId || "").trim();
        const categoryName = String(serviceDoc?.category || categoryId).trim();
        const toolsEligible = isManiPediSectionByInfo(sectionId, sectionTitle);
        const toolsSource = toolsEligible ? "client" : undefined;
        const priced = buildItemPriceWithTools(Number(row.price || 0), toolsSource, toolsEligible);

        return {
          id: makeLocalId(),
          packageRunId,
          serviceId: row.serviceId,
          serviceName,
          packageId: String(sv.packageId || "").trim(),
          packageSnapshot,
          serviceBasePrice: priced.serviceBasePrice,
          basePrice: priced.basePrice,
          priceText: priced.priceText,
          durationMin,
          employeeId: "",
          employeeUid: "",
          employeeName: "",
          date: bookingDate,
          time: "",
          locked: false,
          serviceSectionId: sectionId,
          serviceSectionTitle: sectionTitle || undefined,
          serviceCategoryId: categoryId || undefined,
          serviceCategoryName: categoryName || undefined,
          toolsSource,
          toolsFeeApplied: priced.toolsFeeApplied,
        };
      });

      setFormData((prev) => ({
        ...prev,
        items: [...(prev.items || []), ...nextItems],
      }));

      setServicePicker("");
      setSelectedCategory("");
      setSelectedSectionId("");
      setDiscountMsg("");
      return;
    }

    const dateISO = String(bookingDate || "").trim();

    const eff = pickEffectivePrice({
      basePrice: Number(sv.basePrice || 0),
      seasonPrice: Number((sv as any).seasonPrice || 0) || undefined,
      appSettings,
      dateISO,
    });

    const serviceBasePrice = Number(eff.price || 0);
    const toolsEligible = isToolsOptionEligibleForService(sv);
    const toolsSource = toolsEligible ? "client" : undefined;
    const priced = buildItemPriceWithTools(serviceBasePrice, toolsSource, toolsEligible);

    setFormData((prev) => ({
      ...prev,
      items: [
        ...(prev.items || []),
        {
          id: makeLocalId(),
          serviceId: id,
          serviceName: sv.name,
          packageId: sv.kind === "package" ? String(sv.packageId || "").trim() : undefined,
          packageSnapshot:
            sv.kind === "package" && sv.packageId
              ? {
                  packageId: String(sv.packageId || "").trim(),
                  packageName: sv.name,
                  finalPriceAtBooking: Number(sv.basePrice || 0),
                  baseTotalPriceAtBooking: Number(sv.packageBaseTotalPrice || sv.basePrice || 0),
                  totalDurationMinAtBooking: Number(sv.durationMin || DEFAULT_SERVICE_DURATION_MIN),
                  serviceIds: Array.isArray(sv.packageServiceIds) ? sv.packageServiceIds : [],
                  services: Array.isArray(sv.packageServices) ? sv.packageServices : [],
                }
              : undefined,
          serviceBasePrice: priced.serviceBasePrice,
          basePrice: priced.basePrice,
          priceText: priced.priceText,
          toolsSource,
          toolsFeeApplied: priced.toolsFeeApplied,
          durationMin: Number(sv.durationMin || DEFAULT_SERVICE_DURATION_MIN),
          employeeId: "",
          employeeUid: "",
          employeeName: "",
          date: bookingDate,
          time: "",
          locked: false,
          serviceSectionId: String(sv.sectionId || "").trim(),
          serviceSectionTitle: String(sv.sectionTitle || "").trim() || undefined,
          serviceCategoryId: String(sv.categoryId || "").trim() || undefined,
          serviceCategoryName: String(sv.category || "").trim() || undefined,
        },
      ],
    }));

    setServicePicker("");
    setSelectedCategory("");
    setSelectedSectionId("");

    setDiscountMsg("");
  };

  const removeServiceFromCart = (itemId: string) => {
    let removedIds = new Set<string>([String(itemId || "").trim()]);
    setFormData((prev) => {
      const list = prev.items || [];
      const target = list.find((it) => String(it.id || "").trim() === String(itemId || "").trim());
      const runId = String(target?.packageRunId || "").trim();
      if (!runId) {
        return {
          ...prev,
          items: list.filter((it) => String(it.id || "").trim() !== String(itemId || "").trim()),
        };
      }

      const ids = new Set<string>(
        list
          .filter((it) => String(it.packageRunId || "").trim() === runId)
          .map((it) => String(it.id || "").trim())
          .filter(Boolean)
      );
      removedIds = ids.size ? ids : removedIds;
      return {
        ...prev,
        items: list.filter((it) => !removedIds.has(String(it.id || "").trim())),
      };
    });

    setBusyByItem((prev) => {
      const next = { ...prev };
      Array.from(removedIds).forEach((id) => delete next[id]);
      return next;
    });
    Array.from(removedIds).forEach((id) => {
      delete busyQueryKeyByItemRef.current[id];
    });

    setDiscountMsg("");
  };

  const updateItem = (itemId: string, patch: Partial<CartItem>) => {
    setFormData((prev) => {
      const list = prev.items || [];
      const idx = list.findIndex((x) => x.id === itemId);
      if (idx < 0) return prev;

      const nextItems = list.map((it, i) => {
        if (i === idx) return { ...it, ...patch };

        const affectsChain =
          patch.employeeId !== undefined ||
          patch.time !== undefined ||
          patch.date !== undefined;

        if (i > idx && affectsChain) {
          return {
            ...it,
            locked: false,
            ...(patch.date !== undefined
              ? { employeeId: "", employeeUid: "", employeeName: "", time: "" }
              : {}),
          };
        }

        return it;
      });

      return { ...prev, items: nextItems };
    });

    if (patch.serviceId || patch.employeeId || patch.date || patch.time) {
      setDiscountMsg("");
    }
  };

  const setItemToolsSource = (it: CartItem, nextSource: "client" | "salon") => {
    const toolsEligible = isToolsOptionEligibleForItem(it);
    if (!toolsEligible) return;

    const baseFromItem =
      Number((it as any)?.serviceBasePrice ?? 0) ||
      Math.max(0, Number(it.basePrice || 0) - Number(it.toolsFeeApplied || 0));

    const priced = buildItemPriceWithTools(baseFromItem, nextSource, true);
    updateItem(it.id, {
      toolsSource: nextSource,
      serviceBasePrice: priced.serviceBasePrice,
      toolsFeeApplied: priced.toolsFeeApplied,
      basePrice: priced.basePrice,
      priceText: priced.priceText,
    });
  };

  // =========================
  // Load staff per serviceId
  // =========================
  useEffect(() => {
    let cancelled = false;

    async function loadNeededStaff() {
      const serviceIds = Array.from(
        new Set(
          (formData.items || [])
            .map((it) => String(it.serviceId || "").trim())
            .filter(Boolean)
        )
      );

      if (!serviceIds.length) return;

      for (const sid of serviceIds) {
        if (cancelled) return;
        if (staffByService[sid] && Array.isArray(staffByService[sid])) continue;
        const sv = getServiceById(sid);
        const resolverKey = buildStaffResolverKey(sid, sv);
        const cachedRows = staffByResolverCacheRef.current[resolverKey];
        if (Array.isArray(cachedRows)) {
          setStaffByService((p) => ({ ...p, [sid]: cachedRows }));
          continue;
        }

        try {
          setStaffLoadingByService((p) => ({ ...p, [sid]: true }));
          setStaffErrorByService((p) => ({ ...p, [sid]: "" }));
          const res = await listStaffForService(sid, sv);

          if (cancelled) return;

          const normalized = (res || []).filter((st: any) => {
            const name = String(st?.name || "").trim();
            if (!name) return false;
            return true;
          });

          setStaffByService((p) => ({ ...p, [sid]: normalized }));

          if (!normalized.length) {
            setStaffErrorByService((p) => ({
              ...p,
              [sid]: `ما فيه موظفات لهذه الخدمة حالياً.`,
            }));
          }
        } catch (e: any) {
          const msg = String(e?.message || "");
          let err = "تعذر تحميل قائمة الموظفات.";
          if (msg.toLowerCase().includes("requires an index")) {
            err = "Firestore يحتاج Index للاستعلام. افتح Console واضغط Create index.";
          }
          if (msg.toLowerCase().includes("missing or insufficient permissions")) {
            err = "صلاحيات قراءة الموظفات غير كافية (staff_public).";
          }

          setStaffByService((p) => ({ ...p, [sid]: [] }));
          setStaffErrorByService((p) => ({ ...p, [sid]: err }));
        } finally {
          if (!cancelled) {
            setStaffLoadingByService((p) => ({ ...p, [sid]: false }));
          }
        }
      }
    }

    loadNeededStaff();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.items]);

  async function collectTakenTimesForEmployeeDay(args: {
    salonId: string;
    employeeKey: string;
    employeeIdFallback: string;
    employeeUidFallback?: string;
    employeeNameFallback?: string;
    dateISO: string;
    forceFresh?: boolean;
  }) {
    const {
      salonId,
      employeeKey,
      employeeIdFallback,
      employeeUidFallback,
      employeeNameFallback,
      dateISO,
      forceFresh,
    } = args;

    const lookup = buildEmployeeLookupKeys({
      employeeKey,
      employeeIdFallback,
      employeeUidFallback,
      employeeNameFallback,
    });
    const cacheKey = `${String(salonId || "").trim()}__${String(dateISO || "").trim()}__${lookup.slotKeys.join("|")}`;
    const now = Date.now();

    if (!forceFresh) {
      const cached = takenTimesCacheRef.current[cacheKey];
      if (cached && now - Number(cached.ts || 0) <= TAKEN_TIMES_CACHE_TTL_MS) {
        return new Set<string>(cached.values || []);
      }
      const inFlight = takenTimesInFlightRef.current[cacheKey];
      if (inFlight) {
        const rows = await inFlight;
        return new Set<string>(rows);
      }
    }

    const pending = (async () => {
      const takenFs = new Set<string>();
      const colSlots = collection(db, "salons", salonId, "booking_slots");

      const primaryReads: Promise<any>[] = [
        ...lookup.primaryEmployeeKeyKeys.map((k) =>
          getDocs(query(colSlots, where("employeeKey", "==", k), where("date", "==", dateISO)))
        ),
        ...lookup.primaryEmployeeIdKeys.map((k) =>
          getDocs(query(colSlots, where("employeeId", "==", k), where("date", "==", dateISO)))
        ),
      ];

      const primarySnaps = await Promise.all(primaryReads);
      primarySnaps.forEach((snap) => {
        snap.docs.forEach((d: any) => {
          const t = String((d.data() as any)?.time || "").trim();
          if (t) takenFs.add(t);
        });
      });

      const fallbackReads: Promise<any>[] = [
        ...lookup.fallbackEmployeeKeyKeys.map((k) =>
          getDocs(query(colSlots, where("employeeKey", "==", k), where("date", "==", dateISO)))
        ),
        ...lookup.fallbackEmployeeIdKeys.map((k) =>
          getDocs(query(colSlots, where("employeeId", "==", k), where("date", "==", dateISO)))
        ),
      ];
      if (fallbackReads.length) {
        const snaps = await Promise.all(fallbackReads);
        snaps.forEach((snap) => {
          snap.docs.forEach((d: any) => {
            const t = String((d.data() as any)?.time || "").trim();
            if (t) takenFs.add(t);
          });
        });
      }

      takenTimesCacheRef.current[cacheKey] = {
        ts: Date.now(),
        values: Array.from(takenFs),
      };
      return takenFs;
    })();

    takenTimesInFlightRef.current[cacheKey] = pending;
    try {
      const rows = await pending;
      return new Set<string>(rows);
    } finally {
      delete takenTimesInFlightRef.current[cacheKey];
    }
  }

  async function collectBookedMetaForEmployeeDay(args: {
    salonId: string;
    employeeKey: string;
    employeeIdFallback: string;
    dateISO: string;
    forceFresh?: boolean;
  }) {
    const {
      salonId,
      employeeKey,
      employeeIdFallback,
      dateISO,
      forceFresh,
    } = args;
    const empKey = String(employeeKey || "").trim();
    const empId = String(employeeIdFallback || "").trim();
    if (!empKey && !empId) return {} as Record<string, string>;

    const cacheKey = `${String(salonId || "").trim()}__${String(dateISO || "").trim()}__${empKey}__${empId}`;
    const now = Date.now();

    if (!forceFresh) {
      const cached = bookedMetaCacheRef.current[cacheKey];
      if (cached && now - Number(cached.ts || 0) <= BOOKED_META_CACHE_TTL_MS) {
        return { ...(cached.values || {}) };
      }
      const inFlight = bookedMetaInFlightRef.current[cacheKey];
      if (inFlight) {
        const rows = await inFlight;
        return { ...rows };
      }
    }

    const pending = (async () => {
      const out: Record<string, string> = {};
      try {
        const colBookings = collection(db, "salons", salonId, "bookings");
        let bSnap;

        if (empKey) {
          bSnap = await getDocs(
            query(
              colBookings,
              where("employeeKey", "==", empKey),
              where("date", "==", dateISO),
              limit(250)
            )
          );
        } else {
          bSnap = await getDocs(
            query(
              colBookings,
              where("employeeId", "==", empId),
              where("date", "==", dateISO),
              limit(250)
            )
          );
        }

        if (bSnap.empty && empId) {
          bSnap = await getDocs(
            query(
              colBookings,
              where("employeeId", "==", empId),
              where("date", "==", dateISO),
              limit(250)
            )
          );
        }

        bSnap.docs.forEach((d) => {
          const data = d.data() as any;
          const t = String(data?.time || "").trim();
          const status = String(data?.status || "").toLowerCase();
          if (!t) return;
          if (["cancelled", "canceled", "rejected"].includes(status)) return;

          const clientName = String(data?.clientName || data?.name || "").trim();
          const clientPhone = phone10Digits(data?.clientPhone || data?.phone || "");
          const channel = String(data?.channel || data?.source || "").trim();
          const who = [clientName || "ط¨ط¯ظˆظ† ط§ط³ظ…", clientPhone ? `(${clientPhone})` : ""]
            .filter(Boolean)
            .join(" ");
          const ch = channel ? ` - ${channel}` : "";
          out[t] = `ظ…ط­ط¬ظˆط² - ${who}${ch}`;
        });
      } catch {
        // ignore
      }

      bookedMetaCacheRef.current[cacheKey] = {
        ts: Date.now(),
        values: { ...out },
      };
      return out;
    })();

    bookedMetaInFlightRef.current[cacheKey] = pending;
    try {
      const rows = await pending;
      return { ...rows };
    } finally {
      delete bookedMetaInFlightRef.current[cacheKey];
    }
  }

  function resolveBookableStartTimes(args: {
    allSlots: TimeSlot[];
    durationMin: number;
    takenAll: Set<string>;
  }) {
    const normalizedDuration = Number(args.durationMin || DEFAULT_SERVICE_DURATION_MIN);
    const slotsForThisService = filterSlotsByServiceEnd(
      args.allSlots,
      closeTime,
      normalizedDuration,
      bufferMin,
      ALLOW_OVERTIME_MIN
    );
    if (!slotsForThisService.length) return [] as string[];

    const greens = getGreenStartTimes({
      allSlots: args.allSlots,
      slotStepMin,
      durationMin: normalizedDuration,
      bufferMin,
      takenAll: args.takenAll,
    });

    return sortTimesBySlotOrder(
      slotsForThisService
      .map((s) => s.value24)
      .filter((t) => greens.has(t)),
      args.allSlots
    );
  }

  async function getAvailableStartsForDay(args: {
    salonId: string;
    employeeKey: string;
    employeeIdFallback: string;
    employeeUidFallback?: string;
    employeeNameFallback?: string;
    dateISO: string;
    durationMin: number;
    take: number;
    localTakenTimes?: Set<string>;
    staff?: StaffPublicWithId | null;
  }) {
    const {
      salonId,
      employeeKey,
      employeeIdFallback,
      employeeUidFallback,
      employeeNameFallback,
      dateISO,
      durationMin,
      take,
      localTakenTimes,
      staff,
    } = args;

    const baseSlots =
      timeSlots.length > 0
        ? timeSlots
        : generateSalonTimeSlots(openTime, closeTime, slotStepMin);
    if (!baseSlots.length) return [];

    const takenFs = await collectTakenTimesForEmployeeDay({
      salonId,
      employeeKey,
      employeeIdFallback,
      employeeUidFallback,
      employeeNameFallback,
      dateISO,
    });
    const takenAll = new Set<string>(takenFs);
    (localTakenTimes || new Set<string>()).forEach((t) => takenAll.add(t));

    const staffScopedSlots = staff
      ? filterStaffSlotsByWorkingHours(staff as any, {
          dateISO,
          slots: baseSlots,
          fallbackOpenTime: openTime,
          fallbackCloseTime: closeTime,
        })
      : baseSlots;
    if (!staffScopedSlots.length) return [];

    const list = resolveBookableStartTimes({
      allSlots: staffScopedSlots,
      durationMin: Number(durationMin || DEFAULT_SERVICE_DURATION_MIN),
      takenAll,
    });

    return list.slice(0, Math.max(1, take));
  }

  // =========================
  // ✅ Busy slots per item + تحميل معلومات الحجز الموجود
  // =========================
  useEffect(() => {
    let cancelled = false;

    async function loadBusyForItems() {
      const items = formData.items || [];
      const baseSlots =
        timeSlots.length > 0
          ? timeSlots
          : generateSalonTimeSlots(openTime, closeTime, slotStepMin);

      const takenFsCache = new Map<string, Promise<Set<string>>>();
      const bookedMetaCache = new Map<string, Promise<Record<string, string>>>();

      function getTakenFsForDay(it: CartItem, empKey: string, employeeId: string, date: string) {
        const lookup = buildEmployeeLookupKeys({
          employeeKey: empKey,
          employeeIdFallback: employeeId,
          employeeUidFallback: String(it.employeeUid || "").trim(),
          employeeNameFallback: String(it.employeeName || "").trim(),
        });
        const cacheKey = `${date}__${lookup.slotKeys.join("|")}`;
        if (!takenFsCache.has(cacheKey)) {
          const pending = collectTakenTimesForEmployeeDay({
            salonId: SALON_ID,
            employeeKey: empKey,
            employeeIdFallback: employeeId,
            employeeUidFallback: String(it.employeeUid || "").trim(),
            employeeNameFallback: String(it.employeeName || "").trim(),
            dateISO: date,
          });
          takenFsCache.set(cacheKey, pending);
        }
        return takenFsCache.get(cacheKey)!;
      }

      function getBookedMetaForDay(empKey: string, employeeId: string, date: string) {
        const cacheKey = `${date}__${empKey}__${employeeId}`;
        if (!bookedMetaCache.has(cacheKey)) {
          const pending = collectBookedMetaForEmployeeDay({
            salonId: SALON_ID,
            employeeKey: empKey,
            employeeIdFallback: employeeId,
            dateISO: date,
          });
          bookedMetaCache.set(cacheKey, pending);
        }
        return bookedMetaCache.get(cacheKey)!;
      }

      await Promise.all(
        items.map(async (it) => {
        if (cancelled) return;

        const itemId = it.id;
        const employeeId = String(it.employeeId || "").trim();
        const date = String(it.date || "").trim();
        const queryKey = `${employeeId}__${date}`;

        if (!employeeId || !date) {
          delete busyQueryKeyByItemRef.current[itemId];
          setBusyByItem((p) => ({ ...p, [itemId]: { ...emptyBusyState() } }));
          return;
        }

        setBusyByItem((p) => ({
          ...p,
          [itemId]: (() => {
            const prev = p[itemId];
            const prevQueryKey = busyQueryKeyByItemRef.current[itemId] || "";
            const shouldReset = !prev || prevQueryKey !== queryKey;
            return {
              ...(prev || emptyBusyState()),
              loading: shouldReset,
              hint: shouldReset ? "" : prev?.hint || "",
              disabledStartTimes: shouldReset
                ? new Set(baseSlots.map((s) => s.value24))
                : prev?.disabledStartTimes || new Set<string>(),
              disabledReasonByStart: shouldReset ? {} : prev?.disabledReasonByStart || {},
            };
          })(),
        }));

        try {
          const empKey = resolveEmployeeKey(it);
          if (!isCartItemStaffAvailable(it)) {
            const disabledAll = new Set(baseSlots.map((s) => s.value24));
            const allStarts = baseSlots.map((s) => s.value24);
            busyQueryKeyByItemRef.current[itemId] = queryKey;
            setBusyByItem((p) => ({
              ...p,
              [itemId]: {
                busyTimes: new Set<string>(),
                disabledStartTimes: disabledAll,
                loading: false,
                hint: "الموظفة غير متاحة في هذا اليوم.",
                suggestedSlot: "",
                disabledReasonByStart: buildUniformReasonByStarts(
                  allStarts,
                  "الموظفة غير متاحة في هذا اليوم."
                ),
                bookedMetaByTime: {},
              },
            }));
            if (String(it.time || "").trim()) {
              updateItem(itemId, { time: "", locked: false });
            }
            focusFutureSearchForCartItem(it, { scroll: false });
            return;
          }
          const takenFs = await getTakenFsForDay(it, empKey, employeeId, date);
          const bookedMetaByTime: Record<string, string> = {};

          if (cancelled) return;

          // 2) local cart
          const takenLocal = getLocalTakenTimesForItem(
            items,
            itemId,
            empKey,
            date,
            employeeId
          );

          const takenAll = new Set<string>();
          takenFs.forEach((x) => takenAll.add(x));
          takenLocal.forEach((x) => takenAll.add(x));

          const disabled = new Set<string>();
          const disabledReasonByStart: Record<string, string> = {};
          let sequentialHint = "";
          let suggestedSlot = "";
          let hasAnyAvailableForItem = false;
          const durationMin = Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN);
          const slotsForThisService = filterSlotsByServiceEnd(
            baseSlots,
            closeTime,
            durationMin,
            bufferMin,
            ALLOW_OVERTIME_MIN
          );
          const allowedByEndSet = new Set<string>(
            slotsForThisService.map((s) => s.value24)
          );
          const availableStarts = resolveBookableStartTimes({
            allSlots: baseSlots,
            durationMin,
            takenAll,
          });
          const availableSet = new Set<string>(availableStarts);
          baseSlots.forEach((s) => {
            const start = s.value24;
            if (!allowedByEndSet.has(start)) {
              disabled.add(start);
              disabledReasonByStart[start] =
                "لا يكفي لإنهاء مدة الخدمة مع البافر ضمن حدود الدوام.";
              return;
            }
            if (availableSet.has(start)) return;

            disabled.add(start);

            const needed = getTimesToLock(
              baseSlots,
              slotStepMin,
              start,
              durationMin,
              bufferMin
            );

            const conflictTime = needed.find((t) => takenAll.has(t));
            if (!conflictTime) {
              disabledReasonByStart[start] =
                "غير متاح بسبب تعارض ضمن نافذة مدة الخدمة والبافر.";
              return;
            }

            const conflictLabel = formatTime12(conflictTime, conflictTime);

            if (takenLocal.has(conflictTime)) {
              disabledReasonByStart[start] =
                `يتعارض مع خدمة أخرى في السلة عند ${conflictLabel}.`;
              return;
            }

            const meta = String(bookedMetaByTime[conflictTime] || "").trim();
            if (meta) {
              disabledReasonByStart[start] =
                `يتعارض عند ${conflictLabel}: ${meta}.`;
              return;
            }

            disabledReasonByStart[start] =
              `يتعارض مع حجز/قفل فعلي عند ${conflictLabel}.`;
          });
          hasAnyAvailableForItem = availableStarts.length > 0;

          if (sequentialBooking) {
            // ✅ طور متتابع: نظهر فقط الأوقات الخضراء (التي تكفي مدة+بافر بدون تعارض)
            // + نعطي اقتراح "أقرب وقت" بعد آخر نهاية (اقتراح فقط لا يمنع باقي الأخضر)

            // احسب آخر نهاية (من FS + من السلة) للاقتراح فقط
            let lastEndMin = -1;

            // FS last
            let lastTakenMinFs = -1;
            takenFs.forEach((t) => {
              const m = toMinutes(t);
              if (Number.isFinite(m)) lastTakenMinFs = Math.max(lastTakenMinFs, m);
            });
            if (lastTakenMinFs !== -1) lastEndMin = Math.max(lastEndMin, lastTakenMinFs + slotStepMin);

            // Local cart last (other items same staff/date)
            let lastTakenMinLocal = -1;
            items.forEach((other) => {
              if (other.id === itemId) return;

              const otherEmpKey = resolveEmployeeKey(other);
              if (otherEmpKey !== empKey) return;
              if (String(other.date || "").trim() !== date) return;

              const start = String(other.time || "").trim();
              if (!start) return;

              const locked = getTimesToLock(
                timeSlots,
                slotStepMin,
                start,
                Number(other.durationMin || 0),
                bufferMin
              );

              locked.forEach((label) => {
                const mm = toMinutes(label);
                if (Number.isFinite(mm)) lastTakenMinLocal = Math.max(lastTakenMinLocal, mm);
              });
            });
            if (lastTakenMinLocal !== -1) lastEndMin = Math.max(lastEndMin, lastTakenMinLocal + slotStepMin);

            // suggestedSlot = أقرب أخضر بعد lastEndMin
            let targetSlot = "";
            if (lastEndMin !== -1) {
              for (const start of availableStarts) {
                const m = toMinutes(start);
                if (Number.isFinite(m) && m >= lastEndMin) {
                  targetSlot = start;
                  break;
                }
              }
            }
            if (!targetSlot) {
              targetSlot = availableStarts[0] || "";
            }

            suggestedSlot = targetSlot;
            sequentialHint = targetSlot
              ? ""
              : "لا يوجد وقت متاح كافٍ لهذا اليوم مع هذه الموظفة.";
          } else {
            if (!hasAnyAvailableForItem) {
              sequentialHint = "لا يوجد وقت متاح كافٍ لهذا اليوم مع هذه الموظفة.";
            }
          }

          setBusyByItem((p) => ({
            ...p,
            [itemId]: {
              busyTimes: takenAll,
              disabledStartTimes: disabled,
              loading: false,
              hint: sequentialHint,
              suggestedSlot,
              disabledReasonByStart,
              bookedMetaByTime,
            },
          }));
          busyQueryKeyByItemRef.current[itemId] = queryKey;
          void getBookedMetaForDay(empKey, employeeId, date)
            .then((meta) => {
              if (cancelled) return;
              if (busyQueryKeyByItemRef.current[itemId] !== queryKey) return;
              setBusyByItem((p) => {
                const prev = p[itemId];
                if (!prev) return p;
                return {
                  ...p,
                  [itemId]: {
                    ...prev,
                    bookedMetaByTime: meta || {},
                  },
                };
              });
            })
            .catch(() => {
              // ignore
            });

          const currentTime = String(it.time || "").trim();
          if (currentTime && disabled.has(currentTime)) {
            updateItem(itemId, { time: "", locked: false });
          }

          if (!hasAnyAvailableForItem && String(it.employeeId || "").trim()) {
            focusFutureSearchForCartItem(it, { scroll: false });
          }
        } catch (e: any) {
          console.error(e);
          setBusyByItem((p) => ({
            ...p,
            [itemId]: { ...emptyBusyState(), hint: "تعذر تحميل التوفر حالياً." },
          }));
        }
        })
      );
    }

    loadBusyForItems();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.items, sequentialBooking, timeSlots, slotStepMin, bufferMin, openTime, closeTime, staffByService]);

  // =========================
  // Handlers
  // =========================
  function openBookingDatePicker() {
    if (bookingDateCalendar === "hijri") {
      const base = normalizeIsoDate(bookingDate) || todayISO();
      setHijriViewMonthISO(findHijriMonthStartISO(base));
      setHijriPickerOpen(true);
      return;
    }
    const el = dateRef.current;
    if (!el) return;
    try {
      (el as any).showPicker?.();
    } catch {
      // ignore browser limitations and just focus
    }
    el.focus();
  }

  function applyBookingDate(v: string) {
    setBookingDate(v);
    if (bookingDateCalendar === "hijri") setHijriPickerOpen(false);

    setFormData((prev) => ({
      ...prev,
      items: (prev.items || []).map((it) => {
        const sv = getServiceById(String(it.serviceId || "").trim());

        const basePatch = {
          ...it,
          date: v,
          time: "",
          employeeId: "",
          employeeUid: "",
          employeeName: "",
          locked: false,
        };

        if (sv) {
          const eff = pickEffectivePrice({
            basePrice: Number(sv.basePrice || 0),
            seasonPrice: Number((sv as any).seasonPrice || 0) || undefined,
            appSettings,
            dateISO: v,
          });
          const serviceBasePrice = Number(eff.price || 0);
          const toolsEligible = isToolsOptionEligibleForService(sv);
          const toolsSource = toolsEligible
            ? (String((it as any)?.toolsSource || "").trim() === "salon" ? "salon" : "client")
            : undefined;
          const priced = buildItemPriceWithTools(serviceBasePrice, toolsSource, toolsEligible);

          return {
            ...basePatch,
            serviceSectionId: String(sv.sectionId || "").trim(),
            serviceSectionTitle: String(sv.sectionTitle || "").trim() || undefined,
            serviceCategoryId: String(sv.categoryId || "").trim() || undefined,
            serviceCategoryName: String(sv.category || "").trim() || undefined,
            toolsSource,
            serviceBasePrice: priced.serviceBasePrice,
            toolsFeeApplied: priced.toolsFeeApplied,
            basePrice: priced.basePrice,
            priceText: priced.priceText,
          };
        }

        return basePatch;
      }),
    }));
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSectionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const sid = e.target.value;
    setSelectedSectionId(sid);
    setPickerScope(String(sid || "").trim() === PACKAGE_SECTION_ID ? "packages" : "services");
    setSelectedCategory("");
    setServicePicker("");
  };

  const handleCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedCategory(e.target.value);
    setServicePicker("");
  };

  const basePrice = useMemo(() => {
    return (formData.items || []).reduce((sum, it) => sum + Number(it.basePrice || 0), 0);
  }, [formData.items]);

  const finalPrice = useMemo(() => applied.finalPrice, [applied.finalPrice]);
  const baseSlotsForUi = useMemo(
    () =>
      timeSlots.length > 0
        ? timeSlots
        : generateSalonTimeSlots(openTime, closeTime, slotStepMin),
    [timeSlots, openTime, closeTime, slotStepMin]
  );

  useEffect(() => {
    const rawValue = Number(manualDiscountValue);
    const hasType = manualDiscountType === "fixed" || manualDiscountType === "percent";
    const value = Number.isFinite(rawValue) ? Math.max(0, rawValue) : 0;
    const warning =
      manualDiscountType === "percent" && value > 100
        ? "  100%   100% ."
        : "";
    const normalizedValue = manualDiscountType === "percent" ? Math.min(100, value) : value;
    const calc = calcManualDiscount(basePrice, hasType ? manualDiscountType : null, normalizedValue);

    const title =
      hasType && normalizedValue > 0
        ? manualDiscountType === "percent"
          ? `  (${normalizedValue.toFixed(0)}%)`
          : `  (${normalizedValue.toFixed(0)} )`
        : "";

    setApplied({
      discountType: hasType ? manualDiscountType : null,
      discountValue: normalizedValue,
      title,
      discountAmount: calc.discountAmount,
      finalPrice: calc.finalPrice,
    });
    setDiscountMsg(warning);
  }, [basePrice, manualDiscountType, manualDiscountValue]);

  function allocateDiscount(items: CartItem[], discountTotal: number) {
    const total = items.reduce((s, it) => s + Number(it.basePrice || 0), 0);
    if (!total || !discountTotal) return items.map(() => 0);

    const raw = items.map((it) => (Number(it.basePrice || 0) / total) * discountTotal);
    const rounded = raw.map((x) => Math.floor(x));
    let used = rounded.reduce((s, x) => s + x, 0);
    let remaining = Math.max(0, Math.round(discountTotal - used));

    let i = 0;
    while (remaining > 0 && items.length) {
      rounded[i % items.length] += 1;
      remaining -= 1;
      i += 1;
    }

    return rounded;
  }

  const checkOneItemSlot = async (it: CartItem) => {
    const employeeKey = resolveEmployeeKey(it);
    const employeeIdFallback = String(it.employeeId || "").trim();
    const date = String(it.date || "").trim();
    const time = String(it.time || "").trim();
    if (!employeeKey || !date || !time) return { ok: false, msg: "بيانات الوقت ناقصة" };
    if (!isCartItemStaffAvailable(it)) {
      return { ok: false, msg: "الموظفة غير متاحة في هذا اليوم." };
    }
    const staffList = (staffByService[String(it.serviceId || "").trim()] || []) as StaffPublicWithId[];
    const staff = staffList.find((s: any) => String(s?.id || "").trim() === String(it.employeeId || "").trim());
    if (
      staff &&
      !isStaffWorkingAtTime(staff as any, {
        dateISO: date,
        time24: time,
        fallbackOpenTime: openTime,
        fallbackCloseTime: closeTime,
      })
    ) {
      return { ok: false, msg: "الوقت المختار خارج ساعات عمل الموظفة في هذا اليوم." };
    }
    const baseSlots =
      timeSlots.length > 0
        ? timeSlots
        : generateSalonTimeSlots(openTime, closeTime, slotStepMin);
    const durationMin = Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN);
    const allowedStarts = filterSlotsByServiceEnd(
      baseSlots,
      closeTime,
      durationMin,
      bufferMin,
      ALLOW_OVERTIME_MIN
    );
    const allowedStartsByStaff = staff
      ? filterStaffSlotsByWorkingHours(staff as any, {
          dateISO: date,
          slots: allowedStarts,
          fallbackOpenTime: openTime,
          fallbackCloseTime: closeTime,
        })
      : allowedStarts;
    const isStartAllowed = allowedStartsByStaff.some((s) => s.value24 === time);
    if (!isStartAllowed) {
      return {
        ok: false,
        msg: "هذا الوقت لا يكفي مدة الخدمة مع البافر ضمن حدود دوام الصالون.",
      };
    }

    const timesToCheck = getTimesToLock(
      baseSlots,
      slotStepMin,
      time,
      durationMin,
      bufferMin
    );

    const localTaken = getLocalTakenTimesForItem(
      formData.items || [],
      it.id,
      employeeKey,
      date,
      String(it.employeeId || "").trim()
    );
    const localConflict = timesToCheck.some((t) => localTaken.has(t));
    if (localConflict) {
      return { ok: false, msg: "هذا الوقت يتعارض مع خدمة ثانية بنفس الموظفة داخل السلة. اختاري وقتًا آخر." };
    }

    try {
      const takenFs = await collectTakenTimesForEmployeeDay({
        salonId: SALON_ID,
        employeeKey,
        employeeIdFallback,
        employeeUidFallback: String(it.employeeUid || "").trim(),
        employeeNameFallback: String(it.employeeName || "").trim(),
        dateISO: date,
      });

      const anyTaken = timesToCheck.some((t) => takenFs.has(t));
      if (anyTaken) return { ok: false, msg: "هذا الوقت محجوز بالفعل لهذه الموظفة. اختاري وقتًا آخر." };

      return { ok: true, msg: "" };
    } catch {
      return { ok: false, msg: "تعذر فحص الوقت. جرّبي وقتًا آخر." };
    }
  };

  const validatePickedTime = async (itemId: string, pickedTime: string) => {
    const items = formData.items || [];
    const it = items.find((x) => x.id === itemId);
    if (!it) return;

    const nextTime = String(pickedTime || "").trim();
    if (!nextTime) return;

    const temp: CartItem = { ...it, time: nextTime };

    const employeeKey = resolveEmployeeKey(temp);
    const employeeIdFallback = String(temp.employeeId || "").trim();
    const date = String(temp.date || "").trim();
    const time = String(temp.time || "").trim();
    if (!employeeKey || !date || !time) return;
    if (!isCartItemStaffAvailable(temp)) {
      openModal({
        title: "الموظفة غير متاحة",
        message: "الموظفة المختارة غير متاحة في هذا اليوم.",
        variant: "danger",
        confirmText: "تمام",
      });
      updateItem(itemId, { time: "", locked: false });
      return;
    }
    const staffList = (staffByService[String(temp.serviceId || "").trim()] || []) as StaffPublicWithId[];
    const staff = staffList.find(
      (s: any) => String(s?.id || "").trim() === String(temp.employeeId || "").trim()
    );
    if (
      staff &&
      !isStaffWorkingAtTime(staff as any, {
        dateISO: date,
        time24: time,
        fallbackOpenTime: openTime,
        fallbackCloseTime: closeTime,
      })
    ) {
      openModal({
        title: "وقت خارج ساعات الموظفة",
        message: "الوقت المختار خارج ساعات عمل الموظفة في هذا اليوم.",
        variant: "danger",
        confirmText: "تمام",
      });
      updateItem(itemId, { time: "", locked: false });
      return;
    }
    const baseSlots =
      timeSlots.length > 0
        ? timeSlots
        : generateSalonTimeSlots(openTime, closeTime, slotStepMin);
    const durationMin = Number(temp.durationMin || DEFAULT_SERVICE_DURATION_MIN);
    const allowedStarts = filterSlotsByServiceEnd(
      baseSlots,
      closeTime,
      durationMin,
      bufferMin,
      ALLOW_OVERTIME_MIN
    );
    const allowedStartsByStaff = staff
      ? filterStaffSlotsByWorkingHours(staff as any, {
          dateISO: date,
          slots: allowedStarts,
          fallbackOpenTime: openTime,
          fallbackCloseTime: closeTime,
        })
      : allowedStarts;
    const isStartAllowed = allowedStartsByStaff.some((s) => s.value24 === time);
    if (!isStartAllowed) {
      openModal({
        title: "وقت غير متاح",
        message: "هذا الوقت لا يكفي مدة الخدمة مع البافر ضمن حدود دوام الصالون.",
        variant: "danger",
        confirmText: "تمام",
      });
      updateItem(itemId, { time: "", locked: false });
      return;
    }

    const timesToCheck = getTimesToLock(
      baseSlots,
      slotStepMin,
      time,
      durationMin,
      bufferMin
    );

    const localTaken = getLocalTakenTimesForItem(
      items,
      temp.id,
      employeeKey,
      date,
      String(temp.employeeId || "").trim()
    );
    const localConflict = timesToCheck.some((t) => localTaken.has(t));
    if (localConflict) {
      if (sequentialBooking) return;

      openModal({
        title: "تعارض في الوقت",
        message: "وقتك يتعارض مع خدمة ثانية بنفس الموظفة داخل السلة. اختاري وقتًا آخر.",
        variant: "danger",
        confirmText: "تمام",
      });
      updateItem(itemId, { time: "" });
      return;
    }

    try {
      const takenFs = await collectTakenTimesForEmployeeDay({
        salonId: SALON_ID,
        employeeKey,
        employeeIdFallback,
        employeeUidFallback: String(temp.employeeUid || "").trim(),
        employeeNameFallback: String(temp.employeeName || "").trim(),
        dateISO: date,
      });

      const anyTaken = timesToCheck.some((t) => takenFs.has(t));
      if (anyTaken) {
        openModal({
          title: "وقت غير متاح",
          message: "الوقت محجوز بالفعل (واضح عند الاستقبال). اختاري وقتًا ثاني.",
          variant: "danger",
          confirmText: "تمام",
        });
        updateItem(itemId, { time: "" });
        return;
      }
    } catch {
      openModal({
        title: "تعذر فحص الوقت",
        message: "ما قدرنا نتحقق من توفر الوقت الآن. جرّبي وقتًا ثاني.",
        variant: "danger",
        confirmText: "حسنًا",
      });
      updateItem(itemId, { time: "" });
    }
  };

  // =========================
  // Submit (الاستقبال)
  // =========================
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitMode = internalSubmitModeRef.current;
    const isFutureBooking = submitMode === "future";
    const selectedPaymentMethod = isFutureBooking ? null : internalPaymentMethodRef.current;
    if (!isFutureBooking && !selectedPaymentMethod) {
      setInternalPaymentMethodDraft("");
      setInternalPaymentModalOpen(true);
      return;
    }

    const phone = (formData.phone ?? "").replace(/\D/g, "");
    const isValidSaudiMobile = /^05\d{8}$/.test(phone);

    if (!isValidSaudiMobile) {
      openModal({
        title: "رقم الجوال غير صحيح",
        message: "لازم يبدأ بـ 05 ويكون 10 أرقام.",
        variant: "danger",
        confirmText: "تعديل",
      });
      return;
    }

    const items = (formData.items || []).map((x) => ({ ...x }));
    if (!items.length) {
      openModal({
        title: "اختيار الخدمات",
        message: "فضلاً اختاري خدمة واحدة على الأقل.",
        variant: "danger",
        confirmText: "حسنًا",
      });
      return;
    }

    if (!String(bookingDate || "").trim()) {
      openModal({
        title: "اختيار التاريخ",
        message: "فضلاً اختاري تاريخ الحجز أولاً.",
        variant: "danger",
        confirmText: "حسنًا",
      });
      return;
    }

    const bookingDayCfg = getDaySettingsForDate(String(bookingDate || "").trim());
    if (!bookingDayCfg.enabled) {
      openModal({
        title: "اليوم مغلق",
        message: `يوم ${bookingDayCfg.dayLabel} إجازة في الصالون، لذلك لا يمكن الحجز فيه.`,
        variant: "danger",
        confirmText: "حسنًا",
      });
      return;
    }

    const closedItem = items.find((it) => {
      const d = String(it.date || bookingDate || "").trim();
      if (!d) return false;
      return !getDaySettingsForDate(d).enabled;
    });
    if (closedItem) {
      const d = String(closedItem.date || bookingDate || "").trim();
      const cfg = getDaySettingsForDate(d);
      openModal({
        title: "أحد تواريخ الخدمات مغلق",
        message: `الخدمة "${closedItem.serviceName}" بتاريخ ${d} تقع في يوم ${cfg.dayLabel} وهو مغلق.`,
        variant: "danger",
        confirmText: "حسنًا",
      });
      return;
    }

    const missing = items.find((it) => {
      if (!String(it.employeeId || "").trim()) return true;
      if (!String(it.employeeName || "").trim()) return true;
      if (!String(it.time || "").trim()) return true;
      return false;
    });

    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1];
      const prevOk = String(prev.employeeId || "").trim() && String(prev.time || "").trim();
      if (!prevOk) {
        openModal({
          title: "ترتيب الخدمات",
          message: "لازم تكمّلين بيانات الخدمة الأولى قبل ما تحددين الخدمة اللي بعدها ✅",
          variant: "danger",
          confirmText: "تمام",
        });
        return;
      }
    }

    if (missing) {
      openModal({
        title: "بيانات الحجز ناقصة",
        message: "لكل خدمة داخل السلة: لازم تختارين (الموظفة + التاريخ + الوقت).",
        variant: "danger",
        confirmText: "حسنًا",
      });
      return;
    }

    const notLocked = items.find((x) => !x.locked);
    if (notLocked) {
      openModal({
        title: "كمّلي خطوات الحجز",
        message: "لازم تضغطين (تأكيد الموظفة والوقت) لكل خدمة قبل الحفظ النهائي.",
        variant: "danger",
        confirmText: "تمام",
      });
      return;
    }

    const overlap = findCartOverlap(items);
    if (!overlap.ok) {
      openModal({
        title: "تعارض في الأوقات",
        message:
          `عندك خدمتين متداخلات بنفس الموظفة ونفس اليوم:\n\n` +
          `• ${String(overlap.a?.serviceName || "—")} (${formatTime12(String(overlap.a?.time || "—"), "—")})\n` +
          `• ${String(overlap.b?.serviceName || "—")} (${formatTime12(String(overlap.b?.time || "—"), "—")})\n\n` +
          `عدّلي وقت واحدة منهم ✅`,
        variant: "danger",
        confirmText: "تمام",
      });
      return;
    }

    setIsLoading(true);

    try {
      const finalApplied: AppliedOfferResult = applied;
      for (const it of items) {
        const check = await checkOneItemSlot(it);
        if (!check.ok) {
          openModal({
            title: "الوقت غير متاح",
            message: `خدمة "${it.serviceName}": ${check.msg}`,
            variant: "danger",
            confirmText: "حسنًا",
          });
          return;
        }
      }

      const discountTotal = Number(finalApplied.discountAmount || 0);
      const applicableIdx: number[] = discountTotal > 0 ? items.map((_, idx) => idx) : [];

      const perItemDiscounts = items.map(() => 0);

      if (discountTotal > 0 && applicableIdx.length) {
        const applicableItems = applicableIdx.map((i) => items[i]);
        const allocated = allocateDiscount(applicableItems, discountTotal);
        applicableIdx.forEach((originalIndex, j) => {
          perItemDiscounts[originalIndex] = Number(allocated[j] || 0);
        });
      }

      // ✅ الاستقبال: الموظف لازم يكون مسجل دخول
      const authNow = getAuth();
      const staffUid = authNow.currentUser?.uid || "";
      if (!staffUid) {
        openModal({
          title: "تسجيل دخول الموظف مطلوب",
          message: "لازم موظفة الاستقبال/الإدارة تكون مسجلة دخول عشان الحجز الداخلي.",
          variant: "danger",
          confirmText: "تمام",
        });
        return;
      }

      const userNote = String(formData.note || "").trim();
      const offerNote = finalApplied.title
        ? `Offer: ${finalApplied.title} | discount=${Number(finalApplied.discountAmount || 0).toFixed(0)}`
        : "";

      const paymentNote = selectedPaymentMethod ? `payment_method:${selectedPaymentMethod}` : "";
      const noteFinal = [userNote, offerNote, paymentNote].filter(Boolean).join(" | ") || undefined;

      const createdBookings: any[] = [];
      const processedPackageRuns = new Set<string>();
      const incomeMethod =
        selectedPaymentMethod === "transfer" ? "bank_transfer" : selectedPaymentMethod;

      for (let idx = 0; idx < items.length; idx++) {
        const it = items[idx];
        const itemDiscount = Number(perItemDiscounts[idx] || 0);
        const itemFinal = Math.max(0, Number(it.basePrice || 0) - itemDiscount);
        const toolsNote = buildItemToolsNote(it);
        const itemNote = [noteFinal, toolsNote].filter(Boolean).join(" | ") || undefined;

        const durationMin = Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN);
        const packageRunId = String(it.packageRunId || "").trim();
        if (packageRunId) {
          if (processedPackageRuns.has(packageRunId)) continue;

          const runEntries = items
            .map((row, rowIdx) => ({ item: row, idx: rowIdx }))
            .filter(({ item }) => String(item.packageRunId || "").trim() === packageRunId);

          if (runEntries.length > 1) {
            if (!createBookingGroup) throw new Error("GROUP_BOOKING_UNAVAILABLE");
            processedPackageRuns.add(packageRunId);

            const sortedRun = [...runEntries].sort((a, b) => {
              const aDate = String(a.item.date || bookingDate || "").trim();
              const bDate = String(b.item.date || bookingDate || "").trim();
              if (aDate !== bDate) return aDate.localeCompare(bDate);
              const aTime = String(a.item.time || "").trim();
              const bTime = String(b.item.time || "").trim();
              if (aTime !== bTime) return aTime.localeCompare(bTime);
              return a.idx - b.idx;
            });

            const runDateISO = String(sortedRun[0]?.item?.date || bookingDate || "").trim();
            const parentStartTime = String(sortedRun[0]?.item?.time || "").trim();
            const parentDurationMin = sortedRun.reduce(
              (sum, row) =>
                sum + Math.max(1, Number(row.item.durationMin || DEFAULT_SERVICE_DURATION_MIN)),
              0
            );

            const packageName = String(
              it.packageSnapshot?.packageName || it.serviceName || "باكيج"
            ).trim();
            const packageIdRaw = String(it.packageId || it.packageSnapshot?.packageId || "").trim();
            const runBaseTotal = sortedRun.reduce(
              (sum, row) => sum + Math.max(0, Number(row.item.basePrice || 0)),
              0
            );
            const runDiscountTotal = sortedRun.reduce(
              (sum, row) => sum + Math.max(0, Number(perItemDiscounts[row.idx] || 0)),
              0
            );
            const runFinalTotal = sortedRun.reduce((sum, row) => {
              const d = Number(perItemDiscounts[row.idx] || 0);
              return sum + Math.max(0, Number(row.item.basePrice || 0) - d);
            }, 0);

            const employeeIdsInRun = Array.from(
              new Set(
                sortedRun
                  .map((x) => String(x.item.employeeId || "").trim())
                  .filter(Boolean)
              )
            );
            const hasSingleEmployeeForRun = employeeIdsInRun.length === 1;
            const runEmployee = hasSingleEmployeeForRun
              ? sortedRun.find(
                (x) => String(x.item.employeeId || "").trim() === employeeIdsInRun[0]
              )?.item
              : undefined;

            const lead = sortedRun[0].item;
            const packageSnapshot = {
              packageId: packageIdRaw || String(it.serviceId || "").trim(),
              packageName,
              finalPriceAtBooking: Number(runFinalTotal || 0),
              baseTotalPriceAtBooking: Number(runBaseTotal || 0),
              totalDurationMinAtBooking: Number(parentDurationMin || 0),
              serviceIds: sortedRun
                .map((x) => String(x.item.serviceId || "").trim())
                .filter(Boolean),
              services: sortedRun.map((x) => ({
                serviceId: String(x.item.serviceId || "").trim(),
                serviceName: String(x.item.serviceName || "").trim() || "خدمة",
                sectionId: String(x.item.serviceSectionId || "").trim() || undefined,
                price: Math.max(
                  0,
                  Number(x.item.basePrice || 0) - Number(perItemDiscounts[x.idx] || 0)
                ),
                durationMin: Math.max(
                  1,
                  Number(x.item.durationMin || DEFAULT_SERVICE_DURATION_MIN)
                ),
              })),
            };

            const groupRes = await createBookingGroup({
              parent: {
                userId: staffUid,
                createdBy: "staff",
                channel: "internal",
                clientName: String(formData.name || "").trim(),
                clientPhone: phone,
                serviceName: packageName,
                serviceId: packageIdRaw
                  ? `package:${packageIdRaw}`
                  : String(it.serviceId || "").trim(),
                serviceSnapshot: {
                  serviceNameAtBooking: packageName,
                  priceAtBooking: Number(runFinalTotal || 0),
                  durationAtBooking: parentDurationMin,
                  sectionIdAtBooking: String(lead.serviceSectionId || "").trim() || undefined,
                  sectionTitleAtBooking:
                    String(lead.serviceSectionTitle || "").trim() || undefined,
                  categoryIdAtBooking:
                    String(lead.serviceCategoryId || "").trim() || undefined,
                  categoryNameAtBooking:
                    String(lead.serviceCategoryName || "").trim() || undefined,
                },
                packageId: packageIdRaw || undefined,
                packageSnapshot,
                employeeId: hasSingleEmployeeForRun
                  ? String(runEmployee?.employeeId || "").trim() || null
                  : null,
                employeeUid: hasSingleEmployeeForRun
                  ? String(runEmployee?.employeeUid || "").trim() || null
                  : null,
                employeeName: hasSingleEmployeeForRun
                  ? String(runEmployee?.employeeName || "").trim() || "تعيين تلقائي"
                  : "تعيين تلقائي",
                date: runDateISO,
                time: parentStartTime,
                total: Number(runFinalTotal || 0),
                finalPrice: Number(runFinalTotal || 0),
                discountAmount: Number(runDiscountTotal || 0),
                discountType: finalApplied.discountType || null,
                discountValue: Number(finalApplied.discountValue || 0),
                offerTitle: finalApplied.title || null,
                status: isFutureBooking ? "pending" : "completed",
                ...(selectedPaymentMethod ? { paymentMethod: selectedPaymentMethod } : {}),
                ...(!isFutureBooking ? { paidAt: Date.now() } : {}),
                note: [noteFinal, `packageRunId=${packageRunId}`, `packageItems=${sortedRun.length}`]
                  .filter(Boolean)
                  .join(" | "),
                slotStepMinAtBooking: slotStepMin,
                bufferMinAtBooking: bufferMin,
                durationMin: parentDurationMin,
              } as any,
              items: sortedRun.map(({ item, idx: sourceIdx }, itemOrder) => {
                const currentFinal = Math.max(
                  0,
                  Number(item.basePrice || 0) - Number(perItemDiscounts[sourceIdx] || 0)
                );
                const currentItemToolsNote = buildItemToolsNote(item);
                const currentItemNote =
                  [noteFinal, currentItemToolsNote, `packageRunId=${packageRunId}`, `packageIndex=${itemOrder + 1}`]
                    .filter(Boolean)
                    .join(" | ") || undefined;

                return {
                  userId: staffUid,
                  createdBy: "staff",
                  channel: "internal",
                  clientName: String(formData.name || "").trim(),
                  clientPhone: phone,
                  serviceName: String(item.serviceName || "").trim(),
                  serviceId: String(item.serviceId || "").trim(),
                  packageId: packageIdRaw || undefined,
                  packageSnapshot,
                  serviceSnapshot: {
                    serviceNameAtBooking: String(item.serviceName || "").trim(),
                    priceAtBooking: Number(currentFinal || 0),
                    durationAtBooking: Math.max(
                      1,
                      Number(item.durationMin || DEFAULT_SERVICE_DURATION_MIN)
                    ),
                    sectionIdAtBooking:
                      String(item.serviceSectionId || "").trim() || undefined,
                    sectionTitleAtBooking:
                      String(item.serviceSectionTitle || "").trim() || undefined,
                    categoryIdAtBooking:
                      String(item.serviceCategoryId || "").trim() || undefined,
                    categoryNameAtBooking:
                      String(item.serviceCategoryName || "").trim() || undefined,
                  },
                  employeeId: String(item.employeeId || "").trim(),
                  employeeUid: String(item.employeeUid || "").trim() || null,
                  employeeName: String(item.employeeName || "").trim() || "-",
                  date: String(item.date || bookingDate || "").trim(),
                  time: String(item.time || "").trim(),
                  total: Number(currentFinal || 0),
                  finalPrice: Number(currentFinal || 0),
                  discountAmount: Number(perItemDiscounts[sourceIdx] || 0),
                  discountType: finalApplied.discountType || null,
                  discountValue: Number(finalApplied.discountValue || 0),
                  offerTitle: finalApplied.title || null,
                  status: isFutureBooking ? "pending" : "completed",
                  ...(selectedPaymentMethod ? { paymentMethod: selectedPaymentMethod } : {}),
                  ...(!isFutureBooking ? { paidAt: Date.now() } : {}),
                  note: currentItemNote,
                  slotStepMinAtBooking: slotStepMin,
                  bufferMinAtBooking: bufferMin,
                  durationMin: Math.max(
                    1,
                    Number(item.durationMin || DEFAULT_SERVICE_DURATION_MIN)
                  ),
                };
              }) as any,
            });

            createdBookings.push({
              bookingId: groupRes.parentId,
              id: groupRes.parentId,
              trackId: groupRes.parentId,
              publicId: groupRes.parentPublicId,
              name: String(formData.name || "").trim(),
              phone,
              service: packageIdRaw ? `package:${packageIdRaw}` : String(it.serviceId || "").trim(),
              serviceName: packageName,
              packageId: packageIdRaw || null,
              packageSnapshot,
              employee: hasSingleEmployeeForRun
                ? String(runEmployee?.employeeName || "").trim() || "تعيين تلقائي"
                : "تعيين تلقائي",
              employeeId: hasSingleEmployeeForRun
                ? String(runEmployee?.employeeId || "").trim() || null
                : null,
              employeeUid: hasSingleEmployeeForRun
                ? String(runEmployee?.employeeUid || "").trim() || null
                : null,
              date: runDateISO,
              time: parentStartTime,
              total: Number(runFinalTotal || 0),
              finalPrice: Number(runFinalTotal || 0),
              couponCode: "",
              offerId: null,
              offerTitle: finalApplied.title || null,
              discountAmount: runDiscountTotal,
              discountType: finalApplied.discountType || null,
              discountValue: Number(finalApplied.discountValue || 0),
              durationMin: parentDurationMin,
              status: isFutureBooking ? "pending" : "completed",
              ...(selectedPaymentMethod ? { paymentMethod: selectedPaymentMethod } : {}),
              ...(!isFutureBooking ? { paidAt: Date.now() } : {}),
              channel: "internal",
              bookingGroupId: groupRes.parentId,
              subBookingIds: groupRes.itemIds,
              createdAt: Date.now(),
            });

            if (!isFutureBooking && selectedPaymentMethod && incomeMethod) {
              await upsertIncomeFS(
                {
                  id: String(groupRes.parentId || "").trim(),
                  date: todayISO(),
                  amount: Number(runFinalTotal || 0),
                  method: incomeMethod as any,
                  source: "booking",
                  bookingId: String(groupRes.parentId || "").trim(),
                  note: `internal_payment:${selectedPaymentMethod}`,
                  createdAt: Date.now(),
                } as any,
                SALON_ID
              );
            }
            continue;
          }
        }

        const sv = getServiceById(String(it.serviceId || "").trim());
        const sectionIdAtBooking =
          String(it.serviceSectionId || "").trim() ||
          String(sv?.sectionId || "").trim() ||
          undefined;
        const sectionTitleAtBooking =
          String(it.serviceSectionTitle || "").trim() ||
          String(sv?.sectionTitle || "").trim() ||
          sectionIdAtBooking ||
          undefined;
        const categoryIdAtBooking =
          String(it.serviceCategoryId || "").trim() ||
          String(sv?.categoryId || "").trim() ||
          undefined;
        const categoryNameAtBooking =
          String(it.serviceCategoryName || "").trim() ||
          String(sv?.category || "").trim() ||
          categoryIdAtBooking ||
          undefined;
        const serviceSnapshotAtBooking = {
          serviceNameAtBooking: it.serviceName,
          priceAtBooking: Number(itemFinal || 0),
          durationAtBooking: durationMin,
          sectionIdAtBooking,
          sectionTitleAtBooking,
          categoryIdAtBooking,
          categoryNameAtBooking,
        };

        const res = await createBooking({
          userId: staffUid,
          createdBy: "staff",
          channel: "internal",

          clientName: String(formData.name || "").trim(),
          clientPhone: phone,

          serviceName: it.serviceName,
          serviceId: it.serviceId,
          packageId: String(it.packageId || "").trim() || undefined,
          packageSnapshot: it.packageSnapshot || undefined,

          serviceSnapshot: serviceSnapshotAtBooking,

          employeeId: String(it.employeeId || "").trim(),
          employeeUid: String(it.employeeUid || "").trim() || null,
          employeeName: String(it.employeeName || "").trim() || "-",

          date: String(it.date || "").trim(),
          time: String(it.time || "").trim(), // ✅ 24h

          total: Number(itemFinal || 0),
          finalPrice: Number(itemFinal || 0),
          discountAmount: itemDiscount,
          discountType: finalApplied.discountType || null,
          discountValue: Number(finalApplied.discountValue || 0),
          offerTitle: finalApplied.title || null,

          status: isFutureBooking ? "pending" : "completed",
          ...(selectedPaymentMethod ? { paymentMethod: selectedPaymentMethod } : {}),
          ...(!isFutureBooking ? { paidAt: Date.now() } : {}),
          note: itemNote,

          slotStepMinAtBooking: slotStepMin,
          bufferMinAtBooking: bufferMin,
          durationMin,
        } as any);

        createdBookings.push({
          bookingId: res.id,
          id: res.id,
          trackId: res.id,
          publicId: (res as any).publicId,

          clientName: String(formData.name || "").trim(),
          clientPhone: phone,

          name: String(formData.name || "").trim(),
          phone,

          service: it.serviceId,
          serviceName: it.serviceName,
          serviceSectionId: sectionIdAtBooking || undefined,
          serviceSectionTitle: sectionTitleAtBooking || undefined,
          serviceCategoryId: categoryIdAtBooking || undefined,
          serviceCategoryName: categoryNameAtBooking || undefined,
          serviceSnapshot: serviceSnapshotAtBooking,
          packageId: String(it.packageId || "").trim() || null,
          packageSnapshot: it.packageSnapshot || null,

          employeeName: String(it.employeeName || "").trim(),
          employeeId: String(it.employeeId || "").trim(),
          employeeUid: String(it.employeeUid || "").trim(),

          date: String(it.date || "").trim(),
          time: String(it.time || "").trim(), // ✅ 24h

          total: Number(itemFinal || 0),
          finalPrice: Number(itemFinal || 0),

          couponCode: "",
          offerId: null,
          offerTitle: finalApplied.title || null,
          discountAmount: itemDiscount,
          discountType: finalApplied.discountType || null,
          discountValue: Number(finalApplied.discountValue || 0),

          durationMin,
          toolsSource: String(it.toolsSource || "").trim() || null,
          toolsFeeApplied: Number(it.toolsFeeApplied || 0),
          status: isFutureBooking ? "pending" : "completed",
          ...(selectedPaymentMethod ? { paymentMethod: selectedPaymentMethod } : {}),
          ...(!isFutureBooking ? { paidAt: Date.now() } : {}),
          createdAt: Date.now(),
          channel: "internal",
        });

        if (!isFutureBooking && selectedPaymentMethod && incomeMethod) {
          await upsertIncomeFS(
            {
              id: String(res.id || "").trim(),
              date: todayISO(),
              amount: Number(itemFinal || 0),
              method: incomeMethod as any,
              source: "booking",
              bookingId: String(res.id || "").trim(),
              note: `internal_payment:${selectedPaymentMethod}`,
              createdAt: Date.now(),
            } as any,
            SALON_ID
          );
        }
      }

      localStorage.setItem("allBookings", JSON.stringify(createdBookings));
      localStorage.setItem("currentBooking", JSON.stringify(createdBookings[0] || null));
      localStorage.removeItem("bookingDraft");
      internalPaymentMethodRef.current = null;

      if (isFutureBooking) {
        navigate("/success");
      } else {
        if (!openInternalPrintPopup()) notifyInvoicePopupBlocked();
      }
    } catch (e: any) {
      if (!isFutureBooking) closePendingInvoicePopup();
      console.error(e);

      if (e?.code === "SLOT_TAKEN" || String(e?.message || "") === "SLOT_TAKEN") {
        openModal({
          title: "الوقت محجوز",
          message: "هذا الوقت محجوز بالفعل. اختاري وقتًا آخر.",
          variant: "danger",
          confirmText: "حسنًا",
        });
        return;
      }

      if (e?.code === "BOOKING_DAY_CLOSED") {
        openModal({
          title: "اليوم مغلق",
          message: "اليوم المختار إجازة في إعدادات الدوام. اختاري تاريخًا آخر للحجز.",
          variant: "danger",
          confirmText: "حسنًا",
        });
        return;
      }

      if (e?.code === "BOOKING_TIME_OUT_OF_HOURS") {
        openModal({
          title: "وقت خارج الدوام",
          message: "الوقت المختار خارج ساعات العمل لليوم المحدد. اختاري وقتًا آخر.",
          variant: "danger",
          confirmText: "حسنًا",
        });
        return;
      }

      openModal({
        title: "تعذر حفظ الحجز",
        message:
          `صار خطأ أثناء حفظ الحجز.\n\n` +
          `code: ${String(e?.code || "—")}\n` +
          `message: ${String(e?.message || "—")}`,
        variant: "danger",
        confirmText: "حسنًا",
      });
    } finally {
      setIsLoading(false);
      internalPaymentMethodRef.current = null;
      internalSubmitModeRef.current = "payment";
    }
  };

  // =========================
  // Restore draft (optional)
  // =========================
  useEffect(() => {
    const draft = localStorage.getItem("bookingDraft");
    if (!draft) return;

    try {
      const parsed = JSON.parse(draft);
      const items: CartItem[] = Array.isArray(parsed?.items) ? parsed.items : [];

      setFormData((prev) => ({
        ...prev,
        ...parsed,
        phone: String(parsed?.phone || "").replace(/\D/g, "").slice(0, 10),
        items: items.map((it) => {
          const serviceId = String(it?.serviceId || "").trim();
          const sv = getServiceById(serviceId);
          const sectionId =
            String((it as any)?.serviceSectionId || "").trim() ||
            String(sv?.sectionId || "").trim();
          const sectionTitle =
            String((it as any)?.serviceSectionTitle || "").trim() ||
            String(sv?.sectionTitle || "").trim();

          const toolsEligible = isManiPediSectionByInfo(sectionId, sectionTitle);
          const toolsSource = toolsEligible
            ? (String((it as any)?.toolsSource || "").trim() === "salon" ? "salon" : "client")
            : undefined;

          const rawServiceBase = Number((it as any)?.serviceBasePrice);
          const serviceBasePrice = Number.isFinite(rawServiceBase)
            ? Math.max(0, rawServiceBase)
            : Math.max(
                0,
                Number((it as any)?.basePrice ?? 0) -
                  Math.max(0, Number((it as any)?.toolsFeeApplied || 0))
              );
          const priced = buildItemPriceWithTools(serviceBasePrice, toolsSource, toolsEligible);

          return {
            ...it,
            id: String(it?.id || makeLocalId()),
            durationMin: Number(it?.durationMin || DEFAULT_SERVICE_DURATION_MIN),
            serviceId,
            serviceName: String(it?.serviceName || "").trim(),
            packageId:
              String((it as any)?.packageId || "").trim() ||
              (sv?.kind === "package" ? String(sv.packageId || "").trim() : undefined),
            packageSnapshot:
              (it as any)?.packageSnapshot ||
              (sv?.kind === "package" && sv.packageId
                ? {
                    packageId: String(sv.packageId || "").trim(),
                    packageName: sv.name,
                    finalPriceAtBooking: Number(sv.basePrice || 0),
                    baseTotalPriceAtBooking: Number(sv.packageBaseTotalPrice || sv.basePrice || 0),
                    totalDurationMinAtBooking: Number(sv.durationMin || DEFAULT_SERVICE_DURATION_MIN),
                    serviceIds: Array.isArray(sv.packageServiceIds) ? sv.packageServiceIds : [],
                    services: Array.isArray(sv.packageServices) ? sv.packageServices : [],
                  }
                : undefined),
            employeeId: String(it?.employeeId || "").trim(),
            employeeUid: String(it?.employeeUid || "").trim(),
            employeeName: String(it?.employeeName || "").trim(),
            date: String(it?.date || "").trim(),
            time: String(it?.time || "").trim(),
            serviceSectionId: sectionId,
            serviceSectionTitle: sectionTitle || undefined,
            serviceCategoryId: String((it as any)?.serviceCategoryId || "").trim() || undefined,
            serviceCategoryName: String((it as any)?.serviceCategoryName || "").trim() || undefined,
            toolsSource,
            serviceBasePrice: priced.serviceBasePrice,
            toolsFeeApplied: priced.toolsFeeApplied,
            basePrice: priced.basePrice,
            priceText: priced.priceText,
          };
        }),
      }));
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const previewCreatedAtLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("ar-SA", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date()),
    []
  );

  const bookingPreviewItems = (formData.items || []).map((it, idx) => {
    const sv = getServiceById(String(it.serviceId || "").trim());
    const sectionLabel =
      String(it.serviceSectionTitle || "").trim() ||
      String(sv?.sectionTitle || "").trim() ||
      String(it.serviceSectionId || "").trim() ||
      String(sv?.sectionId || "").trim() ||
      "—";
    const categoryLabel =
      String(it.serviceCategoryName || "").trim() ||
      String(sv?.category || "").trim() ||
      String(it.serviceCategoryId || "").trim() ||
      String(sv?.categoryId || "").trim() ||
      "—";

    return {
      id: String(it.id || `row-${idx}`),
      index: idx + 1,
      serviceName: String(it.serviceName || "").trim() || "—",
      sectionLabel,
      categoryLabel,
      staffName: String(it.employeeName || "").trim() || "—",
      date: String(it.date || bookingDate || "").trim() || "—",
      timeLabel: formatTime12(String(it.time || "").trim(), "—"),
      durationMin: Math.max(0, Number(it.durationMin || 0)),
      priceLabel: `${Number(it.basePrice || 0).toFixed(0)} ريال`,
      toolsNote: buildItemToolsNote(it),
      locked: !!it.locked,
    };
  });
  const lockedPreviewCount = bookingPreviewItems.filter((x) => x.locked).length;
  const totalPreviewCount = bookingPreviewItems.length;
  const allPreviewLocked = totalPreviewCount > 0 && lockedPreviewCount === totalPreviewCount;
  const shouldShowFutureSearchPanel = useMemo(() => {
    const items = formData.items || [];
    if (!items.length) return false;

    return items.some((it) => {
      const employeeId = String(it.employeeId || "").trim();
      if (!employeeId) return false;

      const sid = String(it.serviceId || "").trim();
      const staffList = (staffByService[sid] || []) as StaffPublicWithId[];
      if (!staffList.length) return false;

      const dateISO = String(it.date || bookingDate || "").trim();
      const visibleStaff = staffList.filter(
        (st: any) =>
          (st as any)?.showOnBooking !== false &&
          !isStaffEmploymentEndedForDate(st as any, dateISO)
      );
      const selectedStaff = visibleStaff.find(
        (st: any) => String((st as any)?.id || "").trim() === employeeId
      );
      if (!selectedStaff) return false;

      const busy = busyByItem[it.id] || emptyBusyState();
      if (busy.loading) return false;

      const slotsForSelectedStaff = filterStaffSlotsByWorkingHours(selectedStaff as any, {
        dateISO,
        slots: baseSlotsForUi,
        fallbackOpenTime: openTime,
        fallbackCloseTime: closeTime,
      });
      const availableTimeSlots = slotsForSelectedStaff.filter(
        (s) => !busy.disabledStartTimes?.has(s.value24)
      );
      return availableTimeSlots.length === 0;
    });
  }, [formData.items, staffByService, bookingDate, busyByItem, baseSlotsForUi, openTime, closeTime]);
  const sideCardsMatchServiceStyle: React.CSSProperties | undefined =
    serviceSectionHeightPx > 0
      ? { height: `${serviceSectionHeightPx}px`, maxHeight: `${serviceSectionHeightPx}px` }
      : undefined;

  return (
    <div className="bk-page-wrapper bk-internal">
      
      <div className="bk-internal-page py-5">
      <ConfirmModal
        open={uiModal.open}
        title={uiModal.title}
        message={uiModal.message}
        variant={uiModal.variant}
        confirmText={uiModal.confirmText || "حسنًا"}
        onCancel={() => closeModal()}
        onConfirm={() => {
          const fn = onUiConfirm;
          closeModal();
          if (fn) fn();
        }}
      />
      <Modal
        open={internalPaymentModalOpen}
        onClose={() => {
          if (isLoading) return;
          setInternalPaymentModalOpen(false);
          setInternalPaymentMethodDraft("");
        }}
        ariaLabel={"اختر طريقة الدفع"}
        size="sm"
      >
        <div className="p-3 bk-pay-modal">
          <h5 className="mb-2 bk-pay-modal-title">
            {"اختر طريقة الدفع"}
          </h5>
          <div className="d-grid gap-2 bk-pay-methods">
            <button
              type="button"
              className={`btn bk-pay-method-btn ${internalPaymentMethodDraft === "card" ? "is-active" : ""}`}
              onClick={() => setInternalPaymentMethodDraft("card")}
              disabled={isLoading}
            >
              {"💳 شبكة"}
            </button>
            <button
              type="button"
              className={`btn bk-pay-method-btn ${internalPaymentMethodDraft === "cash" ? "is-active" : ""}`}
              onClick={() => setInternalPaymentMethodDraft("cash")}
              disabled={isLoading}
            >
              {"💵 كاش"}
            </button>
            <button
              type="button"
              className={`btn bk-pay-method-btn ${internalPaymentMethodDraft === "transfer" ? "is-active" : ""}`}
              onClick={() => setInternalPaymentMethodDraft("transfer")}
              disabled={isLoading}
            >
              {"🏦 تحويل"}
            </button>
          </div>
          <div className="d-grid gap-2 mt-3 bk-pay-modal-actions">
            <button
              type="button"
              className="btn btn-primary bk-pay-confirm-btn"
              onClick={() => {
                if (!internalPaymentMethodDraft) return;
                internalSubmitModeRef.current = "payment";
                primeInternalPrintPopup();
                internalPaymentMethodRef.current = internalPaymentMethodDraft;
                setInternalPaymentModalOpen(false);
                // Let the popup render first, then run the heavy submit flow.
                window.setTimeout(() => {
                  internalBookingFormRef.current?.requestSubmit();
                }, 0);
              }}
              disabled={isLoading || !internalPaymentMethodDraft}
            >
              {"تأكيد الدفع"}
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary bk-pay-cancel-btn"
              onClick={() => {
                setInternalPaymentModalOpen(false);
                setInternalPaymentMethodDraft("");
              }}
              disabled={isLoading}
            >
              {"إلغاء"}
            </button>
          </div>
        </div>
      </Modal>
      <Modal
        open={paymentModalOpen}
        onClose={() => {
          if (isLoading) return;
          setPaymentModalOpen(false);
          setConfirmTargetBooking(null);
        }}
        ariaLabel="تأكيد مع تغيير طريقة الدفع"
        size="sm"
      >
        <div className="p-3">
          <h5 className="mb-2" style={{ fontWeight: 800 }}>تأكيد مع تغيير طريقة الدفع</h5>
          <p className="mb-3 text-muted" style={{ fontSize: 13 }}>
            اختاري طريقة الدفع الجديدة. بعد التأكيد يتم اعتماد الحجز كمكتمل ثم الانتقال للطباعة.
          </p>
          <div className="form-label mb-2">طريقة الدفع الجديدة</div>
          <div
            className="d-grid gap-2 bk-payment-method-grid"
          >
            <button
              type="button"
              className={`btn bk-payment-method-btn ${confirmPaymentMethod === "cash" ? "is-active" : ""}`}
              onClick={() => setConfirmPaymentMethod("cash")}
              disabled={isLoading}
            >
              كاش
            </button>
            <button
              type="button"
              className={`btn bk-payment-method-btn ${confirmPaymentMethod === "card" ? "is-active" : ""}`}
              onClick={() => setConfirmPaymentMethod("card")}
              disabled={isLoading}
            >
              شبكة
            </button>
          </div>
          <div className="d-grid gap-2 mt-3">
            <button
              type="button"
              className="btn btn-primary"
              style={{ borderRadius: 12, fontWeight: 800, minHeight: 48 }}
              onClick={() => {
                primeInternalPrintPopup();
                void confirmAndPrintExistingBooking();
              }}
              disabled={isLoading || !confirmTargetBooking}
            >
              {isLoading ? "جاري التأكيد..." : "تأكيد + طباعة"}
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary"
              style={{ borderRadius: 12, minHeight: 44 }}
              onClick={() => {
                setPaymentModalOpen(false);
                setConfirmTargetBooking(null);
              }}
              disabled={isLoading}
            >
              إلغاء
            </button>
          </div>
        </div>
      </Modal>
      <Modal
        open={refundModalOpen}
        onClose={() => {
          if (isLoading) return;
          setRefundModalOpen(false);
          setRefundTargetBooking(null);
          setRefundReason("");
          setRefundDetails("");
        }}
        ariaLabel="الاسترجاع"
        size="sm"
      >
        <div className="p-3">
          <h5 className="mb-2" style={{ fontWeight: 800 }}>تأكيد الاسترجاع</h5>
          <p className="mb-3 text-muted" style={{ fontSize: 13 }}>
            سيتم تسجيل حركة استرجاع مالية ولن يبقى المبلغ محسوبًا كدخل.
          </p>
          <div className="mb-2">
            <label className="form-label">سبب الاسترجاع</label>
            <input
              className="form-control"
              value={refundReason}
              onChange={(e) => setRefundReason(String(e.target.value || ""))}
              placeholder="اكتب سبب الاسترجاع"
              disabled={isLoading}
            />
          </div>
          <div className="mb-1">
            <label className="form-label">تفاصيل إضافية (اختياري)</label>
            <textarea
              className="form-control"
              rows={3}
              value={refundDetails}
              onChange={(e) => setRefundDetails(String(e.target.value || ""))}
              placeholder="أي ملاحظة داخلية للاسترجاع"
              disabled={isLoading}
            />
          </div>
          <div className="d-grid gap-2 mt-3">
            <button
              type="button"
              className="btn btn-primary"
              style={{ borderRadius: 12, fontWeight: 800, minHeight: 48 }}
              onClick={() => {
                void confirmRefundExistingBooking();
              }}
              disabled={isLoading || !refundTargetBooking}
            >
              {isLoading ? "جاري تنفيذ الاسترجاع..." : "تأكيد الاسترجاع"}
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary"
              style={{ borderRadius: 12, minHeight: 44 }}
              onClick={() => {
                setRefundModalOpen(false);
                setRefundTargetBooking(null);
                setRefundReason("");
                setRefundDetails("");
              }}
              disabled={isLoading}
            >
              إلغاء
            </button>
          </div>
        </div>
      </Modal>
      <Modal
        open={priceLookupImageModal.open}
        onClose={() => {
          setPriceLookupImageModal({ open: false, name: "", imageUrl: "" });
        }}
        ariaLabel="عرض صورة الخدمة"
        size="lg"
      >
        <div className="p-3">
          <div className="d-flex align-items-center justify-content-between gap-2 flex-wrap mb-2">
            <h5 className="mb-0" style={{ fontWeight: 800 }}>
              {priceLookupImageModal.name || "صورة الخدمة"}
            </h5>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={() => setPriceLookupImageModal({ open: false, name: "", imageUrl: "" })}
            >
              إغلاق
            </button>
          </div>
          {priceLookupImageModal.imageUrl ? (
            <img
              src={priceLookupImageModal.imageUrl}
              alt={priceLookupImageModal.name || "service image"}
              className="bk-price-preview-image"
            />
          ) : (
            <div className="alert alert-secondary mb-0" style={{ borderRadius: 12 }}>
              لا توجد صورة لهذه الخدمة.
            </div>
          )}
        </div>
      </Modal>

      <div className="container bk-internal-container">
        <div className="mb-3 bk-page-header">
          <div className="bk-page-header-center">
            <img src={logo} alt="logo" className="bk-logo" />
            <div className="bk-title">حجز داخلي</div>
          </div>

          <button
            type="button"
            className="bk-close-btn"
            aria-label="إغلاق"
            onClick={() => navigate("/dashboard")}
            disabled={isLoading}
          >
            <FontAwesomeIcon icon={faTimesCircle} />
          </button>
        </div>

        {/* =========================
            Form
        ========================= */}
        <form ref={internalBookingFormRef} onSubmit={handleSubmit}>
          <div className="row g-3">
            {/* بيانات العميلة */}
            <div className="col-12">
              <div className="card p-3 bk-panel bk-client-section">
                <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">
                  <div style={{ fontWeight: 800 }}>
                    <FontAwesomeIcon icon={faUser} className="me-2" />
                    بيانات العميلة
                  </div>

                </div>
                <div className="mt-4 pt-3 bk-existing-booking-block">
                  <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2 bk-existing-search-head">
                    <div className="bk-existing-search-title">بحث حجز موجود (تأكيد + طباعة)</div>
                    <span className="bk-existing-search-kicker">لوحة الاستقبال</span>
                  </div>

                  <div className="bk-existing-layout">
                    <div className="bk-existing-search-panel">
                      <label className="form-label">بحث الحجوزات</label>
                      <div className="bk-existing-search-row">
                        <input
                          className="form-control bk-existing-search-input"
                          value={bookingSearch}
                          onChange={(e) => {
                            setBookingSearch(String(e.target.value || ""));
                            setFoundBookings([]);
                            setBookingNameChoices([]);
                            setSelectedBookingNameKey("");
                            setSelectedExistingBooking(null);
                          }}
                          placeholder="ابحثي باسم أو رقم جوال أو MK"
                        />
                        <button
                          type="button"
                          className="btn bk-existing-search-btn"
                          onClick={handleSearchBooking}
                          disabled={bookingSearching}
                        >
                          <FontAwesomeIcon icon={faSearch} className="me-2" />
                          {bookingSearching ? "جاري البحث..." : "بحث"}
                        </button>
                      </div>
                    </div>

                    <div className="bk-existing-hint-panel">
                      <div className="bk-existing-hint-title">تلميح سريع</div>
                      <div className="bk-existing-hint-body">
                        {bookingSearchMsg || "اكتبي اسم العميلة أو رقم الجوال أو رقم MK لإظهار الحجوزات السابقة."}
                      </div>
                    </div>
                  </div>

                  {foundBookings.length ? (
                    <div className="mt-3">
                      {bookingNameChoices.length > 1 ? (
                        <div className="mb-3">
                          <div className="small text-muted mb-2 bk-existing-name-choices-title">
                            نتائج أسماء متشابهة ({bookingNameChoices.length}) - اختاري الاسم:
                          </div>
                          <div className="d-flex flex-wrap gap-2 bk-existing-name-choices-wrap">
                            {bookingNameChoices.map((choice) => {
                              const active = selectedBookingNameKey === choice.key;
                              return (
                                <button
                                  key={choice.key}
                                  type="button"
                                  className={`btn btn-sm bk-name-choice-chip ${active ? "is-active" : ""}`}
                                  onClick={() => {
                                    setSelectedBookingNameKey(choice.key);
                                    setSelectedExistingBooking(null);
                                  }}
                                >
                                  {choice.name}
                                  {choice.phone ? ` - ${choice.phone}` : ""}
                                  {choice.count > 1 ? ` (${choice.count})` : ""}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}

                      <div className="table-responsive">
                        <table className="table align-middle mb-0 bk-existing-table">
                          <thead>
                            <tr>
                              <th>MK</th>
                              <th>العميلة</th>
                              <th>الخدمة</th>
                              <th>التاريخ</th>
                              <th>الوقت</th>
                              <th>الحالة</th>
                              <th style={{ width: 260 }}>إجراء</th>
                            </tr>
                          </thead>
                          <tbody>
                            {displayFoundBookingBlocks.flatMap((block) => {
                              const rows: any[] = [];
                              if (block.bookings.length > 1) {
                                rows.push(
                                  <tr key={`group-${block.key}`} className="bk-existing-group-row">
                                    <td colSpan={7}>
                                      <div className="bk-existing-group-row-inner">
                                        <span className="bk-existing-group-title">حجز مجمّع</span>
                                        <span className="bk-existing-group-meta">
                                          رقم المجموعة: {block.label} - الخدمات: {block.bookings.length}
                                        </span>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              }

                              block.bookings.forEach((b) => {
                                const serviceName = String(
                                  b.serviceName || b.serviceSnapshot?.serviceNameAtBooking || "—"
                                );
                                const sectionLabel = readBookingSectionLabel(b);
                                const categoryLabel = readBookingCategoryLabel(b);
                                const serviceMeta = [sectionLabel, categoryLabel].filter(Boolean).join(" / ");

                                rows.push(
                                  <tr key={String(b.id)}>
                                    <td>{String(b.publicId || b.trackPublicId || b.mk || "—")}</td>
                                    <td>{String(b.clientName || b.name || "—")}</td>
                                    <td>
                                      <div>{serviceName}</div>
                                      {serviceMeta ? (
                                        <div className="small text-muted">{serviceMeta}</div>
                                      ) : null}
                                    </td>
                                    <td>{String(b.date || "—")}</td>
                                    <td>{formatTime12(String(b.time || ""), "—")}</td>
                                    <td>
                                      <span className={`bk-status-pill ${bookingStatusClass(b)}`}>
                                        {mapBookingStatusAr(b)}
                                      </span>
                                    </td>
                                    <td>
                                      <div className="bk-existing-actions">
                                        {isCompletedStatus(b) ? (
                                          <button
                                            type="button"
                                            className="btn btn-sm bk-action-print"
                                            style={{ borderRadius: 10 }}
                                            onClick={() => {
                                              primeInternalPrintPopup();
                                              printExistingBooking(b);
                                            }}
                                            disabled={isLoading}
                                          >
                                            طباعة فقط
                                          </button>
                                        ) : !isCancelledStatus(b) && !isRefundedBooking(b) ? (
                                          <>
                                            <button
                                              type="button"
                                              className="btn btn-sm bk-action-confirm"
                                              style={{ borderRadius: 10 }}
                                              onClick={() => {
                                                primeInternalPrintPopup();
                                                void completeAndPrintExistingBooking(b);
                                              }}
                                              disabled={isLoading}
                                            >
                                              تأكيد + طباعة
                                            </button>
                                            <button
                                              type="button"
                                              className="btn btn-sm bk-action-confirm bk-action-confirm-alt"
                                              style={{ borderRadius: 10 }}
                                              onClick={() => openConfirmAndPrintModal(b)}
                                              disabled={isLoading}
                                            >
                                              تأكيد مع تغيير طريقة الدفع
                                            </button>
                                          </>
                                        ) : null}
                                        {canRefundBooking(b) && (
                                          <button
                                            type="button"
                                            className="btn btn-sm bk-action-refund"
                                            style={{ borderRadius: 10 }}
                                            onClick={() => openRefundModal(b)}
                                            disabled={isLoading}
                                          >
                                            استرجاع
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          className="btn btn-sm bk-action-details"
                                          style={{ borderRadius: 10 }}
                                          onClick={() => setSelectedExistingBooking(b)}
                                        >
                                          تفاصيل
                                        </button>
                                      </div>
                                    </td>
                                  </tr>
                                );
                              });

                              return rows;
                            })}
                            {bookingNameChoices.length > 1 && !selectedBookingNameKey ? (
                              <tr>
                                <td colSpan={7} className="text-muted">
                                  اختاري اسمًا من القائمة أعلاه لعرض الحجوزات الخاصة به.
                                </td>
                              </tr>
                            ) : null}
                          </tbody>
                        </table>
                      </div>

                      {selectedExistingBooking &&
                      (!selectedBookingNameKey ||
                        normalizeSearchText(
                          String(
                            selectedExistingBooking?.clientName ||
                              selectedExistingBooking?.name ||
                              selectedExistingBooking?.fullName ||
                              ""
                          )
                        ) === selectedBookingNameKey) ? (
                        <div className="bk-booking-details mt-3">
                          <div className="bk-booking-details-title">تفاصيل الحجز</div>
                          <div className="bk-booking-details-grid">
                            {[
                              ["رقم الحجز", String(selectedExistingBooking?.publicId || selectedExistingBooking?.mk || selectedExistingBooking?.id || "—")],
                              ["اسم العميلة", String(selectedExistingBooking?.clientName || selectedExistingBooking?.name || "—")],
                              ["رقم الجوال", String(selectedExistingBooking?.clientPhone || selectedExistingBooking?.phone || "—")],
                              ["القسم", readBookingSectionLabel(selectedExistingBooking) || "—"],
                              ["الصنف", readBookingCategoryLabel(selectedExistingBooking) || "—"],
                              [
                                "الخدمة",
                                String(
                                  selectedExistingBooking?.serviceName ||
                                  selectedExistingBooking?.serviceSnapshot?.serviceNameAtBooking ||
                                  "—"
                                ),
                              ],
                              ["الموظفة", String(selectedExistingBooking?.employeeName || "—")],
                              ["التاريخ", String(selectedExistingBooking?.date || "—")],
                              ["الوقت", formatTime12(String(selectedExistingBooking?.time || ""), "—")],
                              ["الحالة", mapBookingStatusAr(selectedExistingBooking)],
                              [
                                "القناة",
                                mapBookingChannelAr(
                                  selectedExistingBooking?.channel || selectedExistingBooking?.source
                                ),
                              ],
                              [
                                "المبلغ",
                                `${Number(
                                  selectedExistingBooking?.finalPrice ??
                                  selectedExistingBooking?.total ??
                                  0
                                ).toFixed(0)} ريال`,
                              ],
                            ].map(([label, value]) => (
                              <div key={label} className="bk-booking-row">
                                <div className="bk-booking-label">{label}</div>
                                <div className="bk-booking-value">
                                  {label === "الحالة" ? (
                                    <span className={`bk-status-pill ${bookingStatusClass(selectedExistingBooking)}`}>
                                      {value}
                                    </span>
                                  ) : (
                                    value
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

              </div>
            </div>
            <div className="col-12">
              <div className="row g-3 align-items-stretch bk-sections-grid">
            {/* اختيار الخدمة */}
                <div className="col-12 col-lg-6 order-1 h-100">
              <div ref={serviceSectionCardRef} className="card p-3 bk-panel bk-service-section">
                <div className="d-flex align-items-center justify-content-between mb-2">
                  <div className="bk-soft-title">
                    <FontAwesomeIcon icon={faCalendarAlt} className="me-2" />
                    اختيار الخدمة
                  </div>
                </div>

                <div className="row g-2 mb-3 bk-service-client-fields">
                  <div className="col-12 col-md-6">
                    <label className="form-label">اسم العميلة</label>
                    <input
                      name="name"
                      value={formData.name}
                      onChange={handleChange}
                      className="form-control"
                      placeholder="مثال: ريفال"
                      required
                    />
                  </div>
                  <div className="col-12 col-md-6">
                    <label className="form-label">رقم الجوال</label>
                    <input
                      name="phone"
                      value={formData.phone}
                      onChange={handleChange}
                      className="form-control"
                      placeholder="05xxxxxxxx"
                      required
                    />
                  </div>
                </div>

                <div className="mb-3 pb-3 bk-client-search-block bk-service-date-block">
                  <div className="row g-2 align-items-end">
                    <div className="col-12">
                      <label htmlFor="bookingDateInternal" className="form-label">تاريخ الحجز</label>
                      <div className="bk-date-calendar-toggle" role="group" aria-label="نوع التقويم">
                        <button
                          type="button"
                          className={`btn btn-sm ${bookingDateCalendar === "gregory" ? "btn-dark" : "btn-outline-dark"}`}
                          onClick={() => {
                            setBookingDateCalendar("gregory");
                            setHijriPickerOpen(false);
                          }}
                        >
                          ميلادي
                        </button>
                        <button
                          type="button"
                          className={`btn btn-sm ${bookingDateCalendar === "hijri" ? "btn-dark" : "btn-outline-dark"}`}
                          onClick={() => {
                            setBookingDateCalendar("hijri");
                            const base = normalizeIsoDate(bookingDate) || todayISO();
                            setHijriViewMonthISO(findHijriMonthStartISO(base));
                          }}
                        >
                          هجري
                        </button>
                      </div>
                      <div
                        className="input-group booking-date-group"
                        role="button"
                        tabIndex={0}
                        onClick={openBookingDatePicker}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            openBookingDatePicker();
                          }
                        }}
                      >
                        <input
                          id="bookingDateInternal"
                          type="text"
                          className="form-control bk-date-display-input"
                          value={bookingDateInputDisplay}
                          placeholder={bookingDateCalendar === "hijri" ? "اختري التاريخ الهجري" : "اختري التاريخ الميلادي"}
                          readOnly
                          onClick={openBookingDatePicker}
                          onFocus={openBookingDatePicker}
                        />
                        {bookingDateCalendar === "gregory" && (
                          <input
                            key={`bookingDateInternalPicker-${bookingDateCalendar}`}
                            ref={dateRef}
                            id="bookingDateInternalPicker"
                            type="date"
                            className="bk-date-picker-native"
                            lang="ar-SA-u-ca-gregory"
                            value={bookingDate}
                            min={todayISO()}
                            onClick={openBookingDatePicker}
                            onFocus={openBookingDatePicker}
                            onChange={(e) => {
                              const next = String(e.target.value || "").trim();
                              applyBookingDate(next);
                            }}
                          />
                        )}
                      </div>
                      {bookingDateCalendar === "hijri" && hijriPickerOpen && (
                        <div className="bk-hijri-picker" ref={hijriPickerRef}>
                          <div className="bk-hijri-picker-head">
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-dark"
                              onClick={() => setHijriViewMonthISO((p) => shiftHijriMonthStartISO(p, -1))}
                            >
                              السابق
                            </button>
                            <strong>{hijriMonthTitle || "التقويم الهجري"}</strong>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-dark"
                              onClick={() => setHijriViewMonthISO((p) => shiftHijriMonthStartISO(p, 1))}
                            >
                              التالي
                            </button>
                          </div>
                          <div className="bk-hijri-picker-grid bk-hijri-picker-weekdays">
                            {["س", "ح", "ن", "ث", "ر", "خ", "ج"].map((w) => (
                              <span key={w}>{w}</span>
                            ))}
                          </div>
                          <div className="bk-hijri-picker-grid">
                            {hijriMonthDays.map((cell) => {
                              const isPast = cell.iso < todayISO();
                              const isActive = cell.iso === bookingDate;
                              return (
                                <button
                                  key={cell.iso}
                                  type="button"
                                  className={[
                                    "bk-hijri-day",
                                    isActive ? "is-active" : "",
                                  ].join(" ").trim()}
                                  disabled={isPast}
                                  onClick={() => applyBookingDate(cell.iso)}
                                >
                                  {String(cell.hijriDay)}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      )}
                      {bookingDate && !selectedDayOpen && (
                        <div className="bk-day-closed-banner" role="alert">
                          تنبيه: يوم {WEEKDAY_LABEL_AR[selectedDayKey]} إجازة في الصالون، اختاري تاريخًا آخر للحجز.
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="row g-2 bk-service-picker-block">
                  <div className="col-12">
                    <div className="d-flex gap-2">
                      <button
                        type="button"
                        className={`btn btn-sm ${pickerScope === "services" ? "btn-dark" : "btn-outline-dark"}`}
                        onClick={() => {
                          setPickerScope("services");
                          setServicePicker("");
                          setSelectedSectionId("");
                          setSelectedCategory("");
                        }}
                      >
                        الخدمات
                      </button>
                      <button
                        type="button"
                        className={`btn btn-sm ${pickerScope === "packages" ? "btn-dark" : "btn-outline-dark"}`}
                        onClick={() => {
                          setPickerScope("packages");
                          setServicePicker("");
                          setSelectedSectionId(PACKAGE_SECTION_ID);
                          setSelectedCategory("");
                        }}
                      >
                        البكجات
                      </button>
                    </div>
                  </div>

                  {pickerScope === "services" ? (
                    <>
                      <div className="col-12">
                        <label className="form-label">القسم</label>
                        <select
                          className="form-select"
                          value={selectedSectionId}
                          onChange={handleSectionChange}
                        >
                          <option value="">اختاري قسم...</option>
                          {sectionOptions
                            .filter((s) => String(s.id || "").trim() !== PACKAGE_SECTION_ID)
                            .map((s) => (
                              <option key={s.id} value={s.id}>
                                {toArabicCatalogLabel(String(s.title || s.id))}
                              </option>
                            ))}
                        </select>
                      </div>

                      <div className="col-12">
                        <label className="form-label">التصنيف</label>
                        <select
                          className="form-select"
                          value={selectedCategory}
                          onChange={handleCategoryChange}
                          disabled={!selectedSectionId}
                        >
                          <option value="">الكل</option>
                          {categoryOptions.map((c) => (
                            <option key={c.id} value={c.id}>
                              {toArabicCatalogLabel(String(c.name || c.id))}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="col-12">
                        <label className="form-label">الخدمة</label>
                        <select
                          className="form-select"
                          value={servicePicker}
                          onChange={(e) => setServicePicker(String(e.target.value || ""))}
                          disabled={!selectedSectionId}
                        >
                          <option value="">اختاري خدمة...</option>
                          {servicesGrouped.map(([catName, arr]) => (
                            <optgroup key={catName} label={toArabicCatalogLabel(String(catName || ""))}>
                              {arr.map((sv) => (
                                <option key={sv.id} value={sv.id}>
                                  {toArabicCatalogLabel(String(sv.name || sv.id))} - {servicePickerPriceText(sv)}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </div>
                    </>
                  ) : (
                    <div className="col-12">
                      <label className="form-label">البكج</label>
                      <select
                        className="form-select"
                        value={servicePicker}
                        onChange={(e) => setServicePicker(String(e.target.value || ""))}
                        disabled={!packageOptions.length}
                      >
                        <option value="">اختاري باكيج...</option>
                        {!packageOptions.length && <option value="" disabled>لا توجد باكيجات متاحة</option>}
                        {packageOptions.map((pkg) => (
                          <option key={pkg.id} value={pkg.id}>
                            {pkg.title} - {pkg.priceText}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="col-12 d-grid mt-1">
                    <button
                      type="button"
                      className="btn btn-primary bk-add-cart-btn"
                      disabled={!servicePicker || !selectedDayOpen}
                      onClick={() => addServiceToCart(servicePicker)}
                    >
                      + إضافة للسلة
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* عرض قائمة الأسعار (قراءة فقط) */}
            <div className="col-12 col-lg-6 order-2 h-100 bk-price-side-col">
              <div className="row g-3 h-100 align-items-stretch bk-price-guide-row">
                <div className="col-12 col-lg-6 h-100">
                  <div ref={priceListCardRef} className="card p-3 bk-panel bk-price-list-section h-100" style={sideCardsMatchServiceStyle}>
                    <div className="mb-2 bk-soft-title">عرض قائمة الأسعار</div>

                    <div className="mb-3">
                      <input
                        className="form-control"
                        value={priceLookupQuery}
                        onChange={(e) => setPriceLookupQuery(String(e.target.value || ""))}
                        placeholder="ابحث عن خدمة..."
                      />
                    </div>

                    <div className="bk-price-list-body">
                      {priceLookupLoading ? (
                        <div className="alert alert-secondary mb-0 bk-soft-alert">
                          جاري تحميل قائمة الأسعار...
                        </div>
                      ) : priceLookupResults.length ? (
                        <div className="bk-price-list-grid" role="list">
                          {priceLookupResults.map((row) => {
                            const displayName = toArabicCatalogLabel(String(row.name || row.id));
                            const icon = pickPriceLookupIcon(displayName);
                            const seasonPrice = Number(row.seasonPrice || 0);

                            return (
                              <div key={row.id} className="bk-price-list-item" role="listitem">
                                <div
                                  className="bk-price-list-thumb bk-price-list-icon"
                                  title={icon.label}
                                  role="img"
                                  aria-label={icon.label}
                                >
                                  <icon.Icon className="bk-price-list-icon-svg" aria-hidden="true" />
                                </div>

                                <div>
                                  <div className="bk-price-list-name">{displayName}</div>
                                  <div className="bk-price-list-price">
                                    {Number(row.price || 0).toFixed(0)} ريال
                                  </div>
                                </div>

                                <div className="bk-price-list-season">
                                  <div className="bk-price-list-season-label">سعر الموسم</div>
                                  <div className={`bk-price-list-season-value ${seasonPrice > 0 ? "" : "is-empty"}`}>
                                    {seasonPrice > 0 ? `${seasonPrice.toFixed(0)} ريال` : "غير محدد"}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="alert alert-secondary mb-0 bk-soft-alert">
                          لا توجد نتائج مطابقة.
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="col-12 col-lg-6 h-100">
                  <div ref={hairGuideCardRef} className="card p-3 bk-panel bk-service-hair-guide h-100" style={sideCardsMatchServiceStyle}>
                    <div className="d-flex gap-2 flex-wrap align-items-center mb-2">
                      <span className="badge text-bg-secondary bk-guide-badge">
                        دليل أطوال الشعر
                      </span>

                      {isOwner ? (
                        <label
                          className="btn btn-outline-info btn-sm mb-0 bk-guide-upload-btn"
                        >
                          {uploadingGuide ? "جاري الرفع..." : "رفع صورة جديدة"}
                          <input
                            type="file"
                            accept="image/*"
                            style={{ display: "none" }}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) uploadHairGuide(f);
                            }}
                            disabled={uploadingGuide}
                          />
                        </label>
                      ) : (
                        <span className="text-muted bk-guide-note">
                          رفع الصورة للإدارة فقط
                        </span>
                      )}
                    </div>

                    <div className="p-2 bk-guide-image-wrap flex-grow-1 d-flex align-items-center justify-content-center">
                      <img
                        src={hairGuideUrl}
                        alt="hair guide"
                        className="bk-guide-image"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>


            {/* السلة */}
            <div className="col-12 col-lg-6 order-2">
              <div className="card p-3 bk-panel bk-cart-panel bk-client-cart-block">
                {/* Cart */}
                <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">
                  <div className="bk-cart-title">
                    <FontAwesomeIcon icon={faUserTie} className="me-2" />
                    السلة (اختيار الموظفة والوقت)
                  </div>

                  <div className="d-flex gap-2 flex-wrap">
                    <span className="badge text-bg-white bk-cart-count-badge">
                      عدد الخدمات: {(formData.items || []).length}
                    </span>
                  </div>
                </div>

                {(formData.items || []).length === 0 ? (
                  <div className="mb-0 bk-cart-empty-soft" role="status" aria-live="polite">
                    <div className="bk-cart-empty-soft__title">ما فيه خدمات في السلة</div>
                    <div className="bk-cart-empty-soft__hint">
                      اختاري خدمة من الأعلى ثم أضيفيها للسلة.
                    </div>
                  </div>
                ) : (
                  <div className="bk-cart-list">
                    {(formData.items || []).map((it, idx) => {
                      const sid = String(it.serviceId || "").trim();
                      const staffList = (staffByService[sid] || []) as StaffPublicWithId[];
                      const busy = busyByItem[it.id] || emptyBusyState();
                      const dateISO = String(it.date || "").trim();
                      const visibleStaff = staffList.filter(
                        (st: any) =>
                          (st as any)?.showOnBooking !== false &&
                          !isStaffEmploymentEndedForDate(st as any, dateISO)
                      );
                      const staffWithAvailability = visibleStaff.map((st) => {
                        const dayAvailable = isStaffAvailableForDate(st as any, dateISO, {
                          requireShowOnBooking: true,
                        });
                        const hasWorkingHours = filterStaffSlotsByWorkingHours(st as any, {
                          dateISO,
                          slots: baseSlotsForUi,
                          fallbackOpenTime: openTime,
                          fallbackCloseTime: closeTime,
                        }).length > 0;
                        return { staff: st, dayAvailable, hasWorkingHours };
                      });
                      const selectedStaffForTime = visibleStaff.find(
                        (x) => String((x as any)?.id || "").trim() === String(it.employeeId || "").trim()
                      );
                      const slotsForSelectedStaff = selectedStaffForTime
                        ? filterStaffSlotsByWorkingHours(selectedStaffForTime as any, {
                            dateISO,
                            slots: baseSlotsForUi,
                            fallbackOpenTime: openTime,
                            fallbackCloseTime: closeTime,
                          })
                        : baseSlotsForUi;
                      const availableTimeSlots = slotsForSelectedStaff.filter(
                        (s) => !busy.disabledStartTimes?.has(s.value24)
                      );
                      const shouldSummarizeBlockedReasons =
                        !busy.loading &&
                        !!String(it.employeeId || "").trim() &&
                        Object.keys(busy.disabledReasonByStart || {}).length > 0;
                      const blockedReasonEntries = shouldSummarizeBlockedReasons
                        ? Object.entries(busy.disabledReasonByStart || {}).filter(([t]) =>
                            busy.disabledStartTimes?.has(t)
                          )
                        : [];
                      const blockedReasonSummaries = shouldSummarizeBlockedReasons
                        ? summarizeBlockedReasons(blockedReasonEntries, slotStepMin)
                        : [];
                      const blockedReasonPreview = blockedReasonSummaries.slice(0, 10);
                      const blockedReasonHiddenCount = Math.max(
                        0,
                        blockedReasonSummaries.length - blockedReasonPreview.length
                      );
                      const canEditThis = canEditByLockedPrev(formData.items || [], it.id);
                      const canPickTime =
                        !!String(it.employeeId || "").trim() &&
                        !busy.loading &&
                        canEditThis;
                      const toolsEligible = isToolsOptionEligibleForItem(it);
                      const toolsSource = toolsEligible
                        ? (String(it.toolsSource || "").trim() === "salon" ? "salon" : "client")
                        : undefined;
                      const toolsFeeApplied =
                        toolsEligible && toolsSource === "salon"
                          ? Math.max(0, Number(it.toolsFeeApplied || maniPediToolsFee || 0))
                          : 0;
                      const toolsSummary = toolsEligible
                        ? toolsSource === "salon"
                          ? `الأدوات: من المشغل (+${toolsFeeApplied} ريال)`
                          : "الأدوات: من العميلة (بدون رسوم)"
                        : "";
                      const canCollapseConfirmedCard = !!it.locked;
                      const isCardExpanded =
                        !canCollapseConfirmedCard || !!expandedConfirmedCartItems[it.id];

                      return (
                        <div
                          key={it.id}
                          className={`bk-cart-item${canCollapseConfirmedCard ? " is-collapsible" : ""}${canCollapseConfirmedCard && !isCardExpanded ? " is-collapsed" : ""}`}
                        >
                          <div className="bk-cart-item-head">
                            <div>
                              <div className="bk-cart-service-title">
                                <span className="bk-cart-index">{idx + 1}</span>
                                {it.serviceName}
                              </div>
                              <div className="bk-cart-service-meta">
                                {it.durationMin} دقيقة — {it.date}
                              </div>
                            </div>
                            <div className="bk-cart-item-head-actions">
                              <div className="bk-cart-price">
                                {Number(it.basePrice || 0).toFixed(0)} ريال
                              </div>
                              {canCollapseConfirmedCard ? (
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-secondary bk-cart-collapse-toggle"
                                  onClick={() => toggleConfirmedCartItem(it.id)}
                                >
                                  {isCardExpanded ? "إغلاق" : "تعديل"}
                                </button>
                              ) : null}
                              {canCollapseConfirmedCard ? (
                                <button
                                  type="button"
                                  className="btn btn-outline-danger btn-sm bk-cart-head-delete-btn"
                                  onClick={() => removeServiceFromCart(it.id)}
                                  disabled={isLoading}
                                >
                                  حذف
                                </button>
                              ) : null}
                            </div>
                          </div>

                          {isCardExpanded ? (
                            <>
                              <div className="bk-cart-fields">
                            {toolsEligible ? (
                              <div className="bk-cart-field">
                                <label className="form-label">الأدوات</label>
                                <div className="d-flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    className={`btn btn-sm ${toolsSource === "client" ? "btn-dark" : "btn-outline-dark"}`}
                                    disabled={!canEditThis}
                                    onClick={() => setItemToolsSource(it, "client")}
                                  >
                                    من العميلة (بدون رسوم)
                                  </button>
                                  <button
                                    type="button"
                                    className={`btn btn-sm ${toolsSource === "salon" ? "btn-dark" : "btn-outline-dark"}`}
                                    disabled={!canEditThis}
                                    onClick={() => setItemToolsSource(it, "salon")}
                                  >
                                    من الصالون {maniPediToolsFee > 0 ? `(+${maniPediToolsFee} ريال)` : "(بدون رسوم إضافية)"}
                                  </button>
                                </div>
                                <div className="small text-muted mt-1">{toolsSummary}</div>
                              </div>
                            ) : null}

                            <div className="bk-cart-field bk-cart-field-staff">
                              <label className="form-label">الموظفة</label>
                              {staffLoadingByService[sid] ? (
                                <div className="small text-muted">
                                  <FontAwesomeIcon icon={faSpinner} spin className="me-2" />
                                  تحميل الموظفات...
                                </div>
                              ) : staffErrorByService[sid] ? (
                                <div className="small text-warning">{staffErrorByService[sid]}</div>
                              ) : (
                                <select
                                  className="form-select bk-cart-select"
                                  value={it.employeeId}
                                  disabled={!canEditThis}
                                  onChange={(e) => {
                                    const empId = String(e.target.value || "").trim();
                                    const st = staffList.find((x) => String(x.id) === empId);
                                    const empUid = String((st as any)?.linkedUid || "").trim();
                                    const empName = String((st as any)?.name || "").trim();

                                    updateItem(it.id, {
                                      employeeId: empId,
                                      employeeUid: empUid,
                                      employeeName: empName,
                                      time: "",
                                      locked: false,
                                    });
                                    setBusyByItem((p) => ({
                                      ...p,
                                      [it.id]: {
                                        ...emptyBusyState(),
                                        loading: !!empId,
                                        hint: empId ? "جاري التحقق من الأوقات المتاحة..." : "",
                                        disabledStartTimes: new Set(
                                          (
                                            timeSlots.length > 0
                                              ? timeSlots
                                              : generateSalonTimeSlots(openTime, closeTime, slotStepMin)
                                          ).map((x) => x.value24)
                                        ),
                                      },
                                    }));
                                  }}
                                >
                                  <option value="">اختاري موظفة...</option>
                                  {staffWithAvailability.map(({ staff: st, dayAvailable, hasWorkingHours }) => (
                                    <option
                                      key={String(st.id)}
                                      value={String(st.id)}
                                      disabled={!dayAvailable || !hasWorkingHours}
                                    >
                                      {!dayAvailable
                                        ? `${String((st as any)?.name || st.id)} (غير متاحة)`
                                        : !hasWorkingHours
                                          ? `${String((st as any)?.name || st.id)} (خارج ساعات العمل)`
                                          : String((st as any)?.name || st.id)}
                                    </option>
                                  ))}
                                </select>
                              )}
                            </div>

                            <div className="bk-cart-field bk-cart-field-time">
                              <label className="form-label">الوقت</label>
                              {!String(it.employeeId || "").trim() ? (
                                <div className="small text-muted bk-time-grid-empty">
                                  اختاري موظفة أولاً.
                                </div>
                              ) : availableTimeSlots.length ? (
                                <div className="bk-time-grid" role="listbox" aria-label="الأوقات المتاحة">
                                  {availableTimeSlots.map((s) => {
                                    const t = s.value24;
                                    const active = String(it.time || "").trim() === t;
                                    return (
                                      <button
                                        key={t}
                                        type="button"
                                        className={`btn btn-sm bk-time-pill bk-time-grid-btn${active ? " is-active" : ""}`}
                                        aria-pressed={active}
                                        disabled={!canPickTime}
                                        onClick={() => {
                                          updateItem(it.id, { time: t, locked: false });
                                          validatePickedTime(it.id, t);
                                        }}
                                      >
                                        {s.label12}
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : busy.loading ? (
                                <div className="small text-muted bk-time-grid-empty">
                                  جاري تحميل الأوقات المتاحة...
                                </div>
                              ) : (
                                <div className="small text-muted bk-time-grid-empty">
                                  لا يوجد وقت متاح لهذا اليوم.
                                </div>
                              )}
                              {busy.loading ? (
                                <div className="small mt-1 bk-availability-loading">
                                  <FontAwesomeIcon icon={faSpinner} spin className="me-2" />
                                  تحميل التوفر...
                                </div>
                              ) : busy.hint ? (
                                <div className="small mt-1 bk-availability-hint">{busy.hint}</div>
                              ) : null}
                              {!busy.loading &&
                              String(it.employeeId || "").trim() &&
                              blockedReasonSummaries.length > 0 ? (
                                <details className="bk-time-debug mt-2">
                                  <summary>
                                    تشخيص الأوقات غير المتاحة ({blockedReasonSummaries.length})
                                  </summary>
                                  <div className="bk-time-debug-list">
                                    {blockedReasonPreview.map((entry) => (
                                      <div
                                        key={`${entry.from}_${entry.to}_${entry.reasonKey}`}
                                        className="bk-time-debug-row"
                                      >
                                        <span className="bk-time-debug-time">
                                          {formatBlockedRangeLabel(entry.from, entry.to)}
                                        </span>
                                        <span className="bk-time-debug-reason">
                                          {entry.reasonLabel}
                                          {entry.reasonDetail ? (
                                            <span className="bk-time-debug-meta">
                                              {" "}
                                              - {entry.reasonDetail}
                                            </span>
                                          ) : null}
                                        </span>
                                      </div>
                                    ))}
                                    {blockedReasonHiddenCount > 0 ? (
                                      <div className="bk-time-debug-more">
                                        +{blockedReasonHiddenCount} نطاقات إضافية.
                                      </div>
                                    ) : null}
                                  </div>
                                </details>
                              ) : null}
                              {!busy.loading &&
                              String(it.employeeId || "").trim() &&
                              availableTimeSlots.length === 0 ? (
                                <div className="mt-2 d-grid">
                                  <button
                                    type="button"
                                    className="btn btn-outline-dark btn-sm"
                                    onClick={() => focusFutureSearchForCartItem(it, { scroll: true })}
                                  >
                                    بحث أوقات للأيام القادمة لهذه الخدمة
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </div>

                          <div className="bk-cart-item-footer">
                            <div>
                              {it.locked ? (
                                <span className="badge text-bg-success" style={{ borderRadius: 999 }}>
                                  ✅ مؤكد
                                </span>
                              ) : null}
                            </div>

                            <div className="d-flex gap-2 flex-wrap bk-cart-actions">
                              <button
                                type="button"
                                className="btn btn-sm bk-cart-confirm-btn"
                                disabled={
                                  !it.employeeId ||
                                  !it.time ||
                                  !canEditThis ||
                                  isLoading
                                }
                                onClick={async () => {
                                  const check = await checkOneItemSlot(it);
                                  if (!check.ok) {
                                    openModal({
                                      title: "الوقت غير متاح",
                                      message: `خدمة "${it.serviceName}": ${check.msg}`,
                                      variant: "danger",
                                      confirmText: "تمام",
                                    });
                                    updateItem(it.id, { time: "", locked: false });
                                    return;
                                  }
                                  updateItem(it.id, { locked: true });
                                }}
                              >
                                تأكيد الوقت
                              </button>

                              {sequentialBooking && busy.suggestedSlot && !it.time ? (
                                <button
                                  type="button"
                                  className="btn btn-outline-info btn-sm bk-cart-suggest-btn"
                                  disabled={!it.employeeId}
                                  onClick={() => {
                                    updateItem(it.id, { time: busy.suggestedSlot || "", locked: false });
                                    validatePickedTime(it.id, busy.suggestedSlot || "");
                                  }}
                                >
                                  أقرب وقت: {formatTime12(busy.suggestedSlot || "", "—")}
                                </button>
                              ) : null}

                              {!canCollapseConfirmedCard ? (
                                <button
                                  type="button"
                                  className="btn btn-outline-danger btn-sm bk-cart-delete-btn"
                                  onClick={() => removeServiceFromCart(it.id)}
                                  disabled={isLoading}
                                >
                                  حذف
                                </button>
                              ) : null}

                            </div>
                          </div>
                            </>
                          ) : (
                            <div className="bk-cart-collapsed-note">
                              <span className="badge text-bg-success" style={{ borderRadius: 999 }}>
                                ✅ مؤكد
                              </span>
                              <span>تم إغلاق البطاقة لتخفيف الزحمة البصرية.</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {shouldShowFutureSearchPanel ? (
                  <div ref={futureSearchRef} className="bk-cart-future-wrap">
                    <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">
                      <div className="bk-future-title-head">بحث أوقات للأيام القادمة</div>
                      <span className="text-muted bk-future-subhint">يظهر أول 5 أيام متاحة</span>
                    </div>

                    <div className="row g-2 align-items-end">
                      <div className="col-12">
                        <select
                          className="form-select"
                          value={futureAnyStaff ? "any" : "one"}
                          onChange={(e) => setFutureAnyStaff(e.target.value === "any")}
                        >
                          <option value="any">أي موظفة للخدمة</option>
                          <option value="one">موظفة محددة</option>
                        </select>
                      </div>

                      {!futureAnyStaff ? (
                        <div className="col-12">
                          <label className="form-label">اختاري الموظفة</label>
                          {!servicePicker ? (
                            <div className="alert alert-danger mb-0 py-2" style={{ borderRadius: 12 }}>
                              اختاري الخدمة أولاً ثم اختاري الموظفة.
                            </div>
                          ) : staffLoadingByService[String(servicePicker || "").trim()] ? (
                            <div className="small text-muted mt-1">
                              <FontAwesomeIcon icon={faSpinner} spin className="me-2" />
                              جاري تحميل الموظفات...
                            </div>
                          ) : staffErrorByService[String(servicePicker || "").trim()] ? (
                            <div className="small text-warning mt-1">
                              {staffErrorByService[String(servicePicker || "").trim()]}
                            </div>
                          ) : (
                            <>
                              <input
                                className="form-control"
                                value={futureStaffNameQuery}
                                onChange={(e) => {
                                  const v = String(e.target.value || "");
                                  setFutureStaffNameQuery(v);
                                  setFutureSelectedEmployeeKey("");
                                }}
                                placeholder="ابحثي باسم الموظفة..."
                                disabled={!futureStaffOptions.length}
                              />
                              {futureStaffNameQuery && filteredFutureStaffOptions.length ? (
                                <div className="mt-2 d-flex flex-wrap gap-2">
                                  {filteredFutureStaffOptions.slice(0, 8).map((st) => (
                                    <button
                                      key={st.key}
                                      type="button"
                                      className="btn btn-outline-light btn-sm"
                                      onClick={() => {
                                        setFutureStaffNameQuery(st.name);
                                        setFutureSelectedEmployeeKey(st.key);
                                      }}
                                    >
                                      {st.name}
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                            </>
                          )}
                        </div>
                      ) : null}

                      <div className="col-12 d-grid">
                        <button
                          type="button"
                          className="btn btn-outline-info"
                          style={{ borderRadius: 12 }}
                          onClick={() => {
                            void runFutureAvailabilitySearch();
                          }}
                          disabled={futureLoading}
                        >
                          {futureLoading ? "جاري البحث..." : "بحث"}
                        </button>
                      </div>

                      {futureMsg ? (
                        <div className="col-12">
                          <div className="alert alert-secondary mb-0 py-2" style={{ borderRadius: 12 }}>
                            {futureMsg}
                          </div>
                        </div>
                      ) : null}

                      {futureResult.length ? (
                        <div className="col-12">
                          <div className="bk-future-inline">
                            <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">
                              <div style={{ fontWeight: 800 }}>نتائج البحث</div>
                              <button
                                type="button"
                                className="btn btn-sm bk-time-pill"
                                onClick={() => {
                                  const nearestDate = String(futureResult[0]?.date || "").trim();
                                  const nearestTime = String(futureResult[0]?.times?.[0] || "").trim();
                                  if (!nearestDate || !nearestTime) return;
                                  void handleFutureSlotPick(nearestDate, nearestTime);
                                }}
                              >
                                اختيار أقرب موعد
                              </button>
                            </div>

                            <div className="table-responsive">
                              <table className="table align-middle mb-0 bk-future-table">
                                <thead>
                                  <tr>
                                    <th>التاريخ</th>
                                    <th>أوقات متاحة</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {futureResult.map((r) => (
                                    <tr key={r.date}>
                                      <td>{r.date}</td>
                                      <td>
                                        <div className="d-flex gap-2 flex-wrap">
                                          {(r.times || []).map((t) => (
                                            <button
                                              key={t}
                                              type="button"
                                              className="btn btn-sm bk-time-pill"
                                              style={{ borderRadius: 999 }}
                                              onClick={() => {
                                                void handleFutureSlotPick(r.date, t);
                                              }}
                                            >
                                              {formatTime12(t, t)}
                                            </button>
                                          ))}
                                        </div>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ) : null}

              </div>
            </div>

            {/* ملخص الحجز قبل الدفع + الخصم + الإرسال */}
            <div className="col-12 col-lg-6 order-5 order-lg-3">
              <div className="card p-3 bk-panel bk-summary-panel">
                <div className="bk-summary-panel-head mb-2">ملخص الحجز قبل الدفع</div>
                {totalPreviewCount > 0 && !allPreviewLocked ? (
                  <div className="bk-cart-preview-pending mb-2">
                    ملخص الحجز يظهر بعد تأكيد الموظفة والوقت لكل خدمة.
                  </div>
                ) : null}

                {allPreviewLocked ? (
                  <div className="bk-cart-confirmed-preview">
                    <div className="d-flex align-items-center justify-content-between flex-wrap gap-2">
                      <div className="bk-cart-confirmed-title mb-0">تفاصيل الملخص</div>
                      <div className="small text-muted">
                        مؤكد: <span dir="ltr">{lockedPreviewCount} / {totalPreviewCount}</span>
                      </div>
                    </div>
                    <div className="bk-cart-confirmed-meta">
                      <div>
                        <strong>العميلة:</strong>{" "}
                        {String(formData.name || "").trim() ? (
                          String(formData.name || "").trim()
                        ) : (
                          <span className="bk-required-missing">الرجاء كتابة الاسم</span>
                        )}
                      </div>
                      <div>
                        <strong>الجوال:</strong>{" "}
                        {phone10Digits(String(formData.phone || "").trim()) ? (
                          phone10Digits(String(formData.phone || "").trim())
                        ) : (
                          <span className="bk-required-missing">الرجاء كتابة الجوال</span>
                        )}
                      </div>
                      <div><strong>وقت إنشاء الحجز:</strong> {previewCreatedAtLabel}</div>
                    </div>
                    {Number(applied.discountAmount || 0) > 0 ? (
                      <div className="bk-discount-visual mt-2">
                        <div className="bk-discount-badge">
                          الخصم المطبق: {String(applied.title || "خصم يدوي").trim()}
                        </div>
                        <div className="bk-discount-lines">
                          <div className="bk-discount-line is-before">
                            <span>قبل الخصم</span>
                            <strong>{basePrice.toFixed(0)} ريال</strong>
                          </div>
                          <div className="bk-discount-line is-discount">
                            <span>قيمة الخصم</span>
                            <strong>-{Number(applied.discountAmount || 0).toFixed(0)} ريال</strong>
                          </div>
                          <div className="bk-discount-line is-after">
                            <span>بعد الخصم</span>
                            <strong>{finalPrice.toFixed(0)} ريال</strong>
                          </div>
                        </div>
                      </div>
                    ) : null}
                    <div className="bk-cart-summary-unified mt-2">
                      {bookingPreviewItems.map((row) => (
                        <div key={`preview-${row.id}`} className="bk-cart-summary-line">
                          <div className="bk-cart-summary-line-head">
                            <span className="bk-cart-summary-index">#{row.index}</span>
                            <span className="bk-cart-summary-service">{row.serviceName}</span>
                            {!expandedPreviewRows[row.id] ? (
                              <span className="bk-preview-toggle-hint">افتحي البطاقة لعرض التفاصيل</span>
                            ) : null}
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-secondary bk-preview-toggle-btn"
                              onClick={() => togglePreviewRow(row.id)}
                            >
                              {expandedPreviewRows[row.id] ? "▾ إغلاق" : "▸ فتح"}
                            </button>
                          </div>
                          {expandedPreviewRows[row.id] ? (
                            <div className="bk-cart-summary-line-meta">
                              <span><strong>الموظفة:</strong> {row.staffName}</span>
                              <span><strong>التاريخ:</strong> {row.date}</span>
                              <span><strong>الوقت:</strong> {row.timeLabel}</span>
                              <span><strong>المدة:</strong> {row.durationMin} د</span>
                              <span><strong>السعر:</strong> {row.priceLabel}</span>
                              {row.toolsNote ? (
                                <span><strong>ملاحظة:</strong> {row.toolsNote}</span>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                    <div className="bk-total-visual mt-2">
                      <span>الإجمالي النهائي</span>
                      <strong>{finalPrice.toFixed(0)} ريال</strong>
                    </div>
                  </div>
                ) : null}

                {/* Manual Discount */}
                <div className="mt-2">
                  <div className="row g-2 align-items-start bk-discount-editor">
                    <div className="col-12 bk-discount-editor-col">
                      <label className="form-label">نوع الخصم</label>
                      <div className="bk-discount-type-cards" role="group" aria-label="نوع الخصم">
                        <button
                          type="button"
                          className={`bk-discount-type-card ${manualDiscountType === "" ? "is-active" : ""}`}
                          disabled={isLoading}
                          onClick={() => setManualDiscountType("")}
                          aria-pressed={manualDiscountType === ""}
                        >
                          بدون خصم
                        </button>
                        <button
                          type="button"
                          className={`bk-discount-type-card ${manualDiscountType === "fixed" ? "is-active" : ""}`}
                          disabled={isLoading}
                          onClick={() => setManualDiscountType("fixed")}
                          aria-pressed={manualDiscountType === "fixed"}
                        >
                          خصم مبلغ ثابت (ريال)
                        </button>
                        <button
                          type="button"
                          className={`bk-discount-type-card ${manualDiscountType === "percent" ? "is-active" : ""}`}
                          disabled={isLoading}
                          onClick={() => setManualDiscountType("percent")}
                          aria-pressed={manualDiscountType === "percent"}
                        >
                          خصم نسبة مئوية (%)
                        </button>
                      </div>
                    </div>

                    <div className="col-12 bk-discount-editor-col bk-discount-value-col">
                      <label className="form-label">قيمة الخصم</label>
                      <input
                        type="number"
                        min={0}
                        max={manualDiscountType === "percent" ? 100 : undefined}
                        step="1"
                        className="form-control bk-discount-value-input"
                        value={manualDiscountValue}
                        onChange={(e) => setManualDiscountValue(String(e.target.value || ""))}
                        placeholder={manualDiscountType === "percent" ? "مثال: 10" : "مثال: 50 ريال"}
                        disabled={isLoading || !manualDiscountType}
                      />
                    </div>

                    {discountMsg ? (
                      <div className="col-12 bk-discount-editor-msg-col">
                        <div
                          className="alert alert-secondary mb-0 py-2 bk-discount-msg bk-discount-msg-text"
                        >
                          {discountMsg}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* Submit */}
                <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mt-3">
                  <button
                    type="submit"
                    className="btn btn-primary bk-pay-btn bk-submit-btn"
                    disabled={isLoading}
                    onClick={() => {
                      internalSubmitModeRef.current = "payment";
                    }}
                  >
                    {isLoading ? (
                      <>
                        <FontAwesomeIcon icon={faSpinner} spin className="me-2" />
                        جاري الدفع...
                      </>
                    ) : (
                      "دفع"
                    )}
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline-primary bk-future-booking-btn bk-submit-btn"
                    disabled={isLoading}
                    onClick={() => {
                      internalSubmitModeRef.current = "future";
                      internalBookingFormRef.current?.requestSubmit();
                    }}
                  >
                    حجز للمستقبل
                  </button>
                </div>
              </div>
            </div>

            {/* بحث أوقات للأيام القادمة */}
            {false ? (
            <div className="col-12 col-lg-6 order-4">
              <div className="card p-3 bk-panel bk-future-panel">
                <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">
                  <div className="bk-future-title-head">بحث أوقات للأيام القادمة</div>
                  <span className="text-muted bk-future-subhint">يُظهر أول 5 أيام متاحة</span>
                </div>

                <div className="row g-2 align-items-end">
                  <div className="col-12">
                    <select
                      className="form-select"
                      value={futureAnyStaff ? "any" : "one"}
                      onChange={(e) => setFutureAnyStaff(e.target.value === "any")}
                    >
                      <option value="any">أي موظفة للخدمة</option>
                      <option value="one">موظفة محددة</option>
                    </select>
                  </div>

                  {!futureAnyStaff ? (
                    <div className="col-12">
                      <label className="form-label">اختاري الموظفة</label>
                      {!servicePicker ? (
                        <div className="alert alert-danger mb-0 py-2" style={{ borderRadius: 12 }}>
                          اختاري الخدمة أولاً ثم اختاري الموظفة.
                        </div>
                      ) : staffLoadingByService[String(servicePicker || "").trim()] ? (
                        <div className="small text-muted mt-1">
                          <FontAwesomeIcon icon={faSpinner} spin className="me-2" />
                          جاري تحميل الموظفات...
                        </div>
                      ) : staffErrorByService[String(servicePicker || "").trim()] ? (
                        <div className="small text-warning mt-1">
                          {staffErrorByService[String(servicePicker || "").trim()]}
                        </div>
                      ) : (
                        <>
                          <input
                            className="form-control"
                            value={futureStaffNameQuery}
                            onChange={(e) => {
                              const v = String(e.target.value || "");
                              setFutureStaffNameQuery(v);
                              setFutureSelectedEmployeeKey("");
                            }}
                            placeholder="ابحثي باسم الموظفة..."
                            disabled={!futureStaffOptions.length}
                          />
                          {futureStaffNameQuery && filteredFutureStaffOptions.length ? (
                            <div className="mt-2 d-flex flex-wrap gap-2">
                              {filteredFutureStaffOptions.slice(0, 8).map((st) => (
                                <button
                                  key={st.key}
                                  type="button"
                                  className="btn btn-outline-light btn-sm"
                                  onClick={() => {
                                    setFutureStaffNameQuery(st.name);
                                    setFutureSelectedEmployeeKey(st.key);
                                  }}
                                >
                                  {st.name}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                  ) : null}

                  <div className="col-12 d-grid">
                    <button
                      type="button"
                      className="btn btn-outline-info"
                      style={{ borderRadius: 12 }}
                      onClick={() => {
                        void runFutureAvailabilitySearch();
                      }}
                      disabled={futureLoading}
                    >
                      {futureLoading ? "جاري البحث..." : "بحث"}
                    </button>
                  </div>

                  {futureMsg ? (
                    <div className="col-12">
                      <div className="alert alert-secondary mb-0 py-2" style={{ borderRadius: 12 }}>
                        {futureMsg}
                      </div>
                    </div>
                  ) : null}

                  {futureResult.length ? (
                    <div className="col-12">
                      <div className="bk-future-inline">
                        <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">
                          <div style={{ fontWeight: 800 }}>نتائج البحث</div>
                          <button
                            type="button"
                            className="btn btn-sm bk-time-pill"
                            onClick={() => {
                              const nearestDate = String(futureResult[0]?.date || "").trim();
                              const nearestTime = String(futureResult[0]?.times?.[0] || "").trim();
                              if (!nearestDate || !nearestTime) return;
                              void handleFutureSlotPick(nearestDate, nearestTime);
                            }}
                          >
                            اختيار أقرب موعد
                          </button>
                        </div>

                        <div className="table-responsive">
                          <table className="table align-middle mb-0 bk-future-table">
                            <thead>
                              <tr>
                                <th>التاريخ</th>
                                <th>أوقات متاحة</th>
                              </tr>
                            </thead>
                            <tbody>
                              {futureResult.map((r) => (
                                <tr key={r.date}>
                                  <td>{r.date}</td>
                                  <td>
                                    <div className="d-flex gap-2 flex-wrap">
                                      {(r.times || []).map((t) => (
                                        <button
                                          key={t}
                                          type="button"
                                          className="btn btn-sm bk-time-pill"
                                          style={{ borderRadius: 999 }}
                                          onClick={() => {
                                            void handleFutureSlotPick(r.date, t);
                                          }}
                                        >
                                          {formatTime12(t, t)}
                                        </button>
                                      ))}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
            ) : null}
          </div>
            </div>
          </div>
        </form>

        </div>
      </div>
    </div>);
};

export default BookingInternal;






