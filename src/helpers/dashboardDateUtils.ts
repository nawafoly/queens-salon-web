export type DashboardWeekdayKey =
  | "sat"
  | "sun"
  | "mon"
  | "tue"
  | "wed"
  | "thu"
  | "fri";

const JS_DAY_TO_DASHBOARD_WEEKDAY: DashboardWeekdayKey[] = [
  "sun",
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
];

export function formatLocalDateISO(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function weekdayKeyFromISODate(
  dateValue: string,
): DashboardWeekdayKey | null {
  const match = String(dateValue || "")
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (!match) return null;

  const date = new Date(
    Number(match[1]),
    Math.max(0, Number(match[2]) - 1),
    Number(match[3]),
  );

  return JS_DAY_TO_DASHBOARD_WEEKDAY[date.getDay()] || null;
}
