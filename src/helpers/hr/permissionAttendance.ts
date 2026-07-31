const MINUTES_PER_DAY = 24 * 60;
const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;
const RIYADH_TIME_ZONE = "Asia/Riyadh";

export type PermissionIntervalInput = {
  id?: string | null;
  date?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  status?: string | null;
  financialEffect?: string | null;
};

export type PermissionCoverageResult = {
  requestedMinutes: number;
  scheduledPermissionMinutes: number;
  candidateMissingMinutes: number;
  rawMissingMinutes: number;
  coveredMissingMinutes: number;
  adjustedMissingMinutes: number;
  mergedIntervals: Array<{ start: number; end: number }>;
};

type AttendanceLikeRecord = Record<string, unknown> & {
  type?: string;
  recordType?: string;
  serverTime?: string | null;
  recordedAt?: string | null;
  idempotencyKey?: string | null;
  idempotency_key?: string | null;
  note?: string | null;
};

type PermissionRequestLike = Record<string, unknown> & {
  id?: string;
  date?: string;
  dateKey?: string;
  startTime?: string;
  requestedExitTime?: string;
  actualExitTime?: string;
  expectedReturnTime?: string;
  actualReturnTime?: string;
  status?: string;
  financialEffect?: string;
};

const RIYADH_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: RIYADH_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeDateKey(value: unknown) {
  const text = clean(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function dateSerial(dateKey: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / MILLIS_PER_DAY;
}

function normalizeTime(value: unknown) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clean(value));
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return "";
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function timeMinutes(value: unknown) {
  const normalized = normalizeTime(value);
  if (!normalized) return null;
  const [hour, minute] = normalized.split(":").map(Number);
  return hour * 60 + minute;
}

function riyadhTimestampOffset(value: unknown, dateKey: string) {
  const date = new Date(clean(value));
  if (!Number.isFinite(date.getTime())) return null;
  const parts = RIYADH_FORMATTER.formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  const eventDateKey = `${get("year")}-${get("month")}-${get("day")}`;
  const base = dateSerial(dateKey);
  const event = dateSerial(eventDateKey);
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  if (base == null || event == null || !Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return Math.round(event - base) * MINUTES_PER_DAY + hour * 60 + minute;
}

function normalizeInterval(interval: PermissionIntervalInput, dateKey: string) {
  let start = interval.startAt ? riyadhTimestampOffset(interval.startAt, dateKey) : timeMinutes(interval.startTime);
  let end = interval.endAt ? riyadhTimestampOffset(interval.endAt, dateKey) : timeMinutes(interval.endTime);
  if (start == null || end == null) return null;
  // Equal times mean a zero-duration/invalid record, not a 24-hour permission.
  if (end === start) return null;
  // Only a strictly earlier return time is treated as crossing midnight.
  if (end < start) end += MINUTES_PER_DAY;
  if (end <= start) return null;
  return { start, end };
}

function mergeIntervals(intervals: Array<{ start: number; end: number }>) {
  const sorted = intervals
    .filter((item) => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const merged: Array<{ start: number; end: number }> = [];
  for (const current of sorted) {
    const previous = merged[merged.length - 1];
    if (!previous || current.start > previous.end) {
      merged.push({ ...current });
    } else {
      previous.end = Math.max(previous.end, current.end);
    }
  }
  return merged;
}

function intersectionMinutes(
  left: Array<{ start: number; end: number }>,
  right: Array<{ start: number; end: number }>
) {
  let total = 0;
  for (const a of left) {
    for (const b of right) {
      total += Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
    }
  }
  return total;
}

function subtractInterval(
  base: { start: number; end: number },
  worked: { start: number; end: number } | null
) {
  if (!worked || worked.end <= base.start || worked.start >= base.end) return [base];
  const result: Array<{ start: number; end: number }> = [];
  if (worked.start > base.start) result.push({ start: base.start, end: Math.min(worked.start, base.end) });
  if (worked.end < base.end) result.push({ start: Math.max(worked.end, base.start), end: base.end });
  return result.filter((item) => item.end > item.start);
}

export function calculatePermissionCoverage(input: {
  date: string;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  checkInAt?: string | null;
  checkOutAt?: string | null;
  rawMissingMinutes?: number | null;
  intervals?: PermissionIntervalInput[] | null;
}): PermissionCoverageResult {
  const dateKey = normalizeDateKey(input.date);
  const scheduleStart = timeMinutes(input.scheduledStart);
  let scheduleEnd = timeMinutes(input.scheduledEnd);
  const baseIntervals = mergeIntervals(
    (input.intervals || [])
      .map((interval) => normalizeInterval(interval, dateKey))
      .filter((item): item is { start: number; end: number } => Boolean(item))
  );
  const requestedMinutes = baseIntervals.reduce((sum, item) => sum + item.end - item.start, 0);

  if (!dateKey || scheduleStart == null || scheduleEnd == null) {
    const rawMissingMinutes = Math.max(0, Math.round(Number(input.rawMissingMinutes || 0)));
    return {
      requestedMinutes,
      scheduledPermissionMinutes: 0,
      candidateMissingMinutes: 0,
      rawMissingMinutes,
      coveredMissingMinutes: 0,
      adjustedMissingMinutes: rawMissingMinutes,
      mergedIntervals: baseIntervals,
    };
  }

  if (scheduleEnd <= scheduleStart) scheduleEnd += MINUTES_PER_DAY;
  const scheduleWindow = { start: scheduleStart, end: scheduleEnd };
  const normalizedIntervals = mergeIntervals(
    baseIntervals.map((interval) =>
      scheduleEnd > MINUTES_PER_DAY && interval.end <= scheduleStart
        ? { start: interval.start + MINUTES_PER_DAY, end: interval.end + MINUTES_PER_DAY }
        : interval
    )
  );
  let checkIn = riyadhTimestampOffset(input.checkInAt, dateKey);
  let checkOut = riyadhTimestampOffset(input.checkOutAt, dateKey);
  if (checkIn != null && checkOut != null && checkOut < checkIn) checkOut += MINUTES_PER_DAY;
  const worked = checkIn != null && checkOut != null && checkOut > checkIn
    ? { start: Math.max(scheduleWindow.start, checkIn), end: Math.min(scheduleWindow.end, checkOut) }
    : null;
  const workedClipped = worked && worked.end > worked.start ? worked : null;
  const missingSegments = subtractInterval(scheduleWindow, workedClipped);
  const scheduledPermissionMinutes = intersectionMinutes(normalizedIntervals, [scheduleWindow]);
  const candidateMissingMinutes = missingSegments.reduce((sum, item) => sum + item.end - item.start, 0);
  const defaultRawMissing = Math.max(0, scheduleWindow.end - scheduleWindow.start - (workedClipped ? workedClipped.end - workedClipped.start : 0));
  const rawMissingMinutes = Math.max(
    0,
    Math.round(input.rawMissingMinutes == null ? defaultRawMissing : Number(input.rawMissingMinutes))
  );
  const potentialCovered = intersectionMinutes(normalizedIntervals, missingSegments);
  const coveredMissingMinutes = Math.min(rawMissingMinutes, potentialCovered);

  return {
    requestedMinutes,
    scheduledPermissionMinutes,
    candidateMissingMinutes,
    rawMissingMinutes,
    coveredMissingMinutes,
    adjustedMissingMinutes: Math.max(0, rawMissingMinutes - coveredMissingMinutes),
    mergedIntervals: normalizedIntervals,
  };
}

function permissionRecordType(record: AttendanceLikeRecord) {
  return clean(record.recordType || record.type).toLowerCase();
}

function permissionRecordTime(record: AttendanceLikeRecord) {
  return clean(record.recordedAt || record.serverTime) || null;
}

function permissionRecordKey(record: AttendanceLikeRecord, index: number) {
  const idempotency = clean(record.idempotencyKey || record.idempotency_key);
  const match = /^permission:(.+?):permission_(?:out|return)$/.exec(idempotency);
  if (match) return match[1];
  const note = clean(record.note);
  const noteId = /(?:^|[•|\s])((?:permission|perm)_[A-Za-z0-9_-]+)(?:$|[•|\s])/.exec(note);
  return noteId?.[1] || `sequential_${index}`;
}

export function permissionIntervalsFromAttendanceRecords(
  records: AttendanceLikeRecord[],
  date: string
): PermissionIntervalInput[] {
  const groups = new Map<string, { out?: string | null; returned?: string | null }>();
  let sequentialOutKeys: string[] = [];
  records.forEach((record, index) => {
    const type = permissionRecordType(record);
    if (type !== "permission_out" && type !== "permission_return") return;
    let key = permissionRecordKey(record, index);
    if (key.startsWith("sequential_")) {
      if (type === "permission_out") {
        sequentialOutKeys.push(key);
      } else {
        key = sequentialOutKeys.shift() || key;
      }
    }
    const current = groups.get(key) || {};
    if (type === "permission_out") current.out = permissionRecordTime(record);
    if (type === "permission_return") current.returned = permissionRecordTime(record);
    groups.set(key, current);
  });
  return Array.from(groups.entries())
    .filter(([, value]) => value.out && value.returned)
    .map(([id, value]) => ({ id, date, startAt: value.out, endAt: value.returned, status: "returned" }));
}

export function permissionIntervalsFromRequests(
  entries: PermissionRequestLike[] | null | undefined,
  date: string
): PermissionIntervalInput[] {
  const dateKey = normalizeDateKey(date);
  return (entries || [])
    .filter((entry) => {
      const status = clean(entry.status).toLowerCase();
      const entryDate = normalizeDateKey(entry.date || entry.dateKey);
      return status === "returned" && entryDate === dateKey;
    })
    .map((entry) => ({
      id: clean(entry.id) || null,
      date: dateKey,
      startTime: clean(entry.actualExitTime || entry.startTime || entry.requestedExitTime),
      endTime: clean(entry.actualReturnTime || entry.expectedReturnTime),
      status: clean(entry.status),
      financialEffect: clean(entry.financialEffect),
    }))
    .filter((entry) => normalizeTime(entry.startTime) && normalizeTime(entry.endTime));
}

export function roundPermissionHours(minutes: number) {
  return Math.round((Math.max(0, Number(minutes) || 0) / 60) * 100) / 100;
}
