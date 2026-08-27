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

  async createService(input: Record<string, unknown>) {
    return mapCoreService(await coreApiRequest<Record<string, unknown>>("/api/core/services", { method: "POST", body: input }));
  },

  async patchService(id: string, input: Record<string, unknown>) {
    return mapCoreService(await coreApiRequest<Record<string, unknown>>(`/api/core/services/${encodeURIComponent(id)}`, { method: "PATCH", body: input }));
  },

  async archiveService(id: string) {
    return this.patchService(id, { active: false });
  },

  async listSections(activeOnly = true) {
    return CoreAdminCatalogService.listSections(activeOnly ? true : undefined);
  },

  async listCategories(activeOnly = true) {
    return CoreAdminCatalogService.listCategories(activeOnly ? true : undefined);
  },
};
