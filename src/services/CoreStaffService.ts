import { coreApiRequest } from "./coreApiClient";
import { mapCoreStaff } from "./coreBookingMappers";
import type { CoreStaff } from "../types/coreApi";

export const CoreStaffService = {
  async list(
    query: { activeOnly?: boolean; serviceId?: string } = {}
  ): Promise<CoreStaff[]> {
    const rows = await coreApiRequest<Record<string, unknown>[]>(
      "/api/core/staff",
      {
        query: {
          active: query.activeOnly === false ? undefined : true,
          serviceId: query.serviceId,
        },
      }
    );
    return rows.map(mapCoreStaff);
  },

  async get(id: string): Promise<CoreStaff> {
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/staff/${encodeURIComponent(id)}`
    );
    return mapCoreStaff(row);
  },
};
