import { auth, db } from "./firebase";
import {
  collection,
  doc,
  serverTimestamp,
  setDoc,
  Timestamp,
  type FieldValue,
} from "firebase/firestore";

export type UiRole = "owner" | "admin" | "hr" | "reception" | "staff" | "client" | "guest";
export type LogSource = "dashboard" | "internal_booking" | "client_app" | "system";

export type AuditEntityType =
  | "booking"
  | "service"
  | "section"
  | "employee"
  | "client"
  | "income"
  | "expense"
  | "offer"
  | "loyalty"
  | "settings"
  | "user"
  | string;

export type AuditAction =
  | "booking_created"
  | "booking_updated"
  | "booking_confirmed"
  | "booking_completed"
  | "booking_cancelled"
  | "booking_status_changed"
  | "booking_rescheduled"
  | "booking_reassigned"
  | "service_created"
  | "service_updated"
  | "service_deleted"
  | "section_created"
  | "section_updated"
  | "section_deleted"
  | "employee_created"
  | "employee_updated"
  | "employee_disabled"
  | "employee_leave_balance_updated"
  | "client_created"
  | "client_updated"
  | "income_created"
  | "income_updated"
  | "income_deleted"
  | "expense_created"
  | "expense_updated"
  | "expense_deleted"
  | "offer_created"
  | "offer_updated"
  | "offer_deleted"
  | "loyalty_settings_updated"
  | "settings_updated"
  | "user_login"
  | "user_logout"
  | "role_changed"
  | string;

export type AuditLogSeverity = "info" | "warning" | "critical";

export type AuditLogDisplay = {
  clientName?: string;
  bookingPublicId?: string;
  bookingShortId?: string;
  bookingId?: string;
};

export type AuditLogChange = {
  field: string;
  before?: string;
  after?: string;
};

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
  createdAt?: FieldValue | Timestamp;
};

type AuthUserLS = {
  uid?: string;
  email?: string;
  role?: UiRole;
  displayName?: string;
  name?: string;
};

export type AuditLogRecord = {
  logId: string;
  action: string;
  entityType: string;
  entityId: string;
  description: string;
  summary?: string;
  userName: string;
  userUid: string;
  userRole: UiRole;
  userEmail: string;
  source: LogSource;
  createdAt: FieldValue | Timestamp;
  severity?: AuditLogSeverity;
  display?: AuditLogDisplay;
  changedFields?: string[];
  changesPreview?: AuditLogChange[];
  hasSnapshot?: boolean;
  snapshotId?: string;
  restore?: {
    eligible?: boolean;
    kind?: string;
  };
  before?: unknown;
  after?: unknown;
  meta?: Record<string, unknown>;
  sensitive: boolean;
};

function getAuthUserFromLocalStorage(): AuthUserLS | null {
  try {
    const raw = localStorage.getItem("auth_user");
    if (raw) return JSON.parse(raw) as AuthUserLS;
  } catch {
    // ignore
  }

  try {
    const raw = localStorage.getItem("user_profile_v1");
    if (raw) return JSON.parse(raw) as AuthUserLS;
  } catch {
    // ignore
  }

  return null;
}

function getCachedSessionUserName() {
  try {
    return String(localStorage.getItem("userName") || "").trim();
  } catch {
    return "";
  }
}

function safeJson<T = unknown>(v: T): T | null {
  try {
    return JSON.parse(JSON.stringify(v ?? null)) as T;
  } catch {
    return null;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function normalizeValueForLog(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return v ? "نعم" : "لا";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "—";
  if (typeof v === "string") {
    const trimmed = v.trim();
    return trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed;
  }
  if (Array.isArray(v)) {
    if (!v.length) return "[]";
    return `قائمة (${v.length})`;
  }
  try {
    const json = JSON.stringify(v);
    if (!json) return "—";
    return json.length > 120 ? `${json.slice(0, 117)}...` : json;
  } catch {
    return "بيانات";
  }
}

function buildChangesPreview(args: {
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  patch?: Record<string, unknown> | null;
}): AuditLogChange[] {
  const out: AuditLogChange[] = [];
  const before = args.before && isPlainObject(args.before) ? args.before : null;
  const after = args.after && isPlainObject(args.after) ? args.after : null;
  const patch = args.patch && isPlainObject(args.patch) ? args.patch : null;

  if (before && after) {
    const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
    keys.forEach((key) => {
      if (key === "updatedAt" || key === "createdAt") return;
      const bv = before[key];
      const av = after[key];
      if (Object.is(bv, av)) return;
      out.push({
        field: key,
        before: normalizeValueForLog(bv),
        after: normalizeValueForLog(av),
      });
    });
  } else if (patch) {
    Object.keys(patch).forEach((key) => {
      if (key === "updatedAt" || key === "createdAt") return;
      out.push({
        field: key,
        before: "—",
        after: normalizeValueForLog(patch[key]),
      });
    });
  } else if (after) {
    Object.keys(after).forEach((key) => {
      if (key === "updatedAt" || key === "createdAt") return;
      out.push({
        field: key,
        before: "—",
        after: normalizeValueForLog(after[key]),
      });
    });
  }

  return out.slice(0, 16);
}

function resolveSeverity(actionRaw: string, meta?: Record<string, unknown>): AuditLogSeverity {
  const override = String(meta?.severity || "").trim().toLowerCase();
  if (override === "critical" || override === "warning" || override === "info") {
    return override as AuditLogSeverity;
  }

  const action = String(actionRaw || "").trim().toLowerCase();
  if (
    action.includes("cancel") ||
    action.includes("deleted") ||
    action.includes("restore") ||
    action.includes("role_changed") ||
    action.includes("status_changed") ||
    action.includes("reassigned")
  ) {
    return "critical";
  }
  if (action.includes("updated") || action.includes("changed") || action.includes("settings")) {
    return "warning";
  }
  return "info";
}

function resolveDisplay(args: {
  input: AuditLogInput;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}): AuditLogDisplay | undefined {
  const metaDisplay = args.input.meta?.display;
  if (metaDisplay && typeof metaDisplay === "object") {
    const d = metaDisplay as Record<string, unknown>;
    return {
      clientName: String(d.clientName || "").trim() || undefined,
      bookingPublicId: String(d.bookingPublicId || "").trim() || undefined,
      bookingShortId: String(d.bookingShortId || "").trim() || undefined,
      bookingId: String(d.bookingId || "").trim() || undefined,
    };
  }

  const candidate = (args.after && isPlainObject(args.after) ? args.after : null) ||
    (args.before && isPlainObject(args.before) ? args.before : null);
  if (!candidate) return undefined;

  const clientName =
    String(
      (candidate as any)?.clientName ||
        (candidate as any)?.customerName ||
        (candidate as any)?.name ||
        ""
    ).trim() || undefined;
  const bookingPublicId =
    String((candidate as any)?.publicId || (candidate as any)?.bookingPublicId || "").trim() || undefined;
  const bookingId =
    String((candidate as any)?.bookingId || args.input.entityId || "").trim() || undefined;
  const bookingShortId = bookingId ? bookingId.slice(0, 6) : undefined;

  if (!clientName && !bookingPublicId && !bookingId) return undefined;
  return {
    clientName,
    bookingPublicId,
    bookingShortId,
    bookingId,
  };
}

function resolveRestoreMeta(actionRaw: string, hasSnapshot: boolean) {
  const action = String(actionRaw || "").trim().toLowerCase();
  if (!hasSnapshot) return { eligible: false };
  if (action === "income_deleted") return { eligible: true, kind: "income" };
  if (action === "expense_deleted") return { eligible: true, kind: "expense" };
  return { eligible: false };
}

function logsCol(salonId: string) {
  return collection(db, "salons", salonId, "logs");
}

const SENSITIVE_ACTIONS = new Set<string>([
  "role_changed",
  "settings_updated",
  "loyalty_settings_updated",
  "income_created",
  "income_updated",
  "income_deleted",
  "expense_created",
  "expense_updated",
  "expense_deleted",
  "booking_confirmed",
  "booking_completed",
  "booking_cancelled",
  "booking_reassigned",
  "employee_leave_balance_updated",
  "booking_status_changed",
  "offer_created",
  "offer_updated",
  "offer_deleted",
  "user_created",
  "user_updated",
]);

function detectSensitive(action: string, description: string, meta?: Record<string, unknown>) {
  const actionKey = String(action || "").toLowerCase().trim();
  if (SENSITIVE_ACTIONS.has(actionKey)) return true;

  const text = `${action} ${description} ${JSON.stringify(meta || {})}`.toLowerCase();
  return (
    text.includes("delete") ||
    text.includes("حذف") ||
    text.includes("price") ||
    text.includes("سعر") ||
    text.includes("amount") ||
    text.includes("مالي") ||
    text.includes("role") ||
    text.includes("صلاح")
  );
}

export async function writeAuditLog(input: AuditLogInput) {
  const salonId = String(input.salonId || "main").trim() || "main";

  const ls = getAuthUserFromLocalStorage();
  const authUser = auth.currentUser;
  const cachedSessionUserName = getCachedSessionUserName();

  const userUid = String(input.actorUid || ls?.uid || authUser?.uid || "").trim();
  const userEmail = String(input.actorEmail || ls?.email || authUser?.email || "").trim();
  const userRole = String(input.actorRole || ls?.role || "guest").trim() as UiRole;
  const userName = String(
    input.actorName ||
      ls?.displayName ||
      ls?.name ||
      cachedSessionUserName ||
      authUser?.displayName ||
      userEmail ||
      ""
  ).trim();

  const beforeProvided = input.before !== undefined && input.before !== null;
  const before = safeJson(input.before);
  const after = safeJson(input.after);
  const beforeRecord = isPlainObject(before) ? before : null;
  const afterRecord = isPlainObject(after) ? after : null;
  let shouldSnapshotAfter = false;
  if (!beforeProvided && after && typeof after === "object") {
    try {
      const size = JSON.stringify(after).length;
      shouldSnapshotAfter = size > 2000;
    } catch {
      shouldSnapshotAfter = false;
    }
  }
  const patchMeta = (input.meta?.patch && isPlainObject(input.meta.patch) ? input.meta.patch : null) as
    | Record<string, unknown>
    | null;
  const changesPreview = buildChangesPreview({ before: beforeRecord, after: afterRecord, patch: patchMeta });
  const display = resolveDisplay({ input, before: beforeRecord, after: afterRecord });
  const summary =
    String((input.meta?.summary as string | undefined) || input.description || input.action || "")
      .trim() || String(input.action || "").trim();
  const severity = resolveSeverity(String(input.action || ""), input.meta);
  const hasSnapshot = Boolean(beforeProvided || shouldSnapshotAfter);
  const restoreMeta = resolveRestoreMeta(String(input.action || ""), hasSnapshot);

  const logRef = doc(logsCol(salonId));
  const logId = logRef.id;
  const snapshotId = hasSnapshot ? logId : undefined;

  const payload: Omit<AuditLogRecord, "logId"> = {
    action: String(input.action || "").trim(),
    entityType: String(input.entityType || "").trim(),
    entityId: String(input.entityId || "").trim(),
    description: String(input.description || "").trim(),
    summary,
    userName,
    userUid,
    userRole: userRole || "guest",
    userEmail,
    source: input.source || "dashboard",
    createdAt: input.createdAt || serverTimestamp(),
    severity,
    display,
    changedFields: changesPreview.map((c) => c.field),
    changesPreview,
    hasSnapshot,
    snapshotId,
    restore: restoreMeta,
    before: hasSnapshot ? null : before,
    after: hasSnapshot ? null : after,
    meta: (safeJson(input.meta) as Record<string, unknown> | null) || {},
    sensitive: detectSensitive(String(input.action || ""), String(input.description || ""), input.meta),
  };

  try {
    await setDoc(logRef, { ...payload, logId } as Record<string, unknown>);
    if (hasSnapshot) {
      const snapshotRef = doc(db, "salons", salonId, "log_snapshots", logId);
      await setDoc(snapshotRef, {
        logId,
        entityType: payload.entityType,
        entityId: payload.entityId,
        before,
        after,
        createdAt: serverTimestamp(),
      });
    }
    return logId;
  } catch (e) {
    console.warn("writeAuditLog failed (ignored):", e, payload);
    return null; // ✅ لا تكسر الفلو
  }
}

// Backward compatibility for existing callers naming
export type LogEventInput = {
  salonId?: string;
  type: string;
  entity: string;
  entityId?: string;
  note?: string;
  meta?: Record<string, unknown>;
};

export async function logEvent(input: LogEventInput) {
  return writeAuditLog({
    salonId: input.salonId,
    action: input.type,
    entityType: input.entity,
    entityId: input.entityId,
    description: input.note || input.type,
    meta: input.meta,
    source: "dashboard",
  });
}
