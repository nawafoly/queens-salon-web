import { CoreBookingService } from "./CoreBookingService";
import { coreBookingToLegacy } from "./coreBookingMappers";
import type { BookingDocWithId } from "../types/bookingRecord";

/** Canonical Core D1 booking rows used by operational and finance reports. */
export async function listCoreBookings(): Promise<BookingDocWithId[]> {
  return (await CoreBookingService.list()).map((row) => ({
    ...coreBookingToLegacy(row),
    source: "core-d1" as const,
  }));
}
