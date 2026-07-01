function formatNumberEN(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export type WorkScheduleWeekday =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";

export const WORK_SCHEDULE_WEEKDAYS: Array<{
  value: WorkScheduleWeekday;
  label: string;
  shortLabel: string;
}> = [
  { value: "sunday", label: "الأحد", shortLabel: "أحد" },
  { value: "monday", label: "الاثنين", shortLabel: "اثنين" },
  { value: "tuesday", label: "الثلاثاء", shortLabel: "ثلاثاء" },
  { value: "wednesday", label: "الأربعاء", shortLabel: "أربعاء" },
  { value: "thursday", label: "الخميس", shortLabel: "خميس" },
  { value: "friday", label: "الجمعة", shortLabel: "جمعة" },
  { value: "saturday", label: "السبت", shortLabel: "سبت" },
];

const WEEKDAY_BY_INDEX: WorkScheduleWeekday[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const WEEKDAY_ALIASES: Record<string, WorkScheduleWeekday> = {
  "0": "sunday",
  "sun": "sunday",
  "sunday": "sunday",
  "الأحد": "sunday",
  "الاحد": "sunday",
  "1": "monday",
  "mon": "monday",
  "monday": "monday",
  "الاثنين": "monday",
  "الإثنين": "monday",
  "2": "tuesday",
  "tue": "tuesday",
  "tuesday": "tuesday",
  "الثلاثاء": "tuesday",
  "3": "wednesday",
  "wed": "wednesday",
  "wednesday": "wednesday",
  "الأربعاء": "wednesday",
  "الاربعاء": "wednesday",
  "4": "thursday",
  "thu": "thursday",
  "thursday": "thursday",
  "الخميس": "thursday",
  "5": "friday",
  "fri": "friday",
  "friday": "friday",
  "الجمعة": "friday",
  "6": "saturday",
  "sat": "saturday",
  "saturday": "saturday",
  "السبت": "saturday",
};

function parseDateKey(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  return { year, month, day };
}

function formatDateKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function normalizeWeeklyOffDays(value: unknown): WorkScheduleWeekday[] {
  const rawItems = Array.isArray(value)
    ? value
    : String(value || "")
        .split(/[,\s]+/)
        .filter(Boolean);
  const selected = new Set<WorkScheduleWeekday>();

  for (const item of rawItems) {
    const normalized = String(item || "").trim().toLowerCase();
    const day = WEEKDAY_ALIASES[normalized];
    if (day) selected.add(day);
  }

  return WORK_SCHEDULE_WEEKDAYS.map(day => day.value).filter(day =>
    selected.has(day)
  );
}

export function formatWeeklyOffDaysLabel(value: unknown) {
  const days = normalizeWeeklyOffDays(value);
  if (!days.length) return "غير محدد";

  const labels = days.map(
    day => WORK_SCHEDULE_WEEKDAYS.find(option => option.value === day)?.label || day
  );
  return labels.join("، ");
}

export function getWeekdayKeyForDateKey(dateKey: string) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return null;

  const date = new Date(
    Date.UTC(parsed.year, parsed.month - 1, parsed.day, 12, 0, 0, 0)
  );
  return WEEKDAY_BY_INDEX[date.getUTCDay()] || null;
}

export function isWeeklyOffDateKey(
  dateKey: string,
  weeklyOffDays: unknown
) {
  const weekday = getWeekdayKeyForDateKey(dateKey);
  if (!weekday) return false;
  return normalizeWeeklyOffDays(weeklyOffDays).includes(weekday);
}

export function buildDateKeysInRange(fromDate: string, toDate: string) {
  const start = parseDateKey(fromDate);
  const end = parseDateKey(toDate);
  if (!start || !end) return [];

  const startMs = Date.UTC(start.year, start.month - 1, start.day, 12, 0, 0, 0);
  const endMs = Date.UTC(end.year, end.month - 1, end.day, 12, 0, 0, 0);
  if (endMs < startMs) return [];

  const keys: string[] = [];
  for (let current = startMs; current <= endMs; current += 24 * 60 * 60 * 1000) {
    keys.push(formatDateKey(new Date(current)));
  }
  return keys;
}

export function buildWorkDateKeysInRange(input: {
  fromDate: string;
  toDate: string;
  weeklyOffDays?: unknown;
  excludedDateKeys?: Iterable<string>;
}) {
  const excluded = new Set(input.excludedDateKeys || []);
  return buildDateKeysInRange(input.fromDate, input.toDate).filter(dateKey => {
    if (excluded.has(dateKey)) return false;
    return !isWeeklyOffDateKey(dateKey, input.weeklyOffDays);
  });
}

export function formatWorkDaysCountLabel(value: number) {
  return `${formatNumberEN(Math.max(0, value))} يوم عمل`;
}



