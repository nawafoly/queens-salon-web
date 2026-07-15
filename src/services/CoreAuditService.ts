import { coreApiRequest } from "./coreApiClient";
import type { CoreAuditLog } from "../types/coreApi";

function mapAudit(row: Record<string, unknown>): CoreAuditLog {
  return {
    id: String(row.id || ""),
    salonId: String(row.salon_id || "main"),
    action: String(row.action || ""),
    entityType: String(row.entity_type || ""),
    entityId: row.entity_id == null ? null : String(row.entity_id),
    description: row.description == null ? null : String(row.description),
    source: row.source == null ? null : String(row.source),
    actorUid: row.actor_uid == null ? null : String(row.actor_uid),
    actorEmail: row.actor_email == null ? null : String(row.actor_email),
    actorName: row.actor_name == null ? null : String(row.actor_name),
    beforeJson: row.before_json == null ? null : String(row.before_json),
    afterJson: row.after_json == null ? null : String(row.after_json),
    metaJson: row.meta_json == null ? null : String(row.meta_json),
    createdAt: String(row.created_at || ""),
  };
}

export const CoreAuditService = {
  async list(query: { entityType?: string; entityId?: string; action?: string; limit?: number } = {}): Promise<CoreAuditLog[]> {
    const rows = await coreApiRequest<Record<string, unknown>[]>("/api/core/audit", { query });
    return rows.map(mapAudit);
  },
  async record(input: Record<string, unknown>): Promise<CoreAuditLog> {
    return mapAudit(await coreApiRequest<Record<string, unknown>>("/api/core/audit", { method: "POST", body: input }));
  },
};
