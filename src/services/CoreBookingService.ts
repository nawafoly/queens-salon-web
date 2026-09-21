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

export type CoreStaffPortalBooking = CoreBooking & {
  staffAck?: boolean;
  staffAckAt?: string | null;
  staffAckByUid?: string | null;
};

function mapBookingRow(row: Record<string, unknown>): CoreStaffPortalBooking {
  return {
    ...mapCoreBooking(row),
    staffAck: Number(row.staff_ack) === 1 || row.staff_ack === true,
    staffAckAt: String(row.staff_ack_at || "").trim() || null,
    staffAckByUid: String(row.staff_ack_by_uid || "").trim() || null,
  };
}

export const CoreBookingService = {
  async list(query: CoreBookingSearch = {}): Promise<CoreBooking[]> {
    const rows = await coreApiRequest<Record<string, unknown>[]>(
      "/api/core/bookings",
      { query }
    );
    return rows.map(mapBookingRow);
  },

  async mine(
    query: Omit<CoreBookingSearch, "staffId"> = {}
  ): Promise<CoreStaffPortalBooking[]> {
    const rows = await coreApiRequest<Record<string, unknown>[]>(
      "/api/core/bookings/mine",
      { query }
    );
    return rows.map(mapBookingRow);
  },

  async acknowledgeMine(id: string): Promise<CoreStaffPortalBooking> {
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/bookings/${encodeURIComponent(id)}/acknowledge`,
      { method: "POST", body: {} }
    );
    return mapBookingRow(row);
  },

  async updateMineStatus(
    id: string,
    status: "confirmed" | "completed" | "cancelled"
  ): Promise<CoreStaffPortalBooking> {
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/bookings/${encodeURIComponent(id)}/staff-status`,
      { method: "POST", body: { status } }
    );
    return mapBookingRow(row);
  },

  async get(id: string): Promise<CoreBooking> {
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/bookings/${encodeURIComponent(id)}`
    );
    return mapBookingRow(row);
  },

  async trackPublic(publicId: string): Promise<CoreBooking> {
    const row = await coreApiRequest<Record<string, unknown>>(
      "/api/core/public/booking-track",
      { query: { publicId } }
    );
    return mapBookingRow(row);
  },

  async create(input: CoreCreateBookingInput): Promise<CoreBooking> {
    const row = await coreApiRequest<Record<string, unknown>>(
      "/api/core/bookings",
      {
        method: "POST",
        body: input as unknown as Record<string, unknown>,
      }
    );
    return mapBookingRow(row);
  },

  async createInternal(input: CoreCreateBookingInput): Promise<CoreBooking> {
    const row = await coreApiRequest<Record<string, unknown>>(
      "/api/core/internal/bookings",
      {
        method: "POST",
        body: input as unknown as Record<string, unknown>,
      }
    );
    return mapBookingRow(row);
  },

  async patch(
    id: string,
    input: Partial<{
      status: string;
      notes: string | null;
      adminNotes: string | null;
      paymentStatus: string;
      bookingDate: string;
      startTime: string;
      endTime: string;
      staffId: string | null;
      clientName: string;
      clientPhone: string | null;
      serviceId: string;
      durationMinutes: number;
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
    return mapBookingRow(row);
  },

  async reschedule(
    id: string,
    input: Record<string, unknown>
  ): Promise<CoreBooking> {
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/bookings/${encodeURIComponent(id)}/reschedule`,
      { method: "POST", body: input }
    );
    return mapBookingRow(row);
  },

  async complete(id: string): Promise<CoreBooking> {
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/bookings/${encodeURIComponent(id)}/complete`,
      { method: "POST", body: {} }
    );
    return mapBookingRow(row);
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
    return mapBookingRow(row);
  },
};
