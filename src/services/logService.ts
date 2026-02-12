import { auth, db } from "./firebase";
import {
  addDoc,
  collection,
  serverTimestamp,
  Timestamp,
  type FieldValue,
} from "firebase/firestore";

export type UiRole = "owner" | "admin" | "reception" | "staff" | "client" | "guest";
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

export type AuditLogInput = {
  salonId?: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId?: string;
  description: string;
  source?: LogSource;
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
  userName: string;
  userUid: string;
  userRole: UiRole;
  userEmail: string;
  source: LogSource;
  createdAt: FieldValue | Timestamp;
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

function safeJson<T = unknown>(v: T): T | null {
  try {
    return JSON.parse(JSON.stringify(v ?? null)) as T;
  } catch {
    return null;
  }
}

function logsCol(salonId: string) {
  return collection(db, "salons", salonId, "logs");
}

function detectSensitive(action: string, description: string, meta?: Record<string, unknown>) {
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

  const userUid = String(ls?.uid || authUser?.uid || "").trim();
  const userEmail = String(ls?.email || authUser?.email || "").trim();
  const userRole = String(ls?.role || "guest").trim() as UiRole;
  const userName = String(ls?.displayName || ls?.name || authUser?.displayName || userEmail || "").trim();

  const payload: Omit<AuditLogRecord, "logId"> = {
    action: String(input.action || "").trim(),
    entityType: String(input.entityType || "").trim(),
    entityId: String(input.entityId || "").trim(),
    description: String(input.description || "").trim(),
    userName,
    userUid,
    userRole: userRole || "guest",
    userEmail,
    source: input.source || "dashboard",
    createdAt: input.createdAt || serverTimestamp(),
    before: safeJson(input.before),
    after: safeJson(input.after),
    meta: (safeJson(input.meta) as Record<string, unknown> | null) || {},
    sensitive: detectSensitive(String(input.action || ""), String(input.description || ""), input.meta),
  };

  try {
    const ref = await addDoc(logsCol(salonId), payload as Record<string, unknown>);
    return ref.id;
  } catch (e) {
    console.warn("writeAuditLog failed:", e, payload);
    throw e;
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
