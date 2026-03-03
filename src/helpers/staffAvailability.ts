type StaffAvailabilityLike = {
  active?: boolean;
  showOnBooking?: boolean;
  employmentEndDate?: string;
  onLeave?: boolean;
  leaveUntil?: string;
  exceptionalLeaveDates?: string[];
  exceptionalLeaveWeekdays?: string[];
  useCustomWorkingHours?: boolean;
  customWorkingHours?: Partial<
    Record<
      "sat" | "sun" | "mon" | "tue" | "wed" | "thu" | "fri",
      { enabled?: boolean; start?: string; end?: string }
    >
  >;
  customWorkingHourOverrides?: Array<{
    date?: string;
    enabled?: boolean;
    start?: string;
    end?: string;
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

function isISODate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeISODate(value: string | undefined | null) {
  const s = String(value || "").trim();
  return isISODate(s) ? s : "";
}

function resolveEmploymentEndDate(staff: StaffAvailabilityLike) {
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

function weekdayFromISO(dateISO: string) {
  const s = normalizeISODate(dateISO);
  if (!s) return "";
  const d = new Date(`${s}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  const map = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return map[d.getDay()] || "";
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

function isLeaveActiveForDate(staff: StaffAvailabilityLike, dateISO?: string) {
  const target = normalizeISODate(dateISO) || todayISO();
  const exceptional = Array.isArray(staff?.exceptionalLeaveDates)
    ? staff.exceptionalLeaveDates.map((d) => normalizeISODate(d)).filter(Boolean)
    : [];
  if (exceptional.includes(target)) return true;

  const exceptionalWeekdays = Array.isArray(staff?.exceptionalLeaveWeekdays)
    ? staff.exceptionalLeaveWeekdays.map((d) => String(d || "").trim().toLowerCase()).filter(Boolean)
    : [];
  const targetWeekday = weekdayFromISO(target);
  if (targetWeekday && exceptionalWeekdays.includes(targetWeekday)) return true;

  if (!staff?.onLeave) return false;

  const until = normalizeISODate(staff.leaveUntil);
  if (!until) return true;

  return target <= until;
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

export function resolveStaffWorkingWindowForDate(
  staff: StaffAvailabilityLike,
  args: {
    dateISO: string;
    fallbackOpenTime: string;
    fallbackCloseTime: string;
  }
): ResolvedStaffWorkingWindow {
  const date = normalizeISODate(args.dateISO) || todayISO();
  const fallbackStart = normalizeTimeHHMM(args.fallbackOpenTime) || "10:00";
  const fallbackEnd = normalizeTimeHHMM(args.fallbackCloseTime) || "22:00";

  const overrides = Array.isArray(staff?.customWorkingHourOverrides)
    ? staff.customWorkingHourOverrides
    : [];
  const override = overrides.find((x) => normalizeISODate(x?.date) === date);
  if (override) {
    // Staff exception has the highest priority for this date.
    const enabled = override.enabled !== false;
    const start = normalizeTimeHHMM(override.start) || "10:00";
    const end = normalizeTimeHHMM(override.end) || "22:00";
    return { enabled, start, end, source: "staff_override" };
  }

  const fixed = resolveStaffFixedWindowForDate(staff, date);
  if (fixed) return fixed;

  // No staff exception and no fixed staff hours => fallback to salon hours.
  return {
    enabled: true,
    start: fallbackStart,
    end: fallbackEnd,
    source: "salon_fallback",
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
  const window = resolveStaffWorkingWindowForDate(
    staff,
    {
      dateISO: args.dateISO,
      fallbackOpenTime: args.fallbackOpenTime,
      fallbackCloseTime: args.fallbackCloseTime,
    }
  );
  if (!window.enabled) return false;
  const time = normalizeTimeHHMM(args.time24);
  if (!time) return false;
  return isTimeInsideWindow(time, window.start, window.end);
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
  const window = resolveStaffWorkingWindowForDate(
    staff,
    {
      dateISO: args.dateISO,
      fallbackOpenTime: args.fallbackOpenTime,
      fallbackCloseTime: args.fallbackCloseTime,
    }
  );
  if (!window.enabled) return [] as T[];
  return (args.slots || []).filter((slot) =>
    isTimeInsideWindow(String(slot?.value24 || ""), window.start, window.end)
  );
}
