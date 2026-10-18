import { CoreBookingService } from "./CoreBookingService";
import { coreBookingToLegacy } from "./coreBookingMappers";
import type { BookingDocWithId, BookingStatus } from "../types/bookingRecord";

/** Matches the historical Core-only read scope; no Firestore branch. */
export type BookingReadScope = {
  statuses?: BookingStatus[];
  dateFrom?: string;
  dateTo?: string;
};

function scopeAllowsBooking(row: BookingDocWithId, scope?: BookingReadScope): boolean {
  const statuses = new Set(scope?.statuses || []);
  if (statuses.size && !statuses.has(row.status)) return false;
  if (scope?.dateFrom && String(row.date || "") < scope.dateFrom) return false;
  if (scope?.dateTo && String(row.date || "") > scope.dateTo) return false;
  return true;
}

/** Core D1 bookings used by reports and employee booking statistics. */
export async function listCoreBookings(scope?: BookingReadScope): Promise<BookingDocWithId[]> {
  return (await CoreBookingService.list()).map((row) => ({
    ...coreBookingToLegacy(row),
    source: "core-d1" as const,
  })).filter((row) => scopeAllowsBooking(row, scope));
}
