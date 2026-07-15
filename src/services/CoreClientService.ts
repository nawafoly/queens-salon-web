import { coreApiRequest } from "./coreApiClient";
import { mapCoreClient } from "./coreBookingMappers";
import type { CoreClient } from "../types/coreApi";

export const CoreClientService = {
  async list(search = ""): Promise<CoreClient[]> {
    const rows = await coreApiRequest<Record<string, unknown>[]>(
      "/api/core/clients",
      { query: { search } }
    );
    return rows.map(mapCoreClient);
  },

  async get(id: string): Promise<CoreClient> {
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/clients/${encodeURIComponent(id)}`
    );
    return mapCoreClient(row);
  },

  async create(input: {
    name: string;
    phone: string;
    email?: string;
    firebaseUid?: string;
  }): Promise<CoreClient> {
    const row = await coreApiRequest<Record<string, unknown>>(
      "/api/core/clients",
      { method: "POST", body: input }
    );
    return mapCoreClient(row);
  },

  async patch(
    id: string,
    input: Partial<{
      name: string;
      phone: string;
      email: string;
      firebaseUid: string;
      status: string;
      notes: string;
    }>
  ): Promise<CoreClient> {
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/clients/${encodeURIComponent(id)}`,
      { method: "PATCH", body: input }
    );
    return mapCoreClient(row);
  },
};
