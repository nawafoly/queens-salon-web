/** Working-hours helpers used by Contact page. */

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
};

type BusinessHoursMap = Record<WeekdayKey, { enabled: boolean; start: string; end: string }>;

const WEEKDAY_KEYS: WeekdayKey[] = ["sat", "sun", "mon", "tue", "wed", "thu", "fri"];
const WEEKDAY_LABEL_AR: Record<WeekdayKey, string> = {
  sat: "السبت",
  sun: "الأحد",
  mon: "الإثنين",
  tue: "الثلاثاء",
  wed: "الأربعاء",
  thu: "الخميس",
  fri: "الجمعة",
};

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function safeTimeHHMM(v: unknown, fallback: string): string {
  const s = String(v || "").trim();
  if (!/^\d{1,2}:\d{2}$/.test(s)) return fallback;
  const [h, m] = s.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return fallback;
  if (h < 0 || h > 23 || m < 0 || m > 59) return fallback;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function resolveWeekdayFromISO(dateISO: string): WeekdayKey {
  const m = String(dateISO || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "sat";
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const jsDay = dt.getDay(); // 0=Sun .. 6=Sat
  const map: WeekdayKey[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return map[jsDay] || "sat";
}

function defaultBusinessHoursMap(): BusinessHoursMap {
  return {
    sat: { enabled: true, start: "12:00", end: "22:00" },
    sun: { enabled: true, start: "12:00", end: "22:00" },
    mon: { enabled: true, start: "12:00", end: "22:00" },
    tue: { enabled: true, start: "12:00", end: "22:00" },
    wed: { enabled: true, start: "12:00", end: "22:00" },
    thu: { enabled: true, start: "12:00", end: "22:00" },
    fri: { enabled: false, start: "12:00", end: "22:00" },
  };
}

function readBusinessHours(raw: Record<string, unknown> | null | undefined): BusinessHoursMap {
  const fallback = defaultBusinessHoursMap();
  return WEEKDAY_KEYS.reduce((acc, day) => {
    const x = (raw?.[day] || {}) as Record<string, unknown>;
    acc[day] = {
      enabled: typeof x.enabled === "boolean" ? x.enabled : fallback[day].enabled,
      start: safeTimeHHMM(x.start, fallback[day].start),
      end: safeTimeHHMM(x.end, fallback[day].end),
    };
    return acc;
  }, {} as BusinessHoursMap);
}

function normalizeWeekdayList(v: unknown): WeekdayKey[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((d: unknown) => String(d || "").trim().toLowerCase() as WeekdayKey)
    .filter((d) => WEEKDAY_KEYS.includes(d))
    .filter((d, idx, arr) => arr.indexOf(d) === idx);
}

function readBookingHourOverrides(raw: unknown): BookingHourOverride[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x: unknown) => {
      const row = (x || {}) as Record<string, unknown>;
      const fromDate = String(row?.fromDate || "").trim();
      const toDate = String(row?.toDate || "").trim();
      if (!fromDate || !toDate) return null;
      const mode: BookingHourOverrideMode = String(row?.mode || "").trim() === "closed" ? "closed" : "hours";
      return {
        id: String(row?.id || "").trim() || undefined,
        fromDate,
        toDate,
        mode,
        start: String(row?.start || "").trim() || undefined,
        end: String(row?.end || "").trim() || undefined,
        includeWeekdays: normalizeWeekdayList(row?.includeWeekdays),
        blockedWeekdays: normalizeWeekdayList(row?.blockedWeekdays),
      };
    })
    .filter(Boolean) as BookingHourOverride[];
}

function isDateWithinRange(dateISO: string, fromDate: string, toDate: string) {
  const d = String(dateISO || "").trim();
  const from = String(fromDate || "").trim();
  const to = String(toDate || "").trim();
  if (!d || !from || !to) return false;
  return d >= from && d <= to;
}

function getDaySettingsForDate(
  dateISO: string,
  businessHours: BusinessHoursMap,
  bookingHourOverrides: BookingHourOverride[]
) {
  const dayKey = resolveWeekdayFromISO(dateISO);
  const dayHoursBase = businessHours?.[dayKey] || { enabled: true, start: "10:00", end: "22:00" };

  for (let i = bookingHourOverrides.length - 1; i >= 0; i--) {
    const ov = bookingHourOverrides[i];
    if (!isDateWithinRange(dateISO, ov.fromDate, ov.toDate)) continue;

    const includeDays = Array.isArray(ov.includeWeekdays) ? ov.includeWeekdays : [];
    if (includeDays.length > 0 && !includeDays.includes(dayKey)) continue;

    const blockedDays = Array.isArray(ov.blockedWeekdays) ? ov.blockedWeekdays : [];
    if (blockedDays.includes(dayKey) || String(ov?.mode || "").trim() === "closed") {
      return {
        dayKey,
        enabled: false,
        openTime: safeTimeHHMM(dayHoursBase?.start, "10:00"),
        closeTime: safeTimeHHMM(dayHoursBase?.end, "22:00"),
      };
    }

    return {
      dayKey,
      enabled: true,
      openTime: safeTimeHHMM(String(ov?.start || ""), safeTimeHHMM(dayHoursBase?.start, "10:00")),
      closeTime: safeTimeHHMM(String(ov?.end || ""), safeTimeHHMM(dayHoursBase?.end, "22:00")),
    };
  }

  return {
    dayKey,
    enabled: dayHoursBase?.enabled !== false,
    openTime: safeTimeHHMM(dayHoursBase?.start, "10:00"),
    closeTime: safeTimeHHMM(dayHoursBase?.end, "22:00"),
  };
}

function dateToISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function getNextDateISOForWeekday(target: WeekdayKey, startISO: string): string {
  const m = String(startISO || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return todayISO();
  const start = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  for (let i = 0; i <= 13; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = dateToISO(d);
    if (resolveWeekdayFromISO(iso) === target) return iso;
  }
  return startISO;
}

function compressWorkingHoursRows(rows: Array<{ dayKey: WeekdayKey; day: string; hours: string }>) {
  if (!rows.length) return [] as Array<{ day: string; hours: string }>;
  const out: Array<{ day: string; hours: string }> = [];
  let groupStart = 0;
  for (let i = 1; i <= rows.length; i++) {
    const sameAsGroup = i < rows.length && rows[i].hours === rows[groupStart].hours;
    if (sameAsGroup) continue;
    const first = rows[groupStart];
    const last = rows[i - 1];
    const day = groupStart === i - 1 ? first.day : `${first.day} - ${last.day}`;
    out.push({ day, hours: first.hours });
    groupStart = i;
  }
  return out;
}

function parseWorkingHourLine(lineRaw: string) {
  const line = String(lineRaw || "").trim();
  if (!line) return { day: "", hours: "" };

  // الحالة الطبيعية: "اليوم: 03:00 مساء - 10:00 مساء"
  const firstColon = line.indexOf(":");
  if (firstColon > -1) {
    const left = line.slice(0, firstColon).trim();
    const right = line.slice(firstColon + 1).trim();
    // لو الجهة اليسار فيها أرقام فغالبًا هذا ":" تبع الوقت وليس فاصل اليوم
    if (left && !/\d/.test(left)) {
      return { day: left, hours: right };
    }
  }

  // fallback: "السبت - الجمعة 03:00 مساء - 10:00 مساء"
  const timeMatch = line.match(/\d{1,2}:\d{2}/);
  if (timeMatch?.index !== undefined) {
    const idx = timeMatch.index;
    const day = line.slice(0, idx).trim().replace(/[:\-–—\s]+$/, "").trim();
    const hours = line.slice(idx).trim();
    return { day: day || line, hours };
  }

  return { day: line, hours: "" };
}

function normalizeMapEmbedUrl(input?: string) {
  const raw = String(input || "").trim();
  if (!raw) return "";

  // إذا المستخدم لصق الرابط كامل
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;

  // إذا لصق pb فقط
  if (raw.startsWith("pb=")) {
    return `https://www.google.com/maps/embed?${raw}`;
  }

  // إذا لصق pb بدون pb=
  if (raw.startsWith("!1m")) {
    return `https://www.google.com/maps/embed?pb=${raw}`;
  }

  // fallback
  return raw;
}


export {
  WEEKDAY_KEYS,
  WEEKDAY_LABEL_AR,
  todayISO,
  safeTimeHHMM,
  resolveWeekdayFromISO,
  defaultBusinessHoursMap,
  readBusinessHours,
  normalizeWeekdayList,
  readBookingHourOverrides,
  isDateWithinRange,
  getDaySettingsForDate,
  dateToISO,
  getNextDateISOForWeekday,
  compressWorkingHoursRows,
  parseWorkingHourLine,
  normalizeMapEmbedUrl,
};
export type { WeekdayKey, BookingHourOverride, BookingHourOverrideMode, BusinessHoursMap };
