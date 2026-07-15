import { coreApiRequest } from "./coreApiClient";
import { mapCoreService } from "./coreBookingMappers";
import type { CoreService } from "../types/coreApi";

export const CoreCatalogService = {
  async listServices(
    query: {
      activeOnly?: boolean;
      sectionId?: string;
      categoryId?: string;
    } = {}
  ): Promise<CoreService[]> {
    const rows = await coreApiRequest<Record<string, unknown>[]>(
      "/api/core/services",
      {
        query: {
          active: query.activeOnly === false ? undefined : true,
          sectionId: query.sectionId,
          categoryId: query.categoryId,
        },
      }
    );
    return rows.map(mapCoreService);
  },
};
