// ✅ src/services/logService.ts
import { auth, db } from "./firebase";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";

export type UiRole = "owner" | "admin" | "reception" | "staff" | "client" | "guest";

export type LogEntity =
  | "booking"
  | "staff"
  | "service"
  | "section"
  | "offer"
  | "income"
  | "expense"
  | "user"
  | "settings"
  | "system"
  | string;

export type LogType =
  | "booking_created"
  | "booking_updated"
  | "booking_confirmed"
  | "booking_cancelled"
  | "booking_completed"
  | "booking_rescheduled"
  | "booking_paid"
  | "booking_no_show"
  | "staff_acknowledged"
  | "staff_created"
  | "staff_updated"
  | "staff_disabled"
  | "service_created"
  | "service_updated"
  | "service_price_changed"
  | "service_disabled"
  | "income_created"
  | "income_updated"
  | "expense_created"
  | "expense_deleted"
  | "role_changed"
  | "settings_updated"
  | string;

export type LogEventInput = {
  salonId?: string; // default "main"
  type: LogType;
  entity: LogEntity;
  entityId?: string; // bookingId, staffId...
  note?: string;
  meta?: Record<string, any>;
};

type AuthUserLS = {
  uid?: string;
  email?: string;
  role?: UiRole;
  displayName?: string;
};

function getAuthUserFromLocalStorage(): AuthUserLS | null {
  try {
    const raw = localStorage.getItem("auth_user");
    if (!raw) return null;
    return JSON.parse(raw) as AuthUserLS;
  } catch {
    return null;
  }
}

function safeJson(v: any) {
  try {
    // نحذف الأشياء اللي ما تنسيريالايز
    return JSON.parse(JSON.stringify(v ?? {}));
  } catch {
    return {};
  }
}

function logsCol(salonId: string) {
  return collection(db, "salons", salonId, "logs");
}

/**
 * ✅ logEvent
 * - يكتب حدث موحّد في salons/{salonId}/logs
 * - يجمع هوية الفاعل من localStorage + auth.currentUser
 */
export async function logEvent(input: LogEventInput) {
  const salonId = String(input?.salonId || "main").trim() || "main";

  const ls = getAuthUserFromLocalStorage();
  const u = auth.currentUser;

  const byUid = String(ls?.uid || u?.uid || "").trim();
  const byEmail = String(ls?.email || u?.email || "").trim();
  const byRole = String(ls?.role || "").trim() as UiRole;

  const payload = {
    type: String(input.type || "").trim(),
    entity: String(input.entity || "").trim(),
    entityId: String(input.entityId || "").trim(),
    note: String(input.note || "").trim(),
    byUid,
    byEmail,
    byRole: byRole || "guest",
    at: serverTimestamp(),
    meta: safeJson(input.meta || {}),
  };

  // ملاحظة: ما نخليها تفشل الصفحة لو اللوق فشل
  // لكن نرمي الخطأ للكونسول عشان نعرف
  try {
    await addDoc(logsCol(salonId), payload);
  } catch (e) {
    console.warn("logEvent failed:", e, payload);
    throw e;
  }
}

