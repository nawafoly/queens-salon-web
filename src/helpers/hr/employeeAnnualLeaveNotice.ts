// UI hint only. Core enforces the employee-only notice policy authoritatively.
export function minimumAnnualLeaveRequestDate(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Riyadh",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const read = (key: string) => parts.find((part) => part.type === key)?.value || "";
  const utc = Date.UTC(Number(read("year")), Number(read("month")) - 1, Number(read("day")));
  return new Date(utc + 3 * 86_400_000).toISOString().slice(0, 10);
}
