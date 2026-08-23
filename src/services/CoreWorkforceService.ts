import { coreApiRequest } from "./coreApiClient";

export type CoreEmployeeMessage = {
  id: string;
  conversation_id: string;
  thread_id?: string | null;
  sender_uid: string;
  sender_name?: string | null;
  sender_employee_id?: string | null;
  recipient_uid: string;
  recipient_name?: string | null;
  recipient_employee_id?: string | null;
  body: string;
  kind: "hr_to_employee" | "employee_to_employee" | "system";
  read_by?: string[];
  created_at: string;
  updated_at: string;
};

export type CoreEmployeeNotification = {
  id: string;
  target_uid?: string | null;
  target_employee_id?: string | null;
  type: "leave" | "file" | "message" | "system" | "payroll" | "employee_request";
  title: string;
  body?: string | null;
  route?: string | null;
  read_at?: string | null;
  read_by_uid?: string | null;
  created_at: string;
  updated_at: string;
};

export type CoreRecruitmentApplication = {
  id: string;
  full_name: string;
  email: string;
  phone?: string | null;
  role_applied?: string | null;
  status: "new" | "reviewing" | "interview" | "accepted" | "rejected" | "hired";
  notes?: string | null;
  message?: string | null;
  source?: string | null;
  reviewed_at?: string | null;
  reviewed_by_uid?: string | null;
  hired_at?: string | null;
  hired_by_uid?: string | null;
  hired_uid?: string | null;
  hired_employee_id?: string | null;
  created_at: string;
  updated_at: string;
};

export const CoreWorkforceService = {
  listMessages(limit = 500) {
    return coreApiRequest<CoreEmployeeMessage[]>("/api/core/hr/messages", { query: { limit } });
  },
  createMessage(input: Record<string, unknown>) {
    return coreApiRequest<CoreEmployeeMessage>("/api/core/hr/messages", { method: "POST", body: input });
  },
  markThreadRead(conversationId: string) {
    return coreApiRequest<{ conversationId: string; readerUid: string; readAt: string }>(
      `/api/core/hr/messages/thread/${encodeURIComponent(conversationId)}/read`,
      { method: "POST" },
    );
  },
  listNotifications(limit = 100) {
    return coreApiRequest<CoreEmployeeNotification[]>("/api/core/hr/notifications", { query: { limit } });
  },
  createNotification(input: Record<string, unknown>) {
    return coreApiRequest<CoreEmployeeNotification>("/api/core/hr/notifications", { method: "POST", body: input });
  },
  markNotificationRead(id: string) {
    return coreApiRequest<CoreEmployeeNotification>(`/api/core/hr/notifications/${encodeURIComponent(id)}/read`, { method: "POST" });
  },
  markAllNotificationsRead() {
    return coreApiRequest<{ readAt: string }>("/api/core/hr/notifications/read-all", { method: "POST" });
  },
  listRecruitment(limit = 240) {
    return coreApiRequest<CoreRecruitmentApplication[]>("/api/core/hr/recruitment", { query: { limit } });
  },
  createRecruitment(input: Record<string, unknown>) {
    return coreApiRequest<CoreRecruitmentApplication>("/api/core/hr/recruitment", { method: "POST", body: input });
  },
  updateRecruitment(id: string, input: Record<string, unknown>) {
    return coreApiRequest<CoreRecruitmentApplication>(`/api/core/hr/recruitment/${encodeURIComponent(id)}`, { method: "PATCH", body: input });
  },
};
