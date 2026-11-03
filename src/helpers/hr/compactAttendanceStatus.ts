/**
 * Presentation-only shorthand for narrow attendance calendar cells.
 *
 * The employee's canonical attendance status always wins over additional
 * partial-day leave metadata. Partial leave is informational: it must never
 * hide an absence, late arrival, early departure, missing hours or incomplete
 * punch. No payroll, leave entitlement or Core status is recalculated here.
 */
export function compactAttendanceStatus(
  status: string,
  interactive: boolean,
  hasPartialLeave: boolean
): string {
  if (!interactive) return "—";
  if (status.includes("دوام في")) return "دوام";
  if (status.includes("غياب")) return "غياب";
  if (status.includes("خروج مبكر")) return "خروج مبكر";
  if (status.includes("تأخير")) return "تأخير";
  if (status.includes("نقص ساعات")) return "نقص ساعات";
  if (status.includes("غير مكتمل")) return "غير مكتمل";
  if (status.includes("استئذان")) return "استئذان";
  if (status.includes("راحة")) return "راحة";
  if (status.includes("إجازة")) return "إجازة";
  if (status.includes("حضور")) return "حضور";
  // A partial leave is a time interval, not an excuse for a full-day absence
  // nor an override of an otherwise valid recorded attendance status.
  if (hasPartialLeave) return "استئذان";
  return "—";
}
