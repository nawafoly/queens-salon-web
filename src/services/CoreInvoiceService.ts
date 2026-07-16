import { coreApiRequest } from "./coreApiClient";
import { mapCoreInvoice } from "./coreBookingMappers";
import type { CoreInvoice } from "../types/coreApi";

export const CoreInvoiceService = {
  async list(): Promise<CoreInvoice[]> {
    const rows = await coreApiRequest<Record<string, unknown>[]>(
      "/api/core/invoices"
    );
    return rows.map(mapCoreInvoice);
  },

  async get(id: string): Promise<CoreInvoice> {
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/invoices/${encodeURIComponent(id)}`
    );
    return mapCoreInvoice(row);
  },

  async getByBookingId(bookingId: string): Promise<CoreInvoice> {
    const row = await coreApiRequest<Record<string, unknown>>(
      "/api/core/invoices",
      { query: { bookingId } }
    );
    return mapCoreInvoice(row);
  },

  async create(input: Record<string, unknown>): Promise<CoreInvoice> {
    const row = await coreApiRequest<Record<string, unknown>>(
      "/api/core/invoices",
      { method: "POST", body: input }
    );
    return mapCoreInvoice(row);
  },
};
