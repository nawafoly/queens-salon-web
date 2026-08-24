import { auth } from "./firebase";
import { CoreAuditService } from "./CoreAuditService";

export type UiRole = "owner" | "admin" | "hr" | "reception" | "staff" | "client" | "guest";
export type LogSource = "dashboard" | "internal_booking" | "client_app" | "system";

export type AuditEntityType =
  | "booking" | "service" | "section" | "employee" | "client" | "income" | "expense"
  | "offer" | "loyalty" | "settings" | "user" | string;
export type AuditAction = string;
export type AuditLogSeverity = "info" | "warning" | "critical";
export type AuditLogDisplay = {
  clientName?: string; bookingPublicId?: string; bookingShortId?: string; bookingId?: string;
};
export type AuditLogChange = { field: string; before?: string; after?: string };
export type AuditLogInput = {
  salonId?: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string;
  description: string;
  source?: LogSource;
  actorUid?: string;
  actorEmail?: string;
  actorName?: string;
  actorRole?: UiRole;
  before?: unknown;
  after?: unknown;
  meta?: Record<string, unknown>;
  createdAt?: unknown;
};
export type AuditLogRecord = {
  logId: string; action: string; entityType: string; entityId: string; description: string;
  summary?: string; userName: string; userUid: string; userRole: UiRole; userEmail: string;
  source: LogSource; createdAt: unknown; severity?: AuditLogSeverity; display?: AuditLogDisplay;
  changedFields?: string[]; changesPreview?: AuditLogChange[]; hasSnapshot?: boolean; snapshotId?: string;
  restore?: { eligible?: boolean; kind?: string }; before?: unknown; after?: unknown;
  meta?: Record<string, unknown>; sensitive: boolean;
};

type AuthUserLS = { uid?: string; email?: string; role?: UiRole; displayName?: string; name?: string };

function localSession(): AuthUserLS | null {
  for (const key of ["auth_user", "user_profile_v1"]) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw) as AuthUserLS;
    } catch {}
  }
  return null;
}

function cachedSessionName() {
  try { return String(localStorage.getItem("userName") || "").trim(); } catch { return ""; }
}

/**
 * Supplemental UI audit writer. Canonical business mutations must write their own audit rows
 * atomically inside Core. This facade is Core-only and never falls back to Firestore.
 */
export async function writeAuditLog(input: AuditLogInput) {
  const ls = localSession();
  const current = auth.currentUser;
  const role = String(input.actorRole || ls?.role || "guest").trim().toLowerCase() as UiRole;

  // Public/client mutations are audited by their authoritative Core endpoint.
  if (["client", "guest"].includes(role)) return null;

  const actorUid = String(input.actorUid || ls?.uid || current?.uid || "").trim();
  const actorEmail = String(input.actorEmail || ls?.email || current?.email || "").trim();
  const actorName = String(
    input.actorName || ls?.displayName || ls?.name || cachedSessionName() ||
    current?.displayName || actorEmail || ""
  ).trim();

  const row = await CoreAuditService.record({
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    description: input.description,
    source: input.source || "dashboard",
    actorUid, actorEmail, actorName,
    before: input.before, after: input.after, meta: input.meta,
  });
  return row.id;
}

export type LogEventInput = {
  salonId?: string; type: string; entity: string; entityId?: string; note?: string; meta?: Record<string, unknown>;
};
export async function logEvent(input: LogEventInput) {
  return writeAuditLog({
    salonId: input.salonId, action: input.type, entityType: input.entity,
    entityId: input.entityId, description: input.note || input.type, meta: input.meta, source: "dashboard",
  });
}
