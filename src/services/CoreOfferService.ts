import { coreApiRequest } from "./coreApiClient";
import type { CoreDiscount } from "../types/coreApi";

function parseArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapDiscount(row: Record<string, unknown>): CoreDiscount {
  return {
    id: String(row.id || ""),
    salonId: String(row.salon_id || row.salonId || "main"),
    code: row.code == null ? null : String(row.code),
    codeKey: row.code_key == null ? null : String(row.code_key),
    name: String(row.name || ""),
    type: String(row.type || "fixed") === "percent" ? "percent" : "fixed",
    value: Number(row.value || 0),
    active: Number(row.active) === 1 || row.active === true,
    startsAt: row.starts_at == null ? null : String(row.starts_at),
    endsAt: row.ends_at == null ? null : String(row.ends_at),
    usageLimit: row.usage_limit == null ? null : Number(row.usage_limit),
    usedCount: Number(row.used_count || 0),
    appliesTo: String(row.applies_to || "all") === "services" ? "services" : "all",
    serviceIds: parseArray(row.service_ids_json).map(String),
    sequenceSteps: parseArray(row.sequence_steps_json).filter((x): x is Record<string, unknown> => Boolean(x && typeof x === "object")),
    imageUrl: row.image_url == null ? null : String(row.image_url),
    deletedAt: row.deleted_at == null ? null : String(row.deleted_at),
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || ""),
  };
}

export const CoreOfferService = {
  async list(query: { active?: boolean; code?: string; includeDeleted?: boolean } = {}): Promise<CoreDiscount[]> {
    const rows = await coreApiRequest<Record<string, unknown>[]>("/api/core/discounts", { query });
    return rows.map(mapDiscount);
  },

  async create(input: Record<string, unknown>): Promise<CoreDiscount> {
    return mapDiscount(await coreApiRequest<Record<string, unknown>>("/api/core/discounts", { method: "POST", body: input }));
  },

  async patch(id: string, input: Record<string, unknown>): Promise<CoreDiscount> {
    return mapDiscount(await coreApiRequest<Record<string, unknown>>(`/api/core/discounts/${encodeURIComponent(id)}`, { method: "PATCH", body: input }));
  },

  async remove(id: string): Promise<void> {
    await coreApiRequest(`/api/core/discounts/${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  async incrementUsage(id: string): Promise<CoreDiscount> {
    return mapDiscount(await coreApiRequest<Record<string, unknown>>(`/api/core/discounts/${encodeURIComponent(id)}/use`, { method: "POST", body: {} }));
  },
};
