import { coreApiRequest } from "./coreApiClient";
import { mapCoreService } from "./coreBookingMappers";
import type { CoreService } from "../types/coreApi";
import { CoreAdminCatalogService } from "./CoreAdminCatalogService";

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

  async listSections(activeOnly = true) {
    return CoreAdminCatalogService.listSections(activeOnly ? true : undefined);
  },

  async listCategories(activeOnly = true) {
    return CoreAdminCatalogService.listCategories(activeOnly ? true : undefined);
  },
};
