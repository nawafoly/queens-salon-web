import { coreApiRequest } from "./coreApiClient";
import type { CoreCatalogRow } from "../types/coreApi";

function mapRow(row: Record<string, unknown>): CoreCatalogRow {
  return {
    id: String(row.id || ""),
    salonId: String(row.salon_id || row.salonId || "main"),
    name: String(row.name || ""),
    sectionId: row.section_id == null ? null : String(row.section_id),
    active: Number(row.active) === 1 || row.active === true,
    sortOrder: Number(row.sort_order || row.sortOrder || 0),
    createdAt: String(row.created_at || row.createdAt || ""),
    updatedAt: String(row.updated_at || row.updatedAt || ""),
  };
}

async function list(kind: "sections" | "categories", active?: boolean) {
  const rows = await coreApiRequest<Record<string, unknown>[]>(`/api/core/${kind}`, { query: { active } });
  return rows.map(mapRow);
}

async function create(kind: "sections" | "categories", input: Record<string, unknown>) {
  return mapRow(await coreApiRequest<Record<string, unknown>>(`/api/core/${kind}`, { method: "POST", body: input }));
}

async function patch(kind: "sections" | "categories", id: string, input: Record<string, unknown>) {
  return mapRow(await coreApiRequest<Record<string, unknown>>(`/api/core/${kind}/${encodeURIComponent(id)}`, { method: "PATCH", body: input }));
}

async function remove(kind: "sections" | "categories", id: string) {
  await coreApiRequest(`/api/core/${kind}/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export const CoreAdminCatalogService = {
  listSections: (active?: boolean) => list("sections", active),
  listCategories: (active?: boolean) => list("categories", active),
  createSection: (input: Record<string, unknown>) => create("sections", input),
  createCategory: (input: Record<string, unknown>) => create("categories", input),
  patchSection: (id: string, input: Record<string, unknown>) => patch("sections", id, input),
  patchCategory: (id: string, input: Record<string, unknown>) => patch("categories", id, input),
  removeSection: (id: string) => remove("sections", id),
  removeCategory: (id: string) => remove("categories", id),
};
