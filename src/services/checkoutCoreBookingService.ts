import { resolveBookingDataSource } from "./bookingDataSource";
import { CoreSettingsService } from "./CoreSettingsService";
import type { BookingDoc, BookingStatus } from "./firestoreBookings";

export type { BookingStatus } from "./firestoreBookings";

type BookingRuntimeSettings = {
  booking?: {
    slotStepMin?: number;
    bufferMin?: number;
  };
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizedName(value: unknown): string {
  return text(value).replace(/\s+/g, " ").toLocaleLowerCase("ar");
}

async function resolveAuthoritativeBookingSettings() {
  const setting = await CoreSettingsService.get<BookingRuntimeSettings>("app");
  const booking = setting?.value?.booking || {};
  return {
    slotStepMin: Math.max(1, Number(booking.slotStepMin || 10)),
    bufferMin: Math.max(0, Number(booking.bufferMin || 0)),
  };
}

async function resolveAuthoritativeService(input: BookingDoc) {
  const dataSource = resolveBookingDataSource();
  const services = await dataSource.getServices();
  const requestedId = text(input.serviceId);
  const requestedLegacy = text(input.serviceName);
  const requestedLegacyKey = normalizedName(requestedLegacy);

  const service =
    services.find((row) => requestedId && text(row.id) === requestedId) ||
    services.find((row) => requestedLegacy && text(row.id) === requestedLegacy) ||
    services.find((row) => requestedLegacyKey && normalizedName((row as any)?.الاسم) === requestedLegacyKey) ||
    null;

  if (!service) {
    const error = new Error("SERVICE_NOT_FOUND");
    (error as Error & { code?: string }).code = "SERVICE_NOT_FOUND";
    throw error;
  }

  return service;
}

/**
 * Core-only checkout write.
 *
 * Old checkout drafts are normalized here before the write:
 * - service ID is re-resolved from the D1 catalog;
 * - slot step and buffer are re-read from Core settings;
 * - the Core booking endpoint re-validates staff_services, dated HR shift,
 *   leave/absence, duration and buffer before committing the booking.
 */
export async function createBooking(input: BookingDoc) {
  const dataSource = resolveBookingDataSource();
  const [service, settings] = await Promise.all([
    resolveAuthoritativeService(input),
    resolveAuthoritativeBookingSettings(),
  ]);

  const serviceId = text(service.id);
  const serviceName = text((service as any)?.الاسم) || text(input.serviceName) || serviceId;
  const durationMin = Math.max(1, Number((service as any)?.المدة || input.durationMin || 30));

  return dataSource.createBooking({
    ...input,
    serviceId,
    serviceName,
    durationMin,
    slotStepMinAtBooking: settings.slotStepMin,
    bufferMinAtBooking: settings.bufferMin,
  });
}

export type CheckoutBookingStatus = BookingStatus;
