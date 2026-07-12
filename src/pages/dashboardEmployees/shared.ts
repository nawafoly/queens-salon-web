/* eslint-disable @typescript-eslint/no-explicit-any */
import { collection, doc } from "firebase/firestore";

import { db } from "../../services/firebase";
import { type BookingStatus } from "../../services/firestoreBookings";
import {
  type StaffOvertimeHoursBasis,
  type StaffPayrollMethod,
} from "../../helpers/staffPayroll";

export type UiRole = "owner" | "admin" | "hr" | "reception" | "staff" | "client" | "guest";

export type AuthUser = {
  uid: string;
  email: string;
  role: UiRole;
  displayName?: string;
};

export type LeaveEntry = {
  id: string;
  type?: string;
  actionType?: "add" | "deduct" | string;
  days: number;
  changeAmount?: number;
  balanceBefore?: number;
  balanceAfter?: number;
  date: string;
  note?: string;
  createdAt?: string;
  createdAtIso?: string;
  createdBy?: string;
  createdByUid?: string;
  byUid?: string;
  byName?: string;
  deleted?: boolean;
  deletedAt?: string;
  deletedBy?: string;
  deletedByName?: string;
};

export type StaffWorkingDay = {
  enabled?: boolean;
  start?: string;
  end?: string;
};

export type StaffWorkingHourOverride = {
  date: string;
  enabled?: boolean;
  start?: string;
  end?: string;
  note?: string;
};

export type StaffWorkingHourOverrideGroup = {
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

export type WorkingHourOverrideMode = "single" | "range" | "specific";
export type WorkingHourOverrideQuickMode = "full" | "closed" | "plus1" | "plus2" | "manual";
export type WorkingHourOverrideApplyMethod = "replace" | "merge";
export type WeekdayKey = "sat" | "sun" | "mon" | "tue" | "wed" | "thu" | "fri";

export type StaffPublicDoc = {
  uid?: string;
  linkedUid?: string;
  linkedUserId?: string;
  authUid?: string;
  userId?: string;
  employeeUid?: string;
  employeeId?: string;
  employeeDocId?: string;
  linkedEmployeeDocId?: string;
  email?: string;
  phone?: string;
  role?: string;
  department?: string;
  title?: string;
  employmentSource?: "salon" | "partner" | string;
  partnerId?: string;
  partnerMemberId?: string;
  partnerName?: string;
  contractId?: string;
  resourceIds?: string[];
  employeeProfileEnabled?: boolean;
  includeInEmployeeManagement?: boolean;
  source?: "staff_public" | "employees" | "users";
  profileIncomplete?: boolean;
  employeeKind?: "service" | "administrative";
  name: string;
  active: boolean;
  employmentEndDate?: string;
  showOnAbout: boolean;
  showOnBooking: boolean;
  onLeave?: boolean;
  leaveUntil?: string;
  leaveNote?: string;
  exceptionalLeaveDates?: string[];
  exceptionalLeaveWeekdays?: string[];
  useCustomWorkingHours?: boolean;
  customWorkingHours?: Partial<Record<WeekdayKey, StaffWorkingDay>>;
  customWorkingHourOverrides?: StaffWorkingHourOverride[];
  allowedAttendanceZoneId?: string;
  attendanceZoneId?: string;
  attendanceScopeId?: string;
  assignedAttendanceZoneId?: string;
  allowedZoneIds?: string[];
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
  rating?: number;
  reviewsCount?: number;
  leaveBalanceDays?: number;
  leaveEntitlementDate?: string;
  leaveEntries?: LeaveEntry[];
  createdAt?: any;
  updatedAt?: any;
};

export type StaffPublicUi = StaffPublicDoc & { id: string };

export type ServiceOption = {
  id: string;
  label: string;
  sectionId?: string;
  categoryId?: string;
  durationMin?: number;
  price?: number;
  active?: boolean;
};

export type EmployeeModalTab = "stats" | "basic" | "booking" | "services" | "profile";
export type EmployeeSplitTab =
  | "basic"
  | "profile"
  | "services"
  | "booking"
  | "attendance"
  | "payroll"
  | "requests"
  | "leave"
  | "messages"
  | "files";
export type EmployeeMode = "view" | "edit";

export type BookingHourOverrideMode = "hours" | "closed";
export type BookingHourOverride = {
  fromDate: string;
  toDate: string;
  mode: BookingHourOverrideMode;
  start?: string;
  end?: string;
  includeWeekdays?: WeekdayKey[];
  blockedWeekdays?: WeekdayKey[];
};

export type SummarySourceGroup = {
  title: string;
  gregorian: string;
  hijri: string;
  details: string[];
  tone: "active" | "other";
};

export type StaffBookingStats = {
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

export type DateCalendar = "gregory" | "hijri";
export type HijriDateParts = { day: number; month: number; year: number };

export const SALON_ID = "main";
export const DEFAULT_OPEN_TIME = "10:00";
export const DEFAULT_CLOSE_TIME = "22:00";
export const REVENUE_STATUSES = new Set<BookingStatus>(["confirmed", "completed"]);
const STAFF_IMAGE_MODULES = import.meta.glob("../../assets/images/*.{png,jpg,jpeg,webp,avif,svg}", {
  eager: true,
  import: "default",
}) as Record<string, string>;

export const STAFF_IMAGE_OPTIONS = Object.entries(STAFF_IMAGE_MODULES)
  .map(([path, url]) => {
    const fileName = path.split("/").pop() || path;
    return { label: fileName, value: String(url || "") };
  })
  .filter((x) => x.value)
  .sort((a, b) => a.label.localeCompare(b.label));

const STAFF_IMAGE_BY_FILE = new Map(
  STAFF_IMAGE_OPTIONS.map((x) => [String(x.label || "").toLowerCase(), x.value] as const)
);

export const HIJRI_WEEKDAY_SHORT = ["س", "ح", "ن", "ث", "ر", "خ", "ج"] as const;
export const WEEKDAY_OPTIONS: Array<{ key: WeekdayKey; label: string }> = [
  { key: "sat", label: "السبت" },
  { key: "sun", label: "الأحد" },
  { key: "mon", label: "الاثنين" },
  { key: "tue", label: "الثلاثاء" },
  { key: "wed", label: "الأربعاء" },
  { key: "thu", label: "الخميس" },
  { key: "fri", label: "الجمعة" },
];

export function normalizeLookupText(v: any): string {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function normalizeSpecialties(v: any): string[] {
  return Array.from(
    new Set(
      (Array.isArray(v) ? v : [])
        .map((x: any) => String(x || "").trim())
        .filter(Boolean)
    )
  );
}

export function canonicalizeSpecialties(raw: any, options: ServiceOption[]): string[] {
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

export function getAuthUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem("auth_user");
    if (!raw) return null;
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

type FirestoreErrorLike = { code?: string; message?: string };

export function toFirestoreErrorMessage(error: unknown, fallback: string): string {
  const e = (error || {}) as FirestoreErrorLike;
  const code = String(e.code || "").toLowerCase();
  if (code.includes("permission-denied")) {
    return "لا توجد صلاحية لتنفيذ العملية على بيانات الموظفات.";
  }
  if (code.includes("failed-precondition")) {
    return "تعذر تنفيذ الاستعلام. قد يكون هناك Index مطلوب في Firestore.";
  }
  if (code.includes("not-found")) {
    return "السجل المطلوب غير موجود أو تم حذفه.";
  }
  if (code.includes("unavailable")) {
    return "الخدمة غير متاحة مؤقتًا. حاول مرة أخرى.";
  }
  const msg = String(e.message || "").trim();
  return msg || fallback;
}

export function toComparableTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    try {
      const ms = Number((value as { toMillis: () => number }).toMillis());
      if (Number.isFinite(ms)) return ms;
    } catch {
      // noop
    }
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    if (Number.isFinite(ms)) return ms;
  }
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? ms : 0;
}

export function getNameInitials(name: string): string {
  const clean = String(name || "").trim();
  if (!clean) return "؟";
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase();
}

export function staffPublicCol() {
  return collection(db, "salons", SALON_ID, "staff_public");
}

export function staffPublicDoc(id: string) {
  return doc(db, "salons", SALON_ID, "staff_public", id);
}

export function servicesCol() {
  return collection(db, "salons", SALON_ID, "services");
}

export function usersCol() {
  return collection(db, "salons", SALON_ID, "users");
}

export function normalizeRoleText(v: any) {
  return String(v || "")
    .trim()
    .toLowerCase();
}

export function isAdministrativeRoleText(v: any) {
  const role = normalizeRoleText(v);
  return (
    role === "owner" ||
    role === "admin" ||
    role === "hr" ||
    role === "reception"
  );
}

export function isAdministrativeStaffRecord(
  docId: string,
  data: any,
  linkedUserRoleByUid?: Map<string, string>
) {
  const role = normalizeRoleText(data?.role);
  if (isAdministrativeRoleText(role)) return true;

  const docKey = String(docId || "")
    .trim()
    .toLowerCase();
  if (docKey.startsWith("admin") || docKey.startsWith("owner") || docKey.startsWith("reception")) {
    return true;
  }

  const name = normalizeLookupText(data?.name);
  if (
    name.includes("ادمن") ||
    name.includes("admin") ||
    name.includes("owner") ||
    name.includes("استقبال") ||
    name.includes("reception")
  ) {
    return true;
  }

  const linkedUid = String(data?.linkedUid || "").trim();
  const linkedRole = linkedUid ? normalizeRoleText(linkedUserRoleByUid?.get(linkedUid)) : "";
  if (isAdministrativeRoleText(linkedRole)) return true;

  return false;
}

export function safeKey(s: string) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

export function normalizeArabicName(s: string) {
  return String(s || "")
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\u0600-\u06FFa-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function pickAvatarUrl(data: any): string {
  const direct = String(data?.avatarUrl || "").trim();
  if (direct) return direct;
  const candidate = String(data?.photoURL || data?.photoUrl || "").trim();
  if (candidate) return candidate;
  return "";
}

export function resolveAvatarFromAssets(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  const key = value.split("/").pop()?.toLowerCase() || value.toLowerCase();
  const bundled = STAFF_IMAGE_BY_FILE.get(key);
  if (bundled) return bundled;
  if (/^https?:\/\//i.test(value) || value.startsWith("data:") || value.startsWith("blob:")) return value;
  // Runtime Firestore values under /src are not transformed by Vite in production.
  if (/^\/?src\/assets\//i.test(value)) return "";
  return value;
}

export function toArabicSectionLabel(sectionId: string, fallbackLabel?: string): string {
  const raw = String(sectionId || fallbackLabel || "").trim();
  if (!raw) return "قسم غير محدد";
  const key = raw.toLowerCase();
  if (key.includes("hair")) return "الشعر";
  if (key.includes("nail")) return "الأظافر";
  if (key.includes("skin")) return "البشرة";
  if (key.includes("massage")) return "المساج";
  if (key.includes("make")) return "المكياج";
  return raw;
}

export function monthKey(dateIso: string) {
  const s = normalizeIsoDate(dateIso);
  return s ? s.slice(0, 7) : "";
}

export function currentMonthKey() {
  return monthKey(todayIso());
}

export function todayIso() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function safeNonNegativeNumber(v: any, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function fmtMoneySar(v: number): string {
  return new Intl.NumberFormat("en-SA", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(Number(v || 0));
}

export function formatDailyHourBucketsLabel(
  dailyHourBuckets: Record<string, number> | undefined | null
): string {
  const rows = Object.entries(dailyHourBuckets || {}).filter(([, count]) => Number(count) > 0);
  if (!rows.length) return "-";
  return rows
    .map(([bucket, count]) => `${bucket}: ${count}`)
    .join(" | ");
}

export function bookingAmountOf(b: any): number {
  const paid = Number(b?.paidAmount || 0);
  const price = Number(b?.price || 0);
  return Math.max(paid, price, 0);
}

export function fmtIsoDate(v?: string) {
  const s = normalizeIsoDate(v);
  if (!s) return "-";
  const [y, m, d] = s.split("-").map(Number);
  return new Intl.DateTimeFormat("ar-SA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    calendar: "gregory",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function fmtIsoDateByCalendar(v?: string, calendar: DateCalendar = "gregory") {
  const s = normalizeIsoDate(v);
  if (!s) return "-";
  const [y, m, d] = s.split("-").map(Number);
  const locale = calendar === "hijri" ? "ar-SA-u-ca-islamic-umalqura" : "ar-SA-u-ca-gregory";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function fmtIsoDateHijri(v?: string) {
  return fmtIsoDateByCalendar(v, "hijri");
}

export function normalizeArabicDigits(v: string) {
  const s = String(v || "");
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
  };
  return s.replace(/[٠-٩]/g, (ch) => map[ch] || ch);
}

export function hijriPartsFromIso(v?: string): HijriDateParts | null {
  const s = normalizeIsoDate(v);
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const parts = new Intl.DateTimeFormat("en-TN-u-ca-islamic", {
    timeZone: "UTC",
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).formatToParts(dt);
  const day = Number(parts.find((p) => p.type === "day")?.value || 0);
  const month = Number(parts.find((p) => p.type === "month")?.value || 0);
  const year = Number(parts.find((p) => p.type === "year")?.value || 0);
  if (![day, month, year].every((n) => Number.isFinite(n) && n > 0)) return null;
  return { day, month, year };
}

export function formatHijriInputFromIso(v?: string) {
  const p = hijriPartsFromIso(v);
  if (!p) return "";
  return `${String(p.day).padStart(2, "0")}/${String(p.month).padStart(2, "0")}/${p.year}`;
}

export function parseHijriDateInput(v: string): HijriDateParts | null {
  const s = normalizeArabicDigits(String(v || "").trim());
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (![day, month, year].every((n) => Number.isFinite(n))) return null;
  if (day < 1 || day > 30) return null;
  if (month < 1 || month > 12) return null;
  if (year < 1300 || year > 1700) return null;
  return { day, month, year };
}

export function isoFromHijriDateParts(p: HijriDateParts): string {
  const target = `${String(p.day).padStart(2, "0")}/${String(p.month).padStart(2, "0")}/${p.year}`;
  const start = Date.UTC(2020, 0, 1);
  const end = Date.UTC(2035, 11, 31);
  for (let ts = start; ts <= end; ts += 86400000) {
    const dt = new Date(ts);
    const parts = new Intl.DateTimeFormat("en-TN-u-ca-islamic", {
      timeZone: "UTC",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).formatToParts(dt);
    const day = parts.find((x) => x.type === "day")?.value || "";
    const month = parts.find((x) => x.type === "month")?.value || "";
    const year = parts.find((x) => x.type === "year")?.value || "";
    const candidate = `${day}/${month}/${year}`;
    if (candidate === target) {
      const y = dt.getUTCFullYear();
      const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
      const d = String(dt.getUTCDate()).padStart(2, "0");
      return `${y}-${m}-${d}`;
    }
  }
  return "";
}

export function addDaysIso(dateIso: string, days: number) {
  const s = normalizeIsoDate(dateIso);
  if (!s) return "";
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + Number(days || 0));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function findHijriMonthStartIso(anchorISO: string) {
  const anchor = normalizeIsoDate(anchorISO) || todayIso();
  const anchorParts = hijriPartsFromIso(anchor);
  if (!anchorParts) return anchor;
  return isoFromHijriDateParts({ day: 1, month: anchorParts.month, year: anchorParts.year }) || anchor;
}

export function buildHijriMonthDays(anchorISO: string) {
  const startIso = findHijriMonthStartIso(anchorISO);
  const startParts = hijriPartsFromIso(startIso);
  if (!startParts) return [];
  const out: Array<{ iso: string; hijriDay: number }> = [];
  for (let day = 1; day <= 30; day++) {
    const iso = isoFromHijriDateParts({ day, month: startParts.month, year: startParts.year });
    if (!iso) break;
    const parts = hijriPartsFromIso(iso);
    if (!parts || parts.month !== startParts.month || parts.year !== startParts.year) break;
    out.push({ iso, hijriDay: parts.day });
  }
  return out;
}

export function shiftHijriMonthStartIso(currentMonthStartISO: string, delta: number) {
  const current = findHijriMonthStartIso(currentMonthStartISO);
  const parts = hijriPartsFromIso(current);
  if (!parts) return current;
  let month = parts.month + delta;
  let year = parts.year;
  while (month < 1) {
    month += 12;
    year -= 1;
  }
  while (month > 12) {
    month -= 12;
    year += 1;
  }
  return isoFromHijriDateParts({ day: 1, month, year }) || current;
}

export function toHijriMonthYearLabel(iso: string) {
  const parts = hijriPartsFromIso(iso);
  if (!parts) return "";
  const dt = new Date(`${normalizeIsoDate(iso)}T00:00:00Z`);
  const monthName = new Intl.DateTimeFormat("ar-SA-u-ca-islamic", {
    timeZone: "UTC",
    month: "long",
  }).format(dt);
  return `${monthName} ${parts.year}`;
}

export function hijriWeekdayColumnFromIso(iso: string) {
  const s = normalizeIsoDate(iso);
  if (!s) return 0;
  const d = new Date(`${s}T00:00:00Z`);
  const day = d.getUTCDay();
  return (day + 1) % 7;
}

export function parsePositiveInt(v: string, fallback = 0) {
  const n = Number(String(v || "").trim());
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function normalizeLeaveUntil(v: any) {
  const s = String(v || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

export function normalizeExceptionalLeaveDates(v: any) {
  const arr = Array.isArray(v) ? v : [];
  return Array.from(
    new Set(
      arr
        .map((x: any) => normalizeLeaveUntil(x))
        .filter(Boolean)
        .sort()
    )
  );
}

export function normalizeWeekdayKey(v: any): WeekdayKey | "" {
  const raw = String(v || "")
    .trim()
    .toLowerCase();
  const mapped: Record<string, WeekdayKey> = {
    sat: "sat",
    saturday: "sat",
    "6": "sat",
    sun: "sun",
    sunday: "sun",
    "0": "sun",
    mon: "mon",
    monday: "mon",
    "1": "mon",
    tue: "tue",
    tuesday: "tue",
    "2": "tue",
    wed: "wed",
    wednesday: "wed",
    "3": "wed",
    thu: "thu",
    thursday: "thu",
    "4": "thu",
    fri: "fri",
    friday: "fri",
    "5": "fri",
  };
  const s = (mapped[raw] || raw) as WeekdayKey;
  return (WEEKDAY_OPTIONS.some((d) => d.key === s) ? s : "") as WeekdayKey | "";
}

export function normalizeExceptionalLeaveWeekdays(v: any): WeekdayKey[] {
  const arr = Array.isArray(v) ? v : [];
  return Array.from(
    new Set(
      arr
        .map((x: any) => normalizeWeekdayKey(x))
        .filter(Boolean)
    )
  ) as WeekdayKey[];
}

export function normalizeTimeHHMM(v: any) {
  const s = String(v || "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "";
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return "";
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return "";
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

export function createDefaultWorkingHours(): Record<WeekdayKey, StaffWorkingDay> {
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

export function normalizeWorkingHours(v: any): Record<WeekdayKey, StaffWorkingDay> {
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

export function normalizeWorkingHourOverrides(v: any): StaffWorkingHourOverride[] {
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

export function buildWorkingHourOverrideGroups(
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

  return out.map((group) => {
    const copy = { ...group };
    delete (copy as any)._sig;
    return copy;
  });
}

export function weekdayFromIso(dateIso: string): WeekdayKey | "" {
  const s = normalizeLeaveUntil(dateIso);
  if (!s) return "";
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  const map: WeekdayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return (map[d.getDay()] || "") as WeekdayKey | "";
}

export function toMinutes(hhmm: string) {
  const [h, m] = String(hhmm || "")
    .split(":")
    .map((x) => Number(x));
  return (Number(h) || 0) * 60 + (Number(m) || 0);
}

export function isTimeInsideWindow(time24: string, start24: string, end24: string) {
  const t = toMinutes(time24);
  const s = toMinutes(start24);
  const e = toMinutes(end24);
  if (s === e) return false;
  if (s < e) return t >= s && t < e;
  return t >= s || t < e;
}

export function formatWindow(start: string, end: string) {
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

export function durationHours(enabled: boolean, start: string, end: string): number {
  if (!enabled) return 0;
  const s = toMinutes(start);
  let e = toMinutes(end);
  if (e <= s) e += 1440;
  return Math.max(0, (e - s) / 60);
}

export function normalizeIsoDate(v: any): string {
  const s = String(v || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

export function formatIsoDateRange(from?: string, to?: string): string {
  return formatIsoDateRangeByCalendar(from, to, "gregory");
}

export function formatIsoDateRangeByCalendar(
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

export function formatIsoDateRangeDual(from?: string, to?: string) {
  return {
    gregorian: formatIsoDateRangeByCalendar(from, to, "gregory"),
    hijri: formatIsoDateRangeByCalendar(from, to, "hijri"),
  };
}

export function countIsoDateRangeDays(from?: string, to?: string): number {
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

export function formatArabicInteger(v: number): string {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0";
  return new Intl.NumberFormat("ar-SA", { maximumFractionDigits: 0 }).format(
    Math.max(0, Math.floor(n))
  );
}

export function normalizeWeekdayList(v: any): WeekdayKey[] {
  if (!Array.isArray(v)) return [];
  const allowed = new Set<WeekdayKey>(["sat", "sun", "mon", "tue", "wed", "thu", "fri"]);
  const out: WeekdayKey[] = [];
  for (const d0 of v) {
    const d = String(d0 || "").trim().toLowerCase() as WeekdayKey;
    if (allowed.has(d) && !out.includes(d)) out.push(d);
  }
  return out;
}

export function readBookingHourOverrides(raw: any): BookingHourOverride[] {
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

export function minutesToHHMM(totalMin: number) {
  const n = ((Math.floor(totalMin) % 1440) + 1440) % 1440;
  const hh = String(Math.floor(n / 60)).padStart(2, "0");
  const mm = String(n % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

export function intersectTimeWindows(
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
