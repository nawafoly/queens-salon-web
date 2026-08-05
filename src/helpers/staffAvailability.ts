import { todayISO as salonTodayISO } from "./bookingDateUtils";
import { resolveStaffScheduleVersionForDate } from "./hr/staffScheduleHistory";

export type StaffAvailabilityLike = {
  active?: boolean;
  showOnBooking?: boolean;
  employmentEndDate?: string;
  onLeave?: boolean;
  leaveUntil?: string;
  exceptionalLeaveDates?: string[];
  exceptionalLeaveWeekdays?: string[];
  useCustomWorkingHours?: boolean;
  // Backward-compatible row shape + optional split shifts.
  customWorkingHours?: Partial<
    Record<
      "sat" | "sun" | "mon" | "tue" | "wed" | "thu" | "fri",
      {
        enabled?: boolean;
        start?: string;
        end?: string;
        shifts?: Array<{ enabled?: boolean; start?: string; end?: string }>;
        windows?: Array<{ enabled?: boolean; start?: string; end?: string }>;
        periods?: Array<{ enabled?: boolean; start?: string; end?: string }>;
      }
    >
  >;
  workingScheduleVersions?: unknown;
  customWorkingHourOverrides?: Array<{
    date?: string;
    enabled?: boolean;
    start?: string;
    end?: string;
    shifts?: Array<{ enabled?: boolean; start?: string; end?: string }>;
    windows?: Array<{ enabled?: boolean; start?: string; end?: string }>;
    periods?: Array<{ enabled?: boolean; start?: string; end?: string }>;
  }>;
};

type StaffAvailabilityOptions = {
  requireActive?: boolean;
  requireShowOnBooking?: boolean;
};

export type StaffWorkingWindowSource =
  | "staff_override"
  | "staff_fixed"
  | "salon_fallback";

export type ResolvedStaffWorkingWindow = {
  enabled: boolean;
  start: string;
  end: string;
  source: StaffWorkingWindowSource;
};

export type ResolvedStaffWorkingWindowRange = {
  start: string;
  end: string;
  source: StaffWorkingWindowSource;
};

function isISODate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function todayISO() {
  return salonTodayISO();
}

export function normalizeISODate(value: string | undefined | null) {
  const s = String(value || "").trim();
  return isISODate(s) ? s : "";
}

export function resolveEmploymentEndDate(staff: StaffAvailabilityLike) {
  const direct = normalizeISODate((staff as any)?.employmentEndDate);
  if (direct) return direct;
  const legacy1 = normalizeISODate((staff as any)?.lastWorkingDate);
  if (legacy1) return legacy1;
  const legacy2 = normalizeISODate((staff as any)?.resignationDate);
  if (legacy2) return legacy2;
  return "";
}

export function isStaffEmploymentEndedForDate(
  staff: StaffAvailabilityLike,
  dateISO?: string
) {
  const target = normalizeISODate(dateISO) || todayISO();
  const endDate = resolveEmploymentEndDate(staff);
  if (!endDate) return false;
  return target > endDate;
}

export function isStaffOperationallyActiveForDate(
  staff: StaffAvailabilityLike,
  dateISO?: string
) {
  if (staff?.active === false) return false;
  if (isStaffEmploymentEndedForDate(staff, dateISO)) return false;
  return true;
}

function weekdayFromISO(dateISO: string) {
  const s = normalizeISODate(dateISO);
  if (!s) return "";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  if (Number.isNaN(d.getTime())) return "";
  const map = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return map[d.getUTCDay()] || "";
}

function normalizeTimeHHMM(value: any) {
  const s = String(value || "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "";
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return "";
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return "";
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
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

function readSplitWindowsFromRow(row: any): Array<{ start: string; end: string }> {
  if (!row || typeof row !== "object") return [];
  const candidates: any[] = [];
  if (Array.isArray((row as any).shifts)) candidates.push(...(row as any).shifts);
  if (Array.isArray((row as any).windows)) candidates.push(...(row as any).windows);
  if (Array.isArray((row as any).periods)) candidates.push(...(row as any).periods);

  const out: Array<{ start: string; end: string }> = [];
  for (const w of candidates) {
    if (!w || typeof w !== "object") continue;
    if ((w as any).enabled === false) continue;
    const start = normalizeTimeHHMM((w as any).start);
    const end = normalizeTimeHHMM((w as any).end);
    if (!start || !end || start === end) continue;
    out.push({ start, end });
  }
  return out;
}

function normalizeAndSortWindows(
  windows: Array<{ start: string; end: string }>,
  source: StaffWorkingWindowSource
): ResolvedStaffWorkingWindowRange[] {
  const uniq = new Map<string, ResolvedStaffWorkingWindowRange>();
  for (const w of windows) {
    const start = normalizeTimeHHMM(w?.start);
    const end = normalizeTimeHHMM(w?.end);
    if (!start || !end || start === end) continue;
    const key = `${start}|${end}`;
    if (!uniq.has(key)) uniq.set(key, { start, end, source });
  }
  return Array.from(uniq.values()).sort((a, b) => {
    const d = toMinutes(a.start) - toMinutes(b.start);
    if (d !== 0) return d;
    return toMinutes(a.end) - toMinutes(b.end);
  });
}

function hasEnabledWorkingOverrideForDate(
  staff: StaffAvailabilityLike,
  dateISO: string
) {
  const overrides = Array.isArray(staff?.customWorkingHourOverrides)
    ? staff.customWorkingHourOverrides
    : [];
  const matched = overrides.filter(
    (row) => normalizeISODate((row as any)?.date) === dateISO
  );
  if (!matched.length) return false;
  return matched.some((row) => (row as any)?.enabled !== false);
}

function hasExplicitEnabledWorkingDayForDate(
  staff: StaffAvailabilityLike,
  dateISO: string
) {
  if (!staff?.useCustomWorkingHours) return false;
  const weekday = weekdayFromISO(dateISO);
  if (!weekday) return false;
  const row = ((staff?.customWorkingHours || {}) as any)?.[weekday];
  return !!row && typeof row === "object" && row.enabled !== false;
}

function isLeaveActiveForDate(staff: StaffAvailabilityLike, dateISO?: string) {
  const target = normalizeISODate(dateISO) || todayISO();
  const exceptional = Array.isArray(staff?.exceptionalLeaveDates)
    ? staff.exceptionalLeaveDates.map((d) => normalizeISODate(d)).filter(Boolean)
    : [];

  // A date-specific leave is always authoritative.
  if (exceptional.includes(target)) return true;

  // A current leave period is also authoritative.
  if (staff?.onLeave) {
    const from = normalizeISODate((staff as any).leaveStartDate || (staff as any).leaveFrom || (staff as any).leaveFromDate);
    const until = normalizeISODate(staff.leaveUntil);
    if ((!from || from <= target) && (!until || target <= until)) return true;
  }

  const targetWeekday = weekdayFromISO(target);
  if (!targetWeekday) return false;

  const historicalVersion = resolveStaffScheduleVersionForDate(staff?.workingScheduleVersions, target);
  if (historicalVersion) {
    if (!historicalVersion.useCustomWorkingHours) return false;
    const historicalDay = (historicalVersion.customWorkingHours || {})[targetWeekday];
    return historicalDay?.enabled === false;
  }

  const exceptionalWeekdays = Array.isArray(staff?.exceptionalLeaveWeekdays)
    ? staff.exceptionalLeaveWeekdays.map((d) => String(d || "").trim().toLowerCase()).filter(Boolean)
    : [];
  if (!exceptionalWeekdays.includes(targetWeekday)) return false;

  // Legacy weekly-off values can remain in Firestore after the employee schedule
  // is changed. An explicit enabled override or enabled custom working day is the
  // newer, more precise source and must win over that stale recurring value.
  if (hasEnabledWorkingOverrideForDate(staff, target)) return false;
  if (hasExplicitEnabledWorkingDayForDate(staff, target)) return false;

  return true;
}

export function isStaffAvailableForDate(
  staff: StaffAvailabilityLike,
  dateISO?: string,
  opts?: StaffAvailabilityOptions
) {
  const requireActive = opts?.requireActive ?? true;
  const requireShowOnBooking = opts?.requireShowOnBooking ?? true;

  if (requireActive && staff?.active === false) return false;
  if (requireShowOnBooking && staff?.showOnBooking === false) return false;

  if (isStaffEmploymentEndedForDate(staff, dateISO)) return false;

  if (isLeaveActiveForDate(staff, dateISO)) return false;

  return true;
}

function hasStaffFixedWorkingHours(staff: StaffAvailabilityLike) {
  if (!staff?.useCustomWorkingHours) return false;
  const rows = staff?.customWorkingHours;
  if (!rows || typeof rows !== "object") return false;
  return Object.values(rows).some((row) => row && typeof row === "object");
}

function resolveStaffFixedWindowForDate(
  staff: StaffAvailabilityLike,
  dateISO: string
): ResolvedStaffWorkingWindow | null {
  if (!hasStaffFixedWorkingHours(staff)) return null;
  const weekday = weekdayFromISO(dateISO);
  const dayCfg = weekday
    ? ((staff?.customWorkingHours || {}) as any)[weekday]
    : undefined;

  if (!dayCfg || typeof dayCfg !== "object") {
    // No fixed row for this weekday => treat as "no fixed schedule for today"
    // and fall back to salon hours.
    return null;
  }

  const enabled = dayCfg.enabled !== false;
  const start = normalizeTimeHHMM(dayCfg.start) || "10:00";
  const end = normalizeTimeHHMM(dayCfg.end) || "22:00";
  return { enabled, start, end, source: "staff_fixed" };
}

function resolveStaffOverrideWindowsForDate(
  staff: StaffAvailabilityLike,
  dateISO: string
): ResolvedStaffWorkingWindowRange[] | null {
  const overrides = Array.isArray(staff?.customWorkingHourOverrides)
    ? staff.customWorkingHourOverrides
    : [];
  const matched = overrides.filter((x) => normalizeISODate((x as any)?.date) === dateISO);
  if (!matched.length) return null;

  const collected: Array<{ start: string; end: string }> = [];
  for (const ov of matched) {
    if (!ov || typeof ov !== "object") continue;
    if ((ov as any).enabled === false) continue;

    const split = readSplitWindowsFromRow(ov);
    if (split.length) {
      collected.push(...split);
      continue;
    }

    const start = normalizeTimeHHMM((ov as any).start) || "10:00";
    const end = normalizeTimeHHMM((ov as any).end) || "22:00";
    if (start && end && start !== end) collected.push({ start, end });
  }

  // Overrides matched this date but all are disabled => day closed for staff.
  if (!collected.length) return [];
  return normalizeAndSortWindows(collected, "staff_override");
}

function resolveStaffFixedWindowsForDate(
  staff: StaffAvailabilityLike,
  dateISO: string
): ResolvedStaffWorkingWindowRange[] | null {
  if (!hasStaffFixedWorkingHours(staff)) return null;
  const weekday = weekdayFromISO(dateISO);
  const dayCfg = weekday
    ? ((staff?.customWorkingHours || {}) as any)[weekday]
    : undefined;

  if (!dayCfg || typeof dayCfg !== "object") return null;
  if ((dayCfg as any).enabled === false) return [];

  const split = readSplitWindowsFromRow(dayCfg);
  if (split.length) return normalizeAndSortWindows(split, "staff_fixed");

  const start = normalizeTimeHHMM((dayCfg as any).start) || "10:00";
  const end = normalizeTimeHHMM((dayCfg as any).end) || "22:00";
  if (!start || !end || start === end) return [];
  return [{ start, end, source: "staff_fixed" }];
}

export function resolveStaffWorkingWindowsForDate(
  staff: StaffAvailabilityLike,
  args: {
    dateISO: string;
    fallbackOpenTime: string;
    fallbackCloseTime: string;
  }
): ResolvedStaffWorkingWindowRange[] {
  const date = normalizeISODate(args.dateISO) || todayISO();
  const fallbackStart = normalizeTimeHHMM(args.fallbackOpenTime) || "10:00";
  const fallbackEnd = normalizeTimeHHMM(args.fallbackCloseTime) || "22:00";

  const overrideWindows = resolveStaffOverrideWindowsForDate(staff, date);
  if (overrideWindows !== null) return overrideWindows;

  const fixedWindows = resolveStaffFixedWindowsForDate(staff, date);
  if (fixedWindows !== null) return fixedWindows;

  if (!fallbackStart || !fallbackEnd || fallbackStart === fallbackEnd) return [];
  return [{ start: fallbackStart, end: fallbackEnd, source: "salon_fallback" }];
}

export function resolveStaffWorkingWindowForDate(
  staff: StaffAvailabilityLike,
  args: {
    dateISO: string;
    fallbackOpenTime: string;
    fallbackCloseTime: string;
  }
): ResolvedStaffWorkingWindow {
  const fallbackStart = normalizeTimeHHMM(args.fallbackOpenTime) || "10:00";
  const fallbackEnd = normalizeTimeHHMM(args.fallbackCloseTime) || "22:00";
  const windows = resolveStaffWorkingWindowsForDate(staff, args);
  if (!windows.length) {
    return {
      enabled: false,
      start: fallbackStart,
      end: fallbackEnd,
      source: "salon_fallback",
    };
  }

  const first = windows[0];
  const last = windows[windows.length - 1];
  return {
    enabled: true,
    start: first.start,
    end: last.end,
    source: first.source,
  };
}

export function isStaffWorkingAtTime(
  staff: StaffAvailabilityLike,
  args: {
    dateISO: string;
    time24: string;
    fallbackOpenTime: string;
    fallbackCloseTime: string;
  }
) {
  const windows = resolveStaffWorkingWindowsForDate(staff, {
    dateISO: args.dateISO,
    fallbackOpenTime: args.fallbackOpenTime,
    fallbackCloseTime: args.fallbackCloseTime,
  });
  if (!windows.length) return false;
  const time = normalizeTimeHHMM(args.time24);
  if (!time) return false;
  return windows.some((w) => isTimeInsideWindow(time, w.start, w.end));
}

export function filterStaffSlotsByWorkingHours<T extends { value24: string }>(
  staff: StaffAvailabilityLike,
  args: {
    dateISO: string;
    slots: T[];
    fallbackOpenTime: string;
    fallbackCloseTime: string;
  }
) {
  const windows = resolveStaffWorkingWindowsForDate(staff, {
    dateISO: args.dateISO,
    fallbackOpenTime: args.fallbackOpenTime,
    fallbackCloseTime: args.fallbackCloseTime,
  });
  if (!windows.length) return [] as T[];
  return (args.slots || []).filter((slot) =>
    windows.some((w) => isTimeInsideWindow(String(slot?.value24 || ""), w.start, w.end))
  );
}
