import { coreApiRequest } from "./coreApiClient";
import { mapCorePayment } from "./coreBookingMappers";
import type { CorePayment } from "../types/coreApi";

export const CorePaymentService = {
  async list(): Promise<CorePayment[]> {
    const rows = await coreApiRequest<Record<string, unknown>[]>(
      "/api/core/payments"
    );
    return rows.map(mapCorePayment);
  },

  async record(input: Record<string, unknown>): Promise<CorePayment> {
    const row = await coreApiRequest<Record<string, unknown>>(
      "/api/core/payments",
      { method: "POST", body: input }
    );
    return mapCorePayment(row);
  },
};
