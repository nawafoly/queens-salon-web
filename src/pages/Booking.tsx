// src/pages/Booking.tsx

import { Fragment, useEffect, useMemo, useState, useRef } from "react";
import type React from "react"; // ✅ ADD: عشان React.ChangeEvent / React.FormEvent
import { useLocation, useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  FiDroplet,
  FiEdit3,
  FiGift,
  FiHeart,
  FiPenTool,
  FiScissors,
  FiShoppingBag,
  FiStar,
  FiSun,
  FiWind,
  FiZap,
} from "react-icons/fi";
import logo from "../assets/images/ssunnamed2.png";
import hairGuideImg from "../assets/images/hair-length-guide.png";
import hairImg from "../assets/images/hair.png";
import skinImg from "../assets/images/skin.png";
import nailsImg from "../assets/images/nails.png";
import makeupImg from "../assets/images/makeup.png";
import massageImg from "../assets/images/massage.png";
import packagesImg from "../assets/images/packages.png";
import servicesImg from "../assets/images/services.png";
import homeServicesImg from "../assets/images/home-services.png";
import hairColorTreatmentsImg from "../assets/images/hair-color-treatments.png";

import {
  faCalendarAlt,
  faPen,
  faUser,
  faSpinner,
} from "@fortawesome/free-solid-svg-icons";

const BOOKING_STAFF_IMAGE_MODULES = import.meta.glob("../assets/images/*.{png,jpg,jpeg,webp,avif,svg}", {
  eager: true,
  import: "default",
}) as Record<string, string>;

const BOOKING_STAFF_IMAGE_BY_FILE = new Map(
  Object.entries(BOOKING_STAFF_IMAGE_MODULES).map(([path, url]) => [
    String(path.split("/").pop() || path).toLowerCase(),
    String(url || ""),
  ])
);
const STAFF_DISPLAY_CACHE_TTL_MS = 15_000;

import {
  generateSalonTimeSlots,
  filterSlotsByServiceEnd,
  toMinutes,
  type TimeSlot,
} from "../helpers/timeSlots";
import { formatTime12 } from "../helpers/timeDisplay";
import { extractMinPrice, readDisplayLabel } from "../helpers/pageSharedUtils";
import { pickBookingCardIcon } from "../helpers/serviceIcons";
import {
  addDaysISO,
  buildHijriMonthDays,
  findHijriMonthStartISO,
  formatBookingDateForView,
  getStaffLeaveMetaForDate,
  isOfferValidForBookingDate,
  normalizeCalendarViewMode,
  normalizeIsoDate as normalizeISODate,
  readBookingHourOverrides,
  resolveWeekdayFromISO,
  safeInt,
  safeTimeHHMM,
  shiftHijriMonthStartISO,
  todayISO,
  toHijriMonthYearLabel,
  type BookingCalendarViewMode as CalendarViewMode,
  WEEKDAY_LABEL_AR,
} from "../helpers/bookingDateUtils";
import {
  getGreenStartTimes,
  getTimesToLock,
  resolveEmployeeKey,
  sortTimesBySlotOrder,
} from "../helpers/bookingAvailabilityUtils";
import { normalizeCouponCode } from "../helpers/bookingPaymentUtils";
import {
  SALON_ID,
  DEFAULT_SERVICE_DURATION_MIN,
  PACKAGE_SECTION_ID,
  PACKAGE_SECTION_TITLE,
  ALLOW_OVERTIME_MIN,
  HOME_SERVICE_MIN_TOTAL_SAR,
  MANI_PEDI_SECTION_KEYWORDS,
  HOME_SERVICE_SECTION_KEYWORDS,
} from "../helpers/bookingSharedConstants";
import { buildSuccessNavigationPayload } from "../helpers/successNavigation";

import {
  isStaffAvailableForDate,
  filterStaffSlotsByWorkingHours,
  isStaffEmploymentEndedForDate,
  resolveStaffWorkingWindowsForDate,
  type ResolvedStaffWorkingWindowRange,
} from "../helpers/staffAvailability";
import {
  pickEffectivePrice as resolveEffectiveSeasonPrice,
} from "../helpers/seasonPricing";
import { AppSettingsService } from "../services/AppSettingsService";
import { FirestoreReadStats } from "../services/firestoreReadStats";
import { normalizeBookedSlotsMap } from "../services/firestoreAvailabilityDays";

import "../styles/PublicFlows.css";

// ✅ Firestore slot availability check
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
} from "firebase/firestore";

import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

// ✅ انتبه: لازم firebase.ts يصدّر storage
import { db, storage } from "../services/firebase";

// ✅ Firebase Auth (للقراءة فقط)
import { getAuth, onAuthStateChanged } from "firebase/auth";


// ✅ Firestore Offers
import type { Offer as FsOffer } from "../services/firestoreOffers";
import {
  findActiveOfferByCode,
  offerAppliesToService,
  listOffers,
  isOfferActiveNow,
  incrementOfferUsage,
} from "../services/firestoreOffers";

// ✅ Staff Public (Firestore)
import {
  listActiveStaffAll,
  type StaffPublicWithId,
} from "../services/firestoreStaffPublic";

// ✅ Catalog from Firestore (Sections/Categories/Services)
import {
  listActiveSections,
  type SectionDoc,
  type CategoryDoc,
  type ServiceDoc,
} from "../services/firestoreCatalog";
import {
  listActivePackages,
  incrementPackageUsage,
  type ServicePackageDoc,
  type PackageServiceItem,
} from "../services/firestorePackages";
import { pricingSections } from "./Pricing";

// ✅ Create booking (Firestore)
import { createBooking } from "../services/firestoreBookings";
import * as firestoreBookings from "../services/firestoreBookings";

import { createOrLoadUserProfile } from "../services/userProfile";

// ✅ Custom modal بدل alert
import ConfirmModal from "../components/ConfirmModal";
import Modal from "../components/Modal";
import type { BookingFormData, CartItem } from "../types/bookingShared";

const createBookingGroup = (
  firestoreBookings as {
    createBookingGroup?: (data: any) => Promise<{
      parentId: string;
      parentPublicId: string;
      itemIds: string[];
    }>;
  }
).createBookingGroup;

function isServicePackageAvailableForBooking(pkg: ServicePackageDoc | any) {
  if (!pkg || pkg.active === false) return false;
  const today = todayISO();
  const start = normalizeISODate(pkg.startDate);
  const end = normalizeISODate(pkg.endDate);
  if (start && today < start) return false;
  if (end && today > end) return false;
  return true;
}

/* =========================
   Types
 ========================= */

type CouponMessageKind = "success" | "error" | "";

type AppliedCouponEntry = {
  code: string;
  offerId: string;
  offerTitle: string;
  discountAmount: number;
  applicableItemIds: string[];
};

type OfferServiceChoice = {
  serviceId: string;
  serviceName: string;
};

type OfferServicePickerState = {
  open: boolean;
  offerId: string;
  offerTitle: string;
  couponCode: string;
  choices: OfferServiceChoice[];
  selectedServiceId: string;
  adding: boolean;
};

type CouponTargetChoice = {
  itemId: string;
  serviceId: string;
  serviceName: string;
  date: string;
  time: string;
  price: number;
};

type CouponTargetPickerState = {
  open: boolean;
  code: string;
  offerId: string;
  offerTitle: string;
  choices: CouponTargetChoice[];
  selectedItemId: string;
  applying: boolean;
  clearInputOnSuccess: boolean;
  suppressAlreadyAppliedMsg: boolean;
  suppressRetryableErrors: boolean;
};

type ApplyCouponOptions = {
  clearInputOnSuccess?: boolean;
  suppressAlreadyAppliedMsg?: boolean;
  suppressRetryableErrors?: boolean;
  forcedItemId?: string;
};

type BookingStep = 1 | 2 | 3 | 4;

type BookingFlowState = {
  selectedVariantId: string;
  selectedVariantLabel: string;
  staffChoice: "manual";
  staffEmployeeKey: string;
  staffEmployeeName: string;
  date: string;
  time: string;
  customerName: string;
  customerPhone: string;
  coupon: string;
};

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

  // ✅ التصنيف
  categoryId?: string; // Firestore فقط
  category: string; // اسم التصنيف للعرض (Firestore/Pricing)
  name: string;

  // ✅ حقول تسعير/عرض
  priceText: string;
  basePrice: number;
  seasonPrice?: number; // ✅ سعر الموسم (اختياري)

  // ✅ مدة من Firestore إذا كانت موجودة
  durationMin?: number;
  packageId?: string;
  packageServiceIds?: string[];
  packageServices?: PackageServiceItem[];
  packageBaseTotalPrice?: number;

  // ✅ معرفة مصدر الخدمة
  source: "firestore" | "pricing";
};

type CategoryOption = { id: string; name: string };
type PickerScope = "services" | "offers_packages" | "offers" | "session_packages";
type FsSectionCatalogCacheRow = {
  categories: CategoryDoc[];
  services: ServiceDoc[];
};

type SessionPackageOption = {
  id: string;
  title: string;
  price: number;
  priceText: string;
  sessionsCount: number;
  allowedServiceIds: string[];
};

const MANI_PEDI_TOOLS_FEE_FIXED = 15;
type TimeSlotCard = {
  slot: TimeSlot;
  value24: string;
  state: SlotChipState;
  reason: string;
  isSelected: boolean;
};
const AR_SA_LATN_LOCALE = "ar-SA-u-nu-latn";
const BOOKING_CALENDAR_PREF_KEY = "booking_calendar_view";

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

function isTimeInsideWindowRange(time24: string, start24: string, end24: string) {
  const t = toMinutes(time24);
  const s = toMinutes(start24);
  const e = toMinutes(end24);
  if (s === e) return false;
  if (s < e) return t >= s && t < e;
  return t >= s || t < e;
}

function buildStaffWindowLabel(window: ResolvedStaffWorkingWindowRange, index: number, total: number) {
  const start = String(window.start || "").trim();
  const end = String(window.end || "").trim();
  const range = `${start}–${end}`;
  if (total === 1) return `الفترة: ${range}`;
  if (index === 0) return `الفترة الصباحية: ${range}`;
  if (index === 1) return `الفترة المسائية: ${range}`;
  return `الفترة ${index + 1}: ${range}`;
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

// ✅ نبي UID الحقيقي فقط (إذا مسجل دخول) ونرفض anonymous
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

function isSessionPackageCartItem(item?: Partial<CartItem> | null) {
  if (!item) return false;
  return (
    item.fromSessionPackage === true ||
    item.consumeOneSession === true ||
    !!String(item.sessionPackageId || "").trim() ||
    String(item.packageSnapshot?.kind || "").trim() === "session_package"
  );
}

function sumPackageServicePrices(items?: PackageServiceItem[] | null) {
  return (Array.isArray(items) ? items : []).reduce(
    (sum, row) => sum + Math.max(0, Number(row?.price || 0)),
    0
  );
}

function resolvePackageDocBaseTotalPrice(pkg?: Partial<ServicePackageDoc> | null) {
  const baseTotalPrice = Math.max(0, Number(pkg?.baseTotalPrice || 0));
  if (baseTotalPrice > 0) return baseTotalPrice;
  return sumPackageServicePrices(pkg?.services);
}

function resolvePackageDocFinalPrice(pkg?: Partial<ServicePackageDoc> | null) {
  const finalPrice = Math.max(0, Number(pkg?.finalPrice || 0));
  if (finalPrice > 0) return finalPrice;
  return resolvePackageDocBaseTotalPrice(pkg);
}

function resolveFlatServicePackageBaseTotalPrice(item?: Partial<FlatService> | null) {
  const baseTotalPrice = Math.max(0, Number(item?.packageBaseTotalPrice || 0));
  if (baseTotalPrice > 0) return baseTotalPrice;
  return sumPackageServicePrices(item?.packageServices);
}

function resolveFlatServicePackageFinalPrice(item?: Partial<FlatService> | null) {
  const finalPrice = Math.max(0, Number(item?.basePrice || 0));
  if (finalPrice > 0) return finalPrice;
  return resolveFlatServicePackageBaseTotalPrice(item);
}

function isServicePackageCartItem(item?: Partial<CartItem> | null) {
  if (!item || isSessionPackageCartItem(item)) return false;
  return (
    !!String(item.packageRunId || "").trim() ||
    !!String(item.packageId || "").trim() ||
    String(item.packageSnapshot?.kind || "").trim() === "service_package"
  );
}

function resolveStoredCartItemServiceBasePrice(item?: Partial<CartItem> | null) {
  if (!item) return 0;
  const serviceBasePrice = Number(item?.serviceBasePrice);
  if (Number.isFinite(serviceBasePrice) && serviceBasePrice > 0) {
    return Math.max(0, serviceBasePrice);
  }
  const basePrice = Math.max(0, Number(item?.basePrice || 0));
  const toolsFeeApplied = Math.max(0, Number(item?.toolsFeeApplied || 0));
  return Math.max(0, basePrice - toolsFeeApplied);
}

function resolveCartItemLiveAmount(item?: Partial<CartItem> | null) {
  if (!item) return 0;

  const basePrice = Math.max(0, Number(item?.basePrice || 0));
  if (basePrice > 0) return basePrice;

  const serviceBasePrice = Math.max(0, Number(item?.serviceBasePrice || 0));
  const toolsFeeApplied = Math.max(0, Number(item?.toolsFeeApplied || 0));
  const derivedTotal = serviceBasePrice + toolsFeeApplied;
  if (derivedTotal > 0) return derivedTotal;

  const raw = String(item?.priceText || "").trim();
  if (raw && raw !== "من الباقة") {
    return Math.max(0, Number(extractMinPrice(raw) || 0));
  }

  return 0;
}

function resolveCartItemStandaloneAmount(item?: Partial<CartItem> | null) {
  const liveAmount = resolveCartItemLiveAmount(item);
  if (liveAmount > 0) return liveAmount;

  if (isSessionPackageCartItem(item)) {
    return liveAmount;
  }

  const packageFinalPrice = Math.max(
    0,
    Number(item?.packageSnapshot?.finalPriceAtBooking || 0)
  );
  if (packageFinalPrice > 0) return packageFinalPrice;

  const packageBaseTotalPrice = Math.max(
    0,
    Number(item?.packageSnapshot?.baseTotalPriceAtBooking || 0)
  );
  if (packageBaseTotalPrice > 0) return packageBaseTotalPrice;

  return 0;
}

function resolveCartItemsTotal(items: Array<Partial<CartItem>> = []) {
  const processedPackageRuns = new Set<string>();

  return items.reduce((sum, item) => {
    if (isSessionPackageCartItem(item)) {
      return sum + resolveCartItemLiveAmount(item);
    }

    const packageRunId = String(item?.packageRunId || "").trim();
    if (!packageRunId) {
      return sum + resolveCartItemStandaloneAmount(item);
    }

    if (processedPackageRuns.has(packageRunId)) return sum;
    processedPackageRuns.add(packageRunId);

    const runItems = items.filter(
      (row) => String(row?.packageRunId || "").trim() === packageRunId
    );
    const runLiveTotal = runItems.reduce(
      (runSum, row) => runSum + resolveCartItemLiveAmount(row),
      0
    );

    if (runLiveTotal > 0) return sum + runLiveTotal;

    return sum + resolveCartItemStandaloneAmount(item);
  }, 0);
}

function resolveCartItemPriceText(item?: Partial<CartItem> | null) {
  const raw = String(item?.priceText || "").trim();
  const rawIsZeroSar = /^0(?:\.0+)?\s*ريال$/i.test(raw.replace(/\s+/g, " "));
  const basePrice = Math.max(0, Number(item?.basePrice || 0));
  const storedServiceBasePrice = resolveStoredCartItemServiceBasePrice(item);
  const packageFinalPrice = Math.max(
    0,
    Number(item?.packageSnapshot?.finalPriceAtBooking || 0)
  );
  const packageBaseTotalPrice = Math.max(
    0,
    Number(item?.packageSnapshot?.baseTotalPriceAtBooking || 0)
  );

  if (raw && raw !== "من الباقة" && !rawIsZeroSar) return raw;
  if (basePrice > 0) return `${basePrice.toFixed(0)} ريال`;
  if (storedServiceBasePrice > 0) return `${storedServiceBasePrice.toFixed(0)} ريال`;
  if (packageFinalPrice > 0) return `${packageFinalPrice.toFixed(0)} ريال`;
  if (packageBaseTotalPrice > 0) return `${packageBaseTotalPrice.toFixed(0)} ريال`;

  if (isSessionPackageCartItem(item)) {
    return "من الباقة";
  }

  return "0 ريال";
}
type BusyState = {
  busyTimes: Set<string>;
  disabledStartTimes: Set<string>;
  loading: boolean;
  hint: string;
  suggestedSlot?: string; // ✅ NEW: الوقت المقترح (لطور الموسم فقط)
};

type SlotChipState = "available" | "booked" | "unavailable";

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
  suggestedSlot: "", // ✅ NEW
});

function normalizeSearchText(v: string) {
  return String(v || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

const BOOKING_SECTION_IMAGE_BY_ID: Record<string, string> = {
  "hair-care": hairImg,
  "skin-care": skinImg,
  "nail-care": nailsImg,
  makeup: makeupImg,
  massage: massageImg,
  "special-packages": packagesImg,
  services: servicesImg,
  "home-services": homeServicesImg,
  "hair-color-treatments": hairColorTreatmentsImg,
};

function pickBookingSectionImage(sectionId: string, title?: string) {
  const id = String(sectionId || "").trim();
  if (BOOKING_SECTION_IMAGE_BY_ID[id]) return BOOKING_SECTION_IMAGE_BY_ID[id];

  const hay = normalizeSearchText(`${sectionId || ""} ${title || ""}`);
  if (hay.includes("شعر") || hay.includes("hair")) return hairImg;
  if (hay.includes("بشرة") || hay.includes("skin") || hay.includes("facial")) return skinImg;
  if (hay.includes("اظافر") || hay.includes("أظافر") || hay.includes("nail") || hay.includes("manicure")) return nailsImg;
  if (hay.includes("مكياج") || hay.includes("makeup")) return makeupImg;
  if (hay.includes("مساج") || hay.includes("massage") || hay.includes("spa")) return massageImg;
  if (hay.includes("باقة") || hay.includes("باكج") || hay.includes("package")) return packagesImg;
  if (hay.includes("منزل") || hay.includes("home")) return homeServicesImg;
  if (hay.includes("صبغ") || hay.includes("color")) return hairColorTreatmentsImg;
  return servicesImg;
}

function pickBookingCategoryIcon(categoryTitle: string, sectionTitle?: string) {
  const hay = normalizeSearchText(`${categoryTitle || ""} ${sectionTitle || ""}`)
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");

  if (hay.includes("قص") || hay.includes("cut") || hay.includes("trim")) return FiScissors;
  if (hay.includes("استشوار") || hay.includes("سشوار") || hay.includes("blow")) return FiWind;
  if (hay.includes("تسريح") || hay.includes("تساريح") || hay.includes("style")) return FiStar;
  if (hay.includes("صبغ") || hay.includes("صبغات") || hay.includes("لون") || hay.includes("color") || hay.includes("dye")) return FiDroplet;
  if (hay.includes("فروه") || hay.includes("تنظيف") || hay.includes("عنايه") || hay.includes("معالجات") || hay.includes("treatment")) return FiHeart;
  if (hay.includes("فلر") || hay.includes("filler") || hay.includes("كافيار") || hay.includes("caviar")) return FiZap;
  if (hay.includes("بيبي") || hay.includes("كريم") || hay.includes("makeup") || hay.includes("مكياج")) return FiPenTool;
  if (hay.includes("بشره") || hay.includes("facial") || hay.includes("skin")) return FiSun;
  if (hay.includes("اظافر") || hay.includes("منكير") || hay.includes("بدكير") || hay.includes("nail")) return FiEdit3;
  if (hay.includes("باقة") || hay.includes("باقه") || hay.includes("باكج") || hay.includes("package")) return FiGift;
  return FiShoppingBag;
}

function resolveBookingStaffAvatarUrl(raw: string) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value) || value.startsWith("data:") || value.startsWith("blob:") || value.startsWith("/")) {
    return value;
  }
  const fileName = value.split("/").pop()?.toLowerCase() || value.toLowerCase();
  return BOOKING_STAFF_IMAGE_BY_FILE.get(fileName) || value;
}

function pickStaffAvatarUrl(staff: any) {
  const candidates = [
    staff?.avatarUrl,
    staff?.avatarURL,
    staff?.photoURL,
    staff?.photoUrl,
    staff?.imageUrl,
    staff?.imageURL,
    staff?.profileImageUrl,
    staff?.profileImage,
    staff?.picture,
    staff?.avatar,
  ];
  for (const raw of candidates) {
    const url = resolveBookingStaffAvatarUrl(String(raw || "").trim());
    if (url) return url;
  }
  return "";
}

function pickStaffSpecialtyLabel(staff: any) {
  const direct = String(
    staff?.jobTitle ||
      staff?.role ||
      staff?.position ||
      staff?.title ||
      staff?.subtitle ||
      ""
  ).trim();
  if (direct) return direct;

  const specialties = Array.isArray(staff?.specialties)
    ? staff.specialties
        .map((x: unknown) => String(x || "").trim())
        .filter(Boolean)
    : [];
  if (specialties.length) return specialties.slice(0, 2).join("، ");
  return "متخصصة خدمات";
}

function pickStaffRatingMeta(staff: any) {
  const rating = Number(
    staff?.rating ??
      staff?.staffRating ??
      staff?.displayRating ??
      staff?.bookingRating ??
      staff?.avgRating ??
      staff?.averageRating ??
      staff?.reviewsAverage ??
      staff?.["تقييم العرض"] ??
      staff?.["التقييم"] ??
      0
  );
  if (!Number.isFinite(rating) || rating <= 0) return "";
  const reviewsCount = Number(
    staff?.reviewsCount ??
      staff?.reviewCount ??
      staff?.ratingsCount ??
      staff?.reviews ??
      staff?.displayReviewsCount ??
      staff?.bookingReviewsCount ??
      staff?.["عدد التقييمات"] ??
      0
  );
  const ratingText = Number.isInteger(rating) ? rating.toFixed(0) : rating.toFixed(1);
  return reviewsCount > 0 ? `${ratingText} (${reviewsCount} تقييم)` : ratingText;
}

function firstDisplayLetter(raw: string) {
  const chars = Array.from(String(raw || "").trim());
  return chars[0] || "م";
}

function isPlaceholderClientName(raw: string) {
  const normalized = normalizeSearchText(raw).replace(/ة/g, "ه");
  return (
    normalized === "عميله" ||
    normalized === "client" ||
    normalized === "user" ||
    normalized === "مستخدم"
  );
}

function isManiPediSectionByInfo(sectionId: string, sectionTitle?: string) {
  const hay = normalizeSearchText(`${sectionId || ""} ${sectionTitle || ""}`);
  if (!hay) return false;
  return MANI_PEDI_SECTION_KEYWORDS.some((k) => hay.includes(normalizeSearchText(k)));
}

function isHomeServiceSectionByInfo(sectionId: string, sectionTitle?: string) {
  const hay = normalizeSearchText(`${sectionId || ""} ${sectionTitle || ""}`);
  if (!hay) return false;
  return HOME_SERVICE_SECTION_KEYWORDS.some((k) => hay.includes(normalizeSearchText(k)));
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
  const hijriPickerRef = useRef<HTMLDivElement>(null);
  const bookingCardRef = useRef<HTMLDivElement>(null);
  const lastStepRef = useRef<BookingStep | null>(null);
  const stepScrollTimersRef = useRef<number[]>([]);

  // =========================
  // ✅ Settings (live)
  // =========================
  const [appSettings, setAppSettings] = useState<any>(() => AppSettingsService.getCached?.() || {});
  const booking = (appSettings as any)?.booking || {};
  const seasonPricing = (appSettings as any)?.catalogSeasonPricing || {};

  const seasonCfg = seasonPricing; // ✅ موسم الأسعار (Catalog)
  const sequentialBooking = !!(booking as any)?.sequentialBooking;
  // ✅ تاريخ الحجز الأساسي (لازم يختاره قبل الخدمات)
  const [bookingDate, setBookingDate] = useState<string>("");
  const [calendarViewMode, setCalendarViewMode] = useState<CalendarViewMode>(() => {
    try {
      const stored = localStorage.getItem(BOOKING_CALENDAR_PREF_KEY);
      if (stored) return normalizeCalendarViewMode(stored);
    } catch {
      // ignore
    }
    const docLang = typeof document !== "undefined" ? String(document.documentElement.lang || "").trim() : "";
    const navLang = typeof navigator !== "undefined" ? String(navigator.language || "").trim() : "";
    if (/^ar-SA/i.test(docLang) || /^ar-SA/i.test(navLang)) return "hijri";
    return "gregorian";
  });
  const [hijriPickerOpen, setHijriPickerOpen] = useState(false);
  const [hijriViewMonthISO, setHijriViewMonthISO] = useState<string>(() =>
    findHijriMonthStartISO(todayISO())
  );


  const businessHours = (booking as any)?.businessHours || {};
  const bookingHourOverrides = useMemo(
    () => readBookingHourOverrides((booking as any)?.bookingHourOverrides),
    [(booking as any)?.bookingHourOverrides]
  );

  useEffect(() => {
    try {
      localStorage.setItem(BOOKING_CALENDAR_PREF_KEY, calendarViewMode);
    } catch {
      // ignore
    }
  }, [calendarViewMode]);

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

  const getDaySettingsForDate = (dateISO: string) => {
    const targetDate = String(dateISO || "").trim() || todayISO();
    const dayKey = resolveWeekdayFromISO(targetDate);

    const weeklyDay = (businessHours as any)?.[dayKey];
    const weeklyEnabled = weeklyDay?.enabled !== false;
    const weeklyOpen = safeTimeHHMM(weeklyDay?.start, "10:00");
    const weeklyClose = safeTimeHHMM(weeklyDay?.end, "22:00");

    // Priority: active exception for this date > weekly day schedule.
    for (let i = bookingHourOverrides.length - 1; i >= 0; i--) {
      const ov = bookingHourOverrides[i];
      const fromDate = String(ov?.fromDate || "").trim();
      const toDate = String(ov?.toDate || "").trim();
      if (!fromDate || !toDate) continue;
      if (targetDate < fromDate || targetDate > toDate) continue;

      const includeDays = Array.isArray(ov?.includeWeekdays) ? ov.includeWeekdays : [];
      if (includeDays.length > 0 && !includeDays.includes(dayKey)) continue;

      const blockedDays = Array.isArray(ov?.blockedWeekdays) ? ov.blockedWeekdays : [];
      if (blockedDays.includes(dayKey) || String(ov?.mode || "").trim() === "closed") {
        return {
          dayKey,
          dayLabel: WEEKDAY_LABEL_AR[dayKey],
          enabled: false,
          openTime: weeklyOpen,
          closeTime: weeklyClose,
        };
      }

      return {
        dayKey,
        dayLabel: WEEKDAY_LABEL_AR[dayKey],
        enabled: true,
        // Do not mix with weekly hours when exception is active.
        openTime: safeTimeHHMM(String(ov?.start || ""), "10:00"),
        closeTime: safeTimeHHMM(String(ov?.end || ""), "22:00"),
      };
    }

    return {
      dayKey,
      dayLabel: WEEKDAY_LABEL_AR[dayKey],
      enabled: weeklyEnabled,
      openTime: weeklyOpen,
      closeTime: weeklyClose,
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
    // ✅ لا تغيّر هذي القائمة بدون ما تغيّر SettingsBookings.tsx بعده
    return [5, 10, 15, 30].includes(v) ? v : 10;
  }, [(booking as any)?.slotStepMin]);

  // ✅ NEW: bufferMin from settings (same contract as firestoreBookings)
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

    // ✅ فتحة المواعيد حسب اليوم المختار
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
        const active = (Array.isArray(rows) ? rows : []).filter((o: any) => isOfferActiveNow(o as any));
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
  const [sessionPackageOptions, setSessionPackageOptions] = useState<SessionPackageOption[]>([]);
  const [sequenceOffers, setSequenceOffers] = useState<FsOffer[]>([]);
  const fsSectionCatalogCacheRef = useRef<Record<string, FsSectionCatalogCacheRow>>({});
  const fsSectionCatalogInFlightRef = useRef<
    Record<string, Promise<FsSectionCatalogCacheRow>>
  >({});
  const serviceByIdCacheRef = useRef<Record<string, FlatService>>({});

  const [selectedSectionId, setSelectedSectionId] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [servicePicker, setServicePicker] = useState<string>("");
  const [servicePickerList, setServicePickerList] = useState<string[]>([]);
  const [sessionPackageServicePicker, setSessionPackageServicePicker] = useState<string[]>([]);
  const [sessionPackageAllowedServices, setSessionPackageAllowedServices] = useState<FlatService[]>([]);
  const [sessionPackageServicesLoading, setSessionPackageServicesLoading] = useState(false);
  const [sessionPackageServicesError, setSessionPackageServicesError] = useState("");
  const [showAddedItemsPanel, setShowAddedItemsPanel] = useState(false);
  const [autoAddPackageId, setAutoAddPackageId] = useState<string>("");
  const [offerStartTime, setOfferStartTime] = useState<string>("");
  const [pickerScope, setPickerScope] = useState<PickerScope | "">("");
  const bookingScopeCards = useMemo<Array<{
    scope: PickerScope;
    title: string;
    hint: string;
    image: string;
    badge: string;
  }>>(
    () => [
      {
        scope: "services",
        title: "الخدمات",
        hint: "قسم • تصنيف • خدمة",
        image: servicesImg,
        badge: "خدمة",
      },
      {
        scope: "offers",
        title: "العروض",
        hint: "خصومات",
        image: packagesImg,
        badge: "عرض",
      },
      {
        scope: "session_packages",
        title: "الباقات",
        hint: "جلسات",
        image: homeServicesImg,
        badge: "جلسات",
      },
      {
        scope: "offers_packages",
        title: "البكجات",
        hint: "مجموعة",
        image: hairColorTreatmentsImg,
        badge: "بكج",
      },
    ],
    []
  );
  const activeBookingScopeCard = useMemo(
    () => (pickerScope ? bookingScopeCards.find((card) => card.scope === pickerScope) || null : null),
    [bookingScopeCards, pickerScope]
  );

  // ✅ دليل أطوال الشعر (عرض)
  const [showHairGuide, setShowHairGuide] = useState(false);

  // ✅ دليل أطوال الشعر (رابط + رفع للأونر)
  const [hairGuideUrl, setHairGuideUrl] = useState<string>(hairGuideImg);
  const [isOwner, setIsOwner] = useState(false);
  const [uploadingGuide, setUploadingGuide] = useState(false);

  const [formData, setFormData] = useState<BookingFormData>({
    name: "",
    phone: "",
    note: "",
    items: [],
  });
  const addedItemsCount = (formData.items || []).length;

  useEffect(() => {
    if (!addedItemsCount && showAddedItemsPanel) {
      setShowAddedItemsPanel(false);
    }
  }, [addedItemsCount, showAddedItemsPanel]);

  // =========================
  // ✅ Auto-fill client info (name/phone) from Profile
  // =========================
  const [signedUid, setSignedUid] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    function fillFromSignedInCache() {
      const currentUser = getAuth().currentUser;
      if (!currentUser || (currentUser as any).isAnonymous) return;

      try {
        const cached = JSON.parse(localStorage.getItem("user_profile_v1") || "null");
        const name = String(cached?.name || localStorage.getItem("userName") || "").trim();
        const phone = phone10Digits(cached?.phone || localStorage.getItem("userPhone") || "");

        if (!cancelled) {
          setFormData((prev) => ({
            ...prev,
            name:
              (!String(prev.name || "").trim() || isPlaceholderClientName(String(prev.name || "").trim())) && name
                ? name
                : prev.name,
            phone:
              !/^05\d{8}$/.test(phone10Digits(String(prev.phone || "").trim())) && phone
                ? phone
                : prev.phone,
          }));
        }
      } catch {
        // ignore
      }
    }

    const auth = getAuth();
    const initialUser = auth.currentUser;
    if (initialUser && !(initialUser as any).isAnonymous) {
      setSignedUid(initialUser.uid);
      fillFromSignedInCache();
    }
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u || (u as any).isAnonymous) {
        setSignedUid(null);
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
            name:
              (!String(prev.name || "").trim() || isPlaceholderClientName(String(prev.name || "").trim())) && name
                ? name
                : prev.name,
            phone:
              !/^05\d{8}$/.test(phone10Digits(String(prev.phone || "").trim())) && phone
                ? phone
                : prev.phone,
          }));
        }

        // خزّن محلياً
        localStorage.setItem("user_profile_v1", JSON.stringify(p));
        if (name) localStorage.setItem("userName", name);
        if (phone) localStorage.setItem("userPhone", phone);
      } catch {
        fillFromSignedInCache();
      }
    });

    // 3) لو عدّل بياناته من Profile
    const onChanged = () => fillFromSignedInCache();
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
  const [pendingAutoCouponCode, setPendingAutoCouponCode] = useState("");
  const [offerLandingMsg, setOfferLandingMsg] = useState("");
  const [offerServicePicker, setOfferServicePicker] = useState<OfferServicePickerState>({
    open: false,
    offerId: "",
    offerTitle: "",
    couponCode: "",
    choices: [],
    selectedServiceId: "",
    adding: false,
  });
  const [couponTargetPicker, setCouponTargetPicker] = useState<CouponTargetPickerState>({
    open: false,
    code: "",
    offerId: "",
    offerTitle: "",
    choices: [],
    selectedItemId: "",
    applying: false,
    clearInputOnSuccess: true,
    suppressAlreadyAppliedMsg: false,
    suppressRetryableErrors: false,
  });
  const [manualOverride, setManualOverride] = useState(false);
  const [currentStep, setCurrentStep] = useState<BookingStep>(1);
  const [expandedTimePickerItemId, setExpandedTimePickerItemId] = useState<string>("");
  const staffChoiceMode: "manual" = "manual";
  const [, setBookingFlowState] = useState<BookingFlowState>({
    selectedVariantId: "",
    selectedVariantLabel: "",
    staffChoice: "manual",
    staffEmployeeKey: "",
    staffEmployeeName: "",
    date: "",
    time: "",
    customerName: "",
    customerPhone: "",
    coupon: "",
  });
  const hasOfferServiceInCart = useMemo(
    () =>
      (formData.items || []).some(
        (it) =>
          !!String(it.offerSourceId || "").trim() ||
          !!String((it as any)?.sequenceOfferId || "").trim()
      ),
    [formData.items]
  );
  const offerCartItem = useMemo(
    () =>
      (formData.items || []).find(
        (it) =>
          !!String(it.offerSourceId || "").trim() ||
          !!String((it as any)?.sequenceOfferId || "").trim()
      ) || null,
    [formData.items]
  );
  const scrollBookingTop = (behavior: ScrollBehavior = "auto") => {
    if (typeof document !== "undefined") {
      const active = document.activeElement as HTMLElement | null;
      if (
        active &&
        (active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.tagName === "SELECT")
      ) {
        try {
          active.blur();
        } catch {
          // ignore
        }
      }
    }

    const card = bookingCardRef.current;
    if (card) {
      try {
        card.scrollIntoView({ behavior, block: "start", inline: "nearest" });
      } catch {
        // ignore
      }

      // Some mobile browsers scroll a parent container instead of window.
      let parent = card.parentElement;
      while (parent) {
        if (parent.scrollHeight > parent.clientHeight) {
          try {
            parent.scrollTo({ top: 0, behavior });
          } catch {
            parent.scrollTop = 0;
          }
          parent.scrollTop = 0;
        }
        parent = parent.parentElement;
      }
    }

    if (typeof document !== "undefined") {
      const nodes: Array<HTMLElement | null> = [
        document.scrollingElement as HTMLElement | null,
        document.documentElement,
        document.body,
        document.querySelector<HTMLElement>(".main-content"),
        document.querySelector<HTMLElement>(".booking-page"),
      ];
      for (const el of nodes) {
        if (!el) continue;
        try {
          el.scrollTo({ top: 0, behavior });
        } catch {
          el.scrollTop = 0;
        }
        el.scrollTop = 0;
      }
    }

    if (typeof window !== "undefined") {
      try {
        window.scrollTo({ top: 0, left: 0, behavior });
      } catch {
        window.scrollTo(0, 0);
      }
      window.scrollTo(0, 0);
    }
  };

  const scheduleBookingTopScroll = () => {
    if (typeof window === "undefined") {
      scrollBookingTop("auto");
      return;
    }
    for (const t of stepScrollTimersRef.current) {
      window.clearTimeout(t);
    }
    stepScrollTimersRef.current = [];

    const isMobile = window.matchMedia("(max-width: 991px)").matches;
    const behavior: ScrollBehavior = isMobile ? "auto" : "auto";

    scrollBookingTop(behavior);
    window.requestAnimationFrame(() => scrollBookingTop(behavior));

    const delays = [90, 200, 360];
    for (const delay of delays) {
      const t = window.setTimeout(() => scrollBookingTop("auto"), delay);
      stepScrollTimersRef.current.push(t);
    }
  };

  useEffect(() => {
    if (lastStepRef.current === null) {
      lastStepRef.current = currentStep;
      return;
    }
    if (lastStepRef.current === currentStep) return;
    lastStepRef.current = currentStep;

    scheduleBookingTopScroll();
  }, [currentStep]);

  useEffect(() => {
    return () => {
      if (typeof window === "undefined") return;
      for (const t of stepScrollTimersRef.current) {
        window.clearTimeout(t);
      }
      stepScrollTimersRef.current = [];
    };
  }, []);

  const clearAppliedCoupons = () => {
    setAppliedCoupons([]);
    setOfferMsg("");
    setOfferMsgKind("");
    setManualOverride(false);
  };

  const resetSessionPackageSelection = () => {
    setSessionPackageServicePicker([]);
    setSessionPackageAllowedServices([]);
    setSessionPackageServicesLoading(false);
    setSessionPackageServicesError("");
  };

  const resetBookingPickerForNextAdd = () => {
    setPickerScope("");
    setServicePicker("");
    setServicePickerList([]);
    setSelectedSectionId("");
    setSelectedCategory("");
    setShowHairGuide(false);
    setOfferStartTime("");
    resetSessionPackageSelection();
  };

  useEffect(() => {
    if ((appliedCoupons || []).length <= 1) return;
    const first = appliedCoupons[0];
    setAppliedCoupons(first ? [first] : []);
    setOfferMsgKind("error");
    setOfferMsg("مسموح بكود خصم واحد فقط لكل فاتورة. تم الاحتفاظ بكود واحد.");
  }, [appliedCoupons]);

  // ✅ busy/disabled per item
  const [busyByItem, setBusyByItem] = useState<Record<string, BusyState>>({});
  const [staffFullDayByItem, setStaffFullDayByItem] = useState<
    Record<string, Record<string, boolean>>
  >({});
  const [packageQuickByRun, setPackageQuickByRun] = useState<Record<string, PackageQuickState>>({});
  const [packageQuickEligibilityByRun, setPackageQuickEligibilityByRun] = useState<
    Record<string, PackageQuickEligibility>
  >({});

  // ✅ Future availability (clients)
  const [futureSelectedEmployeeKey, setFutureSelectedEmployeeKey] = useState<string>("");
  const [futureLoading, setFutureLoading] = useState(false);
  const [futureResult, setFutureResult] = useState<{ date: string; times: string[] }[]>([]);
  const [futureMsg, setFutureMsg] = useState("");
  const [futureServiceId, setFutureServiceId] = useState("");
  const [futureTargetItemId, setFutureTargetItemId] = useState("");
  const autoStaffDefaultContextRef = useRef<Record<string, string>>({});
  const manualStaffChoiceContextRef = useRef<Record<string, string>>({});

  async function openFutureSearchFromItem(it: CartItem) {
    const sid = String(it?.serviceId || "").trim();
    if (!sid) return;

    const employeeKey = String(it?.employeeUid || it?.employeeId || "").trim();
    const dateISO = String(it?.date || bookingDate || "").trim();
    const targetItemId = String(it?.id || "").trim();
    if (!targetItemId) return;

    setFutureServiceId(sid);
    setFutureTargetItemId(targetItemId);
    setFutureMsg("");
    setFutureResult([]);
    setFutureSelectedEmployeeKey(employeeKey);

    if (!employeeKey) {
      setFutureMsg("اختاري الموظفة أولاً.");
      return;
    }

    await runFutureAvailabilitySearch({
      serviceId: sid,
      targetItemId,
      employeeKey,
      startISO: dateISO || todayISO(),
    });
  }

  // ✅ Staff per serviceId
  const [staffByService, setStaffByService] = useState<Record<string, StaffPublicWithId[]>>({});
  const [staffLoadingByService, setStaffLoadingByService] = useState<Record<string, boolean>>({});
  const [staffErrorByService, setStaffErrorByService] = useState<Record<string, string>>({});
  const [staffRefreshTick, setStaffRefreshTick] = useState(0);
  const [staffDisplayById, setStaffDisplayById] = useState<Record<string, any>>({});
  const staffAllCacheRef = useRef<StaffPublicWithId[] | null>(null);
  const staffAllCacheLoadedAtRef = useRef(0);
  const staffByResolverCacheRef = useRef<Record<string, StaffPublicWithId[]>>({});
  const staffByResolverInFlightRef = useRef<Record<string, Promise<StaffPublicWithId[]>>>({});
  const staffByServiceLoadedAtRef = useRef<Record<string, number>>({});
  const staffDisplayLoadedIdsRef = useRef<Set<string>>(new Set());

  const TAKEN_TIMES_CACHE_TTL_MS = 15_000;
  const takenTimesCacheRef = useRef<Record<string, { ts: number; values: string[] }>>({});
  const takenTimesInFlightRef = useRef<Record<string, Promise<string[]>>>({});

  // ✅ Modal بدل alert
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
  // ✅ Helper: تعارض أوقات داخل السلة نفسها (employeeKey + نفس التاريخ)
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

      const otherKey = resolveEmployeeKey(other); // ✅ FIX: نفس منطق booking_slots
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
  function pickEffectivePrice(args: {
    basePrice: number;
    seasonPrice?: number;
    appSettings: any;
    dateISO: string;
  }) {
    return resolveEffectiveSeasonPrice(args);
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

        const empA = resolveEmployeeKey(a); // ✅ FIX
        const empB = resolveEmployeeKey(b); // ✅ FIX
        const dateA = String(a.date || "").trim();
        const dateB = String(b.date || "").trim();
        const timeA = String(a.time || "").trim();
        const timeB = String(b.time || "").trim();

        if (!empA || !empB || !dateA || !dateB || !timeA || !timeB) continue;
        const idA = String(a.employeeId || "").trim();
        const idB = String(b.employeeId || "").trim();

        const sameByKey = empA && empB && empA === empB;
        const sameById = idA && idB && idA === idB;
        const crossKeyMatch = (idA && empB === idA) || (idB && empA === idB);

        if (!(sameByKey || sameById || crossKeyMatch)) continue;
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

  function getLocalExactTakenStartTimesForItem(
    items: CartItem[],
    currentItemId: string,
    employeeId: string,
    date: string
  ) {
    const taken = new Set<string>();
    const targetEmployeeId = String(employeeId || "").trim();
    const targetDate = String(date || "").trim();
    if (!targetEmployeeId || !targetDate) return taken;

    for (const other of items || []) {
      if (!other || String(other.id || "").trim() === String(currentItemId || "").trim()) continue;
      if (isSequentialOfferItem(other)) continue;

      const otherEmployeeId = String(other.employeeId || "").trim();
      const otherDate = String(other.date || "").trim();
      const otherTime = String(other.time || "").trim();

      if (!otherEmployeeId || !otherDate || !otherTime) continue;
      if (otherEmployeeId !== targetEmployeeId || otherDate !== targetDate) continue;

      taken.add(otherTime);
    }

    return taken;
  }

  function findExactCartSlotConflict(
    items: CartItem[],
    currentItemId: string,
    candidate: Partial<CartItem>
  ) {
    const employeeId = String(candidate.employeeId || "").trim();
    const date = String(candidate.date || "").trim();
    const time = String(candidate.time || "").trim();
    if (!employeeId || !date || !time) return null;

    return (
      (items || []).find((other) => {
        if (!other) return false;
        if (String(other.id || "").trim() === String(currentItemId || "").trim()) return false;
        if (isSequentialOfferItem(other)) return false;

        return (
          String(other.employeeId || "").trim() === employeeId &&
          String(other.date || "").trim() === date &&
          String(other.time || "").trim() === time
        );
      }) || null
    );
  }

  function findAnyExactCartSlotConflict(items: CartItem[]) {
    for (const item of items || []) {
      if (!item || isSequentialOfferItem(item)) continue;
      const conflict = findExactCartSlotConflict(items, String(item.id || "").trim(), item);
      if (conflict) return { item, conflict };
    }
    return null;
  }

  // =========================
  // ✅ Use local hair guide image + role (owner/admin)
  // ✅ FIX: use onAuthStateChanged so role doesn't stay false
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

  const loadSessionPackagesFromFirestore = async () => {
    try {
      const snap = await getDocs(
        query(
          collection(db, "salons", SALON_ID, "packages_catalog"),
          orderBy("name", "asc"),
          limit(100)
        )
      );

      const rows: SessionPackageOption[] = snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }))
        .map((x: any) => ({
          id: `spkg:${String(x.id || "").trim()}`,
          title: String(x.name || "").trim(),
          price: Math.max(0, Number(x.price || 0)),
          priceText: `${Math.max(0, Number(x.price || 0))} ريال`,
          sessionsCount: Math.max(1, Number(x.sessionsCount || 1)),
          allowedServiceIds: Array.isArray(x.allowedServiceIds)
            ? x.allowedServiceIds.map((v: any) => String(v || "").trim()).filter(Boolean)
            : Array.isArray(x.serviceIds)
              ? x.serviceIds.map((v: any) => String(v || "").trim()).filter(Boolean)
              : [],
        }))
        .filter((x) => x.title && x.allowedServiceIds.length > 0);

      setSessionPackageOptions(rows);
    } catch (e) {
      console.error("loadSessionPackagesFromFirestore error:", e);
      setSessionPackageOptions([]);
    }
  };

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
          loadSessionPackagesFromFirestore(),
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

    // لو ما فيه تصنيفات، فلتر بالقسم بس
    if (!fsCategories.length) {
      return fsServices.filter((s: any) => String(s.sectionId || "").trim() === sid);
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
      return catIdsInSection.has(catId);
    });
  }, [catalogMode, fsServices, fsCategories, selectedSectionId]);

  // =========================
  // One source services list
  // =========================
  const HAIR_SECTION_IDS = new Set(["hair", "الشعر", "hair_section", "قص", "قص_شعر"]);

  const servicesFlat: FlatService[] = useMemo(() => {
    const packageRows: FlatService[] =
    catalogMode === "firestore"
      ? (fsPackages || []).map((pkg) => {
        const finalPriceNum = resolvePackageDocFinalPrice(pkg);
        const baseTotalPriceNum = resolvePackageDocBaseTotalPrice(pkg);
        const packagePrice = finalPriceNum > 0 ? finalPriceNum : baseTotalPriceNum;
  
        return {
          id: `pkg:${String(pkg.id)}`,
          kind: "package" as const,
          sectionId: PACKAGE_SECTION_ID,
          sectionTitle: PACKAGE_SECTION_TITLE,
          categoryId: PACKAGE_SECTION_ID,
          category: PACKAGE_SECTION_TITLE,
          name: String(pkg.name || "").trim(),
          priceText: packagePrice > 0 ? `${packagePrice} ريال` : "من الباقة",
          basePrice: packagePrice,
          durationMin: Number(pkg.totalDurationMin || DEFAULT_SERVICE_DURATION_MIN),
          packageId: String(pkg.id || "").trim(),
          packageServiceIds: Array.isArray(pkg.serviceIds)
            ? pkg.serviceIds.map((x) => String(x || "").trim()).filter(Boolean)
            : [],
          packageServices: Array.isArray(pkg.services) ? pkg.services : [],
          packageBaseTotalPrice: baseTotalPriceNum,
          source: "firestore" as const,
        };
      })
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

  const selectedSectionOption = useMemo(
    () =>
      sectionOptionsSafe.find(
        (sec) => String(sec.id || "").trim() === String(selectedSectionId || "").trim()
      ) || null,
    [sectionOptionsSafe, selectedSectionId]
  );

  const selectedCategoryOption = useMemo(
    () =>
      categoryOptionsSafe.find(
        (cat) => String(cat.id || "").trim() === String(selectedCategory || "").trim()
      ) || null,
    [categoryOptionsSafe, selectedCategory]
  );

  useEffect(() => {
    if (!selectedSectionId) {
      if (selectedCategory) setSelectedCategory("");
      return;
    }

    if (String(selectedSectionId).trim() === PACKAGE_SECTION_ID) {
      if (selectedCategory) setSelectedCategory("");
      return;
    }

    if (categoryOptionsSafe.length === 1) {
      const onlyCategory = categoryOptionsSafe[0];
      if (String(selectedCategory || "").trim() !== String(onlyCategory.id || "").trim()) {
        setSelectedCategory(String(onlyCategory.id || "").trim());
      }
      return;
    }

    if (
      selectedCategory &&
      !categoryOptionsSafe.some((c) => String(c.id || "").trim() === String(selectedCategory || "").trim())
    ) {
      setSelectedCategory("");
    }
  }, [selectedSectionId, selectedCategory, categoryOptionsSafe]);

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

  const sequenceOfferOptions = useMemo(() => {
    const rows = (sequenceOffers || [])
      .map((offer: any) => {
        const oid = String((offer as any)?.id || "").trim();
        if (!oid) return null;
        const title = String((offer as any)?.title || "").trim() || "عرض تسلسلي";
        const discountType = String((offer as any)?.discountType || "").trim().toLowerCase();
        const discountValue = Math.max(
          0,
          Number((offer as any)?.value ?? (offer as any)?.discountPercent ?? 0)
        );
        const code = normalizeCouponCode(String((offer as any)?.code || "").trim());
        const priceText =
          discountType === "percent"
            ? `خصم ${discountValue}%${code ? ` • ${code}` : ""}`
            : `خصم ${discountValue} ريال${code ? ` • ${code}` : ""}`;
        return {
          id: `offer:${oid}`,
          title,
          priceText,
        };
      })
      .filter(Boolean) as Array<{ id: string; title: string; priceText: string }>;

    const collator = new Intl.Collator("ar", { sensitivity: "base", numeric: true });
    return rows.sort((a, b) => collator.compare(a.title, b.title));
  }, [sequenceOffers]);

  const selectedSessionPackage = useMemo(
    () =>
      (sessionPackageOptions || []).find(
        (pkg) => String(pkg.id || "").trim() === String(servicePicker || "").trim()
      ) || null,
    [sessionPackageOptions, servicePicker]
  );

  useEffect(() => {
    const params = new URLSearchParams(location.search || "");
    const scope = String(params.get("scope") || "").trim();
    const pickRaw = String(params.get("pick") || "").trim();
    const autoAdd = String(params.get("autoAdd") || "").trim() === "1";
    if (!pickRaw || (scope !== "offers_packages" && scope !== "offers")) return;

    const isOfferPick = pickRaw.startsWith("offer:");
    if (isOfferPick) {
      const offerDocId = String(pickRaw.slice("offer:".length) || "").trim();
      const offerPickerId = offerDocId ? `offer:${offerDocId}` : pickRaw;
      setPickerScope("offers");
      setServicePicker(offerPickerId);
      setSelectedSectionId("");
      setSelectedCategory("");
      setShowHairGuide(false);
      setOfferStartTime("");

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

    const packageDocId = pickRaw.startsWith("pkg:")
      ? String(pickRaw.slice("pkg:".length) || "").trim()
      : pickRaw;
    const packagePickerId = packageDocId ? `pkg:${packageDocId}` : pickRaw;

    setPickerScope("offers_packages");
    setServicePicker(packagePickerId);
    setSelectedSectionId("");
    setSelectedCategory("");
    setShowHairGuide(false);
    setOfferStartTime("");

    const hasPackage = packageOptions.some((p) => {
      const pid = String(p.id || "").trim();
      return pid === packagePickerId || pid === packageDocId;
    });
    if (autoAdd && hasPackage) setAutoAddPackageId(packagePickerId);
    if (!hasPackage) {
      void (async () => {
        try {
          const snap = await getDoc(doc(db, "salons", SALON_ID, "service_packages", packageDocId));
          if (!snap.exists()) return;
          const raw = snap.data() as any;
          const fetchedPackage = { id: packageDocId, ...(raw || {}) } as ServicePackageDoc;
          if (!isServicePackageAvailableForBooking(fetchedPackage)) {
            setOfferLandingMsg("هذا الباكيج غير متاح حالياً أو انتهت صلاحيته.");
            return;
          }
          setFsPackages((prev) => {
            if ((prev || []).some((x) => String((x as any)?.id || "").trim() === packageDocId)) return prev;
            return [...(prev || []), fetchedPackage];
          });
          setCatalogMode("firestore");
          if (autoAdd) setAutoAddPackageId(packagePickerId);
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

    const normalizedCoupon = normalizeCouponCode(coupon);
    setCouponCode(normalizedCoupon);
    setOfferMsg("تم تعبئة كود الخصم تلقائيًا.");
    setOfferMsgKind("success");
    if (fromOffer) {
      setPendingAutoCouponCode(normalizedCoupon);
      setOfferLandingMsg("تم استخدام العرض، أكمل تعبئة بيانات الحجز لإتمام حجزك.");
      void (async () => {
        try {
          const offer = await findActiveOfferByCode(SALON_ID, normalizedCoupon);
          if (!offer) return;

          const appliesToServices = String((offer as any)?.appliesTo || "all").trim().toLowerCase() === "services";
          if (!appliesToServices) return;

          const rawServiceIds: unknown[] = Array.isArray((offer as any)?.serviceIds)
            ? (offer as any).serviceIds
            : [];
          const serviceIdSet = new Set<string>();
          for (const rawId of rawServiceIds) {
            const serviceId = String(rawId ?? "").trim();
            if (!serviceId) continue;
            serviceIdSet.add(serviceId);
          }
          const serviceIds: string[] = Array.from(serviceIdSet);
          if (!serviceIds.length) return;

          const choicesRaw: OfferServiceChoice[] = await Promise.all(
            serviceIds.map(async (rawServiceId: string): Promise<OfferServiceChoice> => {
              const serviceId = String(rawServiceId ?? "").trim();
              const sv = await ensureServiceByIdForOffer(serviceId);
              return {
                serviceId,
                serviceName: String(sv?.name || serviceId).trim() || serviceId,
              };
            })
          );
          const choices = choicesRaw.filter((x) => String(x.serviceId || "").trim());
          if (!choices.length) return;

          if (choices.length === 1) {
            const pickedServiceId = String(choices[0]?.serviceId || "").trim();
            if (!pickedServiceId) return;
            if (hasOfferServiceInCart) {
              setOfferLandingMsg("مسموح بإضافة خدمة عرض واحدة فقط في نفس الحجز.");
              return;
            }
            await addServiceToCart(pickedServiceId, {
              preventDuplicate: true,
              offerSourceId: String((offer as any)?.id || "").trim(),
              offerSourceCode: normalizedCoupon,
              offerSourceTitle: String((offer as any)?.title || "").trim() || "العرض",
            });
            setOfferLandingMsg("تم استخدام العرض بنجاح. اكملي اجراءات حجزك");
            setCurrentStep(2);
            return;
          }

          setOfferLandingMsg("العرض يشمل أكثر من خدمة. اختاري خدمة واحدة لتطبيق العرض عليها.");
          setOfferServicePicker({
            open: true,
            offerId: String((offer as any)?.id || "").trim(),
            offerTitle: String((offer as any)?.title || "").trim() || "العرض",
            couponCode: normalizedCoupon,
            choices,
            selectedServiceId: "",
            adding: false,
          });
        } catch {
          // no-op
        }
      })();
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
  }, [location.pathname, location.search, navigate, hasOfferServiceInCart]);

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

  // ✅ عرض السعر في الـ dropdown حسب (طور الموسم/العادي) + تاريخ الحجز المختار
  function servicePickerPriceText(sv: FlatService) {
    const eff = pickEffectivePrice({
      basePrice: Number(sv.basePrice || 0),
      seasonPrice: Number((sv as any).seasonPrice || 0) || undefined,
      appSettings,
      dateISO: String(bookingDate || "").trim() || todayISO(),
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
    const serviceId = String(id || "").trim();
    if (!serviceId) return null;
    const direct = servicesFlat.find((sv) => String(sv.id || "").trim() === serviceId) || null;
    if (direct) return direct;
    const cached = serviceByIdCacheRef.current[serviceId];
    return cached || null;
  };

  const ensureServiceByIdForOffer = async (idRaw: string): Promise<FlatService | null> => {
    const id = String(idRaw || "").trim();
    if (!id || id.startsWith("pkg:") || id.startsWith("offer:")) return null;

    const direct = getServiceById(id);
    if (direct) return direct;

    const cached = serviceByIdCacheRef.current[id];
    if (cached) return cached;

    try {
      const snap = await getDoc(doc(db, "salons", SALON_ID, "services", id));
      if (!snap.exists()) return null;
      const raw = snap.data() as any;
      if (raw?.active === false) return null;

      const name = readDisplayLabel(raw, id);
      if (!name) return null;

      const sectionId = String(raw?.sectionId || "").trim();
      const sectionTitle = (
        String(sectionLabelById.get(sectionId) || "").trim() ||
        readDisplayLabel(raw?.section, sectionId) ||
        sectionId ||
        "الخدمات"
      ).trim();

      const categoryId = String(raw?.categoryId || "").trim();
      const category = (
        String(categoryLabelById.get(categoryId) || "").trim() ||
        String(raw?.categoryName || raw?.category || "").trim() ||
        categoryId ||
        "عام"
      ).trim();

      const priceNum = Number((raw as any)?.["السعر"] ?? raw?.price ?? 0);
      const seasonPriceRaw =
        (raw as any)?.seasonPrice ??
        (raw as any)?.["سعر_الموسم"] ??
        (raw as any)?.season_price ??
        (raw as any)?.seasonPriceValue ??
        0;
      const seasonPriceNum = Number(String(seasonPriceRaw).replace(/[^\d.]/g, "")) || 0;
      const seasonPrice = seasonPriceNum > 0 ? seasonPriceNum : undefined;
      const durationMin = Number(
        (raw as any)?.["المدة"] ?? raw?.durationMin ?? DEFAULT_SERVICE_DURATION_MIN
      );

      const normalized: FlatService = {
        id,
        kind: "service",
        sectionId,
        sectionTitle,
        categoryId: categoryId || undefined,
        category: category || "عام",
        name,
        priceText: `${Number.isFinite(priceNum) ? priceNum : 0} ريال`,
        basePrice: Number.isFinite(priceNum) ? priceNum : 0,
        seasonPrice,
        durationMin,
        source: "firestore",
      };

      serviceByIdCacheRef.current[id] = normalized;
      return normalized;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    let cancelled = false;

    async function loadAllowedSessionPackageServices() {
      if (pickerScope !== "session_packages") {
        if (!cancelled) resetSessionPackageSelection();
        return;
      }

      const picked = selectedSessionPackage;
      if (!picked) {
        if (!cancelled) resetSessionPackageSelection();
        return;
      }

      const allowedIds = (Array.isArray(picked.allowedServiceIds) ? picked.allowedServiceIds : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean);
      if (!allowedIds.length) {
        if (!cancelled) {
          setSessionPackageAllowedServices([]);
          setSessionPackageServicesError("لا توجد خدمات متاحة داخل هذه الباقة.");
          setSessionPackageServicesLoading(false);
          setSessionPackageServicePicker([]);
        }
        return;
      }

      if (!cancelled) {
        setSessionPackageServicesLoading(true);
        setSessionPackageServicesError("");
        setSessionPackageAllowedServices([]);
        setSessionPackageServicePicker([]);
      }

      try {
        const rows = await Promise.all(
          allowedIds.map(async (serviceId) => {
            const cached = getServiceById(serviceId);
            if (cached?.kind === "service") return cached;
            const fetched = await ensureServiceByIdForOffer(serviceId);
            return fetched?.kind === "service" ? fetched : null;
          })
        );

        if (cancelled) return;

        const allowedServices = rows.filter(Boolean) as FlatService[];
        setSessionPackageAllowedServices(allowedServices);
        setSessionPackageServicePicker(
          allowedServices.length === 1 ? [String(allowedServices[0].id || "").trim()].filter(Boolean) : []
        );
        if (!allowedServices.length) {
          setSessionPackageServicesError("تعذر تحميل الخدمات المسموح بها داخل هذه الباقة.");
        }
      } catch {
        if (cancelled) return;
        setSessionPackageAllowedServices([]);
        setSessionPackageServicePicker([]);
        setSessionPackageServicesError("تعذر تحميل خدمات الباقة حالياً.");
      } finally {
        if (!cancelled) setSessionPackageServicesLoading(false);
      }
    }

    void loadAllowedSessionPackageServices();
    return () => {
      cancelled = true;
    };
  }, [pickerScope, selectedSessionPackage]);

  const serviceIdByName = useMemo(() => {
    const map = new Map<string, string>();
    (servicesFlat || []).forEach((sv) => {
      const id = String(sv.id || "").trim();
      const nameKey = String(sv.name || "").trim().toLowerCase();
      if (id && nameKey && !map.has(nameKey)) map.set(nameKey, id);
    });
    return map;
  }, [servicesFlat]);

  const resolveCanonicalServiceId = (rawId: string, rawName?: string) => {
    const id = String(rawId || "").trim();
    if (id && getServiceById(id)) return id;

    const idAsName = id ? serviceIdByName.get(id.toLowerCase()) : "";
    if (idAsName) return idAsName;

    const byName = String(rawName || "").trim();
    if (byName) {
      const hit = serviceIdByName.get(byName.toLowerCase());
      if (hit) return hit;
    }
    return id;
  };

  const normalizeSpecialty = (v: string) =>
    String(v || "")
      .trim()
      .toLowerCase()
      .replace(/[_\-–—/|]+/g, " ")
      .replace(/[^\p{L}\p{N}\s:]/gu, " ")
      .replace(/\s+/g, " ");

  const serviceIdBySpecialtyLabel = useMemo(() => {
    const map = new Map<string, string>();
    (servicesFlat || []).forEach((sv) => {
      const id = String(sv.id || "").trim();
      const nameKey = normalizeSpecialty(String(sv.name || ""));
      if (id && nameKey && !map.has(nameKey)) map.set(nameKey, id);
    });
    (formData.items || []).forEach((it) => {
      const id = String(it.serviceId || "").trim();
      const nameKey = normalizeSpecialty(String(it.serviceName || ""));
      if (id && nameKey && !map.has(nameKey)) map.set(nameKey, id);
    });
    return map;
  }, [servicesFlat, formData.items]);

  const normalizeStaffSpecialties = (st: any) => {
    if (!Array.isArray(st?.specialties)) return [];
    return st.specialties
      .map((x: any) => String(x || "").trim())
      .filter(Boolean)
      .map((raw: string) => {
        const n = normalizeSpecialty(raw);
        const mapped = serviceIdBySpecialtyLabel.get(n) || n;
        return normalizeSpecialty(mapped);
      });
  };

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

  const getAllActiveStaffCached = async (forceRefresh = false) => {
    const isFresh = Date.now() - Number(staffAllCacheLoadedAtRef.current || 0) < STAFF_DISPLAY_CACHE_TTL_MS;
    if (!forceRefresh && isFresh && Array.isArray(staffAllCacheRef.current)) return staffAllCacheRef.current;
    const all = await listActiveStaffAll(SALON_ID);
    staffAllCacheRef.current = Array.isArray(all) ? all : [];
    staffAllCacheLoadedAtRef.current = Date.now();
    return staffAllCacheRef.current;
  };

  const listStaffForService = async (serviceId: string, service?: FlatService | null, forceRefresh = false) => {
    const sid = String(serviceId || "").trim();
    if (!sid) return [] as StaffPublicWithId[];

    const target = service || getServiceById(sid);
    const resolverKey = buildStaffResolverKey(sid, target);
    const cached = staffByResolverCacheRef.current[resolverKey];
    if (!forceRefresh && Array.isArray(cached)) return cached;

    const inFlight = staffByResolverInFlightRef.current[resolverKey];
    if (!forceRefresh && inFlight) return inFlight;

    const wanted = new Set<string>();
    wanted.add(normalizeSpecialty(sid));
    wanted.add(normalizeSpecialty(String(target?.name || "")));
    wanted.add(normalizeSpecialty(String(target?.sectionId || "")));
    wanted.add(normalizeSpecialty(String(target?.categoryId || "")));

    if (target?.kind === "package") {
      (target.packageServiceIds || []).forEach((x: any) => wanted.add(normalizeSpecialty(String(x || ""))));
      (target.packageServices || []).forEach((x: any) => {
        wanted.add(normalizeSpecialty(String(x?.serviceId || "")));
        wanted.add(normalizeSpecialty(String(x?.serviceName || "")));
        wanted.add(normalizeSpecialty(String(x?.sectionId || "")));
        wanted.add(normalizeSpecialty(String(x?.categoryId || "")));
      });
    }

    const wantedKeys = Array.from(wanted).filter(Boolean);
    if (!wantedKeys.length) return [] as StaffPublicWithId[];

    const loadPromise: Promise<StaffPublicWithId[]> = (async () => {
      const all = await getAllActiveStaffCached(forceRefresh);
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

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    const refreshStaffDisplayData = () => {
      staffAllCacheRef.current = null;
      staffAllCacheLoadedAtRef.current = 0;
      staffByResolverCacheRef.current = {};
      staffByResolverInFlightRef.current = {};
      staffByServiceLoadedAtRef.current = {};
      staffDisplayLoadedIdsRef.current = new Set();
      setStaffDisplayById({});
      setStaffByService({});
      setStaffRefreshTick((tick) => tick + 1);
    };

    const handleVisibilityChange = () => {
      if (!document.hidden) refreshStaffDisplayData();
    };

    window.addEventListener("focus", refreshStaffDisplayData);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", refreshStaffDisplayData);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const ids = Array.from(
      new Set(
        Object.values(staffByService)
          .flat()
          .map((st: any) => String(st?.id || "").trim())
          .filter(Boolean)
      )
    ).filter((id) => !staffDisplayLoadedIdsRef.current.has(id));

    if (!ids.length) return;

    ids.forEach((id) => staffDisplayLoadedIdsRef.current.add(id));

    async function hydrateStaffDisplay() {
      const rows = await Promise.all(
        ids.map(async (id) => {
          try {
            const refDoc = doc(db, "salons", SALON_ID, "staff_public", id);
            const snap = await getDoc(refDoc);
            if (!snap.exists()) return null;
            return { id, ...(snap.data() as Record<string, any>) };
          } catch {
            return null;
          }
        })
      );

      if (cancelled) return;
      setStaffDisplayById((prev) => {
        const next = { ...prev };
        rows.forEach((row) => {
          const id = String(row?.id || "").trim();
          if (id && row) next[id] = { ...(prev[id] || {}), ...row };
        });
        return next;
      });
    }

    void hydrateStaffDisplay();
    return () => {
      cancelled = true;
    };
  }, [staffByService]);

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
        isStaffAvailableForDate(st, dateISO, { requireShowOnBooking: false })
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
          source: "Booking.autoPickStaffForSteps",
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

  const addServiceToCart = async (
    idRaw: string,
    options?: {
      preventDuplicate?: boolean;
      offerSourceId?: string;
      offerSourceCode?: string;
      offerSourceTitle?: string;
      preserveSelectionContext?: boolean;
      sessionPackageSelection?: {
        packageId: string;
        packageName: string;
        packagePrice: number;
        sessionsCount: number;
        allowedServiceIds: string[];
        allowedServicesSnapshot: PackageServiceItem[];
      };
    }
  ) => {
    let id = String(idRaw || "").trim();
    if (!id) return;
    const bookingDateISO = String(bookingDate || "").trim();

    if (id.startsWith("spkg:")) {
      openModal({
        title: "اختاري الخدمة من الباقة",
        message: "اختاري الباقة أولاً ثم حددي الخدمة التي تريدين استخدامها في هذه الزيارة.",
        variant: "danger",
      });
      return;
    }

    if (!options?.sessionPackageSelection && !id.startsWith("offer:") && !id.startsWith("pkg:")) {
      const packagePickerId = `pkg:${id}`;
      const existsAsPackage = packageOptions.some(
        (p) => String(p.id || "").trim() === packagePickerId
      );
      if (existsAsPackage) {
        id = packagePickerId;
      }
    }

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
            date: bookingDateISO,
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
      setServicePickerList([]);
      setOfferStartTime("");
      clearAppliedCoupons();
      return;
    }

    let sv = getServiceById(id);
    if (!sv) {
      sv = await ensureServiceByIdForOffer(id);
    }
    if (!sv) return;

    if (options?.sessionPackageSelection) {
      const sessionPackage = options.sessionPackageSelection;
      const toolsEligible = isToolsOptionEligibleForService(sv);
      const toolsSource = toolsEligible ? "client" : undefined;
      const priced = buildItemPriceWithTools(0, toolsSource, toolsEligible);
      const packageSnapshot: NonNullable<CartItem["packageSnapshot"]> = {
        packageId: String(sessionPackage.packageId || "").trim(),
        packageName: String(sessionPackage.packageName || "").trim() || "باقة جلسات",
        finalPriceAtBooking: Math.max(0, Number(sessionPackage.packagePrice || 0)),
        baseTotalPriceAtBooking: Math.max(0, Number(sessionPackage.packagePrice || 0)),
        totalDurationMinAtBooking: Math.max(
          1,
          Number(sv.durationMin || DEFAULT_SERVICE_DURATION_MIN)
        ),
        serviceIds: Array.isArray(sessionPackage.allowedServiceIds)
          ? sessionPackage.allowedServiceIds
          : [],
        services: Array.isArray(sessionPackage.allowedServicesSnapshot)
          ? sessionPackage.allowedServicesSnapshot
          : [],
        sessionsCount: Math.max(1, Number(sessionPackage.sessionsCount || 1)),
        kind: "session_package",
      };

      setFormData((prev) => ({
        ...prev,
        items: [
          ...(prev.items || []),
          {
            id: makeLocalId(),
            serviceId: id,
            serviceName: sv.name,

            fromSessionPackage: true,
            sessionPackageId: String(sessionPackage.packageId || "").trim(),
            sessionPackageName: String(sessionPackage.packageName || "").trim() || undefined,
            consumeOneSession: true,

            packageId: String(sessionPackage.packageId || "").trim() || undefined,
            packageSnapshot,

            serviceBasePrice: 0,
            basePrice: priced.basePrice,
            priceText:
              Math.max(0, Number(priced.basePrice || 0)) <= 0 ? "من الباقة" : priced.priceText,

            displayPriceText: "من الباقة",
            displayPriceKind: "included_in_package",
            displayPackageLabel: String(sessionPackage.packageName || "").trim() || "باقة جلسات",
            displayStaffName: "",
            displayDateLabel: bookingDateISO,
            displayTimeLabel: "",

            durationMin: Number(sv.durationMin || DEFAULT_SERVICE_DURATION_MIN),
            employeeId: "",
            employeeUid: "",
            employeeName: "",
            date: bookingDateISO,
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
      setServicePickerList([]);
      resetSessionPackageSelection();
      setSelectedCategory("");
      setSelectedSectionId("");
      setShowHairGuide(false);
      setOfferStartTime("");
      clearAppliedCoupons();
      return;
    }

    if (sv.kind === "package") {
      const pkgServices = Array.isArray(sv.packageServices) ? sv.packageServices : [];
      const pkgServiceIds = (Array.isArray(sv.packageServiceIds) ? sv.packageServiceIds : [])
        .map((x) => String(x || "").trim())
        .filter(Boolean);
      const serviceIdsFromMeta = pkgServices
        .map((x: any) =>
          String(
            x?.serviceId ||
            x?.id ||
            x?.service?.id ||
            ""
          ).trim()
        )
        .filter(Boolean);
      const serviceIds = serviceIdsFromMeta.length ? serviceIdsFromMeta : pkgServiceIds;
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
      const packageFinal = resolveFlatServicePackageFinalPrice(sv);
      const packageBaseTotal = resolveFlatServicePackageBaseTotalPrice(sv);
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
        baseTotalPriceAtBooking: packageBaseTotal > 0 ? packageBaseTotal : Number(baseTotal || targetTotal),
        totalDurationMinAtBooking: Number(sv.durationMin || DEFAULT_SERVICE_DURATION_MIN),
        serviceIds: serviceIds,
        services: pkgServices,
        kind: "service_package" as const,
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
          date: bookingDateISO,
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
      setServicePickerList([]);
      if (!options?.preserveSelectionContext) {
        setSelectedCategory("");
        setSelectedSectionId("");
        setShowHairGuide(false);
      }
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

    setFormData((prev) => {
      const prevItems = prev.items || [];
      const duplicateIdx = prevItems.findIndex((it) => String(it.serviceId || "").trim() === id);
      if (options?.preventDuplicate && duplicateIdx !== -1) {
        const offerSourceId = String(options?.offerSourceId || "").trim();
        if (offerSourceId) {
          const nextItems = [...prevItems];
          const target = nextItems[duplicateIdx];
          if (target && !String(target.offerSourceId || "").trim()) {
            nextItems[duplicateIdx] = {
              ...target,
              offerSourceId,
              offerSourceCode:
                normalizeCouponCode(String(options?.offerSourceCode || "").trim()) || undefined,
              offerSourceTitle: String(options?.offerSourceTitle || "").trim() || undefined,
            };
            return {
              ...prev,
              items: nextItems,
            };
          }
        }
        return prev;
      }
      return {
        ...prev,
        items: [
          ...prevItems,
          {
            id: makeLocalId(),
            serviceId: id,
            serviceName: sv.name,
            offerSourceId: String(options?.offerSourceId || "").trim() || undefined,
            offerSourceCode: normalizeCouponCode(String(options?.offerSourceCode || "").trim()) || undefined,
            offerSourceTitle: String(options?.offerSourceTitle || "").trim() || undefined,
            packageId: sv.kind === "package" ? String(sv.packageId || "").trim() : undefined,
            packageSnapshot:
              sv.kind === "package" && sv.packageId
                ? {
                  packageId: String(sv.packageId || "").trim(),
                  packageName: sv.name,
                  finalPriceAtBooking: resolveFlatServicePackageFinalPrice(sv),
                  baseTotalPriceAtBooking: resolveFlatServicePackageBaseTotalPrice(sv),
                  totalDurationMinAtBooking: Number(sv.durationMin || DEFAULT_SERVICE_DURATION_MIN),
                  serviceIds: Array.isArray(sv.packageServiceIds) ? sv.packageServiceIds : [],
                  services: Array.isArray(sv.packageServices) ? sv.packageServices : [],
                  kind: "service_package" as const,
                }
                : undefined,
            serviceBasePrice: priced.serviceBasePrice,
            basePrice: priced.basePrice,
            priceText: priced.priceText,
            durationMin: Number(sv.durationMin || DEFAULT_SERVICE_DURATION_MIN),
            employeeId: "",
            employeeUid: "",
            employeeName: "",
            date: bookingDateISO,
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
      };
    });

    setServicePicker("");
    setServicePickerList([]);
    if (!options?.preserveSelectionContext) {
      setSelectedCategory("");
      setSelectedSectionId("");
      setShowHairGuide(false);
    }

    clearAppliedCoupons();
  };

  const addOfferFromPicker = async () => {
    const pick = String(servicePicker || "").trim();
    if (!pick.startsWith("offer:")) return;

    const offerId = String(pick.slice("offer:".length) || "").trim();
    if (!offerId) return;
    if (hasOfferServiceInCart) {
      setOfferMsgKind("error");
      setOfferMsg("مسموح بإضافة خدمة عرض واحدة فقط في نفس الحجز.");
      return;
    }

    const offer = (sequenceOffers || []).find(
      (o: any) => String((o as any)?.id || "").trim() === offerId
    );
    if (!offer) {
      setOfferMsgKind("error");
      setOfferMsg("تعذر تحميل العرض المحدد.");
      return;
    }

    const autoCode = normalizeCouponCode(String((offer as any)?.code || "").trim());
    if (autoCode) {
      setCouponCode(autoCode);
      setPendingAutoCouponCode(autoCode);
    }

    const rawServiceIds: string[] = [];
    if (Array.isArray((offer as any)?.serviceIds)) {
      for (const rawId of (offer as any).serviceIds) {
        const sid = String(rawId || "").trim();
        if (sid) rawServiceIds.push(sid);
      }
    }
    if (Array.isArray((offer as any)?.sequenceSteps)) {
      for (const row of (offer as any).sequenceSteps) {
        const sid = String((row as any)?.serviceId || "").trim();
        if (sid) rawServiceIds.push(sid);
      }
    }
    const serviceIds = Array.from(new Set(rawServiceIds));

    if (serviceIds.length > 0) {
      const choicesRaw: OfferServiceChoice[] = await Promise.all(
        serviceIds.map(async (rawServiceId: string): Promise<OfferServiceChoice> => {
          const sid = String(rawServiceId || "").trim();
          const sv = await ensureServiceByIdForOffer(sid);
          return {
            serviceId: sid,
            serviceName: String(sv?.name || sid).trim() || sid,
          };
        })
      );
      const choices = choicesRaw.filter((x) => String(x.serviceId || "").trim());

      if (!choices.length) {
        setOfferMsgKind("error");
        setOfferMsg("تعذر تحميل خدمات العرض.");
        setServicePicker("");
        return;
      }

      if (choices.length === 1) {
        const pickedServiceId = String(choices[0]?.serviceId || "").trim();
        await addServiceToCart(pickedServiceId, {
          preventDuplicate: true,
          offerSourceId: String((offer as any)?.id || "").trim(),
          offerSourceCode: autoCode,
          offerSourceTitle: String((offer as any)?.title || "").trim() || "العرض",
        });
        setOfferMsgKind("success");
        setOfferMsg("تم اختيار العرض وتفعيل الخصم تلقائيًا.");
        resetBookingPickerForNextAdd();
        return;
      }

      setOfferServicePicker({
        open: true,
        offerId: String((offer as any)?.id || "").trim(),
        offerTitle: String((offer as any)?.title || "").trim() || "العرض",
        couponCode: autoCode,
        choices,
        selectedServiceId: "",
        adding: false,
      });
      setOfferMsgKind("success");
      setOfferMsg("اختاري الخدمة المطلوبة من العرض لإضافتها.");
      setServicePicker("");
      return;
    }

    setOfferMsgKind("success");
    setOfferMsg("تم تفعيل كود العرض تلقائيًا. اختاري الخدمة لإكمال الحجز.");
    setServicePicker("");
  };

  const closeOfferServicePicker = () => {
    setOfferServicePicker((prev) => ({
      ...prev,
      open: false,
      adding: false,
    }));
  };

  const closeCouponTargetPicker = () => {
    setCouponTargetPicker((prev) => ({
      ...prev,
      open: false,
      applying: false,
    }));
  };

  const confirmCouponTargetPicker = async () => {
    const pickedItemId = String(couponTargetPicker.selectedItemId || "").trim();
    const code = normalizeCouponCode(couponTargetPicker.code || couponCode);
    if (!pickedItemId || !code || couponTargetPicker.applying) return;

    setCouponTargetPicker((prev) => ({ ...prev, applying: true }));
    try {
      const status = await applyCouponCode(code, {
        clearInputOnSuccess: couponTargetPicker.clearInputOnSuccess,
        suppressAlreadyAppliedMsg: couponTargetPicker.suppressAlreadyAppliedMsg,
        suppressRetryableErrors: couponTargetPicker.suppressRetryableErrors,
        forcedItemId: pickedItemId,
      });

      if (
        status === "applied" ||
        status === "already_applied" ||
        status === "single_coupon_only" ||
        status === "invalid_or_expired" ||
        status === "no_discount" ||
        status === "error" ||
        status === "no_applicable_services" ||
        status === "selected_service_unavailable"
      ) {
        closeCouponTargetPicker();
        return;
      }
    } finally {
      setCouponTargetPicker((prev) => ({ ...prev, applying: false }));
    }
  };

  const confirmOfferServicePicker = async () => {
    const pickedServiceId = String(offerServicePicker.selectedServiceId || "").trim();
    if (!pickedServiceId || offerServicePicker.adding) return;
    if (hasOfferServiceInCart) {
      setOfferMsgKind("error");
      setOfferMsg("مسموح بإضافة خدمة عرض واحدة فقط في نفس الحجز.");
      closeOfferServicePicker();
      return;
    }

    setOfferServicePicker((prev) => ({ ...prev, adding: true }));
    try {
      await addServiceToCart(pickedServiceId, {
        preventDuplicate: true,
        offerSourceId: String(offerServicePicker.offerId || "").trim(),
        offerSourceCode: normalizeCouponCode(offerServicePicker.couponCode || couponCode),
        offerSourceTitle: String(offerServicePicker.offerTitle || "").trim() || "العرض",
      });
      const autoCode = normalizeCouponCode(offerServicePicker.couponCode || couponCode);
      if (autoCode) {
        setCouponCode(autoCode);
        setPendingAutoCouponCode(autoCode);
      }
      setOfferMsgKind("success");
      setOfferMsg("تم اختيار الخدمة للعرض بنجاح.");
      resetBookingPickerForNextAdd();
      setCurrentStep(2);
    } catch {
      setOfferMsgKind("error");
      setOfferMsg("تعذر إضافة الخدمة المختارة من العرض، حاولي مرة أخرى.");
    } finally {
      setOfferServicePicker((prev) => ({
        ...prev,
        open: false,
        adding: false,
      }));
    }
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
    const autoAddRaw = String(autoAddPackageId || "").trim();
    if (!autoAddRaw) return;
    const packageDocId = autoAddRaw.startsWith("pkg:")
      ? String(autoAddRaw.slice("pkg:".length) || "").trim()
      : autoAddRaw;
    const pid = packageDocId ? `pkg:${packageDocId}` : autoAddRaw;
    const hasPackage = packageOptions.some((p) => {
      const optionId = String(p.id || "").trim();
      return optionId === pid || optionId === packageDocId;
    });
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
    const currentItems = formData.items || [];
    const currentItem = currentItems.find((x) => String(x.id || "").trim() === String(itemId || "").trim());
    if (!currentItem) return;

    const nextCandidate = { ...currentItem, ...patch };
    const shouldCheckExactCartConflict =
      !isSequentialOfferItem(nextCandidate as CartItem) &&
      (patch.employeeId !== undefined || patch.date !== undefined || patch.time !== undefined);

    if (shouldCheckExactCartConflict) {
      const conflict = findExactCartSlotConflict(currentItems, itemId, nextCandidate);
      if (conflict) {
        openModal({
          title: "تعارض داخل السلة",
          message:
            "هذا الوقت محجوز لنفس الموظفة داخل السلة، اختاري وقت مختلف.",
          variant: "danger",
          confirmText: "حسنًا",
        });
        return;
      }
    }

    setFormData((prev) => {
      const list = prev.items || [];
      const idx = list.findIndex((x) => x.id === itemId);
      if (idx < 0) return prev;

      const nextItems = list.map((it, i) => {
        if (i === idx) {
          const merged = { ...it, ...patch };

          return {
            ...merged,
            displayStaffName: String(merged.employeeName || "").trim(),
            displayDateLabel: String(merged.date || "").trim(),
            displayTimeLabel: String(merged.time || "").trim(),
            displayPriceText: resolveCartItemPriceText(merged),
            displayPriceKind: isSessionPackageCartItem(merged) ? "included_in_package" : "regular",
            displayPackageLabel:
              String(
                merged.sessionPackageName ||
                merged.packageSnapshot?.packageName ||
                ""
              ).trim(),
          };
        }
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

    const baseFromItem = isSessionPackageCartItem(it)
      ? 0
      : Number((it as any)?.serviceBasePrice ?? 0) ||
      Math.max(0, Number(it.basePrice || 0) - Number(it.toolsFeeApplied || 0));

    const priced = buildItemPriceWithTools(baseFromItem, nextSource, true);
    updateItem(it.id, {
      toolsSource: nextSource,
      serviceBasePrice: priced.serviceBasePrice,
      toolsFeeApplied: priced.toolsFeeApplied,
      basePrice: priced.basePrice,
      priceText: isSessionPackageCartItem(it)
        ? resolveCartItemPriceText({ ...it, ...priced, priceText: priced.priceText })
        : priced.priceText,
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
            .map((it) =>
              resolveCanonicalServiceId(
                String(it.serviceId || "").trim(),
                String((it as any)?.serviceName || "").trim()
              )
            )
            .filter(Boolean)
        )
      );

      if (!serviceIds.length) return;

      for (const sid of serviceIds) {
        if (cancelled) return;
        const loadedAt = Number(staffByServiceLoadedAtRef.current[sid] || 0);
        const hasFreshRows =
          staffByService[sid] &&
          Array.isArray(staffByService[sid]) &&
          Date.now() - loadedAt < STAFF_DISPLAY_CACHE_TTL_MS;
        if (hasFreshRows) continue;
        const fromCart = (formData.items || []).find(
          (x) =>
            resolveCanonicalServiceId(
              String(x.serviceId || "").trim(),
              String((x as any)?.serviceName || "").trim()
            ) === sid
        );
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
        const useResolverCache = Array.isArray(cachedRows) && Date.now() - loadedAt < STAFF_DISPLAY_CACHE_TTL_MS;
        if (useResolverCache) {
          setStaffByService((p) => ({ ...p, [sid]: cachedRows }));
          staffByServiceLoadedAtRef.current[sid] = Date.now();
          continue;
        }

        try {
          setStaffLoadingByService((p) => ({ ...p, [sid]: true }));
          setStaffErrorByService((p) => ({ ...p, [sid]: "" }));
          const res = await listStaffForService(sid, sv, true);

          if (cancelled) return;

          // تصفية إضافية: تأكد إن الموظفة فعلاً عندها هذي التخصص (Firestore قد يرجع الكل أحياناً)
          const normalized = (res || []).filter((st: any) => {
            const name = String(st?.name || "").trim();
            if (!name) return false;
            return true;
          });

          setStaffByService((p) => ({ ...p, [sid]: normalized }));
          staffByServiceLoadedAtRef.current[sid] = Date.now();

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
          staffByServiceLoadedAtRef.current[sid] = Date.now();
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
  }, [formData.items, staffRefreshTick]);

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
      const dateISO = String(ordered[0]?.date || bookingDate || todayISO()).trim();
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
          const leave = getStaffLeaveMetaForDate(st, dateISO);
          return !leave.isOnLeave;
        });
        const strictByService = list.filter((st: any) => {
          const specs = normalizeStaffSpecialties(st);
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

    const dateISO = String(runMeta.dateISO || bookingDate || todayISO()).trim();
    const selectedStaff = quickCommonStaff.find(
      (st: any) => String(st?.id || "").trim() === employeeId
    );
    if (!selectedStaff) return;

    const employeeKey =
      String((selectedStaff as any)?.linkedUid || "").trim() ||
      String((selectedStaff as any)?.id || "").trim();
    const employeeIdFallback = String((selectedStaff as any)?.id || "").trim();
    const dayCfg = getDaySettingsForDate(dateISO);
    const dayOpenTime = safeTimeHHMM(dayCfg.openTime, openTime);
    const dayCloseTime = safeTimeHHMM(dayCfg.closeTime, closeTime);
    const baseSlots = generateSalonTimeSlots(dayOpenTime, dayCloseTime, slotStepMin);
    setPackageQuickByRun((prev) => ({
      ...prev,
      [runId]: { employeeId, times: [], loading: true, error: "" },
    }));
    if (!baseSlots.length) {
      setPackageQuickByRun((prev) => ({
        ...prev,
        [runId]: {
          employeeId,
          times: [],
          loading: false,
          error: "لا توجد أوقات متاحة في يوم الحجز المختار.",
        },
      }));
      return;
    }

    try {
      const takenFs = await collectTakenTimesForEmployeeDay({
        salonId: SALON_ID,
        employeeKey,
        employeeIdFallback,
        dateISO,
        source: "Booking.loadPackageQuickTimes",
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
    const dateISO = String(runMeta.dateISO || bookingDate || todayISO()).trim();
    const selectedStaff = quickCommonStaff.find(
      (st: any) => String(st?.id || "").trim() === employeeId
    );
    if (!selectedStaff) return;

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
        source: "Booking.applyPackageQuickSelection",
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

  // ✅ Default to first truly available staff only (never on leave/off-hours/inactive).
  useEffect(() => {
    if (currentStep !== 2) return;
    let cancelled = false;

    const isInactiveForBooking = (staff: StaffPublicWithId) => {
      const statusRaw = String((staff as any)?.status || "").trim().toLowerCase();
      return (
        (staff as any)?.active === false ||
        (staff as any)?.showOnBooking === false ||
        statusRaw === "inactive" ||
        statusRaw === "disabled" ||
        statusRaw === "suspended"
      );
    };

    async function ensureDefaultStaffSelection() {
      const items = formData.items || [];
      if (!items.length) return;

      const patches: Array<{ itemId: string; contextKey: string; patch: Partial<CartItem> }> = [];

      for (const it of items) {
        if (cancelled) return;
        if (isSequentialOfferItem(it)) continue;

        const itemId = String(it.id || "").trim();
        const serviceKey =
          resolveCanonicalServiceId(
            String(it.serviceId || "").trim(),
            String((it as any)?.serviceName || "").trim()
          ) || String(it.serviceId || "").trim();
        const dateISO = String(it.date || bookingDate || "").trim();
        if (!itemId || !serviceKey || !dateISO) continue;
        const dayCfg = getDaySettingsForDate(dateISO);
        if (!dayCfg.enabled) continue;
        const dayOpenTime = safeTimeHHMM(dayCfg.openTime, openTime);
        const dayCloseTime = safeTimeHHMM(dayCfg.closeTime, closeTime);
        const baseSlotsForDate = generateSalonTimeSlots(dayOpenTime, dayCloseTime, slotStepMin);
        if (!baseSlotsForDate.length) continue;

        const contextKey = `${serviceKey}|${dateISO}`;
        const serviceStaff = (staffByService[serviceKey] || []) as StaffPublicWithId[];
        if (!serviceStaff.length) continue;

        const bookingVisibleStaff = serviceStaff.filter(
          (st) => !isStaffEmploymentEndedForDate(st as any, dateISO)
        );

        const candidateStaff = bookingVisibleStaff.filter((st) => {
          const leave = getStaffLeaveMetaForDate(st, dateISO);
          if (leave.isOnLeave) return false;
          if (isInactiveForBooking(st)) return false;
          const workingSlots = filterStaffSlotsByWorkingHours(st as any, {
            dateISO,
            slots: baseSlotsForDate,
            fallbackOpenTime: dayOpenTime,
            fallbackCloseTime: dayCloseTime,
          });
          return workingSlots.length > 0;
        });

        const hasCurrentSelection =
          !!String(it.employeeId || "").trim() ||
          !!String(it.employeeUid || "").trim() ||
          !!String(it.employeeName || "").trim();
        // Never override user's explicit staff choice.
        if (hasCurrentSelection) continue;
        if (manualStaffChoiceContextRef.current[itemId] === contextKey) continue;

        const hasAvailableStarts = async (staff: StaffPublicWithId) => {
          const empId = String((staff as any)?.id || "").trim();
          const empKey = String((staff as any)?.linkedUid || "").trim() || empId;
          if (!empId || !empKey) return false;
          const localTaken = getLocalTakenTimesForItem(
            items,
            itemId,
            empKey,
            dateISO,
            empId
          );
          const starts = await getAvailableStartsForDay({
            salonId: SALON_ID,
            employeeKey: empKey,
            employeeIdFallback: empId,
            dateISO,
            durationMin: Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN),
            take: 1,
            localTakenTimes: localTaken,
            staff,
            source: "Booking.ensureDefaultStaffSelection",
          });
          return starts.length > 0;
        };

        let firstTrulyAvailable: StaffPublicWithId | null = null;
        for (const st of candidateStaff) {
          if (await hasAvailableStarts(st)) {
            firstTrulyAvailable = st;
            break;
          }
        }

        if (firstTrulyAvailable) {
          const nextEmployeeId = String((firstTrulyAvailable as any)?.id || "").trim();
          const nextEmployeeUid = String((firstTrulyAvailable as any)?.linkedUid || "").trim();
          const nextEmployeeName = String((firstTrulyAvailable as any)?.name || "").trim();

          const autoPickAllowedForEmpty =
            autoStaffDefaultContextRef.current[itemId] !== contextKey;
          if (!autoPickAllowedForEmpty) continue;

          patches.push({
            itemId,
            contextKey,
            patch: {
              employeeId: nextEmployeeId,
              employeeUid: nextEmployeeUid,
              employeeName: nextEmployeeName,
              time: "",
              locked: false,
            },
          });
          continue;
        }

        // No available staff for this context with empty selection:
        // keep card unlocked and clear stale time only.
        if (!!String(it.time || "").trim() || !!it.locked) {
          patches.push({
            itemId,
            contextKey,
            patch: {
              time: "",
              locked: false,
            },
          });
        }
      }

      if (cancelled || !patches.length) return;

      setFormData((prev) => {
        const patchById = new Map(patches.map((p) => [p.itemId, p.patch]));
        let changed = false;
        const nextItems = (prev.items || []).map((it) => {
          const itemId = String(it.id || "").trim();
          const patch = patchById.get(itemId);
          if (!patch) return it;
          const willChange = Object.entries(patch).some(([k, v]) => (it as any)?.[k] !== v);
          if (!willChange) return it;
          changed = true;
          return { ...it, ...patch };
        });
        return changed ? { ...prev, items: nextItems } : prev;
      });

      patches.forEach((p) => {
        const pickedEmployeeId = String((p.patch as any)?.employeeId || "").trim();
        if (pickedEmployeeId) {
          autoStaffDefaultContextRef.current[p.itemId] = p.contextKey;
        }
      });
    }

    void ensureDefaultStaffSelection();
    return () => {
      cancelled = true;
    };
  }, [
    currentStep,
    formData.items,
    staffByService,
    timeSlots,
    openTime,
    closeTime,
    slotStepMin,
    bufferMin,
    bookingDate,
  ]);

  useEffect(() => {
    if (currentStep !== 2) {
      setStaffFullDayByItem({});
      return;
    }

    let cancelled = false;

    async function loadStaffFullDayState() {
      const items = formData.items || [];
      if (!items.length) {
        if (!cancelled) setStaffFullDayByItem({});
        return;
      }

      const nextState: Record<string, Record<string, boolean>> = {};
      const availabilityCache = new Map<string, Promise<boolean>>();
      const tasks: Promise<void>[] = [];

      for (const it of items) {
        if (isSequentialOfferItem(it)) continue;

        const itemId = String(it.id || "").trim();
        const dateISO = String(it.date || bookingDate || "").trim();
        if (!itemId || !dateISO) continue;

        const dayCfg = getDaySettingsForDate(dateISO);
        if (!dayCfg.enabled) continue;

        const dayOpenTime = safeTimeHHMM(dayCfg.openTime, openTime);
        const dayCloseTime = safeTimeHHMM(dayCfg.closeTime, closeTime);
        const baseSlotsForDate = generateSalonTimeSlots(dayOpenTime, dayCloseTime, slotStepMin);
        if (!baseSlotsForDate.length) continue;

        const serviceKey =
          resolveCanonicalServiceId(
            String(it.serviceId || "").trim(),
            String((it as any)?.serviceName || "").trim()
          ) || String(it.serviceId || "").trim();
        if (!serviceKey) continue;

        const serviceStaff = (staffByService[serviceKey] || []) as StaffPublicWithId[];
        if (!serviceStaff.length) continue;

        const bookingVisibleStaff = serviceStaff.filter(
          (st) => !isStaffEmploymentEndedForDate(st as any, dateISO)
        );
        if (!bookingVisibleStaff.length) continue;

        nextState[itemId] = nextState[itemId] || {};

        for (const st of bookingVisibleStaff) {
          const empId = String((st as any)?.id || "").trim();
          if (!empId) continue;
          nextState[itemId][empId] = false;

          tasks.push(
            (async () => {
              if (cancelled) return;
              const leave = getStaffLeaveMetaForDate(st as any, dateISO);
              const statusRaw = String((st as any)?.status || "").trim().toLowerCase();
              const isInactive =
                (st as any)?.active === false ||
                (st as any)?.showOnBooking === false ||
                statusRaw === "inactive" ||
                statusRaw === "disabled" ||
                statusRaw === "suspended";
              const workingSlots = filterStaffSlotsByWorkingHours(st as any, {
                dateISO,
                slots: baseSlotsForDate,
                fallbackOpenTime: dayOpenTime,
                fallbackCloseTime: dayCloseTime,
              });

              if (leave.isOnLeave || isInactive || !workingSlots.length) {
                nextState[itemId][empId] = false;
                return;
              }

              const empKey = String((st as any)?.linkedUid || "").trim() || empId;
              const localTaken = getLocalTakenTimesForItem(
                items,
                itemId,
                empKey,
                dateISO,
                empId
              );
              const cacheKey = [
                serviceKey,
                empId,
                dateISO,
                String(Math.max(1, Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN))),
                Array.from(localTaken).sort().join(","),
              ].join("__");

              if (!availabilityCache.has(cacheKey)) {
                if (cancelled) return;
                availabilityCache.set(
                  cacheKey,
                  getAvailableStartsForDay({
                    salonId: SALON_ID,
                    employeeKey: empKey,
                    employeeIdFallback: empId,
                    dateISO,
                    durationMin: Math.max(
                      1,
                      Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN)
                    ),
                    take: 1,
                    localTakenTimes: localTaken,
                    staff: st,
                    source: "Booking.loadStaffFullDayState",
                  })
                    .then((starts) => starts.length > 0)
                    .catch(() => true)
                );
              }

              if (cancelled) return;
              const hasAvailable = await availabilityCache.get(cacheKey)!;
              nextState[itemId][empId] = !hasAvailable;
            })()
          );
        }
      }

      await Promise.all(tasks);
      if (cancelled) return;
      setStaffFullDayByItem(nextState);
    }

    const t = window.setTimeout(() => {
      if (cancelled) return;
      void loadStaffFullDayState();
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [
    currentStep,
    formData.items,
    staffByService,
    bookingDate,
    openTime,
    closeTime,
    slotStepMin,
    bufferMin,
  ]);

  async function collectTakenTimesForEmployeeDay(args: {
    salonId: string;
    employeeKey: string;
    employeeIdFallback: string;
    dateISO: string;
    forceFresh?: boolean;
    source?: string;
  }) {
    const { salonId, employeeKey, employeeIdFallback, dateISO, forceFresh, source } = args;
    const key = String(employeeKey || "").trim();
    const fallbackId = String(employeeIdFallback || "").trim();
    const cacheKey = `${String(salonId || "").trim()}__${String(dateISO || "").trim()}__${key}__${fallbackId}`;
    const now = Date.now();
    const logSource =
      String(source || "").trim() || "Booking.collectTakenTimesForEmployeeDay";

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

      // ✅ Preferred: 1 doc read per employee/day (availability_days), trusted only when `complete=true`.
      if (fallbackId) {
        const aRef = doc(db, "salons", salonId, "availability_days", dateISO, "employees", fallbackId);
        FirestoreReadStats.bump(aRef.path, logSource, "getDoc");
        const aSnap = await getDoc(aRef);
        if (aSnap.exists()) {
          const a: any = aSnap.data() || {};
          if (a.complete === true) {
            const bookedSlots = normalizeBookedSlotsMap(a.bookedSlots);
            Object.keys(bookedSlots).forEach((t) => {
              const k = String(t || "").trim();
              if (k) takenFs.add(k);
            });
            takenTimesCacheRef.current[cacheKey] = {
              ts: Date.now(),
              values: Array.from(takenFs),
            };
            return Array.from(takenFs);
          }
        }
      }

      const colSlots = collection(db, "salons", salonId, "booking_slots");

      // Canonical: employeeId (staff_public doc id). Avoid doing both queries unless necessary,
      // otherwise the same `booking_slots` docs are read twice (hotspot).
      const snaps: any[] = [];
      if (fallbackId) {
        snaps.push(
          await getDocs(
            query(colSlots, where("employeeId", "==", fallbackId), where("date", "==", dateISO))
          )
        );
      } else if (key) {
        snaps.push(
          await getDocs(
            query(colSlots, where("employeeKey", "==", key), where("date", "==", dateISO))
          )
        );
      }

      // Fallback to employeeKey only if employeeId path returned nothing (legacy/inconsistent data).
      if (key && fallbackId && key !== fallbackId && snaps.length && Number(snaps[0]?.size || 0) === 0) {
        snaps.push(
          await getDocs(
            query(colSlots, where("employeeKey", "==", key), where("date", "==", dateISO))
          )
        );
      }

      snaps.forEach((snap) => {
        snap.docs.forEach((d: any) => {
          if (d?.ref?.path) {
            FirestoreReadStats.bump(d.ref.path, logSource, "getDocs");
          }
          const t = String((d.data() as any)?.time || "").trim();
          if (t) takenFs.add(t);
        });
      });
      takenTimesCacheRef.current[cacheKey] = {
        ts: Date.now(),
        values: Array.from(takenFs),
      };
      return Array.from(takenFs);
    })();

    takenTimesInFlightRef.current[cacheKey] = pending;
    try {
      const rows = await pending;
      return new Set<string>(rows);
    } finally {
      delete takenTimesInFlightRef.current[cacheKey];
    }
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
    source?: string;
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
      source,
    } = args;

    const dayCfg = getDaySettingsForDate(dateISO);
    if (!dayCfg.enabled) return [];
    const dayOpenTime = safeTimeHHMM(dayCfg.openTime, openTime);
    const dayCloseTime = safeTimeHHMM(dayCfg.closeTime, closeTime);

    const baseSlots = generateSalonTimeSlots(dayOpenTime, dayCloseTime, slotStepMin);

    if (!baseSlots.length) return [];

    const takenFs = await collectTakenTimesForEmployeeDay({
      salonId,
      employeeKey,
      employeeIdFallback,
      dateISO,
      source: source || "Booking.getAvailableStartsForDay",
    });

    const takenAll = new Set<string>(takenFs);
    (localTakenTimes || new Set<string>()).forEach((x) => takenAll.add(x));

    const normalizedDuration = Number(durationMin || DEFAULT_SERVICE_DURATION_MIN);
    const slotsForThisService = filterSlotsByServiceEnd(
      baseSlots,
      dayCloseTime,
      normalizedDuration,
      bufferMin,
      ALLOW_OVERTIME_MIN
    );

    if (!slotsForThisService.length) return [];

    let staffScopedSlots = slotsForThisService;
    if (staff) {
      const staffWindows = resolveStaffWorkingWindowsForDate(staff as any, {
        dateISO,
        fallbackOpenTime: dayOpenTime,
        fallbackCloseTime: dayCloseTime,
      });
      if (!staffWindows.length) return [];
      const workingStarts = filterStaffSlotsByWorkingHours(staff as any, {
        dateISO,
        slots: slotsForThisService,
        fallbackOpenTime: dayOpenTime,
        fallbackCloseTime: dayCloseTime,
      });
      const orderedByValue = new Map<string, TimeSlot>(
        (slotsForThisService || [])
          .map((slot) => [String(slot?.value24 || "").trim(), slot] as const)
          .filter(([k]) => !!k)
      );
      const allowedByValue = new Set<string>();
      for (const window of staffWindows) {
        const scopedWindowStarts = (workingStarts || []).filter((slot) =>
          isTimeInsideWindowRange(
            String(slot?.value24 || "").trim(),
            String(window.start || "").trim(),
            String(window.end || "").trim()
          )
        );
        const allowedInWindow = filterSlotsByServiceEnd(
          scopedWindowStarts,
          String(window.end || "").trim(),
          normalizedDuration,
          bufferMin,
          ALLOW_OVERTIME_MIN
        );
        for (const slot of allowedInWindow) {
          const value = String(slot?.value24 || "").trim();
          if (value) allowedByValue.add(value);
        }
      }
      staffScopedSlots = (slotsForThisService || []).filter((slot) =>
        allowedByValue.has(String(slot?.value24 || "").trim())
      );
      if (!staffScopedSlots.length) {
        // Keep deterministic order from the original day slots.
        staffScopedSlots = Array.from(orderedByValue.entries())
          .filter(([value]) => allowedByValue.has(value))
          .map(([, slot]) => slot);
      }
    }

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

  async function runFutureAvailabilitySearch(opts?: {
    serviceId?: string;
    targetItemId?: string;
    employeeKey?: string;
    startISO?: string;
  }) {
    setFutureMsg("");
    setFutureResult([]);
    const serviceId = String(opts?.serviceId || futureServiceId || servicePicker || "").trim();
    if (!serviceId) {
      setFutureMsg("اختاري الخدمة أولاً.");
      return [] as { date: string; times: string[] }[];
    }

    const sv = getServiceById(serviceId);
    const itemFromCart = (formData.items || []).find(
      (it) => String(it?.serviceId || "").trim() === serviceId
    );
    const targetItemId = String(
      opts?.targetItemId ||
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
      return [] as { date: string; times: string[] }[];
    }

    let staffList = (staffByService[serviceId] || []) as StaffPublicWithId[];
    const hasStaffCache = Object.prototype.hasOwnProperty.call(staffByService, serviceId);
    if (!hasStaffCache) {
      const res = await listStaffForService(serviceId, sv);
      staffList = (res || []).filter((st: any) => String(st?.name || "").trim()) as any;

      setStaffByService((p) => ({ ...p, [serviceId]: staffList }));
    }

    const fixedEmployeeKey = String(opts?.employeeKey || futureSelectedEmployeeKey || "").trim();
    if (!fixedEmployeeKey) {
      setFutureMsg("اختاري موظفة لإكمال البحث.");
      return [] as { date: string; times: string[] }[];
    }

    const targetItem =
      (formData.items || []).find((it) => String(it.id || "").trim() === targetItemId) ||
      itemFromCart ||
      null;
    const startISO = String(opts?.startISO || targetItem?.date || bookingDate || "").trim() || todayISO();
    const scanDays = 60;

    setFutureLoading(true);
    try {
      const results: { date: string; times: string[] }[] = [];

      for (let i = 0; i < scanDays; i++) {
        const dateISO = addDaysISO(startISO, i);

        const staff =
          staffList.find((s: any) => String(s.linkedUid || s.id || "") === fixedEmployeeKey) ||
          staffList.find((s: any) => String(s.id || "") === fixedEmployeeKey);
        if (!staff) continue;

        const employeeIdFallback = String(staff?.id || "").trim();
        const fixedAvailable = staff
          ? isStaffAvailableForDate(staff as any, dateISO, { requireShowOnBooking: false })
          : false;
        if (!fixedAvailable) continue;

        const localTaken = targetItemId
          ? getLocalTakenTimesForItem(
            formData.items || [],
            targetItemId,
            fixedEmployeeKey,
            dateISO,
            employeeIdFallback
          )
          : new Set<string>();
        const dayTimes = await getAvailableStartsForDay({
          salonId: SALON_ID,
          employeeKey: fixedEmployeeKey,
          employeeIdFallback,
          dateISO,
          durationMin,
          take: 5,
          localTakenTimes: localTaken,
          staff: staff || null,
          source: "Booking.runFutureAvailabilitySearch",
        });
        if (dayTimes.length) {
          results.push({ date: dateISO, times: dayTimes });
          if (results.length >= 5) break;
        }
      }

      if (!results.length) {
        setFutureMsg("ما لقينا أوقات متاحة ضمن الفترة.");
        return [] as { date: string; times: string[] }[];
      }

      setFutureResult(results);
      return results;
    } catch (e: any) {
      setFutureMsg(`صار خطأ أثناء البحث: ${String(e?.message || e)}`);
      return [] as { date: string; times: string[] }[];
    } finally {
      setFutureLoading(false);
    }
  }

  async function applyFutureTimeSelection(dateISO: string, time24: string) {
    const serviceId = String(futureServiceId || servicePicker || "").trim();
    const chosenDate = String(dateISO || "").trim();
    const chosenTime = String(time24 || "").trim();
    if (!serviceId || !chosenDate || !chosenTime) return;

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

    const fixedKey = String(futureSelectedEmployeeKey || target.employeeUid || target.employeeId || "").trim();
    let chosenStaff: StaffPublicWithId | null =
      staffList.find((s: any) => String(s.linkedUid || s.id || "").trim() === fixedKey) ||
      staffList.find((s: any) => String(s.id || "").trim() === fixedKey) ||
      null;

    if (chosenStaff) {
      const chosenKey =
        String((chosenStaff as any)?.linkedUid || "").trim() ||
        String((chosenStaff as any)?.id || "").trim();
      const chosenId = String((chosenStaff as any)?.id || "").trim();
      const localTaken = targetItemId
        ? getLocalTakenTimesForItem(
          formData.items || [],
          targetItemId,
          chosenKey,
          chosenDate,
          chosenId
        )
        : new Set<string>();
      const starts = await getAvailableStartsForDay({
        salonId: SALON_ID,
        employeeKey: chosenKey,
        employeeIdFallback: chosenId,
        dateISO: chosenDate,
        durationMin,
        take: 288,
        localTakenTimes: localTaken,
        staff: chosenStaff,
        source: "Booking.applyFutureTimeSelection",
      });
      if (!starts.includes(chosenTime)) {
        chosenStaff = null;
      }
    }

    if (!chosenStaff) {
      setFutureMsg("اختاري موظفة ثم أعيدي البحث لنفس الخدمة.");
      return;
    }

    applyDateToSingleItem(target.id, chosenDate);
    setBookingDate(chosenDate);
    updateItem(target.id, {
      time: chosenTime,
      employeeId: String((chosenStaff as any)?.id || "").trim(),
      employeeUid: String((chosenStaff as any)?.linkedUid || "").trim(),
      employeeName: String((chosenStaff as any)?.name || "").trim(),
      locked: false,
    });
  }

  // =========================
  // ✅ Busy slots per item
  // =========================
  useEffect(() => {
    let cancelled = false;

    async function loadBusyForItems() {
      const items = formData.items || [];

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

        const dayCfg = getDaySettingsForDate(date);
        if (!dayCfg.enabled) {
          setBusyByItem((p) => ({
            ...p,
            [itemId]: { ...emptyBusyState(), hint: "اليوم مغلق للحجوزات." },
          }));
          continue;
        }

        const dayOpenTime = safeTimeHHMM(dayCfg.openTime, openTime);
        const dayCloseTime = safeTimeHHMM(dayCfg.closeTime, closeTime);
        const baseSlots = generateSalonTimeSlots(dayOpenTime, dayCloseTime, slotStepMin);
        if (!baseSlots.length) {
          setBusyByItem((p) => ({
            ...p,
            [itemId]: { ...emptyBusyState(), hint: "لا توجد شبكة أوقات لهذا اليوم." },
          }));
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
            source: "Booking.loadBusyForItems",
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

          // ✅ currentTime مرة وحدة فقط
          const currentTime = String(it.time || "").trim();

          // 3) حساب الـ Disabled بشكل صحيح (duration + buffer)
          const disabled = new Set<string>();
          let sequentialHint = "";
          let suggestedSlot = "";

          // ✅ أوقات ممكن تبدأ منها (حسب نهاية الخدمة + سماح)
          const durationMin = Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN);

          // فقط الأوقات اللي ما تتجاوز نهاية الدوام النهائي (صالون + موظفة)
          let slotsForThisService = filterSlotsByServiceEnd(
            baseSlots,
            dayCloseTime,
            durationMin,
            bufferMin,
            ALLOW_OVERTIME_MIN
          );
          const serviceKey =
            resolveCanonicalServiceId(
              String(it.serviceId || "").trim(),
              String((it as any)?.serviceName || "").trim()
            ) || String(it.serviceId || "").trim();
          const serviceStaff = (staffByService[serviceKey] || []) as StaffPublicWithId[];
          const selectedStaff =
            serviceStaff.find((s: any) => String(s?.id || "").trim() === employeeId) || null;
          if (selectedStaff) {
            const staffWindows = resolveStaffWorkingWindowsForDate(selectedStaff as any, {
              dateISO: date,
              fallbackOpenTime: dayOpenTime,
              fallbackCloseTime: dayCloseTime,
            });
            const staffWorkingSlots = staffWindows.length
              ? filterStaffSlotsByWorkingHours(selectedStaff as any, {
                dateISO: date,
                slots: slotsForThisService,
                fallbackOpenTime: dayOpenTime,
                fallbackCloseTime: dayCloseTime,
              })
              : [];
            if (!staffWindows.length) {
              slotsForThisService = [];
            } else {
              const allowedByValue = new Set<string>();
              for (const window of staffWindows) {
                const startsInWindow = (staffWorkingSlots || []).filter((slot) =>
                  isTimeInsideWindowRange(
                    String(slot?.value24 || "").trim(),
                    String(window.start || "").trim(),
                    String(window.end || "").trim()
                  )
                );
                const allowedInWindow = filterSlotsByServiceEnd(
                  startsInWindow,
                  String(window.end || "").trim(),
                  durationMin,
                  bufferMin,
                  ALLOW_OVERTIME_MIN
                );
                for (const slot of allowedInWindow) {
                  const value = String(slot?.value24 || "").trim();
                  if (value) allowedByValue.add(value);
                }
              }
              slotsForThisService = (slotsForThisService || []).filter((slot) =>
                allowedByValue.has(String(slot?.value24 || "").trim())
              );
            }
          }

          // ✅ هذه هي “البدايات الصحيحة” فعلياً (تضمن أن كل قطع الوقت المطلوبة فاضية)
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
              suggestedSlot, // ✅ NEW
            },
          }));

          // ✅ FIX الجوهري: منع تصفير الوقت التلقائي إلا في حالات التعارض الحقيقي
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
  }, [formData.items, sequentialBooking, slotStepMin, bufferMin, openTime, closeTime, staffByService]);

  // =========================
  // Handlers
  // =========================
  const applyBookingDate = (v: string) => {
    setBookingDate(v);
    if (calendarViewMode === "hijri") setHijriPickerOpen(false);

    setFormData((prev) => ({
      ...prev,
      items: (prev.items || []).map((it) => {
        const sv = getServiceById(String(it.serviceId || "").trim());

        const basePatch = {
          ...it,
          date: v,
          time: "",
          locked: false,
        };

        if (sv) {
          const fromSessionPackage = isSessionPackageCartItem(it);
          const fromServicePackage = isServicePackageCartItem(it);
          const serviceBasePrice = fromSessionPackage
            ? 0
            : fromServicePackage
              ? resolveStoredCartItemServiceBasePrice(it)
              : Number(
                pickEffectivePrice({
                  basePrice: Number(sv.basePrice || 0),
                  seasonPrice: Number((sv as any).seasonPrice || 0) || undefined,
                  appSettings,
                  dateISO: v,
                }).price || 0
              );
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
            priceText: fromSessionPackage
              ? resolveCartItemPriceText({ ...it, ...priced, priceText: priced.priceText })
              : priced.priceText,
          };
        }

        return basePatch;
      }),
    }));
  };

  const openBookingDatePicker = () => {
    if (calendarViewMode === "hijri") {
      const base = normalizeISODate(bookingDate) || todayISO();
      setHijriViewMonthISO(findHijriMonthStartISO(base));
      setHijriPickerOpen(true);
      return;
    }
    try {
      (dateRef.current as any)?.showPicker?.();
    } catch {
      // ignore unsupported showPicker
    }
    dateRef.current?.focus();
  };

  const applyDateToSingleItem = (itemId: string, nextDateISO: string) => {
    const nextDate = String(nextDateISO || "").trim();
    if (!itemId || !nextDate) return;

    setFormData((prev) => ({
      ...prev,
      items: (prev.items || []).map((it) => {
        if (String(it.id || "").trim() !== String(itemId || "").trim()) return it;

        const sv = getServiceById(String(it.serviceId || "").trim());
        const basePatch: CartItem = {
          ...it,
          date: nextDate,
          time: "",
          locked: false,
        };

        if (!sv) return basePatch;

        const fromSessionPackage = isSessionPackageCartItem(it);
        const fromServicePackage = isServicePackageCartItem(it);
        const serviceBasePrice = fromSessionPackage
          ? 0
          : fromServicePackage
            ? resolveStoredCartItemServiceBasePrice(it)
            : Number(
              pickEffectivePrice({
                basePrice: Number(sv.basePrice || 0),
                seasonPrice: Number((sv as any).seasonPrice || 0) || undefined,
                appSettings,
                dateISO: nextDate,
              }).price || 0
            );
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
          priceText: fromSessionPackage
            ? resolveCartItemPriceText({ ...it, ...priced, priceText: priced.priceText })
            : priced.priceText,
        };
      }),
    }));
    setBusyByItem((prev) => ({ ...prev, [itemId]: { ...emptyBusyState() } }));
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]:
        name === "phone"
          ? String(value || "").replace(/\D/g, "").slice(0, 10)
          : value,
    }));
  };

  const handleSectionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const sid = e.target.value;
    setSelectedSectionId(sid);
    setSelectedCategory("");
    setServicePicker("");
    setServicePickerList([]);
    resetSessionPackageSelection();
    setShowHairGuide(false);
  };

  const handleCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const nextCategory = String(e.target.value || "").trim();
    setSelectedCategory(nextCategory);
    setServicePicker("");
    setServicePickerList([]);
    resetSessionPackageSelection();
  };

  const handleServicePickerChange = (nextRaw: string) => {
    const next = String(nextRaw || "").trim();
    setServicePicker(next);
    if (pickerScope !== "services") {
      setServicePickerList([]);
    }
    if (pickerScope === "session_packages") {
      setSessionPackageServicePicker([]);
      setSessionPackageAllowedServices([]);
      setSessionPackageServicesError("");
      setSessionPackageServicesLoading(false);
    }
    setOfferStartTime("");
  };

  const basePrice = useMemo(() => {
    return resolveCartItemsTotal(formData.items || []);
  }, [formData.items]);

  const appliedDiscountTotal = useMemo(() => {
    return (appliedCoupons || []).reduce((sum, row) => sum + Math.max(0, Number(row.discountAmount || 0)), 0);
  }, [appliedCoupons]);

  const finalPrice = useMemo(() => {
    return Math.max(0, basePrice - appliedDiscountTotal);
  }, [basePrice, appliedDiscountTotal]);

  const previewCreatedAtLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(AR_SA_LATN_LOCALE, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date()),
    []
  );

  const bookingPreviewItems = useMemo(
    () =>
      (formData.items || []).map((it, idx) => ({
        id: String(it.id || `row-${idx}`),
        index: idx + 1,
        serviceName: String(it.serviceName || "").trim() || "-",
        staffName: String((it as any).displayStaffName || it.employeeName || "").trim() || "-",
        date: String((it as any).displayDateLabel || it.date || bookingDate || "").trim() || "-",
        timeLabel: formatTime12ForClient(String((it as any).displayTimeLabel || it.time || "").trim()),
        priceLabel: resolveCartItemPriceText(it),
        durationMin: Math.max(0, Number(it.durationMin || 0)),
        toolsNote: buildItemToolsNote(it),
        locked: !!it.locked,
      })),
    [formData.items, bookingDate]
  );

  const lockedPreviewCount = useMemo(
    () => bookingPreviewItems.filter((x) => x.locked).length,
    [bookingPreviewItems]
  );
  const totalPreviewCount = bookingPreviewItems.length;
  const allPreviewLocked = totalPreviewCount > 0 && lockedPreviewCount === totalPreviewCount;

  // =========================
  // Coupon
  // =========================
  const applyCouponCode = async (
    codeRaw: string,
    options?: ApplyCouponOptions
  ) => {
    const code = normalizeCouponCode(codeRaw);
    const clearInputOnSuccess = options?.clearInputOnSuccess ?? true;
    const suppressAlreadyAppliedMsg = !!options?.suppressAlreadyAppliedMsg;
    const suppressRetryableErrors = !!options?.suppressRetryableErrors;
    const forcedItemId = String(options?.forcedItemId || "").trim();

    if (!code) return "empty" as const;

    const existingCouponCode = normalizeCouponCode(
      String((appliedCoupons || [])[0]?.code || "")
    );
    if (existingCouponCode && existingCouponCode !== code) {
      setOfferMsgKind("error");
      setOfferMsg("مسموح بكود خصم واحد فقط لكل فاتورة. احذفي الكود الحالي أولًا.");
      return "single_coupon_only" as const;
    }

    if (existingCouponCode && existingCouponCode === code) {
      if (!suppressAlreadyAppliedMsg) {
        setOfferMsgKind("error");
        setOfferMsg("تم استخدام هذا الكود مسبقًا في نفس الفاتورة.");
      }
      return "already_applied" as const;
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
        return "invalid_or_expired" as const;
      }

      const applicableAll = (formData.items || []).filter((it) => {
        const itemId = String(it.id || "").trim();
        const sid = String(it.serviceId || "").trim();
        return itemId && sid && !reservedItemIds.has(itemId) && offerAppliesToService(offer, sid);
      });

      if (!applicableAll.length) {
        if (!suppressRetryableErrors) {
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
        }
        return "no_applicable_services" as const;
      }

      let applicable: CartItem[] = [];
      if (forcedItemId) {
        applicable = applicableAll.filter(
          (it) => String(it.id || "").trim() === forcedItemId
        );
        if (!applicable.length) {
          if (!suppressRetryableErrors) {
            setOfferMsgKind("error");
            setOfferMsg("الخدمة المحددة لم تعد متاحة لهذا العرض. اختاري خدمة أخرى.");
          }
          return "selected_service_unavailable" as const;
        }
      } else if (applicableAll.length === 1) {
        applicable = [applicableAll[0]];
      } else {
          const choices: CouponTargetChoice[] = applicableAll.map((it) => ({
            itemId: String(it.id || "").trim(),
            serviceId: String(it.serviceId || "").trim(),
            serviceName: String(it.serviceName || "").trim() || "خدمة",
            date: String(it.date || bookingDate || "").trim(),
            time: String(it.time || "").trim(),
            price: resolveCartItemLiveAmount(it),
          }));
        const firstChoice = choices.find((row) => row.itemId) || null;
        if (firstChoice) {
          setCouponTargetPicker({
            open: true,
            code,
            offerId: String((offer as any)?.id || "").trim(),
            offerTitle: String((offer as any)?.title || "").trim() || code,
            choices,
            selectedItemId: firstChoice.itemId,
            applying: false,
            clearInputOnSuccess,
            suppressAlreadyAppliedMsg,
            suppressRetryableErrors,
          });
          if (!suppressRetryableErrors) {
            setOfferMsgKind("error");
            setOfferMsg("حددي الخدمة المطلوب تطبيق الكود عليها.");
          }
          return "needs_service_selection" as const;
        }
        return "no_applicable_services" as const;
      }

      const missingDate = applicable.find((it) => !String(it.date || "").trim());
      if (missingDate) {
        if (!suppressRetryableErrors) {
          setOfferMsgKind("error");
          setOfferMsg("اختاري تاريخ الحجز للخدمات قبل تطبيق الكود");
        }
        return "missing_date" as const;
      }

      const badDate = applicable
        .map((it) => ({
          it,
          check: isOfferValidForBookingDate(offer as any, String(it.date || "").trim()),
        }))
        .find((x) => !x.check.ok);

      if (badDate) {
        if (!suppressRetryableErrors) {
          setOfferMsgKind("error");
          setOfferMsg(badDate.check.reason || "هذا العرض غير متاح لتاريخ الحجز المختار");
        }
        return "invalid_date" as const;
      }

      const applicableTotal = applicable.reduce((s, it) => s + resolveCartItemLiveAmount(it), 0);
      const { discountAmount } = calcDiscount(applicableTotal, offer);
      const safeDiscount = Math.max(0, Number(discountAmount || 0));
      if (!safeDiscount) {
        setOfferMsgKind("error");
        setOfferMsg("هذا الكود لا يضيف خصمًا على الخدمات المختارة.");
        return "no_discount" as const;
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

      setAppliedCoupons([nextEntry]);
      if (clearInputOnSuccess) setCouponCode("");
      else setCouponCode(code);
      setManualOverride(true);
      setOfferMsgKind("success");
      setOfferMsg(
        `تم تطبيق الكود (${nextEntry.code}) على الخدمة المحددة. إجمالي الخصم ${safeDiscount} ريال.`
      );
      return "applied" as const;
    } catch (e: any) {
      console.error("apply coupon error:", e?.code, e?.message, e);
      setOfferMsgKind("error");
      setOfferMsg("صار خطأ في التحقق من الكود");
      return "error" as const;
    }
  };

  const handleApplyCoupon = async () => {
    const status = await applyCouponCode(couponCode, { clearInputOnSuccess: true });
    if (status === "empty") {
      clearAppliedCoupons();
    }
  };

  useEffect(() => {
    const code = normalizeCouponCode(pendingAutoCouponCode);
    if (!code) return;

    if ((appliedCoupons || []).some((x) => normalizeCouponCode(x.code) === code)) {
      setPendingAutoCouponCode("");
      return;
    }

    if (!(formData.items || []).length) return;

    let cancelled = false;
    void (async () => {
      const status = await applyCouponCode(code, {
        clearInputOnSuccess: false,
        suppressAlreadyAppliedMsg: true,
        suppressRetryableErrors: true,
      });
      if (cancelled) return;
      if (
        status === "applied" ||
        status === "already_applied" ||
        status === "single_coupon_only" ||
        status === "invalid_or_expired" ||
        status === "needs_service_selection" ||
        status === "selected_service_unavailable" ||
        status === "no_discount" ||
        status === "error"
      ) {
        setPendingAutoCouponCode("");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pendingAutoCouponCode, formData.items, appliedCoupons]);

  const handleRemoveCoupon = (codeRaw: string) => {
    const code = normalizeCouponCode(codeRaw);
    if (!code) return;
    setAppliedCoupons((prev) => prev.filter((x) => normalizeCouponCode(x.code) !== code));
    setManualOverride(false);
    setOfferMsgKind("success");
    setOfferMsg(`تمت إزالة الكود (${code}).`);
  };

  // =========================
  // Helper: توزيع الخصم على العناصر
  // =========================
  function allocateDiscount(items: CartItem[], discountTotal: number) {
    const total = items.reduce((s, it) => s + resolveCartItemLiveAmount(it), 0);
    if (!total || !discountTotal) {
      return items.map(() => 0);
    }

    const raw = items.map((it) => (resolveCartItemLiveAmount(it) / total) * discountTotal);
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
  // ✅ Slot check for one item
  // ✅ FIX: فحص تعارض السلة قبل Firestore (employeeKey)
  // =========================
  const checkOneItemSlot = async (it: CartItem) => {
    const employeeKey = resolveEmployeeKey(it);
    const date = String(it.date || "").trim();
    const time = String(it.time || "").trim();
    if (!employeeKey || !date || !time) return { ok: false, msg: "بيانات الوقت ناقصة" };

    const dayCfg = getDaySettingsForDate(date);
    if (!dayCfg.enabled) {
      return { ok: false, msg: "اليوم المختار مغلق للحجوزات." };
    }
    const dayOpenTime = safeTimeHHMM(dayCfg.openTime, openTime);
    const dayCloseTime = safeTimeHHMM(dayCfg.closeTime, closeTime);
    const baseSlotsForDay = generateSalonTimeSlots(dayOpenTime, dayCloseTime, slotStepMin);
    if (!baseSlotsForDay.some((s) => String(s.value24 || "").trim() === time)) {
      return { ok: false, msg: "الوقت المختار خارج دوام الصالون في هذا اليوم." };
    }

    const durationMin = Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN);
    const salonAllowedStarts = filterSlotsByServiceEnd(
      baseSlotsForDay,
      dayCloseTime,
      durationMin,
      bufferMin,
      ALLOW_OVERTIME_MIN
    );
    if (!salonAllowedStarts.some((s) => String(s.value24 || "").trim() === time)) {
      return { ok: false, msg: "هذا الوقت لا يكفي لإنهاء الخدمة ضمن دوام الصالون." };
    }

    const serviceKey =
      resolveCanonicalServiceId(
        String(it.serviceId || "").trim(),
        String((it as any)?.serviceName || "").trim()
      ) || String(it.serviceId || "").trim();
    const staffList = (staffByService[serviceKey] || []) as StaffPublicWithId[];
    const staff = staffList.find((s: any) => String(s?.id || "").trim() === String(it.employeeId || "").trim());
    if (staff) {
      const staffWindows = resolveStaffWorkingWindowsForDate(staff as any, {
        dateISO: date,
        fallbackOpenTime: dayOpenTime,
        fallbackCloseTime: dayCloseTime,
      });
      if (!staffWindows.length) {
        return { ok: false, msg: "الموظفة غير متاحة في هذا اليوم." };
      }
      const staffWorkingStarts = filterStaffSlotsByWorkingHours(staff as any, {
        dateISO: date,
        slots: salonAllowedStarts,
        fallbackOpenTime: dayOpenTime,
        fallbackCloseTime: dayCloseTime,
      });
      const staffAllowedSet = new Set<string>();
      for (const window of staffWindows) {
        const startsInWindow = (staffWorkingStarts || []).filter((slot) =>
          isTimeInsideWindowRange(
            String(slot?.value24 || "").trim(),
            String(window.start || "").trim(),
            String(window.end || "").trim()
          )
        );
        const allowedInWindow = filterSlotsByServiceEnd(
          startsInWindow,
          String(window.end || "").trim(),
          durationMin,
          bufferMin,
          ALLOW_OVERTIME_MIN
        );
        for (const slot of allowedInWindow) {
          const value = String(slot?.value24 || "").trim();
          if (value) staffAllowedSet.add(value);
        }
      }
      const staffAllowedStarts = (staffWorkingStarts || []).filter((slot) =>
        staffAllowedSet.has(String(slot?.value24 || "").trim())
      );
      if (!staffAllowedStarts.some((s) => String(s.value24 || "").trim() === time)) {
        return { ok: false, msg: "هذا الوقت لا يكفي لإنهاء الخدمة ضمن دوام الموظفة." };
      }
    }

    const timesToCheck = getTimesToLock(
      baseSlotsForDay,
      slotStepMin,
      time,
      durationMin,
      bufferMin
    );

    // ✅ FIX: التأكد من أننا لا نفحص التعارض مع الخدمة نفسها داخل السلة
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
      const employeeIdFallback = String(it.employeeId || "").trim();
      const takenFs = await collectTakenTimesForEmployeeDay({
        salonId: SALON_ID,
        employeeKey,
        employeeIdFallback,
        dateISO: date,
        forceFresh: true,
        source: "Booking.checkOneItemSlot",
      });
      if (timesToCheck.some((t) => takenFs.has(t))) {
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

    const customerName = String(formData.name || "").trim();
    if (!customerName || isPlaceholderClientName(customerName)) {
      openModal({
        title: "الاسم غير مكتمل",
        message: "أدخلي اسمك الحقيقي في الخطوة 3 قبل تأكيد الحجز.",
        variant: "danger",
        confirmText: "تعديل",
      });
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
      if (!cfg.enabled) return true;
      const dayOpenTime = safeTimeHHMM(cfg.openTime, openTime);
      const dayCloseTime = safeTimeHHMM(cfg.closeTime, closeTime);
      const slots = generateSalonTimeSlots(dayOpenTime, dayCloseTime, slotStepMin);
      if (!slots.some((s) => String(s.value24 || "").trim() === t)) return true;

      const salonAllowedStarts = filterSlotsByServiceEnd(
        slots,
        dayCloseTime,
        Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN),
        bufferMin,
        ALLOW_OVERTIME_MIN
      );
      if (!salonAllowedStarts.some((s) => String(s.value24 || "").trim() === t)) return true;

      const serviceKey =
        resolveCanonicalServiceId(
          String(it.serviceId || "").trim(),
          String((it as any)?.serviceName || "").trim()
        ) || String(it.serviceId || "").trim();
      const staffList = (staffByService[serviceKey] || []) as StaffPublicWithId[];
      const staff = staffList.find(
        (s: any) => String(s?.id || "").trim() === String(it.employeeId || "").trim()
      );
      if (!staff) return false;
      const staffWindows = resolveStaffWorkingWindowsForDate(staff as any, {
        dateISO: d,
        fallbackOpenTime: dayOpenTime,
        fallbackCloseTime: dayCloseTime,
      });
      if (!staffWindows.length) return true;
      const staffWorkingStarts = filterStaffSlotsByWorkingHours(staff as any, {
        dateISO: d,
        slots: salonAllowedStarts,
        fallbackOpenTime: dayOpenTime,
        fallbackCloseTime: dayCloseTime,
      });
      const staffAllowedSet = new Set<string>();
      for (const window of staffWindows) {
        const startsInWindow = (staffWorkingStarts || []).filter((slot) =>
          isTimeInsideWindowRange(
            String(slot?.value24 || "").trim(),
            String(window.start || "").trim(),
            String(window.end || "").trim()
          )
        );
        const allowedInWindow = filterSlotsByServiceEnd(
          startsInWindow,
          String(window.end || "").trim(),
          Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN),
          bufferMin,
          ALLOW_OVERTIME_MIN
        );
        for (const slot of allowedInWindow) {
          const value = String(slot?.value24 || "").trim();
          if (value) staffAllowedSet.add(value);
        }
      }
      const staffAllowedStarts = (staffWorkingStarts || []).filter((slot) =>
        staffAllowedSet.has(String(slot?.value24 || "").trim())
      );
      return !staffAllowedStarts.some((s) => String(s.value24 || "").trim() === t);
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

    // ✅ ترتيب الحجز: لازم يخلص الخدمة الأولى قبل الثانية
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

    const exactConflict = findAnyExactCartSlotConflict(items);
    if (exactConflict) {
      openModal({
        title: "تعارض داخل السلة",
        message: "هذا الوقت محجوز لنفس الموظفة داخل السلة، اختاري وقت مختلف.",
        variant: "danger",
        confirmText: "حسنًا",
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
      const appliedCode = normalizeCouponCode(String((appliedCoupons || [])[0]?.code || ""));
      const selectedCode = appliedCode || typedCode;
      const normalizedCodes = selectedCode ? [selectedCode] : [];
      if (appliedCode && typedCode && appliedCode !== typedCode) {
        setCouponCode(appliedCode);
        setOfferMsgKind("error");
        setOfferMsg("تم تجاهل الكود الإضافي. المسموح كود خصم واحد فقط لكل فاتورة.");
      }

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

        const applicableAll = items.filter((it) => {
          const itemId = String(it.id || "").trim();
          const sid = String(it.serviceId || "").trim();
          return itemId && sid && !reservedItemIds.has(itemId) && offerAppliesToService(offer, sid);
        });

        if (!applicableAll.length) {
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

        const existingAppliedEntry = (appliedCoupons || []).find(
          (row) => normalizeCouponCode(row.code) === code
        );
        const preferredItemIds = new Set(
          (existingAppliedEntry?.applicableItemIds || [])
            .map((id) => String(id || "").trim())
            .filter(Boolean)
        );
        let applicable = applicableAll.filter((it) =>
          preferredItemIds.has(String(it.id || "").trim())
        );

        if (!applicable.length) {
          if (applicableAll.length > 1) {
            const choices: CouponTargetChoice[] = applicableAll.map((it) => ({
              itemId: String(it.id || "").trim(),
              serviceId: String(it.serviceId || "").trim(),
              serviceName: String(it.serviceName || "").trim() || "خدمة",
              date: String(it.date || bookingDate || "").trim(),
              time: String(it.time || "").trim(),
              price: resolveCartItemLiveAmount(it),
            }));
            const firstChoice = choices.find((row) => row.itemId) || null;
            if (firstChoice) {
              setCouponCode(code);
              setCouponTargetPicker({
                open: true,
                code,
                offerId: String((offer as any)?.id || "").trim(),
                offerTitle: String((offer as any)?.title || "").trim() || code,
                choices,
                selectedItemId: firstChoice.itemId,
                applying: false,
                clearInputOnSuccess: true,
                suppressAlreadyAppliedMsg: false,
                suppressRetryableErrors: false,
              });
              setOfferMsgKind("error");
              setOfferMsg("حددي الخدمة المطلوب تطبيق الكود عليها ثم أعيدي المحاولة.");
              return;
            }
          }
          applicable = [applicableAll[applicableAll.length - 1]];
        } else {
          applicable = [applicable[applicable.length - 1]];
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

        const applicableTotal = applicable.reduce((s, it) => s + resolveCartItemLiveAmount(it), 0);
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

      let hasHomeServiceItem = false;
      const homeServicesTotal = Math.round(
        items.reduce((sum, it, idx) => {
          const serviceId = String(it.serviceId || "").trim();
          const serviceDoc = getServiceById(serviceId);
          const sectionId = String(it.serviceSectionId || serviceDoc?.sectionId || "").trim();
          const sectionTitle =
            String(it.serviceSectionTitle || "").trim() ||
            String(sectionLabelById.get(sectionId) || "").trim() ||
            String(serviceDoc?.sectionTitle || "").trim();
          if (!isHomeServiceSectionByInfo(sectionId, sectionTitle)) return sum;
          hasHomeServiceItem = true;
          const itemDiscount = Number(perItemDiscounts[idx] || 0);
          const itemFinal = Math.max(0, resolveCartItemStandaloneAmount(it) - itemDiscount);
          return sum + itemFinal;
        }, 0) * 100
      ) / 100;
      if (hasHomeServiceItem && homeServicesTotal <= HOME_SERVICE_MIN_TOTAL_SAR) {
        openModal({
          title: "شرط حجز الخدمات المنزلية",
          message:
            `لحجز الخدمات المنزلية لازم يكون الإجمالي أكبر من ${HOME_SERVICE_MIN_TOTAL_SAR} ريال.\n` +
            `الإجمالي الحالي للخدمات المنزلية: ${homeServicesTotal.toFixed(2)} ريال.`,
          variant: "danger",
          confirmText: "حسنًا",
        });
        return;
      }

      const authNow = getAuth();
      const uid = internalMode ? (authNow.currentUser?.uid || "") : (signedUid || null);

      if (internalMode && !uid) {
        openModal({
          title: "تسجيل دخول الموظف مطلوب",
          message: "لازم موظف/إدارة يكون مسجل دخول عشان الحجز الداخلي.",
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
        const itemFinal = Math.max(0, resolveCartItemStandaloneAmount(it) - itemDiscount);
        const itemCoupon = couponByItemId.get(String(it.id || "").trim()) || null;
        const toolsNote = buildItemToolsNote(it);
        const sessionPackageNote = isSessionPackageCartItem(it)
          ? [
            `fromSessionPackage=1`,
            `sessionPackageId=${String(it.sessionPackageId || it.packageId || "").trim() || "-"}`,
            `sessionPackageName=${String(it.sessionPackageName || it.packageSnapshot?.packageName || "").trim() || "-"}`,
            `consumeOneSession=${it.consumeOneSession === false ? 0 : 1}`,
          ].join(" | ")
          : "";
        const itemNote = [noteFinal, toolsNote, sessionPackageNote].filter(Boolean).join(" | ") || undefined;

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
            const runBaseLiveTotal = sortedRun.reduce(
              (sum, row) => sum + resolveCartItemLiveAmount(row.item),
              0
            );
            const runDiscountTotal = sortedRun.reduce(
              (sum, row) => sum + Math.max(0, Number(perItemDiscounts[row.idx] || 0)),
              0
            );
            const runFinalLiveTotal = sortedRun.reduce((sum, row) => {
              const d = Number(perItemDiscounts[row.idx] || 0);
              return sum + Math.max(0, resolveCartItemLiveAmount(row.item) - d);
            }, 0);
            const runBaseTotal =
              runBaseLiveTotal > 0 ? runBaseLiveTotal : resolveCartItemStandaloneAmount(it);
            const runFinalTotal =
              runBaseLiveTotal > 0
                ? runFinalLiveTotal
                : Math.max(0, resolveCartItemStandaloneAmount(it) - runDiscountTotal);
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
                  resolveCartItemLiveAmount(x.item) - Number(perItemDiscounts[x.idx] || 0)
                ),
                durationMin: Math.max(
                  1,
                  Number(x.item.durationMin || DEFAULT_SERVICE_DURATION_MIN)
                ),
              })),
              kind: "service_package" as const,
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
                  resolveCartItemLiveAmount(item) - Number(perItemDiscounts[sourceIdx] || 0)
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
          fromSessionPackage: it.fromSessionPackage || undefined,
          sessionPackageId: String(it.sessionPackageId || "").trim() || undefined,
          sessionPackageName: String(it.sessionPackageName || "").trim() || undefined,
          consumeOneSession:
            it.consumeOneSession === undefined ? undefined : !!it.consumeOneSession,
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
          fromSessionPackage: it.fromSessionPackage || false,
          sessionPackageId: String(it.sessionPackageId || "").trim() || null,
          sessionPackageName: String(it.sessionPackageName || "").trim() || null,
          consumeOneSession: it.consumeOneSession !== false,
          durationMin,
          toolsSource: String(it.toolsSource || "").trim() || null,
          toolsFeeApplied: Number(it.toolsFeeApplied || 0),
          status: "pending",
          createdAt: Date.now(),
        });
      }

      const usedOfferIds = new Set<string>();
      for (const row of finalCoupons) {
        const offerId = String(row.offerId || "").trim();
        if (offerId) usedOfferIds.add(offerId);
      }
      for (const row of items) {
        const sequenceOfferId = String((row as any)?.sequenceOfferId || "").trim();
        if (sequenceOfferId) usedOfferIds.add(sequenceOfferId);
      }

      const usedPackageIds = new Set<string>();
      for (const row of createdBookings) {
        const packageIdRaw = String((row as any)?.packageId || "").trim();
        if (!packageIdRaw) continue;
        const packageKind = String((row as any)?.packageSnapshot?.kind || "").trim().toLowerCase();
        if (packageKind === "session_package") continue;
        const lower = packageIdRaw.toLowerCase();
        if (lower.startsWith("offer:")) continue;
        if (lower.startsWith("package:")) {
          const cleaned = packageIdRaw.slice("package:".length).trim();
          if (cleaned) usedPackageIds.add(cleaned);
          continue;
        }
        usedPackageIds.add(packageIdRaw);
      }

      await Promise.all([
        ...Array.from(usedOfferIds).map(async (offerId) => {
          try {
            await incrementOfferUsage(SALON_ID, offerId);
          } catch {
            // ignore usage counter failures
          }
        }),
        ...Array.from(usedPackageIds).map(async (packageId) => {
          try {
            await incrementPackageUsage(SALON_ID, packageId);
          } catch {
            // ignore usage counter failures
          }
        }),
      ]);

      const normalizedCreatedBookings = (createdBookings || []).map((row: any) => ({
        ...row,
        bookingId: String(row?.bookingId || row?.id || "").trim(),
        id: String(row?.id || row?.bookingId || "").trim(),
        trackId: String(row?.trackId || row?.bookingId || row?.id || "").trim(),
        publicId: String(row?.publicId || row?.bookingPublicId || "").trim(),
        bookingPublicId: String(row?.bookingPublicId || row?.publicId || "").trim(),
        parentId: String(row?.parentId || row?.groupId || "").trim(),
        groupId: String(row?.groupId || row?.parentId || "").trim(),
      }));

      localStorage.setItem("allBookings", JSON.stringify(normalizedCreatedBookings));
      localStorage.setItem("currentBooking", JSON.stringify(normalizedCreatedBookings[0] || null));
      localStorage.setItem("booking_success_mode", "created");
      localStorage.removeItem("bookingDraft");
      
      {
        const successNav = buildSuccessNavigationPayload(normalizedCreatedBookings, "created");
        navigate(successNav.to, { state: successNav.state });
      }
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

          const fromSessionPackage = isSessionPackageCartItem(it);
          const fromServicePackage = isServicePackageCartItem(it);
          const serviceBasePrice = fromSessionPackage
            ? 0
            : fromServicePackage
              ? resolveStoredCartItemServiceBasePrice(it)
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
                  finalPriceAtBooking: resolveFlatServicePackageFinalPrice(sv),
                  baseTotalPriceAtBooking: resolveFlatServicePackageBaseTotalPrice(sv),
                  totalDurationMinAtBooking: Number(sv.durationMin || DEFAULT_SERVICE_DURATION_MIN),
                  serviceIds: Array.isArray(sv.packageServiceIds) ? sv.packageServiceIds : [],
                  services: Array.isArray(sv.packageServices) ? sv.packageServices : [],
                  kind: "service_package" as const,
                }
                : undefined),
            employeeId: String(it?.employeeId || "").trim(),
            employeeUid: String(it?.employeeUid || "").trim(),
            employeeName: String(it?.employeeName || "").trim(),
            fromSessionPackage: !!(it as any)?.fromSessionPackage,
            sessionPackageId: String((it as any)?.sessionPackageId || "").trim() || undefined,
            sessionPackageName: String((it as any)?.sessionPackageName || "").trim() || undefined,
            consumeOneSession: !!(it as any)?.consumeOneSession,
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
            priceText: fromSessionPackage
              ? resolveCartItemPriceText({ ...(it as any), ...priced, priceText: priced.priceText })
              : priced.priceText,
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

  const isSignedClient = !!signedUid;
  const bookingDateSafe = String(bookingDate || "").trim() || todayISO();
  const hasSelectedBookingDate = !!String(bookingDate || "").trim();
  const bookingDateDisplayValue = bookingDate
    ? formatBookingDateForView(String(bookingDate || "").trim(), calendarViewMode)
    : "";
  const calendarViewModeLabel = calendarViewMode === "hijri" ? "هجري" : "ميلادي";
  const cartItems = formData.items || [];
  const firstCartItem = cartItems[0] || null;
  const selectedVariantId = String(firstCartItem?.serviceId || servicePicker || "").trim();
  const selectedServiceLabels = cartItems
    .map((it) => String(it?.serviceName || "").trim())
    .filter(Boolean);
  const step1SummaryRows = cartItems
    .map((it, idx) => ({
      index: idx + 1,
      itemId: String(it?.id || "").trim(),
      label: String(it?.serviceName || "").trim() || "خدمة",
    }))
    .filter((x) => x.itemId && x.label);
  const firstItemWithStaff = cartItems.find((it) => String(it.employeeId || "").trim());
  const firstItemWithTime = cartItems.find((it) => String(it.time || "").trim());
  const selectedStaffEmployeeKey = String(
    firstItemWithStaff?.employeeUid || firstItemWithStaff?.employeeId || ""
  ).trim();
  const selectedStaffEmployeeName = String(firstItemWithStaff?.employeeName || "").trim();
  const selectedTime = String(firstItemWithTime?.time || "").trim();
  const selectedDate = String(firstItemWithTime?.date || bookingDateSafe).trim();
  const customerName = String(formData.name || "").trim();
  const customerPhone = phone10Digits(String(formData.phone || "").trim());
  const isCustomerNameComplete = !!customerName && !isPlaceholderClientName(customerName);
  const isCustomerPhoneComplete = /^05\d{8}$/.test(customerPhone);
  const isStep1Complete = cartItems.length > 0 && !!selectedVariantId;
  const isStep2Complete =
    !!String(bookingDate || "").trim() &&
    cartItems.length > 0 &&
    cartItems.every((it) => !!String(it.time || "").trim());
  const isStep2ReadyForNext = isStep2Complete && allPreviewLocked;
  const isStep3Complete = isCustomerNameComplete && isCustomerPhoneComplete;
  const maxUnlockedStep: BookingStep = !isStep1Complete
    ? 1
    : !isStep2ReadyForNext
      ? 2
      : !isStep3Complete
        ? 3
        : 4;

  const step1SummaryText =
    step1SummaryRows.length === 0
      ? "لم يتم اختيار خدمة"
      : step1SummaryRows
        .map((row) => `${row.index}- ${row.label}`)
        .join("\n");
  const staffSummaryText = selectedStaffEmployeeName || "اختيار يدوي";
  const step2TimeSummary =
    selectedTime && selectedDate
      ? `${selectedDate} - ${formatTime12ForClient(selectedTime)}`
      : (String(bookingDate || "").trim() ? `${String(bookingDate || "").trim()} - لم يتم تحديد الوقت` : "اختاري التاريخ والوقت");
  const step2SummaryText = selectedStaffEmployeeName
    ? `${staffSummaryText} - ${step2TimeSummary}`
    : `اختاري الموظفة - ${step2TimeSummary}`;
  const step3SummaryText = [
    isCustomerNameComplete ? customerName : "",
    isCustomerPhoneComplete ? customerPhone : "",
    String(formData.note || "").trim() ? "تمت إضافة ملاحظة" : "",
    appliedCoupons.length > 0 ? "تم تطبيق كود خصم" : "",
  ].filter(Boolean).join(" - ") || "أدخلي الاسم والجوال";
  const step4SummaryText = `${finalPrice.toFixed(0)} ريال`;
  const step1HintText = `عدد الخدمات المضافة (${cartItems.length})`;
  const stepRows: Array<{ id: BookingStep; title: string; hint: string; summary: string; action: string }> = [
    { id: 1, title: "الخدمة", hint: step1HintText, summary: step1SummaryText, action: "اختيار وإضافة" },
    { id: 2, title: "الموظفة", hint: "لكل خدمة موظفتها ووقتها داخل كرت الموعد", summary: step2SummaryText, action: "تحديد الموعد" },
    { id: 3, title: "بيانات العميل", hint: "أدخلي الاسم والجوال ثم أضيفي الملاحظة أو كود الخصم إن رغبتِ", summary: step3SummaryText, action: "إكمال البيانات" },
    { id: 4, title: "تأكيد", hint: "راجعي التفاصيل واضغطي تأكيد", summary: step4SummaryText, action: "مراجعة نهائية" },
  ];
  const activeStepRow = stepRows.find((x) => x.id === currentStep) || stepRows[0];

  useEffect(() => {
    if (currentStep > maxUnlockedStep) {
      setCurrentStep(maxUnlockedStep);
    }
  }, [currentStep, maxUnlockedStep]);

  useEffect(() => {
    const nextFlow: BookingFlowState = {
      selectedVariantId,
      selectedVariantLabel: step1SummaryText,
      staffChoice: "manual",
      staffEmployeeKey: selectedStaffEmployeeKey,
      staffEmployeeName: selectedStaffEmployeeName,
      date: selectedDate,
      time: selectedTime,
      customerName,
      customerPhone,
      coupon: String(couponCode || "").trim(),
    };
    setBookingFlowState((prev) => {
      if (
        prev.selectedVariantId === nextFlow.selectedVariantId &&
        prev.selectedVariantLabel === nextFlow.selectedVariantLabel &&
        prev.staffChoice === nextFlow.staffChoice &&
        prev.staffEmployeeKey === nextFlow.staffEmployeeKey &&
        prev.staffEmployeeName === nextFlow.staffEmployeeName &&
        prev.date === nextFlow.date &&
        prev.time === nextFlow.time &&
        prev.customerName === nextFlow.customerName &&
        prev.customerPhone === nextFlow.customerPhone &&
        prev.coupon === nextFlow.coupon
      ) {
        return prev;
      }
      return nextFlow;
    });
  }, [
    selectedVariantId,
    step1SummaryText,
    selectedStaffEmployeeKey,
    selectedStaffEmployeeName,
    selectedDate,
    selectedTime,
    customerName,
    customerPhone,
    couponCode,
  ]);

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
      <Modal
        open={offerServicePicker.open}
        onClose={closeOfferServicePicker}
        ariaLabel="اختيار خدمة العرض"
        size="sm"
        panelClassName="booking-offer-picker-panel"
      >
        <div className="booking-offer-picker-modal">
          <h3 className="booking-offer-picker-modal__title">
            اختيار الخدمة من العرض
          </h3>
          <p className="booking-offer-picker-modal__hint">
            {String(offerServicePicker.offerTitle || "").trim()
              ? `العرض: ${offerServicePicker.offerTitle}`
              : "العرض المختار"}
          </p>
          <p className="booking-offer-picker-modal__text">
            العرض يشمل لكل فاتورة خدمة وحدة، الرجاء اختاري خدمتك اللي تبغي عليها العرض.
          </p>

          <label className="booking-offer-picker-modal__label" htmlFor="offerServiceSelect">
            الخدمات المشمولة في العرض
          </label>
          <select
            id="offerServiceSelect"
            className="booking-offer-picker-modal__select"
            value={offerServicePicker.selectedServiceId}
            onChange={(e) =>
              setOfferServicePicker((prev) => ({
                ...prev,
                selectedServiceId: String(e.target.value || "").trim(),
              }))
            }
            disabled={offerServicePicker.adding}
          >
            <option value="" disabled>
              اختاري الخدمة
            </option>
            {offerServicePicker.choices.map((row) => (
              <option key={row.serviceId} value={row.serviceId}>
                {row.serviceName}
              </option>
            ))}
          </select>

          <div className="booking-offer-picker-modal__actions">
            <button
              type="button"
              className="booking-offer-picker-modal__btn booking-offer-picker-modal__btn--cancel"
              onClick={closeOfferServicePicker}
              disabled={offerServicePicker.adding}
            >
              إلغاء
            </button>
            <button
              type="button"
              className="booking-offer-picker-modal__btn booking-offer-picker-modal__btn--confirm"
              onClick={() => {
                void confirmOfferServicePicker();
              }}
              disabled={!String(offerServicePicker.selectedServiceId || "").trim() || offerServicePicker.adding}
            >
              {offerServicePicker.adding ? "جارٍ الإضافة..." : "اختيار الخدمة وإضافتها للسلة"}
            </button>
          </div>
        </div>
      </Modal>
      <Modal
        open={couponTargetPicker.open}
        onClose={closeCouponTargetPicker}
        ariaLabel="اختيار خدمة الكوبون"
        size="sm"
        panelClassName="booking-offer-picker-panel"
      >
        <div className="booking-offer-picker-modal">
          <h3 className="booking-offer-picker-modal__title">
            اختيار الخدمة المستهدفة بالخصم
          </h3>
          <p className="booking-offer-picker-modal__hint">
            {String(couponTargetPicker.offerTitle || "").trim()
              ? `العرض: ${couponTargetPicker.offerTitle}`
              : "الكود المختار"}
          </p>
          <p className="booking-offer-picker-modal__text">
            هذا العرض ينطبق على خدمات محددة. اختاري الخدمة التي تريدين تطبيق الخصم عليها.
          </p>

          <label className="booking-offer-picker-modal__label" htmlFor="couponTargetSelect">
            الخدمات المؤهلة
          </label>
          <select
            id="couponTargetSelect"
            className="booking-offer-picker-modal__select"
            value={couponTargetPicker.selectedItemId}
            onChange={(e) =>
              setCouponTargetPicker((prev) => ({
                ...prev,
                selectedItemId: String(e.target.value || "").trim(),
              }))
            }
            disabled={couponTargetPicker.applying}
          >
            <option value="" disabled>
              اختاري الخدمة
            </option>
            {couponTargetPicker.choices.map((row) => {
              const dateLabel = String(row.date || "").trim() || "-";
              const timeLabel = formatTime12ForClient(String(row.time || "").trim());
              const priceLabel = `${Number(row.price || 0).toFixed(0)} ريال`;
              return (
                <option key={row.itemId} value={row.itemId}>
                  {`${row.serviceName} • ${dateLabel} • ${timeLabel} • ${priceLabel}`}
                </option>
              );
            })}
          </select>

          <div className="booking-offer-picker-modal__actions">
            <button
              type="button"
              className="booking-offer-picker-modal__btn booking-offer-picker-modal__btn--cancel"
              onClick={closeCouponTargetPicker}
              disabled={couponTargetPicker.applying}
            >
              إلغاء
            </button>
            <button
              type="button"
              className="booking-offer-picker-modal__btn booking-offer-picker-modal__btn--confirm"
              onClick={() => {
                void confirmCouponTargetPicker();
              }}
              disabled={!String(couponTargetPicker.selectedItemId || "").trim() || couponTargetPicker.applying}
            >
              {couponTargetPicker.applying ? "جارٍ التطبيق..." : "تطبيق الخصم على الخدمة المحددة"}
            </button>
          </div>
        </div>
      </Modal>

      <div className="container">
        <div className="row justify-content-center">
          <div className="col-lg-8">
            <div className="booking-card" ref={bookingCardRef}>

              {/* ✅ Logo */}
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

              {isSignedClient ? (
                <div className="booking-signed-client-card mb-3" role="status" aria-live="polite">
                  <div className="booking-signed-client-card__icon" aria-hidden="true">
                    <FontAwesomeIcon icon={faUser} />
                  </div>
                  <div className="booking-signed-client-card__body">
                    <div className="booking-signed-client-card__eyebrow">الحساب المسجل</div>
                    <div className="booking-signed-client-card__name">
                      {String(formData.name || "").trim() || "العميلة المسجلة"}
                    </div>
                    <div className="booking-signed-client-card__meta">
                      {String(formData.phone || "").trim()
                        ? `الجوال ${String(formData.phone || "").trim()}`
                        : "بياناتك محفوظة وجاهزة لإتمام الحجز"}
                    </div>
                  </div>
                </div>
              ) : null}

              <form className="booking-form" onSubmit={handleSubmit}>
                <div className="booking-step-focus mb-4" aria-label="مسار إتمام الحجز">
                  <div className="booking-step-focus__top">
                    <div className="booking-step-focus__kicker">
                      <span className="booking-step-focus__pill">
                        الخطوة {currentStep} من {stepRows.length}
                      </span>
                      <span className="booking-step-focus__status">
                        {activeStepRow.action}
                      </span>
                    </div>
                    <div className="booking-step-focus__title-wrap">
                      <div className="booking-step-focus__title">{activeStepRow.title}</div>
                      <div className="booking-step-focus__hint">{activeStepRow.hint}</div>
                    </div>
                    <div className="booking-step-focus__summary">
                      {activeStepRow.id === 1 && step1SummaryRows.length > 0 ? (
                        <div className="booking-step-focus__summary-list">
                          {step1SummaryRows.map((row) => (
                            <div key={`step1-summary-${row.itemId}`} className="booking-step-focus__summary-row">
                              <span className="booking-step-focus__summary-text">
                                {row.index}- {row.label}
                              </span>
                              <button
                                type="button"
                                className="booking-step-focus__summary-remove"
                                onClick={() => removeServiceFromCart(row.itemId)}
                              >
                                حذفها
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        activeStepRow.summary
                      )}
                    </div>
                  </div>

                  <div className="booking-step-focus__progress" role="tablist" aria-label="خطوات الحجز">
                    {stepRows.map((stepRow) => {
                      const isActive = currentStep === stepRow.id;
                      const isUnlocked = stepRow.id <= maxUnlockedStep;
                      const isDone = stepRow.id < currentStep && isUnlocked;
                      const stateLabel = isActive ? "الحالية" : isDone ? "مكتملة" : isUnlocked ? "متاحة" : "لاحقًا";
                      return (
                        <button
                          key={`step-dot-${stepRow.id}`}
                          type="button"
                          role="tab"
                          aria-selected={isActive}
                          aria-label={`الخطوة ${stepRow.id}: ${stepRow.title}`}
                          disabled={!isUnlocked}
                          className={`booking-step-focus__dot ${isActive ? "is-active" : ""} ${isDone ? "is-done" : ""}`}
                          onClick={() => {
                            if (!isUnlocked) return;
                            setCurrentStep(stepRow.id);
                          }}
                        >
                          <span className="booking-step-focus__dot-index">{stepRow.id}</span>
                          <span className="booking-step-focus__dot-body">
                            <span className="booking-step-focus__dot-title">{stepRow.title}</span>
                            <span className="booking-step-focus__dot-hint">{stepRow.action}</span>
                          </span>
                          <span className="booking-step-focus__dot-state">{stateLabel}</span>
                        </button>
                      );
                    })}
                  </div>

                  {stepRows.some((row) => row.id < currentStep && row.id <= maxUnlockedStep) ? (
                    <div className="booking-step-focus__quick-edit">
                      <span className="booking-step-focus__quick-label">رجوع سريع</span>
                      {stepRows
                        .filter((row) => row.id < currentStep && row.id <= maxUnlockedStep)
                        .map((row) => (
                          <button
                            key={`step-edit-${row.id}`}
                            type="button"
                            className="btn btn-sm btn-outline-dark booking-step-focus__edit-btn"
                            onClick={() => setCurrentStep(row.id)}
                          >
                            تعديل {row.title}
                          </button>
                        ))}
                    </div>
                  ) : null}
                </div>

                {currentStep === 2 ? (
                  <div className="booking-step-card-shell mb-4">
                    <div className="booking-step-card-shell__header">
                      <div>
                        <div className="booking-step-card-shell__title">
                          التاريخ
                        </div>
                        <p className="booking-step-card-shell__subtitle">
                          اختاري تاريخ الحجز، ثم حددي موظفة ووقت كل خدمة من كرتها.
                        </p>
                      </div>
                      <span className="booking-step-card-shell__badge">02</span>
                    </div>
                    <div className="row">
                      <div className="col-12 mb-4">
                        <div className="booking-date-field">
                          <div className="booking-date-field__head">
                            <label htmlFor="bookingDate" className="form-label mb-0">تاريخ الحجز</label>
                            <div className="booking-calendar-toggle" role="group" aria-label="نوع عرض التاريخ">
                              <button
                                type="button"
                                className={`booking-calendar-toggle__btn ${calendarViewMode === "gregorian" ? "is-active" : ""}`}
                                onClick={() => {
                                  setCalendarViewMode("gregorian");
                                  setHijriPickerOpen(false);
                                }}
                              >
                                ميلادي
                              </button>
                              <button
                                type="button"
                                className={`booking-calendar-toggle__btn ${calendarViewMode === "hijri" ? "is-active" : ""}`}
                                onClick={() => {
                                  setCalendarViewMode("hijri");
                                  const base = normalizeISODate(bookingDate) || todayISO();
                                  setHijriViewMonthISO(findHijriMonthStartISO(base));
                                }}
                              >
                                هجري
                              </button>
                            </div>
                          </div>

                          <div className="booking-date-shell-wrap" ref={hijriPickerRef}>
                            <div
                              className={`booking-date-shell ${bookingDate ? "is-filled" : "is-empty"}`}
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
                              <span className="booking-date-shell__icon" aria-hidden="true">
                                <FontAwesomeIcon icon={faCalendarAlt} />
                              </span>
                              <div className="booking-date-shell__text">
                                <span className={`booking-date-shell__value ${bookingDate ? "" : "is-placeholder"}`}>
                                  {bookingDate ? bookingDateDisplayValue : "اختر تاريخ الحجز"}
                                </span>
                                <span className="booking-date-shell__meta">
                                  {bookingDate ? `عرض ${calendarViewModeLabel}` : `التقويم الحالي: ${calendarViewModeLabel}`}
                                </span>
                              </div>
                              {calendarViewMode === "gregorian" && (
                                <input
                                  ref={dateRef}
                                  key={`bookingDatePicker-${calendarViewMode}`}
                                  type="date"
                                  lang="ar-SA-u-ca-gregory"
                                  className="booking-date-shell__native booking-date-input"
                                  id="bookingDate"
                                  value={bookingDate}
                                  onChange={(e) => applyBookingDate(String(e.target.value || "").trim())}
                                  min={todayISO()}
                                  aria-label="اختر تاريخ الحجز"
                                />
                              )}
                            </div>
                            {calendarViewMode === "hijri" && hijriPickerOpen && (
                              <div className="booking-hijri-picker">
                                <div className="booking-hijri-picker__head">
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-outline-dark"
                                    onClick={() => setHijriViewMonthISO((prev) => shiftHijriMonthStartISO(prev, -1))}
                                  >
                                    السابق
                                  </button>
                                  <strong>{hijriMonthTitle || "التقويم الهجري"}</strong>
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-outline-dark"
                                    onClick={() => setHijriViewMonthISO((prev) => shiftHijriMonthStartISO(prev, 1))}
                                  >
                                    التالي
                                  </button>
                                </div>
                                <div className="booking-hijri-picker__grid booking-hijri-picker__weekdays">
                                  {["س", "ح", "ن", "ث", "ر", "خ", "ج"].map((w) => (
                                    <span key={w}>{w}</span>
                                  ))}
                                </div>
                                <div className="booking-hijri-picker__grid">
                                  {hijriMonthDays.map((cell) => {
                                    const isPast = cell.iso < todayISO();
                                    const isActive = cell.iso === bookingDate;
                                    return (
                                      <button
                                        key={cell.iso}
                                        type="button"
                                        className={["booking-hijri-day", isActive ? "is-active" : ""].join(" ").trim()}
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
                          </div>
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
                  </div>
                ) : null}


                {currentStep === 1 ? (
                  <div className="booking-step-card-shell mb-4">
                    <div className="booking-step-card-shell__header">
                      <div>
                        <div className="booking-step-card-shell__title">الخدمة</div>
                        <p className="booking-step-card-shell__subtitle">
                          اختاري وأضيفي.
                        </p>
                      </div>
                      <span className="booking-step-card-shell__badge">01</span>
                    </div>
                    <div className="mb-0 bk-service-adder">
                      <div className="booking-service-adder-head">
                        <div>
                          <label className="form-label mb-1">نوع الحجز</label>
                          <p className="booking-service-adder-hint">خدمة واحدة كل مرة.</p>
                        </div>
                        <button
                          type="button"
                          className={`booking-service-adder-count booking-service-adder-count--action${cartItems.length ? "" : " is-empty"}`}
                          disabled={!cartItems.length}
                          onClick={() => setShowAddedItemsPanel((prev) => !prev)}
                          aria-expanded={showAddedItemsPanel}
                        >
                          <span>{cartItems.length} مضافة</span>
                          <FontAwesomeIcon icon={faPen} aria-hidden="true" />
                        </button>
                      </div>
                      {showAddedItemsPanel && cartItems.length ? (
                        <div className="booking-added-items-panel" aria-label="الخدمات المضافة">
                          {cartItems.map((item, idx) => (
                            <div key={String(item.id || idx)} className="booking-added-item">
                              <span className="booking-added-item__index">{idx + 1}</span>
                              <span className="booking-added-item__body">
                                <strong>{String(item.serviceName || "").trim() || "خدمة"}</strong>
                                <span>{resolveCartItemPriceText(item)}</span>
                              </span>
                              <button
                                type="button"
                                className="booking-added-item__edit"
                                onClick={() => {
                                  setShowAddedItemsPanel(false);
                                  setCurrentStep(2);
                                }}
                              >
                                تعديل
                              </button>
                              <button
                                type="button"
                                className="booking-added-item__remove"
                                onClick={() => removeServiceFromCart(item.id)}
                              >
                                حذف
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {!pickerScope ? (
                        <div className="booking-type-card-grid mb-3" role="list" aria-label="نوع الحجز">
                          {bookingScopeCards.map((card) => (
                            <button
                              key={card.scope}
                              type="button"
                              role="listitem"
                              className="booking-type-card"
                              onClick={() => {
                                setPickerScope(card.scope);
                                setServicePicker("");
                                setServicePickerList([]);
                                resetSessionPackageSelection();
                                setSelectedSectionId("");
                                setSelectedCategory("");
                                setShowHairGuide(false);
                                setOfferStartTime("");
                              }}
                              aria-pressed={false}
                            >
                              <span className="booking-type-card__media" aria-hidden="true">
                                <img src={card.image} alt="" />
                              </span>
                              <span className="booking-type-card__body">
                                <span className="booking-type-card__badge">{card.badge}</span>
                                <span className="booking-type-card__title">{card.title}</span>
                                <span className="booking-type-card__hint">{card.hint}</span>
                              </span>
                              <span className="booking-type-card__check" aria-hidden="true" />
                            </button>
                          ))}
                        </div>
                      ) : (
                        <>
                          <div className="booking-picker-route-head">
                            <button
                              type="button"
                              className="booking-picker-route-head__back"
                              onClick={() => {
                                setPickerScope("");
                                setServicePicker("");
                                setServicePickerList([]);
                                resetSessionPackageSelection();
                                setSelectedSectionId("");
                                setSelectedCategory("");
                                setShowHairGuide(false);
                                setOfferStartTime("");
                              }}
                            >
                              رجوع
                            </button>
                            <div className="booking-picker-route-head__body">
                              <span className="booking-picker-route-head__eyebrow">نوع الحجز</span>
                              <strong>{activeBookingScopeCard?.title || "الخدمة"}</strong>
                              <span>{activeBookingScopeCard?.hint || "إضافة"}</span>
                            </div>
                          </div>

                      {pickerScope === "services" ? (
                        <div className="booking-catalog-flow">
                          {!selectedSectionId ? (
                            <div className="booking-catalog-flow__panel">
                              <div className="booking-catalog-flow__title">القسم</div>
                              <div className="booking-catalog-grid">
                                {sectionOptionsSafe.map((sec) => {
                                  const sectionImage = pickBookingSectionImage(sec.id, sec.title);
                                  return (
                                    <button
                                      key={sec.id}
                                      type="button"
                                      className="booking-catalog-card"
                                      onClick={() => {
                                        setServicePicker("");
                                        setServicePickerList([]);
                                        handleSectionChange({ target: { value: sec.id } } as React.ChangeEvent<HTMLSelectElement>);
                                      }}
                                    >
                                      <span className="booking-catalog-card__check" aria-hidden="true" />
                                      <span className="booking-catalog-card__media" aria-hidden="true">
                                        <img src={sectionImage} alt="" />
                                      </span>
                                      <span className="booking-catalog-card__body">
                                        <span className="booking-catalog-card__title">{sec.title}</span>
                                        <span className="booking-catalog-card__sub">
                                          فتح
                                        </span>
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="booking-picker-route-head booking-picker-route-head--sub">
                                <button
                                  type="button"
                                  className="booking-picker-route-head__back"
                                  onClick={() => {
                                    setSelectedSectionId("");
                                    setSelectedCategory("");
                                    setServicePicker("");
                                    setServicePickerList([]);
                                    setShowHairGuide(false);
                                  }}
                                >
                                  رجوع للأقسام
                                </button>
                                <div className="booking-picker-route-head__body">
                                  <span className="booking-picker-route-head__eyebrow">القسم</span>
                                  <strong>{selectedSectionOption?.title || "القسم المحدد"}</strong>
                                  <span>
                                    {categoryOptionsSafe.length > 1 && !selectedCategory
                                      ? "التصنيف"
                                      : "الخدمة"}
                                  </span>
                                </div>
                              </div>

                              {categoryOptionsSafe.length > 1 && !selectedCategory ? (
                                <div className="booking-catalog-flow__panel">
                                  <div className="booking-catalog-flow__title">التصنيف</div>
                                  <div className="booking-catalog-grid">
                                    {categoryOptionsSafe.map((cat) => {
                                      const CategoryIcon = pickBookingCategoryIcon(
                                        cat.name,
                                        selectedSectionOption?.title || ""
                                      );
                                      return (
                                        <button
                                          key={cat.id}
                                          type="button"
                                          className="booking-catalog-card"
                                          onClick={() => {
                                          setServicePicker("");
                                          setServicePickerList([]);
                                          setSelectedCategory(String(cat.id || "").trim());
                                          }}
                                        >
                                          <span className="booking-catalog-card__check" aria-hidden="true" />
                                          <span className="booking-catalog-card__media booking-catalog-card__media--icon" aria-hidden="true">
                                            <CategoryIcon />
                                          </span>
                                          <span className="booking-catalog-card__body">
                                            <span className="booking-catalog-card__title">{cat.name}</span>
                                            <span className="booking-catalog-card__sub">
                                              فتح
                                            </span>
                                          </span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              ) : (
                                <>
                                  {categoryOptionsSafe.length > 1 ? (
                                    <div className="booking-picker-route-head booking-picker-route-head--sub">
                                      <button
                                        type="button"
                                        className="booking-picker-route-head__back"
                                        onClick={() => {
                                          setSelectedCategory("");
                                          setServicePicker("");
                                          setServicePickerList([]);
                                        }}
                                      >
                                        تغيير التصنيف
                                      </button>
                                      <div className="booking-picker-route-head__body">
                                        <span className="booking-picker-route-head__eyebrow">التصنيف</span>
                                        <strong>{selectedCategoryOption?.name || "التصنيف المحدد"}</strong>
                                        <span>الخدمة</span>
                                      </div>
                                    </div>
                                  ) : null}

                                  <div className="booking-catalog-flow__panel">
                                    <div className="booking-catalog-flow__title">
                                      الخدمة
                                    </div>
                                    {servicesGrouped.length ? (
                                      <div className="booking-service-list">
                                        {servicesGrouped.map(([cat, items]) => (
                                          <div key={cat} className="booking-service-group">
                                            {categoryOptionsSafe.length > 1 ? (
                                              <div className="booking-service-group__title">{cat}</div>
                                            ) : null}
                                            <div className="booking-service-grid">
                                              {items.map((sv) => {
                                                const serviceId = String(sv.id || "").trim();
                                                const isSelected = servicePickerList.includes(serviceId);
                                                return (
                                                  <button
                                                    key={sv.id}
                                                    type="button"
                                                    className={`booking-service-option${isSelected ? " is-selected" : ""}`}
                                                    onClick={() => {
                                                      setServicePickerList((prev) =>
                                                        prev.includes(serviceId)
                                                          ? prev.filter((id) => id !== serviceId)
                                                          : [...prev, serviceId]
                                                      );
                                                      setServicePicker("");
                                                    }}
                                                    aria-pressed={isSelected}
                                                  >
                                                    <span className="booking-service-option__check" aria-hidden="true">
                                                      {isSelected ? "✓" : ""}
                                                    </span>
                                                    <span className="booking-service-option__body">
                                                      <span className="booking-service-option__name">{sv.name}</span>
                                                      <span className="booking-service-option__sub">
                                                        {sv.durationMin ? `${Number(sv.durationMin || 0)} دقيقة` : "مدة الخدمة"}
                                                      </span>
                                                      <span className="booking-service-price-pill">
                                                        {servicePickerPriceText(sv)}
                                                      </span>
                                                    </span>
                                                  </button>
                                                );
                                              })}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <div className="booking-service-multi-empty">
                                        لا توجد خدمات متاحة لهذا القسم أو التصنيف.
                                      </div>
                                    )}
                                  </div>
                                </>
                              )}
                            </>
                          )}
                        </div>
                      ) : pickerScope === "offers" ? (
                        <div className="booking-choice-panel">
                          <div className="booking-choice-panel__head">
                            <div>
                              <div className="booking-choice-panel__title">العروض</div>
                              <p className="booking-choice-panel__hint">
                                اختاري وأضيفي.
                              </p>
                            </div>
                            <span className="booking-choice-panel__count">
                              {sequenceOfferOptions.length} عروض
                            </span>
                          </div>

                          {hasOfferServiceInCart ? (
                            <div className="booking-service-multi-empty">
                              مسموح بإضافة خدمة عرض واحدة فقط في نفس الحجز.
                            </div>
                          ) : sequenceOfferOptions.length ? (
                            <div className="booking-choice-card-grid">
                              {sequenceOfferOptions.map((offer) => {
                                const isSelected = String(servicePicker || "").trim() === String(offer.id || "").trim();
                                return (
                                  <button
                                    key={offer.id}
                                    type="button"
                                    className={`booking-choice-card${isSelected ? " is-selected" : ""}`}
                                    onClick={() => handleServicePickerChange(offer.id)}
                                    aria-pressed={isSelected}
                                  >
                                    <span className="booking-choice-card__check" aria-hidden="true">
                                      {isSelected ? "✓" : ""}
                                    </span>
                                    <span className="booking-choice-card__tag">عرض</span>
                                    <span className="booking-choice-card__title">{offer.title}</span>
                                    <span className="booking-choice-card__meta">{offer.priceText}</span>
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="booking-empty-choice">
                              <span className="booking-empty-choice__icon" aria-hidden="true">
                                <FiGift />
                              </span>
                              <strong>لا توجد عروض حاليًا</strong>
                              <span>ارجعي للخدمات أو جرّبي لاحقًا.</span>
                            </div>
                          )}
                        </div>
                      ) : pickerScope === "session_packages" ? (
                        <div className="booking-choice-panel">
                          <div className="booking-choice-panel__head">
                            <div>
                              <div className="booking-choice-panel__title">الباقات</div>
                              <p className="booking-choice-panel__hint">
                                باقة ثم خدمة.
                              </p>
                            </div>
                            <span className="booking-choice-panel__count">
                              {sessionPackageOptions.length} باقات
                            </span>
                          </div>

                          {sessionPackageOptions.length ? (
                            <div className="booking-choice-card-grid">
                              {sessionPackageOptions.map((pkg) => {
                                const isSelected = String(servicePicker || "").trim() === String(pkg.id || "").trim();
                                return (
                                  <button
                                    key={pkg.id}
                                    type="button"
                                    className={`booking-choice-card${isSelected ? " is-selected" : ""}`}
                                    onClick={() => handleServicePickerChange(pkg.id)}
                                    aria-pressed={isSelected}
                                  >
                                    <span className="booking-choice-card__check" aria-hidden="true">
                                      {isSelected ? "✓" : ""}
                                    </span>
                                    <span className="booking-choice-card__tag">{pkg.sessionsCount} جلسات</span>
                                    <span className="booking-choice-card__title">{pkg.title}</span>
                                    <span className="booking-choice-card__meta">{pkg.priceText}</span>
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="booking-empty-choice">
                              <span className="booking-empty-choice__icon" aria-hidden="true">
                                <FiGift />
                              </span>
                              <strong>لا توجد باقات حاليًا</strong>
                              <span>الباقات غير متاحة للحجز الآن.</span>
                            </div>
                          )}

                          {selectedSessionPackage ? (
                            <div className="booking-choice-subpanel">
                              <div className="booking-choice-panel__title">خدمة الزيارة</div>
                              {sessionPackageServicesLoading ? (
                                <div className="booking-service-multi-empty">جاري تحميل خدمات الباقة...</div>
                              ) : sessionPackageAllowedServices.length ? (
                                <div className="booking-choice-card-grid booking-choice-card-grid--compact">
                                  {sessionPackageAllowedServices.map((sv) => {
                                    const serviceId = String(sv.id || "").trim();
                                    const isSelected = sessionPackageServicePicker.includes(serviceId);
                                    return (
                                      <button
                                        key={sv.id}
                                        type="button"
                                        className={`booking-choice-card booking-choice-card--service${isSelected ? " is-selected" : ""}`}
                                        onClick={() =>
                                          setSessionPackageServicePicker((prev) =>
                                            prev.includes(serviceId)
                                              ? prev.filter((id) => id !== serviceId)
                                              : [...prev, serviceId]
                                          )
                                        }
                                        aria-pressed={isSelected}
                                      >
                                        <span className="booking-choice-card__check" aria-hidden="true">
                                          {isSelected ? "✓" : ""}
                                        </span>
                                        <span className="booking-choice-card__tag">خدمة</span>
                                        <span className="booking-choice-card__title">{sv.name}</span>
                                        <span className="booking-choice-card__meta">
                                          {sv.durationMin ? `${Number(sv.durationMin || 0)} دقيقة` : "مدة الخدمة"}
                                        </span>
                                      </button>
                                    );
                                  })}
                                </div>
                              ) : (
                                <div className="booking-empty-choice">
                                  <span className="booking-empty-choice__icon" aria-hidden="true">
                                    <FiShoppingBag />
                                  </span>
                                  <strong>لا توجد خدمات للباقة</strong>
                                  <span>اختاري باقة أخرى.</span>
                                </div>
                              )}
                              <div className="booking-choice-note">
                                {sessionPackageServicePicker.length > 0
                                  ? `${sessionPackageServicePicker.length} محددة من باقة ${selectedSessionPackage.title}.`
                                  : `اختاري خدمة أو أكثر من باقة ${selectedSessionPackage.title}.`}
                              </div>
                              {sessionPackageServicesError ? (
                                <div className="booking-choice-note is-error">{sessionPackageServicesError}</div>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div className="booking-choice-panel">
                          <div className="booking-choice-panel__head">
                            <div>
                              <div className="booking-choice-panel__title">البكجات</div>
                              <p className="booking-choice-panel__hint">
                                البكج يضيف خدماته كسطور مستقلة في السلة مع الحفاظ على سعره.
                              </p>
                            </div>
                            <span className="booking-choice-panel__count">
                              {packageOptions.length} بكجات
                            </span>
                          </div>

                          {packageOptions.length ? (
                            <div className="booking-choice-card-grid">
                              {packageOptions.map((pkg) => {
                                const isSelected = String(servicePicker || "").trim() === String(pkg.id || "").trim();
                                return (
                                  <button
                                    key={pkg.id}
                                    type="button"
                                    className={`booking-choice-card${isSelected ? " is-selected" : ""}`}
                                    onClick={() => handleServicePickerChange(pkg.id)}
                                    aria-pressed={isSelected}
                                  >
                                    <span className="booking-choice-card__check" aria-hidden="true">
                                      {isSelected ? "✓" : ""}
                                    </span>
                                    <span className="booking-choice-card__tag">بكج</span>
                                    <span className="booking-choice-card__title">{pkg.title}</span>
                                    <span className="booking-choice-card__meta">{pkg.priceText}</span>
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="booking-empty-choice">
                              <span className="booking-empty-choice__icon" aria-hidden="true">
                                <FiShoppingBag />
                              </span>
                              <strong>لا توجد بكجات حاليًا</strong>
                              <span>ارجعي للخدمات أو جرّبي لاحقًا.</span>
                            </div>
                          )}
                        </div>
                      )}

                      {(pickerScope === "services" ||
                        (pickerScope === "offers" && sequenceOfferOptions.length > 0 && !hasOfferServiceInCart) ||
                        (pickerScope === "session_packages" && sessionPackageOptions.length > 0) ||
                        (pickerScope === "offers_packages" && packageOptions.length > 0)) ? (
                      <div className="row g-2 mt-2">
                        <div className="col-12 d-grid">
                          <button
                            type="button"
                            className="btn btn-dark booking-service-add-btn"
                            disabled={
                              (pickerScope === "services"
                                ? servicePickerList.length <= 0
                                : pickerScope === "session_packages"
                                  ? !servicePicker || sessionPackageServicePicker.length <= 0
                                  : !servicePicker) ||
                              (pickerScope === "offers" && hasOfferServiceInCart)
                            }
                            onClick={() => {
                              if (pickerScope === "services") {
                                const pickedServiceIds = [...servicePickerList];
                                void (async () => {
                                  for (const pickedServiceId of pickedServiceIds) {
                                    await addServiceToCart(pickedServiceId);
                                  }
                                  resetBookingPickerForNextAdd();
                                })();
                                return;
                              }
                              if (pickerScope === "offers") {
                                void addOfferFromPicker();
                                return;
                              }
                              if (pickerScope === "session_packages" && selectedSessionPackage) {
                                const pickedSessionServiceIds = [...sessionPackageServicePicker];
                                const allowedServicesSnapshot: PackageServiceItem[] = sessionPackageAllowedServices.map((sv) => ({
                                  serviceId: String(sv.id || "").trim(),
                                  serviceName: String(sv.name || "").trim(),
                                  sectionId: String(sv.sectionId || "").trim() || undefined,
                                  categoryId: String(sv.categoryId || "").trim() || undefined,
                                  price: Math.max(0, Number(sv.basePrice || 0)),
                                  durationMin: Math.max(
                                    1,
                                    Number(sv.durationMin || DEFAULT_SERVICE_DURATION_MIN)
                                  ),
                                }));
                                const sessionPackageSelection = {
                                  packageId: String(selectedSessionPackage.id || "").replace(/^spkg:/, ""),
                                  packageName: String(selectedSessionPackage.title || "").trim(),
                                  packagePrice: Math.max(0, Number(selectedSessionPackage.price || 0)),
                                  sessionsCount: Math.max(1, Number(selectedSessionPackage.sessionsCount || 1)),
                                  allowedServiceIds: Array.isArray(selectedSessionPackage.allowedServiceIds)
                                    ? selectedSessionPackage.allowedServiceIds
                                    : [],
                                  allowedServicesSnapshot,
                                };
                                void (async () => {
                                  for (const pickedServiceId of pickedSessionServiceIds) {
                                    await addServiceToCart(pickedServiceId, {
                                      sessionPackageSelection,
                                    });
                                  }
                                  resetBookingPickerForNextAdd();
                                })();
                                return;
                              }
                              if (pickerScope === "offers_packages") {
                                void (async () => {
                                  await addServiceToCart(servicePicker);
                                  resetBookingPickerForNextAdd();
                                })();
                              }
                            }}
                          >
                            {pickerScope === "services"
                              ? servicePickerList.length > 1
                                ? `إضافة ${servicePickerList.length} خدمات`
                                : "إضافة الخدمة"
                              : pickerScope === "offers_packages"
                                ? "إضافة البكج"
                                : pickerScope === "session_packages" && sessionPackageServicePicker.length > 1
                                  ? `إضافة ${sessionPackageServicePicker.length} خدمات`
                                  : "إضافة"}
                          </button>
                        </div>
                      </div>
                      ) : null}

                      {/* ✅ دليل أطوال الشعر */}
                      {selectedSectionId && isHairSection && (
                        <div className="mt-3 booking-hair-guide-panel">
                          <div className="d-flex align-items-center justify-content-between gap-2 flex-wrap">
                            <div className="booking-hair-guide-panel__title-wrap">
                              <div className="booking-hair-guide-panel__title">دليل أطوال الشعر</div>
                            </div>

                            <div className="d-flex align-items-center gap-2">
                              <button
                                type="button"
                                className={`btn btn-sm booking-hair-guide-toggle ${showHairGuide ? "btn-outline-dark is-close" : "booking-hair-guide-panel__btn-secondary"}`}
                                onClick={() => setShowHairGuide(v => !v)}
                                aria-label={showHairGuide ? "إغلاق الصورة" : "عرض الصورة"}
                              >
                                {showHairGuide ? (
                                  <span className="booking-hair-guide-close-icon">✕</span>
                                ) : "عرض الصورة"}
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
                                    className="btn btn-sm booking-hair-guide-panel__btn-primary"
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
                            <div className="mt-3 text-center booking-hair-guide-panel__image-wrap">
                              <img
                                src={hairGuideUrl}
                                alt="دليل أطوال الشعر"
                                className="booking-hair-guide-panel__image"
                              />
                            </div>
                          )}
                        </div>
                      )}
                        </>
                      )}
                    </div>
                    <div className="mt-3 d-grid">
                      <button
                        type="button"
                      className="btn btn-dark"
                      disabled={!isStep1Complete}
                      onClick={() => setCurrentStep(2)}
                    >
                        التالي: الموظفة
                      </button>
                    </div>
                  </div>
                ) : null}


                {currentStep === 2 ? (
                  <div className="booking-step-helper mb-3">
                    <div className="booking-step-helper__title">لكل خدمة موظفتها ووقتها</div>
                    <div className="booking-step-helper__text">
                      اختاري التاريخ، ثم افتحي كل كرت خدمة وحددي الموظفة المناسبة والوقت المتاح لها.
                    </div>
                  </div>
                ) : null}

                {/* ✅ الخدمات المختارة (السلة) */}
                {currentStep === 2 ? (
                  <div className="booking-step-card-shell booking-step-card-shell--cart mb-4">
                    <div className="booking-step-card-shell__header booking-cart-head">
                      <div>
                        <div className="booking-step-card-shell__title">الموعد</div>
                        <p className="booking-step-card-shell__subtitle">
                          لكل خدمة اختاري الموظفة ثم الوقت، وبعدها أكدي الاختيار.
                        </p>
                      </div>
                      <span className="booking-cart-count">{(formData.items || []).length} خدمات</span>
                    </div>
                    {!hasSelectedBookingDate ? (
                      <div className="booking-step-date-required-note" role="status" aria-live="polite">
                        <strong>اختاري التاريخ</strong>
                        <span>ثم الوقت.</span>
                      </div>
                    ) : null}

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
                          const dateISO = String(it.date || "").trim();
                          const daySettingsForItem = getDaySettingsForDate(
                            dateISO || String(bookingDate || "").trim() || todayISO()
                          );
                          const dayOpenTimeForItem = safeTimeHHMM(daySettingsForItem.openTime, openTime);
                          const dayCloseTimeForItem = safeTimeHHMM(daySettingsForItem.closeTime, closeTime);
                          const baseSlotsForUi = daySettingsForItem.enabled
                            ? generateSalonTimeSlots(dayOpenTimeForItem, dayCloseTimeForItem, slotStepMin)
                            : [];

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
                          const serviceKeyForStaff =
                            resolveCanonicalServiceId(
                              String(it.serviceId || "").trim(),
                              String((it as any)?.serviceName || "").trim()
                            ) || String(it.serviceId || "").trim();
                          const serviceStaff = staffByService[serviceKeyForStaff] || [];
                          const bookingVisibleStaff = serviceStaff.filter(
                            (st) => !isStaffEmploymentEndedForDate(st as any, dateISO)
                          );
                          const staffWithLeaveMeta = bookingVisibleStaff.map((st) => {
                            const leave = getStaffLeaveMetaForDate(st, dateISO);
                            const workingSlots = filterStaffSlotsByWorkingHours(st as any, {
                              dateISO,
                              slots: baseSlotsForUi,
                              fallbackOpenTime: dayOpenTimeForItem,
                              fallbackCloseTime: dayCloseTimeForItem,
                            });
                            const statusRaw = String((st as any)?.status || "").trim().toLowerCase();
                            const isInactive =
                              (st as any)?.active === false ||
                              (st as any)?.showOnBooking === false ||
                              statusRaw === "inactive" ||
                              statusRaw === "disabled" ||
                              statusRaw === "suspended";
                            return {
                              staff: st,
                              leave,
                              hasWorkingHours: workingSlots.length > 0,
                              isInactive,
                            };
                          });
                          const activeVisibleStaff = staffWithLeaveMeta
                            .filter((x) => !x.isInactive)
                            .map((x) => x.staff);
                          const availableStaff = staffWithLeaveMeta
                            .filter((x) => !x.leave.isOnLeave && x.hasWorkingHours && !x.isInactive)
                            .map((x) => x.staff);
                          const staffChoicesForItem = activeVisibleStaff;
                          const staffLoading = !!staffLoadingByService[serviceKeyForStaff];
                          const staffError = staffErrorByService[serviceKeyForStaff] || "";
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
                          const usePackageQuickMode = hasPackageQuickMode;
                          const isPackageRunFollower = !!packageRunMeta && !isPackageRunLeader;
                          const packageName = String(it.packageSnapshot?.packageName || "").trim();
                          const packageFinalPrice = Math.max(0, Number(it.packageSnapshot?.finalPriceAtBooking || 0));
                          const showAsPackageBlock = usePackageQuickMode && isPackageRunLeader && !!packageName;
                          const cardTitle = showAsPackageBlock ? packageName : it.serviceName;
                          const cardPriceText = showAsPackageBlock && packageFinalPrice > 0
                            ? `${packageFinalPrice} ريال`
                            : resolveCartItemPriceText(it);
                          const ServiceCardIcon = pickBookingCardIcon(String(cardTitle || ""));
                          if (usePackageQuickMode && isPackageRunFollower) return null;
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
                          const dayFullyBookedMsg =
                            "هذه الموظفة ممتلئ جدولها اليوم. ابحثي عن أقرب يوم متاح لها.";
                          const futureSearchBtnLabel = "بحث عن أقرب موعد";
                          const slotsForThisService = filterSlotsByServiceEnd(
                            baseSlotsForUi,
                            dayCloseTimeForItem,
                            Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN),
                            bufferMin,
                            ALLOW_OVERTIME_MIN
                          );
                          const selectedStaffForTime = bookingVisibleStaff.find(
                            (x) => String(x.id || "").trim() === String(it.employeeId || "").trim()
                          );
                          const staffWorkingSlots = selectedStaffForTime
                            ? filterStaffSlotsByWorkingHours(selectedStaffForTime as any, {
                              dateISO,
                              slots: baseSlotsForUi,
                              fallbackOpenTime: dayOpenTimeForItem,
                              fallbackCloseTime: dayCloseTimeForItem,
                            })
                            : [];
                          const staffWindows = selectedStaffForTime
                            ? resolveStaffWorkingWindowsForDate(selectedStaffForTime as any, {
                              dateISO,
                              fallbackOpenTime: dayOpenTimeForItem,
                              fallbackCloseTime: dayCloseTimeForItem,
                            })
                            : [];
                          const exactCartTakenStarts = getLocalExactTakenStartTimesForItem(
                            itemsList,
                            it.id,
                            String(it.employeeId || "").trim(),
                            dateISO
                          );
                          const staffWindowSections: Array<{
                            key: string;
                            label: string;
                            slotCards: TimeSlotCard[];
                          }> = selectedStaffForTime
                              ? staffWindows.map((window, idx) => {
                                const windowSlots = staffWorkingSlots.filter((slot) =>
                                  isTimeInsideWindowRange(
                                    String(slot?.value24 || "").trim(),
                                    String(window.start || "").trim(),
                                    String(window.end || "").trim()
                                  )
                                );
                                const startCandidates = filterSlotsByServiceEnd(
                                  windowSlots,
                                  String(window.end || "").trim(),
                                  Number(it.durationMin || DEFAULT_SERVICE_DURATION_MIN),
                                  bufferMin,
                                  ALLOW_OVERTIME_MIN
                                );
                                const slotCards: TimeSlotCard[] = startCandidates.map((slot) => {
                                  const value24 = String(slot?.value24 || "").trim();
                                  const neededSlots = getTimesToLock(
                                    baseSlotsForUi,
                                    slotStepMin,
                                    value24,
                                    Math.max(1, Number(dur || DEFAULT_SERVICE_DURATION_MIN)),
                                    bufferMin
                                  );
                                  const hasBusyConflict =
                                    neededSlots.some((t) => busy.busyTimes.has(String(t || "").trim())) ||
                                    exactCartTakenStarts.has(value24);
                                  const disabledByRules = busy.disabledStartTimes.has(value24);
                                  if (hasBusyConflict) {
                                    return {
                                      slot,
                                      value24,
                                      state: "booked" as SlotChipState,
                                      reason: "محجوز",
                                      isSelected: String(it.time || "").trim() === value24,
                                    };
                                  }
                                  if (disabledByRules) {
                                    return {
                                      slot,
                                      value24,
                                      state: "unavailable" as SlotChipState,
                                      reason: "غير متاح بسبب التعارض أو البفر",
                                      isSelected: String(it.time || "").trim() === value24,
                                    };
                                  }
                                  return {
                                    slot,
                                    value24,
                                    state: "available" as SlotChipState,
                                    reason: "متاح",
                                    isSelected: String(it.time || "").trim() === value24,
                                  };
                                });
                                return {
                                  key: `${idx}_${window.start}_${window.end}`,
                                  label: buildStaffWindowLabel(window, idx, staffWindows.length),
                                  slotCards,
                                };
                              })
                              : [];
                          const availableSlotsForItem = staffWindowSections.flatMap((x) =>
                            x.slotCards.filter((slot) => slot.state === "available")
                          );
                          const staffFullDayLookupForItem = staffFullDayByItem[it.id] || {};
                          const selectedStaffIdForTime = String((selectedStaffForTime as any)?.id || "").trim();
                          const selectedStaffMarkedFullDay =
                            !!(selectedStaffIdForTime && staffFullDayLookupForItem[selectedStaffIdForTime]);
                          const selectedStaffFullyBookedToday =
                            !!selectedStaffForTime &&
                            (selectedStaffMarkedFullDay ||
                              (!busy.loading &&
                                staffWindowSections.length > 0 &&
                                availableSlotsForItem.length === 0));

                          // ✅ شكل الكرت وهو مقفول (تم التأكيد)
                          if (isLocked) {
                            return (
                              <Fragment key={it.id}>
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
                                <div className="booking-cart-item-locked mb-3">
                                  <div className="booking-cart-item-locked__head">
                                    <div className="booking-cart-item-locked__service-media" aria-hidden="true">
                                      <ServiceCardIcon className="booking-cart-item-locked__service-icon" />
                                    </div>
                                    <div className="booking-cart-item-locked__meta">
                                      <div className="booking-cart-item-locked__title-row">
                                        <span className="booking-cart-item-locked__title">{cardTitle}</span>
                                        <span className="booking-cart-item-locked__index">{rowIdx + 1}</span>
                                      </div>
                                      <div className="booking-cart-item-locked__sub">
                                        {dur} دقيقة - {String(it.date || bookingDate || "-")}
                                      </div>
                                    </div>
                                    <div className="booking-cart-item-locked__price">{cardPriceText}</div>
                                  </div>

                                  <div className="booking-cart-item-locked__actions">
                                    <button
                                      type="button"
                                      className="btn btn-outline-secondary btn-sm"
                                      onClick={() => {
                                        const list = formData.items || [];
                                        const idx = list.findIndex((x) => x.id === it.id);
                                        setFormData((prev) => ({
                                          ...prev,
                                          items: (prev.items || []).map((x, i) => {
                                            if (i === idx) return { ...x, locked: false };
                                            if (i > idx) {
                                              return {
                                                ...x,
                                                locked: false,
                                                time: "",
                                                employeeId: "",
                                                employeeUid: "",
                                                employeeName: "",
                                              };
                                            }
                                            return x;
                                          }),
                                        }));
                                      }}
                                    >
                                      عرض
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-outline-danger btn-sm"
                                      onClick={() => removeServiceFromCart(it.id)}
                                    >
                                      حذف
                                    </button>
                                  </div>

                                  <div className="booking-cart-item-locked__note">
                                    <span className="booking-cart-item-locked__badge">✅ مؤكد</span>
                                    <span>تم إغلاق البطاقة يمكنك اضافه خدمه اخرى .</span>
                                  </div>
                                </div>
                              </Fragment>
                            );
                          }

                          // ✅ شكل الكرت وهو مفتوح (جاري الاختيار)
                          return (
                            <Fragment key={it.id}>
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
                                    {isPackageRunLeader && packageRunMeta && staffChoiceMode === "manual" && (quickLoading || hasPackageQuickMode) ? (
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
                                              <div>
                                                <label className="form-label small fw-bold">موظفة البكج</label>
                                                <div className="bk-staff-card-grid">
                                                  {quickCommonStaff.map((emp: any) => {
                                                    const empId = String(emp?.id || "").trim();
                                                    const selected = empId && empId === String(packageQuickState.employeeId || "").trim();
                                                    return (
                                                      <button
                                                        key={empId || String(emp?.name || "").trim()}
                                                        type="button"
                                                        className={[
                                                          "bk-staff-card-btn",
                                                          selected ? "is-selected" : "",
                                                        ].join(" ").trim()}
                                                        onClick={() => {
                                                          const nextEmpId = selected ? "" : empId;
                                                          setPackageQuickByRun((prev) => ({
                                                            ...prev,
                                                            [packageRunId]: {
                                                              employeeId: nextEmpId,
                                                              times: [],
                                                              loading: false,
                                                              error: "",
                                                            },
                                                          }));
                                                          if (nextEmpId) {
                                                            void loadPackageQuickStarts(packageRunId, nextEmpId);
                                                          }
                                                        }}
                                                      >
                                                        <span className="bk-staff-card-icon" aria-hidden="true">
                                                          <svg
                                                            width="22"
                                                            height="22"
                                                            viewBox="0 0 24 24"
                                                            fill="none"
                                                            xmlns="http://www.w3.org/2000/svg"
                                                          >
                                                            <path
                                                              d="M12 12.2C15.09 12.2 17.6 9.69 17.6 6.6C17.6 3.51 15.09 1 12 1C8.91 1 6.4 3.51 6.4 6.6C6.4 9.69 8.91 12.2 12 12.2Z"
                                                              fill="#374957"
                                                              fillOpacity="0.12"
                                                            />
                                                            <path
                                                              d="M12 12.2C15.09 12.2 17.6 9.69 17.6 6.6C17.6 3.51 15.09 1 12 1C8.91 1 6.4 3.51 6.4 6.6C6.4 9.69 8.91 12.2 12 12.2Z"
                                                              stroke="#374957"
                                                              strokeWidth="1.3"
                                                            />
                                                            <path
                                                              d="M3.2 22.6C3.2 18.84 7.14 15.8 12 15.8C16.86 15.8 20.8 18.84 20.8 22.6"
                                                              stroke="#374957"
                                                              strokeWidth="1.3"
                                                              strokeLinecap="round"
                                                            />
                                                          </svg>
                                                        </span>
                                                        <span className="bk-staff-card-name">{String(emp?.name || "").trim() || "موظفة"}</span>
                                                        {selected ? <span className="bk-staff-card-state">محددة</span> : null}
                                                      </button>
                                                    );
                                                  })}
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
                                            {packageServiceNames.map((name, idx) => (
                                              <span
                                                key={`${name}-${idx}`}
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

                                    {!usePackageQuickMode && staffChoiceMode === "manual" && (
                                      <div className="col-12">
                                        <label className="form-label small fw-bold">1. اختاري موظفة هذه الخدمة</label>
                                        {staffLoading ? (
                                          <div className="booking-stylist-card__loading">
                                            <FontAwesomeIcon icon={faSpinner} spin /> جاري تحميل الموظفات...
                                          </div>
                                        ) : staffError ? (
                                          <div className="booking-stylist-card__error">{staffError}</div>
                                        ) : staffChoicesForItem.length ? (
                                          <div className="booking-stylist-list booking-stylist-list--item">
                                            {staffChoicesForItem.map((emp: any, empIdx: number) => {
                                              const empId = String(emp?.id || "").trim();
                                              const displayEmp = empId
                                                ? { ...emp, ...(staffDisplayById[empId] || {}) }
                                                : emp;
                                              const empName = String(displayEmp?.name || emp?.name || "").trim() || "موظفة";
                                              const selected = !!empId && empId === String(it.employeeId || "").trim();
                                              const avatarUrl = pickStaffAvatarUrl(displayEmp);
                                              const ratingMeta = pickStaffRatingMeta(displayEmp);
                                              return (
                                                <button
                                                  key={empId || `${empName}-${empIdx}`}
                                                  type="button"
                                                  className={`booking-stylist-row${selected ? " is-selected" : ""}`}
                                                  onClick={() => {
                                                    const nextEmpId = selected ? "" : empId;
                                                    updateItem(it.id, {
                                                      employeeId: nextEmpId,
                                                      employeeUid: nextEmpId ? String(displayEmp?.linkedUid || emp?.linkedUid || "").trim() : "",
                                                      employeeName: nextEmpId ? empName : "",
                                                      time: "",
                                                      locked: false,
                                                    });
                                                  }}
                                                  aria-pressed={selected}
                                                >
                                                  <span className="booking-stylist-row__avatar" aria-hidden="true">
                                                    {avatarUrl ? (
                                                      <img src={avatarUrl} alt="" />
                                                    ) : (
                                                      <span>{firstDisplayLetter(empName)}</span>
                                                    )}
                                                  </span>
                                                  <span className="booking-stylist-row__body">
                                                    <span className="booking-stylist-row__name">{empName}</span>
                                                    <span className={`booking-stylist-row__rating${ratingMeta ? "" : " is-empty"}`}>
                                                      <span aria-hidden="true">★</span> {ratingMeta || "بدون تقييم"}
                                                    </span>
                                                  </span>
                                                  <span className="booking-stylist-row__state" aria-hidden="true">
                                                    ♥
                                                  </span>
                                                  <span className="booking-stylist-row__action">
                                                    {selected ? "مختارة" : "اختيار"}
                                                  </span>
                                                </button>
                                              );
                                            })}
                                          </div>
                                        ) : (
                                          <div className="bk-time-window-empty">
                                            لا توجد موظفات مناسبات لهذه الخدمة في هذا التاريخ.
                                          </div>
                                        )}
                                        {hasSelectedBookingDate && staffUnavailableMsg && (
                                          <div className="text-warning small mt-2">{staffUnavailableMsg}</div>
                                        )}
                                        {hasSelectedBookingDate && !selectedEmployeeAvailable && String(it.employeeId || "").trim() && (
                                          <div className="text-warning small mt-2">
                                            الموظفة المختارة غير متاحة في هذا التاريخ، اختاري موظفة أخرى.
                                          </div>
                                        )}
                                      </div>
                                    )}

                                    {hasSelectedBookingDate && !usePackageQuickMode ? (
                                      <div className="col-12">
                                        <label className="form-label small fw-bold">2. اختاري الوقت المتاح</label>
                                        {String(it.time || "").trim() && String(expandedTimePickerItemId || "").trim() !== String(it.id || "").trim() ? (
                                          <div className="bk-selected-time-summary">
                                            <div>
                                              <span>الوقت المحدد</span>
                                              <strong>{formatTime12ForClient(String(it.time || "").trim())}</strong>
                                            </div>
                                            <button
                                              type="button"
                                              className="bk-selected-time-summary__change"
                                              onClick={() => setExpandedTimePickerItemId(String(it.id || "").trim())}
                                            >
                                              تغيير الوقت
                                            </button>
                                          </div>
                                        ) : (
                                          <>
                                        {!selectedStaffForTime ? (
                                          <div className="bk-time-window-empty">اختاري الموظفة أولاً لعرض الفترات المتاحة.</div>
                                        ) : selectedStaffFullyBookedToday ? (
                                          <div className="bk-no-slots-panel">
                                            <div className="bk-no-slots-panel__title">{dayFullyBookedMsg}</div>
                                            <div className="bk-no-slots-panel__buttons">
                                              <button
                                                type="button"
                                                className="btn btn-outline-dark btn-sm bk-future-search-btn"
                                                onClick={() => {
                                                  void openFutureSearchFromItem(it);
                                                }}
                                                disabled={futureLoading}
                                              >
                                                {futureLoading && String(futureTargetItemId || "").trim() === String(it.id || "").trim()
                                                  ? "جاري البحث..."
                                                  : futureSearchBtnLabel}
                                              </button>
                                            </div>
                                            {String(futureTargetItemId || "").trim() === String(it.id || "").trim() && futureMsg ? (
                                              <div className="small text-muted mt-2">{futureMsg}</div>
                                            ) : null}
                                            {String(futureTargetItemId || "").trim() === String(it.id || "").trim() && futureResult.length ? (
                                              <div className="mt-2">
                                                <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">
                                                  <div className="small fw-bold">نتائج البحث</div>
                                                  <button
                                                    type="button"
                                                    className="btn btn-sm bk-future-pill"
                                                    onClick={() => {
                                                      const nearestDate = String(futureResult[0]?.date || "").trim();
                                                      if (!nearestDate) return;
                                                      applyDateToSingleItem(it.id, nearestDate);
                                                      setBookingDate(nearestDate);
                                                      setFutureMsg("تم تحديث التاريخ لنفس الخدمة. اختاري الوقت المناسب من الشبكية.");
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
                                            ) : null}
                                          </div>
                                        ) : (
                                          <div className="bk-time-windows">
                                            {staffWindowSections.length === 0 ? (
                                              <div className="bk-time-window-empty">لا توجد فترات عمل لهذه الموظفة في هذا اليوم.</div>
                                            ) : (
                                              staffWindowSections.map((section) => (
                                                <div key={section.key} className="bk-time-window-section">
                                                  <div className="bk-time-window-title">{section.label}</div>
                                                  {section.slotCards.length > 0 ? (
                                                    <div className="bk-time-grid">
                                                      {section.slotCards.map((slotCard) => {
                                                        const isAvailable = slotCard.state === "available";
                                                        const isSequentialSuggested =
                                                          sequentialBooking &&
                                                          !!isAvailable &&
                                                          String(busy.suggestedSlot || "").trim() === String(slotCard.value24 || "").trim();
                                                        return (
                                                          <button
                                                            key={`${section.key}_${slotCard.value24}`}
                                                            type="button"
                                                            className={[
                                                              "bk-time-chip",
                                                              slotCard.state === "booked"
                                                                ? "is-booked"
                                                                : slotCard.state === "unavailable"
                                                                  ? "is-unavailable"
                                                                  : "is-available",
                                                              !isAvailable ? "is-disabled" : "",
                                                              isSequentialSuggested ? "is-sequential-suggested" : "",
                                                              slotCard.isSelected ? "is-selected" : "",
                                                            ].join(" ").trim()}
                                                            disabled={!isAvailable}
                                                            onClick={() => {
                                                              if (!isAvailable) return;
                                                              updateItem(it.id, { time: slotCard.value24 });
                                                              setExpandedTimePickerItemId("");
                                                            }}
                                                            title={slotCard.reason}
                                                          >
                                                            <span className="bk-time-chip__time">{slotCard.slot.label12}</span>
                                                            <span className="bk-time-chip__status">
                                                              {slotCard.state === "booked"
                                                                ? "محجوز"
                                                                : slotCard.state === "unavailable"
                                                                  ? "غير متاح"
                                                                  : "✅ متاح"}
                                                            </span>
                                                          </button>
                                                        );
                                                      })}
                                                    </div>
                                                  ) : (
                                                    <div className="bk-time-window-empty">لا يوجد مواعيد متاحة في هذه الفترة.</div>
                                                  )}
                                                </div>
                                              ))
                                            )}
                                          </div>
                                        )}
                                          </>
                                        )}

                                        {selectedStaffForTime && availableSlotsForItem.length === 0 && !selectedStaffFullyBookedToday ? (
                                          <div className="bk-no-slots-panel">
                                            <div className="bk-no-slots-panel__title">{dayFullyBookedMsg}</div>
                                            <div className="bk-no-slots-panel__buttons">
                                              <button
                                                type="button"
                                                className="btn btn-outline-dark btn-sm bk-future-search-btn"
                                                onClick={() => {
                                                  void openFutureSearchFromItem(it);
                                                }}
                                                disabled={futureLoading}
                                              >
                                                {futureLoading && String(futureTargetItemId || "").trim() === String(it.id || "").trim()
                                                  ? "جاري البحث..."
                                                  : futureSearchBtnLabel}
                                              </button>
                                            </div>
                                            {String(futureTargetItemId || "").trim() === String(it.id || "").trim() && futureMsg ? (
                                              <div className="small text-muted mt-2">{futureMsg}</div>
                                            ) : null}
                                            {String(futureTargetItemId || "").trim() === String(it.id || "").trim() && futureResult.length ? (
                                              <div className="mt-2">
                                                <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mb-2">
                                                  <div className="small fw-bold">نتائج البحث</div>
                                                  <button
                                                    type="button"
                                                    className="btn btn-sm bk-future-pill"
                                                    onClick={() => {
                                                      const nearestDate = String(futureResult[0]?.date || "").trim();
                                                      if (!nearestDate) return;
                                                      applyDateToSingleItem(it.id, nearestDate);
                                                      setBookingDate(nearestDate);
                                                      setFutureMsg("تم تحديث التاريخ لنفس الخدمة. اختاري الوقت المناسب من الشبكية.");
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
                                            ) : null}
                                          </div>
                                        ) : null}

                                        {busy.loading && <div className="small text-muted mt-2"><FontAwesomeIcon icon={faSpinner} spin /> جاري تحميل الأوقات...</div>}
                                        {busy.hint && !selectedStaffFullyBookedToday && !String(busy.hint).includes("الوقت المقترح") && (
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
                                    ) : null}
                                  </div>
                                )}
                              </div>
                            </Fragment>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="p-4 text-center" style={{ border: '2px dashed #ddd', borderRadius: '12px', background: '#fdfdfd' }}>
                        <p className="text-muted m-0">أضيفي خدمة للبدء.</p>
                      </div>
                    )}
                  </div>
                ) : null}

                {currentStep === 4 ? (
                  <div className="booking-step-card-shell booking-step-card-shell--review mb-4">
                    <div className="booking-step-card-shell__header">
                      <div>
                        <div className="booking-step-card-shell__title">التأكيد</div>
                        <p className="booking-step-card-shell__subtitle">
                          تأكدي من الخدمة، الموظفة، الوقت، والسعر قبل إرسال الحجز النهائي.
                        </p>
                      </div>
                      <span className="booking-step-card-shell__badge">04</span>
                    </div>
                  <div className="booking-pre-save-summary mb-0">
                    <div className="booking-pre-save-summary__head">
                      <div className="booking-pre-save-summary__title">الملخص</div>
                      <div className="booking-pre-save-summary__count">
                        مؤكد: <span dir="ltr">{lockedPreviewCount} / {totalPreviewCount}</span>
                      </div>
                    </div>
                    <div className="booking-pre-save-summary__meta">
                      <div className="booking-pre-save-summary__meta-item">
                        <span className="booking-pre-save-summary__meta-label">العميلة</span>
                        <strong className="booking-pre-save-summary__meta-value">{String(formData.name || "").trim() || "-"}</strong>
                      </div>
                      <div className="booking-pre-save-summary__meta-item">
                        <span className="booking-pre-save-summary__meta-label">الجوال</span>
                        <strong className="booking-pre-save-summary__meta-value">{phone10Digits(String(formData.phone || "").trim()) || "-"}</strong>
                      </div>
                      <div className="booking-pre-save-summary__meta-item">
                        <span className="booking-pre-save-summary__meta-label">وقت إنشاء الحجز</span>
                        <strong className="booking-pre-save-summary__meta-value">{previewCreatedAtLabel}</strong>
                      </div>
                    </div>

                    {appliedDiscountTotal > 0 ? (
                      <div className="booking-pre-save-summary__discount">
                        <div className="booking-pre-save-summary__discount-title">
                          الخصم المطبق ({appliedCoupons.length})
                        </div>
                        <div className="booking-pre-save-summary__discount-lines">
                          <div className="booking-pre-save-summary__discount-line is-before">
                            <span>قبل الخصم</span>
                            <strong>{basePrice.toFixed(0)} ريال</strong>
                          </div>
                          <div className="booking-pre-save-summary__discount-line is-discount">
                            <span>قيمة الخصم</span>
                            <strong>-{Number(appliedDiscountTotal || 0).toFixed(0)} ريال</strong>
                          </div>
                          <div className="booking-pre-save-summary__discount-line is-after">
                            <span>بعد الخصم</span>
                            <strong>{finalPrice.toFixed(0)} ريال</strong>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <div className="booking-pre-save-summary__rows">
                      {bookingPreviewItems.map((row) => (
                        <div key={`preview-${row.id}`} className="booking-pre-save-summary__row">
                          <div className="booking-pre-save-summary__row-head">
                            <span className="booking-pre-save-summary__row-index">#{row.index}</span>
                            <span className="booking-pre-save-summary__row-service">{row.serviceName}</span>
                          </div>
                          <div className="booking-pre-save-summary__row-meta">
                            <span className="booking-pre-save-summary__fact">
                              <span className="booking-pre-save-summary__fact-label">الموظفة</span>
                              <strong className="booking-pre-save-summary__fact-value">{row.staffName}</strong>
                            </span>
                            <span className="booking-pre-save-summary__fact">
                              <span className="booking-pre-save-summary__fact-label">التاريخ</span>
                              <strong className="booking-pre-save-summary__fact-value">{row.date}</strong>
                            </span>
                            <span className="booking-pre-save-summary__fact">
                              <span className="booking-pre-save-summary__fact-label">الوقت</span>
                              <strong className="booking-pre-save-summary__fact-value">{row.timeLabel}</strong>
                            </span>
                            <span className="booking-pre-save-summary__fact">
                              <span className="booking-pre-save-summary__fact-label">المدة</span>
                              <strong className="booking-pre-save-summary__fact-value">{row.durationMin} د</strong>
                            </span>
                            <span className="booking-pre-save-summary__fact">
                              <span className="booking-pre-save-summary__fact-label">السعر</span>
                              <strong className="booking-pre-save-summary__fact-value">{row.priceLabel}</strong>
                            </span>
                            {row.toolsNote ? (
                              <span className="booking-pre-save-summary__fact booking-pre-save-summary__fact--wide">
                                <span className="booking-pre-save-summary__fact-label">ملاحظة</span>
                                <strong className="booking-pre-save-summary__fact-value">{row.toolsNote}</strong>
                              </span>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="booking-pre-save-summary__total">
                      <span>الإجمالي النهائي</span>
                      <strong>{finalPrice.toFixed(0)} ريال</strong>
                    </div>
                  </div>
                  </div>
                ) : null}

                {currentStep === 2 ? (
                  <div className="booking-step-action-bar mb-4">
                    <button
                      type="button"
                      className="btn btn-dark"
                      disabled={!isStep2ReadyForNext}
                      onClick={() => setCurrentStep(3)}
                    >
                      التالي: بيانات العميلة
                    </button>
                    {!allPreviewLocked ? (
                      <div className="small text-warning mt-2 text-center">
                        أكدي كل خدمة أولًا.
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {currentStep === 3 ? (
                  <>
                    <div className="booking-step-card-shell mb-4">
                      <div className="booking-step-card-shell__header">
                        <div>
                          <div className="booking-step-card-shell__title">بياناتك</div>
                          <p className="booking-step-card-shell__subtitle">
                            نحتاج الاسم ورقم الجوال لإرسال تفاصيل الحجز وتأكيد الموعد.
                          </p>
                        </div>
                        <span className="booking-step-card-shell__badge">03</span>
                      </div>
                      <div
                        className={`booking-client-prefill-note ${isSignedClient ? "is-signed" : ""}`}
                        role="status"
                        aria-live="polite"
                      >
                        {isSignedClient
                          ? "تم تعبئة بياناتك."
                          : "الاسم والجوال لإتمام الحجز."}
                      </div>

                      <div className="row g-3">
                        <div className="col-md-6">
                          <label htmlFor="bookingClientName" className="form-label">الاسم</label>
                          <input
                            id="bookingClientName"
                            type="text"
                            name="name"
                            className="form-control"
                            value={formData.name}
                            onChange={handleChange}
                            placeholder="اكتبي اسمك الكامل"
                            autoComplete="name"
                            required
                            aria-invalid={!isCustomerNameComplete && String(formData.name || "").trim().length > 0}
                          />
                        </div>

                        <div className="col-md-6">
                          <label htmlFor="bookingClientPhone" className="form-label">رقم الجوال</label>
                          <input
                            id="bookingClientPhone"
                            type="tel"
                            name="phone"
                            className="form-control"
                            dir="ltr"
                            inputMode="numeric"
                            value={formData.phone}
                            onChange={handleChange}
                            placeholder="05xxxxxxxx"
                            autoComplete="tel"
                            maxLength={10}
                            required
                            pattern="05[0-9]{8}"
                            aria-invalid={!isCustomerPhoneComplete && String(formData.phone || "").trim().length > 0}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="booking-step-card-shell mb-4">
                      <div className="booking-step-card-shell__header">
                        <div>
                          <div className="booking-step-card-shell__title">إضافات</div>
                          <p className="booking-step-card-shell__subtitle">
                            هذه الخطوة اختيارية، لكنها تساعدنا نجهز الزيارة بشكل أفضل.
                          </p>
                        </div>
                      </div>
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
                    </div>
                    <div className="booking-step-action-bar mb-4">
                      <button
                        type="button"
                        className="btn btn-dark"
                        disabled={!isStep3Complete}
                        onClick={() => setCurrentStep(4)}
                      >
                        التالي: التأكيد
                      </button>
                      {!isStep3Complete ? (
                        <div className="small text-warning mt-2 text-center">
                          الاسم والجوال مطلوبين.
                        </div>
                      ) : null}
                    </div>
                  </>
                ) : null}

                {currentStep === 4 ? (
                  <div className="booking-step-card-shell booking-step-card-shell--final-action mb-4">
                    <div className="booking-step-card-shell__header">
                      <div>
                        <div className="booking-step-card-shell__title">الدفع</div>
                        <p className="booking-step-card-shell__subtitle">
                          عند الضغط على التأكيد سيتم إرسال الحجز بالبيانات الظاهرة أعلاه.
                        </p>
                      </div>
                    </div>
                    <div className="booking-summary mb-4 qs-black">
                      <div className="d-flex justify-content-between">
                        <span>السعر</span>
                        <strong>{basePrice} ريال</strong>
                      </div>
                      {appliedDiscountTotal > 0 && (
                        <div className="d-flex justify-content-between mt-1">
                          <span>الخصم (كود واحد)</span>
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
                      disabled={isLoading || !allPreviewLocked}
                    >
                      {isLoading ? (
                        <><FontAwesomeIcon icon={faSpinner} spin /> جاري تأكيد الحجز…</>
                      ) : (
                        "تأكيد الحجز النهائي"
                      )}
                    </button>
                  </div>
                ) : null}
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Booking;
