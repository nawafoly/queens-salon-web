import { resolveStaffScheduleVersionForDate } from "./hr/staffScheduleHistory";
export type WeekdayKey = "sat" | "sun" | "mon" | "tue" | "wed" | "thu" | "fri";
export type DateCalendar = "gregory" | "hijri";
type BookingHourOverrideMode = "hours" | "closed";

export type BookingHourOverride = {
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
export const SALON_TIME_ZONE = "Asia/Riyadh";

export type SalonDateTimeParts = {
  dateISO: string;
  time24: string;
  minutes: number;
};

export const WEEKDAY_LABEL_AR: Record<WeekdayKey, string> = {
  sat: "السبت",
  sun: "الأحد",
  mon: "الإثنين",
  tue: "الثلاثاء",
  wed: "الأربعاء",
  thu: "الخميس",
  fri: "الجمعة",
};

export function getSalonDateTimeParts(date = new Date()): SalonDateTimeParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SALON_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value || "";
  const yyyy = read("year");
  const mm = read("month");
  const dd = read("day");
  const hh = read("hour");
  const min = read("minute");
  const hourNum = Math.max(0, Math.min(23, Number(hh || 0)));
  const minuteNum = Math.max(0, Math.min(59, Number(min || 0)));

  return {
    dateISO: `${yyyy}-${mm}-${dd}`,
    time24: `${String(hourNum).padStart(2, "0")}:${String(minuteNum).padStart(2, "0")}`,
    minutes: hourNum * 60 + minuteNum,
  };
}

export function todayISO() {
  return getSalonDateTimeParts().dateISO;
}

export function normalizeIsoDate(v: any) {
  const s = String(v || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

export function combineSelectedDateAndTime(
  selectedDate: string,
  selectedTime: string
): SalonDateTimeParts | null {
  const dateISO = normalizeIsoDate(selectedDate);
  const time24 = safeTimeHHMM(selectedTime, "");
  if (!dateISO || !time24) return null;
  const [hh, mm] = time24.split(":").map((part) => Number(part));
  return {
    dateISO,
    time24,
    minutes: (Number(hh) || 0) * 60 + (Number(mm) || 0),
  };
}

export function isPastSalonAppointmentTime(
  selectedDate: string,
  selectedTime: string,
  nowParts: SalonDateTimeParts = getSalonDateTimeParts()
) {
  const appointment = combineSelectedDateAndTime(selectedDate, selectedTime);
  if (!appointment) return false;
  return (
    appointment.dateISO === nowParts.dateISO &&
    appointment.minutes <= nowParts.minutes
  );
}

export function formatDateByCalendar(v: any, calendar: DateCalendar = "gregory") {
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

export function addDaysISO(startISO: string, addDays: number) {
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

export function findHijriMonthStartISO(anchorISO: string) {
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

export function buildHijriMonthDays(anchorISO: string) {
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

export function shiftHijriMonthStartISO(currentMonthStartISO: string, delta: number) {
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

export function toHijriMonthYearLabel(iso: string) {
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

export function safeInt(v: any, fallback: number) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function safeTimeHHMM(v: any, fallback: string) {
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

export function resolveWeekdayFromISO(dateISO: string): WeekdayKey {
  const s = String(dateISO || "").trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return resolveWeekdayFromISO(todayISO());

  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, Math.max(0, mo - 1), d, 12));
  return JS_DAY_TO_WEEKDAY[dt.getUTCDay()] || "sat";
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
      const fromDate = String(x?.fromDate || "").trim();
      const toDate = String(x?.toDate || "").trim();
      if (!fromDate || !toDate) return null;
      const mode: BookingHourOverrideMode =
        String(x?.mode || "").trim() === "closed" ? "closed" : "hours";
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

const AR_SA_LATN_LOCALE = "ar-SA-u-nu-latn";
const AR_SA_GREGORY_LATN_LOCALE = "ar-SA-u-ca-gregory-nu-latn";
const AR_SA_HIJRI_LATN_LOCALE = "ar-SA-u-ca-islamic-umalqura-nu-latn";

export type BookingCalendarViewMode = "gregorian" | "hijri";

export function normalizeOfferDateISO(v: any) {
  const iso = normalizeIsoDate(v);
  if (iso) return iso;

  if (typeof v === "string") {
    const s = v.trim();
    const datePrefixMatch = s.match(/^(\d{4}-\d{2}-\d{2})[T\s]/);
    if (datePrefixMatch?.[1]) return datePrefixMatch[1];
    const parsed = new Date(s);
    if (!Number.isNaN(parsed.getTime())) {
      const yyyy = parsed.getFullYear();
      const mm = String(parsed.getMonth() + 1).padStart(2, "0");
      const dd = String(parsed.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }
    return "";
  }

  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    const yyyy = v.getFullYear();
    const mm = String(v.getMonth() + 1).padStart(2, "0");
    const dd = String(v.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  if (typeof v?.toDate === "function") {
    return normalizeOfferDateISO(v.toDate());
  }

  if (typeof v?.seconds === "number") {
    return normalizeOfferDateISO(new Date(v.seconds * 1000));
  }

  return "";
}

export function formatISODateAr(v: any) {
  const iso = normalizeIsoDate(v);
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(AR_SA_LATN_LOCALE, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

export function normalizeCalendarViewMode(v: any): BookingCalendarViewMode {
  return String(v || "").trim().toLowerCase() === "hijri" ? "hijri" : "gregorian";
}

export function formatBookingDateForView(dateISO: string, mode: BookingCalendarViewMode) {
  const iso = normalizeIsoDate(dateISO);
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;

  const locale = mode === "hijri" ? AR_SA_HIJRI_LATN_LOCALE : AR_SA_GREGORY_LATN_LOCALE;
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(d);
}

export function getStaffLeaveMetaForDate(staff: any, dateISO: string) {
  const target = normalizeIsoDate(dateISO) || todayISO();
  const exceptionalDates = Array.isArray(staff?.exceptionalLeaveDates)
    ? staff.exceptionalLeaveDates.map((d: any) => normalizeIsoDate(d)).filter(Boolean)
    : [];
  if (exceptionalDates.includes(target)) {
    return { isOnLeave: true, leaveUntil: "", label: "إجازة في هذا اليوم" };
  }

  const dayKey = resolveWeekdayFromISO(target);
  const historicalVersion = resolveStaffScheduleVersionForDate(staff?.workingScheduleVersions, target);
  if (dayKey && historicalVersion) {
    const historicalDay = historicalVersion.useCustomWorkingHours
      ? (historicalVersion.customWorkingHours || {})[dayKey]
      : undefined;
    if (historicalDay?.enabled === false) {
      return {
        isOnLeave: true,
        leaveUntil: "",
        label: `إجازة أسبوعية من جدول فعلي: ${WEEKDAY_LABEL_AR[dayKey]}`,
      };
    }
  }

  const exceptionalWeekdays = !historicalVersion && Array.isArray(staff?.exceptionalLeaveWeekdays)
    ? staff.exceptionalLeaveWeekdays
        .map((d: any) => String(d || "").trim().toLowerCase())
        .filter(Boolean)
    : [];
  if (dayKey && exceptionalWeekdays.includes(dayKey)) {
    return {
      isOnLeave: true,
      leaveUntil: "",
      label: `إجازة كل ${WEEKDAY_LABEL_AR[dayKey]}`,
    };
  }

  const onLeave = !!staff?.onLeave;
  const leaveUntil = normalizeIsoDate(staff?.leaveUntil);
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

export function isOfferValidForBookingDate(offer: any, bookingDateISO: string) {
  if (!bookingDateISO) return { ok: true, reason: "" };

  const s = normalizeOfferDateISO(offer?.startDate);
  const e = normalizeOfferDateISO(offer?.endDate ?? offer?.validUntil);

  if (s && bookingDateISO < s) return { ok: false, reason: `العرض يبدأ من ${s}` };
  if (e && bookingDateISO > e) return { ok: false, reason: `العرض انتهى بتاريخ ${e}` };
  return { ok: true, reason: "" };
}

export function isSeasonActiveForDate(season: any, bookingDateISO: string) {
  const enabled = !!season?.enabled;
  if (!enabled) return false;

  const s = String(season?.startDate || "").trim();
  const e = String(season?.endDate || "").trim();

  if (!s && !e) return true;

  if (s && bookingDateISO && bookingDateISO < s) return false;
  if (e && bookingDateISO && bookingDateISO > e) return false;
  return true;
}
