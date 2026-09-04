import { buildDateKeysInRange } from "./workSchedule.ts";

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
  partialStartTime?: unknown;
  partialEndTime?: unknown;
  partial_start_time?: unknown;
  partial_end_time?: unknown;
  deleted?: unknown;
};

export type AttendanceSpecialDayKind =
  | "leave"
  | "partial_leave"
  | "rest"
  | "weekly_off"
  | "weekly_rest_work"
  | "exception_off";

export type AttendanceSpecialDay = {
  date: string;
  kind: AttendanceSpecialDayKind;
  label: string;
  source: string;
  sourceId?: string;
  type?: string;
  partialStartTime?: string;
  partialEndTime?: string;
};

const LABEL_LEAVE = "\u0625\u062c\u0627\u0632\u0629";
const LABEL_PARTIAL_LEAVE = "\u0627\u0633\u062a\u0626\u0630\u0627\u0646";
const LABEL_REST = "\u0631\u0627\u062d\u0629";
const AR_APPROVED = "\u0645\u0639\u062a\u0645\u062f";
const AR_REST = "\u0631\u0627\u062d\u0629";
const AR_LEAVE = "\u0625\u062c\u0627\u0632\u0629";

const SPECIAL_DAY_PRIORITY: Record<AttendanceSpecialDayKind, number> = {
  leave: 40,
  rest: 40,
  weekly_rest_work: 38,
  exception_off: 30,
  weekly_off: 20,
  partial_leave: 15,
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
  weekly_rest_substitute_use: { kind: "leave", deductFromBalance: false, affectsPayroll: false, visibleInAttendance: true },
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

  // Staff-profile leave mirrors are identity compatibility only.
  // Attendance calendar decisions come from approved canonical
  // leave requests/records below.

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

  // Partial leave is visible in attendance as an informational interval only.
  // It must never enter approvedLeaveDateKeys or behave like a full-day closure.
  (input.leaveRequests || [])
    .filter((request) => isApprovedStatus(request.status ?? request.state, false))
    .filter((request) => isPartialDay(request.durationKind || request.duration_kind))
    .filter((request) => leaveRequestMatchesProfile(request, profile, input.extraIds || []))
    .forEach((request) => {
      const range = leaveDateRange(request);
      if (!range.from) return;
      addSpecialDate(days, {
        date: range.from,
        kind: "partial_leave",
        label: LABEL_PARTIAL_LEAVE,
        source: "leave_request",
        sourceId: cleanText(request.id),
        type: cleanText(request.leaveType || request.leave_type || request.type),
        partialStartTime: cleanText(request.partialStartTime || request.partial_start_time),
        partialEndTime: cleanText(request.partialEndTime || request.partial_end_time),
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
  return buildApprovedLeaveSpecialDays(input)
    .filter((day) => day.kind !== "partial_leave")
    .map((day) => day.date);
}
