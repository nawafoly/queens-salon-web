import { buildDateKeysInRange } from "./workSchedule";

type LeaveRequestLike = {
  employeeUid?: unknown;
  employeeId?: unknown;
  employeeDocId?: unknown;
  userId?: unknown;
  status?: unknown;
  fromDate?: unknown;
  toDate?: unknown;
  startDate?: unknown;
  endDate?: unknown;
};

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function normalizeDateKey(value: unknown) {
  const raw = cleanText(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function addDateRange(target: Set<string>, fromValue: unknown, toValue: unknown) {
  const fromDate = normalizeDateKey(fromValue);
  const toDate = normalizeDateKey(toValue) || fromDate;
  if (!fromDate || !toDate) return;
  buildDateKeysInRange(fromDate, toDate).forEach((dateKey) => target.add(dateKey));
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

export function buildApprovedLeaveDateKeys(input: {
  profile?: Record<string, any> | null;
  leaveRequests?: LeaveRequestLike[];
  extraIds?: unknown[];
  todayDateKey?: string;
}) {
  const dates = new Set<string>();
  const profile = input.profile || {};
  const todayDateKey = normalizeDateKey(input.todayDateKey) || new Date().toISOString().slice(0, 10);

  const exceptionalDates = Array.isArray(profile.exceptionalLeaveDates)
    ? profile.exceptionalLeaveDates
    : [];
  exceptionalDates.forEach((date) => {
    const dateKey = normalizeDateKey(date);
    if (dateKey) dates.add(dateKey);
  });

  if (profile.onLeave) {
    const leaveStart = normalizeDateKey(profile.leaveStartDate || profile.leaveFrom || profile.leaveFromDate) || todayDateKey;
    const leaveUntil = normalizeDateKey(profile.leaveUntil || profile.leaveTo || profile.leaveToDate) || leaveStart;
    addDateRange(dates, leaveStart, leaveUntil);
  }

  (input.leaveRequests || [])
    .filter((request) => cleanText(request.status).toLowerCase() === "approved")
    .filter((request) => leaveRequestMatchesProfile(request, profile, input.extraIds || []))
    .forEach((request) => {
      addDateRange(
        dates,
        request.fromDate || request.startDate,
        request.toDate || request.endDate || request.fromDate || request.startDate
      );
    });

  return Array.from(dates).sort((left, right) => left.localeCompare(right));
}
