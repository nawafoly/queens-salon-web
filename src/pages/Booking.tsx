// src/pages/Booking.tsx

import { useEffect, useMemo, useState, useRef } from "react";
import type React from "react"; // âœ… ADD: عشان React.ChangeEvent / React.FormEvent
import { useLocation, useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import logo from "../assets/images/ssunnamed2.png";
import hairGuideImg from "../assets/images/hair-length-guide.png";

import {
  faCalendarAlt,
  faUser,
  faPhone,
  faSpinner,
  faUserTie,
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

import "../styles/Booking.css";

// âœ… Firestore slot availability check
import {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  orderBy,
  setDoc, // âœ… add
} from "firebase/firestore";

import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

// âœ… انتبه: لازم firebase.ts يصدّر storage
import { db, storage } from "../services/firebase";

// âœ… Firebase Auth (للقراءة فقط)
import { getAuth, onAuthStateChanged } from "firebase/auth";


// âœ… Firestore Offers
import type { Offer as FsOffer } from "../services/firestoreOffers";
import {
  findActiveOfferByCode,
  offerAppliesToService,
  listOffers,
  isOfferActiveNow,
} from "../services/firestoreOffers";

// âœ… Staff Public (Firestore)
import {
  listActiveStaffAll,
  type StaffPublicWithId,
} from "../services/firestoreStaffPublic";

// âœ… Catalog from Firestore (Sections/Categories/Services)
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
import { pricingSections } from "./Pricing";

// âœ… Create booking (Firestore)
import { createBooking } from "../services/firestoreBookings";
import * as firestoreBookings from "../services/firestoreBookings";

import { createOrLoadUserProfile } from "../services/userProfile";

// âœ… Custom modal بدل alert
import ConfirmModal from "../components/ConfirmModal";

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
  serviceSectionId: string; // âœ… القسم الحقيقي للخدمة وقت الإضافة
  serviceSectionTitle?: string; // âœ… اسم القسم وقت الإضافة (للقواعد المرنة)
  serviceCategoryId?: string; // âœ… للتوافق (اختياري)
  serviceCategoryName?: string; // âœ… لو التصنيف نصي (للـ legacy)

  serviceBasePrice?: number; // âœ… سعر الخدمة الأساسي قبل أي رسوم إضافية
  basePrice: number;
  priceText: string;
  durationMin: number;

  employeeId: string; // staff_public doc id
  employeeUid?: string; // linkedUid
  employeeName?: string;

  date: string; // YYYY-MM-DD
  time: string; // slot time: string; // âœ… نخزن 24h "HH:MM" (value24)

  locked?: boolean; // âœ… جديد: هل الكرت تم تأكيده؟
  toolsSource?: "client" | "salon"; // âœ… أدوات الخدمة: من العميلة أو من الصالون
  toolsFeeApplied?: number; // âœ… الرسوم المضافة بسبب الأدوات (إن وجدت)
  sequenceOfferId?: string;
  sequenceOfferTitle?: string;
  sequenceStepsSnapshot?: Array<{
    serviceId: string;
    orderIndex: number;
    gapAfterMin: number;
    titleSnapshot?: string;
    serviceNameAtBooking: string;
    priceAtBooking: number;
    durationAtBooking: number;
    sectionIdAtBooking?: string;
  }>;
};

interface BookingFormData {
  name: string;
  phone: string;
  note?: string;

  // âœ… سلة خدمات: كل خدمة لها (موظفة/تاريخ/وقت)
  items: CartItem[];
}

type CouponMessageKind = "success" | "error" | "";

type AppliedCouponEntry = {
  code: string;
  offerId: string;
  offerTitle: string;
  discountAmount: number;
  applicableItemIds: string[];
};

function extractMinPrice(priceText: string): number {
  const cleaned = String(priceText || "").replace(/[^\d\-]/g, "");
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
  const directKeys = [
    "nameAr",
    "titleAr",
    "labelAr",
    "displayNameAr",
    "الاسم",
    "العنوان",
    "name",
    "title",
    "displayName",
    "label",
    "categoryName",
    "category",
  ];
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
  const fb = String(fallback || "").trim();
  if (!fb) return "";
  // avoid showing internal slugs/ids like "advanced/catalog" to clients
  const looksLikeInternalId = /^[a-z0-9/_-]+$/i.test(fb) && /[/_-]/.test(fb);
  if (looksLikeInternalId) return "";
  return fb;
}

function humanizeCatalogToken(value: string) {
  return String(value || "")
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function arabizeCatalogLabel(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const dict: Record<string, string> = {
    "hair": "الشعر",
    "hair care": "العناية بالشعر",
    "hair color treatments": "صبغات ومعالجات الشعر",
    "hair color treatment": "صبغات ومعالجات الشعر",
    "coloring": "الصبغات",
    "blow dry": "استشوار",
    "blowdry": "استشوار",
    "makeup": "المكياج",
    "skin": "البشرة",
    "skin care": "العناية بالبشرة",
    "nails": "الأظافر",
    "nail care": "العناية بالأظافر",
    "massage": "المساج",
    "offers": "العروض",
    "service packages": "البكجات",
    "service package": "البكجات",
    "packages": "البكجات",
    "package": "باكيج",
    "filter": "فلر",
  };
  let key = humanizeCatalogToken(raw).toLowerCase();

  const phraseEntries = Object.entries(dict).sort((a, b) => b[0].length - a[0].length);
  for (const [en, ar] of phraseEntries) {
    const pattern = new RegExp(`\\b${en.replace(/\s+/g, "\\s+")}\\b`, "gi");
    key = key.replace(pattern, ar);
  }

  const cleaned = key
    .replace(/\s+/g, " ")
    .replace(/\b(and|with|for|of|the)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned || key;
}

function normalizeUiLabel(value: string) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripCatalogNoise(value: string) {
  let s = String(value || "");
  // remove slug-like fragments: hair-color-treatments / advanced_catalog / a/b
  s = s.replace(/[A-Za-z0-9]+(?:[\/_-][A-Za-z0-9]+)+/g, " ");
  // remove remaining long latin tokens
  s = s.replace(/\b[A-Za-z][A-Za-z0-9_-]{2,}\b/g, " ");
  s = s.replace(/[_-]+/g, " ");
  return normalizeUiLabel(s);
}

function toArabicUiLabel(value: string) {
  let s = arabizeCatalogLabel(normalizeUiLabel(value));
  s = s.replace(/[_-]+/g, " ");
  // remove leftover latin words if any remain after dictionary replacement
  s = s.replace(/\b[A-Za-z]{2,}\b/g, " ");
  return normalizeUiLabel(s);
}

function cleanSectionLabel(value: string) {
  const s = stripCatalogNoise(toArabicUiLabel(value));
  if (!s) return "";
  return s.replace(/^قسم\s+/u, "").trim();
}

function cleanCategoryLabel(category: string, section: string) {
  let c = stripCatalogNoise(toArabicUiLabel(category));
  if (!c) return "";
  c = c.replace(/^قسم\s+/u, "").trim();

  const sec = cleanSectionLabel(toArabicUiLabel(section));
  if (!sec) return c;

  const variants = [
    sec,
    `${sec} الشعر`,
    `${sec} للشعر`,
    `${sec} البشرة`,
    `${sec} للأظافر`,
  ]
    .map((x) => normalizeUiLabel(x))
    .filter(Boolean);

  for (const v of variants) {
    if (c === v) return "";
    if (c.startsWith(`${v} `)) {
      c = c.slice(v.length).trim();
      break;
    }
  }

  return c.trim();
}

type FlatService = {
  id: string;
  kind: "service" | "package";
  sectionId: string;
  sectionTitle: string;

  // âœ… التصنيف
  categoryId?: string; // Firestore فقط
  category: string; // اسم التصنيف للعرض (Firestore/Pricing)
  name: string;

  // âœ… حقول تسعير/عرض
  priceText: string;
  basePrice: number;
  seasonPrice?: number; // âœ… سعر الموسم (اختياري)

  // âœ… مدة من Firestore إذا كانت موجودة
  durationMin?: number;
  packageId?: string;
  packageServiceIds?: string[];
  packageServices?: PackageServiceItem[];
  packageBaseTotalPrice?: number;

  // âœ… معرفة مصدر الخدمة
  source: "firestore" | "pricing";
};

type CategoryOption = { id: string; name: string };
type PickerScope = "services" | "offers_packages";
type FsSectionCatalogCacheRow = {
  categories: CategoryDoc[];
  services: ServiceDoc[];
};

const SALON_ID = "main";
const DEFAULT_SERVICE_DURATION_MIN = 60;
const PACKAGE_SECTION_ID = "service-packages";
const PACKAGE_SECTION_TITLE = "البكيجات";
const ALLOW_OVERTIME_MIN = 20;
const MANI_PEDI_TOOLS_FEE_FIXED = 15;
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

// âœ… نفس منطق slotId الموجود في firestoreBookings.ts
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

function getTimesToLock(
  allSlots: TimeSlot[],
  slotStepMin: number,
  startTime24: string, // âœ… "HH:MM"
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


// âœ…âœ…âœ… NEW: تحديد الأوقات اللي "تنفع كبداية" حسب مدة الخدمة (تطلع أخضر)
function getGreenStartTimes(args: {
  allSlots: TimeSlot[];
  slotStepMin: number;
  durationMin: number;
  bufferMin: number;
  takenAll: Set<string>; // âœ… times 24h
}) {
  const greens = new Set<string>(); // âœ… نخزن value24

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

function minutesToTime24(totalMin: number) {
  const safe = Math.max(0, Math.min(23 * 60 + 59, Number(totalMin || 0)));
  const hh = Math.floor(safe / 60);
  const mm = safe % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function roundUpToStep(totalMin: number, stepMin: number) {
  const step = Math.max(1, Number(stepMin || 1));
  return Math.ceil(Number(totalMin || 0) / step) * step;
}

function calcDiscount(basePrice: number, offer: FsOffer) {
  const value = Number((offer as any).value || 0);

  if ((offer as any).discountType === "percent") {
    const percent = Math.min(100, Math.max(0, value));
    const discount = Math.round((basePrice * percent) / 100);
    return {
      discountAmount: discount,
      finalPrice: Math.max(0, basePrice - discount),
    };
  }

  const fixed = Math.max(0, value);
  const discount = Math.min(basePrice, fixed);
  return {
    discountAmount: discount,
    finalPrice: Math.max(0, basePrice - discount),
  };
}

function normalizeCouponCode(raw: string) {
  return String(raw || "").trim().toUpperCase();
}

/**
 * âœ… صلاحية العرض حسب "تاريخ الحجز" (مو اليوم)
 */
function isOfferValidForBookingDate(offer: any, bookingDateISO: string) {
  if (!bookingDateISO) return { ok: true, reason: "" };

  const s = String(offer?.startDate || "").trim();
  const e = String(offer?.endDate || "").trim();

  if (s && bookingDateISO < s) return { ok: false, reason: `العرض يبدأ من ${s}` };
  if (e && bookingDateISO > e) return { ok: false, reason: `العرض انتهى بتاريخ ${e}` };
  return { ok: true, reason: "" };
}

function isSeasonActiveForDate(season: any, bookingDateISO: string) {
  const enabled = !!season?.enabled;
  if (!enabled) return false;

  const s = String(season?.startDate || "").trim(); // "YYYY-MM-DD"
  const e = String(season?.endDate || "").trim();   // "YYYY-MM-DD"

  // إذا ما حطيت تواريخ: اعتبره شغال دايم
  if (!s && !e) return true;

  if (s && bookingDateISO && bookingDateISO < s) return false;
  if (e && bookingDateISO && bookingDateISO > e) return false;
  return true;
}


// âœ… نبي UID الحقيقي فقط (إذا مسجل دخول) ونرفض anonymous
function getSignedInUidOrNull(): string | null {
  const auth = getAuth();
  const u = auth.currentUser;
  if (!u) return null;
  if ((u as any).isAnonymous) return null;
  return u.uid;
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
  suggestedSlot?: string; // âœ… NEW: الوقت المقترح (لطور الموسم فقط)
};

type PackageQuickState = {
  employeeId: string;
  times: string[];
  loading: boolean;
  error: string;
};

type PackageRunMeta = {
  runId: string;
  leaderItemId: string;
  items: CartItem[];
  dateISO: string;
  totalDurationMin: number;
  totalWindowMin: number;
  commonStaff: StaffPublicWithId[];
  loading: boolean;
  staffError: string;
};

type PackageQuickEligibility = {
  loading: boolean;
  commonStaff: StaffPublicWithId[];
};


const emptyBusyState = (): BusyState => ({
  busyTimes: new Set(),
  disabledStartTimes: new Set(),
  loading: false,
  hint: "",
  suggestedSlot: "", // âœ… NEW
});


function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysISO(startISO: string, addDays: number) {
  const d = new Date(startISO + "T00:00:00");
  d.setDate(d.getDate() + addDays);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
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

function normalizeISODate(v: any) {
  const s = String(v || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function formatISODateAr(v: any) {
  const iso = normalizeISODate(v);
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("ar-SA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

function getStaffLeaveMetaForDate(staff: any, dateISO: string) {
  const target = normalizeISODate(dateISO) || todayISO();
  const exceptionalDates = Array.isArray(staff?.exceptionalLeaveDates)
    ? staff.exceptionalLeaveDates.map((d: any) => normalizeISODate(d)).filter(Boolean)
    : [];
  if (exceptionalDates.includes(target)) {
    return { isOnLeave: true, leaveUntil: "", label: "إجازة في هذا اليوم" };
  }

  const exceptionalWeekdays = Array.isArray(staff?.exceptionalLeaveWeekdays)
    ? staff.exceptionalLeaveWeekdays
        .map((d: any) => String(d || "").trim().toLowerCase())
        .filter(Boolean)
    : [];
  const dayKey = resolveWeekdayFromISO(target);
  if (dayKey && exceptionalWeekdays.includes(dayKey)) {
    return {
      isOnLeave: true,
      leaveUntil: "",
      label: `إجازة كل ${WEEKDAY_LABEL_AR[dayKey]}`,
    };
  }

  const onLeave = !!staff?.onLeave;
  const leaveUntil = normalizeISODate(staff?.leaveUntil);
  if (!onLeave) {
    return { isOnLeave: false, leaveUntil: "", label: "" };
  }

  const isOnLeave = !leaveUntil || target <= leaveUntil;
  if (!isOnLeave) {
    return { isOnLeave: false, leaveUntil, label: "" };
  }

  const untilLabel = formatISODateAr(leaveUntil);
  return {
    isOnLeave: true,
    leaveUntil,
    label: untilLabel ? `في إجازة حتى ${untilLabel}` : "في إجازة",
  };
}

function normalizeSearchText(v: string) {
  return String(v || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function isManiPediSectionByInfo(sectionId: string, sectionTitle?: string) {
  const hay = normalizeSearchText(`${sectionId || ""} ${sectionTitle || ""}`);
  if (!hay) return false;
  return MANI_PEDI_SECTION_KEYWORDS.some((k) => hay.includes(normalizeSearchText(k)));
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

function formatTime12ForClient(time24: string) {
  return formatTime12(time24, "");
}

function normalizeKsaPhone(raw: string) {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";

  if (digits.startsWith("9665") && digits.length === 12) return "0" + digits.slice(3);
  if (digits.startsWith("5") && digits.length === 9) return "0" + digits;
  if (digits.startsWith("05") && digits.length === 10) return digits;

  return digits;
}

function phone10Digits(raw: string) {
  return normalizeKsaPhone(raw).replace(/\D/g, "").slice(0, 10);
}


const Booking = ({ internalMode = false }: { internalMode?: boolean }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const dateRef = useRef<HTMLInputElement>(null);

  // =========================
  // âœ… Settings (live)
  // =========================
  const [appSettings, setAppSettings] = useState<any>(() => AppSettingsService.getCached?.() || {});
  const booking = (appSettings as any)?.booking || {};
  const seasonPricing = (appSettings as any)?.catalogSeasonPricing || {};

  const seasonCfg = seasonPricing; // âœ… موسم الأسعار (Catalog)
  const sequentialBooking = !!(booking as any)?.sequentialBooking;
  // âœ… تاريخ الحجز الأساسي (لازم يختاره قبل الخدمات)
  const [bookingDate, setBookingDate] = useState<string>("");


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
      openTime: safeTimeHHMM(dayHoursBase?.start, "10:00"),
      closeTime: safeTimeHHMM(dayHoursBase?.end, "22:00"),
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
    // âœ… لا تغيّر هذي القائمة بدون ما تغيّر SettingsBookings.tsx بعده
    return [5, 10, 15, 30].includes(v) ? v : 10;
  }, [(booking as any)?.slotStepMin]);

  // âœ… NEW: bufferMin from settings (same contract as firestoreBookings)
  const bufferMin = useMemo(() => {
    return Math.max(0, safeInt((booking as any)?.bufferMin, 5));
  }, [(booking as any)?.bufferMin]);
  const maniPediToolsFee = MANI_PEDI_TOOLS_FEE_FIXED;

  const [timeSlots, setTimeSlots] = useState<TimeSlot[]>([]);

  useEffect(() => {
    if (!selectedDayOpen) {
      setTimeSlots([]);
      return;
    }

    // âœ… فتحة المواعيد حسب اليوم المختار
    setTimeSlots(generateSalonTimeSlots(openTime, closeTime, slotStepMin));
  }, [selectedDayOpen, openTime, closeTime, slotStepMin]);

  useEffect(() => {
    const unsub = AppSettingsService.subscribe((remote: any) => {
      setAppSettings(remote || {});
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadSequenceOffers() {
      try {
        const rows = await listOffers(SALON_ID);
        if (cancelled) return;
        const active = (Array.isArray(rows) ? rows : []).filter((o: any) => {
          const steps = Array.isArray((o as any)?.sequenceSteps) ? (o as any).sequenceSteps : [];
          return steps.length > 0 && isOfferActiveNow(o as any);
        });
        setSequenceOffers(active);
      } catch {
        if (!cancelled) setSequenceOffers([]);
      }
    }
    loadSequenceOffers();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    }
    if (typeof document !== "undefined") {
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      const mainContent = document.querySelector<HTMLElement>(".main-content");
      if (mainContent) mainContent.scrollTop = 0;
    }
  }, [location.pathname]);

  // =========================
  // Catalog mode
  // =========================
  const [catalogMode, setCatalogMode] = useState<"firestore" | "pricing">("firestore");
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [categoryLoading, setCategoryLoading] = useState(false);

  const [fsSections, setFsSections] = useState<SectionDoc[]>([]);
  const [fsCategories, setFsCategories] = useState<CategoryDoc[]>([]);
  const [fsServices, setFsServices] = useState<ServiceDoc[]>([]);
  const [fsPackages, setFsPackages] = useState<ServicePackageDoc[]>([]);
  const [sequenceOffers, setSequenceOffers] = useState<FsOffer[]>([]);
  const fsSectionCatalogCacheRef = useRef<Record<string, FsSectionCatalogCacheRow>>({});
  const fsSectionCatalogInFlightRef = useRef<
    Record<string, Promise<FsSectionCatalogCacheRow>>
  >({});

  const [selectedSectionId, setSelectedSectionId] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [servicePicker, setServicePicker] = useState<string>("");
  const [autoAddPackageId, setAutoAddPackageId] = useState<string>("");
  const [offerStartTime, setOfferStartTime] = useState<string>("");
  const [pickerScope, setPickerScope] = useState<PickerScope>("services");

  // âœ… دليل أطوال الشعر (عرض)
  const [showHairGuide, setShowHairGuide] = useState(false);

  // âœ… دليل أطوال الشعر (رابط + رفع للأونر)
  const [hairGuideUrl, setHairGuideUrl] = useState<string>(hairGuideImg);
  const [isOwner, setIsOwner] = useState(false);
  const [uploadingGuide, setUploadingGuide] = useState(false);

  const [formData, setFormData] = useState<BookingFormData>({
    name: "",
    phone: "",
    note: "",
    items: [],
  });

  // =========================
  // âœ… Auto-fill client info (name/phone) from Profile
  // =========================
  const [signedUid, setSignedUid] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    function fillFromLocalStorage() {
      try {
        const cached = JSON.parse(localStorage.getItem("user_profile_v1") || "null");
        const name = String(cached?.name || localStorage.getItem("userName") || "").trim();
        const phone = phone10Digits(cached?.phone || localStorage.getItem("userPhone") || "");

        if (!cancelled) {
          setFormData((prev) => ({
            ...prev,
            name: prev.name || name,
            phone: prev.phone || phone,
          }));
        }
      } catch {
        // ignore
      }
    }

    // 1) عبّي من الكاش أولاً
    fillFromLocalStorage();

    // 2) لو مسجلة دخول: عبّي من Firestore profile
    const auth = getAuth();
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u || (u as any).isAnonymous) {
        setSignedUid(null);
        fillFromLocalStorage();
        return;
      }

      setSignedUid(u.uid);

      try {
        const p = await createOrLoadUserProfile(u);

        const name = String((p as any)?.name || "").trim();
        const phone = phone10Digits((p as any)?.phone || "");

        if (!cancelled) {
          setFormData((prev) => ({
            ...prev,
            name: prev.name || name,
            phone: prev.phone || phone,
          }));
        }

        // خزّن محلياً
        localStorage.setItem("user_profile_v1", JSON.stringify(p));
        if (name) localStorage.setItem("userName", name);
        if (phone) localStorage.setItem("userPhone", phone);
      } catch {
        fillFromLocalStorage();
      }
    });

    // 3) لو عدّل بياناته من Profile
    const onChanged = () => fillFromLocalStorage();
    window.addEventListener("authChanged", onChanged);


    return () => {
      cancelled = true;
      unsub();
      window.removeEventListener("authChanged", onChanged);
    };
  }, []);


  const [isLoading, setIsLoading] = useState<boolean>(false);

  const [couponCode, setCouponCode] = useState("");
  const [appliedCoupons, setAppliedCoupons] = useState<AppliedCouponEntry[]>([]);
  const [offerMsg, setOfferMsg] = useState("");
  const [offerMsgKind, setOfferMsgKind] = useState<CouponMessageKind>("");
  const [offerLandingMsg, setOfferLandingMsg] = useState("");
  const [manualOverride, setManualOverride] = useState(false);

  const clearAppliedCoupons = () => {
    setAppliedCoupons([]);
    setOfferMsg("");
    setOfferMsgKind("");
    setManualOverride(false);
  };

  // âœ… busy/disabled per item
  const [busyByItem, setBusyByItem] = useState<Record<string, BusyState>>({});
  const [packageQuickByRun, setPackageQuickByRun] = useState<Record<string, PackageQuickState>>({});
  const [packageQuickEligibilityByRun, setPackageQuickEligibilityByRun] = useState<
    Record<string, PackageQuickEligibility>
  >({});

  // âœ… Future availability (clients)
  const [futureAnyStaff, setFutureAnyStaff] = useState(true);
  const [futureSelectedEmployeeKey, setFutureSelectedEmployeeKey] = useState<string>("");
  const [futureStaffNameQuery, setFutureStaffNameQuery] = useState("");
  const [futureLoading, setFutureLoading] = useState(false);
  const [futureResult, setFutureResult] = useState<
    { date: string; times: string[]; note?: string; contributors?: string[] }[]
  >([]);
  const [futureMsg, setFutureMsg] = useState("");
  const [futureGateLoading, setFutureGateLoading] = useState(false);
  const [showFutureSearch, setShowFutureSearch] = useState(false);
  const [futureGateMsg, setFutureGateMsg] = useState("");
  const [futureServiceId, setFutureServiceId] = useState("");
  const [futureTargetItemId, setFutureTargetItemId] = useState("");
  const autoFutureSearchKeyRef = useRef("");
  const futureSearchRef = useRef<HTMLDivElement | null>(null);

  function openFutureSearchFromItem(it: CartItem) {
    const sid = String(it?.serviceId || "").trim();
    if (!sid) return;

    const employeeKey = String(it?.employeeUid || it?.employeeId || "").trim();
    const employeeName = String(it?.employeeName || "").trim();
    const dateISO = String(bookingDate || "").trim();

    setFutureServiceId(sid);
    setFutureTargetItemId(String(it?.id || "").trim());
    setShowFutureSearch(true);
    setFutureResult([]);
    setFutureMsg("");
    autoFutureSearchKeyRef.current = `${sid}|${dateISO}|${employeeKey ? "one" : "any"}|${employeeKey}`;

    if (employeeKey) {
      setFutureAnyStaff(false);
      setFutureSelectedEmployeeKey(employeeKey);
      setFutureStaffNameQuery(employeeName || "");
      setFutureGateMsg("اليوم ممتلئ لنفس الموظفة. يمكنكِ البحث عن أقرب يوم متاح.");
    } else {
      setFutureAnyStaff(true);
      setFutureSelectedEmployeeKey("");
      setFutureStaffNameQuery("");
      setFutureGateMsg("اليوم ممتلئ لهذه الخدمة. يمكنكِ البحث عن أقرب يوم متاح.");
    }

    setTimeout(() => {
      futureSearchRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      void runFutureAvailabilitySearch();
    }, 0);
  }

  // âœ… Staff per serviceId
  const [staffByService, setStaffByService] = useState<Record<string, StaffPublicWithId[]>>({});
  const [staffLoadingByService, setStaffLoadingByService] = useState<Record<string, boolean>>({});
  const [staffErrorByService, setStaffErrorByService] = useState<Record<string, string>>({});
  const staffAllCacheRef = useRef<StaffPublicWithId[] | null>(null);
  const staffByResolverCacheRef = useRef<Record<string, StaffPublicWithId[]>>({});
  const staffByResolverInFlightRef = useRef<Record<string, Promise<StaffPublicWithId[]>>>({});

  // âœ… Modal بدل alert
  const [uiModal, setUiModal] = useState<UiModalState>({
    open: false,
    title: "",
    message: "",
    variant: "info",
    confirmText: "حسنًا",
  });

  const [onUiConfirm, setOnUiConfirm] = useState<null | (() => void)>(null);

  const openModal = (data: Omit<UiModalState, "open">, onConfirmAction?: () => void) => {
    setOnUiConfirm(() => onConfirmAction ?? null);
    setUiModal({ open: true, ...data });
  };

  const closeModal = () => {
    setUiModal((p) => ({ ...p, open: false }));
    setOnUiConfirm(null);
  };

  // =========================
  // âœ… Helper: تعارض أوقات داخل السلة نفسها (employeeKey + نفس التاريخ)
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

      const otherKey = resolveEmployeeKey(other); // âœ… FIX: نفس منطق booking_slots
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




  function isDateInRange(dateISO: string, startISO: string, endISO: string) {
    if (!dateISO) return false;
    if (startISO && dateISO < startISO) return false;
    if (endISO && dateISO > endISO) return false;
    return true;
  }

  // âœ… مثال شكل إعدادات الموسم (نربطه مع appSettings لاحقًا لو اسم الحقول مختلف)
  function isSeasonEnabledForDate(appSettings: any, dateISO: string) {
    const season = (appSettings as any)?.catalogSeasonPricing || {};
    const enabled = !!season.enabled;

    const start = String(season.startDate || season.from || "").trim();
    const end = String(season.endDate || season.to || "").trim();

    if (!enabled) return { ok: false, start, end };
    if (!start && !end) return { ok: true, start, end };

    return { ok: isDateInRange(dateISO, start, end), start, end };
  }

  // âœ… السعر النهائي: إذا الموسم شغال -> استخدم seasonPrice إذا موجود، وإلا استخدم العادي
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
      return { price: season, label: "سعر موسم", usedSeason: true };
    }

    // âœ… إذا الموسم شغال لكن الخدمة ما لها سعر موسم: نرجع للعادي (هذا شرطك)
    return { price: base, label: seasonActive ? "سعر عادي (لا يوجد سعر موسم)" : "سعر عادي", usedSeason: false };
}

function isSequentialOfferItem(it: CartItem) {
  return (
    !!String((it as any)?.sequenceOfferId || "").trim() &&
    Array.isArray((it as any)?.sequenceStepsSnapshot) &&
    ((it as any)?.sequenceStepsSnapshot?.length || 0) > 0
  );
}

function findCartOverlap(items: CartItem[]) {
  const list = (items || []).map((x) => ({ ...x }));
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (isSequentialOfferItem(a) || isSequentialOfferItem(b)) continue;

        const empA = resolveEmployeeKey(a); // âœ… FIX
        const empB = resolveEmployeeKey(b); // âœ… FIX
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

        if (overlap) {
          return { ok: false as const, a, b };
        }
      }
    }
    return { ok: true as const, a: null as any, b: null as any };
  }

  // =========================
  // âœ… Use local hair guide image + role (owner/admin)
  // âœ… FIX: use onAuthStateChanged so role doesn't stay false
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

      // update settings
      const guideRef = doc(db, "salons", SALON_ID, "settings", "booking");
      await setDoc(guideRef, { hairGuideUrl: url }, { merge: true });

      setHairGuideUrl(url);

      openModal({
        title: "تم",
        message: "تم رفع صورة دليل أطوال الشعر وتحديثها.",
        variant: "success",
        confirmText: "تمام",
      });
    } catch (e: any) {
      openModal({
        title: "فشل الرفع",
        message: `صار خطأ أثناء رفع الصورة\n\ncode: ${String(e?.code || "-")}\nmessage: ${String(e?.message || "-")}`,
        variant: "danger",
        confirmText: "حسنًا",
      });
    } finally {
      setUploadingGuide(false);
    }
  }

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
        // fallback if no order index
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

        setCatalogMode("firestore");
        const safeSections = Array.isArray(secs) ? secs : [];
        setFsSections(safeSections);

        // Warm up section catalog cache in the background so section/category/service
        // dropdowns open faster when user starts picking.
        safeSections
          .map((s: any) => String(s?.id || "").trim())
          .filter(Boolean)
          .forEach((sid) => {
            void loadSectionCatalogFromFirestore(sid);
          });
      } catch {
        if (!cancelled) {
          setCatalogMode("firestore");
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
        setCategoryLoading(false);
        return;
      }

      if (String(selectedSectionId).trim() === PACKAGE_SECTION_ID) {
        setFsCategories([]);
        setFsServices([]);
        setCategoryLoading(false);
        return;
      }

      try {
        setCatalogLoading(true);
        setCategoryLoading(true);
        const payload = await loadSectionCatalogFromFirestore(String(selectedSectionId || "").trim());
        if (cancelled) return;
        setFsCategories(Array.isArray(payload.categories) ? payload.categories : []);
        setFsServices(Array.isArray(payload.services) ? payload.services : []);
      } catch {
        if (!cancelled) {
          setFsCategories([]);
          setFsServices([]);
          setCatalogMode("firestore");
          setCategoryLoading(false);
        }
      } finally {
        if (!cancelled) {
          setCatalogLoading(false);
          setCategoryLoading(false);
        }
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

    // لو ما فيه تصنيفات، فلتر بالقسم بس
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

    // لو فيه تصنيفات، تأكد إن الخدمة تتبع تصنيف داخل هذا القسم
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
  const HAIR_SECTION_IDS = new Set(["hair", "الشعر", "hair_section", "قص", "قص_شعر"]);

  const servicesFlat: FlatService[] = useMemo(() => {
    const packageRows: FlatService[] =
      catalogMode === "firestore"
        ? (fsPackages || []).map((pkg) => ({
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
          }))
        : [];

    if (catalogMode === "firestore" && fsSections.length > 0) {
      const secMap = new Map<string, string>();
      fsSections.forEach((s: any) =>
        secMap.set(String(s.id), readDisplayLabel(s, String(s.id || "")))
      );

      const catMap = new Map<string, string>();
      fsCategories.forEach((c: any) =>
        catMap.set(String(c.id), readDisplayLabel(c, String(c.id || "")))
      );

      const catById = new Map<string, any>();
      fsCategories.forEach((c: any) => catById.set(String(c.id), c));

      const hasCats = fsCategories.length > 0;

      const list = (selectedSectionId ? fsServicesFiltered : []).map((x: any) => {
        if (!hasCats) {
          const sectionId = String(x.sectionId || selectedSectionId || "").trim();
          const sectionTitle = secMap.get(sectionId) || sectionId || "-";

          const catName =
            readDisplayLabel(
              {
                category: x.category,
                categoryName: x.categoryName,
                ...(x as any),
              },
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
        const sectionTitle = secMap.get(sectionId) || sectionId || "-";

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

      return [...list, ...packageRows];
    }

    const out: FlatService[] = [];
    Object.entries(pricingSections).forEach(([sectionId, section]) => {
      const sectionTitle = String(section?.title || sectionId).trim();
      (section?.services || []).forEach((cat: any, catIdx: number) => {
        const catName = String(cat?.category || "").trim() || "عام";
        (cat?.items || []).forEach((it: any, itemIdx: number) => {
          const itemName = String(it?.name || "").trim();
          if (!itemName) return;

          const priceTextRaw = String(it?.price || "").trim();
          const basePrice = extractMinPrice(priceTextRaw);

          out.push({
            id: `${sectionId}-${catIdx}-${itemIdx}`,
            kind: "service" as const,
            sectionId,
            sectionTitle,
            categoryId: "",
            category: catName,
            name: `${catName} - ${itemName}`,
            priceText: priceTextRaw || `${basePrice} ريال`,
            basePrice,
            durationMin: DEFAULT_SERVICE_DURATION_MIN,
            source: "pricing" as const,
          });
        });
      });
    });

    return [...out, ...packageRows];
  }, [catalogMode, fsSections, fsCategories, fsServicesFiltered, selectedSectionId, fsPackages]);

  const sectionOptions = useMemo(() => {
    if (catalogMode === "firestore" && fsSections.length > 0) {
      const rows = fsSections.map((s: any) => ({
        id: String(s.id),
        title: readDisplayLabel(s, String(s?.id || "").trim()),
      }));
      if ((fsPackages || []).length > 0) {
        rows.push({ id: PACKAGE_SECTION_ID, title: PACKAGE_SECTION_TITLE });
      }
      return rows;
    }

    return Object.entries(pricingSections)
      .map(([id, sec]) => ({
        id: String(id || "").trim(),
        title: String(sec?.title || "").trim(),
      }))
      .filter((x) => x.id && x.title);
  }, [catalogMode, fsSections, fsPackages]);

  const sectionOptionsSafe = useMemo(() => {
    if (catalogMode === "firestore" && fsSections.length > 0) {
      const rows = fsSections
        .map((s: any) => ({
          id: String(s?.id || "").trim(),
          title: readDisplayLabel(s, String(s?.id || "").trim()),
        }))
        .filter((x) => x.id && x.title);
      return rows;
    }
    return sectionOptions.filter((x) => x.id && x.title && x.id !== PACKAGE_SECTION_ID);
  }, [catalogMode, fsSections, fsPackages, sectionOptions]);

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
            name: String((c as any)?.["الاسم"] ?? c.name ?? "").trim(),
          }))
          .filter((x) => x.id && x.name);

        // unique
        const seen = new Set<string>();
        return cats.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
      }

      // fallback if no categories but services have category field
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
      .filter((s) => String(s.sectionId || "").trim() === String(selectedSectionId || "").trim())
      .map((s) => ({ id: String(s.category || "").trim(), name: String(s.category || "").trim() }))
      .filter((x) => x.id && x.name);

    const seen = new Set<string>();
    return cats.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
  }, [catalogMode, fsSections.length, fsCategories, fsServices, servicesFlat, selectedSectionId]);

  const categoryOptionsSafe: CategoryOption[] = useMemo(() => {
    if (!selectedSectionId) return [];
    if (String(selectedSectionId).trim() === PACKAGE_SECTION_ID) return [];
    if (catalogMode === "firestore" && fsCategories.length > 0) {
      const sid = String(selectedSectionId).trim();
      const rows = fsCategories
        .filter((c: any) => String(c?.sectionId || "").trim() === sid)
        .map((c: any) => ({
          id: String(c?.id || "").trim(),
          name: readDisplayLabel(c, String(c?.id || "").trim()),
        }))
        .filter((x) => x.id && x.name);
      if (rows.length > 0) {
        const seen = new Set<string>();
        return rows.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
      }
    }
    return categoryOptions.filter((x) => x.id && x.name);
  }, [selectedSectionId, catalogMode, fsCategories, categoryOptions]);

  const sectionLabelById = useMemo(() => {
    const map = new Map<string, string>();
    (fsSections || []).forEach((s: any) => {
      const id = String(s?.id || "").trim();
      if (!id) return;
      const label = readDisplayLabel(s, id);
      if (label) map.set(id, label);
    });
    map.set(PACKAGE_SECTION_ID, PACKAGE_SECTION_TITLE);
    return map;
  }, [fsSections]);

  const categoryLabelById = useMemo(() => {
    const map = new Map<string, string>();
    (fsCategories || []).forEach((c: any) => {
      const id = String(c?.id || "").trim();
      if (!id) return;
      const label = readDisplayLabel(c, id);
      if (label) map.set(id, label);
    });
    return map;
  }, [fsCategories]);

  const packageOptions = useMemo(() => {
    const rows = servicesFlat
      .filter((s) => s.kind === "package")
      .map((s) => ({
        id: s.id,
        title: String(s.name || "").trim(),
        priceText: servicePickerPriceText(s),
      }))
      .filter((x) => x.id && x.title);
    const collator = new Intl.Collator("ar", { sensitivity: "base", numeric: true });
    return rows.sort((a, b) => collator.compare(a.title, b.title));
  }, [servicesFlat, bookingDate, appSettings]);

  useEffect(() => {
    const params = new URLSearchParams(location.search || "");
    const scope = String(params.get("scope") || "").trim();
    const pick = String(params.get("pick") || "").trim();
    const autoAdd = String(params.get("autoAdd") || "").trim() === "1";
    if (scope !== "offers_packages" || !pick) return;

    const isOfferPick = pick.startsWith("offer:");
    if (isOfferPick) {
      params.delete("scope");
      params.delete("pick");
      params.delete("autoAdd");
      const nextSearchSkip = params.toString();
      navigate(
        {
          pathname: location.pathname,
          search: nextSearchSkip ? `?${nextSearchSkip}` : "",
        },
        { replace: true }
      );
      return;
    }

    setPickerScope("offers_packages");
    setServicePicker(pick);
    setSelectedSectionId("");
    setSelectedCategory("");
    setShowHairGuide(false);
    setOfferStartTime("");

    const hasPackage = packageOptions.some((p) => String(p.id || "").trim() === pick);
    if (autoAdd && hasPackage) setAutoAddPackageId(pick);
    if (!hasPackage) {
      void (async () => {
        try {
          const snap = await getDoc(doc(db, "salons", SALON_ID, "service_packages", pick));
          if (!snap.exists()) return;
          const raw = snap.data() as any;
          setFsPackages((prev) => {
            if ((prev || []).some((x) => String((x as any)?.id || "").trim() === pick)) return prev;
            return [...(prev || []), ({ id: pick, ...(raw || {}) } as any)];
          });
          setCatalogMode("firestore");
          if (autoAdd) setAutoAddPackageId(pick);
        } catch {
          // no-op
        }
      })();
    }

    params.delete("scope");
    params.delete("pick");
    params.delete("autoAdd");
    const nextSearch = params.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : "",
      },
      { replace: true }
    );
  }, [location.pathname, location.search, navigate, packageOptions]);

  useEffect(() => {
    const params = new URLSearchParams(location.search || "");
    const coupon = String(params.get("coupon") || "").trim();
    const fromOffer = String(params.get("fromOffer") || "").trim() === "1";
    if (!coupon) return;

    setCouponCode(normalizeCouponCode(coupon));
    setOfferMsg("تم تعبئة كود الخصم تلقائيًا.");
    setOfferMsgKind("success");
    if (fromOffer) {
      setOfferLandingMsg("تم استخدام العرض، أكمل تعبئة بيانات الحجز لإتمام حجزك.");
    }
    setManualOverride(false);

    params.delete("coupon");
    params.delete("fromOffer");
    const nextSearch = params.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextSearch ? `?${nextSearch}` : "",
      },
      { replace: true }
    );
  }, [location.pathname, location.search, navigate]);

  const servicesInSection = useMemo(() => {
    if (!selectedSectionId) return [];

    const sid = String(selectedSectionId || "").trim();
    const sel = String(selectedCategory || "").trim();

    const all = servicesFlat.filter((s) => String(s.sectionId || "").trim() === sid);
    if (!sel) return all;

    if (catalogMode === "firestore") {
      const hasCats = fsCategories.length > 0;
      if (hasCats) {
        return all.filter((s) => String(s.categoryId || "").trim() === sel);
      }
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

  // âœ… عرض السعر في الـ dropdown حسب (طور الموسم/العادي) + تاريخ الحجز المختار
  function servicePickerPriceText(sv: FlatService) {
    const dateISO = String(bookingDate || "").trim();
    if (!dateISO) return sv.priceText; // احتياط

    const eff = pickEffectivePrice({
      basePrice: Number(sv.basePrice || 0),
      seasonPrice: Number((sv as any).seasonPrice || 0) || undefined,
      appSettings,
      dateISO,
    });

    const price = Number(eff.price || 0);
    return `${price} ريال`;
  }


  const isHairSection = useMemo(() => {
    const id = String(selectedSectionId || "").trim().toLowerCase();
    if (HAIR_SECTION_IDS.has(id)) return true;

    const sec = sectionOptionsSafe.find((s) => String(s.id) === String(selectedSectionId));
    const title = String(sec?.title || "").toLowerCase();

    return (
      title.includes("شعر") ||
      title.includes("hair") ||
      title.includes("صبغ") ||
      title.includes("استشوار") ||
      title.includes("تساريح")
    );
  }, [selectedSectionId, sectionOptionsSafe]);

  const getServiceById = (id: string) => {
    return servicesFlat.find((sv) => sv.id === id) || null;
  };

  const normalizeSpecialty = (v: string) => String(v || "").trim().toLowerCase();

  const normalizeStaffSpecialties = (st: any) =>
    Array.isArray(st?.specialties)
      ? st.specialties.map((x: any) => normalizeSpecialty(String(x || ""))).filter(Boolean)
      : [];

  const buildStaffResolverKey = (serviceId: string, target: FlatService | null) => {
    const sid = normalizeSpecialty(serviceId);
    if (target?.kind === "package") {
      const keys = Array.from(
        new Set(
          [
            ...(target.packageServiceIds || []),
            ...((target.packageServices || []).map((x: any) => String(x?.serviceId || "").trim())),
          ]
            .map((x) => normalizeSpecialty(String(x || "")))
            .filter(Boolean)
        )
      ).sort();
      return keys.length ? `pkg:${keys.join("|")}` : `pkg:${sid}`;
    }
    return `srv:${sid}`;
  };

  const getAllActiveStaffCached = async () => {
    if (Array.isArray(staffAllCacheRef.current)) return staffAllCacheRef.current;
    const all = await listActiveStaffAll(SALON_ID);
    staffAllCacheRef.current = Array.isArray(all) ? all : [];
    return staffAllCacheRef.current;
  };

  const listStaffForService = async (serviceId: string, service?: FlatService | null) => {
    const sid = String(serviceId || "").trim();
    if (!sid) return [] as StaffPublicWithId[];

    const target = service || getServiceById(sid);
    const resolverKey = buildStaffResolverKey(sid, target);
    const cached = staffByResolverCacheRef.current[resolverKey];
    if (Array.isArray(cached)) return cached;

    const inFlight = staffByResolverInFlightRef.current[resolverKey];
    if (inFlight) return inFlight;

    const wanted = new Set<string>();
    wanted.add(normalizeSpecialty(sid));
    wanted.add(normalizeSpecialty(String(target?.sectionId || "")));
    wanted.add(normalizeSpecialty(String(target?.categoryId || "")));

    if (target?.kind === "package") {
      (target.packageServiceIds || []).forEach((x: any) => wanted.add(normalizeSpecialty(String(x || ""))));
      (target.packageServices || []).forEach((x: any) => {
        wanted.add(normalizeSpecialty(String(x?.serviceId || "")));
        wanted.add(normalizeSpecialty(String(x?.sectionId || "")));
        wanted.add(normalizeSpecialty(String(x?.categoryId || "")));
      });
    }

    const wantedKeys = Array.from(wanted).filter(Boolean);
    if (!wantedKeys.length) return [] as StaffPublicWithId[];

    const loadPromise: Promise<StaffPublicWithId[]> = (async () => {
      const all = await getAllActiveStaffCached();
      const matchesAny = (all || []).filter((st: any) => {
        const specs = normalizeStaffSpecialties(st);
        return wantedKeys.some((k) => specs.includes(k));
      });

      // للبكجات: جرّب المطابقة الصارمة أولاً (كل serviceId)، وإذا ما فيه نتائج ارجع لأي تطابق.
      if (target?.kind === "package") {
        const strictIds = Array.from(
          new Set((target.packageServiceIds || []).map((x: any) => normalizeSpecialty(String(x || ""))).filter(Boolean))
        );
        if (strictIds.length) {
          const strict = (all || []).filter((st: any) => {
            const specs = normalizeStaffSpecialties(st);
            return strictIds.every((id) => specs.includes(id));
          });
          if (strict.length) return strict;
        }
      }

      return matchesAny;
    })();

    staffByResolverInFlightRef.current[resolverKey] = loadPromise;
    try {
      const rows = await loadPromise;
      staffByResolverCacheRef.current[resolverKey] = rows;
      return rows;
    } finally {
      delete staffByResolverInFlightRef.current[resolverKey];
    }
  };

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

  function canEditByLockedPrev(items: CartItem[], itemId: string) {
    const list = items || [];
    const idx = list.findIndex((x) => x.id === itemId);
    if (idx < 0) return false;
    if (idx === 0) return true;
    return !!list[idx - 1]?.locked;
  }

  // =========================
  // Cart actions
  // =========================
  const buildSequenceStepsSnapshot = async (offerIdRaw: string) => {
    const offerId = String(offerIdRaw || "").trim();
    const offer = (sequenceOffers || []).find((o: any) => String((o as any)?.id || "").trim() === offerId);
    if (!offer) return { offer: null as any, steps: [] as CartItem["sequenceStepsSnapshot"] };

    const rawSteps = (Array.isArray((offer as any)?.sequenceSteps) ? (offer as any).sequenceSteps : [])
      .map((x: any) => ({
        serviceId: String(x?.serviceId || "").trim(),
        orderIndex: Number(x?.orderIndex || 0),
        gapAfterMin: Math.max(0, Number(x?.gapAfterMin || 0)),
        titleSnapshot: String(x?.titleSnapshot || "").trim() || undefined,
      }))
      .filter((x: any) => x.serviceId)
      .sort((a: any, b: any) => Number(a.orderIndex || 0) - Number(b.orderIndex || 0));

    const byIdCache = new Map<string, any>();
    const steps: NonNullable<CartItem["sequenceStepsSnapshot"]> = [];
    for (const step of rawSteps) {
      const serviceId = String(step.serviceId || "").trim();
      let sv = servicesFlat.find((s) => s.kind === "service" && String(s.id || "").trim() === serviceId) as any;
      if (!sv && !byIdCache.has(serviceId)) {
        try {
          const snap = await getDoc(doc(db, "salons", SALON_ID, "services", serviceId));
          if (snap.exists()) {
            const d: any = snap.data() || {};
            byIdCache.set(serviceId, {
              id: serviceId,
              name: readDisplayLabel(d, serviceId),
              basePrice: Number((d as any)?.price ?? (d as any)?.["السعر"] ?? 0),
              seasonPrice:
                Number(String((d as any)?.seasonPrice ?? (d as any)?.["سعر_الموسم"] ?? 0).replace(/[^\d.]/g, "")) || 0,
              durationMin: Number((d as any)?.durationMin ?? (d as any)?.["المدة"] ?? DEFAULT_SERVICE_DURATION_MIN),
              sectionId: String((d as any)?.sectionId || "").trim() || undefined,
            });
          } else {
            byIdCache.set(serviceId, null);
          }
        } catch {
          byIdCache.set(serviceId, null);
        }
      }
      const fetched = byIdCache.get(serviceId);
      const serviceName = String(step.titleSnapshot || sv?.name || fetched?.name || serviceId).trim();
      const basePriceRaw = Number(sv?.basePrice ?? fetched?.basePrice ?? 0);
      const seasonPriceRaw = Number((sv as any)?.seasonPrice ?? fetched?.seasonPrice ?? 0);
      const eff = pickEffectivePrice({
        basePrice: Math.max(0, basePriceRaw),
        seasonPrice: seasonPriceRaw > 0 ? seasonPriceRaw : undefined,
        appSettings,
        dateISO: String(bookingDate || "").trim() || todayISO(),
      });
      const durationAtBooking = Math.max(
        1,
        Number(sv?.durationMin ?? fetched?.durationMin ?? DEFAULT_SERVICE_DURATION_MIN)
      );
      steps.push({
        serviceId,
        orderIndex: Number(step.orderIndex || 0),
        gapAfterMin: Math.max(0, Number(step.gapAfterMin || 0)),
        titleSnapshot: step.titleSnapshot,
        serviceNameAtBooking: serviceName,
        priceAtBooking: Number(eff.price || 0),
        durationAtBooking,
        sectionIdAtBooking: String(sv?.sectionId || fetched?.sectionId || "").trim() || undefined,
      });
    }

    return { offer, steps };
  };

  const planSequentialOffer = async (args: {
    item: CartItem;
    startTime: string;
    dateISO: string;
    items: CartItem[];
  }) => {
    const { item, startTime, dateISO, items } = args;
    const seqSteps = (Array.isArray(item.sequenceStepsSnapshot) ? item.sequenceStepsSnapshot : [])
      .map((s) => ({
        serviceId: String(s?.serviceId || "").trim(),
        orderIndex: Number(s?.orderIndex || 0),
        gapAfterMin: Math.max(0, Number(s?.gapAfterMin || 0)),
        titleSnapshot: String(s?.titleSnapshot || "").trim() || undefined,
        serviceNameAtBooking: String(s?.serviceNameAtBooking || "").trim() || "خدمة",
        priceAtBooking: Math.max(0, Number(s?.priceAtBooking || 0)),
        durationAtBooking: Math.max(1, Number(s?.durationAtBooking || DEFAULT_SERVICE_DURATION_MIN)),
        sectionIdAtBooking: String(s?.sectionIdAtBooking || "").trim() || undefined,
      }))
      .filter((s) => s.serviceId)
      .sort((a, b) => Number(a.orderIndex || 0) - Number(b.orderIndex || 0));

    if (!seqSteps.length) return { ok: false as const, reason: "SEQUENCE_EMPTY" };

    const baseSlots =
      timeSlots.length > 0
        ? timeSlots
        : generateSalonTimeSlots(openTime, closeTime, slotStepMin);
    const slotOrder = new Map<string, number>();
    baseSlots.forEach((s, idx) => slotOrder.set(String(s.value24 || "").trim(), idx));

    const startSlotIdx = slotOrder.get(String(startTime || "").trim());
    if (startSlotIdx === undefined) return { ok: false as const, reason: "START_OUT_OF_HOURS" };

    const localLocks = new Map<string, Set<string>>();
    const resolvedSteps: Array<{
      serviceId: string;
      orderIndex: number;
      gapAfterMin: number;
      titleSnapshot?: string;
      serviceNameAtBooking: string;
      priceAtBooking: number;
      durationAtBooking: number;
      sectionIdAtBooking?: string;
      employeeId: string;
      employeeUid: string;
      employeeName: string;
      startAt: string;
      endAt: string;
    }> = [];

    let chainStartMin = toMinutes(String(startTime || "").trim());
    if (!Number.isFinite(chainStartMin)) {
      return { ok: false as const, reason: "START_INVALID" };
    }

    for (let idx = 0; idx < seqSteps.length; idx++) {
      const step = seqSteps[idx];
      const startAt = minutesToTime24(roundUpToStep(chainStartMin, slotStepMin));
      if (!slotOrder.has(startAt)) {
        return { ok: false as const, reason: "STEP_OUT_OF_HOURS", failedIndex: idx };
      }

      const sv = getServiceById(step.serviceId);
      const staffRaw = await listStaffForService(step.serviceId, sv);
      const staffList = (staffRaw || []).filter((st: any) =>
        isStaffAvailableForDate(st, dateISO, { requireShowOnBooking: true })
      );
      if (!staffList.length) {
        return { ok: false as const, reason: "NO_STAFF", failedIndex: idx };
      }

      let chosen: StaffPublicWithId | null = null;
      let chosenLocks: string[] = [];

      for (const st of staffList) {
        const empId = String((st as any)?.id || "").trim();
        if (!empId) continue;
        const empUid = String((st as any)?.linkedUid || "").trim();
        const empKey = empUid || empId;
        const neededLocks = getTimesToLock(
          baseSlots,
          slotStepMin,
          startAt,
          Number(step.durationAtBooking || DEFAULT_SERVICE_DURATION_MIN),
          bufferMin
        );

        const takenFs = await collectTakenTimesForEmployeeDay({
          salonId: SALON_ID,
          employeeKey: empKey,
          employeeIdFallback: empId,
          dateISO,
        });

        const takenCart = new Set<string>();
        (items || []).forEach((it) => {
          if (String(it.id || "").trim() === String(item.id || "").trim()) return;
          if (String(it.date || "").trim() !== dateISO) return;
          if (!String(it.time || "").trim()) return;
          const otherEmpId = String(it.employeeId || "").trim();
          const otherEmpKey = resolveEmployeeKey(it);
          if (!otherEmpId && !otherEmpKey) return;
          const sameEmp = otherEmpId === empId || (otherEmpKey && otherEmpKey === empKey);
          if (!sameEmp) return;
          const otherLocks = getTimesToLock(
            baseSlots,
            slotStepMin,
            String(it.time || "").trim(),
            Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN),
            bufferMin
          );
          otherLocks.forEach((t) => takenCart.add(String(t || "").trim()));
        });

        const takenLocal = localLocks.get(empKey) || new Set<string>();
        const occupied = new Set<string>([...Array.from(takenFs), ...Array.from(takenCart), ...Array.from(takenLocal)]);
        const free = neededLocks.every((t) => !occupied.has(String(t || "").trim()));
        if (!free) continue;

        chosen = st;
        chosenLocks = neededLocks;
        localLocks.set(empKey, new Set<string>([...Array.from(takenLocal), ...neededLocks]));
        break;
      }

      if (!chosen) {
        return { ok: false as const, reason: "STEP_CONFLICT", failedIndex: idx };
      }

      const durationMinSafe = Math.max(1, Number(step.durationAtBooking || DEFAULT_SERVICE_DURATION_MIN));
      const stepEndRaw = toMinutes(startAt) + durationMinSafe;
      const endAt = minutesToTime24(roundUpToStep(stepEndRaw, slotStepMin));
      resolvedSteps.push({
        ...step,
        employeeId: String((chosen as any)?.id || "").trim(),
        employeeUid: String((chosen as any)?.linkedUid || "").trim(),
        employeeName: String((chosen as any)?.name || "").trim() || "-",
        startAt,
        endAt,
      });

      const gapAfter = idx < seqSteps.length - 1 ? Math.max(0, Number(step.gapAfterMin || 0)) : 0;
      chainStartMin = stepEndRaw + gapAfter;
    }

    if (!resolvedSteps.length) return { ok: false as const, reason: "SEQUENCE_EMPTY" };
    return {
      ok: true as const,
      steps: resolvedSteps,
      sequenceStart: resolvedSteps[0].startAt,
      sequenceEnd: resolvedSteps[resolvedSteps.length - 1].endAt,
    };
  };

  const findNearestSequentialStart = async (args: {
    item: CartItem;
    dateISO: string;
    preferredStart: string;
    items: CartItem[];
  }) => {
    const { item, dateISO, preferredStart, items } = args;
    const baseSlots =
      timeSlots.length > 0
        ? timeSlots
        : generateSalonTimeSlots(openTime, closeTime, slotStepMin);
    const sorted = baseSlots.map((s) => String(s.value24 || "").trim()).filter(Boolean);
    const startIdx = Math.max(0, sorted.indexOf(String(preferredStart || "").trim()));
    for (let i = startIdx; i < sorted.length; i++) {
      const t = sorted[i];
      const plan = await planSequentialOffer({ item, startTime: t, dateISO, items });
      if (plan.ok) return { time: t, plan };
    }
    return null;
  };

  const addServiceToCart = async (idRaw: string) => {
    const id = String(idRaw || "").trim();
    if (!id) return;

    if (id.startsWith("offer:")) {
      const offerId = id.slice("offer:".length).trim();
      const startTime = String(offerStartTime || "").trim();
      if (!startTime) {
        openModal({
          title: "اختاري وقت البداية",
          message: "لازم تختاري وقت بداية العرض التسلسلي قبل الإضافة.",
          variant: "danger",
        });
        return;
      }
      const built = await buildSequenceStepsSnapshot(offerId);
      const builtSteps = Array.isArray(built.steps) ? built.steps : [];
      if (!built.offer || !builtSteps.length) {
        openModal({
          title: "تعذر تحميل العرض",
          message: "تعذر تحميل خطوات العرض التسلسلي من لوحة العروض.",
          variant: "danger",
        });
        return;
      }

      const sorted = [...builtSteps].sort((a, b) => a.orderIndex - b.orderIndex);
      const totalDuration = sorted.reduce((sum, s, idx) => {
        const gap = idx < sorted.length - 1 ? Math.max(0, Number(s.gapAfterMin || 0)) : 0;
        return sum + Math.max(0, Number(s.durationAtBooking || 0)) + gap;
      }, 0);
      const summedStepsPrice = sorted.reduce((sum, s) => sum + Math.max(0, Number(s.priceAtBooking || 0)), 0);
      const configuredFinalPrice = Math.max(0, Number((built.offer as any)?.packageFinalPrice || 0));
      const totalPrice = configuredFinalPrice > 0 ? configuredFinalPrice : summedStepsPrice;

      setFormData((prev) => ({
        ...prev,
        items: [
          ...(prev.items || []),
          {
            id: makeLocalId(),
            serviceId: id,
            serviceName: String((built.offer as any)?.title || "عرض تسلسلي").trim(),
            basePrice: Number(totalPrice || 0),
            priceText: `${Math.round(Number(totalPrice || 0))} ريال`,
            durationMin: Math.max(1, Number(totalDuration || DEFAULT_SERVICE_DURATION_MIN)),
            employeeId: "__AUTO_SEQ__",
            employeeUid: "",
            employeeName: "تعيين تلقائي",
            date: bookingDate,
            time: startTime,
            locked: true,
            serviceSectionId: "offers",
            serviceSectionTitle: "العروض و البكجات",
            serviceCategoryId: "sequential_offer",
            serviceCategoryName: "عرض تسلسلي",
            sequenceOfferId: offerId,
            sequenceOfferTitle: String((built.offer as any)?.title || "عرض تسلسلي").trim(),
            sequenceStepsSnapshot: sorted,
          },
        ],
      }));

      setServicePicker("");
      setOfferStartTime("");
      clearAppliedCoupons();
      return;
    }

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
        const sectionTitle = String(
          serviceDoc?.sectionTitle ||
            sectionLabelById.get(sectionId) ||
            sectionId
        ).trim();
        const categoryId = String((row.meta as any)?.categoryId || serviceDoc?.categoryId || "").trim();
        const categoryName = String(
          serviceDoc?.category ||
            categoryLabelById.get(categoryId) ||
            categoryId
        ).trim();
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
      setShowHairGuide(false);
      setOfferStartTime("");
      clearAppliedCoupons();
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
          toolsSource,
          toolsFeeApplied: priced.toolsFeeApplied,
        },
      ],
    }));

    setServicePicker("");
    setSelectedCategory("");
    setSelectedSectionId("");
    setShowHairGuide(false);

    clearAppliedCoupons();
  };

  const removeServiceFromCart = (itemId: string) => {
    let removedIds = new Set<string>([String(itemId || "").trim()]);
    let removedPackageRunId = "";

    setFormData((prev) => {
      const list = prev.items || [];
      const target = list.find((it) => String(it.id || "").trim() === String(itemId || "").trim());
      const runId = String(target?.packageRunId || "").trim();
      removedPackageRunId = runId;
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

    if (removedPackageRunId) {
      setPackageQuickByRun((prev) => {
        const next = { ...prev };
        delete next[removedPackageRunId];
        return next;
      });
    }

    clearAppliedCoupons();
  };

  useEffect(() => {
    const pid = String(autoAddPackageId || "").trim();
    if (!pid) return;
    const hasPackage = packageOptions.some((p) => String(p.id || "").trim() === pid);
    if (!hasPackage) return;
    const alreadyInCart = (formData.items || []).some(
      (it) => String(it?.serviceId || "").trim() === pid
    );
    if (!alreadyInCart) {
      void addServiceToCart(pid);
    }
    setAutoAddPackageId("");
  }, [autoAddPackageId, packageOptions, formData.items, addServiceToCart]);

  const updateItem = (itemId: string, patch: Partial<CartItem>) => {
    setFormData((prev) => {
      const list = prev.items || [];
      const idx = list.findIndex((x) => x.id === itemId);
      if (idx < 0) return prev;

      const nextItems = list.map((it, i) => {
        if (i === idx) return { ...it, ...patch };

        // لو غيّرنا (موظفة/تاريخ/وقت) في كرت، نصفر اللي بعده عشان التوفر يتغير
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

    // لو غيّر خدمة أو موظفة أو تاريخ، نصفر الكوبون (لأنه قد لا ينطبق)
    if (patch.serviceId || patch.employeeId || patch.date || patch.time) {
      if (!couponCode.trim()) {
        setManualOverride(false);
      }
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
            .filter((it) => !isSequentialOfferItem(it))
            .map((it) => String(it.serviceId || "").trim())
            .filter(Boolean)
        )
      );

      if (!serviceIds.length) return;

      for (const sid of serviceIds) {
        if (cancelled) return;
        if (staffByService[sid] && Array.isArray(staffByService[sid])) continue;
        const fromCart = (formData.items || []).find((x) => String(x.serviceId || "").trim() === sid);
        const sv =
          getServiceById(sid) ||
          ({
            id: sid,
            kind: "service",
            sectionId: String(fromCart?.serviceSectionId || "").trim(),
            sectionTitle: String(fromCart?.serviceSectionTitle || "").trim(),
            categoryId: String(fromCart?.serviceCategoryId || "").trim() || undefined,
            category: String(fromCart?.serviceCategoryName || "").trim(),
            name: String(fromCart?.serviceName || sid).trim(),
            priceText: String(fromCart?.priceText || "").trim(),
            basePrice: Number(fromCart?.basePrice || 0),
            durationMin: Number(fromCart?.durationMin || DEFAULT_SERVICE_DURATION_MIN),
            source: "firestore",
          } as FlatService);
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

          // تصفية إضافية: تأكد إن الموظفة فعلاً عندها هذي التخصص (Firestore قد يرجع الكل أحياناً)
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

  // âœ… تحميل موظفات الخدمة المختارة في الـ picker (حتى قبل الإضافة للسلة)
  useEffect(() => {
    let cancelled = false;

    async function loadStaffForFuturePicker() {
      const sid = String(futureServiceId || servicePicker || "").trim();
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
      } catch (e: any) {
        if (cancelled) return;
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

    loadStaffForFuturePicker();
    return () => {
      cancelled = true;
    };
  }, [futureServiceId, servicePicker, staffByService]);

  const futureStaffOptions = useMemo(() => {
    const sid = String(futureServiceId || servicePicker || "").trim();
    if (!sid) return [] as { key: string; name: string; id: string }[];

    return ((staffByService[sid] || []) as StaffPublicWithId[])
      .map((st: any) => {
        const key = String(st?.linkedUid || st?.id || "").trim();
        const id = String(st?.id || "").trim();
        const name = String(st?.name || "").trim();
        if (!key || !name) return null;
        return { key, id, name };
      })
      .filter(Boolean) as { key: string; name: string; id: string }[];
  }, [servicePicker, staffByService]);

  const filteredFutureStaffOptions = useMemo(() => {
    const q = String(futureStaffNameQuery || "").trim().toLowerCase();
    if (!q) return futureStaffOptions;
    return futureStaffOptions.filter((x) =>
      String(x.name || "").toLowerCase().includes(q)
    );
  }, [futureStaffOptions, futureStaffNameQuery]);

  const packageRunMetaByRun = useMemo(() => {
    const byRun: Record<string, PackageRunMeta> = {};
    const grouped = new Map<string, CartItem[]>();
    (formData.items || []).forEach((it) => {
      const runId = String(it.packageRunId || "").trim();
      if (!runId || isSequentialOfferItem(it)) return;
      const arr = grouped.get(runId) || [];
      arr.push(it);
      grouped.set(runId, arr);
    });

    grouped.forEach((items, runId) => {
      const ordered = [...items];
      const dateISO = String(ordered[0]?.date || bookingDate || "").trim();
      const totalDurationMin = ordered.reduce(
        (sum, x) => sum + Math.max(1, Number(x.durationMin || DEFAULT_SERVICE_DURATION_MIN)),
        0
      );
      const totalWindowMin = ordered.reduce(
        (sum, x) => sum + Math.max(1, Number(x.durationMin || DEFAULT_SERVICE_DURATION_MIN)) + Math.max(0, bufferMin),
        0
      );

      let loading = false;
      const errors = new Set<string>();
      const perService: StaffPublicWithId[][] = [];
      let hasStrictCoverageForAll = true;

      ordered.forEach((x) => {
        const sid = String(x.serviceId || "").trim();
        if (!sid) return;
        if (!Object.prototype.hasOwnProperty.call(staffByService, sid) || staffLoadingByService[sid]) {
          loading = true;
        }
        const err = String(staffErrorByService[sid] || "").trim();
        if (err) errors.add(err);

        const list = ((staffByService[sid] || []) as StaffPublicWithId[]).filter((st: any) => {
          if ((st as any)?.showOnBooking === false) return false;
          const leave = getStaffLeaveMetaForDate(st, dateISO);
          return !leave.isOnLeave;
        });
        const strictByService = list.filter((st: any) => {
          const specs = Array.isArray((st as any)?.specialties)
            ? (st as any).specialties.map((v: any) => normalizeSpecialty(String(v || ""))).filter(Boolean)
            : [];
          return specs.includes(normalizeSpecialty(sid));
        });
        if (!strictByService.length) hasStrictCoverageForAll = false;
        perService.push(strictByService);
      });

      const first = perService[0] || [];
      const firstById = new Map<string, StaffPublicWithId>();
      first.forEach((st: any) => {
        const id = String(st?.id || "").trim();
        if (id) firstById.set(id, st);
      });

      const commonIds = new Set<string>(Array.from(firstById.keys()));
      perService.slice(1).forEach((list) => {
        const ids = new Set(
          (list || [])
            .map((st: any) => String(st?.id || "").trim())
            .filter(Boolean)
        );
        Array.from(commonIds).forEach((id) => {
          if (!ids.has(id)) commonIds.delete(id);
        });
      });

      const commonStaff = (hasStrictCoverageForAll ? Array.from(commonIds) : [])
        .map((id) => firstById.get(id))
        .filter(Boolean) as StaffPublicWithId[];

      byRun[runId] = {
        runId,
        leaderItemId: String(ordered[0]?.id || "").trim(),
        items: ordered,
        dateISO,
        totalDurationMin,
        totalWindowMin,
        commonStaff,
        loading,
        staffError: Array.from(errors).join(" | "),
      };
    });

    return byRun;
  }, [formData.items, staffByService, staffLoadingByService, staffErrorByService, bookingDate, bufferMin]);

  useEffect(() => {
    let cancelled = false;

    async function resolvePackageQuickEligibility() {
      const grouped = new Map<string, CartItem[]>();
      (formData.items || []).forEach((it) => {
        const runId = String(it.packageRunId || "").trim();
        if (!runId || isSequentialOfferItem(it)) return;
        const arr = grouped.get(runId) || [];
        arr.push(it);
        grouped.set(runId, arr);
      });

      const runIds = Array.from(grouped.keys());
      if (!runIds.length) {
        setPackageQuickEligibilityByRun({});
        return;
      }

      setPackageQuickEligibilityByRun((prev) => {
        const next: Record<string, PackageQuickEligibility> = {};
        runIds.forEach((rid) => {
          next[rid] = prev[rid] || { loading: true, commonStaff: [] };
          next[rid].loading = true;
        });
        return next;
      });

      const resolved: Record<string, PackageQuickEligibility> = {};
      for (const runId of runIds) {
        const items = grouped.get(runId) || [];
        const ordered = [...items];
        const dateISO = String(ordered[0]?.date || bookingDate || "").trim();
        const serviceIds = Array.from(
          new Set(
            ordered
              .map((x) => String(x.serviceId || "").trim())
              .filter(Boolean)
          )
        );

        if (serviceIds.length < 2) {
          resolved[runId] = { loading: false, commonStaff: [] };
          continue;
        }

        const perService: StaffPublicWithId[][] = [];
        for (const sid of serviceIds) {
          try {
            const rows = await listStaffForService(sid, getServiceById(sid));
            const filtered = (rows || []).filter((st: any) => {
              if ((st as any)?.showOnBooking === false) return false;
              if (!String((st as any)?.name || "").trim()) return false;
              const leave = getStaffLeaveMetaForDate(st, dateISO);
              return !leave.isOnLeave;
            });
            perService.push(filtered);
          } catch {
            perService.push([]);
          }
        }

        const first = perService[0] || [];
        const firstById = new Map<string, StaffPublicWithId>();
        first.forEach((st: any) => {
          const id = String(st?.id || "").trim();
          if (id) firstById.set(id, st);
        });

        const commonIds = new Set<string>(Array.from(firstById.keys()));
        perService.slice(1).forEach((list) => {
          const ids = new Set(
            (list || [])
              .map((st: any) => String(st?.id || "").trim())
              .filter(Boolean)
          );
          Array.from(commonIds).forEach((id) => {
            if (!ids.has(id)) commonIds.delete(id);
          });
        });

        const commonStaff = Array.from(commonIds)
          .map((id) => firstById.get(id))
          .filter(Boolean) as StaffPublicWithId[];

        resolved[runId] = { loading: false, commonStaff };
      }

      if (!cancelled) {
        setPackageQuickEligibilityByRun(resolved);
      }
    }

    void resolvePackageQuickEligibility();
    return () => {
      cancelled = true;
    };
  }, [formData.items, bookingDate]);

  const collectLocalTakenOutsidePackageRun = (args: {
    runId: string;
    employeeKey: string;
    employeeIdFallback: string;
    dateISO: string;
    baseSlots: TimeSlot[];
  }) => {
    const { runId, employeeKey, employeeIdFallback, dateISO, baseSlots } = args;
    const taken = new Set<string>();
    const targetKey = String(employeeKey || "").trim();
    const targetEmployeeId = String(employeeIdFallback || "").trim();

    (formData.items || []).forEach((other) => {
      if (!other) return;
      if (String(other.packageRunId || "").trim() === runId) return;

      const otherDate = String(other.date || "").trim();
      const otherTime = String(other.time || "").trim();
      if (!otherDate || !otherTime || otherDate !== dateISO) return;

      const otherKey = resolveEmployeeKey(other);
      const otherEmployeeId = String(other.employeeId || "").trim();
      if (!otherKey && !otherEmployeeId) return;

      const sameByKey = !!targetKey && otherKey === targetKey;
      const sameByEmployeeId = !!targetEmployeeId && otherEmployeeId === targetEmployeeId;
      const crossKeyMatch =
        (!!targetEmployeeId && otherKey === targetEmployeeId) ||
        (!!targetKey && otherEmployeeId === targetKey);
      if (!sameByKey && !sameByEmployeeId && !crossKeyMatch) return;

      const otherLocks = getTimesToLock(
        baseSlots,
        slotStepMin,
        otherTime,
        Number(other.durationMin || DEFAULT_SERVICE_DURATION_MIN),
        bufferMin
      );
      otherLocks.forEach((t) => taken.add(String(t || "").trim()));
    });

    return taken;
  };

  const buildPackageRunPlan = (args: {
    runItems: CartItem[];
    startTime24: string;
    baseSlots: TimeSlot[];
    takenBase: Set<string>;
  }) => {
    const { runItems, startTime24, baseSlots, takenBase } = args;
    const ordered = [...runItems];
    const slotOrder = new Map<string, number>();
    baseSlots.forEach((s, idx) => slotOrder.set(String(s.value24 || "").trim(), idx));

    let cursor = String(startTime24 || "").trim();
    const occupied = new Set<string>(takenBase);
    const plan = new Map<string, string>();
    for (const it of ordered) {
      const itemId = String(it.id || "").trim();
      if (!itemId || !slotOrder.has(cursor)) {
        return { ok: false as const, plan: new Map<string, string>() };
      }
      const durationMin = Math.max(1, Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN));
      const needed = getTimesToLock(baseSlots, slotStepMin, cursor, durationMin, bufferMin);
      const expectedCount = Math.max(
        1,
        Math.ceil((durationMin + Math.max(0, bufferMin)) / Math.max(1, slotStepMin))
      );
      if (needed.length < expectedCount) {
        return { ok: false as const, plan: new Map<string, string>() };
      }
      const conflict = needed.some((t) => occupied.has(String(t || "").trim()));
      if (conflict) return { ok: false as const, plan: new Map<string, string>() };

      plan.set(itemId, cursor);
      needed.forEach((t) => occupied.add(String(t || "").trim()));

      const nextRaw = toMinutes(cursor) + durationMin + Math.max(0, bufferMin);
      cursor = minutesToTime24(roundUpToStep(nextRaw, slotStepMin));
    }
    return { ok: true as const, plan };
  };

  const loadPackageQuickStarts = async (runIdRaw: string, employeeIdRaw: string) => {
    const runId = String(runIdRaw || "").trim();
    const employeeId = String(employeeIdRaw || "").trim();
    if (!runId || !employeeId) return;
    const runMeta = packageRunMetaByRun[runId];
    if (!runMeta || !runMeta.items.length) return;
    const quickCommonStaff = packageQuickEligibilityByRun[runId]?.commonStaff || [];
    if (!quickCommonStaff.length) return;

    const dateISO = String(runMeta.dateISO || bookingDate || "").trim();
    const selectedStaff = quickCommonStaff.find(
      (st: any) => String(st?.id || "").trim() === employeeId
    );
    if (!selectedStaff || !dateISO) return;

    const employeeKey =
      String((selectedStaff as any)?.linkedUid || "").trim() ||
      String((selectedStaff as any)?.id || "").trim();
    const employeeIdFallback = String((selectedStaff as any)?.id || "").trim();
    const dayCfg = getDaySettingsForDate(dateISO);
    const dayOpenTime = safeTimeHHMM(dayCfg.openTime, openTime);
    const dayCloseTime = safeTimeHHMM(dayCfg.closeTime, closeTime);
    const baseSlots = generateSalonTimeSlots(dayOpenTime, dayCloseTime, slotStepMin);
    if (!baseSlots.length) return;

    setPackageQuickByRun((prev) => ({
      ...prev,
      [runId]: { employeeId, times: [], loading: true, error: "" },
    }));

    try {
      const takenFs = await collectTakenTimesForEmployeeDay({
        salonId: SALON_ID,
        employeeKey,
        employeeIdFallback,
        dateISO,
      });
      const takenLocal = collectLocalTakenOutsidePackageRun({
        runId,
        employeeKey,
        employeeIdFallback,
        dateISO,
        baseSlots,
      });
      const takenBase = new Set<string>([...Array.from(takenFs), ...Array.from(takenLocal)]);
      const startsBase = filterSlotsByServiceEnd(
        baseSlots,
        dayCloseTime,
        Math.max(1, Number(runMeta.totalWindowMin || runMeta.totalDurationMin || DEFAULT_SERVICE_DURATION_MIN)),
        0,
        ALLOW_OVERTIME_MIN
      );
      const starts = sortTimesBySlotOrder(
        startsBase
          .map((s) => String(s.value24 || "").trim())
          .filter(Boolean)
          .filter((start) => {
            const simulated = buildPackageRunPlan({
              runItems: runMeta.items,
              startTime24: start,
              baseSlots,
              takenBase,
            });
            return simulated.ok;
          }),
        baseSlots
      ).slice(0, 48);

      setPackageQuickByRun((prev) => ({
        ...prev,
        [runId]: {
          employeeId,
          times: starts,
          loading: false,
          error: starts.length ? "" : "لا توجد أوقات متاحة لهذه الموظفة لكامل مدة البكج.",
        },
      }));
    } catch (e: any) {
      setPackageQuickByRun((prev) => ({
        ...prev,
        [runId]: {
          employeeId,
          times: [],
          loading: false,
          error: `تعذر تحميل الأوقات: ${String(e?.message || e || "خطأ غير معروف")}`,
        },
      }));
    }
  };

  const applyPackageQuickSelection = async (
    runIdRaw: string,
    employeeIdRaw: string,
    startTime24Raw: string
  ) => {
    const runId = String(runIdRaw || "").trim();
    const employeeId = String(employeeIdRaw || "").trim();
    const startTime24 = String(startTime24Raw || "").trim();
    if (!runId || !employeeId || !startTime24) return;

    const runMeta = packageRunMetaByRun[runId];
    if (!runMeta || !runMeta.items.length) return;
    const quickCommonStaff = packageQuickEligibilityByRun[runId]?.commonStaff || [];
    if (!quickCommonStaff.length) return;
    const dateISO = String(runMeta.dateISO || bookingDate || "").trim();
    const selectedStaff = quickCommonStaff.find(
      (st: any) => String(st?.id || "").trim() === employeeId
    );
    if (!selectedStaff || !dateISO) return;

    const employeeKey =
      String((selectedStaff as any)?.linkedUid || "").trim() ||
      String((selectedStaff as any)?.id || "").trim();
    const employeeIdFallback = String((selectedStaff as any)?.id || "").trim();
    const dayCfg = getDaySettingsForDate(dateISO);
    const dayOpenTime = safeTimeHHMM(dayCfg.openTime, openTime);
    const dayCloseTime = safeTimeHHMM(dayCfg.closeTime, closeTime);
    const baseSlots = generateSalonTimeSlots(dayOpenTime, dayCloseTime, slotStepMin);
    if (!baseSlots.length) return;

    try {
      const takenFs = await collectTakenTimesForEmployeeDay({
        salonId: SALON_ID,
        employeeKey,
        employeeIdFallback,
        dateISO,
      });
      const takenLocal = collectLocalTakenOutsidePackageRun({
        runId,
        employeeKey,
        employeeIdFallback,
        dateISO,
        baseSlots,
      });
      const takenBase = new Set<string>([...Array.from(takenFs), ...Array.from(takenLocal)]);
      const plan = buildPackageRunPlan({
        runItems: runMeta.items,
        startTime24,
        baseSlots,
        takenBase,
      });
      if (!plan.ok) {
        openModal({
          title: "الوقت لم يعد متاحًا",
          message: "تغيّر التوفر لهذا الوقت. اختاري وقتًا آخر من القائمة.",
          variant: "danger",
        });
        void loadPackageQuickStarts(runId, employeeId);
        return;
      }

      const employeeName = String((selectedStaff as any)?.name || "").trim();
      setFormData((prev) => ({
        ...prev,
        items: (prev.items || []).map((it) => {
          if (String(it.packageRunId || "").trim() !== runId) return it;
          const nextTime = String(plan.plan.get(String(it.id || "").trim()) || "").trim();
          if (!nextTime) return it;
          return {
            ...it,
            date: dateISO,
            employeeId,
            employeeUid: String((selectedStaff as any)?.linkedUid || "").trim(),
            employeeName,
            time: nextTime,
            locked: true,
          };
        }),
      }));
    } catch (e: any) {
      openModal({
        title: "تعذر تطبيق اختيار البكج",
        message: String(e?.message || e || "حدث خطأ غير متوقع."),
        variant: "danger",
      });
    }
  };

  // âœ… Auto-run future search once per context when the block becomes visible
  useEffect(() => {
    const sid = String(futureServiceId || servicePicker || "").trim();
    const dateISO = String(bookingDate || "").trim();
    const employeeKey = String(futureSelectedEmployeeKey || "").trim();
    const contextKey = `${sid}|${dateISO}|${futureAnyStaff ? "any" : "one"}|${employeeKey}`;

    if (!showFutureSearch || !sid || !dateISO) return;
    if (futureGateLoading || futureLoading) return;
    if (!futureAnyStaff && !employeeKey) return;

    if (autoFutureSearchKeyRef.current === contextKey) return;
    autoFutureSearchKeyRef.current = contextKey;
    void runFutureAvailabilitySearch();
  }, [
    showFutureSearch,
    futureGateLoading,
    futureLoading,
    futureServiceId,
    servicePicker,
    bookingDate,
    futureAnyStaff,
    futureSelectedEmployeeKey,
  ]);

  async function collectTakenTimesForEmployeeDay(args: {
    salonId: string;
    employeeKey: string;
    employeeIdFallback: string;
    dateISO: string;
  }) {
    const { salonId, employeeKey, employeeIdFallback, dateISO } = args;
    const takenFs = new Set<string>();
    const colSlots = collection(db, "salons", salonId, "booking_slots");

    const key = String(employeeKey || "").trim();
    const fallbackId = String(employeeIdFallback || "").trim();

    const reads: Promise<any>[] = [];
    if (key) {
      reads.push(
        getDocs(query(colSlots, where("employeeKey", "==", key), where("date", "==", dateISO)))
      );
    }
    if (fallbackId && fallbackId !== key) {
      reads.push(
        getDocs(
          query(colSlots, where("employeeId", "==", fallbackId), where("date", "==", dateISO))
        )
      );
    }
    if (!reads.length && fallbackId) {
      reads.push(
        getDocs(
          query(colSlots, where("employeeId", "==", fallbackId), where("date", "==", dateISO))
        )
      );
    }

    const snaps = await Promise.all(reads);
    snaps.forEach((snap) => {
      snap.docs.forEach((d: any) => {
        const t = String((d.data() as any)?.time || "").trim();
        if (t) takenFs.add(t);
      });
    });

    return takenFs;
  }

  async function getAvailableStartsForDay(args: {
    salonId: string;
    employeeKey: string;
    employeeIdFallback: string;
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
      dateISO,
    });

    const takenAll = new Set<string>(takenFs);
    (localTakenTimes || new Set<string>()).forEach((x) => takenAll.add(x));

    const normalizedDuration = Number(durationMin || DEFAULT_SERVICE_DURATION_MIN);
    const slotsForThisService = filterSlotsByServiceEnd(
      baseSlots,
      closeTime,
      normalizedDuration,
      bufferMin,
      ALLOW_OVERTIME_MIN
    );

    if (!slotsForThisService.length) return [];

    const staffScopedSlots = staff
      ? filterStaffSlotsByWorkingHours(staff as any, {
          dateISO,
          slots: slotsForThisService,
          fallbackOpenTime: openTime,
          fallbackCloseTime: closeTime,
        })
      : slotsForThisService;
    if (!staffScopedSlots.length) return [];

    const greens = getGreenStartTimes({
      allSlots: baseSlots,
      slotStepMin,
      durationMin: normalizedDuration,
      bufferMin,
      takenAll,
    });

    const list = sortTimesBySlotOrder(
      staffScopedSlots
      .map((s) => s.value24)
      .filter((t) => greens.has(t)),
      baseSlots
    );

    return list.slice(0, Math.max(1, take));
  }

  async function applyFutureTimeSelection(dateISO: string, time24: string) {
    const serviceId = String(futureServiceId || servicePicker || "").trim();
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
      updateItem(target.id, { time: time24, locked: false });
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

  async function runFutureAvailabilitySearch() {
    setFutureMsg("");
    setFutureResult([]);

    const serviceId = String(futureServiceId || servicePicker || "").trim();
    if (!serviceId) {
      setFutureMsg("اختاري الخدمة أولاً.");
      return;
    }

    const sv = getServiceById(serviceId);
    const itemFromCart = (formData.items || []).find(
      (it) => String(it?.serviceId || "").trim() === serviceId
    );
    const targetItemId = String(
      futureTargetItemId ||
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

    const resolvedByName =
      futureStaffOptions.find(
        (x) => String(x.name || "").trim() === String(futureStaffNameQuery || "").trim()
      )?.key || "";

    const fixedEmployeeKey = String(futureSelectedEmployeeKey || resolvedByName || "").trim();
    if (!futureAnyStaff && !fixedEmployeeKey) {
      setFutureMsg("اختاري موظفة محددة أو اختاري (أي موظفة للخدمة).");
      return;
    }

    const startISO = String(bookingDate || "").trim() || todayISO();
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

        if (!futureAnyStaff && fixedEmployeeKey) {
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

  // âœ… Show "future days search" only when selected day is full for selected service
  useEffect(() => {
    let cancelled = false;

    async function detectFullDayForService() {
      const fallbackFromCart =
        (formData.items || [])
          .map((it) => String(it?.serviceId || "").trim())
          .find(Boolean) || "";

      const serviceId = String(servicePicker || fallbackFromCart).trim();
      const dateISO = String(bookingDate || "").trim();

      if (!serviceId || !dateISO) {
        if (!cancelled) {
          setFutureServiceId("");
          setShowFutureSearch(false);
          setFutureGateMsg("");
          setFutureResult([]);
          setFutureMsg("");
        }
        return;
      }

      const sv = getServiceById(serviceId);
      const itemFromCart = (formData.items || []).find(
        (it) => String(it?.serviceId || "").trim() === serviceId
      );

      if (!cancelled) {
        setFutureServiceId(serviceId);
      }

      const durationMin = Number(
        sv?.durationMin ||
        itemFromCart?.durationMin ||
        DEFAULT_SERVICE_DURATION_MIN
      );
      setFutureGateLoading(true);

      try {
        let staffList = (staffByService[serviceId] || []) as StaffPublicWithId[];
        const hasStaffCache = Object.prototype.hasOwnProperty.call(staffByService, serviceId);

        if (!hasStaffCache) {
          const res = await listStaffForService(serviceId, sv);
          staffList = (res || []).filter((st: any) => String(st?.name || "").trim()) as StaffPublicWithId[];

          if (!cancelled) {
            setStaffByService((p) => ({ ...p, [serviceId]: staffList }));
          }
        }

        const availableStaff = staffList.filter((st) =>
          isStaffAvailableForDate(st, dateISO, { requireShowOnBooking: true })
        );

        if (!availableStaff.length) {
          if (!cancelled) {
            setShowFutureSearch(false);
            setFutureGateMsg("");
            setFutureResult([]);
            setFutureMsg("");
          }
          return;
        }

        let hasAnyTime = false;
        for (const st of availableStaff) {
          const employeeKey = String((st as any)?.linkedUid || (st as any)?.id || "").trim();
          const employeeIdFallback = String((st as any)?.id || "").trim();
          if (!employeeKey) continue;
          const gateTargetItemId = String(itemFromCart?.id || "").trim();
          const localTaken = gateTargetItemId
            ? getLocalTakenTimesForItem(
                formData.items || [],
                gateTargetItemId,
                employeeKey,
                dateISO,
                employeeIdFallback
              )
            : new Set<string>();

          const times = await getAvailableStartsForDay({
            salonId: SALON_ID,
            employeeKey,
            employeeIdFallback,
            dateISO,
            durationMin,
            take: 1,
            localTakenTimes: localTaken,
            staff: st,
          });

          if (times.length) {
            hasAnyTime = true;
            break;
          }
        }

        if (!cancelled) {
          if (hasAnyTime) {
            setShowFutureSearch(false);
            setFutureGateMsg("");
            setFutureResult([]);
            setFutureMsg("");
          } else {
            setShowFutureSearch(true);
            setFutureGateMsg("اليوم المختار ممتلئ لهذه الخدمة. اضغطي بحث لعرض أقرب مواعيد متاحة في الأيام القادمة.");
          }
        }
      } catch {
        if (!cancelled) {
          setShowFutureSearch(false);
          setFutureGateMsg("");
          setFutureResult([]);
          setFutureMsg("");
        }
      } finally {
        if (!cancelled) setFutureGateLoading(false);
      }
    }

    detectFullDayForService();
    return () => {
      cancelled = true;
    };
  }, [bookingDate, servicePicker, formData.items, staffByService, slotStepMin, bufferMin, timeSlots]);

  // =========================
  // âœ… Busy slots per item
  // =========================
  useEffect(() => {
    let cancelled = false;

    async function loadBusyForItems() {
      const items = formData.items || [];
      const baseSlots =
        timeSlots.length > 0
          ? timeSlots
          : generateSalonTimeSlots(openTime, closeTime, slotStepMin);

      for (const it of items) {
        if (cancelled) return;

        const itemId = it.id;
        if (isSequentialOfferItem(it)) {
          setBusyByItem((p) => ({ ...p, [itemId]: { ...emptyBusyState() } }));
          continue;
        }
        const employeeId = String(it.employeeId || "").trim();
        const date = String(it.date || "").trim();

        if (!employeeId || !date) {
          setBusyByItem((p) => ({ ...p, [itemId]: { ...emptyBusyState() } }));
          continue;
        }

        setBusyByItem((p) => ({
          ...p,
          [itemId]: { ...(p[itemId] || emptyBusyState()), loading: true, hint: "" },
        }));

        try {
          const empKey = resolveEmployeeKey(it);

          // 1) جلب المحجوز من Firestore (employeeKey + employeeId) بدون fallback
          const takenFs = await collectTakenTimesForEmployeeDay({
            salonId: SALON_ID,
            employeeKey: empKey,
            employeeIdFallback: employeeId,
            dateISO: date,
          });
          if (cancelled) return;

          // 2) جلب المحجوز من السلة المحلية (خدمات ثانية لنفس الموظفة)
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

          // âœ… currentTime مرة وحدة فقط
          const currentTime = String(it.time || "").trim();

          // 3) حساب الـ Disabled بشكل صحيح (duration + buffer)
          const disabled = new Set<string>();
          let sequentialHint = "";
          let suggestedSlot = "";

          // âœ… أوقات ممكن تبدأ منها (حسب نهاية الخدمة + سماح)
          const durationMin = Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN);

          // فقط الأوقات اللي ما تتجاوز نهاية الدوام
          const slotsForThisService = filterSlotsByServiceEnd(
            baseSlots,
            closeTime,
            durationMin,
            bufferMin,
            ALLOW_OVERTIME_MIN
          );

          // âœ… هذه هي “البدايات الصحيحة” فعلياً (تضمن أن كل قطع الوقت المطلوبة فاضية)
          const greens = getGreenStartTimes({
            allSlots: baseSlots,
            slotStepMin,
            durationMin,
            bufferMin,
            takenAll, // Firestore + cart
          });

          // disabled = كل وقت داخل slotsForThisService لكنه مو أخضر
          for (const s of slotsForThisService) {
            const t = s.value24;

            if (!greens.has(t) && t !== currentTime) {
              disabled.add(t);
            }
          }


          // suggested = أول وقت أخضر
          for (const s of slotsForThisService) {
            const t = s.value24;

            if (!disabled.has(t)) {
              suggestedSlot = t;
              break;
            }
          }


          sequentialHint = suggestedSlot
            ? `الوقت المقترح: ${formatTime12ForClient(suggestedSlot)}`
            : "لا يوجد وقت متاح كافٍ لهذا اليوم.";

          setBusyByItem((p) => ({
            ...p,
            [itemId]: {
              busyTimes: takenAll,
              disabledStartTimes: disabled,
              loading: false,
              hint: sequentialHint,
              suggestedSlot, // âœ… NEW
            },
          }));

          // âœ… FIX الجوهري: منع تصفير الوقت التلقائي إلا في حالات التعارض الحقيقي
          if (currentTime && disabled.has(currentTime)) {
            const isActuallyTaken = takenAll.has(currentTime);

            // في طور الموسم، إذا كان الوقت هو المقترح، لا تصفر
            if (sequentialBooking && currentTime === suggestedSlot) {
              // مسموح
            } else if (!sequentialBooking && !isActuallyTaken) {
              // في الطور العادي: لو الوقت مو محجوز فعلياً (بس disabled بسبب المدة/البفر) لا تصفر تلقائياً
            } else {
              // فقط إذا كان محجوزاً فعلياً (Busy) نقوم بالتصفير
              if (isActuallyTaken) {
                updateItem(itemId, { time: "" });
              }
            }
          }
        } catch (e: any) {
          console.error(e);
          setBusyByItem((p) => ({
            ...p,
            [itemId]: { ...emptyBusyState(), hint: "تعذر تحميل التوفر حالياً." },
          }));
        }
      }
    }


    loadBusyForItems();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.items, sequentialBooking, timeSlots, slotStepMin, bufferMin, openTime, closeTime]);

  // =========================
  // Handlers
  // =========================
  const applyBookingDate = (v: string) => {
    setBookingDate(v);

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
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSectionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const sid = e.target.value;
    setSelectedSectionId(sid);
    setSelectedCategory("");
    setServicePicker("");
    setShowHairGuide(false);
  };

  const handleCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedCategory(e.target.value);
    setServicePicker("");
  };

  const basePrice = useMemo(() => {
    return (formData.items || []).reduce((sum, it) => sum + Number(it.basePrice || 0), 0);
  }, [formData.items]);

  const appliedDiscountTotal = useMemo(() => {
    return (appliedCoupons || []).reduce((sum, row) => sum + Math.max(0, Number(row.discountAmount || 0)), 0);
  }, [appliedCoupons]);

  const finalPrice = useMemo(() => {
    return Math.max(0, basePrice - appliedDiscountTotal);
  }, [basePrice, appliedDiscountTotal]);

  // =========================
  // Coupon
  // =========================
  const handleApplyCoupon = async () => {
    const code = normalizeCouponCode(couponCode);
    if (!code) {
      clearAppliedCoupons();
      return;
    }

    if ((appliedCoupons || []).some((x) => normalizeCouponCode(x.code) === code)) {
      setOfferMsgKind("error");
      setOfferMsg("تم استخدام هذا الكود مسبقًا في نفس الفاتورة.");
      return;
    }

    const reservedItemIds = new Set(
      (appliedCoupons || [])
        .flatMap((x) => (Array.isArray(x.applicableItemIds) ? x.applicableItemIds : []))
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    );

    try {
      const offer = await findActiveOfferByCode(SALON_ID, code);
      if (!offer) {
        setOfferMsgKind("error");
        setOfferMsg("الكود غير صحيح أو منتهي");
        return;
      }

      const applicable = (formData.items || []).filter((it) => {
        const itemId = String(it.id || "").trim();
        const sid = String(it.serviceId || "").trim();
        return itemId && sid && !reservedItemIds.has(itemId) && offerAppliesToService(offer, sid);
      });

      if (!applicable.length) {
        const hasAnyMatching = (formData.items || []).some((it) => {
          const sid = String(it.serviceId || "").trim();
          return sid && offerAppliesToService(offer, sid);
        });
        setOfferMsgKind("error");
        setOfferMsg(
          hasAnyMatching
            ? "هذا الكود ينطبق على خدمات تم خصمها بالفعل بكود آخر."
            : "هذا الكود لا ينطبق على الخدمات المختارة."
        );
        return;
      }

      const missingDate = applicable.find((it) => !String(it.date || "").trim());
      if (missingDate) {
        setOfferMsgKind("error");
        setOfferMsg("اختاري تاريخ الحجز للخدمات قبل تطبيق الكود");
        return;
      }

      const badDate = applicable
        .map((it) => ({
          it,
          check: isOfferValidForBookingDate(offer as any, String(it.date || "").trim()),
        }))
        .find((x) => !x.check.ok);

      if (badDate) {
        setOfferMsgKind("error");
        setOfferMsg(badDate.check.reason || "هذا العرض غير متاح لتاريخ الحجز المختار");
        return;
      }

      const applicableTotal = applicable.reduce((s, it) => s + Number(it.basePrice || 0), 0);
      const { discountAmount } = calcDiscount(applicableTotal, offer);
      const safeDiscount = Math.max(0, Number(discountAmount || 0));
      if (!safeDiscount) {
        setOfferMsgKind("error");
        setOfferMsg("هذا الكود لا يضيف خصمًا على الخدمات المختارة.");
        return;
      }

      const nextEntry: AppliedCouponEntry = {
        code,
        offerId: String((offer as any)?.id || "").trim(),
        offerTitle: String((offer as any)?.title || "").trim() || code,
        discountAmount: safeDiscount,
        applicableItemIds: applicable
          .map((it) => String(it.id || "").trim())
          .filter(Boolean),
      };

      setAppliedCoupons((prev) => {
        const dedup = new Map<string, AppliedCouponEntry>();
        for (const row of [...prev, nextEntry]) {
          const key = normalizeCouponCode(row.code);
          if (!key) continue;
          if (!dedup.has(key)) dedup.set(key, { ...row, code: key });
        }
        return Array.from(dedup.values());
      });
      setCouponCode("");
      setManualOverride(true);
      setOfferMsgKind("success");
      setOfferMsg(
        `تم تطبيق الكود (${nextEntry.code}) على ${nextEntry.applicableItemIds.length} خدمة. إجمالي الخصم ${safeDiscount} ريال.`
      );
    } catch (e: any) {
      console.error("apply coupon error:", e?.code, e?.message, e);
      setOfferMsgKind("error");
      setOfferMsg("صار خطأ في التحقق من الكود");
    }
  };

  const handleRemoveCoupon = (codeRaw: string) => {
    const code = normalizeCouponCode(codeRaw);
    if (!code) return;
    setAppliedCoupons((prev) => prev.filter((x) => normalizeCouponCode(x.code) !== code));
    setManualOverride(false);
    setOfferMsgKind("success");
    setOfferMsg(`تمت إزالة الكود (${code}).`);
  };

  const handleClearAllCoupons = () => {
    setCouponCode("");
    setAppliedCoupons([]);
    setManualOverride(false);
    setOfferMsgKind("success");
    setOfferMsg("تمت إزالة جميع الأكواد المطبقة.");
  };

  // =========================
  // Helper: توزيع الخصم على العناصر
  // =========================
  function allocateDiscount(items: CartItem[], discountTotal: number) {
    const total = items.reduce((s, it) => s + Number(it.basePrice || 0), 0);
    if (!total || !discountTotal) {
      return items.map(() => 0);
    }

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

  // =========================
  // âœ… Slot check for one item
  // âœ… FIX: فحص تعارض السلة قبل Firestore (employeeKey)
  // =========================
  const checkOneItemSlot = async (it: CartItem) => {
    const employeeKey = resolveEmployeeKey(it);
    const date = String(it.date || "").trim();
    const time = String(it.time || "").trim();
    if (!employeeKey || !date || !time) return { ok: false, msg: "بيانات الوقت ناقصة" };
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

    const timesToCheck = getTimesToLock(
      timeSlots,
      slotStepMin,
      time,
      Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN),
      bufferMin
    );

    // âœ… FIX: التأكد من أننا لا نفحص التعارض مع الخدمة نفسها داخل السلة
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
      const snaps = await Promise.all(
        timesToCheck.map((t) => {
          const slotId = buildSlotId(SALON_ID, employeeKey, date, t);
          return getDoc(doc(db, "salons", SALON_ID, "booking_slots", slotId));
        })
      );

      const anyTaken = snaps.some((s) => s.exists());
      if (anyTaken) {
        return { ok: false, msg: "هذا الوقت محجوز بالفعل لهذه الموظفة. اختاري وقتًا آخر." };
      }

      return { ok: true, msg: "" };
    } catch {
      return { ok: false, msg: "تعذر فحص الوقت. جرّبي وقتًا آخر." };
    }
  };

  // =========================
  // Submit
  // =========================
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

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
        title: "اليوم غير متاح للحجز",
        message: `يوم ${bookingDayCfg.dayLabel} إجازة للصالون، لذلك لا يمكن استقبال حجوزات في هذا اليوم. اختاري تاريخًا آخر من الأيام المتاحة لإكمال الحجز.`,
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

    const outOfHoursItem = items.find((it) => {
      const d = String(it.date || bookingDate || "").trim();
      const t = String(it.time || "").trim();
      if (!d || !t) return false;
      const cfg = getDaySettingsForDate(d);
      const slots = generateSalonTimeSlots(cfg.openTime, cfg.closeTime, slotStepMin);
      if (!slots.some((s) => String(s.value24 || "").trim() === t)) return true;
      const staffList = (staffByService[String(it.serviceId || "").trim()] || []) as StaffPublicWithId[];
      const staff = staffList.find(
        (s: any) => String(s?.id || "").trim() === String(it.employeeId || "").trim()
      );
      if (!staff) return false;
      return !isStaffWorkingAtTime(staff as any, {
        dateISO: d,
        time24: t,
        fallbackOpenTime: cfg.openTime,
        fallbackCloseTime: cfg.closeTime,
      });
    });
    if (outOfHoursItem) {
      const d = String(outOfHoursItem.date || bookingDate || "").trim();
      const cfg = getDaySettingsForDate(d);
      openModal({
        title: "وقت خارج الدوام",
        message: `وقت "${formatTime12ForClient(String(outOfHoursItem.time || ""))}" للخدمة "${outOfHoursItem.serviceName}" خارج دوام يوم ${cfg.dayLabel}.`,
        variant: "danger",
        confirmText: "حسنًا",
      });
      return;
    }

    const missing = items.find((it) => {
      if (isSequentialOfferItem(it)) {
        if (!String(it.date || bookingDate || "").trim()) return true;
        if (!String(it.time || "").trim()) return true;
        return false;
      }
      if (!String(it.date || bookingDate || "").trim()) return true;
      if (!String(it.employeeId || "").trim()) return true;
      if (!String(it.employeeName || "").trim()) return true;
      if (!String(it.time || "").trim()) return true;
      return false;
    });

    // âœ… ترتيب الحجز: لازم يخلص الخدمة الأولى قبل الثانية
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1];
      const prevOk = String(prev.employeeId || "").trim() && String(prev.time || "").trim();
      if (!prevOk) {
        openModal({
          title: "ترتيب الخدمات",
          message: "لازم تكمّلين بيانات الخدمة الأولى قبل ما تحددين الخدمة اللي بعدها.",
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

    const notLocked = items.find((x) => !isSequentialOfferItem(x) && !x.locked);
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
          `- ${String(overlap.a?.serviceName || "-")} (${formatTime12ForClient(String(overlap.a?.time || "-"))})\n` +
          `- ${String(overlap.b?.serviceName || "-")} (${formatTime12ForClient(String(overlap.b?.time || "-"))})\n\n` +
          `عدّلي وقت واحدة منهم.`,
        variant: "danger",
        confirmText: "تمام",
      });
      return;
    }


    setIsLoading(true);

    try {
      const typedCode = normalizeCouponCode(couponCode);
      const normalizedCodes = [...(appliedCoupons || []).map((x) => normalizeCouponCode(x.code)), typedCode]
        .filter(Boolean)
        .filter((code, idx, arr) => arr.indexOf(code) === idx);

      const finalCoupons: AppliedCouponEntry[] = [];
      const reservedItemIds = new Set<string>();

      for (const code of normalizedCodes) {
        const offer = await findActiveOfferByCode(SALON_ID, code);
        if (!offer) {
          openModal({
            title: "كود الخصم غير صحيح",
            message: `الكود (${code}) غير صحيح أو غير متاح حالياً.`,
            variant: "danger",
            confirmText: "حسنًا",
          });
          return;
        }

        const applicable = items.filter((it) => {
          const itemId = String(it.id || "").trim();
          const sid = String(it.serviceId || "").trim();
          return itemId && sid && !reservedItemIds.has(itemId) && offerAppliesToService(offer, sid);
        });

        if (!applicable.length) {
          const hasAnyMatching = items.some((it) => {
            const sid = String(it.serviceId || "").trim();
            return sid && offerAppliesToService(offer, sid);
          });
          openModal({
            title: "الكود لا ينطبق",
            message: hasAnyMatching
              ? `الكود (${code}) ينطبق على خدمات تم خصمها مسبقًا بكود آخر.`
              : `الكود (${code}) لا ينطبق على الخدمات المختارة.`,
            variant: "danger",
            confirmText: "حسنًا",
          });
          return;
        }

        const missingDate = applicable.find((it) => !String(it.date || "").trim());
        if (missingDate) {
          openModal({
            title: "ناقص تاريخ الحجز",
            message: "اختاري تاريخ الحجز للخدمات قبل تطبيق الكود.",
            variant: "danger",
            confirmText: "حسنًا",
          });
          return;
        }

        const badDate = applicable
          .map((it) => ({
            it,
            check: isOfferValidForBookingDate(offer as any, String(it.date || "").trim()),
          }))
          .find((x) => !x.check.ok);

        if (badDate) {
          openModal({
            title: "العرض غير متاح لهذا التاريخ",
            message: badDate.check.reason || "هذا العرض غير متاح لتاريخ الحجز المختار.",
            variant: "danger",
            confirmText: "حسنًا",
          });
          return;
        }

        const applicableTotal = applicable.reduce((s, it) => s + Number(it.basePrice || 0), 0);
        const { discountAmount } = calcDiscount(applicableTotal, offer);
        const safeDiscount = Math.max(0, Number(discountAmount || 0));
        if (!safeDiscount) {
          openModal({
            title: "الكود لا يضيف خصمًا",
            message: `الكود (${code}) لا يضيف خصمًا على الخدمات المختارة.`,
            variant: "danger",
            confirmText: "حسنًا",
          });
          return;
        }

        const applicableItemIds = applicable.map((it) => String(it.id || "").trim()).filter(Boolean);
        finalCoupons.push({
          code,
          offerId: String((offer as any)?.id || "").trim(),
          offerTitle: String((offer as any)?.title || "").trim() || code,
          discountAmount: safeDiscount,
          applicableItemIds,
        });
        applicableItemIds.forEach((id) => reservedItemIds.add(id));
      }

      setAppliedCoupons(finalCoupons);
      setManualOverride(finalCoupons.length > 0);

      const perItemDiscounts = items.map(() => 0);
      const couponByItemId = new Map<string, AppliedCouponEntry>();

      for (const couponEntry of finalCoupons) {
        const couponItemIds = new Set(
          (couponEntry.applicableItemIds || []).map((id) => String(id || "").trim()).filter(Boolean)
        );
        const applicableIdx = items
          .map((it, idx) => ({ it, idx }))
          .filter(({ it }) => couponItemIds.has(String(it.id || "").trim()))
          .map(({ idx }) => idx);
        if (!applicableIdx.length) continue;

        const applicableItems = applicableIdx.map((i) => items[i]);
        const allocated = allocateDiscount(applicableItems, Number(couponEntry.discountAmount || 0));
        applicableIdx.forEach((originalIndex, j) => {
          const itemDiscount = Number(allocated[j] || 0);
          perItemDiscounts[originalIndex] = Number(perItemDiscounts[originalIndex] || 0) + itemDiscount;
          const itemId = String(items[originalIndex]?.id || "").trim();
          if (itemId && itemDiscount > 0) couponByItemId.set(itemId, couponEntry);
        });
      }

      const authNow = getAuth();
      const uid = internalMode ? (authNow.currentUser?.uid || "") : (signedUid || "");

      if (!uid) {
        openModal({
          title: internalMode ? "تسجيل دخول الموظف مطلوب" : "تسجيل الدخول مطلوب",
          message: internalMode
            ? "لازم موظف/إدارة يكون مسجل دخول عشان الحجز الداخلي."
            : "لازم تنشئين حساب جديد أو تسجّلين دخول إذا كان عندك حساب.",
          variant: "danger",
          confirmText: "تمام",
        });
        return;
      }

      const userNote = String(formData.note || "").trim();
      const offerNote = finalCoupons.length
        ? finalCoupons
            .map(
              (x) =>
                `Offer: ${x.offerTitle || x.code || "-"} | code=${x.code || "-"} | discount=${Number(
                  x.discountAmount || 0
                ).toFixed(0)}`
            )
            .join(" || ")
        : "";

      const noteFinal = [userNote, offerNote].filter(Boolean).join(" | ") || undefined;

      const createdBookings: any[] = [];

      const sequentialPlans = new Map<
        string,
        {
          steps: Array<{
            serviceId: string;
            orderIndex: number;
            gapAfterMin: number;
            titleSnapshot?: string;
            serviceNameAtBooking: string;
            priceAtBooking: number;
            durationAtBooking: number;
            sectionIdAtBooking?: string;
            employeeId: string;
            employeeUid: string;
            employeeName: string;
            startAt: string;
            endAt: string;
          }>;
          sequenceStart: string;
          sequenceEnd: string;
        }
      >();

      for (const it of items) {
        if (!isSequentialOfferItem(it)) continue;
        const dateISO = String(it.date || bookingDate || "").trim();
        const chosenStart = String(it.time || "").trim();
        const plan = await planSequentialOffer({
          item: it,
          startTime: chosenStart,
          dateISO,
          items,
        });
        if (plan.ok) {
          sequentialPlans.set(String(it.id || "").trim(), plan);
          continue;
        }

        const nearest = await findNearestSequentialStart({
          item: it,
          dateISO,
          preferredStart: chosenStart,
          items,
        });

        if (nearest?.plan?.ok && nearest.time) {
          updateItem(it.id, { time: nearest.time });
          openModal({
            title: "الوقت المختار غير متاح",
            message: `العرض "${it.serviceName}" غير متاح عند ${formatTime12ForClient(chosenStart)}. أقرب وقت متاح للسلسلة كاملة: ${formatTime12ForClient(nearest.time)}.`,
            variant: "danger",
            confirmText: "تمام",
          });
          return;
        }

        openModal({
          title: "تعذر حجز العرض",
          message: `لا يوجد تسلسل متاح كامل للعرض "${it.serviceName}" في هذا اليوم. جربي وقت/تاريخ آخر.`,
          variant: "danger",
          confirmText: "تمام",
        });
        return;
      }

      const processedPackageRuns = new Set<string>();
      for (let idx = 0; idx < items.length; idx++) {
        const it = items[idx];
        const itemDiscount = Number(perItemDiscounts[idx] || 0);
        const itemFinal = Math.max(0, Number(it.basePrice || 0) - itemDiscount);
        const itemCoupon = couponByItemId.get(String(it.id || "").trim()) || null;
        const toolsNote = buildItemToolsNote(it);
        const itemNote = [noteFinal, toolsNote].filter(Boolean).join(" | ") || undefined;

        if (isSequentialOfferItem(it)) {
          const plan = sequentialPlans.get(String(it.id || "").trim());
          if (!plan || !plan.steps.length) {
            openModal({
              title: "تعذر حجز العرض",
              message: `تعذر بناء تسلسل العرض "${it.serviceName}".`,
              variant: "danger",
              confirmText: "تمام",
            });
            return;
          }

          const steps = plan.steps;
          const stepBaseTotal = steps.reduce((sum, s) => sum + Math.max(0, Number(s.priceAtBooking || 0)), 0);
          const stepFinals = steps.map((s, sIdx) => {
            if (stepBaseTotal <= 0) return sIdx === 0 ? itemFinal : 0;
            const ratio = Math.max(0, Number(s.priceAtBooking || 0)) / stepBaseTotal;
            return Math.round(itemFinal * ratio * 100) / 100;
          });
          const roundingDiff = Math.round((itemFinal - stepFinals.reduce((sum, x) => sum + x, 0)) * 100) / 100;
          if (stepFinals.length) stepFinals[stepFinals.length - 1] = Math.max(0, stepFinals[stepFinals.length - 1] + roundingDiff);

          const parentDurationMin = Math.max(
            1,
            toMinutes(plan.sequenceEnd) - toMinutes(plan.sequenceStart)
          );

          if (!createBookingGroup) throw new Error("GROUP_BOOKING_UNAVAILABLE");
          const groupRes = await createBookingGroup({
            parent: {
              userId: uid,
              createdBy: "client",
              channel: "client",
              clientName: String(formData.name || "").trim(),
              clientPhone: phone,
              serviceName: String(it.sequenceOfferTitle || it.serviceName || "عرض").trim(),
              serviceId: String(it.sequenceOfferId || "").trim()
                ? `offer:${String(it.sequenceOfferId || "").trim()}`
                : String(it.serviceId || "").trim(),
              serviceSnapshot: {
                serviceNameAtBooking: String(it.sequenceOfferTitle || it.serviceName || "عرض").trim(),
                priceAtBooking: Number(itemFinal || 0),
                durationAtBooking: parentDurationMin,
                sectionIdAtBooking: String(it.serviceSectionId || "").trim() || "offers",
                sectionTitleAtBooking: String(it.serviceSectionTitle || "").trim() || "العروض و البكجات",
                categoryIdAtBooking: String(it.serviceCategoryId || "").trim() || "sequential_offer",
                categoryNameAtBooking: String(it.serviceCategoryName || "").trim() || "عرض تسلسلي",
              },
              packageId: String(it.sequenceOfferId || "").trim()
                ? `offer:${String(it.sequenceOfferId || "").trim()}`
                : undefined,
              packageSnapshot: {
                packageId: String(it.sequenceOfferId || "").trim() || String(it.serviceId || "").trim(),
                packageName: String(it.sequenceOfferTitle || it.serviceName || "عرض").trim(),
                finalPriceAtBooking: Number(itemFinal || 0),
                baseTotalPriceAtBooking: Number(stepBaseTotal || 0),
                totalDurationMinAtBooking: parentDurationMin,
                serviceIds: steps.map((s) => String(s.serviceId || "").trim()).filter(Boolean),
                services: steps.map((s, sIdx) => ({
                  serviceId: String(s.serviceId || "").trim(),
                  serviceName: String(s.serviceNameAtBooking || "خدمة").trim(),
                  sectionId: String(s.sectionIdAtBooking || "").trim() || undefined,
                  price: Number(stepFinals[sIdx] || 0),
                  durationMin: Math.max(1, Number(s.durationAtBooking || DEFAULT_SERVICE_DURATION_MIN)),
                })),
              },
              employeeId: null,
              employeeUid: null,
              employeeName: "Auto-assigned",
              date: String(it.date || bookingDate || "").trim(),
              time: String(plan.sequenceStart || it.time || "").trim(),
              total: Number(itemFinal || 0),
              finalPrice: Number(itemFinal || 0),
              status: "pending",
              note: [
                itemNote,
                `sequenceOfferId=${String(it.sequenceOfferId || "").trim() || "-"}`,
              ]
                .filter(Boolean)
                .join(" | "),
              slotStepMinAtBooking: slotStepMin,
              bufferMinAtBooking: bufferMin,
              durationMin: parentDurationMin,
            } as any,
            items: steps.map((s, sIdx) => ({
              userId: uid,
              createdBy: "client",
              channel: "client",
              clientName: String(formData.name || "").trim(),
              clientPhone: phone,
              serviceName: String(s.serviceNameAtBooking || "خدمة").trim(),
              serviceId: String(s.serviceId || "").trim(),
              serviceSnapshot: {
                serviceNameAtBooking: String(s.serviceNameAtBooking || "خدمة").trim(),
                priceAtBooking: Number(stepFinals[sIdx] || 0),
                durationAtBooking: Math.max(1, Number(s.durationAtBooking || DEFAULT_SERVICE_DURATION_MIN)),
                sectionIdAtBooking: String(s.sectionIdAtBooking || "").trim() || undefined,
                sectionTitleAtBooking: undefined,
                categoryIdAtBooking: undefined,
                categoryNameAtBooking: undefined,
              },
              employeeId: String(s.employeeId || "").trim(),
              employeeUid: String(s.employeeUid || "").trim() || null,
              employeeName: String(s.employeeName || "").trim() || "-",
              date: String(it.date || bookingDate || "").trim(),
              time: String(s.startAt || "").trim(),
              total: Number(stepFinals[sIdx] || 0),
              finalPrice: Number(stepFinals[sIdx] || 0),
              status: "pending",
              note: [
                itemNote,
                `sequenceOfferId=${String(it.sequenceOfferId || "").trim() || "-"}`,
                `orderIndex=${Number(s.orderIndex || 0)}`,
                `gapAfterMin=${Math.max(0, Number(s.gapAfterMin || 0))}`,
              ]
                .filter(Boolean)
                .join(" | "),
              slotStepMinAtBooking: slotStepMin,
              bufferMinAtBooking: bufferMin,
              durationMin: Math.max(1, Number(s.durationAtBooking || DEFAULT_SERVICE_DURATION_MIN)),
            })) as any,
          });

          createdBookings.push({
            bookingId: groupRes.parentId,
            id: groupRes.parentId,
            trackId: groupRes.parentId,
            publicId: groupRes.parentPublicId,
            name: String(formData.name || "").trim(),
            phone,
            service: `offer:${String(it.sequenceOfferId || "").trim()}`,
            serviceName: String(it.sequenceOfferTitle || it.serviceName || "عرض").trim(),
            employee: "Auto-assigned",
            employeeId: null,
            employeeUid: null,
            date: String(it.date || "").trim(),
            time: String(plan.sequenceStart || "").trim(),
            endTime: String(plan.sequenceEnd || "").trim(),
            total: Number(itemFinal || 0),
            finalPrice: Number(itemFinal || 0),
            couponCode: itemCoupon?.code || "",
            offerId: itemCoupon?.offerId || null,
            offerTitle: itemCoupon?.offerTitle || null,
            discountAmount: itemDiscount,
            durationMin: parentDurationMin,
            status: "pending",
            bookingGroupId: groupRes.parentId,
            subBookingIds: groupRes.itemIds,
            sequenceStepsSnapshot: steps.map((s, sIdx) => ({
              serviceId: s.serviceId,
              orderIndex: s.orderIndex,
              gapAfterMin: s.gapAfterMin,
              titleSnapshot: s.titleSnapshot,
              serviceNameAtBooking: s.serviceNameAtBooking,
              priceAtBooking: Number(stepFinals[sIdx] || 0),
              durationAtBooking: s.durationAtBooking,
              employeeId: s.employeeId,
              employeeName: s.employeeName,
              startAt: s.startAt,
              endAt: s.endAt,
            })),
            createdAt: Date.now(),
          });
          continue;
        }

        const packageRunId = String(it.packageRunId || "").trim();
        if (packageRunId) {
          if (processedPackageRuns.has(packageRunId)) continue;

          const runEntries = items
            .map((row, rowIdx) => ({ item: row, idx: rowIdx }))
            .filter(
              ({ item }) =>
                String(item.packageRunId || "").trim() === packageRunId &&
                !isSequentialOfferItem(item)
            );

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
            const allSameDate = sortedRun.every(
              ({ item }) => String(item.date || bookingDate || "").trim() === runDateISO
            );

            let parentStartTime = String(sortedRun[0]?.item?.time || "").trim();
            let parentEndTime = "";
            let parentDurationMin = sortedRun.reduce(
              (sum, row) =>
                sum + Math.max(1, Number(row.item.durationMin || DEFAULT_SERVICE_DURATION_MIN)),
              0
            );

            if (allSameDate) {
              const windows = sortedRun.map(({ item }) => {
                const s = toMinutes(String(item.time || "").trim());
                const d = Math.max(1, Number(item.durationMin || DEFAULT_SERVICE_DURATION_MIN));
                return { start: s, end: s + d };
              });
              const minStart = Math.min(...windows.map((w) => w.start));
              const maxEnd = Math.max(...windows.map((w) => w.end));
              if (Number.isFinite(minStart) && Number.isFinite(maxEnd) && maxEnd > minStart) {
                parentStartTime = minutesToTime24(minStart);
                parentEndTime = minutesToTime24(maxEnd);
                parentDurationMin = Math.max(1, maxEnd - minStart);
              }
            }

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
            const runCouponMap = new Map<string, AppliedCouponEntry>();
            sortedRun.forEach(({ item }) => {
              const rowCoupon = couponByItemId.get(String(item.id || "").trim());
              if (!rowCoupon) return;
              const key = normalizeCouponCode(rowCoupon.code);
              if (!key || runCouponMap.has(key)) return;
              runCouponMap.set(key, rowCoupon);
            });
            const runCouponEntries = Array.from(runCouponMap.values());
            const runCouponCode = runCouponEntries.map((x) => x.code).filter(Boolean).join(",");
            const runOfferId = runCouponEntries.length === 1 ? runCouponEntries[0].offerId || null : null;
            const runOfferTitle = runCouponEntries.length === 1
              ? runCouponEntries[0].offerTitle || null
              : runCouponEntries.length
                ? "عروض متعددة"
                : null;

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
                userId: uid,
                createdBy: "client",
                channel: "client",
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
                status: "pending",
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
                  userId: uid,
                  createdBy: "client",
                  channel: "client",
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
                  status: "pending",
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
              endTime: parentEndTime || null,
              total: Number(runFinalTotal || 0),
              finalPrice: Number(runFinalTotal || 0),
              couponCode: runCouponCode,
              offerId: runOfferId,
              offerTitle: runOfferTitle,
              discountAmount: runDiscountTotal,
              durationMin: parentDurationMin,
              status: "pending",
              bookingGroupId: groupRes.parentId,
              subBookingIds: groupRes.itemIds,
              createdAt: Date.now(),
            });
            continue;
          }
        }

        const durationMin = Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN);
        const itemDateISO = String(it.date || bookingDate || "").trim();

        const sv = getServiceById(String(it.serviceId || "").trim());
        const sectionIdAtBooking =
          String(it.serviceSectionId || "").trim() ||
          String(sv?.sectionId || "").trim() ||
          undefined;

        const res = await createBooking({
          userId: uid,
          createdBy: "client",
          channel: "client",
          clientName: String(formData.name || "").trim(),
          clientPhone: phone,
          serviceName: it.serviceName,
          serviceId: it.serviceId,
          packageId: String(it.packageId || "").trim() || undefined,
          packageSnapshot: it.packageSnapshot || undefined,
          serviceSnapshot: {
            serviceNameAtBooking: it.serviceName,
            priceAtBooking: Number(itemFinal || 0),
            durationAtBooking: durationMin,
            sectionIdAtBooking,
            sectionTitleAtBooking: String(it.serviceSectionTitle || "").trim() || undefined,
            categoryIdAtBooking: String(it.serviceCategoryId || "").trim() || undefined,
            categoryNameAtBooking: String(it.serviceCategoryName || "").trim() || undefined,
          },
          employeeId: String(it.employeeId || "").trim(),
          employeeUid: String(it.employeeUid || "").trim() || null,
          employeeName: String(it.employeeName || "").trim() || "-",
          date: itemDateISO,
          time: String(it.time || "").trim(),
          total: Number(itemFinal || 0),
          finalPrice: Number(itemFinal || 0),
          status: "pending",
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
          name: String(formData.name || "").trim(),
          phone,
          service: it.serviceId,
          serviceName: it.serviceName,
          packageId: String(it.packageId || "").trim() || null,
          packageSnapshot: it.packageSnapshot || null,
          employee: String(it.employeeName || "").trim(),
          employeeId: String(it.employeeId || "").trim(),
          employeeUid: String(it.employeeUid || "").trim(),
          date: itemDateISO,
          time: String(it.time || "").trim(),
          total: Number(itemFinal || 0),
          finalPrice: Number(itemFinal || 0),
          couponCode: itemCoupon?.code || "",
          offerId: itemCoupon?.offerId || null,
          offerTitle: itemCoupon?.offerTitle || null,
          discountAmount: itemDiscount,
          durationMin,
          toolsSource: String(it.toolsSource || "").trim() || null,
          toolsFeeApplied: Number(it.toolsFeeApplied || 0),
          status: "pending",
          createdAt: Date.now(),
        });
      }

      localStorage.setItem("allBookings", JSON.stringify(createdBookings));
      localStorage.setItem("currentBooking", JSON.stringify(createdBookings[0] || null));
      localStorage.removeItem("bookingDraft");

      navigate("/success");
    } catch (e: any) {
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
          title: "اليوم غير متاح للحجز",
          message: "اليوم المختار مُغلق في إعدادات الدوام (إجازة للصالون). اختاري تاريخًا آخر من الأيام المتاحة للحجز.",
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
          `code: ${String(e?.code || "-")}\n` +
          `message: ${String(e?.message || "-")}`,
        variant: "danger",
        confirmText: "حسنًا",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // =========================
  // Restore draft (optional)
  // =========================
  useEffect(() => {
    const incoming = new URLSearchParams(location.search || "");
    const hasIncomingPrefill =
      !!String(incoming.get("pick") || "").trim() ||
      String(incoming.get("scope") || "").trim() === "offers_packages" ||
      String(incoming.get("autoAdd") || "").trim() === "1" ||
      !!String(incoming.get("coupon") || "").trim();
    if (hasIncomingPrefill) return;

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
              Number((it as any)?.basePrice ?? 0) - Math.max(0, Number((it as any)?.toolsFeeApplied || 0))
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

      const firstServiceId = String(items[0]?.serviceId || "").trim();
      if (firstServiceId) {
        const sv = getServiceById(firstServiceId);
        if (sv?.sectionId) setSelectedSectionId(sv.sectionId);

        if (catalogMode === "firestore") {
          if (sv?.categoryId) setSelectedCategory(String(sv.categoryId));
          else setSelectedCategory("");
        } else {
          if (sv?.category) setSelectedCategory(String(sv.category));
        }
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  // âœ… أضف هذا السطر فقط
  const isSignedClient = !!signedUid;

  return (

    <div className="booking-page py-5">
      <ConfirmModal
        open={uiModal.open}
        title={uiModal.title}
        message={uiModal.message}
        variant={uiModal.variant}
        confirmText={uiModal.confirmText || "حسنًا"}
        onConfirm={() => {
          const fn = onUiConfirm;
          closeModal();
          if (fn) fn();
        }}
        onCancel={closeModal}
      />

      <div className="container">
        <div className="row justify-content-center">
          <div className="col-lg-8">
            <div className="booking-card">

              {/* âœ… Logo */}
              <div className="text-center mb-3">
                <img
                  src={logo}
                  alt="MALIKAT SALON"
                  style={{ height: 80, objectFit: "contain" }}
                />
              </div>

              {offerLandingMsg && (
                <div className="alert alert-success py-2 mb-3" role="status" aria-live="polite">
                  {offerLandingMsg}
                </div>
              )}

              <form className="booking-form" onSubmit={handleSubmit}>

                <div className="row">
                  <div className="col-md-6 mb-4">
                    {/* الاسم */}
                    <label htmlFor="name" className="form-label">الاسم</label>

                    <div className="input-group">
                      <span className="input-group-text" aria-hidden="true">
                        <FontAwesomeIcon icon={faUser} />
                      </span>

                      <input
                        type="text"
                        className="form-control"
                        id="name"
                        name="name"
                        value={formData.name}
                        readOnly={isSignedClient}
                        disabled={isSignedClient}
                        onChange={(e) =>
                          setFormData((prev) => ({ ...prev, name: e.target.value }))
                        }
                        placeholder="اسم العميلة"
                        required
                      />
                    </div>
                  </div>


                  <div className="col-md-6 mb-4">
                    {/* الجوال */}
                    <label htmlFor="phone" className="form-label">رقم الجوال</label>

                    <div className="input-group">
                      <span className="input-group-text">
                        <FontAwesomeIcon icon={faPhone} />
                      </span>

                      <input
                        type="tel"
                        inputMode="numeric"
                        className="form-control"
                        id="phone"
                        name="phone"
                        value={formData.phone}
                        readOnly={isSignedClient}
                        disabled={isSignedClient}
                        onChange={(e) => {
                          const digitsOnly = e.target.value.replace(/\D/g, "").slice(0, 10);
                          setFormData((prev) => ({ ...prev, phone: digitsOnly }));
                        }}
                        placeholder="05xxxxxxxx"
                        required
                        maxLength={10}
                      />
                    </div>
                  </div>


                  {/* âœ… التاريخ (عمود لحاله) */}
                  <div className="col-12 mb-4">
                    <label htmlFor="bookingDate" className="form-label">تاريخ الحجز</label>

                    <div
                      className="input-group"
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        (dateRef.current as any)?.showPicker?.();
                        dateRef.current?.focus();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          (dateRef.current as any)?.showPicker?.();
                          dateRef.current?.focus();
                        }
                      }}

                    >
                      <input
                        ref={dateRef}
                        type="date"
                        className="form-control"
                        id="bookingDate"
                        value={bookingDate}
                        onChange={(e) => applyBookingDate(String(e.target.value || "").trim())}

                        min={todayISO()}
                      />
                    </div>
                    {bookingDate && !selectedDayOpen && (
                      <div
                        style={{
                          marginTop: 8,
                          color: "#b00020",
                          background: "#fff1f1",
                          border: "1px solid #f5b5bd",
                          borderRadius: 8,
                          padding: "8px 10px",
                          fontWeight: 900,
                          fontSize: 14,
                        }}
                      >
                        يوم {WEEKDAY_LABEL_AR[selectedDayKey]} إجازة. اختاري يومًا آخر للحجز.
                      </div>
                    )}
                  </div>
                </div>


                <div className="mb-4 bk-service-adder" style={{ border: '1px solid #eee', padding: '15px', borderRadius: '12px', background: '#fafafa' }}>
                  <label className="form-label" style={{ fontWeight: 'bold' }}>أضيفي خدمة جديدة</label>
                  <div className="bk-picker-scope mb-2">
                    <button
                      type="button"
                      className={`btn ${pickerScope === "services" ? "btn-dark" : "btn-outline-dark"} btn-sm`}
                      onClick={() => {
                        setPickerScope("services");
                        setServicePicker("");
                        setSelectedSectionId("");
                        setSelectedCategory("");
                        setShowHairGuide(false);
                      }}
                    >
                      الخدمات
                    </button>
                    <button
                      type="button"
                      className={`btn ${pickerScope === "offers_packages" ? "btn-dark" : "btn-outline-dark"} btn-sm`}
                      onClick={() => {
                        setPickerScope("offers_packages");
                        setServicePicker("");
                        setSelectedSectionId("");
                        setSelectedCategory("");
                        setShowHairGuide(false);
                      }}
                    >
                      البكجات
                    </button>
                  </div>

                  {pickerScope === "services" ? (
                    <div className="row g-2">
                      <div className="col-md-4">
                        <div className="bk-field">
                          <select
                            className={`form-select dash-select ${selectedSectionId ? "" : "is-empty"}`}
                            value={selectedSectionId}
                            onChange={handleSectionChange}
                            disabled={catalogLoading && !sectionOptionsSafe.length}
                          >
                            <option value="">اختاري القسم</option>
                            {!sectionOptionsSafe.length && <option value="" disabled>لا توجد أقسام متاحة</option>}
                            {sectionOptionsSafe.map((sec) => (
                              <option key={sec.id} value={sec.id}>{sec.title}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="col-md-4">
                        <div className="bk-field">
                          <select
                            className={`form-select dash-select ${selectedCategory ? "" : "is-empty"}`}
                            value={selectedCategory}
                            onChange={handleCategoryChange}
                            disabled={!selectedSectionId || (categoryLoading && !categoryOptionsSafe.length)}
                          >
                            <option value="">اختاري التصنيف</option>
                            {!!selectedSectionId && !categoryOptionsSafe.length && <option value="" disabled>لا توجد تصنيفات</option>}
                            {categoryOptionsSafe.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="col-md-4">
                        <div className="bk-field">
                          <select
                            className={`form-select dash-select ${servicePicker ? "" : "is-empty"}`}
                            value={servicePicker}
                            onChange={(e) => setServicePicker(e.target.value)}
                            disabled={!selectedSectionId}
                          >
                            <option value="">اختاري الخدمة</option>
                            {!!selectedSectionId && !servicesGrouped.length && <option value="" disabled>لا توجد خدمات</option>}
                            {servicesGrouped.map(([cat, items]) => (
                              <optgroup key={cat} label={cat}>
                                {items.map((sv) => (
                                  <option key={sv.id} value={sv.id}>
                                    {sv.name} — {servicePickerPriceText(sv)}
                                  </option>
                                ))}
                              </optgroup>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="row g-2">
                      <div className="col-12">
                        <div className="bk-field">
                          <select
                            className={`form-select dash-select ${servicePicker ? "" : "is-empty"}`}
                            value={servicePicker}
                            onChange={(e) => {
                              const next = e.target.value;
                              setServicePicker(next);
                              setOfferStartTime("");
                            }}
                            disabled={!packageOptions.length}
                          >
                            <option value="">اختاري باكيج</option>
                            {!packageOptions.length && <option value="" disabled>لا توجد باكيجات متاحة</option>}
                            {packageOptions.length > 0 && (
                              <optgroup label="الباكيجات">
                                {packageOptions.map((pkg) => (
                                  <option key={pkg.id} value={pkg.id}>
                                    {pkg.title} — {pkg.priceText}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="row g-2 mt-2">
                    <div className="col-12 d-grid">
                      <button
                        type="button"
                        className="btn btn-dark booking-service-add-btn"
                        disabled={
                          !servicePicker ||
                          !selectedDayOpen
                        }
                        onClick={() => addServiceToCart(servicePicker)}
                      >
                        إضافة
                      </button>
                    </div>
                  </div>

                  {/* âœ… دليل أطوال الشعر */}
                  {selectedSectionId && isHairSection && (
                    <div className="mt-3" style={{ border: '1px dashed rgba(13,13,13,0.18)', borderRadius: 14, padding: 12 }}>
                      <div className="d-flex align-items-center justify-content-between gap-2 flex-wrap">
                        <div style={{ fontWeight: 900, color: '#0D0D0D' }}>
                          دليل أطوال الشعر
                          <div className="small text-muted" style={{ fontWeight: 700 }}>اختاري طول الشعر من الصورة قبل إكمال الحجز</div>
                        </div>

                        <div className="d-flex align-items-center gap-2">
                          <button
                            type="button"
                            className="btn btn-outline-dark btn-sm"
                            onClick={() => setShowHairGuide(v => !v)}
                          >
                            {showHairGuide ? "إخفاء الصورة" : "عرض الصورة"}
                          </button>

                          {isOwner && (
                            <>
                              <input
                                id="hairGuideUploadInput"
                                type="file"
                                accept="image/*"
                                style={{ display: 'none' }}
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) uploadHairGuide(f);
                                  e.currentTarget.value = "";
                                }}
                              />
                              <button
                                type="button"
                                className="btn btn-dark btn-sm"
                                disabled={uploadingGuide}
                                onClick={() => document.getElementById("hairGuideUploadInput")?.click()}
                              >
                                {uploadingGuide ? "جاري الرفع..." : "رفع صورة"}
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      {showHairGuide && (
                        <div className="mt-3 text-center">
                          <img
                            src={hairGuideUrl}
                            alt="دليل أطوال الشعر"
                            style={{ width: '100%', maxWidth: 520, borderRadius: 16, boxShadow: '0 10px 28px rgba(0,0,0,0.14)' }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>


                {/* âœ… الخدمات المختارة (السلة) */}
                <div className="mb-4">
                  <label className="form-label" style={{ fontWeight: 'bold' }}>الخدمات المختارة</label>

                  {!!(formData.items || []).length ? (
                    <div className="mt-2">
                      {(formData.items || []).map((it, rowIdx) => {
                        if (it.sequenceOfferId) {
                          const seqSteps = Array.isArray(it.sequenceStepsSnapshot) ? it.sequenceStepsSnapshot : [];
                          return (
                            <div key={it.id} className="mb-3 p-3" style={{ border: "1px solid rgba(13,13,13,0.12)", borderRadius: 12, background: "#fff" }}>
                              <div className="d-flex justify-content-between align-items-center mb-2">
                                <h5 className="m-0" style={{ fontWeight: 800, color: "#0D0D0D" }}>
                                  {it.sequenceOfferTitle || it.serviceName}
                                  <span className="badge bg-secondary ms-2" style={{ fontSize: "0.7rem" }}>
                                    عرض تسلسلي
                                  </span>
                                </h5>
                                <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => removeServiceFromCart(it.id)}>
                                  حذف
                                </button>
                              </div>
                              <div className="small mb-2" style={{ color: "#374151", fontWeight: 700 }}>
                                البداية: {formatTime12ForClient(String(it.time || ""))} | المدة الإجمالية: {Number(it.durationMin || 0)} د | السعر: {it.priceText}
                              </div>
                              <div className="small mb-2" style={{ color: "#4b5563" }}>
                                القسم: {String(it.serviceSectionTitle || it.serviceSectionId || "-")} | التصنيف: {String(it.serviceCategoryName || it.serviceCategoryId || "-")}
                              </div>
                              <div className="small" style={{ color: "#6b7280" }}>
                                {seqSteps
                                  .sort((a, b) => Number(a.orderIndex || 0) - Number(b.orderIndex || 0))
                                  .map((s) => `${s.serviceNameAtBooking}${s.gapAfterMin ? ` (+${s.gapAfterMin}د)` : ""}`)
                                  .join(" - ")}
                              </div>
                            </div>
                          );
                        }

                        const itemsList = formData.items || [];
                        const packageRunId = String(it.packageRunId || "").trim();
                        const packageRunFirstIdx = packageRunId
                          ? itemsList.findIndex((x) => String(x.packageRunId || "").trim() === packageRunId)
                          : -1;
                        const packageRunCount = packageRunId
                          ? itemsList.filter((x) => String(x.packageRunId || "").trim() === packageRunId).length
                          : 0;
                        const isPackageRunFirstCard = packageRunId ? packageRunFirstIdx === rowIdx : false;
                        const showPackageRunHeader = !!packageRunId && packageRunCount > 1 && isPackageRunFirstCard;
                        const busy = busyByItem[it.id] || emptyBusyState();
                        const canEditThis = canEditByLockedPrev(itemsList, it.id);
                        const isLocked = !!it.locked;
                        const baseSlotsForUi =
                          timeSlots.length > 0
                            ? timeSlots
                            : generateSalonTimeSlots(openTime, closeTime, slotStepMin);

                        const dur = Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN);
                        const rawSectionLabel =
                          String(it.serviceSectionTitle || "").trim() ||
                          String(sectionLabelById.get(String(it.serviceSectionId || "").trim()) || "").trim();
                        const rawCategoryLabel =
                          String(it.serviceCategoryName || "").trim() ||
                          String(categoryLabelById.get(String(it.serviceCategoryId || "").trim()) || "").trim();
                        const sectionLabelRaw = normalizeUiLabel(rawSectionLabel);
                        const categoryLabelRaw = normalizeUiLabel(rawCategoryLabel);
                        const sectionLabelClean = cleanSectionLabel(sectionLabelRaw) || "غير محدد";
                        const categoryLabelClean = cleanCategoryLabel(categoryLabelRaw, sectionLabelRaw) || "غير محدد";
                        const serviceSectionLabel = sectionLabelClean;
                        const serviceCategoryLabel = categoryLabelClean;
                        const toolsEligible = isToolsOptionEligibleForItem(it);
                        const packageServices = Array.isArray(it.packageSnapshot?.services) ? it.packageSnapshot?.services : [];
                        const packageServiceNames = packageServices
                          .map((s) => String(s.serviceName || s.serviceId || "").trim())
                          .filter(Boolean);
                        const toolsSource = toolsEligible
                          ? (String(it.toolsSource || "").trim() === "salon" ? "salon" : "client")
                          : undefined;
                        const toolsFeeApplied = toolsEligible && toolsSource === "salon"
                          ? Math.max(0, Number(it.toolsFeeApplied || maniPediToolsFee || 0))
                          : 0;
                        const toolsSummary = toolsEligible
                          ? (
                            toolsSource === "salon"
                              ? `الأدوات: من المشغل (+${toolsFeeApplied} ريال)`
                              : "الأدوات: من العميلة (بدون رسوم)"
                          )
                          : "";
                        const greenStarts = getGreenStartTimes({
                          allSlots: baseSlotsForUi,
                          slotStepMin,
                          durationMin: dur,
                          bufferMin,
                          takenAll: busy.busyTimes
                        });

                        const serviceStaff = staffByService[it.serviceId] || [];
                        const dateISO = String(it.date || "").trim();
                        const bookingVisibleStaff = serviceStaff.filter(
                          (st) =>
                            (st as any)?.showOnBooking !== false &&
                            !isStaffEmploymentEndedForDate(st as any, dateISO)
                        );
                        const staffWithLeaveMeta = bookingVisibleStaff.map((st) => {
                          const leave = getStaffLeaveMetaForDate(st, dateISO);
                          const workingSlots = filterStaffSlotsByWorkingHours(st as any, {
                            dateISO,
                            slots: baseSlotsForUi,
                            fallbackOpenTime: openTime,
                            fallbackCloseTime: closeTime,
                          });
                          return {
                            staff: st,
                            leave,
                            hasWorkingHours: workingSlots.length > 0,
                          };
                        });
                        const availableStaff = staffWithLeaveMeta
                          .filter((x) => !x.leave.isOnLeave && x.hasWorkingHours)
                          .map((x) => x.staff);
                        const leaveBlockedStaff = staffWithLeaveMeta.filter((x) => x.leave.isOnLeave);
                        const workingHoursBlockedStaff = staffWithLeaveMeta.filter(
                          (x) => !x.leave.isOnLeave && !x.hasWorkingHours
                        );
                        const staffLoading = !!staffLoadingByService[it.serviceId];
                        const staffError = staffErrorByService[it.serviceId] || "";
                        const selectedEmployeeAvailable = availableStaff.some(
                          (emp) => String(emp?.id || "").trim() === String(it.employeeId || "").trim()
                        );
                        const packageRunMeta = packageRunId ? packageRunMetaByRun[packageRunId] : undefined;
                        const quickEligibility = packageRunId ? packageQuickEligibilityByRun[packageRunId] : undefined;
                        const quickCommonStaff = quickEligibility?.commonStaff || [];
                        const quickLoading = !!quickEligibility?.loading;
                        const isPackageRunLeader =
                          !!packageRunMeta &&
                          packageRunMeta.items.length > 1 &&
                          String(packageRunMeta.leaderItemId || "").trim() === String(it.id || "").trim();
                        const hasPackageQuickMode =
                          !!packageRunMeta &&
                          packageRunMeta.items.length > 1 &&
                          quickCommonStaff.length > 0;
                        const isPackageRunFollower = !!packageRunMeta && !isPackageRunLeader;
                        const packageName = String(it.packageSnapshot?.packageName || "").trim();
                        const packageFinalPrice = Math.max(0, Number(it.packageSnapshot?.finalPriceAtBooking || 0));
                        const showAsPackageBlock = hasPackageQuickMode && isPackageRunLeader && !!packageName;
                        const cardTitle = showAsPackageBlock ? packageName : it.serviceName;
                        const cardPriceText = showAsPackageBlock && packageFinalPrice > 0 ? `${packageFinalPrice} ريال` : it.priceText;
                        if (hasPackageQuickMode && isPackageRunFollower) return null;
                        const packageQuickState = packageRunId
                          ? (packageQuickByRun[packageRunId] || {
                              employeeId: "",
                              times: [],
                              loading: false,
                              error: "",
                            })
                          : {
                              employeeId: "",
                              times: [],
                              loading: false,
                              error: "",
                            };
                        const staffUnavailableMsg = (!staffLoading && !staffError && bookingVisibleStaff.length && !availableStaff.length)
                          ? "لا توجد موظفات متاحات لهذا التاريخ."
                          : "";

                        const suggested = String(busy.suggestedSlot || "").trim();
                        const slotsForThisService = filterSlotsByServiceEnd(
                          baseSlotsForUi,
                          closeTime,
                          Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN),
                          bufferMin,
                          ALLOW_OVERTIME_MIN
                        );
                        const selectedStaffForTime = bookingVisibleStaff.find(
                          (x) => String(x.id || "").trim() === String(it.employeeId || "").trim()
                        );
                        const slotsForSelectedStaff = selectedStaffForTime
                          ? filterStaffSlotsByWorkingHours(selectedStaffForTime as any, {
                              dateISO,
                              slots: slotsForThisService,
                              fallbackOpenTime: openTime,
                              fallbackCloseTime: closeTime,
                            })
                          : slotsForThisService;
                        const availableSlotsForItem = slotsForSelectedStaff.filter(
                          (s) => !busy.disabledStartTimes.has(s.value24)
                        );
                        const nearestAvailableStart =
                          suggested && availableSlotsForItem.some((s) => s.value24 === suggested)
                            ? suggested
                            : (availableSlotsForItem[0]?.value24 || "");

                        // âœ… شكل الكرت وهو مقفول (تم التأكيد)
                        if (isLocked) {
                          return (
                            <>
                              {showPackageRunHeader ? (
                                <div
                                  className="mb-2 p-2"
                                  style={{
                                    border: "1px solid rgba(13,13,13,0.18)",
                                    borderRadius: 10,
                                    background: "#f5f3ff",
                                  }}
                                >
                                  <div style={{ fontSize: 12, fontWeight: 800, color: "#4338ca" }}>
                                    باكيج مستقل
                                  </div>
                                  <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginTop: 2 }}>
                                    {packageName || "باكيج"} • {packageRunCount} خدمات
                                  </div>
                                </div>
                              ) : null}
                              <div className="mb-3" style={{ background: '#f0fff4', borderLeft: '4px solid #28a745', padding: '15px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                                <div className="d-flex justify-content-between align-items-start">
                                  <div>
                                    <p style={{ margin: 0, fontWeight: 'bold', color: '#155724', fontSize: '1.1rem' }}>
                                      {showAsPackageBlock ? "تم تأكيد هذا البكج:" : "تم تأكيد هذه الخدمة:"} {cardTitle}
                                    </p>
                                    <p style={{ margin: '5px 0 0 0', color: '#155724' }}>مع الموظفة <strong>{it.employeeName}</strong> الساعة <strong>{formatTime12ForClient(it.time)}</strong></p>
                                    <p style={{ margin: '5px 0 0 0', fontSize: '0.9rem', color: '#155724', opacity: 0.8 }}>المدة: {dur} دقيقة | السعر: {cardPriceText}</p>
                                    <p style={{ margin: '5px 0 0 0', fontSize: '0.85rem', color: '#155724', opacity: 0.85 }}>
                                      القسم: {serviceSectionLabel}
                                    </p>
                                    <p style={{ margin: '3px 0 0 0', fontSize: '0.85rem', color: '#155724', opacity: 0.85 }}>
                                      التصنيف: {serviceCategoryLabel}
                                    </p>
                                    {packageServiceNames.length > 0 ? (
                                      <div style={{ margin: '8px 0 0 0' }}>
                                        <div style={{ fontSize: '0.8rem', color: '#155724', opacity: 0.9, fontWeight: 700, marginBottom: 4 }}>
                                          تفاصيل الباكيج
                                        </div>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                          {packageServiceNames.map((name) => (
                                            <span
                                              key={name}
                                              style={{
                                                fontSize: '0.78rem',
                                                color: '#155724',
                                                background: 'rgba(21,87,36,0.08)',
                                                border: '1px solid rgba(21,87,36,0.2)',
                                                borderRadius: 999,
                                                padding: '2px 10px',
                                                lineHeight: 1.6,
                                              }}
                                            >
                                              {name}
                                            </span>
                                          ))}
                                        </div>
                                      </div>
                                    ) : null}
                                    {toolsEligible ? (
                                      <p style={{ margin: '5px 0 0 0', fontSize: '0.9rem', color: '#155724', opacity: 0.9 }}>
                                        {toolsSummary}
                                      </p>
                                    ) : null}
                                  </div>
                                  <button
                                    type="button"
                                    className="btn btn-link p-0"
                                    style={{ color: '#155724', textDecoration: 'underline', fontWeight: 'bold' }}
                                    onClick={() => {
                                      const list = formData.items || [];
                                      const idx = list.findIndex(x => x.id === it.id);
                                      setFormData(prev => ({
                                        ...prev,
                                        items: (prev.items || []).map((x, i) => {
                                          if (i === idx) return { ...x, locked: false };
                                          if (i > idx) return { ...x, locked: false, time: "", employeeId: "", employeeUid: "", employeeName: "" };
                                          return x;
                                        })
                                      }));
                                    }}
                                  >
                                    تعديل
                                  </button>
                                </div>
                              </div>
                            </>
                          );
                        }

                        // âœ… شكل الكرت وهو مفتوح (جاري الاختيار)
                        return (
                          <>
                            {showPackageRunHeader ? (
                              <div
                                className="mb-2 p-2"
                                style={{
                                  border: "1px solid rgba(13,13,13,0.18)",
                                  borderRadius: 10,
                                  background: "#f5f3ff",
                                }}
                              >
                                <div style={{ fontSize: 12, fontWeight: 800, color: "#4338ca" }}>
                                  باكيج مستقل
                                </div>
                                <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginTop: 2 }}>
                                  {packageName || "باكيج"} • {packageRunCount} خدمات
                                </div>
                              </div>
                            ) : null}
                            <div className="mb-3 p-3" style={{ border: '1px solid rgba(13,13,13,0.12)', borderRadius: 12, background: canEditThis ? '#fff' : 'rgba(245,245,244,0.75)', opacity: canEditThis ? 1 : 0.7 }}>
                              <div className="d-flex justify-content-between align-items-start mb-3">
                                <div>
                                  <h5 className="m-0" style={{ fontWeight: 800, color: '#0D0D0D' }}>
                                    {cardTitle}
                                  </h5>
                                  <div className="small text-muted" style={{ marginTop: 4, fontWeight: 700 }}>
                                    {showAsPackageBlock ? `باكيج - ${cardPriceText}` : cardPriceText}
                                  </div>
                                </div>
                                <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => removeServiceFromCart(it.id)}>حذف</button>
                              </div>

                            {!canEditThis ? (
                              <div className="p-3 text-center" style={{ background: '#fff9db', borderRadius: '8px', border: '1px solid #ffe066' }}>
                                <p style={{ margin: 0, fontWeight: 'bold', color: '#856404' }}> كمّلي الخدمة اللي قبلها عشان يفتح هذا الكرت</p>
                              </div>
                            ) : (
                              <div className="row g-3">
                                {isPackageRunLeader && packageRunMeta && (quickLoading || hasPackageQuickMode) ? (
                                  <div className="col-12">
                                    <div
                                      style={{
                                        border: "1px solid rgba(13,13,13,0.12)",
                                        borderRadius: 10,
                                        padding: 12,
                                        background: "#fafaf9",
                                      }}
                                    >
                                      <div className="small fw-bold mb-2">اختيار سريع للبكج</div>
                                      <div className="small text-muted mb-2">
                                        إجمالي وقت الخدمات: {Math.max(1, Number(packageRunMeta.totalDurationMin || 0))} دقيقة
                                      </div>
                                      {quickLoading ? (
                                        <div className="small text-muted">
                                          <FontAwesomeIcon icon={faSpinner} spin /> جاري تجهيز الموظفات المشتركات...
                                        </div>
                                      ) : quickCommonStaff.length === 0 ? (
                                        <div className="small text-muted">
                                          لا توجد موظفة واحدة تغطي كل خدمات هذا البكج. كمّلي الاختيار لكل خدمة على حدة.
                                        </div>
                                      ) : (
                                        <>
                                          <div className="row g-2 align-items-end">
                                            <div className="col-md-6">
                                              <label className="form-label small fw-bold">موظفة البكج</label>
                                              <select
                                                className="form-select"
                                                value={packageQuickState.employeeId}
                                                onChange={(e) => {
                                                  const empId = String(e.target.value || "").trim();
                                                  setPackageQuickByRun((prev) => ({
                                                    ...prev,
                                                    [packageRunId]: {
                                                      employeeId: empId,
                                                      times: [],
                                                      loading: false,
                                                      error: "",
                                                    },
                                                  }));
                                                  if (empId) {
                                                    void loadPackageQuickStarts(packageRunId, empId);
                                                  }
                                                }}
                                              >
                                                <option value="">اختاري موظفة للبكج</option>
                                                {quickCommonStaff.map((emp: any) => (
                                                  <option key={String(emp?.id || "").trim()} value={String(emp?.id || "").trim()}>
                                                    {String(emp?.name || "").trim() || "موظفة"}
                                                  </option>
                                                ))}
                                              </select>
                                            </div>
                                          </div>
                                          {packageQuickState.loading ? (
                                            <div className="small text-muted mt-2">
                                              <FontAwesomeIcon icon={faSpinner} spin /> جاري تحميل الأوقات المتاحة لكامل البكج...
                                            </div>
                                          ) : null}
                                          {packageQuickState.error ? (
                                            <div className="small text-warning mt-2">{packageQuickState.error}</div>
                                          ) : null}
                                          {packageQuickState.employeeId && packageQuickState.times.length > 0 ? (
                                            <div className="mt-2">
                                              <div className="small fw-bold mb-1">وقت بداية البكج</div>
                                              <div className="bk-time-grid">
                                                {packageQuickState.times.map((t) => (
                                                  <button
                                                    key={t}
                                                    type="button"
                                                    className="bk-time-chip"
                                                    onClick={() => {
                                                      void applyPackageQuickSelection(packageRunId, packageQuickState.employeeId, t);
                                                    }}
                                                  >
                                                    {formatTime12ForClient(t)}
                                                  </button>
                                                ))}
                                              </div>
                                            </div>
                                          ) : null}
                                        </>
                                      )}
                                    </div>
                                  </div>
                                ) : null}
                                <div className="col-12">
                                  <div className="small" style={{ color: "#4b5563", fontWeight: 700 }}>
                                    القسم: {serviceSectionLabel}
                                  </div>
                                  <div className="small" style={{ color: "#4b5563", fontWeight: 700, marginTop: 2 }}>
                                    التصنيف: {serviceCategoryLabel}
                                  </div>
                                  {packageServiceNames.length > 0 ? (
                                    <div style={{ marginTop: 6 }}>
                                      <div className="small" style={{ color: "#4b5563", fontWeight: 700, marginBottom: 4 }}>
                                        تفاصيل الباكيج
                                      </div>
                                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                        {packageServiceNames.map((name) => (
                                          <span
                                            key={name}
                                            style={{
                                              fontSize: '0.78rem',
                                              color: '#374151',
                                              background: '#f3f4f6',
                                              border: '1px solid #e5e7eb',
                                              borderRadius: 999,
                                              padding: '3px 10px',
                                              lineHeight: 1.5,
                                            }}
                                          >
                                            {name}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                                {toolsEligible ? (
                                  <div className="col-12">
                                    <label className="form-label small fw-bold">0. الأدوات لهذه الخدمة</label>
                                    <div className="d-flex flex-wrap gap-2">
                                      <button
                                        type="button"
                                        className={`btn btn-sm ${toolsSource === "client" ? "btn-dark" : "btn-outline-dark"}`}
                                        onClick={() => setItemToolsSource(it, "client")}
                                      >
                                        من العميلة (بدون رسوم)
                                      </button>
                                      <button
                                        type="button"
                                        className={`btn btn-sm ${toolsSource === "salon" ? "btn-dark" : "btn-outline-dark"}`}
                                        onClick={() => setItemToolsSource(it, "salon")}
                                      >
                                        من المشغل {maniPediToolsFee > 0 ? `(+${maniPediToolsFee} ريال)` : "(بدون رسوم إضافية)"}
                                      </button>
                                    </div>
                                  </div>
                                ) : null}

                                {!hasPackageQuickMode && (
                                <div className="col-md-6">
                                  <label className="form-label small fw-bold">1. اختاري الموظفة</label>
                                  <div className="input-group">
                                    <span className="input-group-text"><FontAwesomeIcon icon={faUserTie} /></span>
                                    <select
                                      className="form-select"
                                      value={selectedEmployeeAvailable ? it.employeeId : ""}
                                      onChange={(e) => {
                                        const empId = e.target.value;
                                        if (!empId) {
                                          updateItem(it.id, {
                                            employeeId: "",
                                            employeeUid: "",
                                            employeeName: "",
                                            time: "",
                                          });
                                          return;
                                        }
                                        const emp = bookingVisibleStaff.find(x => x.id === empId);
                                        if (!emp) return;
                                        const leaveMeta = getStaffLeaveMetaForDate(emp, dateISO);
                                        if (leaveMeta.isOnLeave) return;
                                        const hasWorkingHours = filterStaffSlotsByWorkingHours(emp as any, {
                                          dateISO,
                                          slots: slotsForThisService,
                                          fallbackOpenTime: openTime,
                                          fallbackCloseTime: closeTime,
                                        }).length > 0;
                                        if (!hasWorkingHours) return;
                                        updateItem(it.id, {
                                          employeeId: empId,
                                          employeeUid: emp?.linkedUid || "",
                                          employeeName: emp?.name || "",
                                          time: ""
                                        });
                                      }}
                                    >
                                      <option value=""> اختاري الموظفة</option>
                                      {staffWithLeaveMeta.map(({ staff: emp, leave, hasWorkingHours }) => (
                                        <option key={emp.id} value={emp.id} disabled={leave.isOnLeave || !hasWorkingHours}>
                                          {leave.isOnLeave
                                            ? `${emp.name} (${leave.label})`
                                            : !hasWorkingHours
                                              ? `${emp.name} (خارج ساعات العمل)`
                                              : emp.name}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  {staffLoading && <div className="small text-muted mt-1"><FontAwesomeIcon icon={faSpinner} spin /> جاري التحميل...</div>}
                                  {staffError && <div className="text-danger small mt-1">{staffError}</div>}
                                  {staffUnavailableMsg && <div className="text-warning small mt-1">{staffUnavailableMsg}</div>}
                                  {leaveBlockedStaff.length > 0 && (
                                    <div className="text-muted small mt-1">
                                      الموظفات المعلّمات بعبارة "في إجازة" لا يمكن اختيارهن.
                                    </div>
                                  )}
                                  {workingHoursBlockedStaff.length > 0 && (
                                    <div className="text-muted small mt-1">
                                      بعض الموظفات خارج ساعات العمل في هذا اليوم.
                                    </div>
                                  )}
                                  {!selectedEmployeeAvailable && String(it.employeeId || "").trim() && (
                                    <div className="text-warning small mt-1">
                                      الموظفة المختارة غير متاحة في هذا التاريخ (إجازة)، اختاري موظفة أخرى.
                                    </div>
                                  )}
                                </div>
                                )}

                                {!hasPackageQuickMode && it.employeeId && selectedEmployeeAvailable && (
                                  <div className="col-12">
                                    <label className="form-label small fw-bold">2. اختاري الوقت المتاح</label>
                                    <div className="bk-time-grid">
                                      {availableSlotsForItem.length === 0 ? (
                                        <div className="text-muted small" style={{ padding: 8 }}>
                                          لا توجد أوقات متاحة لهذا اليوم. جرّبي يومًا آخر أو موظفة أخرى.
                                        </div>
                                      ) : (
                                        availableSlotsForItem.map((slot) => {
                                          const value24 = slot.value24;
                                          const isGreen = greenStarts.has(value24);
                                          const isSelected = it.time === value24;
                                          const isSequentialSuggested = sequentialBooking && suggested === value24;

                                          return (
                                            <button
                                              key={value24}
                                              type="button"
                                              className={[
                                                "bk-time-chip",
                                                isGreen && !sequentialBooking ? "is-green" : "",
                                                isSequentialSuggested ? "is-sequential-suggested" : "",
                                                isSelected ? "is-selected" : ""
                                              ].join(" ")}
                                              onClick={() => updateItem(it.id, { time: value24 })}
                                            >
                                              {slot.label12}
                                            </button>
                                          );
                                        })
                                      )}
                                    </div>

                                    {availableSlotsForItem.length === 0 ? (
                                      <div className="mt-2 d-grid">
                                        <button
                                          type="button"
                                          className="btn btn-outline-dark btn-sm"
                                          onClick={() => openFutureSearchFromItem(it)}
                                        >
                                          بحث أوقات للأيام القادمة لهذه الخدمة
                                        </button>
                                      </div>
                                    ) : null}

                                    {busy.loading && <div className="small text-muted mt-2"><FontAwesomeIcon icon={faSpinner} spin /> جاري تحميل الأوقات...</div>}
                                    {busy.hint && !String(busy.hint).includes("الوقت المقترح") && (
                                      <div className="small text-warning mt-2">{busy.hint}</div>
                                    )}

                                    {it.time && (
                                      <div className="mt-3 text-center">
                                        <button
                                          type="button"
                                          className="btn btn-success w-100 py-2 fw-bold"
                                          onClick={() => updateItem(it.id, { locked: true })}
                                        >
                                          تأكيد الموظفة والوقت لهذه الخدمة
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                            </div>
                          </>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="p-4 text-center" style={{ border: '2px dashed #ddd', borderRadius: '12px', background: '#fdfdfd' }}>
                      <p className="text-muted m-0">اختاري خدمة من القائمة أعلاه للبدء ᑅ ᐧ ᑀ </p>
                    </div>
                  )}
                </div>

                {futureGateLoading ? (
                  <div className="small text-muted mb-2">
                    <FontAwesomeIcon icon={faSpinner} spin /> جاري التحقق من توفر اليوم المختار...
                  </div>
                ) : null}

                {showFutureSearch ? (
                  <div
                    ref={futureSearchRef}
                    className="mb-4"
                    style={{ border: "1px solid #eee", padding: "15px", borderRadius: "12px", background: "#fafafa" }}
                  >
                    <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">
                      <div style={{ fontWeight: 800, color: "#0d0d0d" }}>بحث أوقات للأيام القادمة</div>
                      <span className="text-muted" style={{ fontSize: 12 }}>يعرض أول 5 أيام متاحة بعد التاريخ المختار</span>
                    </div>

                    {futureGateMsg ? (
                      <div className="alert alert-warning py-2 mb-2">{futureGateMsg}</div>
                    ) : null}

                    <div className="row g-2 align-items-end">
                      <div className="col-12">
                        <div className="bk-field">
                          <select
                            className="form-select dash-select"
                            value={futureAnyStaff ? "any" : "one"}
                            onChange={(e) => {
                              const any = e.target.value === "any";
                              setFutureAnyStaff(any);
                              if (any) {
                                setFutureSelectedEmployeeKey("");
                                setFutureStaffNameQuery("");
                              }
                            }}
                          >
                            <option value="any">أي موظفة للخدمة</option>
                            <option value="one">موظفة محددة</option>
                          </select>
                        </div>
                      </div>

                      {!futureAnyStaff ? (
                        <div className="col-12">
                          <label className="form-label">اختاري الموظفة</label>
                          {!String(futureServiceId || servicePicker || "").trim() ? (
                            <div className="alert alert-danger mb-2 py-2">
                              اختاري الخدمة أولاً ثم ابحثي باسم الموظفة.
                            </div>
                          ) : null}
                          <input
                            className="form-control"
                            value={futureStaffNameQuery}
                            onChange={(e) => {
                              const v = String(e.target.value || "");
                              setFutureStaffNameQuery(v);
                              setFutureSelectedEmployeeKey("");
                            }}
                            placeholder="ابحثي باسم الموظفة..."
                            disabled={!String(futureServiceId || servicePicker || "").trim()}
                          />
                          {String(futureServiceId || servicePicker || "").trim() &&
                          staffLoadingByService[String(futureServiceId || servicePicker || "").trim()] ? (
                            <div className="small text-muted mt-1">
                              <FontAwesomeIcon icon={faSpinner} spin /> جاري تحميل الموظفات...
                            </div>
                          ) : null}
                          {String(futureServiceId || servicePicker || "").trim() &&
                          staffErrorByService[String(futureServiceId || servicePicker || "").trim()] ? (
                            <div className="small text-danger mt-1">
                              {staffErrorByService[String(futureServiceId || servicePicker || "").trim()]}
                            </div>
                          ) : null}
                          {futureStaffNameQuery && filteredFutureStaffOptions.length ? (
                            <div className="mt-2 d-flex flex-wrap gap-2">
                              {filteredFutureStaffOptions.slice(0, 8).map((st) => (
                                <button
                                  key={st.key}
                                  type="button"
                                  className="btn btn-outline-dark btn-sm"
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
                        </div>
                      ) : null}

                      <div className="col-12 d-grid">
                        <button
                          type="button"
                          className="btn btn-outline-dark"
                          onClick={runFutureAvailabilitySearch}
                          disabled={futureLoading}
                        >
                          {futureLoading ? "جاري البحث..." : "بحث"}
                        </button>
                      </div>

                      {futureMsg ? (
                        <div className="col-12">
                          <div className="alert alert-secondary mb-0 py-2">
                            {futureMsg}
                          </div>
                        </div>
                      ) : null}

                      {futureResult.length ? (
                        <div className="col-12">
                          <div className="bk-future-inline">
                            {futureAnyStaff ? (
                              <div className="small text-muted mb-2">
                                الأوقات التالية قد تكون عند موظفات مختلفات، وسيتم تحديد الموظفة بعد اختيار اليوم.
                              </div>
                            ) : null}
                            <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">
                              <div className="bk-future-title">نتائج البحث</div>
                              <button
                                type="button"
                                className="btn btn-sm bk-future-pill"
                                onClick={() => {
                                  const nearestDate = String(futureResult[0]?.date || "").trim();
                                  if (!nearestDate) return;
                                  applyBookingDate(nearestDate);
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
                                        {r.note ? (
                                          <div className="bk-future-note mb-2">
                                            <span className="bk-future-note-label">المتاح لدى:</span>
                                            <span className="bk-future-note-names">
                                              {(r.contributors && r.contributors.length
                                                ? r.contributors
                                                : String(r.note || "").replace("المتاح لدى:", "").split("،").map((x) => x.trim()).filter(Boolean)
                                              ).slice(0, 3).map((name) => (
                                                <span key={name} className="bk-future-name-chip">{name}</span>
                                              ))}
                                            </span>
                                          </div>
                                        ) : null}
                                        <div className="d-flex gap-2 flex-wrap">
                                          {(r.times || []).map((t) => (
                                            <button
                                              key={t}
                                              type="button"
                                              className="btn btn-sm bk-future-pill"
                                              onClick={() => {
                                                void applyFutureTimeSelection(r.date, t);
                                              }}
                                            >
                                              {formatTime12ForClient(t)}
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


                <div className="mb-4">
                  <label htmlFor="note" className="form-label">ملاحظة (اختياري)</label>
                  <textarea
                    className="form-control"
                    id="note"
                    name="note"
                    value={formData.note}
                    onChange={handleChange}
                    rows={3}
                    placeholder="أي ملاحظة…"
                  />
                </div>

                <div className="mb-4">
                  <label className="form-label">كود الخصم (اختياري)</label>
                  <div className="input-group bk-coupon-actions">
                    <input
                      type="text"
                      className="form-control"
                      value={couponCode}
                      onChange={(e) => {
                        setCouponCode(e.target.value);
                        if (offerMsg) {
                          setOfferMsg("");
                          setOfferMsgKind("");
                        }
                      }}
                      placeholder="اكتبي الكود هنا"
                      disabled={!formData.items?.length || isLoading}
                    />
                    <button
                      type="button"
                      className="btn bk-coupon-btn bk-coupon-btn--apply"
                      onClick={handleApplyCoupon}
                      disabled={!formData.items?.length || isLoading}
                    >
                      تطبيق الكود
                    </button>
                    <button
                      type="button"
                      className="btn bk-coupon-btn bk-coupon-btn--remove"
                      onClick={handleClearAllCoupons}
                      disabled={(!appliedCoupons.length && !couponCode.trim()) || isLoading}
                    >
                      إزالة الكل
                    </button>
                  </div>
                  {offerMsg && (
                    <div className={`bk-coupon-feedback mt-2 ${offerMsgKind === "success" ? "is-success" : "is-error"}`}>
                      {offerMsg}
                    </div>
                  )}
                  {appliedCoupons.length > 0 && (
                    <div className="bk-coupon-applied-list mt-2">
                      {appliedCoupons.map((entry) => (
                        <div key={entry.code} className="bk-coupon-applied-item">
                          <div className="bk-coupon-applied-main">
                            <span className="bk-coupon-applied-code">{entry.code}</span>
                            <span className="bk-coupon-applied-title">{entry.offerTitle || "عرض"}</span>
                            <span className="bk-coupon-applied-meta">
                              خصم {Number(entry.discountAmount || 0)} ريال
                            </span>
                          </div>
                          <button
                            type="button"
                            className="btn btn-sm bk-coupon-applied-remove"
                            onClick={() => handleRemoveCoupon(entry.code)}
                            disabled={isLoading}
                          >
                            حذف
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="booking-summary mb-4 qs-black">
                  <div className="d-flex justify-content-between">
                    <span>السعر</span>
                    <strong>{basePrice} ريال</strong>
                  </div>
                  {appliedDiscountTotal > 0 && (
                    <div className="d-flex justify-content-between mt-1">
                      <span>الخصم ({appliedCoupons.length} كود)</span>
                      <strong>-{Number(appliedDiscountTotal || 0)} ريال</strong>
                    </div>
                  )}
                  <div className="d-flex justify-content-between mt-2">
                    <span>الإجمالي</span>
                    <strong>{finalPrice} ريال</strong>
                  </div>
                </div>

                <button
                  type="submit"
                  className="btn btn-primary w-100 booking-submit-btn"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <><FontAwesomeIcon icon={faSpinner} spin /> جاري تأكيد الحجز…</>
                  ) : (
                    "تأكيد الحجز النهائي"
                  )}
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Booking;
