import { resolveStaffScheduleVersionForDate, weeklyOffDaysFromScheduleSnapshot } from "./staffScheduleHistory.ts";
import { buildDateKeysInRange, isWeeklyOffDateKey } from "./workSchedule.ts";

type LeaveRequestLike = {
  id?: unknown;
  employeeUid?: unknown;
  employeeId?: unknown;
  employeeDocId?: unknown;
  userId?: unknown;
  status?: unknown;
  state?: unknown;
  type?: unknown;
  actionType?: unknown;
  leaveType?: unknown;
  leave_type?: unknown;
  requestType?: unknown;
  kind?: unknown;
  fromDate?: unknown;
  toDate?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  date?: unknown;
  dateKey?: unknown;
  until?: unknown;
  days?: unknown;
  durationKind?: unknown;
  duration_kind?: unknown;
  deleted?: unknown;
};

export type AttendanceSpecialDayKind = "leave" | "rest" | "weekly_off" | "exception_off";

export type AttendanceSpecialDay = {
  date: string;
  kind: AttendanceSpecialDayKind;
  label: string;
  source: string;
  sourceId?: string;
  type?: string;
};

const LABEL_LEAVE = "\u0625\u062c\u0627\u0632\u0629";
const LABEL_REST = "\u0631\u0627\u062d\u0629";
const LABEL_WEEKLY_OFF = "\u0625\u062c\u0627\u0632\u0629 \u0623\u0633\u0628\u0648\u0639\u064a\u0629";
const LABEL_EXCEPTION_OFF = "\u0631\u0627\u062d\u0629 / \u064a\u0648\u0645 \u0627\u0633\u062a\u062b\u0646\u0627\u0626\u064a";
const AR_APPROVED = "\u0645\u0639\u062a\u0645\u062f";
const AR_REST = "\u0631\u0627\u062d\u0629";
const AR_LEAVE = "\u0625\u062c\u0627\u0632\u0629";

const SPECIAL_DAY_PRIORITY: Record<AttendanceSpecialDayKind, number> = {
  leave: 40,
  rest: 40,
  exception_off: 30,
  weekly_off: 20,
};

const LEAVE_TYPE_POLICY: Record<
  string,
  {
    kind: AttendanceSpecialDayKind;
    deductFromBalance: boolean;
    affectsPayroll: boolean;
    visibleInAttendance: boolean;
  }
> = {
  annual: { kind: "leave", deductFromBalance: true, affectsPayroll: false, visibleInAttendance: true },
  sick: { kind: "leave", deductFromBalance: true, affectsPayroll: false, visibleInAttendance: true },
  emergency: { kind: "leave", deductFromBalance: true, affectsPayroll: false, visibleInAttendance: true },
  unpaid: { kind: "leave", deductFromBalance: false, affectsPayroll: true, visibleInAttendance: true },
  other: { kind: "leave", deductFromBalance: false, affectsPayroll: false, visibleInAttendance: true },
  rest: { kind: "rest", deductFromBalance: false, affectsPayroll: false, visibleInAttendance: true },
};

const WEEKDAY_TO_OFF_KEY: Record<string, string> = {
  sun: "sunday",
  mon: "monday",
  tue: "tuesday",
  wed: "wednesday",
  thu: "thursday",
  fri: "friday",
  sat: "saturday",
};

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function normalizeToken(value: unknown) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/[\u0623\u0625\u0622]/g, "\u0627")
    .replace(/\u0649/g, "\u064a")
    .replace(/\u0629/g, "\u0647")
    .replace(/\s+/g, "");
}

function normalizeDateKey(value: unknown) {
  const raw = cleanText(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function addDays(dateKey: string, days: number) {
  const normalized = normalizeDateKey(dateKey);
  if (!normalized) return "";
  const [year, month, day] = normalized.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + Math.trunc(days || 0), 12));
  return date.toISOString().slice(0, 10);
}

function addSpecialDate(
  target: Map<string, AttendanceSpecialDay>,
  day: AttendanceSpecialDay
) {
  const date = normalizeDateKey(day.date);
  if (!date) return;
  const next = { ...day, date };
  const current = target.get(date);
  if (!current || SPECIAL_DAY_PRIORITY[next.kind] >= SPECIAL_DAY_PRIORITY[current.kind]) {
    target.set(date, next);
  }
}

function addSpecialDateRange(
  target: Map<string, AttendanceSpecialDay>,
  fromValue: unknown,
  toValue: unknown,
  day: Omit<AttendanceSpecialDay, "date">
) {
  const fromDate = normalizeDateKey(fromValue);
  const toDate = normalizeDateKey(toValue) || fromDate;
  if (!fromDate || !toDate) return;
  buildDateKeysInRange(fromDate, toDate).forEach((date) => {
    addSpecialDate(target, { ...day, date });
  });
}

function profileIdentifierSet(profile: Record<string, any> | null | undefined, extraIds: unknown[] = []) {
  const ids = new Set<string>();
  const source = profile || {};
  [
    source.id,
    source.uid,
    source.userId,
    source.linkedUid,
    source.linkedUserId,
    source.employeeUid,
    source.employeeId,
    source.employeeDocId,
    source.linkedEmployeeDocId,
    ...extraIds,
  ].forEach((value) => {
    const clean = cleanText(value);
    if (clean) ids.add(clean);
  });
  return ids;
}

export function leaveRequestMatchesProfile(
  request: LeaveRequestLike,
  profile: Record<string, any> | null | undefined,
  extraIds: unknown[] = []
) {
  const ids = profileIdentifierSet(profile, extraIds);
  if (!ids.size) return false;
  return [
    request.employeeUid,
    request.employeeId,
    request.employeeDocId,
    request.userId,
  ].some((value) => {
    const clean = cleanText(value);
    return clean && ids.has(clean);
  });
}

function isApprovedStatus(value: unknown, defaultWhenMissing = false) {
  const raw = cleanText(value);
  if (!raw) return defaultWhenMissing;
  const token = normalizeToken(raw);
  return token === "approved" || token === "approve" || token === "accepted" || token === normalizeToken(AR_APPROVED);
}

function isPartialDay(value: unknown) {
  const token = normalizeToken(value);
  return token === "partial" || token === "halfday" || token === "half_day";
}

const BALANCE_ADJUSTMENT_TOKENS = new Set([
  "add",
  "addition",
  "credit",
  "increase",
  "deduct",
  "deduction",
  "debit",
  "decrease",
]);

function isLeaveBalanceAdjustmentEntry(source: LeaveRequestLike) {
  const token = normalizeToken(
    source.actionType || source.leaveType || source.leave_type || source.type || source.requestType || source.kind
  );
  return BALANCE_ADJUSTMENT_TOKENS.has(token);
}

function getLeavePolicy(source: LeaveRequestLike) {
  const token = normalizeToken(
    source.leaveType || source.leave_type || source.type || source.requestType || source.kind || source.actionType
  );
  if (!token) return null;
  if (token === normalizeToken(AR_REST)) return LEAVE_TYPE_POLICY.rest;
  return LEAVE_TYPE_POLICY[token] || null;
}

function leaveKindFromSource(source: LeaveRequestLike, fallback: AttendanceSpecialDayKind = "leave"): AttendanceSpecialDayKind | "" {
  if (isLeaveBalanceAdjustmentEntry(source)) return "";
  const policy = getLeavePolicy(source);
  if (!policy) return fallback;
  return policy.kind;
}

function leaveDateRange(source: LeaveRequestLike) {
  const from =
    normalizeDateKey(source.fromDate || source.startDate || source.date || source.dateKey) ||
    "";
  let to =
    normalizeDateKey(source.toDate || source.endDate || source.until || source.date || source.dateKey) ||
    from;
  const days = Number(source.days || 0);
  if (from && (!to || to === from) && Number.isFinite(days) && days > 1) {
    to = addDays(from, days - 1);
  }
  return { from, to };
}

export function buildApprovedLeaveSpecialDays(input: {
  profile?: Record<string, any> | null;
  leaveRequests?: LeaveRequestLike[];
  leaveEntries?: LeaveRequestLike[];
  extraIds?: unknown[];
  todayDateKey?: string;
}) {
  const days = new Map<string, AttendanceSpecialDay>();
  const profile = input.profile || {};
  const todayDateKey = normalizeDateKey(input.todayDateKey) || new Date().toISOString().slice(0, 10);

  const exceptionalDates = Array.isArray(profile.exceptionalLeaveDates)
    ? profile.exceptionalLeaveDates
    : [];
  exceptionalDates.forEach((date) => {
    addSpecialDate(days, {
      date: normalizeDateKey(date),
      kind: "leave",
      label: LABEL_LEAVE,
      source: "profile_exceptional_leave_date",
    });
  });

  if (profile.onLeave) {
    const leaveStart = normalizeDateKey(profile.leaveStartDate || profile.leaveFrom || profile.leaveFromDate) || todayDateKey;
    const leaveUntil = normalizeDateKey(profile.leaveUntil || profile.leaveTo || profile.leaveToDate) || leaveStart;
    addSpecialDateRange(days, leaveStart, leaveUntil, {
      kind: "leave",
      label: LABEL_LEAVE,
      source: "profile_leave",
    });
  }

  (input.leaveRequests || [])
    .filter((request) => isApprovedStatus(request.status ?? request.state, false))
    .filter((request) => !isPartialDay(request.durationKind || request.duration_kind))
    .filter((request) => leaveRequestMatchesProfile(request, profile, input.extraIds || []))
    .forEach((request) => {
      const kind = leaveKindFromSource(request, "leave");
      if (!kind) return;
      const range = leaveDateRange(request);
      addSpecialDateRange(days, range.from, range.to, {
        kind,
        label: kind === "rest" ? LABEL_REST : LABEL_LEAVE,
        source: "leave_request",
        sourceId: cleanText(request.id),
        type: cleanText(request.leaveType || request.leave_type || request.type),
      });
    });

  // Also accept leave-like entries stored on the staff profile when they
  // represent actual leave (e.g., historical approved leave records).
  // Exclude balance adjustment movements (add/deduct) from creating calendar days.
  (input.leaveEntries || [])
    .filter((entry) => isApprovedStatus(entry.status ?? entry.state, false))
    .filter((entry) => !entry.deleted)
    .forEach((entry) => {
      if (isLeaveBalanceAdjustmentEntry(entry)) return;
      const kind = leaveKindFromSource(entry, "leave");
      if (!kind) return;
      const range = leaveDateRange(entry);
      addSpecialDateRange(days, range.from, range.to, {
        kind,
        label: kind === "rest" ? LABEL_REST : LABEL_LEAVE,
        source: "leave_entry",
        sourceId: cleanText(entry.id),
        type: cleanText(entry.leaveType || entry.leave_type || entry.type),
      });
    });

  // Leave entries on the staff profile are treated as balance ledger adjustments only.
  // They must not create attendance days, even when approved, to keep leave requests
  // and approved leave records as the single source of truth for calendar leave.

  return Array.from(days.values()).sort((left, right) => left.date.localeCompare(right.date));
}

export function buildApprovedLeaveDateKeys(input: {
  profile?: Record<string, any> | null;
  leaveRequests?: LeaveRequestLike[];
  leaveEntries?: LeaveRequestLike[];
  extraIds?: unknown[];
  todayDateKey?: string;
}) {
  return buildApprovedLeaveSpecialDays(input).map((day) => day.date);
}

function getDayOverride(dateKey: string, profile: Record<string, any>) {
  const candidates = [
    profile.customWorkingHourOverrides,
    profile.workingHourOverrides,
    profile.workHourOverrides,
  ];
  for (const value of candidates) {
    const overrides = Array.isArray(value) ? value : [];
    const match = overrides.find((override) => cleanText((override as Record<string, unknown>).date) === dateKey);
    if (match) return match as Record<string, unknown>;
  }
  return null;
}

function profileWeeklyOffDaysForDate(profile: Record<string, any>, dateKey: string) {
  const historicalVersion = resolveStaffScheduleVersionForDate(profile.workingScheduleVersions, dateKey);
  if (historicalVersion) {
    return weeklyOffDaysFromScheduleSnapshot({
      useCustomWorkingHours: historicalVersion.useCustomWorkingHours,
      customWorkingHours: historicalVersion.customWorkingHours,
    });
  }

  const useCustomWorkingHours = profile.useCustomWorkingHours === true;
  const customHours = (profile.customWorkingHours || {}) as Record<string, { enabled?: boolean }>;
  const customOffDays = useCustomWorkingHours
    ? Object.entries(customHours)
        .filter(([, day]) => day?.enabled === false)
        .map(([key]) => WEEKDAY_TO_OFF_KEY[key] || key)
        .filter(Boolean)
    : [];

  return [
    ...(Array.isArray(profile.weeklyOffDays) ? profile.weeklyOffDays : []),
    ...(Array.isArray(profile.offDays) ? profile.offDays : []),
    ...(Array.isArray(profile.exceptionalLeaveWeekdays) ? profile.exceptionalLeaveWeekdays : []),
    ...(profile.weeklyOffDay ? [profile.weeklyOffDay] : []),
    ...(profile.fixedWeeklyDayOff ? [profile.fixedWeeklyDayOff] : []),
    ...(profile.weeklyHoliday ? [profile.weeklyHoliday] : []),
    ...(profile.dayOff ? [profile.dayOff] : []),
    ...customOffDays,
  ];
}

function isCoreResolvedOff(value: unknown) {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return normalizeToken(row.exceptionType || row.exception_type) === "off";
}

export function buildAttendanceSpecialDayMap(input: {
  profile?: Record<string, any> | null;
  leaveRequests?: LeaveRequestLike[];
  leaveEntries?: LeaveRequestLike[];
  extraIds?: unknown[];
  fromDate: string;
  toDate: string;
  todayDateKey?: string;
  coreResolvedShifts?: Record<string, unknown> | Array<{ date?: unknown; dateKey?: unknown; resolvedShift?: unknown }>;
}) {
  const fromDate = normalizeDateKey(input.fromDate);
  const toDate = normalizeDateKey(input.toDate) || fromDate;
  const days = new Map<string, AttendanceSpecialDay>();
  if (!fromDate || !toDate) return days;

  buildApprovedLeaveSpecialDays(input)
    .filter((day) => day.date >= fromDate && day.date <= toDate)
    .forEach((day) => addSpecialDate(days, day));

  const profile = input.profile || {};
  buildDateKeysInRange(fromDate, toDate).forEach((date) => {
    const override = getDayOverride(date, profile);
    if (override?.enabled === false) {
      addSpecialDate(days, {
        date,
        kind: "exception_off",
        label: LABEL_EXCEPTION_OFF,
        source: "custom_working_hour_override",
      });
      return;
    }
    if (override?.enabled === true) {
      // An explicit working override re-opens a normally closed weekly-off day
      // for this date only. Do not also label the same date as weekly off.
      return;
    }

    if (isWeeklyOffDateKey(date, profileWeeklyOffDaysForDate(profile, date))) {
      addSpecialDate(days, {
        date,
        kind: "weekly_off",
        label: LABEL_WEEKLY_OFF,
        source: "weekly_schedule",
      });
    }
  });

  const coreShifts = input.coreResolvedShifts;
  if (Array.isArray(coreShifts)) {
    coreShifts.forEach((item) => {
      const date = normalizeDateKey(item.date || item.dateKey);
      if (!date || date < fromDate || date > toDate || !isCoreResolvedOff(item.resolvedShift || item)) return;
      addSpecialDate(days, {
        date,
        kind: "exception_off",
        label: LABEL_EXCEPTION_OFF,
        source: "core_exception_off",
      });
    });
  } else if (coreShifts && typeof coreShifts === "object") {
    Object.entries(coreShifts).forEach(([dateValue, shift]) => {
      const date = normalizeDateKey(dateValue);
      if (!date || date < fromDate || date > toDate || !isCoreResolvedOff(shift)) return;
      addSpecialDate(days, {
        date,
        kind: "exception_off",
        label: LABEL_EXCEPTION_OFF,
        source: "core_exception_off",
      });
    });
  }

  return days;
}
