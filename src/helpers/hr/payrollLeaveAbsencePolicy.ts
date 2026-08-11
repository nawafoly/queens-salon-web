export type PayrollLeavePolicyInput = {
  status?: unknown;
  leaveType?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  daysCount?: unknown;
  durationKind?: unknown;
  partialStartTime?: unknown;
  partialEndTime?: unknown;
};

export type PayrollAbsencePolicyInput = {
  dateKey?: unknown;
  absenceType?: unknown;
};

export type PayrollPermissionIntervalLike = {
  startTime?: string | null;
  endTime?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  [key: string]: unknown;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTES_PER_DAY = 24 * 60;
const RIYADH_TIME_ZONE = "Asia/Riyadh";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeDateKey(value: unknown) {
  const raw = text(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function dateFromKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function dateKeysInRange(startDate: string, endDate: string) {
  const start = normalizeDateKey(startDate);
  const end = normalizeDateKey(endDate);
  if (!start || !end || start > end) return [] as string[];
  const rows: string[] = [];
  for (let cursor = dateFromKey(start); cursor.getTime() <= dateFromKey(end).getTime(); cursor = new Date(cursor.getTime() + DAY_MS)) {
    rows.push(cursor.toISOString().slice(0, 10));
  }
  return rows;
}

function clampDayUnit(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.min(1, Math.round(number * 1000) / 1000);
}

function timeMinutes(value: unknown) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text(value));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

export function payrollIntervalHours(startValue: unknown, endValue: unknown) {
  const start = timeMinutes(startValue);
  let end = timeMinutes(endValue);
  if (start == null || end == null) return 0;
  if (end <= start) end += MINUTES_PER_DAY;
  return Math.round(((end - start) / 60) * 100) / 100;
}

function partialLeaveDayUnit(leave: PayrollLeavePolicyInput) {
  const stored = clampDayUnit(leave.daysCount);
  if (stored > 0) return stored;
  const hours = payrollIntervalHours(leave.partialStartTime, leave.partialEndTime);
  return hours > 0 ? clampDayUnit(hours / 8) : 0;
}

export function isApprovedPayrollLeave(leave: PayrollLeavePolicyInput) {
  return text(leave.status).toLowerCase() === "approved";
}

export function isPartialPayrollLeave(leave: PayrollLeavePolicyInput) {
  return text(leave.durationKind).toLowerCase() === "partial";
}

function leaveMatchesKind(leave: PayrollLeavePolicyInput, kind: "paid" | "unpaid" | "all") {
  const unpaid = text(leave.leaveType).toLowerCase() === "unpaid";
  if (kind === "paid") return !unpaid;
  if (kind === "unpaid") return unpaid;
  return true;
}

function mergeMax(target: Map<string, number>, date: string, value: number) {
  if (!date || value <= 0) return;
  target.set(date, Math.max(target.get(date) || 0, value));
}

export function payrollLeaveDayUnits(
  leaves: PayrollLeavePolicyInput[],
  startDate: string,
  endDate: string,
  kind: "paid" | "unpaid" | "all" = "all"
) {
  const units = new Map<string, number>();
  for (const leave of leaves || []) {
    if (!isApprovedPayrollLeave(leave) || !leaveMatchesKind(leave, kind)) continue;
    const from = normalizeDateKey(leave.startDate);
    const to = normalizeDateKey(leave.endDate) || from;
    if (!from || !to) continue;
    if (isPartialPayrollLeave(leave)) {
      if (from >= startDate && from <= endDate) mergeMax(units, from, partialLeaveDayUnit(leave));
      continue;
    }
    const clippedFrom = from > startDate ? from : startDate;
    const clippedTo = to < endDate ? to : endDate;
    dateKeysInRange(clippedFrom, clippedTo).forEach((date) => mergeMax(units, date, 1));
  }
  return units;
}

export function fullDayPaidLeaveDates(
  leaves: PayrollLeavePolicyInput[],
  startDate: string,
  endDate: string
) {
  const dates = new Set<string>();
  for (const leave of leaves || []) {
    if (!isApprovedPayrollLeave(leave)) continue;
    if (text(leave.leaveType).toLowerCase() === "unpaid") continue;
    if (isPartialPayrollLeave(leave)) continue;
    const from = normalizeDateKey(leave.startDate);
    const to = normalizeDateKey(leave.endDate) || from;
    if (!from || !to) continue;
    const clippedFrom = from > startDate ? from : startDate;
    const clippedTo = to < endDate ? to : endDate;
    dateKeysInRange(clippedFrom, clippedTo).forEach((date) => dates.add(date));
  }
  return dates;
}

export function payrollAbsenceDayUnits(
  absences: PayrollAbsencePolicyInput[],
  startDate: string,
  endDate: string
) {
  const units = new Map<string, number>();
  for (const absence of absences || []) {
    const date = normalizeDateKey(absence.dateKey);
    if (!date || date < startDate || date > endDate) continue;
    const unit = text(absence.absenceType).toLowerCase() === "half_day" ? 0.5 : 1;
    mergeMax(units, date, unit);
  }
  return units;
}

export function mergePayrollDayUnits(...sources: Array<Map<string, number>>) {
  const merged = new Map<string, number>();
  sources.forEach((source) => source.forEach((value, date) => mergeMax(merged, date, value)));
  return merged;
}

export function totalPayrollDayUnits(units: Map<string, number>) {
  return Math.round(Array.from(units.values()).reduce((sum, value) => sum + value, 0) * 1000) / 1000;
}

function riyadhHHMM(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: RIYADH_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const hour = parts.find((part) => part.type === "hour")?.value || "";
  const minute = parts.find((part) => part.type === "minute")?.value || "";
  return hour && minute ? `${hour}:${minute}` : "";
}

export function unpaidPartialLeaveIntervalsForDate(
  leaves: PayrollLeavePolicyInput[],
  date: string
) {
  return (leaves || [])
    .filter((leave) => isApprovedPayrollLeave(leave))
    .filter((leave) => text(leave.leaveType).toLowerCase() === "unpaid")
    .filter((leave) => isPartialPayrollLeave(leave))
    .filter((leave) => normalizeDateKey(leave.startDate) === date)
    .map((leave) => ({
      startTime: text(leave.partialStartTime),
      endTime: text(leave.partialEndTime),
      hours: payrollIntervalHours(leave.partialStartTime, leave.partialEndTime),
    }))
    .filter((interval) => interval.startTime && interval.endTime && interval.hours > 0);
}

export function filterPaidPermissionIntervals<T extends PayrollPermissionIntervalLike>(
  intervals: T[],
  unpaidPartialLeaves: PayrollLeavePolicyInput[],
  date: string
) {
  const unpaidIntervals = unpaidPartialLeaveIntervalsForDate(unpaidPartialLeaves, date);
  if (!unpaidIntervals.length) return intervals;
  return (intervals || []).filter((interval) => {
    const start = text(interval.startTime) || riyadhHHMM(interval.startAt);
    const end = text(interval.endTime) || riyadhHHMM(interval.endAt);
    return !unpaidIntervals.some((unpaid) => unpaid.startTime === start && unpaid.endTime === end);
  });
}
