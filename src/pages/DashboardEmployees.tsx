// src/pages/DashboardEmployees.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  getDocs,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  orderBy,
  writeBatch,
} from "firebase/firestore";

import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPen,
  faTrash,
  faRotateRight,
  faUserTie,
  faXmark,
  faToggleOn,
  faToggleOff,
} from "@fortawesome/free-solid-svg-icons";

import { db } from "../services/firebase";
import { writeAuditLog } from "../services/logService";
import { AppSettingsService } from "../services/AppSettingsService";
import "../styles/DashboardEmployees.css";
import Modal from "../components/Modal";

// ✅ Bookings stats (Owner only)
import {
  listAllBookings,
  type BookingDocWithId,
  type BookingStatus,
} from "../services/firestoreBookings";
import {
  computeStaffPayrollForMonth,
  normalizePayrollConfig,
  PAYROLL_CLOSE_DAY,
  payrollCycleKeyFromDate,
  type StaffPayrollMethod,
  type StaffOvertimeHoursBasis,
} from "../helpers/staffPayroll";

/* =========================
   Types
========================= */
type UiRole = "owner" | "admin" | "reception" | "staff" | "client" | "guest";

type AuthUser = {
  uid: string;
  email: string;
  role: UiRole;
  displayName?: string;
};

type StaffPublicDoc = {
  name: string;
  active: boolean;
  employmentEndDate?: string;

  // ✅ جديد: هل تظهر في صفحة About؟
  showOnAbout: boolean;
  // ✅ جديد: هل تظهر في الحجز؟
  showOnBooking: boolean;
  onLeave?: boolean;
  leaveUntil?: string;
  leaveNote?: string;
  exceptionalLeaveDates?: string[];
  exceptionalLeaveWeekdays?: string[];
  useCustomWorkingHours?: boolean;
  customWorkingHours?: Partial<Record<WeekdayKey, StaffWorkingDay>>;
  customWorkingHourOverrides?: StaffWorkingHourOverride[];
  monthlySalary?: number;
  overtimeMethod?: StaffPayrollMethod;
  overtimeDaysPerMonth?: number;
  overtimeBaseHoursPerDay?: number;
  overtimeSeasonBaseHoursPerDay?: number;
  overtimeHoursBasis?: StaffOvertimeHoursBasis;
  overtimePercent?: number;
  overtimeInvoicePercent?: number;

  specialties: string[];
  bio?: string;
  avatarUrl?: string;
  cvUrl?: string;
  leaveBalanceDays?: number;
  leaveEntitlementDate?: string;
  leaveEntries?: LeaveEntry[];
  createdAt?: any;
  updatedAt?: any;
};

type LeaveEntry = {
  id: string;
  type: "add" | "deduct";
  days: number;
  date: string; // YYYY-MM-DD (operation effective date)
  note?: string;
  createdAtIso: string;
  byUid?: string;
  byName?: string;
};

type StaffWorkingDay = {
  enabled?: boolean;
  start?: string;
  end?: string;
};

type StaffWorkingHourOverride = {
  date: string;
  enabled?: boolean;
  start?: string;
  end?: string;
  note?: string;
};
type StaffWorkingHourOverrideGroup = {
  id: string;
  fromDate: string;
  toDate: string;
  dates: string[];
  enabled: boolean;
  start: string;
  end: string;
  note?: string;
  count: number;
};
type WorkingHourOverrideMode = "single" | "range" | "specific";
type WorkingHourOverrideQuickMode = "full" | "closed" | "plus1" | "plus2" | "manual";
type WorkingHourOverrideApplyMethod = "replace" | "merge";

type StaffPublicUi = StaffPublicDoc & { id: string };

type ServiceOption = {
  id: string; // serviceId
  label: string; // service name
  sectionId?: string;
  categoryId?: string;
  active?: boolean;
};

function normalizeLookupText(v: any): string {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function canonicalizeSpecialties(raw: any, options: ServiceOption[]): string[] {
  const values = normalizeSpecialties(raw);
  if (!values.length) return [];

  const idSet = new Set(options.map((o) => String(o.id || "").trim()).filter(Boolean));
  const byLabel = new Map<string, string>();
  options.forEach((o) => {
    const id = String(o.id || "").trim();
    const labelKey = normalizeLookupText(o.label);
    if (id && labelKey && !byLabel.has(labelKey)) byLabel.set(labelKey, id);
  });

  const out: string[] = [];
  const seen = new Set<string>();
  values.forEach((v) => {
    const rawValue = String(v || "").trim();
    if (!rawValue) return;
    const nextId = idSet.has(rawValue) ? rawValue : byLabel.get(normalizeLookupText(rawValue)) || "";
    const finalValue = nextId || rawValue;
    if (!seen.has(finalValue)) {
      seen.add(finalValue);
      out.push(finalValue);
    }
  });
  return out;
}

type EmployeeModalTab = "stats" | "basic" | "booking" | "services" | "profile";
type EmployeeSplitTab = "basic" | "booking" | "services" | "profile" | "payroll" | "stats";
type EmployeeMode = "view" | "edit";
type BookingHourOverrideMode = "hours" | "closed";
type BookingHourOverride = {
  fromDate: string;
  toDate: string;
  mode: BookingHourOverrideMode;
  start?: string;
  end?: string;
  includeWeekdays?: WeekdayKey[];
  blockedWeekdays?: WeekdayKey[];
};
type SummarySourceGroup = {
  title: string;
  gregorian: string;
  hijri: string;
  details: string[];
  tone: "active" | "other";
};

/* =========================
   Const
========================= */
const SALON_ID = "main";
const STAFF_CHIPS_PREVIEW_COUNT = 8;
const DEFAULT_OPEN_TIME = "10:00";
const DEFAULT_CLOSE_TIME = "22:00";
const REVENUE_STATUSES = new Set<BookingStatus>(["confirmed", "completed"]);
const STAFF_IMAGE_MODULES = import.meta.glob("../assets/images/*.{png,jpg,jpeg,webp,avif,svg}", {
  eager: true,
  import: "default",
}) as Record<string, string>;

const STAFF_IMAGE_OPTIONS = Object.entries(STAFF_IMAGE_MODULES)
  .map(([path, url]) => {
    const fileName = path.split("/").pop() || path;
    return { label: fileName, value: String(url || "") };
  })
  .filter((x) => x.value)
  .sort((a, b) => a.label.localeCompare(b.label));

const STAFF_IMAGE_BY_FILE = new Map(
  STAFF_IMAGE_OPTIONS.map((x) => [String(x.label || "").toLowerCase(), x.value] as const)
);

/* =========================
   Helpers
========================= */
function getAuthUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem("auth_user");
    if (!raw) return null;
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

function getNameInitials(name: string): string {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "؟";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
}

function staffPublicCol() {
  return collection(db, "salons", SALON_ID, "staff_public");
}

function staffPublicDoc(id: string) {
  return doc(db, "salons", SALON_ID, "staff_public", id);
}

function servicesCol() {
  return collection(db, "salons", SALON_ID, "services");
}

function usersCol() {
  return collection(db, "salons", SALON_ID, "users");
}

function normalizeSpecialties(v: any): string[] {
  if (Array.isArray(v)) return v.map(String).map((x) => x.trim()).filter(Boolean);
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}

function normalizeRoleText(v: any) {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function isAdministrativeRoleText(v: any) {
  const r = normalizeRoleText(v);
  if (!r) return false;
  return [
    "owner",
    "admin",
    "administrator",
    "reception",
    "receptionist",
    "frontdesk",
    "manager",
    "pending",
    "client",
    "guest",
    "اداري",
    "إداري",
    "مدير",
    "ادارة",
    "إدارة",
  ].some((k) => r.includes(normalizeRoleText(k)));
}

function isAdministrativeStaffRecord(
  id: string,
  data: any,
  linkedUserRoleByUid: Map<string, string>
) {
  const roleCandidates = [
    data?.role,
    data?.userRole,
    data?.accountRole,
    data?.type,
    data?.accountType,
    data?.userType,
    data?.position,
    data?.jobTitle,
  ];
  if (roleCandidates.some((x) => isAdministrativeRoleText(x))) return true;
  if (data?.isAdmin === true || data?.isOwner === true || data?.isReception === true) return true;
  if (data?.managementOnly === true || data?.isManagement === true) return true;

  const linkedUid = String(data?.linkedUid || "").trim();
  if (linkedUid) {
    const linkedRole = linkedUserRoleByUid.get(linkedUid) || "";
    if (isAdministrativeRoleText(linkedRole)) return true;
  }

  const name = String(data?.name || "").trim().toLowerCase();
  const idKey = String(id || "").trim().toLowerCase();
  const looksAdminByName =
    /admin|owner|reception|manager|اداري|إداري|مدير|ادارة|إدارة/.test(name) ||
    /admin|owner|reception|manager|اداري|إداري|مدير|ادارة|إدارة/.test(idKey);
  if (looksAdminByName) return true;

  const hasNoSpecialties = normalizeSpecialties(data?.specialties).length === 0;
  if (hasNoSpecialties && (data?.showOnBooking === false || data?.active === false)) return true;

  return false;
}

function safeKey(s: string) {
  return String(s || "")
    .trim()
    .replaceAll("/", "-")
    .replace(/\s+/g, "_");
}

function normalizeArabicName(s: string) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي");
}

function pickAvatarUrl(data: any): string {
  const candidates = [
    data?.avatarUrl,
    data?.avatarURL,
    data?.photoURL,
    data?.photoUrl,
    data?.imageUrl,
    data?.imageURL,
    data?.image,
    data?.imgUrl,
    data?.profileImage,
    data?.profileImageUrl,
    data?.picture,
    data?.avatar,
  ];

  for (const c of candidates) {
    const s = String(c ?? "").trim();
    if (s) return s;
  }
  return "";
}

function resolveAvatarFromAssets(raw: string): string {
  const v = String(raw || "").trim();
  if (!v) return "";

  const normalized = v.replaceAll("\\", "/");
  const file = normalized
    .split("/")
    .pop()
    ?.split(/[?#]/)[0]
    ?.trim()
    .toLowerCase() || "";
  if (file && STAFF_IMAGE_BY_FILE.has(file)) {
    return String(STAFF_IMAGE_BY_FILE.get(file) || "");
  }

  return v;
}

function toArabicSectionLabel(sectionId: string, fallbackLabel?: string): string {
  const rawLabel = String(fallbackLabel || "").trim();
  if (rawLabel && !/[A-Za-z]/.test(rawLabel)) return rawLabel;

  const key = String(sectionId || "").trim().toLowerCase();
  if (key === "hair-care") return "العناية بالشعر";
  if (key === "nails") return "العناية بالأظافر";
  if (key === "makeup") return "المكياج";
  if (key === "skin-care") return "العناية بالبشرة";
  if (key === "spa") return "السبا";
  if (key === "massage") return "المساج";
  if (key === "eyelashes" || key === "lashes") return "الرموش";
  if (key === "eyebrows" || key === "brows") return "الحواجب";
  if (key === "henna") return "الحناء";
  return "قسم غير محدد";
}
type StaffBookingStats = {
  total: number;
  byStatus: Record<BookingStatus, number>;
  month: {
    key: string;
    salonTotal: number;
    staffTotal: number;
    sharePct: number;
    invoiceCount: number;
    invoiceRevenue: number;
  };
};

function monthKey(dateIso: string) {
  const s = String(dateIso || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.slice(0, 7);
  return "";
}

function currentMonthKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function todayIso() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function safeNonNegativeNumber(v: any, fallback = 0): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, n);
}

function fmtMoneySar(v: number): string {
  return new Intl.NumberFormat("ar-SA", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(v || 0));
}

function formatDailyHourBucketsLabel(
  buckets?: Array<{
    hoursPerDay?: number;
    days?: number;
  }>
): string {
  if (!Array.isArray(buckets) || !buckets.length) return "لا يوجد أيام محتسبة";
  return buckets
    .map((row) => `${fmtMoneySar(Number(row?.days || 0))} يوم × ${fmtMoneySar(Number(row?.hoursPerDay || 0))} ساعة`)
    .join(" + ");
}

function bookingAmountOf(b: any): number {
  return Math.max(
    0,
    Number(b?.finalPrice ?? b?.total ?? b?.serviceSnapshot?.priceAtBooking ?? 0) || 0
  );
}

function fmtIsoDate(v?: string) {
  const s = normalizeIsoDate(v);
  if (!s) return "-";
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return `\u200E${s}\u200E`;
  return fmtIsoDateByCalendar(s, "gregory");
}

type DateCalendar = "gregory" | "hijri";
type HijriDateParts = { day: number; month: number; year: number };
function fmtIsoDateByCalendar(v?: string, calendar: DateCalendar = "gregory") {
  const s = normalizeIsoDate(v);
  if (!s) return "-";
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return `\u200E${s}\u200E`;
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

function fmtIsoDateHijri(v?: string) {
  return fmtIsoDateByCalendar(v, "hijri");
}

function normalizeArabicDigits(v: string) {
  const map: Record<string, string> = {
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
  return String(v || "").replace(/[٠-٩۰-۹]/g, (ch) => map[ch] || ch);
}

function hijriPartsFromIso(v?: string): HijriDateParts | null {
  const s = normalizeIsoDate(v);
  if (!s) return null;
  const d = new Date(`${s}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).formatToParts(d);
  const day = Number(parts.find((p) => p.type === "day")?.value || NaN);
  const month = Number(parts.find((p) => p.type === "month")?.value || NaN);
  const year = Number(parts.find((p) => p.type === "year")?.value || NaN);
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null;
  return { day, month, year };
}

function formatHijriInputFromIso(v?: string) {
  const p = hijriPartsFromIso(v);
  if (!p) return "";
  return `${String(p.day).padStart(2, "0")}/${String(p.month).padStart(2, "0")}/${String(p.year)}`;
}

function parseHijriDateInput(v: string): HijriDateParts | null {
  const normalized = normalizeArabicDigits(v)
    .replace(/[.\-]/g, "/")
    .replace(/\s+/g, "")
    .trim();
  const m = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const yearRaw = Number(m[3]);
  let year = yearRaw;
  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(yearRaw)) return null;
  if (yearRaw < 100) year = 1400 + yearRaw;
  if (day < 1 || day > 30 || month < 1 || month > 12 || year < 1200 || year > 1700) return null;
  return { day, month, year };
}

function isoFromHijriDateParts(p: HijriDateParts): string {
  const targetDay = Math.trunc(Number(p?.day || 0));
  const targetMonth = Math.trunc(Number(p?.month || 0));
  const targetYear = Math.trunc(Number(p?.year || 0));
  if (
    targetDay < 1 ||
    targetDay > 30 ||
    targetMonth < 1 ||
    targetMonth > 12 ||
    targetYear < 1200 ||
    targetYear > 1700
  ) {
    return "";
  }
  const approxGregorianYear = targetYear + 579;
  const startUtc = Date.UTC(approxGregorianYear - 2, 0, 1, 12, 0, 0);
  const endUtc = Date.UTC(approxGregorianYear + 2, 11, 31, 12, 0, 0);
  for (let t = startUtc; t <= endUtc; t += 86400000) {
    const iso = new Date(t).toISOString().slice(0, 10);
    const hp = hijriPartsFromIso(iso);
    if (!hp) continue;
    if (hp.day === targetDay && hp.month === targetMonth && hp.year === targetYear) return iso;
  }
  return "";
}

function addDaysIso(dateIso: string, days: number) {
  const s = normalizeLeaveUntil(dateIso);
  if (!s) return "";
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + Math.trunc(days || 0));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function findHijriMonthStartIso(anchorISO: string) {
  const anchor = normalizeIsoDate(anchorISO) || todayIso();
  const base = hijriPartsFromIso(anchor);
  if (!base) return anchor;
  let cursor = anchor;
  for (let i = 0; i < 35; i++) {
    const prev = addDaysIso(cursor, -1);
    const prevParts = hijriPartsFromIso(prev);
    if (!prevParts || prevParts.month !== base.month || prevParts.year !== base.year) {
      return cursor;
    }
    cursor = prev;
  }
  return cursor;
}

function buildHijriMonthDays(anchorISO: string) {
  const start = findHijriMonthStartIso(anchorISO);
  const base = hijriPartsFromIso(start);
  if (!base) return [] as Array<{ iso: string; hijriDay: number }>;
  const out: Array<{ iso: string; hijriDay: number }> = [];
  let cursor = start;
  for (let i = 0; i < 35; i++) {
    const p = hijriPartsFromIso(cursor);
    if (!p || p.month !== base.month || p.year !== base.year) break;
    out.push({ iso: cursor, hijriDay: p.day });
    cursor = addDaysIso(cursor, 1);
  }
  return out;
}

function shiftHijriMonthStartIso(currentMonthStartISO: string, delta: number) {
  const currentStart = findHijriMonthStartIso(currentMonthStartISO);
  if (delta === 0) return currentStart;
  if (delta > 0) {
    let nextStart = currentStart;
    for (let i = 0; i < delta; i++) {
      const days = buildHijriMonthDays(nextStart);
      if (!days.length) return nextStart;
      nextStart = addDaysIso(days[days.length - 1].iso, 1);
    }
    return findHijriMonthStartIso(nextStart);
  }
  let prevStart = currentStart;
  for (let i = 0; i < Math.abs(delta); i++) {
    prevStart = findHijriMonthStartIso(addDaysIso(prevStart, -1));
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

function hijriWeekdayColumnFromIso(iso: string) {
  const s = normalizeIsoDate(iso);
  if (!s) return 0;
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return 0;
  const js = d.getDay(); // Sun=0 ... Sat=6
  const map = [1, 2, 3, 4, 5, 6, 0]; // Sat first
  return map[js] ?? 0;
}

function parsePositiveInt(v: string, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

function normalizeLeaveUntil(v: any) {
  const s = String(v || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function normalizeExceptionalLeaveDates(v: any) {
  const arr = Array.isArray(v) ? v : [];
  return Array.from(
    new Set(
      arr
        .map((x: any) => normalizeLeaveUntil(x))
        .filter(Boolean)
        .sort((a: string, b: string) => a.localeCompare(b))
    )
  );
}

type WeekdayKey = "sat" | "sun" | "mon" | "tue" | "wed" | "thu" | "fri";
const HIJRI_WEEKDAY_SHORT = ["س", "ح", "ن", "ث", "ر", "خ", "ج"] as const;
const WEEKDAY_OPTIONS: Array<{ key: WeekdayKey; label: string }> = [
  { key: "sat", label: "السبت" },
  { key: "sun", label: "الأحد" },
  { key: "mon", label: "الاثنين" },
  { key: "tue", label: "الثلاثاء" },
  { key: "wed", label: "الأربعاء" },
  { key: "thu", label: "الخميس" },
  { key: "fri", label: "الجمعة" },
];

function normalizeWeekdayKey(v: any): WeekdayKey | "" {
  const s = String(v || "").trim().toLowerCase();
  return (WEEKDAY_OPTIONS.some((d) => d.key === s) ? s : "") as WeekdayKey | "";
}

function normalizeExceptionalLeaveWeekdays(v: any): WeekdayKey[] {
  const arr = Array.isArray(v) ? v : [];
  return Array.from(
    new Set(
      arr
        .map((x: any) => normalizeWeekdayKey(x))
        .filter(Boolean)
    )
  ) as WeekdayKey[];
}

function normalizeTimeHHMM(v: any) {
  const s = String(v || "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "";
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return "";
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return "";
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function createDefaultWorkingHours(): Record<WeekdayKey, StaffWorkingDay> {
  return {
    sat: { enabled: true, start: "10:00", end: "22:00" },
    sun: { enabled: true, start: "10:00", end: "22:00" },
    mon: { enabled: true, start: "10:00", end: "22:00" },
    tue: { enabled: true, start: "10:00", end: "22:00" },
    wed: { enabled: true, start: "10:00", end: "22:00" },
    thu: { enabled: true, start: "10:00", end: "22:00" },
    fri: { enabled: true, start: "10:00", end: "22:00" },
  };
}

function normalizeWorkingHours(v: any): Record<WeekdayKey, StaffWorkingDay> {
  const defaults = createDefaultWorkingHours();
  const src = v && typeof v === "object" ? v : {};
  const out = { ...defaults };
  WEEKDAY_OPTIONS.forEach((d) => {
    const row = (src as any)?.[d.key];
    if (!row || typeof row !== "object") return;
    out[d.key] = {
      enabled: row.enabled !== false,
      start: normalizeTimeHHMM(row.start) || defaults[d.key].start,
      end: normalizeTimeHHMM(row.end) || defaults[d.key].end,
    };
  });
  return out;
}

function normalizeWorkingHourOverrides(v: any): StaffWorkingHourOverride[] {
  const rows = Array.isArray(v) ? v : [];
  return rows
    .map((row: any) => {
      const note = String(row?.note || "").trim();
      return {
        date: normalizeLeaveUntil(row?.date),
        enabled: row?.enabled !== false,
        start: normalizeTimeHHMM(row?.start) || "10:00",
        end: normalizeTimeHHMM(row?.end) || "22:00",
        ...(note ? { note } : {}),
      };
    })
    .filter((row) => row.date)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function buildWorkingHourOverrideGroups(
  rows: StaffWorkingHourOverride[]
): StaffWorkingHourOverrideGroup[] {
  const normalized = normalizeWorkingHourOverrides(rows);
  const out: Array<StaffWorkingHourOverrideGroup & { _sig: string }> = [];

  normalized.forEach((row) => {
    const date = normalizeLeaveUntil(row.date);
    if (!date) return;
    const enabled = row.enabled !== false;
    const start = normalizeTimeHHMM(row.start) || "10:00";
    const end = normalizeTimeHHMM(row.end) || "22:00";
    const note = String(row.note || "").trim() || undefined;
    const sig = `${enabled ? "1" : "0"}|${start}|${end}|${note || ""}`;
    const prev = out[out.length - 1];
    const prevNext = prev ? addDaysIso(prev.toDate, 1) : "";

    if (prev && prev._sig === sig && prevNext === date) {
      prev.toDate = date;
      prev.dates.push(date);
      prev.count += 1;
      return;
    }

    out.push({
      id: `${date}|${sig}`,
      fromDate: date,
      toDate: date,
      dates: [date],
      enabled,
      start,
      end,
      ...(note ? { note } : {}),
      count: 1,
      _sig: sig,
    });
  });

  return out.map(({ _sig, ...group }) => group);
}

function weekdayFromIso(dateIso: string): WeekdayKey | "" {
  const s = normalizeLeaveUntil(dateIso);
  if (!s) return "";
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  const map: WeekdayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return (map[d.getDay()] || "") as WeekdayKey | "";
}

function toMinutes(hhmm: string) {
  const [h, m] = String(hhmm || "")
    .split(":")
    .map((x) => Number(x));
  return (Number(h) || 0) * 60 + (Number(m) || 0);
}

function isTimeInsideWindow(time24: string, start24: string, end24: string) {
  const t = toMinutes(time24);
  const s = toMinutes(start24);
  const e = toMinutes(end24);
  if (s === e) return false;
  if (s < e) return t >= s && t < e;
  return t >= s || t < e;
}

function formatWindow(start: string, end: string) {
  const to12 = (hhmm: string) => {
    const s = normalizeTimeHHMM(hhmm);
    if (!s) return hhmm;
    const [hStr, mStr] = s.split(":");
    const h24 = Number(hStr);
    const m = Number(mStr);
    if (!Number.isFinite(h24) || !Number.isFinite(m)) return s;
    const isPM = h24 >= 12;
    const h12 = h24 === 12 ? 12 : h24 % 12 || 12;
    return `${String(h12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${isPM ? "م" : "ص"}`;
  };
  return `${to12(start)} - ${to12(end)}`;
}

function durationHours(enabled: boolean, start: string, end: string): number {
  if (!enabled) return 0;
  const s = toMinutes(start);
  let e = toMinutes(end);
  if (e <= s) e += 1440;
  return Math.max(0, (e - s) / 60);
}

function normalizeIsoDate(v: any): string {
  const s = String(v || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function formatIsoDateRange(from?: string, to?: string): string {
  return formatIsoDateRangeByCalendar(from, to, "gregory");
}

function formatIsoDateRangeByCalendar(
  from?: string,
  to?: string,
  calendar: DateCalendar = "gregory"
): string {
  const a = normalizeIsoDate(from);
  const b = normalizeIsoDate(to);
  if (!a && !b) return "-";
  if (!a) return fmtIsoDateByCalendar(b, calendar);
  if (!b) return fmtIsoDateByCalendar(a, calendar);
  const start = a <= b ? a : b;
  const end = a <= b ? b : a;
  return `من ${fmtIsoDateByCalendar(start, calendar)} إلى ${fmtIsoDateByCalendar(end, calendar)}`;
}

function formatIsoDateRangeDual(from?: string, to?: string) {
  return {
    gregorian: formatIsoDateRangeByCalendar(from, to, "gregory"),
    hijri: formatIsoDateRangeByCalendar(from, to, "hijri"),
  };
}

function countIsoDateRangeDays(from?: string, to?: string): number {
  const a = normalizeIsoDate(from);
  const b = normalizeIsoDate(to);
  if (!a || !b) return 0;
  const start = a <= b ? a : b;
  const end = a <= b ? b : a;
  const [sy, sm, sd] = start.split("-").map((x) => Number(x));
  const [ey, em, ed] = end.split("-").map((x) => Number(x));
  if (![sy, sm, sd, ey, em, ed].every((n) => Number.isFinite(n))) return 0;
  const startUtc = Date.UTC(sy, sm - 1, sd);
  const endUtc = Date.UTC(ey, em - 1, ed);
  if (!Number.isFinite(startUtc) || !Number.isFinite(endUtc) || endUtc < startUtc) return 0;
  return Math.floor((endUtc - startUtc) / 86400000) + 1;
}

function formatArabicInteger(v: number): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 0 }).format(
    Math.max(0, Math.floor(n))
  );
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
      const fromDateRaw = normalizeIsoDate(x?.fromDate);
      const toDateRaw = normalizeIsoDate(x?.toDate);
      if (!fromDateRaw || !toDateRaw) return null;
      const fromDate = fromDateRaw <= toDateRaw ? fromDateRaw : toDateRaw;
      const toDate = fromDateRaw <= toDateRaw ? toDateRaw : fromDateRaw;
      return {
        fromDate,
        toDate,
        mode: String(x?.mode || "").trim() === "closed" ? "closed" : "hours",
        start: String(x?.start || "").trim() || undefined,
        end: String(x?.end || "").trim() || undefined,
        includeWeekdays: normalizeWeekdayList(x?.includeWeekdays),
        blockedWeekdays: normalizeWeekdayList(x?.blockedWeekdays),
      } as BookingHourOverride;
    })
    .filter(Boolean) as BookingHourOverride[];
}

function minutesToHHMM(totalMin: number) {
  const n = ((Math.floor(totalMin) % 1440) + 1440) % 1440;
  const hh = String(Math.floor(n / 60)).padStart(2, "0");
  const mm = String(n % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function intersectTimeWindows(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string
): { start: string; end: string } | null {
  const as = toMinutes(aStart);
  let ae = toMinutes(aEnd);
  const bs = toMinutes(bStart);
  let be = toMinutes(bEnd);
  if (ae <= as) ae += 1440;
  if (be <= bs) be += 1440;
  const start = Math.max(as, bs);
  const end = Math.min(ae, be);
  if (end <= start) return null;
  return { start: minutesToHHMM(start), end: minutesToHHMM(end) };
}

/* =========================
   Component
========================= */
export default function DashboardEmployees() {
  const authUser = useMemo(() => getAuthUser(), []);
  const canManage =
    authUser?.role === "owner" ||
    authUser?.role === "admin" ||
    authUser?.role === "reception";

  const [loading, setLoading] = useState(false);
  const [list, setList] = useState<StaffPublicUi[]>([]);
  const [errorMsg, setErrorMsg] = useState("");

  const [statsLoading, setStatsLoading] = useState(false);
  const specialtiesMigrationDoneRef = useRef(false);
  const modalHourOverrideHijriPickerRef = useRef<HTMLDivElement>(null);
  const [bookingStats, setBookingStats] =
    useState<Record<string, StaffBookingStats>>({});
  const [leaveAdjustDays, setLeaveAdjustDays] = useState("1");
  const [leaveAdjustDate, setLeaveAdjustDate] = useState<string>(todayIso());
  const [leaveAdjustNote, setLeaveAdjustNote] = useState("");
  const [leaveEntitlementDate, setLeaveEntitlementDate] = useState("");

  const [qText, setQText] = useState("");
  const [onlyActive, setOnlyActive] =
    useState<"all" | "active" | "inactive">("all");

  const [specialtyFilter, setSpecialtyFilter] = useState<string>("all");

  const [isOpen, setIsOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [modalTab, setModalTab] = useState<EmployeeModalTab>("basic");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<EmployeeSplitTab>("basic");
  const [mode, setMode] = useState<EmployeeMode>("view");
  const [activeStatsSubTab, setActiveStatsSubTab] = useState<"payroll" | "stats">("payroll");

  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [cvUrl, setCvUrl] = useState("");

  const [active, setActive] = useState(true);

  // ✅ جديد
  const [showOnAbout, setShowOnAbout] = useState(true);
  const [showOnBooking, setShowOnBooking] = useState(true);
  const [modalOnLeave, setModalOnLeave] = useState(false);
  const [modalLeaveUntil, setModalLeaveUntil] = useState("");
  const [modalLeaveNote, setModalLeaveNote] = useState("");
  const [employmentEndDate, setEmploymentEndDate] = useState("");
  const [modalExceptionalLeaveWeekdays, setModalExceptionalLeaveWeekdays] = useState<WeekdayKey[]>([]);
  const [modalLeaveWeekdayDraft, setModalLeaveWeekdayDraft] = useState<WeekdayKey | "">("");
  const [modalUseCustomWorkingHours, setModalUseCustomWorkingHours] = useState(false);
  const [modalCustomWorkingHours, setModalCustomWorkingHours] =
    useState<Record<WeekdayKey, StaffWorkingDay>>(createDefaultWorkingHours());
  const [modalCustomHourOverrides, setModalCustomHourOverrides] = useState<StaffWorkingHourOverride[]>([]);
  const [modalHourOverrideFromDate, setModalHourOverrideFromDate] = useState("");
  const [modalHourOverrideToDate, setModalHourOverrideToDate] = useState("");
  const [modalHourOverrideCalendar, setModalHourOverrideCalendar] = useState<DateCalendar>("gregory");
  const [modalHourOverrideFromDateHijri, setModalHourOverrideFromDateHijri] = useState("");
  const [modalHourOverrideToDateHijri, setModalHourOverrideToDateHijri] = useState("");
  const [modalHourOverrideHijriPickerOpen, setModalHourOverrideHijriPickerOpen] = useState(false);
  const [modalHourOverrideHijriPickerTarget, setModalHourOverrideHijriPickerTarget] =
    useState<"from" | "to">("from");
  const [modalHourOverrideHijriViewMonthISO, setModalHourOverrideHijriViewMonthISO] = useState<string>(
    () => findHijriMonthStartIso(todayIso())
  );
  const [modalHourOverrideStart, setModalHourOverrideStart] = useState("10:00");
  const [modalHourOverrideEnd, setModalHourOverrideEnd] = useState("22:00");
  const [modalHourOverrideEnabled, setModalHourOverrideEnabled] = useState(true);
  const [modalHourOverrideMode, setModalHourOverrideMode] = useState<WorkingHourOverrideMode>("single");
  const [modalHourOverrideQuickMode, setModalHourOverrideQuickMode] =
    useState<WorkingHourOverrideQuickMode>("manual");
  const [modalHourOverrideApplyMethod, setModalHourOverrideApplyMethod] =
    useState<WorkingHourOverrideApplyMethod>("replace");
  const [modalHourOverrideNote, setModalHourOverrideNote] = useState("");
  const [modalHourOverrideApplyWeekdays, setModalHourOverrideApplyWeekdays] = useState<WeekdayKey[]>([]);
  const [modalHourOverrideOverwriteExisting, setModalHourOverrideOverwriteExisting] = useState(true);
  const [modalHourOverrideUpdateExistingOnly, setModalHourOverrideUpdateExistingOnly] = useState(false);
  const [modalHourOverrideEditingDate, setModalHourOverrideEditingDate] = useState("");
  const [modalHourOverrideEditingGroupId, setModalHourOverrideEditingGroupId] = useState("");
  const [monthlySalary, setMonthlySalary] = useState("0");
  const [overtimeMethod, setOvertimeMethod] = useState<StaffPayrollMethod>("hours_from_salary");
  const [overtimeDaysPerMonth, setOvertimeDaysPerMonth] = useState("30");
  const [overtimeBaseHoursPerDay, setOvertimeBaseHoursPerDay] = useState("8");
  const [overtimeSeasonBaseHoursPerDay, setOvertimeSeasonBaseHoursPerDay] = useState("6");
  const [overtimeHoursBasis, setOvertimeHoursBasis] = useState<StaffOvertimeHoursBasis>("regular");
  const [overtimePercent, setOvertimePercent] = useState("25");
  const [overtimeInvoicePercent, setOvertimeInvoicePercent] = useState("0");

  const [specialties, setSpecialties] = useState<string[]>([]);
  const [serviceOptions, setServiceOptions] = useState<ServiceOption[]>([]);
  const [expandedSpecialtiesByStaff, setExpandedSpecialtiesByStaff] = useState<Record<string, boolean>>({});
  const [leaveExceptionWeekdayByStaff, setLeaveExceptionWeekdayByStaff] = useState<
    Record<string, WeekdayKey | "">
  >({});

  const [srvQ, setSrvQ] = useState("");
  const [srvSection, setSrvSection] = useState<string>("all");
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const [appSettings, setAppSettings] = useState<any>(() => AppSettingsService.getCached?.() || {});
  const modalHourOverrideHijriMonthTitle = useMemo(
    () => toHijriMonthYearLabel(modalHourOverrideHijriViewMonthISO),
    [modalHourOverrideHijriViewMonthISO]
  );
  const modalHourOverrideHijriMonthDays = useMemo(
    () => buildHijriMonthDays(modalHourOverrideHijriViewMonthISO),
    [modalHourOverrideHijriViewMonthISO]
  );
  const modalHourOverrideHijriWeekOffset = useMemo(() => {
    if (!modalHourOverrideHijriMonthDays.length) return 0;
    return hijriWeekdayColumnFromIso(modalHourOverrideHijriMonthDays[0].iso);
  }, [modalHourOverrideHijriMonthDays]);

  const resetForm = () => {
    setEditId(null);
    setModalTab("basic");
    setName("");
    setBio("");
    setAvatarUrl("");
    setCvUrl("");
    setActive(true);

    // ✅ جديد
    setShowOnAbout(true);
    setShowOnBooking(true);
    setModalOnLeave(false);
    setModalLeaveUntil("");
    setModalLeaveNote("");
    setEmploymentEndDate("");
    setModalExceptionalLeaveWeekdays([]);
    setModalLeaveWeekdayDraft("");
    setModalUseCustomWorkingHours(false);
    setModalCustomWorkingHours(createDefaultWorkingHours());
    setModalCustomHourOverrides([]);
    setModalHourOverrideFromDate("");
    setModalHourOverrideToDate("");
    setModalHourOverrideCalendar("gregory");
    setModalHourOverrideFromDateHijri("");
    setModalHourOverrideToDateHijri("");
    setModalHourOverrideHijriPickerOpen(false);
    setModalHourOverrideHijriPickerTarget("from");
    setModalHourOverrideHijriViewMonthISO(findHijriMonthStartIso(todayIso()));
    setModalHourOverrideStart("10:00");
    setModalHourOverrideEnd("22:00");
    setModalHourOverrideEnabled(true);
    setModalHourOverrideMode("single");
    setModalHourOverrideQuickMode("manual");
    setModalHourOverrideApplyMethod("replace");
    setModalHourOverrideNote("");
    setModalHourOverrideApplyWeekdays([]);
    setModalHourOverrideOverwriteExisting(true);
    setModalHourOverrideUpdateExistingOnly(false);
    setModalHourOverrideEditingDate("");
    setModalHourOverrideEditingGroupId("");
    setMonthlySalary("0");
    setOvertimeMethod("hours_from_salary");
    setOvertimeDaysPerMonth("30");
    setOvertimeBaseHoursPerDay("8");
    setOvertimeSeasonBaseHoursPerDay("6");
    setOvertimeHoursBasis("regular");
    setOvertimePercent("25");
    setOvertimeInvoicePercent("0");

    setSpecialties([]);
    setLeaveAdjustDays("1");
    setLeaveAdjustDate(todayIso());
    setLeaveAdjustNote("");
    setLeaveEntitlementDate("");
  };

  const openEdit = (x: StaffPublicUi) => {
    setSelectedEmployeeId(x.id);
    setActiveTab("basic");
    setActiveStatsSubTab("payroll");
    setMode("view");
    setEditId(x.id);
    setModalTab("basic");
    setName(x.name ?? "");
    setBio(x.bio ?? "");
    setAvatarUrl(resolveAvatarFromAssets(pickAvatarUrl(x as any)));
    setCvUrl((x as any).cvUrl ?? "");
    setActive(!!x.active);
    setShowOnBooking((x as any).showOnBooking !== false);
    const initialLeaveUntil = normalizeLeaveUntil((x as any).leaveUntil);
    const initialLeaveExpired = !!initialLeaveUntil && initialLeaveUntil < todayIso();
    setModalOnLeave(!!(x as any).onLeave && !initialLeaveExpired);
    setModalLeaveUntil(initialLeaveUntil);
    setModalLeaveNote(String((x as any).leaveNote || ""));
    setEmploymentEndDate(normalizeLeaveUntil((x as any).employmentEndDate));
    setModalExceptionalLeaveWeekdays(
      normalizeExceptionalLeaveWeekdays((x as any).exceptionalLeaveWeekdays)
    );
    setModalLeaveWeekdayDraft("");
    setModalUseCustomWorkingHours(!!(x as any).useCustomWorkingHours);
    setModalCustomWorkingHours(normalizeWorkingHours((x as any).customWorkingHours));
    setModalCustomHourOverrides(
      normalizeWorkingHourOverrides((x as any).customWorkingHourOverrides)
    );
    setModalHourOverrideFromDate("");
    setModalHourOverrideToDate("");
    setModalHourOverrideCalendar("gregory");
    setModalHourOverrideFromDateHijri("");
    setModalHourOverrideToDateHijri("");
    setModalHourOverrideHijriPickerOpen(false);
    setModalHourOverrideHijriPickerTarget("from");
    setModalHourOverrideHijriViewMonthISO(findHijriMonthStartIso(todayIso()));
    setModalHourOverrideStart("10:00");
    setModalHourOverrideEnd("22:00");
    setModalHourOverrideEnabled(true);
    setModalHourOverrideMode("single");
    setModalHourOverrideQuickMode("manual");
    setModalHourOverrideApplyMethod("replace");
    setModalHourOverrideNote("");
    setModalHourOverrideApplyWeekdays([]);
    setModalHourOverrideOverwriteExisting(true);
    setModalHourOverrideUpdateExistingOnly(false);
    setModalHourOverrideEditingDate("");
    setModalHourOverrideEditingGroupId("");
    const payrollCfg = normalizePayrollConfig(x as any);
    setMonthlySalary(String(payrollCfg.monthlySalary || 0));
    setOvertimeMethod(payrollCfg.method);
    setOvertimeDaysPerMonth(String(payrollCfg.daysPerMonth || 30));
    setOvertimeBaseHoursPerDay(String(payrollCfg.baseHoursPerDay || 8));
    setOvertimeSeasonBaseHoursPerDay(String(payrollCfg.seasonBaseHoursPerDay || 6));
    setOvertimeHoursBasis(payrollCfg.hoursBasis || "regular");
    setOvertimePercent(String(payrollCfg.overtimePercent || 0));
    setOvertimeInvoicePercent(String(payrollCfg.invoicePercent || 0));

    // ✅ جديد
    setShowOnAbout((x as any).showOnAbout !== false);

    setSpecialties(canonicalizeSpecialties(x.specialties, serviceOptions));
    setLeaveAdjustDays("1");
    setLeaveAdjustDate(todayIso());
    setLeaveAdjustNote("");
    setLeaveEntitlementDate(String((x as any).leaveEntitlementDate || ""));
    setIsOpen(true);
  };

  const closeModal = () => {
    setIsOpen(false);
    resetForm();
  };

  const load = async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const adminLikeDocIds: string[] = [];
      const linkedUserRoleByUid = new Map<string, string>();
      try {
        const userSnap = await getDocs(usersCol());
        userSnap.docs.forEach((u) => {
          const x = u.data() as any;
          const uid = String(u.id || "").trim();
          const role = String(x?.role || "").trim();
          if (uid && role) linkedUserRoleByUid.set(uid, role);
        });
      } catch (e) {
        console.warn("load users roles skipped:", e);
      }

      const snap = await getDocs(staffPublicCol());
      const rows: StaffPublicUi[] = [];
      snap.docs.forEach((d) => {
        const data = d.data() as any;
        if (isAdministrativeStaffRecord(d.id, data, linkedUserRoleByUid)) {
          adminLikeDocIds.push(d.id);
          return;
        }
        const payrollCfg = normalizePayrollConfig(data);
        rows.push({
          id: d.id,
          name: data?.name ?? "",
          active: !!data?.active,

          // ✅ جديد (افتراضي: تظهر إذا ما كان الحقل موجود)
          showOnAbout: data?.showOnAbout !== false,
          showOnBooking: data?.showOnBooking !== false,
          employmentEndDate: normalizeLeaveUntil(data?.employmentEndDate),
          onLeave: !!data?.onLeave,
          leaveUntil: normalizeLeaveUntil(data?.leaveUntil),
          leaveNote: String(data?.leaveNote || ""),
          exceptionalLeaveDates: normalizeExceptionalLeaveDates(data?.exceptionalLeaveDates),
          exceptionalLeaveWeekdays: normalizeExceptionalLeaveWeekdays(data?.exceptionalLeaveWeekdays),
          useCustomWorkingHours: !!data?.useCustomWorkingHours,
          customWorkingHours: normalizeWorkingHours(data?.customWorkingHours),
          customWorkingHourOverrides: normalizeWorkingHourOverrides(data?.customWorkingHourOverrides),
          monthlySalary: payrollCfg.monthlySalary,
          overtimeMethod: payrollCfg.method,
          overtimeDaysPerMonth: payrollCfg.daysPerMonth,
          overtimeBaseHoursPerDay: payrollCfg.baseHoursPerDay,
          overtimeSeasonBaseHoursPerDay: payrollCfg.seasonBaseHoursPerDay,
          overtimeHoursBasis: payrollCfg.hoursBasis,
          overtimePercent: payrollCfg.overtimePercent,
          overtimeInvoicePercent: payrollCfg.invoicePercent,

          specialties: canonicalizeSpecialties(data?.specialties, serviceOptions),
          bio: data?.bio ?? "",
          avatarUrl: resolveAvatarFromAssets(pickAvatarUrl(data)),
          cvUrl: data?.cvUrl ?? "",
          leaveBalanceDays: Number(data?.leaveBalanceDays || 0),
          leaveEntitlementDate: String(data?.leaveEntitlementDate || ""),
          leaveEntries: Array.isArray(data?.leaveEntries) ? data.leaveEntries : [],
          createdAt: data?.createdAt,
          updatedAt: data?.updatedAt,
        } as StaffPublicUi);
      });
      rows.sort((a, b) => (a.name || "").localeCompare(b.name || "", "ar"));
      setList(rows);
      setLeaveExceptionWeekdayByStaff({});

      // Remove admin-like records from staff_public (not just hide) for management roles.
      if (
        adminLikeDocIds.length > 0 &&
        (authUser?.role === "owner" || authUser?.role === "admin")
      ) {
        const uniqueIds = Array.from(new Set(adminLikeDocIds.filter(Boolean)));
        const results = await Promise.allSettled(
          uniqueIds.map((id) => deleteDoc(staffPublicDoc(id)))
        );
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed > 0) {
          setErrorMsg(`تم استبعاد ${uniqueIds.length - failed} سجل إداري، وتعذر حذف ${failed}.`);
        }
      }
    } catch {
      setErrorMsg("تعذر تحميل الموظفات");
      setList([]);
    } finally {
      setLoading(false);
    }
  };

  const loadServiceOptions = async () => {
    try {
      const qSrv = query(servicesCol(), orderBy("name", "asc"));
      const snap = await getDocs(qSrv);

      const opts: ServiceOption[] = snap.docs
        .map((d) => {
          const x = d.data() as any;
          return {
            id: d.id,
            label: String(x?.name || d.id),
            sectionId: String(x?.sectionId || ""),
            categoryId: String(x?.categoryId || ""),
            active: x?.active !== false,
          };
        })
        .filter((s) => s.label.trim())
        .filter((s) => s.active !== false);

      setServiceOptions(opts);
    } catch (e) {
      console.warn("loadServiceOptions error:", e);
      setServiceOptions([]);
    }
  };

  // ✅ Original logic for fixing bookings
  const fixBookingsEmployeeUid = async () => {
    if (!canManage) return;
    const ok = confirm(
      "سيتم إصلاح الحجوزات القديمة بإضافة employeeUid/employeeKey. هل تريد المتابعة؟"
    );
    if (!ok) return;
    setLoading(true);
    try {
      const staffSnap = await getDocs(staffPublicCol());
      const uidByEmployeeId = new Map<string, string>();
      staffSnap.docs.forEach((d) => {
        const data: any = d.data();
        const linkedUid = String(data?.linkedUid || "").trim();
        if (linkedUid) uidByEmployeeId.set(d.id, linkedUid);
      });
      const bookingsRef = collection(db, "salons", SALON_ID, "bookings");
      const bSnap = await getDocs(bookingsRef);
      let batch = writeBatch(db);
      let batchCount = 0;
      for (const d of bSnap.docs) {
        const b: any = d.data();
        const employeeUid = String(b?.employeeUid || "").trim();
        const employeeId = String(b?.employeeId || "").trim();
        if (employeeUid || !employeeId) continue;
        const linkedUid = uidByEmployeeId.get(employeeId) || "";
        if (!linkedUid) continue;
        batch.update(doc(db, "salons", SALON_ID, "bookings", d.id), {
          employeeUid: linkedUid,
          employeeKey: linkedUid,
          updatedAt: serverTimestamp(),
        });
        batchCount++;
        if (batchCount >= 450) {
          await batch.commit();
          batch = writeBatch(db);
          batchCount = 0;
        }
      }
      await batch.commit();
      alert("✅ تم إصلاح الحجوزات");
    } catch (e) {
      console.warn(e);
      setErrorMsg("خطأ في الإصلاح");
    } finally {
      setLoading(false);
    }
  };

  // ✅ Toggle Active (نشط/غير نشط)
  const toggleActiveQuick = async (x: StaffPublicUi) => {
    if (!canManage) return;
    setLoading(true);
    setErrorMsg("");
    try {
      const next = !x.active;
      await updateDoc(staffPublicDoc(x.id), {
        active: next,
        updatedAt: serverTimestamp(),
      } as any);
      setList((prev) => prev.map((r) => (r.id === x.id ? { ...r, active: next } : r)));
    } catch (e) {
      console.warn("toggleActiveQuick error:", e);
      setErrorMsg("تعذر تغيير حالة الموظفة");
    } finally {
      setLoading(false);
    }
  };

  // ✅ Toggle ShowOnAbout (يظهر في About أو لا)
  const toggleShowOnAboutQuick = async (x: StaffPublicUi) => {
    if (!canManage) return;
    setLoading(true);
    setErrorMsg("");
    try {
      const cur = (x as any).showOnAbout !== false;
      const next = !cur;
      await updateDoc(staffPublicDoc(x.id), {
        showOnAbout: next,
        updatedAt: serverTimestamp(),
      } as any);
      setList((prev) =>
        prev.map((r) => (r.id === x.id ? { ...r, showOnAbout: next } : r))
      );
    } catch (e) {
      console.warn("toggleShowOnAboutQuick error:", e);
      setErrorMsg("تعذر تغيير ظهور الموظفة في صفحة من نحن");
    } finally {
      setLoading(false);
    }
  };

  const updateStaffBookingDraft = (
    staffId: string,
    patch: Partial<
      Pick<
        StaffPublicUi,
        | "showOnBooking"
        | "onLeave"
        | "leaveUntil"
        | "leaveNote"
        | "exceptionalLeaveDates"
        | "exceptionalLeaveWeekdays"
      >
    >
  ) => {
    setList((prev) =>
      prev.map((row) =>
        row.id === staffId
          ? ({
              ...row,
              ...patch,
            } as StaffPublicUi)
          : row
      )
    );
  };

  const addExceptionalLeaveWeekday = (staffId: string) => {
    const nextWeekday = normalizeWeekdayKey(leaveExceptionWeekdayByStaff[staffId]);
    if (!nextWeekday) return;
    setList((prev) =>
      prev.map((row) => {
        if (row.id !== staffId) return row;
        const current = normalizeExceptionalLeaveWeekdays(
          (row as any).exceptionalLeaveWeekdays
        );
        return {
          ...row,
          exceptionalLeaveWeekdays: normalizeExceptionalLeaveWeekdays([
            ...current,
            nextWeekday,
          ]),
        } as StaffPublicUi;
      })
    );
    setLeaveExceptionWeekdayByStaff((prev) => ({ ...prev, [staffId]: "" }));
  };

  const removeExceptionalLeaveWeekday = (staffId: string, dayKey: WeekdayKey) => {
    setList((prev) =>
      prev.map((row) => {
        if (row.id !== staffId) return row;
        const current = normalizeExceptionalLeaveWeekdays(
          (row as any).exceptionalLeaveWeekdays
        );
        return {
          ...row,
          exceptionalLeaveWeekdays: current.filter((d) => d !== dayKey),
        } as StaffPublicUi;
      })
    );
  };

  const saveStaffBookingSettings = async (staff: StaffPublicUi) => {
    if (!canManage) return;

    const leaveUntil = normalizeLeaveUntil((staff as any).leaveUntil);
    const employmentEndDate = normalizeLeaveUntil((staff as any).employmentEndDate);
    const leaveExpired = !!leaveUntil && leaveUntil < todayIso();
    const effectiveOnLeave = !!(staff as any).onLeave && !leaveExpired;
    const leaveNote = String((staff as any).leaveNote || "").trim();
    const exceptionalLeaveDates = normalizeExceptionalLeaveDates(
      (staff as any).exceptionalLeaveDates
    );
    const exceptionalLeaveWeekdays = normalizeExceptionalLeaveWeekdays(
      (staff as any).exceptionalLeaveWeekdays
    );

    setLoading(true);
    setErrorMsg("");
    try {
      await updateDoc(staffPublicDoc(staff.id), {
        showOnBooking: (staff as any).showOnBooking !== false,
        employmentEndDate,
        onLeave: effectiveOnLeave,
        leaveUntil,
        leaveNote,
        exceptionalLeaveDates,
        exceptionalLeaveWeekdays,
        updatedAt: serverTimestamp(),
      } as any);

      setList((prev) =>
        prev.map((row) =>
          row.id === staff.id
            ? ({
                ...row,
                showOnBooking: (staff as any).showOnBooking !== false,
                employmentEndDate,
                onLeave: effectiveOnLeave,
                leaveUntil,
                leaveNote,
                exceptionalLeaveDates,
                exceptionalLeaveWeekdays,
              } as StaffPublicUi)
            : row
        )
      );
    } catch (e) {
      console.warn("saveStaffBookingSettings error:", e);
      setErrorMsg("تعذر حفظ إعدادات الحجز للموظفة");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    loadServiceOptions();
  }, []);

  useEffect(() => {
    if (specialtiesMigrationDoneRef.current) return;
    if (!serviceOptions.length || !list.length) return;
    specialtiesMigrationDoneRef.current = true;

    const run = async () => {
      const updates: Array<{ id: string; specialties: string[] }> = [];
      list.forEach((row) => {
        const before = normalizeSpecialties(row.specialties);
        const after = canonicalizeSpecialties(before, serviceOptions);
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          updates.push({ id: row.id, specialties: after });
        }
      });

      if (!updates.length) return;

      try {
        await Promise.all(
          updates.map((u) =>
            updateDoc(staffPublicDoc(u.id), {
              specialties: u.specialties,
              updatedAt: serverTimestamp(),
            })
          )
        );
        setList((prev) =>
          prev.map((r) => {
            const hit = updates.find((u) => u.id === r.id);
            return hit ? { ...r, specialties: hit.specialties } : r;
          })
        );
      } catch (e) {
        console.warn("specialties migration failed:", e);
      }
    };

    void run();
  }, [list, serviceOptions]);

  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const unsub = AppSettingsService.subscribe((remote: any) => {
      setAppSettings(remote || {});
    });
    return () => {
      try {
        unsub?.();
      } catch {
        // noop
      }
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const compute = async () => {
      if (!(authUser?.role === "owner" || authUser?.role === "admin") || !list.length) {
        setBookingStats({});
        return;
      }
      setStatsLoading(true);
      try {
        const thisMonth = currentMonthKey();
        const initStats = (): StaffBookingStats => ({
          total: 0,
          byStatus: { pending: 0, confirmed: 0, completed: 0, cancelled: 0 },
          month: {
            key: thisMonth,
            salonTotal: 0,
            staffTotal: 0,
            sharePct: 0,
            invoiceCount: 0,
            invoiceRevenue: 0,
          },
        });
        const staffById = new Set(list.map((s) => s.id));
        const staffByKey = new Map<string, string>();
        const staffByName = new Map<string, string>();
        let salonMonthTotal = 0;

        for (const s of list) {
          const sid = String(s.id || "").trim();
          if (sid) staffByKey.set(sid, sid);
          const nKey = normalizeArabicName(s.name);
          if (nKey) staffByName.set(nKey, sid);
          const nk2 = safeKey(String(s.name || "").trim());
          if (nk2) staffByKey.set(nk2, sid);
        }

        const rows: BookingDocWithId[] = await listAllBookings();
        const m: Record<string, StaffBookingStats> = {};

        for (const b of rows) {
          const bMonth = monthKey(String((b as any).date || ""));
          const st = (String((b as any).status || "pending").toLowerCase() ||
            "pending") as BookingStatus;
          const bookingAmount = bookingAmountOf(b);
          const isRevenueStatus = REVENUE_STATUSES.has(st);
          if (bMonth === thisMonth && st !== "cancelled") salonMonthTotal += 1;

          const eid = String((b as any).employeeId || "").trim();
          const euid = String((b as any).employeeUid || "").trim();
          const ekey = String((b as any).employeeKey || "").trim();
          const ename = String((b as any).employeeName || "").trim();

          let staffId: string | null = null;
          if (ekey && staffByKey.has(ekey)) staffId = staffByKey.get(ekey) || null;
          if (!staffId && euid && staffByKey.has(euid))
            staffId = staffByKey.get(euid) || null;
          if (!staffId && eid && staffById.has(eid)) staffId = eid;
          if (!staffId && ename) {
            const k = normalizeArabicName(ename);
            staffId = staffByName.get(k) || null;
          }
          if (!staffId) continue;

          if (!m[staffId]) m[staffId] = initStats();
          m[staffId].total += 1;
          m[staffId].byStatus[st] = (m[staffId].byStatus[st] || 0) + 1;
          if (bMonth === thisMonth && st !== "cancelled") {
            m[staffId].month.staffTotal += 1;
          }
          if (bMonth === thisMonth && isRevenueStatus) {
            m[staffId].month.invoiceCount += 1;
            m[staffId].month.invoiceRevenue += bookingAmount;
          }
        }

        Object.keys(m).forEach((sid) => {
          m[sid].month.salonTotal = salonMonthTotal;
          m[sid].month.sharePct =
            salonMonthTotal > 0 ? Math.round((m[sid].month.staffTotal / salonMonthTotal) * 100) : 0;
        });

        list.forEach((s) => {
          if (!m[s.id]) {
            m[s.id] = initStats();
            m[s.id].month.salonTotal = salonMonthTotal;
          }
        });

        Object.keys(m).forEach((sid) => {
          if (!m[sid].month.sharePct && m[sid].month.salonTotal > 0 && m[sid].month.staffTotal > 0) {
            m[sid].month.sharePct = Math.round(
              (m[sid].month.staffTotal / m[sid].month.salonTotal) * 100
            );
          }
        });
        if (alive) setBookingStats(m);
      } catch (e) {
        console.warn("booking stats error:", e);
        if (alive) setBookingStats({});
      } finally {
        if (alive) setStatsLoading(false);
      }
    };
    compute();
    return () => {
      alive = false;
    };
  }, [authUser?.role, list]);

  useEffect(() => {
    if (!selectedEmployeeId) return;
    const exists = list.some((x) => x.id === selectedEmployeeId);
    if (exists) return;
    setSelectedEmployeeId(null);
    setEditId(null);
    setIsOpen(false);
    setMode("view");
  }, [list, selectedEmployeeId]);

  useEffect(() => {
    setModalHourOverrideFromDateHijri(formatHijriInputFromIso(modalHourOverrideFromDate));
  }, [modalHourOverrideFromDate]);

  useEffect(() => {
    setModalHourOverrideToDateHijri(formatHijriInputFromIso(modalHourOverrideToDate));
  }, [modalHourOverrideToDate]);

  useEffect(() => {
    if (!modalHourOverrideHijriPickerOpen) return;
    const onDocClick = (ev: MouseEvent) => {
      const root = modalHourOverrideHijriPickerRef.current;
      if (!root) return;
      const target = ev.target as Node | null;
      if (target && root.contains(target)) return;
      setModalHourOverrideHijriPickerOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [modalHourOverrideHijriPickerOpen]);

  const sectionOptions = useMemo(() => {
    const m = new Map<string, { id: string; label: string }>();
    for (const s of serviceOptions) {
      const sid = String(s.sectionId || "").trim();
      if (!sid) continue;
      if (!m.has(sid)) m.set(sid, { id: sid, label: sid });
    }
    return Array.from(m.values()).sort((a, b) =>
      a.label.localeCompare(b.label, "ar")
    );
  }, [serviceOptions]);

  const filteredServicesForPicks = useMemo(() => {
    let rows = [...serviceOptions];
    if (srvSection !== "all") {
      rows = rows.filter((s) => String(s.sectionId || "").trim() === srvSection);
    }
    const q = srvQ.trim().toLowerCase();
    if (q) {
      rows = rows.filter((s) => String(s.label || "").toLowerCase().includes(q));
    }
    rows.sort((a, b) => String(a.label).localeCompare(String(b.label), "ar"));
    return rows;
  }, [serviceOptions, srvSection, srvQ]);

  const toggleSpecialty = (serviceId: string) => {
    setSpecialties((prev) =>
      prev.includes(serviceId) ? prev.filter((x) => x !== serviceId) : [...prev, serviceId]
    );
  };

  const save = async () => {
    if (!canManage) return;
    const cleanName = name.trim();
    const specialtiesFixed = canonicalizeSpecialties(specialties, serviceOptions);
    if (!cleanName) {
      setErrorMsg("اكتب اسم الموظفة");
      return;
    }
    if (specialtiesFixed.length === 0) {
      setErrorMsg("اختَر خدمة واحدة على الأقل");
      return;
    }
    // ✅ منع "النسيان": موظفة نشطة لكن مخفية من الحجز
    if (active && !showOnBooking) {
      const ok = confirm(
        "⚠️ تنبيه: الموظفة (نشطة) لكن (مخفية من الحجز).\nهل تريد الحفظ بهذا الشكل؟"
      );
      if (!ok) return;
    }

    // احفظ فقط الاستثناءات التي تم إضافتها فعلياً في القائمة.
    // لا نطبق المسودة تلقائياً عند الحفظ حتى لا تعيد القيم القديمة.
    let normalizedCustomHourOverrides = normalizeWorkingHourOverrides(modalCustomHourOverrides);
    const hasPendingOverrideDraft =
      !!normalizeLeaveUntil(modalHourOverrideEditingDate) ||
      (!!normalizeLeaveUntil(modalHourOverrideFromDate) && modalHourOverridePreview.affectedDays > 0);
    if (modalUseCustomWorkingHours && hasPendingOverrideDraft) {
      const draftResult = buildModalWorkingHourOverrides(normalizedCustomHourOverrides);
      if (draftResult.error) {
        setErrorMsg(draftResult.error);
        return;
      }
      if (draftResult.appliedCount > 0) {
        normalizedCustomHourOverrides = draftResult.next;
        setModalCustomHourOverrides(draftResult.next);
      }
    }


    setLoading(true);
    setErrorMsg("");
    const normalizedModalLeaveUntil = normalizeLeaveUntil(modalLeaveUntil);
    const normalizedEmploymentEndDate = normalizeLeaveUntil(employmentEndDate);
    const modalLeaveExpired = !!normalizedModalLeaveUntil && normalizedModalLeaveUntil < todayIso();
    const effectiveModalOnLeave = modalOnLeave && !modalLeaveExpired;
    const normalizedExceptionalWeekdays = normalizeExceptionalLeaveWeekdays(
      modalExceptionalLeaveWeekdays
    );
    const normalizedCustomWorkingHours = normalizeWorkingHours(modalCustomWorkingHours);
    const normalizedExceptionalDates = editId
      ? normalizeExceptionalLeaveDates((editingStaff as any)?.exceptionalLeaveDates)
      : [];

    const payload: StaffPublicDoc = {
      name: cleanName,
      active: !!active,
      showOnAbout: !!showOnAbout,
      showOnBooking: !!showOnBooking,
      employmentEndDate: normalizedEmploymentEndDate,
      onLeave: effectiveModalOnLeave,
      leaveUntil: normalizedModalLeaveUntil,
      leaveNote: String(modalLeaveNote || "").trim(),
      exceptionalLeaveDates: normalizedExceptionalDates,
      exceptionalLeaveWeekdays: normalizedExceptionalWeekdays,
      useCustomWorkingHours: !!modalUseCustomWorkingHours,
      customWorkingHours: normalizedCustomWorkingHours,
      customWorkingHourOverrides: normalizedCustomHourOverrides,
      monthlySalary: safeNonNegativeNumber(monthlySalary, 0),
      overtimeMethod:
        overtimeMethod === "invoice_percentage" ? "invoice_percentage" : "hours_from_salary",
      overtimeDaysPerMonth: Math.max(1, safeNonNegativeNumber(overtimeDaysPerMonth, 30)),
      overtimeBaseHoursPerDay: Math.max(1, safeNonNegativeNumber(overtimeBaseHoursPerDay, 8)),
      overtimeSeasonBaseHoursPerDay: Math.max(
        1,
        safeNonNegativeNumber(overtimeSeasonBaseHoursPerDay, 6)
      ),
      overtimeHoursBasis: overtimeHoursBasis === "season" ? "season" : "regular",
      overtimePercent: safeNonNegativeNumber(overtimePercent, 0),
      overtimeInvoicePercent: safeNonNegativeNumber(overtimeInvoicePercent, 0),

      specialties: specialtiesFixed,
      bio: bio.trim(),
      avatarUrl: avatarUrl.trim(),
      cvUrl: cvUrl.trim(),
      updatedAt: serverTimestamp(),
    };

    try {
      if (!editId) {
        const id = cleanName
          .replace(/\s+/g, "_")
          .replace(/[^\w\u0600-\u06FF_]/g, "")
          .slice(0, 40);
        await setDoc(staffPublicDoc(id || crypto.randomUUID()), {
          ...payload,
          leaveBalanceDays: 0,
          leaveEntitlementDate: "",
          leaveEntries: [],
          createdAt: serverTimestamp(),
        });
      } else {
        await updateDoc(staffPublicDoc(editId), payload as any);
      }
      if (!selectedEmployeeId) {
        closeModal();
      } else {
        setMode("view");
      }
      await load();
    } catch (e: any) {
      console.warn("save staff_public error:", e);
      setErrorMsg(String(e?.message || "تعذر حفظ الموظفة"));
    } finally {
      setLoading(false);
    }
  };

  const remove = async (id: string) => {
    if (!canManage) return;
    if (!confirm("متأكد حذف الموظفة؟")) return;
    setLoading(true);
    setErrorMsg("");
    try {
      await deleteDoc(staffPublicDoc(id));
      if (selectedEmployeeId === id) {
        setSelectedEmployeeId(null);
        setEditId(null);
        setIsOpen(false);
        setMode("view");
      }
      await load();
    } catch (e) {
      console.warn("delete staff_public error:", e);
      setErrorMsg("تعذر حذف الموظفة");
    } finally {
      setLoading(false);
    }
  };

  const filtered = useMemo(() => {
    let rows = [...list];
    if (onlyActive === "active") rows = rows.filter((x) => x.active);
    if (onlyActive === "inactive") rows = rows.filter((x) => !x.active);
    if (specialtyFilter !== "all") {
      rows = rows.filter((x) => normalizeSpecialties(x.specialties).includes(specialtyFilter));
    }
    const t = qText.trim().toLowerCase();
    if (t) {
      rows = rows.filter((x) => {
        const n = (x.name || "").toLowerCase();
        const b = (x.bio || "").toLowerCase();
        return n.includes(t) || b.includes(t);
      });
    }
    return rows;
  }, [list, onlyActive, specialtyFilter, qText]);
  const selectedEmployee = useMemo(
    () => (selectedEmployeeId ? list.find((x) => x.id === selectedEmployeeId) || null : null),
    [list, selectedEmployeeId]
  );
  const selectedEmployeeLeaveUntil = normalizeLeaveUntil((selectedEmployee as any)?.leaveUntil);
  const selectedEmployeeLeaveExpired =
    !!selectedEmployeeLeaveUntil && selectedEmployeeLeaveUntil < todayIso();
  const selectedEmployeeOnLeave =
    !!(selectedEmployee as any)?.onLeave && !selectedEmployeeLeaveExpired;
  const selectedEmployeeStatusLabel = selectedEmployeeOnLeave
    ? selectedEmployeeLeaveUntil
      ? `في إجازة حتى ${fmtIsoDate(selectedEmployeeLeaveUntil)}`
      : "في إجازة"
    : selectedEmployee?.active
      ? "نشطة"
      : "غير نشطة";
  const selectedEmployeeStatusClass = selectedEmployeeOnLeave
    ? "warn"
    : selectedEmployee?.active
      ? "on"
      : "off";
  const showPayrollSubTab = !selectedEmployeeId || activeStatsSubTab === "payroll";
  const showStatsSubTab = !selectedEmployeeId || activeStatsSubTab === "stats";

  const staffScheduleSummary = useMemo(() => {
    const now = new Date(nowTick);
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const today = `${yyyy}-${mm}-${dd}`;
    const timeNow = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const weekday = weekdayFromIso(today);
    const booking = (appSettings as any)?.booking || {};
    const businessHours = (booking as any)?.businessHours || {};
    const bookingHourOverrides = readBookingHourOverrides((booking as any)?.bookingHourOverrides);

    const dayKey = weekday || "sat";
    const dayHoursBase = (businessHours as any)?.[dayKey] || {
      enabled: true,
      start: DEFAULT_OPEN_TIME,
      end: DEFAULT_CLOSE_TIME,
    };

    const salonWeeklyEnabled = dayHoursBase?.enabled !== false;
    const salonWeeklyOpen = normalizeTimeHHMM(dayHoursBase?.start) || DEFAULT_OPEN_TIME;
    const salonWeeklyClose = normalizeTimeHHMM(dayHoursBase?.end) || DEFAULT_CLOSE_TIME;
    let salonEnabled = salonWeeklyEnabled;
    let salonOpen = salonWeeklyOpen;
    let salonClose = salonWeeklyClose;
    let salonSourceLabel = "أسبوعي";
    let activeSalonOverride:
      | {
          sourceIndex: number;
          fromDate: string;
          toDate: string;
          mode: BookingHourOverrideMode;
          windowLabel: string;
          includeDays: WeekdayKey[];
          blockedDays: WeekdayKey[];
        }
      | null = null;

    for (let i = bookingHourOverrides.length - 1; i >= 0; i--) {
      const ov = bookingHourOverrides[i];
      if (today < ov.fromDate || today > ov.toDate) continue;
      const includeDays = Array.isArray(ov?.includeWeekdays) ? ov.includeWeekdays : [];
      if (includeDays.length > 0 && !includeDays.includes(dayKey)) continue;
      const blockedDays = Array.isArray(ov?.blockedWeekdays) ? ov.blockedWeekdays : [];
      if (blockedDays.includes(dayKey) || String(ov?.mode || "").trim() === "closed") {
        salonEnabled = false;
        salonSourceLabel = "استثناء فعلي";
        activeSalonOverride = {
          sourceIndex: i,
          fromDate: ov.fromDate,
          toDate: ov.toDate,
          mode: "closed",
          windowLabel: "إغلاق كامل اليوم",
          includeDays: includeDays as WeekdayKey[],
          blockedDays: blockedDays as WeekdayKey[],
        };
      } else {
        salonEnabled = true;
        const ovStart = normalizeTimeHHMM(ov.start) || salonOpen;
        const ovEnd = normalizeTimeHHMM(ov.end) || salonClose;
        salonOpen = ovStart;
        salonClose = ovEnd;
        salonSourceLabel = "استثناء فعلي";
        activeSalonOverride = {
          sourceIndex: i,
          fromDate: ov.fromDate,
          toDate: ov.toDate,
          mode: "hours",
          windowLabel: formatWindow(ovStart, ovEnd),
          includeDays: includeDays as WeekdayKey[],
          blockedDays: blockedDays as WeekdayKey[],
        };
      }
      break;
    }
    const salonWeeklyWindowLabel = salonWeeklyEnabled
      ? formatWindow(salonWeeklyOpen, salonWeeklyClose)
      : "مغلق أسبوعيًا";
    const salonEffectiveWindowLabel = salonEnabled
      ? formatWindow(salonOpen, salonClose)
      : "مغلق للحجوزات اليوم";

    const weekdayLabel = (key: WeekdayKey | "") =>
      WEEKDAY_OPTIONS.find((x) => x.key === key)?.label || "-";
    const formatWeekdaySet = (days: WeekdayKey[]) =>
      days.length ? days.map((d) => weekdayLabel(d)).join(" / ") : "-";
    const formatOverrideMeta = (ov: BookingHourOverride) => {
      const includeDays = Array.isArray(ov?.includeWeekdays) ? (ov.includeWeekdays as WeekdayKey[]) : [];
      const blockedDays = Array.isArray(ov?.blockedWeekdays) ? (ov.blockedWeekdays as WeekdayKey[]) : [];
      const includeLabel = includeDays.length ? formatWeekdaySet(includeDays) : "كل الأيام";
      const blockedLabel = blockedDays.length ? formatWeekdaySet(blockedDays) : "";
      const isClosed = String(ov?.mode || "").trim() === "closed";
      const start = normalizeTimeHHMM(ov?.start) || DEFAULT_OPEN_TIME;
      const end = normalizeTimeHHMM(ov?.end) || DEFAULT_CLOSE_TIME;
      const modeLabel = isClosed ? "إغلاق كامل" : `ساعات ${formatWindow(start, end)}`;
      return `${modeLabel} | الأيام المستهدفة: ${includeLabel}${
        blockedLabel ? ` | أيام الإغلاق: ${blockedLabel}` : ""
      }`;
    };
    const allOverrideDetails = bookingHourOverrides.map((ov, idx) => ({
      sourceIndex: idx,
      rangeDual: formatIsoDateRangeDual(ov.fromDate, ov.toDate),
      meta: formatOverrideMeta(ov),
    }));
    const todayDateGregorian = fmtIsoDate(today);
    const todayDateHijri = fmtIsoDateHijri(today);
    const todayDateLabel = `${todayDateGregorian} م / ${todayDateHijri} هـ`;
    const salonWeeklyDetails = salonWeeklyEnabled
      ? "الدوام الأساسي مأخوذ من الجدول الأسبوعي."
      : "اليوم مغلق في الجدول الأسبوعي.";
    const salonEffectiveBaseDetails = activeSalonOverride
      ? activeSalonOverride.mode === "closed"
        ? "تم إغلاق الصالون اليوم عبر الاستثناء الفعلي."
        : `تم تعديل ساعات الصالون اليوم عبر الاستثناء الفعلي (${activeSalonOverride.windowLabel}).`
      : "لا يوجد استثناء فعلي اليوم على الصالون.";
    const salonSourceDetails = (() => {
      const notes: string[] = [];
      const groups: SummarySourceGroup[] = [];
      const buildGroup = (
        title: string,
        gregorian: string,
        hijri: string,
        details: string[],
        tone: "active" | "other"
      ): SummarySourceGroup => ({
        title,
        gregorian,
        hijri,
        details,
        tone,
      });

      if (activeSalonOverride) {
        const activeDual = formatIsoDateRangeDual(activeSalonOverride.fromDate, activeSalonOverride.toDate);
        const activeDetails: string[] = [];
        if (activeSalonOverride.mode === "closed") {
          activeDetails.push("نوع الاستثناء: إغلاق كامل للحجوزات اليوم.");
        } else {
          activeDetails.push(`وقت الاستثناء الفعلي: ${activeSalonOverride.windowLabel}`);
        }
        if (activeSalonOverride.includeDays.length > 0) {
          activeDetails.push(`الأيام المستهدفة: ${formatWeekdaySet(activeSalonOverride.includeDays)}`);
        }
        if (activeSalonOverride.blockedDays.length > 0) {
          activeDetails.push(`أيام الإغلاق داخل النطاق: ${formatWeekdaySet(activeSalonOverride.blockedDays)}`);
        }
        groups.push(
          buildGroup(
            "الاستثناء الفعلي",
            activeDual.gregorian,
            activeDual.hijri,
            activeDetails,
            "active"
          )
        );

        const others = allOverrideDetails.filter((x) => x.sourceIndex !== activeSalonOverride.sourceIndex);
        if (others.length) {
          notes.push(`استثناءات أخرى مسجلة (${others.length}):`);
          others.forEach((x, idx) => {
            groups.push(
              buildGroup(
                `الاستثناء ${idx + 1}`,
                x.rangeDual.gregorian,
                x.rangeDual.hijri,
                [`تفاصيل الاستثناء ${idx + 1}: ${x.meta}`],
                "other"
              )
            );
          });
        }
      } else if (allOverrideDetails.length) {
        notes.push("لا يوجد استثناء فعلي اليوم.");
        notes.push(`الاستثناءات المسجلة (${allOverrideDetails.length}):`);
        allOverrideDetails.forEach((x, idx) => {
          groups.push(
            buildGroup(
              `الاستثناء ${idx + 1}`,
              x.rangeDual.gregorian,
              x.rangeDual.hijri,
              [`تفاصيل الاستثناء ${idx + 1}: ${x.meta}`],
              "other"
            )
          );
        });
      } else {
        notes.push("لا توجد استثناءات مسجلة على دوام الصالون.");
      }
      return { notes, groups };
    })();

    return list
      .map((staff) => {
        const leaveUntil = normalizeLeaveUntil((staff as any).leaveUntil);
        const employmentEndDate = normalizeLeaveUntil((staff as any).employmentEndDate);
        const exceptionalDates = normalizeExceptionalLeaveDates((staff as any).exceptionalLeaveDates);
        const exceptionalWeekdays = normalizeExceptionalLeaveWeekdays(
          (staff as any).exceptionalLeaveWeekdays
        );
        const overrides = normalizeWorkingHourOverrides((staff as any).customWorkingHourOverrides);
        const customWorkingHours = normalizeWorkingHours((staff as any).customWorkingHours);
        const useCustom = !!(staff as any).useCustomWorkingHours;
        const overrideToday = overrides.find((x) => x.date === today);
        const baseDay = weekday ? customWorkingHours[weekday] : undefined;

        const staffBaseWindowLabel = useCustom
          ? baseDay && baseDay.enabled !== false
            ? formatWindow(
                normalizeTimeHHMM(baseDay.start) || salonOpen,
                normalizeTimeHHMM(baseDay.end) || salonClose
              )
            : "مغلق هذا اليوم"
          : formatWindow(salonOpen, salonClose);
        const staffBaseMatchesSalonWeekly = staffBaseWindowLabel === salonWeeklyWindowLabel;

        const staffOverrideLabel = overrideToday
          ? overrideToday.enabled === false
            ? "إغلاق كامل اليوم"
            : formatWindow(
                normalizeTimeHHMM(overrideToday.start) || salonOpen,
                normalizeTimeHHMM(overrideToday.end) || salonClose
              )
          : "-";
        const staffBaseDetails = useCustom
          ? baseDay && baseDay.enabled !== false
            ? "الدوام مأخوذ من الجدول الأسبوعي المخصص للموظفة."
            : "اليوم مغلق في جدول الموظفة الأسبوعي المخصص."
          : "لا يوجد جدول أسبوعي مخصص؛ يتم الاعتماد على دوام الصالون الفعلي.";
        const staffOverrideDetails = overrideToday
          ? overrideToday.enabled === false
            ? `تم إغلاق دوام الموظفة بتاريخ ${todayDateLabel}.`
            : `استثناء موظفة فعلي اليوم: ${staffOverrideLabel}.`
          : "لا يوجد استثناء يومي خاص بالموظفة اليوم.";

        const leaveByDate = exceptionalDates.includes(today);
        const leaveByWeekday = weekday ? exceptionalWeekdays.includes(weekday) : false;
        const leaveByToggle =
          !!(staff as any).onLeave && (!leaveUntil || leaveUntil >= today);
        const leaveActiveToday = leaveByDate || leaveByWeekday || leaveByToggle;

        const ended = !!employmentEndDate && today > employmentEndDate;

        let effectiveEnabled = true;
        let effectiveStart = salonOpen;
        let effectiveEnd = salonClose;

        if (overrideToday) {
          effectiveEnabled = overrideToday.enabled !== false;
          effectiveStart = normalizeTimeHHMM(overrideToday.start) || salonOpen;
          effectiveEnd = normalizeTimeHHMM(overrideToday.end) || salonClose;
        } else if (useCustom) {
          if (!baseDay || baseDay.enabled === false) {
            effectiveEnabled = false;
          } else {
            effectiveStart = normalizeTimeHHMM(baseDay.start) || salonOpen;
            effectiveEnd = normalizeTimeHHMM(baseDay.end) || salonClose;
          }
        }
        const intersection =
          salonEnabled && effectiveEnabled
            ? intersectTimeWindows(salonOpen, salonClose, effectiveStart, effectiveEnd)
            : null;
        const nowInsideWindow =
          !!intersection && isTimeInsideWindow(timeNow, intersection.start, intersection.end);

        const actualNow = ended
          ? "مستبعدة من الحجز (انتهى التوظيف)"
          : leaveActiveToday
            ? "متوقفة اليوم (إجازة)"
            : !salonEnabled
              ? "الحجوزات مغلقة اليوم على مستوى الصالون"
              : !effectiveEnabled
                ? "لا يوجد دوام موظفة اليوم"
                : !intersection
                  ? "لا يوجد تقاطع بين دوام الموظفة ودوام الحجوزات"
                  : nowInsideWindow
                    ? `تعمل الآن: ${formatWindow(intersection.start, intersection.end)}`
                    : `خارج الدوام الآن: ${formatWindow(intersection.start, intersection.end)}`;
        const statusTone: "good" | "warn" | "muted" =
          nowInsideWindow && !!intersection && !ended && !leaveActiveToday
            ? "good"
            : ended || leaveActiveToday || !salonEnabled || !effectiveEnabled || !intersection
              ? "warn"
              : "muted";
        const salonEffectiveDetails = ended
          ? "الموظفة مستبعدة من الحجز بعد انتهاء التوظيف."
          : leaveActiveToday
            ? "الموظفة في إجازة اليوم، لذلك لا يظهر حجز فعلي لها."
            : !salonEnabled
              ? "الحجوزات مغلقة اليوم على مستوى الصالون."
              : !effectiveEnabled
                ? "دوام الموظفة مغلق اليوم."
                : !intersection
                  ? "لا يوجد وقت مشترك بين دوام الصالون ودوام الموظفة."
                  : `المدى المتاح للحجز مع الموظفة: ${formatWindow(intersection.start, intersection.end)}.`;

        const warnings: string[] = [];
        if (leaveByDate) {
          warnings.push(`اليوم ضمن إجازة استثنائية محددة بتاريخ ${todayDateLabel}.`);
        }
        if ((staff as any).onLeave) {
          if (leaveUntil && leaveUntil >= today) {
            warnings.push(`في إجازة من ${fmtIsoDate(today)} إلى ${fmtIsoDate(leaveUntil)}.`);
          } else if (leaveUntil && leaveUntil < today) {
            warnings.push(`انتهت إجازتها بتاريخ ${fmtIsoDate(leaveUntil)}.`);
          } else {
            warnings.push("في إجازة حالياً بدون تاريخ نهاية محدد.");
          }
        }

        const futureExceptional = exceptionalDates.filter((d) => d > today).sort((a, b) => a.localeCompare(b));
        if (futureExceptional.length > 0) {
          const start = futureExceptional[0];
          let end = start;
          for (let i = 1; i < futureExceptional.length; i++) {
            const expectedNext = addDaysIso(end, 1);
            if (futureExceptional[i] === expectedNext) {
              end = futureExceptional[i];
              continue;
            }
            break;
          }
          const diffDays = Math.max(
            0,
            Math.floor(
              (new Date(`${start}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) /
                86400000
            )
          );
          const lead = diffDays <= 14 ? "إجازة قريبة" : "إجازة مجدولة";
          warnings.push(`${lead} تبدأ ${fmtIsoDate(start)} وتنتهي ${fmtIsoDate(end)}.`);
        }

        if (exceptionalWeekdays.length > 0) {
          const weeklyLabels = exceptionalWeekdays.map((d) => weekdayLabel(d));
          if (weeklyLabels.length === 1) {
            warnings.push(`إجازة ثابتة كل ${weeklyLabels[0]}.`);
          } else {
            warnings.push(`إجازة ثابتة كل: ${weeklyLabels.join(" / ")}.`);
          }
        }

        const leaveDaysLabel = exceptionalWeekdays.length
          ? exceptionalWeekdays.map((d) => weekdayLabel(d)).join(" / ")
          : "-";
        const leaveDaysDetails = exceptionalWeekdays.length
          ? leaveByWeekday
            ? "اليوم يقع ضمن الإجازة الأسبوعية الثابتة."
            : "اليوم ليس ضمن الإجازة الأسبوعية الثابتة."
          : "لا توجد أيام إجازة أسبوعية ثابتة.";

        return {
          id: staff.id,
          name: String(staff.name || "-"),
          todayWeekdayLabel: weekdayLabel(weekday),
          todayDateGregorianLabel: `${todayDateGregorian} م`,
          todayDateHijriLabel: `${todayDateHijri} هـ`,
          salonWeeklyWindowLabel,
          salonWeeklyDetails,
          salonEffectiveWindowLabel,
          salonEffectiveDetails: `${salonEffectiveBaseDetails} ${salonEffectiveDetails}`,
          salonSourceLabel,
          salonSourceDetails,
          staffBaseWindowLabel,
          staffBaseMatchesSalonWeekly,
          staffBaseDetails,
          staffOverrideLabel,
          staffOverrideDetails,
          leaveDaysLabel,
          leaveDaysDetails,
          statusNowLabel: actualNow,
          statusTone,
          warnings,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ar"));
  }, [list, nowTick, appSettings]);

  const editingStaff = useMemo(
    () => (editId ? list.find((x) => x.id === editId) || null : null),
    [editId, list]
  );
  const modalStaffScheduleSummary = useMemo(
    () => (editingStaff ? staffScheduleSummary.find((x) => x.id === editingStaff.id) || null : null),
    [editingStaff, staffScheduleSummary]
  );
  const modalPayrollMonthSummary = useMemo(() => {
    if (!editingStaff) return null;
    const monthStats = bookingStats[editingStaff.id]?.month;
    const cycleMonthKey =
      payrollCycleKeyFromDate(todayIso(), PAYROLL_CLOSE_DAY) ||
      String(monthStats?.key || currentMonthKey());
    const staffCalc: StaffPublicDoc & { id: string } = {
      ...editingStaff,
      id: editingStaff.id,
      name: String(name || editingStaff.name || "").trim() || editingStaff.name || editingStaff.id,
      active: !!active,
      useCustomWorkingHours: !!modalUseCustomWorkingHours,
      customWorkingHours: normalizeWorkingHours(modalCustomWorkingHours),
      customWorkingHourOverrides: normalizeWorkingHourOverrides(modalCustomHourOverrides),
      monthlySalary: safeNonNegativeNumber(monthlySalary, 0),
      overtimeMethod:
        overtimeMethod === "invoice_percentage" ? "invoice_percentage" : "hours_from_salary",
      overtimeDaysPerMonth: Math.max(1, safeNonNegativeNumber(overtimeDaysPerMonth, 30)),
      overtimeBaseHoursPerDay: Math.max(1, safeNonNegativeNumber(overtimeBaseHoursPerDay, 8)),
      overtimeSeasonBaseHoursPerDay: Math.max(
        1,
        safeNonNegativeNumber(overtimeSeasonBaseHoursPerDay, 6)
      ),
      overtimeHoursBasis: overtimeHoursBasis === "season" ? "season" : "regular",
      overtimePercent: safeNonNegativeNumber(overtimePercent, 0),
      overtimeInvoicePercent: safeNonNegativeNumber(overtimeInvoicePercent, 0),
    };
    return computeStaffPayrollForMonth({
      staff: staffCalc as any,
      monthKey: cycleMonthKey,
      appSettings,
      invoiceCount: Number(monthStats?.invoiceCount || 0),
      invoiceRevenue: Number(monthStats?.invoiceRevenue || 0),
    });
  }, [
    editingStaff,
    bookingStats,
    appSettings,
    name,
    active,
    modalUseCustomWorkingHours,
    modalCustomWorkingHours,
    modalCustomHourOverrides,
    monthlySalary,
    overtimeMethod,
    overtimeDaysPerMonth,
    overtimeBaseHoursPerDay,
    overtimeSeasonBaseHoursPerDay,
    overtimeHoursBasis,
    overtimePercent,
    overtimeInvoicePercent,
    nowTick,
  ]);
  const modalTabs: Array<{ key: EmployeeModalTab; label: string }> = editingStaff
    ? [
        { key: "basic", label: "البيانات الأساسية" },
        { key: "booking", label: "الحجز والدوام" },
        { key: "services", label: "الخدمات" },
        { key: "profile", label: "الملف" },
        { key: "stats", label: "الإحصائيات والإجازات" },
      ]
    : [
        { key: "basic", label: "البيانات الأساسية" },
        { key: "booking", label: "الحجز والدوام" },
        { key: "services", label: "الخدمات" },
        { key: "profile", label: "الملف" },
      ];
  const modalLeaveExpired = useMemo(() => {
    const leaveUntil = normalizeLeaveUntil(modalLeaveUntil);
    return !!leaveUntil && leaveUntil < todayIso();
  }, [modalLeaveUntil]);
  const modalHourOverrideTargetCount = useMemo(() => {
    const fromInput = normalizeLeaveUntil(modalHourOverrideFromDate);
    if (!fromInput) return 0;
    const toInput =
      modalHourOverrideMode === "single"
        ? fromInput
        : normalizeLeaveUntil(modalHourOverrideToDate) || fromInput;
    const from = fromInput <= toInput ? fromInput : toInput;
    const to = fromInput <= toInput ? toInput : fromInput;
    let cursor = from;
    let guard = 0;
    let count = 0;
    while (cursor && cursor <= to) {
      const day = weekdayFromIso(cursor);
      const allowed =
        modalHourOverrideMode !== "specific" ||
        (!!day && modalHourOverrideApplyWeekdays.includes(day));
      if (allowed) count += 1;
      cursor = addDaysIso(cursor, 1);
      guard += 1;
      if (guard > 120) break;
    }
    return count;
  }, [modalHourOverrideFromDate, modalHourOverrideToDate, modalHourOverrideApplyWeekdays, modalHourOverrideMode]);
  const modalHourOverrideExistingTargetCount = useMemo(() => {
    const fromInput = normalizeLeaveUntil(modalHourOverrideFromDate);
    if (!fromInput) return 0;
    const toInput =
      modalHourOverrideMode === "single"
        ? fromInput
        : normalizeLeaveUntil(modalHourOverrideToDate) || fromInput;
    const from = fromInput <= toInput ? fromInput : toInput;
    const to = fromInput <= toInput ? toInput : fromInput;
    const existingDates = new Set(
      modalCustomHourOverrides.map((x) => normalizeLeaveUntil(x.date)).filter((x): x is string => !!x)
    );
    let cursor = from;
    let guard = 0;
    let count = 0;
    while (cursor && cursor <= to) {
      const day = weekdayFromIso(cursor);
      const allowed =
        modalHourOverrideMode !== "specific" ||
        (!!day && modalHourOverrideApplyWeekdays.includes(day));
      if (allowed && existingDates.has(cursor)) count += 1;
      cursor = addDaysIso(cursor, 1);
      guard += 1;
      if (guard > 120) break;
    }
    return count;
  }, [
    modalHourOverrideFromDate,
    modalHourOverrideToDate,
    modalHourOverrideApplyWeekdays,
    modalHourOverrideMode,
    modalCustomHourOverrides,
  ]);
  const modalHourOverrideApplyCount = modalHourOverrideUpdateExistingOnly
    ? modalHourOverrideExistingTargetCount
    : modalHourOverrideTargetCount;
  const modalHourOverridePreview = useMemo(() => {
    const fromInput = normalizeLeaveUntil(modalHourOverrideFromDate);
    if (!fromInput) return { affectedDays: 0, totalHours: 0, baseHours: 0, diffHours: 0 };
    const toInput =
      modalHourOverrideMode === "single"
        ? fromInput
        : normalizeLeaveUntil(modalHourOverrideToDate) || fromInput;
    const from = fromInput <= toInput ? fromInput : toInput;
    const to = fromInput <= toInput ? toInput : fromInput;
    const nextEnabled =
      modalHourOverrideQuickMode === "closed" ? false : modalHourOverrideEnabled;
    const nextHours = durationHours(
      nextEnabled,
      normalizeTimeHHMM(modalHourOverrideStart) || "10:00",
      normalizeTimeHHMM(modalHourOverrideEnd) || "22:00"
    );
    const existingDates = new Set(modalCustomHourOverrides.map((x) => x.date));
    let cursor = from;
    let guard = 0;
    let affected = 0;
    let total = 0;
    let base = 0;
    while (cursor && cursor <= to) {
      const day = weekdayFromIso(cursor);
      const allowed =
        modalHourOverrideMode !== "specific" ||
        (!!day && modalHourOverrideApplyWeekdays.includes(day));
      if (allowed) {
        const canApply = modalHourOverrideUpdateExistingOnly
          ? existingDates.has(cursor)
          : modalHourOverrideApplyMethod === "replace" || !existingDates.has(cursor);
        if (canApply) {
          const baseDay = day ? modalCustomWorkingHours[day] : undefined;
          const baseEnabled = (baseDay?.enabled ?? true) !== false;
          const baseStart = normalizeTimeHHMM(baseDay?.start) || "10:00";
          const baseEnd = normalizeTimeHHMM(baseDay?.end) || "22:00";
          base += durationHours(baseEnabled, baseStart, baseEnd);
          total += nextHours;
          affected += 1;
        }
      }
      cursor = addDaysIso(cursor, 1);
      guard += 1;
      if (guard > 120) break;
    }
    return { affectedDays: affected, totalHours: total, baseHours: base, diffHours: total - base };
  }, [
    modalHourOverrideFromDate,
    modalHourOverrideToDate,
    modalHourOverrideMode,
    modalHourOverrideQuickMode,
    modalHourOverrideEnabled,
    modalHourOverrideStart,
    modalHourOverrideEnd,
    modalHourOverrideApplyWeekdays,
    modalHourOverrideApplyMethod,
    modalHourOverrideUpdateExistingOnly,
    modalCustomHourOverrides,
    modalCustomWorkingHours,
  ]);
  const modalHourOverrideGroups = useMemo(
    () => buildWorkingHourOverrideGroups(modalCustomHourOverrides),
    [modalCustomHourOverrides]
  );

  const updateModalWorkingDay = (
    day: WeekdayKey,
    patch: Partial<StaffWorkingDay>
  ) => {
    setModalCustomWorkingHours((prev) => ({
      ...prev,
      [day]: {
        ...(prev[day] || { enabled: true, start: "10:00", end: "22:00" }),
        ...patch,
      },
    }));
  };
  const copyModalWorkingDayToAll = (sourceDay: WeekdayKey) => {
    setModalCustomWorkingHours((prev) => {
      const sourceRaw = prev[sourceDay] || { enabled: true, start: "10:00", end: "22:00" };
      const source: StaffWorkingDay = {
        enabled: sourceRaw.enabled !== false,
        start: normalizeTimeHHMM(sourceRaw.start) || "10:00",
        end: normalizeTimeHHMM(sourceRaw.end) || "22:00",
      };
      const next = { ...prev };
      WEEKDAY_OPTIONS.forEach((d) => {
        next[d.key] = { ...source };
      });
      return next;
    });
  };

  const toggleModalHourOverrideWeekday = (day: WeekdayKey) => {
    setModalHourOverrideApplyWeekdays((prev) =>
      prev.includes(day) ? prev.filter((x) => x !== day) : [...prev, day]
    );
  };

  const setModalHourOverrideFromGregorian = (next: string) => {
    const iso = normalizeLeaveUntil(next);
    setModalHourOverrideFromDate(iso);
    if (modalHourOverrideEditingDate || modalHourOverrideMode === "single") {
      setModalHourOverrideToDate(iso);
    }
  };

  const setModalHourOverrideToGregorian = (next: string) => {
    const iso = normalizeLeaveUntil(next);
    setModalHourOverrideToDate(iso);
    if (
      iso &&
      !normalizeLeaveUntil(modalHourOverrideEditingDate) &&
      modalHourOverrideMode === "single"
    ) {
      setModalHourOverrideMode("range");
    }
  };

  const openModalHourOverrideHijriPicker = (target: "from" | "to") => {
    const baseIso =
      target === "from"
        ? normalizeLeaveUntil(modalHourOverrideFromDate) || todayIso()
        : normalizeLeaveUntil(modalHourOverrideToDate) ||
          normalizeLeaveUntil(modalHourOverrideFromDate) ||
          todayIso();
    setModalHourOverrideHijriPickerTarget(target);
    setModalHourOverrideHijriViewMonthISO(findHijriMonthStartIso(baseIso));
    setModalHourOverrideHijriPickerOpen(true);
    setErrorMsg("");
  };

  const applyModalHourOverrideHijriPick = (iso: string) => {
    const dateIso = normalizeLeaveUntil(iso);
    if (!dateIso) return;
    if (modalHourOverrideHijriPickerTarget === "from") {
      setModalHourOverrideFromGregorian(dateIso);
    } else {
      setModalHourOverrideToGregorian(dateIso);
    }
    setModalHourOverrideHijriPickerOpen(false);
    setErrorMsg("");
  };

  const applyModalHourOverrideHijriInput = (
    target: "from" | "to",
    raw: string,
    commit = false
  ) => {
    const nextRaw = String(raw || "");
    if (target === "from") setModalHourOverrideFromDateHijri(nextRaw);
    else setModalHourOverrideToDateHijri(nextRaw);

    const parsed = parseHijriDateInput(nextRaw);
    if (!parsed) {
      if (commit && nextRaw.trim()) {
        setErrorMsg("صيغة التاريخ الهجري يجب أن تكون: يوم/شهر/سنة (مثال: 09/09/1447).");
      }
      return;
    }
    const iso = isoFromHijriDateParts(parsed);
    if (!iso) {
      if (commit) {
        setErrorMsg("تعذر تحويل التاريخ الهجري. تأكد من إدخال تاريخ هجري صحيح.");
      }
      return;
    }
    if (target === "from") setModalHourOverrideFromGregorian(iso);
    else setModalHourOverrideToGregorian(iso);
    if (commit) setErrorMsg("");
  };

  const setModalHourOverrideRangeFromExisting = () => {
    const rows = normalizeWorkingHourOverrides(modalCustomHourOverrides);
    if (!rows.length) {
      setErrorMsg("لا توجد استثناءات حالية لتعديلها.");
      return false;
    }
    const first = rows[0];
    const last = rows[rows.length - 1];

    // Prefill by the most repeated schedule pattern among existing overrides.
    const patternMap = new Map<string, { count: number; row: StaffWorkingHourOverride }>();
    rows.forEach((row) => {
      const enabled = row.enabled !== false;
      const start = normalizeTimeHHMM(row.start) || "10:00";
      const end = normalizeTimeHHMM(row.end) || "22:00";
      const key = `${enabled ? "1" : "0"}|${start}|${end}`;
      const cur = patternMap.get(key);
      if (cur) {
        patternMap.set(key, { count: cur.count + 1, row: cur.row });
      } else {
        patternMap.set(key, { count: 1, row: { date: row.date, enabled, start, end } });
      }
    });
    let seed = first;
    let maxCount = -1;
    patternMap.forEach((entry) => {
      if (entry.count > maxCount) {
        maxCount = entry.count;
        seed = entry.row;
      }
    });

    setModalHourOverrideFromDate(first.date);
    setModalHourOverrideToDate(last.date);
    setModalHourOverrideHijriPickerOpen(false);
    setModalHourOverrideHijriPickerTarget("from");
    setModalHourOverrideHijriViewMonthISO(findHijriMonthStartIso(first.date));
    setModalHourOverrideEnabled(seed.enabled !== false);
    setModalHourOverrideStart(normalizeTimeHHMM(seed.start) || "10:00");
    setModalHourOverrideEnd(normalizeTimeHHMM(seed.end) || "22:00");
    setModalHourOverrideUpdateExistingOnly(true);
    setModalHourOverrideOverwriteExisting(true);
    setModalHourOverrideApplyWeekdays([]);
    return true;
  };

  const fillModalHourOverrideFromBaseDay = () => {
    const baseDate = normalizeLeaveUntil(modalHourOverrideFromDate) || todayIso();
    const dayKey = weekdayFromIso(baseDate);
    if (!dayKey) return;
    let enabled = true;
    let start = DEFAULT_OPEN_TIME;
    let end = DEFAULT_CLOSE_TIME;

    if (modalUseCustomWorkingHours) {
      const row = modalCustomWorkingHours[dayKey];
      if (row) {
        enabled = row.enabled !== false;
        start = normalizeTimeHHMM(row.start) || start;
        end = normalizeTimeHHMM(row.end) || end;
      }
    } else {
      const booking = (appSettings as any)?.booking || {};
      const businessHours = (booking as any)?.businessHours || {};
      const row = (businessHours as any)?.[dayKey];
      if (row) {
        enabled = row.enabled !== false;
        start = normalizeTimeHHMM(row.start) || start;
        end = normalizeTimeHHMM(row.end) || end;
      }
    }

    setModalHourOverrideEnabled(enabled);
    setModalHourOverrideStart(start);
    setModalHourOverrideEnd(end);
  };

  const cancelModalWorkingHourOverrideEdit = () => {
    setModalHourOverrideEditingGroupId("");
    setModalHourOverrideEditingDate("");
    setModalHourOverrideFromDate("");
    setModalHourOverrideToDate("");
    setModalHourOverrideHijriPickerOpen(false);
    setModalHourOverrideHijriPickerTarget("from");
    setModalHourOverrideHijriViewMonthISO(findHijriMonthStartIso(todayIso()));
    setModalHourOverrideStart("10:00");
    setModalHourOverrideEnd("22:00");
    setModalHourOverrideEnabled(true);
    setModalHourOverrideMode("single");
    setModalHourOverrideQuickMode("manual");
    setModalHourOverrideApplyMethod("replace");
    setModalHourOverrideNote("");
    setModalHourOverrideApplyWeekdays([]);
  };

  const startModalWorkingHourOverrideGroupEdit = (group: StaffWorkingHourOverrideGroup) => {
    if (!group) return;
    setModalHourOverrideEditingGroupId(group.id);
    setModalHourOverrideEditingDate("");
    setModalHourOverrideFromDate(group.fromDate);
    setModalHourOverrideToDate(group.toDate);
    setModalHourOverrideHijriPickerOpen(false);
    setModalHourOverrideHijriPickerTarget("from");
    setModalHourOverrideHijriViewMonthISO(findHijriMonthStartIso(group.fromDate));
    setModalHourOverrideEnabled(group.enabled !== false);
    setModalHourOverrideStart(normalizeTimeHHMM(group.start) || "10:00");
    setModalHourOverrideEnd(normalizeTimeHHMM(group.end) || "22:00");
    setModalHourOverrideMode(group.fromDate === group.toDate ? "single" : "range");
    setModalHourOverrideQuickMode("manual");
    setModalHourOverrideApplyMethod("replace");
    setModalHourOverrideNote(String(group.note || "").trim());
    setModalHourOverrideApplyWeekdays([]);
    setModalHourOverrideOverwriteExisting(true);
    setModalHourOverrideUpdateExistingOnly(true);
  };

  const removeModalWorkingHourOverrideGroup = (group: StaffWorkingHourOverrideGroup) => {
    const targetDates = new Set(
      (group?.dates || [])
        .map((d) => normalizeLeaveUntil(d))
        .filter((d): d is string => !!d)
    );
    if (!targetDates.size) return;
    setModalCustomHourOverrides((prev) =>
      prev.filter((x) => !targetDates.has(normalizeLeaveUntil(x.date)))
    );

    const editingDate = normalizeLeaveUntil(modalHourOverrideEditingDate);
    if (editingDate && targetDates.has(editingDate)) {
      cancelModalWorkingHourOverrideEdit();
      return;
    }

    if (!editingDate && modalHourOverrideUpdateExistingOnly) {
      const from = normalizeLeaveUntil(modalHourOverrideFromDate);
      const to = normalizeLeaveUntil(modalHourOverrideToDate) || from;
      if ((from && targetDates.has(from)) || (to && targetDates.has(to))) {
        cancelModalWorkingHourOverrideEdit();
      }
    }
  };

  const buildModalWorkingHourOverrides = (
    sourceOverrides: StaffWorkingHourOverride[]
  ): { next: StaffWorkingHourOverride[]; appliedCount: number; error?: string } => {
    const base = normalizeWorkingHourOverrides(sourceOverrides);
    const editingDate = normalizeLeaveUntil(modalHourOverrideEditingDate);
    if (editingDate) {
      const targetDate = normalizeLeaveUntil(modalHourOverrideFromDate) || editingDate;
      const start = normalizeTimeHHMM(modalHourOverrideStart) || "10:00";
      const end = normalizeTimeHHMM(modalHourOverrideEnd) || "22:00";
      const note = String(modalHourOverrideNote || "").trim() || undefined;
      return {
        next: normalizeWorkingHourOverrides([
          ...base.filter((x) => x.date !== editingDate && x.date !== targetDate),
          {
            date: targetDate,
            enabled: modalHourOverrideQuickMode === "closed" ? false : modalHourOverrideEnabled,
            start,
            end,
            ...(note ? { note } : {}),
          },
        ]),
        appliedCount: 1,
      };
    }

    const fromInput = normalizeLeaveUntil(modalHourOverrideFromDate);
    const toInput =
      modalHourOverrideMode === "single"
        ? fromInput
        : normalizeLeaveUntil(modalHourOverrideToDate) || fromInput;
    if (!fromInput) return { next: base, appliedCount: 0 };
    const from = fromInput <= toInput ? fromInput : toInput;
    const to = fromInput <= toInput ? toInput : fromInput;
    const start = normalizeTimeHHMM(modalHourOverrideStart) || "10:00";
    const end = normalizeTimeHHMM(modalHourOverrideEnd) || "22:00";
    const note = String(modalHourOverrideNote || "").trim() || undefined;
    const maxDays = 120;
    const rows: StaffWorkingHourOverride[] = [];
    let cursor = from;
    let guard = 0;
    while (cursor && cursor <= to) {
      const day = weekdayFromIso(cursor);
      const allowed =
        modalHourOverrideMode !== "specific" ||
        (!!day && modalHourOverrideApplyWeekdays.includes(day));
      if (allowed) {
        let rowStart = start;
        let rowEnd = end;
        let rowEnabled = modalHourOverrideEnabled;
        if (modalHourOverrideQuickMode === "closed") {
          rowEnabled = false;
        } else if (modalHourOverrideQuickMode === "plus1" || modalHourOverrideQuickMode === "plus2") {
          const plusMin = modalHourOverrideQuickMode === "plus1" ? 60 : 120;
          rowEnd = minutesToHHMM(toMinutes(end) + plusMin);
        }
        rows.push({
          date: cursor,
          enabled: rowEnabled,
          start: rowStart,
          end: rowEnd,
          ...(note ? { note } : {}),
        });
      }
      cursor = addDaysIso(cursor, 1);
      guard += 1;
      if (guard > maxDays) {
        return { next: base, appliedCount: 0, error: "نطاق التاريخ كبير جداً. الحد الأقصى 120 يوم." };
      }
    }
    if (rows.length === 0) {
      return { next: base, appliedCount: 0, error: "لا يوجد أيام مطابقة للفلاتر المختارة داخل النطاق." };
    }

    const rowsToApply = modalHourOverrideUpdateExistingOnly
      ? rows.filter((r) => base.some((x) => x.date === r.date))
      : rows;
    if (modalHourOverrideUpdateExistingOnly && rowsToApply.length === 0) {
      return { next: base, appliedCount: 0, error: "لا يوجد استثناءات حالية مطابقة للنطاق/الفلاتر لتعديلها." };
    }

    if (modalHourOverrideUpdateExistingOnly || modalHourOverrideApplyMethod === "replace") {
      return {
        next: normalizeWorkingHourOverrides([
          ...base.filter((x) => !rowsToApply.some((r) => r.date === x.date)),
          ...rowsToApply,
        ]),
        appliedCount: rowsToApply.length,
      };
    }

    const existing = new Set(base.map((x) => x.date));
    const toAdd = rowsToApply.filter((r) => !existing.has(r.date));
    return {
      next: normalizeWorkingHourOverrides([...base, ...toAdd]),
      appliedCount: toAdd.length,
    };
  };

  const addModalWorkingHourOverride = () => {
    const result = buildModalWorkingHourOverrides(modalCustomHourOverrides);
    if (result.error) {
      setErrorMsg(result.error);
      return;
    }
    if (result.appliedCount <= 0) {
      return;
    }
    setModalCustomHourOverrides(result.next);
    if (
      normalizeLeaveUntil(modalHourOverrideEditingDate) ||
      String(modalHourOverrideEditingGroupId || "").trim()
    ) {
      cancelModalWorkingHourOverrideEdit();
      return;
    }
    setModalHourOverrideFromDate("");
    setModalHourOverrideToDate("");
    setModalHourOverrideHijriPickerOpen(false);
    setModalHourOverrideHijriPickerTarget("from");
    setModalHourOverrideHijriViewMonthISO(findHijriMonthStartIso(todayIso()));
    setModalHourOverrideStart("10:00");
    setModalHourOverrideEnd("22:00");
    setModalHourOverrideEnabled(true);
    setModalHourOverrideMode("single");
    setModalHourOverrideQuickMode("manual");
    setModalHourOverrideApplyMethod("replace");
    setModalHourOverrideNote("");
    setModalHourOverrideEditingDate("");
    setModalHourOverrideEditingGroupId("");
    setModalHourOverrideUpdateExistingOnly(false);
  };

  const applyLeaveChange = async (mode: "add" | "deduct") => {
    if (authUser?.role !== "owner" || !editingStaff) return;
    const days = parsePositiveInt(leaveAdjustDays, 0);
    if (days <= 0) {
      setErrorMsg("اكتب عدد أيام صحيح.");
      return;
    }
    const opDate = String(leaveAdjustDate || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(opDate)) {
      setErrorMsg("اختر تاريخ العملية.");
      return;
    }

    const currentBalance = parsePositiveInt(String((editingStaff as any).leaveBalanceDays || 0), 0);
    const nextBalance = mode === "add" ? currentBalance + days : currentBalance - days;
    if (mode === "deduct" && nextBalance < 0) {
      setErrorMsg("لا يمكن خصم أكثر من الرصيد المتبقي.");
      return;
    }

    const currentEntries: LeaveEntry[] = Array.isArray((editingStaff as any).leaveEntries)
      ? ((editingStaff as any).leaveEntries as LeaveEntry[])
      : [];

    const entry: LeaveEntry = {
      id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      type: mode,
      days,
      date: opDate,
      note: leaveAdjustNote.trim(),
      createdAtIso: new Date().toISOString(),
      byUid: String(authUser.uid || ""),
      byName: String(authUser.displayName || authUser.email || ""),
    };

    const nextEntries = [entry, ...currentEntries].slice(0, 200);

    setLoading(true);
    setErrorMsg("");
    try {
      await updateDoc(staffPublicDoc(editingStaff.id), {
        leaveBalanceDays: nextBalance,
        leaveEntries: nextEntries,
        updatedAt: serverTimestamp(),
      } as any);

      setList((prev) =>
        prev.map((r) =>
          r.id === editingStaff.id
            ? ({ ...r, leaveBalanceDays: nextBalance, leaveEntries: nextEntries } as StaffPublicUi)
            : r
        )
      );

      setLeaveAdjustDays("1");
      setLeaveAdjustNote("");

      void writeAuditLog({
        action: "employee_updated",
        entityType: "employee",
        entityId: editingStaff.id,
        source: "dashboard",
        description: mode === "add" ? "إضافة رصيد إجازة للموظفة" : "خصم رصيد إجازة من الموظفة",
        before: { leaveBalanceDays: currentBalance },
        after: { leaveBalanceDays: nextBalance },
        meta: { leaveAction: mode, days, opDate, staffName: editingStaff.name },
      });
    } catch (e) {
      console.warn("leave change error:", e);
      setErrorMsg("تعذر حفظ حركة الإجازة.");
    } finally {
      setLoading(false);
    }
  };

  const saveEntitlementDate = async () => {
    if (authUser?.role !== "owner" || !editingStaff) return;
    const d = String(leaveEntitlementDate || "").trim();
    if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      setErrorMsg("تاريخ الاستحقاق غير صحيح.");
      return;
    }
    setLoading(true);
    setErrorMsg("");
    try {
      await updateDoc(staffPublicDoc(editingStaff.id), {
        leaveEntitlementDate: d || "",
        updatedAt: serverTimestamp(),
      } as any);
      setList((prev) =>
        prev.map((r) => (r.id === editingStaff.id ? ({ ...r, leaveEntitlementDate: d } as StaffPublicUi) : r))
      );
    } catch (e) {
      console.warn("save entitlement date error:", e);
      setErrorMsg("تعذر حفظ تاريخ الاستحقاق.");
    } finally {
      setLoading(false);
    }
  };

  if (!authUser) {
    return (
      <div className="emp-page-wrapper">
        <div className="container">
          <div className="dash-card">
            <h3>غير مصرح</h3>
            <p>سجّل دخول ثم جرّب.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!canManage) {
    return (
      <div className="emp-page-wrapper">
        <div className="container">
          <div className="dash-card">
            <h3>صلاحيات غير كافية</h3>
            <p>هذه الصفحة للإدارة فقط.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="emp-page-wrapper">
      <div className="container">
        <div className="dash-topbar dash-topbar--sticky">
          <div className="dash-topbar-title">
            <h2>
              <FontAwesomeIcon icon={faUserTie} /> إدارة الموظفات
            </h2>
            <p className="dash-sub">
              المصدر: <b>salons/main/staff_public</b>
            </p>
          </div>

          <div className="dash-topbar-actions">
            {authUser?.role === "owner" && (
              <button
                className="exp-btn ghost"
                onClick={fixBookingsEmployeeUid}
                title="إصلاح الحجوزات"
              >
                🔧 إصلاح
              </button>
            )}
            <button
              className="exp-btn"
              onClick={async () => {
                await loadServiceOptions();
                await load();
              }}
              disabled={loading}
              type="button"
            >
              <FontAwesomeIcon icon={faRotateRight} /> تحديث
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="alert alert-danger mt-3" style={{ borderRadius: 14 }}>
            {errorMsg}
          </div>
        )}

        <div className="emp-split-shell mt-3">
          <div className="emp-split-col emp-split-col--list">
        <div className="dash-card">
          <div className="dash-row">
            <div className="dash-field">
              <label className="emp-label">بحث</label>
              <input
                className="dash-input"
                value={qText}
                onChange={(e) => setQText(e.target.value)}
                placeholder="ابحث باسم الموظفة"
              />
            </div>
            <div className="dash-field">
              <label className="emp-label">الحالة</label>
              <select
                className="dash-select"
                value={onlyActive}
                onChange={(e) => setOnlyActive(e.target.value as "all" | "active" | "inactive")}
              >
                <option value="all">الكل</option>
                <option value="active">نشطة فقط</option>
                <option value="inactive">غير نشطة فقط</option>
              </select>
            </div>
            <div className="dash-field">
              <label className="emp-label">تصفية بالخدمة</label>
              <select
                className="dash-select"
                value={specialtyFilter}
                onChange={(e) => setSpecialtyFilter(e.target.value)}
              >
                <option value="all">كل الخدمات</option>
                {Array.from(new Set(serviceOptions.map((x) => String(x.id || "").trim()).filter(Boolean))).map(
                  (sid) => (
                    <option key={sid} value={sid}>
                      {serviceOptions.find((x) => String(x.id || "").trim() === sid)?.label || sid}
                    </option>
                  )
                )}
              </select>
            </div>
            <div className="dash-actions">
              <button
                className="exp-btn primary"
                type="button"
                onClick={() => {
                  resetForm();
                  setIsOpen(true);
                }}
              >
                إضافة موظفة
              </button>
            </div>
          </div>
        </div>

        <div className="dash-card mt-3">
          <div className="emp-list-title">
            <b>الموظفات ({filtered.length})</b>
            <span>موظفاتي</span>
          </div>
          {loading ? (
            <div className="emp-field-note">جاري تحميل الموظفات...</div>
          ) : filtered.length ? (
            <div className="emp-staff-list">
              {filtered.map((x) => {
                const specialtyIds = normalizeSpecialties(x.specialties);
                const mainService = serviceOptions.find((o) => o.id === specialtyIds[0]);
                const sectionId = String(mainService?.sectionId || "").trim();
                const department = sectionId
                  ? toArabicSectionLabel(
                      sectionId,
                      sectionOptions.find((s) => s.id === sectionId)?.label || ""
                    )
                  : "قسم غير محدد";
                const leaveUntil = normalizeLeaveUntil((x as any).leaveUntil);
                const leaveExpired = !!leaveUntil && leaveUntil < todayIso();
                const onLeave = !!(x as any).onLeave && !leaveExpired;
                const statusLabel = onLeave ? "في إجازة" : x.active ? "نشطة" : "غير نشطة";
                const statusClass = onLeave ? "warn" : x.active ? "on" : "off";
                const total = bookingStats[x.id]?.total ?? 0;
                const confirmed = bookingStats[x.id]?.byStatus.confirmed ?? 0;
                const kpi = total > 0 ? Math.round((confirmed / total) * 100) : 0;
                const kpiLabel = statsLoading ? "..." : `${kpi}%`;
                const isSelected = selectedEmployeeId === x.id;

                return (
                  <button
                    key={x.id}
                    type="button"
                    className={`emp-staff-row ${isSelected ? "is-selected" : ""}`}
                    onClick={() => openEdit(x)}
                  >
                    <div className="emp-staff-avatar">
                      {x.avatarUrl ? (
                        <img src={x.avatarUrl} alt={String(x.name || "صورة الموظفة")} />
                      ) : (
                        getNameInitials(String(x.name || ""))
                      )}
                    </div>

                    <div className="emp-staff-main">
                      <div className="emp-staff-headline">
                        <b>{x.name || "—"}</b>
                        <span className={`staff-pill ${statusClass}`}>{statusLabel}</span>
                      </div>
                      <div className="emp-staff-dept">{department}</div>
                    </div>

                    <div className="emp-staff-kpi">
                      <span>الأداء</span>
                      <b>{kpiLabel}</b>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="emp-field-note">لا توجد موظفات مطابقة للفلاتر الحالية.</div>
          )}
        </div>
          </div>

          <div className="emp-split-col emp-split-col--details">
            {!selectedEmployeeId ? (
              <div className="dash-card emp-split-empty">
                <b>لا توجد موظفة محددة</b>
                <p>اختاري موظفة من القائمة لعرض التفاصيل.</p>
              </div>
            ) : (
              <div className="dash-card emp-split-head-card">
                <div className="emp-split-head">
                  <div>
                    <b>{selectedEmployee?.name || "—"}</b>
                    <div className="emp-inline-actions">
                      <span className={`staff-pill ${selectedEmployeeStatusClass}`}>
                        {selectedEmployeeStatusLabel}
                      </span>
                    </div>
                  </div>
                  <div className="emp-inline-actions">
                    {mode === "edit" ? (
                      <>
                        <button
                          className="exp-btn primary sm"
                          type="button"
                          onClick={save}
                          disabled={loading}
                        >
                          حفظ
                        </button>
                        <button
                          className="exp-btn ghost sm"
                          type="button"
                          onClick={() => {
                            const currentTab = activeTab;
                            const currentModalTab = modalTab;
                            const currentStatsTab = activeStatsSubTab;
                            if (selectedEmployee) {
                              openEdit(selectedEmployee);
                              setActiveTab(currentTab);
                              setModalTab(currentModalTab);
                              setActiveStatsSubTab(currentStatsTab);
                            }
                            setMode("view");
                          }}
                        >
                          إلغاء
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          className="exp-btn ghost sm"
                          type="button"
                          onClick={() => setMode("edit")}
                        >
                          <FontAwesomeIcon icon={faPen} /> تعديل
                        </button>
                        <button
                          className="exp-btn ghost sm text-danger"
                          type="button"
                          onClick={() => selectedEmployeeId && remove(selectedEmployeeId)}
                        >
                          <FontAwesomeIcon icon={faTrash} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div className="emp-split-tabs">
                  <button
                    type="button"
                    className={`emp-split-tab ${activeTab === "basic" ? "active" : ""}`}
                    onClick={() => {
                      setActiveTab("basic");
                      setModalTab("basic");
                    }}
                  >
                    البيانات الأساسية
                  </button>
                  <button
                    type="button"
                    className={`emp-split-tab ${activeTab === "booking" ? "active" : ""}`}
                    onClick={() => {
                      setActiveTab("booking");
                      setModalTab("booking");
                    }}
                  >
                    الحجز والدوام
                  </button>
                  <button
                    type="button"
                    className={`emp-split-tab ${activeTab === "services" ? "active" : ""}`}
                    onClick={() => {
                      setActiveTab("services");
                      setModalTab("services");
                    }}
                  >
                    الخدمات
                  </button>
                  <button
                    type="button"
                    className={`emp-split-tab ${activeTab === "profile" ? "active" : ""}`}
                    onClick={() => {
                      setActiveTab("profile");
                      setModalTab("profile");
                    }}
                  >
                    الملف
                  </button>
                  <button
                    type="button"
                    className={`emp-split-tab ${activeTab === "payroll" ? "active" : ""}`}
                    onClick={() => {
                      setActiveTab("payroll");
                      setActiveStatsSubTab("payroll");
                      setModalTab("stats");
                    }}
                  >
                    الراتب والأوفر تايم
                  </button>
                  <button
                    type="button"
                    className={`emp-split-tab ${activeTab === "stats" ? "active" : ""}`}
                    onClick={() => {
                      setActiveTab("stats");
                      setActiveStatsSubTab("stats");
                      setModalTab("stats");
                    }}
                  >
                    الإحصائيات والإجازات
                  </button>
                </div>
              </div>
            )}

        {isOpen && (
          <Modal
            open={isOpen}
            onClose={closeModal}
            ariaLabel="محرر الموظفة"
            size="lg"
            panelClassName="emp-modal"
            inline
            closeOnOverlayClick={false}
          >
            {!selectedEmployeeId && (
            <div className="modal-head">
              <h3>{editId ? `تعديل موظفة - ${editingStaff?.name || name || "-"}` : "إضافة موظفة"}</h3>
              <button className="exp-btn ghost sm" type="button" onClick={closeModal}>
                <FontAwesomeIcon icon={faXmark} />
              </button>
            </div>
            )}
            {!selectedEmployeeId && (
            <div className="emp-modal-tabs">
              {modalTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  className={`emp-modal-tab ${modalTab === tab.key ? "active" : ""}`}
                  onClick={() => setModalTab(tab.key)}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            )}
            <fieldset
              className="emp-inline-fieldset"
              disabled={!!selectedEmployeeId && mode !== "edit"}
            >
            <div className="modal-body emp-modal-grid">
              {modalStaffScheduleSummary && modalTab === "basic" ? (
                <div className="emp-modal-live-summary">
                  <div className="emp-modal-live-summary-head">
                    <b>ملخص الدوام الفعلي اليوم للموظفة</b>
                    <span className="emp-modal-live-summary-stamp">
                      {new Date(nowTick).toLocaleString("ar-SA", {
                        year: "numeric",
                        month: "2-digit",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <div className="emp-modal-live-summary-top">
                    <span className="emp-modal-live-summary-name">{modalStaffScheduleSummary.name}</span>
                    <span
                      className={`emp-modal-live-status emp-modal-live-status-${
                        modalStaffScheduleSummary.statusTone || "muted"
                      }`}
                    >
                      {modalStaffScheduleSummary.statusNowLabel}
                    </span>
                  </div>
                  <div className="emp-modal-live-calendar-grid">
                    <span className="emp-modal-live-calendar-chip emp-modal-live-calendar-chip-greg">
                      {modalStaffScheduleSummary.todayDateGregorianLabel}
                    </span>
                    <span className="emp-modal-live-calendar-chip emp-modal-live-calendar-chip-hijri">
                      {modalStaffScheduleSummary.todayDateHijriLabel}
                    </span>
                  </div>

                  <div className="emp-modal-live-grid">
                    <div className="emp-modal-live-card">
                      <span className="emp-modal-live-label">الدوام الرسمي (أسبوعي)</span>
                      <b>{modalStaffScheduleSummary.salonWeeklyWindowLabel}</b>
                      <span className="emp-modal-live-note">{modalStaffScheduleSummary.salonWeeklyDetails}</span>
                    </div>
                    <div className="emp-modal-live-card">
                      <span className="emp-modal-live-label">دوام الحجز الفعلي اليوم</span>
                      <b>{modalStaffScheduleSummary.salonEffectiveWindowLabel}</b>
                      <span className="emp-modal-live-note">{modalStaffScheduleSummary.salonEffectiveDetails}</span>
                    </div>
                    <div className="emp-modal-live-card">
                      <span className="emp-modal-live-label">دوام الموظفة الأساسي</span>
                      <b>{modalStaffScheduleSummary.staffBaseWindowLabel}</b>
                      <span className="emp-modal-live-note">{modalStaffScheduleSummary.staffBaseDetails}</span>
                    </div>
                    <div className="emp-modal-live-card">
                      <span className="emp-modal-live-label">استثناء دوام الموظفة</span>
                      <b>{modalStaffScheduleSummary.staffOverrideLabel}</b>
                      <span className="emp-modal-live-note">{modalStaffScheduleSummary.staffOverrideDetails}</span>
                    </div>
                    <div className="emp-modal-live-card">
                      <span className="emp-modal-live-label">أيام الإجازة الأسبوعية</span>
                      <b>{modalStaffScheduleSummary.leaveDaysLabel}</b>
                      <span className="emp-modal-live-note">{modalStaffScheduleSummary.leaveDaysDetails}</span>
                    </div>
                    <div className="emp-modal-live-card emp-modal-live-card-wide">
                      <span className="emp-modal-live-label">مصدر الدوام الفعلي</span>
                      <b>{modalStaffScheduleSummary.salonSourceLabel}</b>
                      {Array.isArray((modalStaffScheduleSummary as any).salonSourceDetails?.groups) &&
                      (modalStaffScheduleSummary as any).salonSourceDetails.groups.length ? (
                        <div className="emp-modal-live-source-groups">
                          {(modalStaffScheduleSummary as any).salonSourceDetails.groups.map(
                            (group: any, idx: number) => (
                              <div
                                key={`modal_source_${group?.title || "source"}_${idx}`}
                                className={`emp-modal-live-source-group ${
                                  group?.tone === "active" ? "emp-modal-live-source-group-active" : ""
                                }`}
                              >
                                <div className="emp-modal-live-source-group-title">
                                  {group?.title || "مصدر الدوام"}
                                </div>
                                <div className="emp-modal-live-calendar-grid">
                                  <span className="emp-modal-live-calendar-chip emp-modal-live-calendar-chip-greg">
                                    م: {group?.gregorian || "-"}
                                  </span>
                                  <span className="emp-modal-live-calendar-chip emp-modal-live-calendar-chip-hijri">
                                    هـ: {group?.hijri || "-"}
                                  </span>
                                </div>
                                {Array.isArray(group?.details) && group.details.length ? (
                                  <ul className="emp-modal-live-list">
                                    {group.details.map((detail: string, detailIdx: number) => (
                                      <li key={`modal_source_detail_${idx}_${detailIdx}`}>{detail}</li>
                                    ))}
                                  </ul>
                                ) : null}
                              </div>
                            )
                          )}
                        </div>
                      ) : Array.isArray((modalStaffScheduleSummary as any).salonSourceDetails?.notes) &&
                        (modalStaffScheduleSummary as any).salonSourceDetails.notes.length ? (
                        <ul className="emp-modal-live-list">
                          {(modalStaffScheduleSummary as any).salonSourceDetails.notes.map(
                            (note: string, noteIdx: number) => (
                              <li key={`modal_source_note_${noteIdx}`}>{note}</li>
                            )
                          )}
                        </ul>
                      ) : (
                        <span className="emp-modal-live-empty">لا توجد تفاصيل إضافية.</span>
                      )}
                    </div>
                    <div className="emp-modal-live-card emp-modal-live-card-wide">
                      <span className="emp-modal-live-label">التنبيهات</span>
                      {modalStaffScheduleSummary.warnings.length ? (
                        <ul className="emp-modal-live-list emp-modal-live-list-warning">
                          {modalStaffScheduleSummary.warnings.map((w, idx) => (
                            <li key={`modal_warning_${idx}`}>{w}</li>
                          ))}
                        </ul>
                      ) : (
                        <div className="emp-modal-live-ok">لا توجد إجازة حالية أو قريبة</div>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
              {editingStaff ? (
                <div className={`emp-modal-section ${modalTab !== "stats" ? "is-hidden" : ""}`}>
                  <b className="emp-modal-section-title">الإحصائيات والإجازات</b>
                  {showPayrollSubTab ? (
                  <div className="staff-payroll-box">
                    <div className="staff-payroll-head">
                      <b>الراتب + الأوفر تايم</b>
                      <span>يدخل تلقائيًا ضمن المصروفات والتقارير</span>
                    </div>
                    <div className="staff-payroll-form">
                      <div className="dash-field">
                        <label className="emp-label">الراتب الشهري (ريال)</label>
                        <input
                          className="dash-input"
                          type="number"
                          min={0}
                          step="0.01"
                          value={monthlySalary}
                          disabled={loading}
                          onChange={(e) => setMonthlySalary(e.target.value)}
                          placeholder="مثال: 5000"
                        />
                      </div>
                      <div className="dash-field">
                        <label className="emp-label">طريقة احتساب الأوفر تايم</label>
                        <select
                          className="dash-select"
                          value={overtimeMethod}
                          disabled={loading}
                          onChange={(e) => setOvertimeMethod(e.target.value as StaffPayrollMethod)}
                        >
                          <option value="hours_from_salary">من الراتب + الساعات الإضافية</option>
                          <option value="invoice_percentage">نسبة من فواتير الموظفة</option>
                        </select>
                      </div>
                      {overtimeMethod === "hours_from_salary" ? (
                        <>
                          <div className="dash-field">
                            <label className="emp-label">عدد الأيام للتقسيم الشهري</label>
                            <input
                              className="dash-input"
                              type="number"
                              min={1}
                              step={1}
                              value={overtimeDaysPerMonth}
                              disabled={loading}
                              onChange={(e) => setOvertimeDaysPerMonth(e.target.value)}
                              placeholder="مثال: 30"
                            />
                          </div>
                          <div className="dash-field">
                            <label className="emp-label">الساعات الأساسية اليومية (العادي)</label>
                            <input
                              className="dash-input"
                              type="number"
                              min={1}
                              step="0.25"
                              value={overtimeBaseHoursPerDay}
                              disabled={loading}
                              onChange={(e) => setOvertimeBaseHoursPerDay(e.target.value)}
                              placeholder="مثال: 8"
                            />
                          </div>
                          <div className="dash-field">
                            <label className="emp-label">الساعات الأساسية اليومية (الموسم)</label>
                            <input
                              className="dash-input"
                              type="number"
                              min={1}
                              step="0.25"
                              value={overtimeSeasonBaseHoursPerDay}
                              disabled={loading}
                              onChange={(e) => setOvertimeSeasonBaseHoursPerDay(e.target.value)}
                              placeholder="مثال: 6"
                            />
                          </div>
                          <div className="dash-field">
                            <label className="emp-label">أساس حساب الأوفر تايم</label>
                            <select
                              className="dash-select"
                              value={overtimeHoursBasis}
                              disabled={loading}
                              onChange={(e) =>
                                setOvertimeHoursBasis(
                                  e.target.value === "season" ? "season" : "regular"
                                )
                              }
                            >
                              <option value="regular">الأيام العادية</option>
                              <option value="season">الموسم</option>
                            </select>
                          </div>
                          <div className="dash-field">
                            <label className="emp-label">نسبة زيادة الأوفر تايم (%)</label>
                            <input
                              className="dash-input"
                              type="number"
                              min={0}
                              step="0.01"
                              value={overtimePercent}
                              disabled={loading}
                              onChange={(e) => setOvertimePercent(e.target.value)}
                              placeholder="مثال: 25"
                            />
                          </div>
                        </>
                      ) : (
                        <div className="dash-field">
                          <label className="emp-label">نسبة الأوفر تايم من فواتير الموظفة (%)</label>
                          <input
                            className="dash-input"
                            type="number"
                            min={0}
                            step="0.01"
                            value={overtimeInvoicePercent}
                            disabled={loading}
                            onChange={(e) => setOvertimeInvoicePercent(e.target.value)}
                            placeholder="مثال: 40"
                          />
                        </div>
                      )}
                    </div>
                    <div className="staff-payroll-preview">
                      <div className="staff-payroll-preview-grid">
                        <div className="staff-payroll-chip">
                          <span>إجمالي الراتب الشهري</span>
                          <b>{fmtMoneySar(modalPayrollMonthSummary?.salaryAmount || 0)} ر.س</b>
                        </div>
                        <div className="staff-payroll-chip">
                          <span>مبلغ الأوفر تايم</span>
                          <b>{fmtMoneySar(modalPayrollMonthSummary?.overtimeAmount || 0)} ر.س</b>
                        </div>
                        <div className="staff-payroll-chip accent">
                          <span>إجمالي المستحق الشهري</span>
                          <b>{fmtMoneySar(modalPayrollMonthSummary?.totalAmount || 0)} ر.س</b>
                        </div>
                        <div className="staff-payroll-chip">
                          <span>ساعات الدوام المجدولة</span>
                          <b>{fmtMoneySar(modalPayrollMonthSummary?.schedule.scheduledHours || 0)} ساعة</b>
                        </div>
                        <div className="staff-payroll-chip">
                          <span>الساعات الأساسية المحتسبة</span>
                          <b>{fmtMoneySar(modalPayrollMonthSummary?.schedule.baselineHours || 0)} ساعة</b>
                        </div>
                        <div className="staff-payroll-chip">
                          <span>أساس الحساب</span>
                          <b>
                            {modalPayrollMonthSummary?.config.hoursBasis === "season"
                              ? "الموسم"
                              : "الأيام العادية"}
                          </b>
                        </div>
                        <div className="staff-payroll-chip">
                          <span>ساعات الأوفر تايم</span>
                          <b>{fmtMoneySar(modalPayrollMonthSummary?.schedule.overtimeHours || 0)} ساعة</b>
                        </div>
                      </div>
                      <div className="staff-payroll-note">
                        {modalPayrollMonthSummary?.method === "invoice_percentage"
                          ? `طريقة الحساب: نسبة من الفواتير (${modalPayrollMonthSummary.config.invoicePercent}%).`
                          : `طريقة الحساب: (الراتب ÷ ${modalPayrollMonthSummary?.config.daysPerMonth || 0} يوم ÷ ${
                              modalPayrollMonthSummary?.config.hoursBasis === "season"
                                ? modalPayrollMonthSummary?.config.seasonBaseHoursPerDay || 0
                                : modalPayrollMonthSummary?.config.baseHoursPerDay || 0
                            } ساعة) ثم تطبيق نسبة ${
                              modalPayrollMonthSummary?.config.overtimePercent || 0
                            }% على ساعات الأوفر تايم.`}
                      </div>
                      <div className="staff-payroll-note">
                        {`أساس الحساب المعتمد: ${
                          modalPayrollMonthSummary?.config.hoursBasis === "season"
                            ? "الموسم"
                            : "الأيام العادية"
                        } | الساعات المستخدمة يوميًا: ${
                          modalPayrollMonthSummary?.config.hoursBasis === "season"
                            ? modalPayrollMonthSummary?.config.seasonBaseHoursPerDay || 0
                            : modalPayrollMonthSummary?.config.baseHoursPerDay || 0
                        } ساعة.`}
                      </div>
                      <div className="staff-payroll-note">
                        {`الشهر المحتسب: ${modalPayrollMonthSummary?.monthKey || currentMonthKey()} | فواتير الموظفة: ${
                          modalPayrollMonthSummary?.invoiceCount || 0
                        } | إيرادها: ${fmtMoneySar(modalPayrollMonthSummary?.invoiceRevenue || 0)} ر.س`}
                      </div>
                    </div>
                  </div>
                  ) : null}

                  {showPayrollSubTab && modalPayrollMonthSummary ? (
                    <div className="staff-payroll-note">
                      {`تفصيل الساعات المجدولة (ديناميكي): من ${
                        modalPayrollMonthSummary.schedule.periodFrom || "-"
                      } إلى ${
                        modalPayrollMonthSummary.schedule.periodTo || "-"
                      } | الأيام المحتسبة: ${fmtMoneySar(
                        modalPayrollMonthSummary.schedule.workedDays || 0
                      )} | متوسط ساعات اليوم: ${fmtMoneySar(
                        modalPayrollMonthSummary.schedule.averageHoursPerWorkedDay || 0
                      )} ساعة | التوزيع: ${formatDailyHourBucketsLabel(
                        modalPayrollMonthSummary.schedule.dailyHourBuckets as any
                      )}`}
                    </div>
                  ) : null}

                  {showStatsSubTab ? (
                  <div className="staff-leave-box">
                    <div className="staff-leave-head">
                      <span>إعدادات الإجازات للموظفة</span>
                      <b>{parsePositiveInt(String((editingStaff as any).leaveBalanceDays || 0), 0)} يوم</b>
                    </div>

                    <div className="staff-leave-settings-grid">
                      <div className="dash-field">
                        <label className="emp-label emp-check-label">
                          <input
                            type="checkbox"
                            checked={modalOnLeave}
                            disabled={loading}
                            onChange={(e) => setModalOnLeave(e.target.checked)}
                          />
                          في إجازة الآن
                        </label>
                      </div>

                      <div className="dash-field">
                        <label className="emp-label">تاريخ العودة</label>
                        <input
                          className="dash-input"
                          type="date"
                          value={modalLeaveUntil}
                          disabled={loading}
                          onChange={(e) => setModalLeaveUntil(e.target.value)}
                        />
                      </div>

                      <div className="dash-field staff-leave-settings-wide">
                        <label className="emp-label">ملاحظة الإجازة (اختياري)</label>
                        <input
                          className="dash-input"
                          value={modalLeaveNote}
                          disabled={loading}
                          onChange={(e) => setModalLeaveNote(e.target.value)}
                          placeholder="مثال: عودة يوم الأحد"
                        />
                      </div>

                      <div className="dash-field staff-leave-settings-wide">
                        <label className="emp-label">الإجازة الأسبوعية الثابتة</label>
                        <div className="emp-inline-actions">
                          <select
                            className="dash-select"
                            value={String(modalLeaveWeekdayDraft || "")}
                            disabled={loading}
                            onChange={(e) => setModalLeaveWeekdayDraft(e.target.value as WeekdayKey | "")}
                          >
                            <option value="">اختاري اليوم</option>
                            {WEEKDAY_OPTIONS.map((d) => (
                              <option key={`modal_leave_day_${d.key}`} value={d.key}>
                                {d.label}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className="exp-btn ghost sm"
                            disabled={loading || !normalizeWeekdayKey(modalLeaveWeekdayDraft)}
                            onClick={() => {
                              const next = normalizeWeekdayKey(modalLeaveWeekdayDraft);
                              if (!next) return;
                              setModalExceptionalLeaveWeekdays((prev) =>
                                normalizeExceptionalLeaveWeekdays([...prev, next])
                              );
                              setModalLeaveWeekdayDraft("");
                            }}
                          >
                            إضافة اليوم
                          </button>
                        </div>

                        {modalExceptionalLeaveWeekdays.length > 0 ? (
                          <div className="emp-tags-row">
                            {modalExceptionalLeaveWeekdays.map((d) => (
                              <button
                                key={`modal_leave_chip_${d}`}
                                type="button"
                                className="exp-btn ghost sm"
                                disabled={loading}
                                onClick={() =>
                                  setModalExceptionalLeaveWeekdays((prev) =>
                                    prev.filter((day) => day !== d)
                                  )
                                }
                                title="حذف يوم الإجازة الثابتة"
                              >
                                {WEEKDAY_OPTIONS.find((x) => x.key === d)?.label || d} ×
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="emp-field-note">لا توجد أيام إجازة أسبوعية ثابتة.</div>
                        )}
                      </div>
                    </div>

                    {modalLeaveExpired ? (
                      <div className="emp-field-note danger">
                        تاريخ الإجازة انتهى؛ بعد الحفظ سيتم اعتبار الموظفة غير مجازة.
                      </div>
                    ) : null}

                    <div className="staff-leave-head">
                      <span>تاريخ الاستحقاق القادم</span>
                      <div>
                        <input
                          className="dash-input"
                          type="date"
                          value={leaveEntitlementDate}
                          onChange={(e) => setLeaveEntitlementDate(e.target.value)}
                        />
                        <button
                          className="exp-btn"
                          type="button"
                          onClick={saveEntitlementDate}
                          disabled={loading}
                        >
                          حفظ الاستحقاق
                        </button>
                      </div>
                    </div>

                    {authUser?.role === "owner" ? (
                      <div className="staff-leave-controls">
                        <input
                          className="dash-input staff-leave-input"
                          type="number"
                          min={1}
                          step={1}
                          value={leaveAdjustDays}
                          onChange={(e) => setLeaveAdjustDays(e.target.value)}
                          placeholder="عدد الأيام"
                        />
                        <input
                          className="dash-input"
                          type="date"
                          value={leaveAdjustDate}
                          onChange={(e) => setLeaveAdjustDate(e.target.value)}
                        />
                        <input
                          className="dash-input"
                          value={leaveAdjustNote}
                          onChange={(e) => setLeaveAdjustNote(e.target.value)}
                          placeholder="ملاحظة (اختياري)"
                        />
                        <button
                          className="exp-btn primary"
                          type="button"
                          disabled={loading}
                          onClick={() => applyLeaveChange("add")}
                        >
                          إضافة رصيد
                        </button>
                        <button
                          className="exp-btn ghost"
                          type="button"
                          disabled={loading}
                          onClick={() => applyLeaveChange("deduct")}
                        >
                          تسجيل إجازة (خصم)
                        </button>
                      </div>
                    ) : null}

                    <div className="leave-log-list">
                      <div className="leave-log-title">سجل الإجازات</div>
                      {(Array.isArray((editingStaff as any).leaveEntries)
                        ? (editingStaff as any).leaveEntries
                        : []
                      )
                        .slice()
                        .sort((a: LeaveEntry, b: LeaveEntry) =>
                          String(b.createdAtIso || "").localeCompare(String(a.createdAtIso || ""))
                        )
                        .slice(0, 12)
                        .map((entry: LeaveEntry) => (
                          <div className="leave-log-row" key={entry.id}>
                            <span className={`leave-log-type ${entry.type === "deduct" ? "deduct" : "add"}`}>
                              {entry.type === "deduct" ? "إجازة" : "إضافة"}
                            </span>
                            <span className="leave-log-days">{entry.days} يوم</span>
                            <span className="leave-log-date">{fmtIsoDate(entry.date)}</span>
                            <span className="leave-log-note">{String(entry.note || "-")}</span>
                          </div>
                        ))}
                      {!Array.isArray((editingStaff as any).leaveEntries) ||
                      (editingStaff as any).leaveEntries.length === 0 ? (
                        <div className="leave-log-empty">لا يوجد سجل إجازات حتى الآن.</div>
                      ) : null}
                    </div>
                  </div>
                  ) : null}
                </div>
              ) : null}

              <div className={`emp-modal-section ${modalTab !== "basic" ? "is-hidden" : ""}`}>
                <b className="emp-modal-section-title">المعلومات الأساسية</b>

                <div className="emp-modal-fields two-cols">
  <div className="dash-field">
    <label className="emp-label">اسم الموظفة</label>
    <input
      className="dash-input"
      value={name}
      onChange={(e) => setName(e.target.value)}
      placeholder="مثال: حنان"
    />
  </div>

  <div className="dash-field">
    <label className="emp-label">الحالة</label>
    <select
      className="dash-select"
      value={active ? "1" : "0"}
      onChange={(e) => setActive(e.target.value === "1")}
    >
      <option value="1">نشطة</option>
      <option value="0">غير نشطة</option>
    </select>
  </div>

  {/* ✅ يظهر في صفحة "من نحن" */}
  <div className="dash-field">
    <label className="emp-label">يظهر في صفحة "من نحن"؟</label>
    <select
      className="dash-select"
      value={showOnAbout ? "1" : "0"}
      onChange={(e) => setShowOnAbout(e.target.value === "1")}
    >
      <option value="1">نعم (يظهر)</option>
      <option value="0">لا (مخفي)</option>
    </select>
  </div>

  {/* ✅ يظهر في صفحة "الحجز" */}
  <div className="dash-field">
    <label className="emp-label">تظهر في صفحة "الحجز"؟</label>
    <select
      className="dash-select"
      value={showOnBooking ? "1" : "0"}
      onChange={(e) => setShowOnBooking(e.target.value === "1")}
    >
      <option value="1">نعم (تظهر)</option>
      <option value="0">لا (مخفية)</option>
    </select>
  </div>

</div>
              </div>

              <div className={`emp-modal-section ${modalTab !== "booking" ? "is-hidden" : ""}`}>
                <b className="emp-modal-section-title">إعدادات الحجز لهذه الموظفة</b>
                <div className="emp-modal-fields emp-booking-settings">
                  <div className="emp-booking-subtitle">حالة التوظيف</div>
                  <div className="dash-field booking-card booking-full">
                  <label className="emp-label">آخر يوم دوام (في الصالون) – استقالة أو موظفة موسمية</label>                    <input
                      className="dash-input"
                      type="date"
                      value={employmentEndDate}
                      disabled={loading}
                      onChange={(e) => setEmploymentEndDate(e.target.value)}
                    />
                    <div className="emp-field-note danger">
                      بعد هذا التاريخ لن تظهر الموظفة نهائيًا في صفحة الحجز.
                    </div>
                  </div>

                  <div className="emp-booking-subtitle">ساعات الدوام الخاصة</div>
                  <div className="dash-field booking-card booking-full">
                    <label className="emp-label emp-check-label">
                      <input
                        type="checkbox"
                        checked={modalUseCustomWorkingHours}
                        disabled={loading}
                        onChange={(e) => setModalUseCustomWorkingHours(e.target.checked)}
                      />
                      ساعات عمل خاصة لهذه الموظفة
                    </label>
                  </div>

                  {modalUseCustomWorkingHours ? (
                    <div className="dash-field booking-card booking-full emp-working-hours-block">
                      <label className="emp-label">الساعات الأسبوعية</label>
                      <div className="emp-field-note">
                        عدلي يوم واحد ثم اضغطي "نسخ لكل الأيام" لتطبيق نفس الإعداد على كل الأسبوع.
                      </div>
                      <div className="emp-working-week-grid">
                        {WEEKDAY_OPTIONS.map((d) => {
                          const row = modalCustomWorkingHours[d.key] || {
                            enabled: true,
                            start: "10:00",
                            end: "22:00",
                          };
                          return (
                            <div key={`work_${d.key}`} className="emp-working-day-row">
                              <div className="emp-working-day-name">{d.label}</div>
                              <label className="emp-mini-check">
                                <input
                                  type="checkbox"
                                  checked={row.enabled !== false}
                                  disabled={loading}
                                  onChange={(e) =>
                                    updateModalWorkingDay(d.key, { enabled: e.target.checked })
                                  }
                                />
                                <span>دوام</span>
                              </label>
                              <input
                                className="dash-input"
                                type="time"
                                value={normalizeTimeHHMM(row.start) || "10:00"}
                                disabled={loading || row.enabled === false}
                                onChange={(e) =>
                                  updateModalWorkingDay(d.key, { start: e.target.value })
                                }
                              />
                              <input
                                className="dash-input"
                                type="time"
                                value={normalizeTimeHHMM(row.end) || "22:00"}
                                disabled={loading || row.enabled === false}
                                onChange={(e) =>
                                  updateModalWorkingDay(d.key, { end: e.target.value })
                                }
                              />
                              <button
                                type="button"
                                className="exp-btn ghost sm emp-working-copy-btn"
                                disabled={loading}
                                onClick={() => copyModalWorkingDayToAll(d.key)}
                                title={`نسخ ساعات ${d.label} لكل الأيام`}
                              >
                                نسخ لكل الأيام
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}

                  {modalUseCustomWorkingHours ? (
                    <div className="dash-field booking-card booking-full emp-working-override-block">
                      <label className="emp-label">استثناء ساعات يوم محدد</label>
                        <div className="emp-working-override-grid">
                          <div className="emp-working-override-tools">
                            <div className="emp-working-override-mode-tabs">
                              <button
                                type="button"
                                className={`exp-btn ghost sm ${modalHourOverrideMode === "single" ? "is-active" : ""}`}
                                disabled={loading || !!modalHourOverrideEditingDate || !!modalHourOverrideEditingGroupId}
                                onClick={() => {
                                  setModalHourOverrideEditingGroupId("");
                                  setModalHourOverrideMode("single");
                                }}
                              >
                                تعديل يوم واحد
                              </button>
                              <button
                                type="button"
                                className={`exp-btn ghost sm ${modalHourOverrideMode === "range" ? "is-active" : ""}`}
                                disabled={loading || !!modalHourOverrideEditingDate || !!modalHourOverrideEditingGroupId}
                                onClick={() => {
                                  setModalHourOverrideEditingGroupId("");
                                  setModalHourOverrideMode("range");
                                }}
                              >
                                تعديل فترة
                              </button>
                              <button
                                type="button"
                                className={`exp-btn ghost sm ${modalHourOverrideMode === "specific" ? "is-active" : ""}`}
                                disabled={loading || !!modalHourOverrideEditingDate || !!modalHourOverrideEditingGroupId}
                                onClick={() => {
                                  setModalHourOverrideEditingGroupId("");
                                  setModalHourOverrideMode("specific");
                                }}
                              >
                                أيام محددة
                              </button>
                            </div>
                            <div className="emp-working-override-presets">
                              <button
                                type="button"
                                className="exp-btn ghost sm"
                                disabled={loading}
                              onClick={fillModalHourOverrideFromBaseDay}
                            >
                              نسخ ساعات يوم البداية
                            </button>
                            <button
                              type="button"
                              className={`exp-btn ghost sm ${modalHourOverrideQuickMode === "full" ? "is-active" : ""}`}
                              disabled={loading}
                              onClick={() => {
                                fillModalHourOverrideFromBaseDay();
                                setModalHourOverrideQuickMode("full");
                              }}
                            >
                              دوام كامل
                            </button>
                            <button
                              type="button"
                              className={`exp-btn ghost sm ${modalHourOverrideQuickMode === "closed" ? "is-active" : ""}`}
                              disabled={loading}
                              onClick={() => setModalHourOverrideQuickMode("closed")}
                            >
                              إغلاق
                            </button>
                            <button
                              type="button"
                              className={`exp-btn ghost sm ${modalHourOverrideQuickMode === "plus1" ? "is-active" : ""}`}
                              disabled={loading}
                              onClick={() => setModalHourOverrideQuickMode("plus1")}
                            >
                              +1 ساعة
                            </button>
                            <button
                              type="button"
                              className={`exp-btn ghost sm ${modalHourOverrideQuickMode === "plus2" ? "is-active" : ""}`}
                              disabled={loading}
                              onClick={() => setModalHourOverrideQuickMode("plus2")}
                            >
                              +2 ساعة
                            </button>
                            <button
                              type="button"
                              className={`exp-btn ghost sm ${modalHourOverrideQuickMode === "manual" ? "is-active" : ""}`}
                              disabled={loading}
                              onClick={() => setModalHourOverrideQuickMode("manual")}
                            >
                              يدوي
                            </button>
                            <button
                              type="button"
                              className="exp-btn ghost sm"
                              disabled={loading}
                              onClick={() => {
                                setModalHourOverrideQuickMode("manual");
                                setModalHourOverrideEnabled(true);
                                setModalHourOverrideStart("10:00");
                                setModalHourOverrideEnd("16:00");
                              }}
                            >
                              رمضان 6 ساعات
                            </button>
                            <button
                              type="button"
                              className="exp-btn ghost sm"
                              disabled={loading}
                              onClick={() => {
                                setModalHourOverrideQuickMode("manual");
                                setModalHourOverrideEnabled(true);
                                setModalHourOverrideStart("10:00");
                                setModalHourOverrideEnd("18:00");
                              }}
                            >
                              موسم 8 ساعات
                            </button>
                            <label
                              className={`emp-mini-check emp-ov-apply-method-row ${!modalHourOverrideUpdateExistingOnly ? "is-active" : ""}`}
                            >
                              <input
                                type="radio"
                                name="overrideApplyMethod"
                                checked={!modalHourOverrideUpdateExistingOnly}
                                disabled={loading}
                                onChange={() => {
                                  setModalHourOverrideApplyMethod("replace");
                                  setModalHourOverrideOverwriteExisting(true);
                                  setModalHourOverrideUpdateExistingOnly(false);
                                }}
                              />
                              <span>استبدال أي استثناء موجود في نفس التاريخ</span>
                            </label>
                            <label
                              className={`emp-mini-check emp-ov-apply-method-row ${modalHourOverrideUpdateExistingOnly ? "is-active" : ""}`}
                            >
                              <input
                                type="radio"
                                name="overrideApplyMethod"
                                checked={modalHourOverrideUpdateExistingOnly}
                                disabled={loading}
                                onChange={() => {
                                  const ok = setModalHourOverrideRangeFromExisting();
                                  if (!ok) return;
                                  setModalHourOverrideApplyMethod("replace");
                                  setModalHourOverrideOverwriteExisting(true);
                                  setModalHourOverrideUpdateExistingOnly(true);
                                }}
                              />
                              <span>تعديل الاستثناءات الحالية فقط</span>
                            </label>
                          </div>
                        </div>

                        <div className="emp-working-override-form">
                          <div className="emp-ov-field emp-ov-calendar-toggle">
                            <label className="emp-label">نوع التاريخ</label>
                            <div
                              className="emp-ov-calendar-toggle-buttons"
                              role="group"
                              aria-label="نوع التاريخ"
                            >
                              <button
                                type="button"
                                className={`exp-btn ghost sm ${modalHourOverrideCalendar === "gregory" ? "is-active" : ""}`}
                                disabled={loading}
                                onClick={() => {
                                  setModalHourOverrideCalendar("gregory");
                                  setModalHourOverrideHijriPickerOpen(false);
                                }}
                              >
                                ميلادي
                              </button>
                              <button
                                type="button"
                                className={`exp-btn ghost sm ${modalHourOverrideCalendar === "hijri" ? "is-active" : ""}`}
                                disabled={loading}
                                onClick={() => {
                                  setModalHourOverrideCalendar("hijri");
                                  openModalHourOverrideHijriPicker("from");
                                }}
                              >
                                هجري
                              </button>
                            </div>
                            <div className="emp-field-note">
                              {modalHourOverrideCalendar === "hijri"
                                ? "اختاري التاريخ مباشرة من التقويم، ويمكنك أيضا الكتابة اليدوية."
                                : "يمكنك التبديل إلى الهجري إذا كان الإدخال بالتقويم الهجري."}
                            </div>
                          </div>
                          <div className="emp-ov-field emp-ov-from-date">
                            <label className="emp-label">من تاريخ</label>
                            {modalHourOverrideCalendar === "hijri" ? (
                              <>
                                <div className="emp-ov-hijri-row">
                                  <input
                                    className="dash-input emp-ov-hijri-input"
                                    type="text"
                                    inputMode="numeric"
                                    value={modalHourOverrideFromDateHijri}
                                    placeholder="مثال: 09/09/1447"
                                    disabled={loading}
                                    onChange={(e) =>
                                      applyModalHourOverrideHijriInput("from", e.target.value, false)
                                    }
                                    onBlur={(e) =>
                                      applyModalHourOverrideHijriInput("from", e.target.value, true)
                                    }
                                  />
                                  <button
                                    type="button"
                                    className="exp-btn ghost sm emp-ov-hijri-pick-btn"
                                    disabled={loading}
                                    onClick={() => openModalHourOverrideHijriPicker("from")}
                                  >
                                    اختيار التاريخ
                                  </button>
                                </div>
                                <div className="emp-field-note">
                                  الميلادي المقابل: {fmtIsoDate(modalHourOverrideFromDate)}
                                </div>
                              </>
                            ) : (
                              <input
                                className="dash-input"
                                type="date"
                                value={modalHourOverrideFromDate}
                                disabled={loading}
                                onChange={(e) => setModalHourOverrideFromGregorian(e.target.value)}
                              />
                            )}
                          </div>
                          <div className="emp-ov-field emp-ov-to-date">
                            <label className="emp-label">إلى تاريخ</label>
                            {modalHourOverrideCalendar === "hijri" ? (
                              <>
                                <div className="emp-ov-hijri-row">
                                  <input
                                    className="dash-input emp-ov-hijri-input"
                                    type="text"
                                    inputMode="numeric"
                                    value={modalHourOverrideToDateHijri}
                                    placeholder="مثال: 19/09/1447"
                                    disabled={loading || !!modalHourOverrideEditingDate}
                                    onChange={(e) =>
                                      applyModalHourOverrideHijriInput("to", e.target.value, false)
                                    }
                                    onBlur={(e) =>
                                      applyModalHourOverrideHijriInput("to", e.target.value, true)
                                    }
                                  />
                                  <button
                                    type="button"
                                    className="exp-btn ghost sm emp-ov-hijri-pick-btn"
                                    disabled={loading || !!modalHourOverrideEditingDate}
                                    onClick={() => openModalHourOverrideHijriPicker("to")}
                                  >
                                    اختيار التاريخ
                                  </button>
                                </div>
                                <div className="emp-field-note">
                                  الميلادي المقابل:{" "}
                                  {fmtIsoDate(
                                    normalizeLeaveUntil(modalHourOverrideToDate) || modalHourOverrideFromDate
                                  )}
                                </div>
                              </>
                            ) : (
                              <input
                                className="dash-input"
                                type="date"
                                value={modalHourOverrideToDate}
                                disabled={loading || !!modalHourOverrideEditingDate}
                                onChange={(e) => setModalHourOverrideToGregorian(e.target.value)}
                              />
                            )}
                            {modalHourOverrideMode === "single" ? (
                              <div className="emp-field-note">
                                اختيار تاريخ مختلف هنا يحول تلقائيا إلى تعديل فترة.
                              </div>
                            ) : null}
                          </div>
                          {modalHourOverrideCalendar === "hijri" && modalHourOverrideHijriPickerOpen ? (
                            <div className="emp-ov-field emp-ov-hijri-picker-wrap">
                              <div className="emp-ov-hijri-picker" ref={modalHourOverrideHijriPickerRef}>
                                <div className="emp-ov-hijri-picker-head">
                                  <button
                                    type="button"
                                    className="exp-btn ghost sm"
                                    disabled={loading}
                                    onClick={() =>
                                      setModalHourOverrideHijriViewMonthISO((prev) =>
                                        shiftHijriMonthStartIso(prev, -1)
                                      )
                                    }
                                  >
                                    السابق
                                  </button>
                                  <div className="emp-ov-hijri-picker-title">
                                    <strong>{modalHourOverrideHijriMonthTitle || "التقويم الهجري"}</strong>
                                    <span>
                                      الحقل الحالي:{" "}
                                      {modalHourOverrideHijriPickerTarget === "from"
                                        ? "من تاريخ"
                                        : "إلى تاريخ"}
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    className="exp-btn ghost sm"
                                    disabled={loading}
                                    onClick={() =>
                                      setModalHourOverrideHijriViewMonthISO((prev) =>
                                        shiftHijriMonthStartIso(prev, 1)
                                      )
                                    }
                                  >
                                    التالي
                                  </button>
                                </div>
                                <div className="emp-ov-hijri-picker-grid emp-ov-hijri-picker-weekdays">
                                  {HIJRI_WEEKDAY_SHORT.map((w) => (
                                    <span key={`ov_hijri_wd_${w}`}>{w}</span>
                                  ))}
                                </div>
                                <div className="emp-ov-hijri-picker-grid">
                                  {Array.from({ length: modalHourOverrideHijriWeekOffset }).map((_, idx) => (
                                    <span
                                      key={`ov_hijri_gap_${idx}`}
                                      className="emp-ov-hijri-day is-gap"
                                      aria-hidden="true"
                                    />
                                  ))}
                                  {modalHourOverrideHijriMonthDays.map((cell) => {
                                    const activeIso =
                                      modalHourOverrideHijriPickerTarget === "from"
                                        ? normalizeLeaveUntil(modalHourOverrideFromDate)
                                        : normalizeLeaveUntil(modalHourOverrideToDate) ||
                                          normalizeLeaveUntil(modalHourOverrideFromDate);
                                    const isActive = cell.iso === activeIso;
                                    return (
                                      <button
                                        key={`ov_hijri_day_${cell.iso}`}
                                        type="button"
                                        className={`emp-ov-hijri-day ${isActive ? "is-active" : ""}`}
                                        disabled={loading}
                                        onClick={() => applyModalHourOverrideHijriPick(cell.iso)}
                                      >
                                        {String(cell.hijriDay)}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          ) : null}
                          <div className="emp-ov-field emp-ov-from-time">
                            <label className="emp-label">من الساعة</label>
                            <input
                              className="dash-input"
                              type="time"
                              value={modalHourOverrideStart}
                              disabled={loading || modalHourOverrideQuickMode !== "manual" || !modalHourOverrideEnabled}
                              onChange={(e) => setModalHourOverrideStart(e.target.value)}
                            />
                          </div>
                          <div className="emp-ov-field emp-ov-to-time">
                            <label className="emp-label">إلى الساعة</label>
                            <input
                              className="dash-input"
                              type="time"
                              value={modalHourOverrideEnd}
                              disabled={loading || modalHourOverrideQuickMode !== "manual" || !modalHourOverrideEnabled}
                              onChange={(e) => setModalHourOverrideEnd(e.target.value)}
                            />
                          </div>
                          <label className="emp-mini-check emp-ov-toggle">
                            <input
                              type="checkbox"
                              checked={modalHourOverrideEnabled}
                              disabled={loading || modalHourOverrideQuickMode !== "manual"}
                              onChange={(e) => setModalHourOverrideEnabled(e.target.checked)}
                            />
                            <span>دوام (إلغاء التحديد = إغلاق كامل)</span>
                          </label>
                          <div className="emp-ov-field emp-ov-note">
                            <label className="emp-label">ملاحظة / سبب</label>
                            <input
                              className="dash-input"
                              value={modalHourOverrideNote}
                              disabled={loading}
                              onChange={(e) => setModalHourOverrideNote(e.target.value)}
                              placeholder="مثال: رمضان / موسم"
                            />
                          </div>
                          <button
                            type="button"
                            className="exp-btn ghost sm emp-ov-submit"
                            disabled={
                              loading ||
                              !normalizeLeaveUntil(modalHourOverrideFromDate) ||
                              (
                                !modalHourOverrideEditingDate &&
                                !modalHourOverrideEditingGroupId &&
                                modalHourOverridePreview.affectedDays <= 0
                              )
                            }
                            onClick={addModalWorkingHourOverride}
                          >
                            {modalHourOverrideEditingDate || modalHourOverrideEditingGroupId
                              ? "حفظ التعديل"
                              : "إضافة النطاق"}
                          </button>
                          {modalHourOverrideEditingDate || modalHourOverrideEditingGroupId ? (
                            <button
                              type="button"
                              className="exp-btn ghost sm emp-ov-cancel"
                              disabled={loading}
                              onClick={cancelModalWorkingHourOverrideEdit}
                            >
                              إلغاء التعديل
                            </button>
                          ) : null}
                          <div className="emp-field-note emp-ov-apply-note">
                            طريقة التنفيذ: {modalHourOverrideUpdateExistingOnly ? "تعديل الموجود فقط" : "استبدال الموجود في نفس التاريخ"}
                          </div>
                          <div className="emp-field-note emp-ov-preview-note">
                            المعاينة: {modalHourOverridePreview.affectedDays} يوم | ساعات بعد التعديل {modalHourOverridePreview.totalHours.toFixed(1)} | التغيير {modalHourOverridePreview.diffHours >= 0 ? "+" : ""}{modalHourOverridePreview.diffHours.toFixed(1)} ساعة
                          </div>
                        </div>
                        {!modalHourOverrideEditingDate && !modalHourOverrideEditingGroupId && modalHourOverrideMode === "specific" ? (
                          <div className="emp-working-override-weekdays">
                            <label className="emp-label">تطبيق على أيام محددة (اختياري)</label>
                            <div className="emp-working-override-weekday-chips">
                              {WEEKDAY_OPTIONS.map((d) => {
                                const active = modalHourOverrideApplyWeekdays.includes(d.key);
                                return (
                                  <button
                                    key={`ov_day_${d.key}`}
                                    type="button"
                                    className={`emp-weekday-chip ${active ? "active" : ""}`}
                                    disabled={loading}
                                    onClick={() => toggleModalHourOverrideWeekday(d.key)}
                                  >
                                    {d.label}
                                  </button>
                                );
                              })}
                            </div>
                            <div className="emp-field-note">
                              {modalHourOverrideApplyWeekdays.length
                                ? `الأيام المختارة: ${modalHourOverrideApplyWeekdays
                                    .map((d) => WEEKDAY_OPTIONS.find((x) => x.key === d)?.label || d)
                                    .join(" / ")}`
                                : "سيتم التطبيق على كل الأيام داخل النطاق."}
                            </div>
                          </div>
                        ) : null}
                        <div className="emp-working-override-summary">
                          <div className="emp-field-note">
                            {modalHourOverrideEditingDate
                              ? `وضع التعديل: تعديل استثناء يوم ${fmtIsoDate(modalHourOverrideEditingDate)}.`
                              : modalHourOverrideEditingGroupId
                                ? `وضع التعديل: تعديل نطاق ${formatIsoDateRange(
                                    modalHourOverrideFromDate,
                                    modalHourOverrideToDate || modalHourOverrideFromDate
                                  )}.`
                              : modalHourOverrideApplyCount > 0
                                ? modalHourOverrideUpdateExistingOnly
                                  ? `سيتم تعديل ${modalHourOverrideApplyCount} استثناء موجود.`
                                  : `سيتم تطبيق الاستثناء على ${modalHourOverrideApplyCount} يوم ضمن النطاق.`
                                : modalHourOverrideUpdateExistingOnly
                                  ? "لا يوجد استثناءات حالية مطابقة للنطاق المحدد."
                                  : "لا يوجد أيام مطابقة للنطاق المحدد."}
                          </div>
                          {!modalHourOverrideEditingDate && !modalHourOverrideEditingGroupId ? (
                            <div className="emp-field-note">
                              {modalHourOverrideUpdateExistingOnly
                                ? "الوضع الحالي: تعديل الاستثناءات الحالية فقط."
                                : modalHourOverrideOverwriteExisting
                                  ? "الوضع الحالي: استبدال أي استثناء سابق في نفس التاريخ."
                                  : "الوضع الحالي: إضافة دون استبدال الاستثناءات السابقة."}
                            </div>
                          ) : null}
                        </div>
                        <div className="emp-field-note">
                          سيتم التطبيق عند الضغط على "حفظ التغييرات".
                        </div>

                        {modalCustomHourOverrides.length ? (
                          <div className="emp-override-list">
                            <div className="emp-override-list-head">
                              <span>
                                الاستثناءات الحالية: {modalHourOverrideGroups.length} نطاق
                                {" • "}
                                {modalCustomHourOverrides.length} يوم
                              </span>
                              <button
                                type="button"
                                className="exp-btn ghost sm"
                                disabled={loading}
                                onClick={() => setModalCustomHourOverrides([])}
                              >
                                حذف الكل
                              </button>
                            </div>
                            {modalHourOverrideGroups.map((group, groupIndex) => {
                              const from = normalizeLeaveUntil(group.fromDate);
                              const to = normalizeLeaveUntil(group.toDate) || from;
                              const activeFrom = normalizeLeaveUntil(modalHourOverrideFromDate);
                              const activeTo =
                                normalizeLeaveUntil(modalHourOverrideToDate) || activeFrom;
                              const isEditing =
                                !normalizeLeaveUntil(modalHourOverrideEditingDate) &&
                                modalHourOverrideUpdateExistingOnly &&
                                activeFrom === from &&
                                activeTo === to;
                              const itemStart = normalizeTimeHHMM(group.start) || "10:00";
                              const itemEnd = normalizeTimeHHMM(group.end) || "22:00";
                              const rangeGregorian = formatIsoDateRange(from, to);
                              const rangeHijri = formatIsoDateRangeByCalendar(from, to, "hijri");
                              const rangeDays = countIsoDateRangeDays(from, to);
                              const dayCount = rangeDays > 0 ? rangeDays : Math.max(1, Number(group.count) || 1);
                              const dayCountLabel =
                                dayCount > 1 ? `${formatArabicInteger(dayCount)} أيام` : "يوم واحد";
                              const toneClass = `tone-${(groupIndex % 4) + 1}`;
                              return (
                                <div
                                  key={`ov_group_${group.id}`}
                                  className={`emp-override-item ${toneClass} ${isEditing ? "editing" : ""}`}
                                >
                                  <div className="emp-override-item-main">
                                    <span className="emp-override-item-badge">استثناء {groupIndex + 1}</span>
                                    <span className="emp-override-item-date">
                                      النطاق: {rangeGregorian}
                                    </span>
                                    <span className="emp-override-item-time">
                                      {rangeHijri !== rangeGregorian ? `هجري: ${rangeHijri}` : ""}
                                    </span>
                                    <span className="emp-override-item-time">
                                      عدد الأيام: {dayCountLabel}
                                    </span>
                                    <span className="emp-override-item-time">
                                      {group.enabled === false
                                        ? "الحالة: إغلاق كامل"
                                        : `الوقت: ${formatWindow(itemStart, itemEnd)}`}
                                    </span>
                                    {group.note ? (
                                      <span className="emp-override-item-time">ملاحظة: {group.note}</span>
                                    ) : null}
                                  </div>
                                  <div className="emp-override-item-actions">
                                    <button
                                      type="button"
                                      className="exp-btn ghost sm"
                                      disabled={loading}
                                      onClick={() => startModalWorkingHourOverrideGroupEdit(group)}
                                    >
                                      تعديل النطاق
                                    </button>
                                    <button
                                      type="button"
                                      className="exp-btn ghost sm"
                                      disabled={loading}
                                      onClick={() => removeModalWorkingHourOverrideGroup(group)}
                                    >
                                      حذف النطاق
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="emp-field-note">
                            لا توجد استثناءات ساعات حالياً.
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}

                </div>
              </div>

              <div className={`emp-modal-section ${modalTab !== "profile" ? "is-hidden" : ""}`}>
                <b className="emp-modal-section-title">ملف الموظفة</b>
                <div className="emp-modal-fields">
                  <div className="dash-field">
                    <label className="emp-label">صورة الموظفة (من ملفات المشروع)</label>
                    <select
                      className="dash-select"
                      value={resolveAvatarFromAssets(avatarUrl)}
                      onChange={(e) => setAvatarUrl(e.target.value)}
                    >
                      <option value="">بدون صورة</option>
                      {STAFF_IMAGE_OPTIONS.map((img) => (
                        <option key={img.value} value={img.value}>
                          {img.label}
                        </option>
                      ))}
                    </select>
                    {resolveAvatarFromAssets(avatarUrl) ? (
                      <div style={{ marginTop: 10 }}>
                        <img
                          src={resolveAvatarFromAssets(avatarUrl)}
                          alt="معاينة صورة الموظفة"
                          style={{
                            width: 56,
                            height: 56,
                            borderRadius: 12,
                            objectFit: "cover",
                            border: "1px solid rgba(13,13,13,0.12)",
                          }}
                        />
                      </div>
                    ) : null}
                  </div>

                  <div className="dash-field">
                    <label className="emp-label">نبذة تعريفية</label>
                    <textarea
                      className="dash-textarea"
                      rows={3}
                      value={bio}
                      onChange={(e) => setBio(e.target.value)}
                      placeholder="مثال: خبيرة شعر وصبغات بخبرة 8 سنوات..."
                    />
                  </div>

                  <div className="dash-field">
                    <label className="emp-label">رابط السيرة الذاتية PDF (اختياري)</label>
                    <input
                      className="dash-input"
                      value={cvUrl}
                      onChange={(e) => setCvUrl(e.target.value)}
                      placeholder="https://.../cv.pdf"
                      dir="ltr"
                    />
                  </div>
                </div>
              </div>

              <div className={`emp-modal-section ${modalTab !== "services" ? "is-hidden" : ""}`}>
                <b className="emp-modal-section-title">الخدمات التي تقدمها الموظفة</b>
                <div className="emp-picks-toolbar">
                  <input
                    className="dash-input"
                    placeholder="بحث بالخدمات..."
                    value={srvQ}
                    onChange={(e) => setSrvQ(e.target.value)}
                  />
                  <select
                    className="dash-select"
                    value={srvSection}
                    onChange={(e) => setSrvSection(e.target.value)}
                  >
                    <option value="all">كل الأقسام</option>
                    {sectionOptions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="staff-picks staff-picks--scroll">
                  {filteredServicesForPicks.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className={`pick ${specialties.includes(o.id) ? "on" : ""}`}
                      onClick={() => toggleSpecialty(o.id)}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {(mode === "edit" || !selectedEmployeeId) && (
              <div className="modal-foot">
                <button className="exp-btn" onClick={closeModal} type="button">
                  إلغاء
                </button>
                <button className="exp-btn primary" onClick={save} disabled={loading} type="button">
                  {loading ? "جاري الحفظ..." : "حفظ التغييرات"}
                </button>
              </div>
            )}
            </fieldset>
          </Modal>
        )}
          </div>
        </div>
      </div>
    </div>
  );
}
