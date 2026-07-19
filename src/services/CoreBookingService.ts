import { coreApiRequest } from "./coreApiClient";
import { mapCoreBooking } from "./coreBookingMappers";
import type { CoreBooking, CoreCreateBookingInput } from "../types/coreApi";

export type CoreBookingSearch = {
  date?: string;
  search?: string;
  clientId?: string;
  staffId?: string;
  status?: string;
};

export const CoreBookingService = {
  async list(query: CoreBookingSearch = {}): Promise<CoreBooking[]> {
    const rows = await coreApiRequest<Record<string, unknown>[]>(
      "/api/core/bookings",
      { query }
    );
    return rows.map(mapCoreBooking);
  },

  async get(id: string): Promise<CoreBooking> {
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/bookings/${encodeURIComponent(id)}`
    );
    return mapCoreBooking(row);
  },

  async create(input: CoreCreateBookingInput): Promise<CoreBooking> {
    const row = await coreApiRequest<Record<string, unknown>>(
      "/api/core/bookings",
      {
        method: "POST",
        body: input as unknown as Record<string, unknown>,
      }
    );
    return mapCoreBooking(row);
  },

  async createInternal(input: CoreCreateBookingInput): Promise<CoreBooking> {
    const row = await coreApiRequest<Record<string, unknown>>(
      "/api/core/internal/bookings",
      {
        method: "POST",
        body: input as unknown as Record<string, unknown>,
      }
    );
    return mapCoreBooking(row);
  },

  async patch(
    id: string,
    input: Partial<{
      status: string;
      notes: string | null;
      paymentStatus: string;
      bookingDate: string;
      startTime: string;
      endTime: string;
      staffId: string | null;
      clientName: string;
      clientPhone: string | null;
      serviceId: string;
      durationMinutes: number;
      subtotalHalalas: number;
      discountHalalas: number;
      totalHalalas: number;
      paidHalalas: number;
      paymentMethod: string | null;
      paymentBreakdown: Record<string, number> | null;
      reconcilePayment: boolean;
    }>
  ): Promise<CoreBooking> {
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/bookings/${encodeURIComponent(id)}`,
      { method: "PATCH", body: input }
    );
    return mapCoreBooking(row);
  },


  async reschedule(
    id: string,
    input: Record<string, unknown>
  ): Promise<CoreBooking> {
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/bookings/${encodeURIComponent(id)}/reschedule`,
      { method: "POST", body: input }
    );
    return mapCoreBooking(row);
  },
  async complete(id: string): Promise<CoreBooking> {
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/bookings/${encodeURIComponent(id)}/complete`,
      { method: "POST", body: {} }
    );
    return mapCoreBooking(row);
  },

  async remove(id: string): Promise<void> {
    await coreApiRequest(`/api/core/bookings/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },

  async cancel(id: string, reason = ""): Promise<CoreBooking> {
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/bookings/${encodeURIComponent(id)}/cancel`,
      { method: "POST", body: { reason } }
    );
    return mapCoreBooking(row);
  },
};
