import {
  CoreWorkforceService,
  type CoreEmployeeNotification,
} from "./CoreWorkforceService";

function cleanText(value: unknown) {
  return String(value || "").trim();
}

export type EmployeeNotification = {
  id: string;
  targetUid?: string;
  targetEmployeeId?: string;
  type?: "leave" | "file" | "message" | "system" | "payroll" | "employee_request";
  title: string;
  body?: string;
  route?: string;
  isRead?: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
  readAt?: unknown;
  readBy?: string[];
};

export function mapCoreEmployeeNotification(row: CoreEmployeeNotification): EmployeeNotification {
  return {
    id: row.id,
    targetUid: cleanText(row.target_uid || "") || undefined,
    targetEmployeeId: cleanText(row.target_employee_id || "") || undefined,
    type: row.type,
    title: cleanText(row.title),
    body: cleanText(row.body || "") || undefined,
    route: cleanText(row.route || "") || undefined,
    isRead: Boolean(row.read_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    readAt: row.read_at || undefined,
    readBy: row.read_by_uid ? [row.read_by_uid] : [],
  };
}

export async function listEmployeeNotifications(args: {
  targetUid?: string;
  targetEmployeeId?: string;
  limitCount?: number;
} = {}) {
  void args.targetUid;
  void args.targetEmployeeId;
  const rows = await CoreWorkforceService.listNotifications(Math.max(1, Number(args.limitCount || 50)));
  return rows.map(mapCoreEmployeeNotification);
}

export async function createEmployeeNotification(input: {
  targetUid?: string;
  targetEmployeeId?: string;
  type?: EmployeeNotification["type"];
  title: string;
  body?: string;
  route?: string;
}) {
  const row = await CoreWorkforceService.createNotification({
    targetUid: cleanText(input.targetUid || "") || undefined,
    targetEmployeeId: cleanText(input.targetEmployeeId || "") || undefined,
    type: input.type || "system",
    title: cleanText(input.title),
    body: cleanText(input.body || "") || undefined,
    route: cleanText(input.route || "") || undefined,
  });
  return { id: row.id };
}

export async function markEmployeeNotificationRead(args: {
  notificationId: string;
  readerUid?: string;
}) {
  const notificationId = cleanText(args.notificationId);
  if (!notificationId) return;
  await CoreWorkforceService.markNotificationRead(notificationId);
}

export async function markEmployeeNotificationsRead(args: {
  notificationIds: string[];
  readerUid?: string;
}) {
  const ids = Array.from(
    new Set((Array.isArray(args.notificationIds) ? args.notificationIds : []).map(cleanText).filter(Boolean))
  );
  if (!ids.length) return;
  await Promise.all(ids.map((id) => CoreWorkforceService.markNotificationRead(id)));
}

export async function markAllEmployeeNotificationsRead() {
  return CoreWorkforceService.markAllNotificationsRead();
}

export function isEmployeeRequestNotificationId(id: unknown) {
  return cleanText(id).startsWith("request_notification_");
}
