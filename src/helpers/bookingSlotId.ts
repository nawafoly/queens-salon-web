const DEFAULT_SALON_ID = "main";

function safeBookingSlotKey(value: unknown): string {
  return String(value || "")
    .trim()
    .replaceAll("/", "-")
    .replace(/\s+/g, "_");
}

/**
 * Compatibility/display identifier only.
 *
 * This does not reserve a slot and must never be used as booking availability
 * authority. Core HR availability + the Core booking write policy are the only
 * operational authority.
 */
export function buildBookingSlotId(
  date: string,
  time: string,
  employeeKey: string,
  salonId = DEFAULT_SALON_ID
): string {
  return [salonId, date, time, employeeKey].map(safeBookingSlotKey).join("__");
}
