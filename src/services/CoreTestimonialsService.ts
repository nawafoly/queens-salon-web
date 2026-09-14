// CORE D1 ONLY — do not add Firestore fallback.
import { coreApiRequest } from "./coreApiClient";

export type CoreTestimonial = {
  id: string;
  uid?: string | null;
  name: string;
  role: string;
  image?: string;
  content: string;
  rating: number;
  vip?: boolean;
  approved?: boolean;
  hidden?: boolean;
  adminReply?: string;
  createdAt?: string;
  updatedAt?: string;
};

function mapRow(row: Record<string, unknown>): CoreTestimonial {
  return {
    id: String(row.id || ""),
    uid: row.uid == null ? null : String(row.uid),
    name: String(row.name || "عميلة"),
    role: String(row.role || row.role_label || "عميلة"),
    image: String(row.image || row.image_url || ""),
    content: String(row.content || ""),
    rating: Number(row.rating || 5),
    vip: Boolean(row.vip),
    approved: row.approved !== false && Number(row.approved) !== 0,
    hidden: Boolean(row.hidden) || Number(row.hidden) === 1,
    adminReply: String(row.adminReply || row.admin_reply || ""),
    createdAt: row.createdAt == null && row.created_at == null
      ? undefined
      : String(row.createdAt || row.created_at || ""),
    updatedAt: row.updatedAt == null && row.updated_at == null
      ? undefined
      : String(row.updatedAt || row.updated_at || ""),
  };
}

export const CoreTestimonialsService = {
  async list(limit = 50): Promise<CoreTestimonial[]> {
    const rows = await coreApiRequest<Record<string, unknown>[]>(
      "/api/core/testimonials",
      { query: { limit } }
    );
    return (Array.isArray(rows) ? rows : []).map(mapRow);
  },

  async create(input: {
    name: string;
    role?: string;
    image?: string;
    content: string;
    rating: number;
    vip?: boolean;
    uid?: string;
  }): Promise<CoreTestimonial> {
    const row = await coreApiRequest<Record<string, unknown>>(
      "/api/core/testimonials",
      { method: "POST", body: { ...input } }
    );
    return mapRow(row);
  },

  async patch(
    id: string,
    input: Partial<{ hidden: boolean; approved: boolean; adminReply: string }>
  ): Promise<CoreTestimonial> {
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/testimonials/${encodeURIComponent(id)}`,
      { method: "PATCH", body: { ...input } }
    );
    return mapRow(row);
  },

  async remove(id: string): Promise<void> {
    await coreApiRequest(`/api/core/testimonials/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },
};
