// CORE D1 ONLY — MALIKAT Connect client/staff/admin transport.
import { coreApiRequest } from "./coreApiClient";

export type ConnectConversationStatus = "open" | "review" | "restricted" | "closed";

export type ConnectConversation = {
  id: string;
  clientId: string;
  assignedStaffId: string;
  assignedStaffName: string;
  clientName: string;
  status: ConnectConversationStatus;
  lastMessageAt: string;
  lastMessagePreview: string;
  createdAt: string;
  updatedAt: string;
};

export type ConnectMessage = {
  id: string;
  conversationId: string;
  senderKind: "client" | "staff" | "admin" | "system" | string;
  senderUid: string;
  senderClientId: string;
  senderStaffId: string;
  body: string;
  deliveryStatus: "sent" | "blocked" | string;
  createdAt: string;
};

export type ConnectSendResult =
  | (ConnectMessage & { blocked: false; delivered: true })
  | {
      blocked: true;
      delivered: false;
      messageId: string;
      securityEventId: string;
      detectionType: string;
      severity: string;
      conversationStatus: ConnectConversationStatus;
      userMessage: string;
    };

export type ConnectSecurityEvent = {
  id: string;
  conversationId: string;
  messageId: string;
  actorKind: string;
  actorUid: string;
  detectionType: string;
  severity: "low" | "medium" | "high" | "critical" | string;
  reviewStatus:
    | "new"
    | "under_review"
    | "safe"
    | "warning_issued"
    | "restricted"
    | "closed"
    | string;
  evidenceText: string;
  detectedAt: string;
  reviewedAt: string;
  reviewedByUid: string;
  resolutionNotes: string;
  clientId: string;
  clientName: string;
  assignedStaffId: string;
  assignedStaffName: string;
  conversationStatus: ConnectConversationStatus;
};

export type ConnectSecurityContext = {
  event: ConnectSecurityEvent;
  messages: ConnectMessage[];
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

function mapConversation(row: Record<string, unknown>): ConnectConversation {
  return {
    id: text(row.id),
    clientId: text(row.clientId ?? row.client_id),
    assignedStaffId: text(row.assignedStaffId ?? row.assigned_staff_id),
    assignedStaffName: text(row.assignedStaffName ?? row.assigned_staff_name),
    clientName: text(row.clientName ?? row.client_name),
    status: (text(row.status) || "open") as ConnectConversationStatus,
    lastMessageAt: text(row.lastMessageAt ?? row.last_message_at),
    lastMessagePreview: text(row.lastMessagePreview ?? row.last_message_preview),
    createdAt: text(row.createdAt ?? row.created_at),
    updatedAt: text(row.updatedAt ?? row.updated_at),
  };
}

function mapMessage(row: Record<string, unknown>): ConnectMessage {
  return {
    id: text(row.id),
    conversationId: text(row.conversationId ?? row.conversation_id),
    senderKind: text(row.senderKind ?? row.sender_kind),
    senderUid: text(row.senderUid ?? row.sender_uid),
    senderClientId: text(row.senderClientId ?? row.sender_client_id),
    senderStaffId: text(row.senderStaffId ?? row.sender_staff_id),
    body: text(row.body),
    deliveryStatus: text(row.deliveryStatus ?? row.delivery_status) || "sent",
    createdAt: text(row.createdAt ?? row.created_at),
  };
}

function mapSecurityEvent(row: Record<string, unknown>): ConnectSecurityEvent {
  return {
    id: text(row.id),
    conversationId: text(row.conversationId ?? row.conversation_id),
    messageId: text(row.messageId ?? row.message_id),
    actorKind: text(row.actorKind ?? row.actor_kind),
    actorUid: text(row.actorUid ?? row.actor_uid),
    detectionType: text(row.detectionType ?? row.detection_type),
    severity: text(row.severity),
    reviewStatus: text(row.reviewStatus ?? row.review_status),
    evidenceText: text(row.evidenceText ?? row.evidence_text),
    detectedAt: text(row.detectedAt ?? row.detected_at),
    reviewedAt: text(row.reviewedAt ?? row.reviewed_at),
    reviewedByUid: text(row.reviewedByUid ?? row.reviewed_by_uid),
    resolutionNotes: text(row.resolutionNotes ?? row.resolution_notes),
    clientId: text(row.clientId ?? row.client_id),
    clientName: text(row.clientName ?? row.client_name),
    assignedStaffId: text(row.assignedStaffId ?? row.assigned_staff_id),
    assignedStaffName: text(row.assignedStaffName ?? row.assigned_staff_name),
    conversationStatus: (text(row.conversationStatus ?? row.conversation_status) || "open") as ConnectConversationStatus,
  };
}

function mapSendResult(row: Record<string, unknown>): ConnectSendResult {
  if (row.blocked === true) {
    return {
      blocked: true,
      delivered: false,
      messageId: text(row.messageId ?? row.message_id),
      securityEventId: text(row.securityEventId ?? row.security_event_id),
      detectionType: text(row.detectionType ?? row.detection_type),
      severity: text(row.severity),
      conversationStatus: (text(row.conversationStatus ?? row.conversation_status) || "review") as ConnectConversationStatus,
      userMessage: text(row.userMessage ?? row.user_message),
    };
  }
  return {
    ...mapMessage(row),
    blocked: false,
    delivered: true,
  };
}

export const ClientConnectService = {
  async listClientConversations(limit = 50) {
    const rows = await coreApiRequest<Record<string, unknown>[]>(
      "/api/core/client/connect/conversations",
      { query: { limit } }
    );
    return rows.map(mapConversation);
  },

  async openClientConversation(staffId?: string) {
    const row = await coreApiRequest<Record<string, unknown>>(
      "/api/core/client/connect/conversations",
      {
        method: "POST",
        body: staffId ? { staffId } : {},
      }
    );
    return mapConversation(row);
  },

  async listClientMessages(conversationId: string, limit = 300) {
    const rows = await coreApiRequest<Record<string, unknown>[]>(
      `/api/core/client/connect/conversations/${encodeURIComponent(conversationId)}/messages`,
      { query: { limit } }
    );
    return rows.map(mapMessage);
  },

  async sendClientMessage(conversationId: string, body: string) {
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/client/connect/conversations/${encodeURIComponent(conversationId)}/messages`,
      { method: "POST", body: { body } }
    );
    return mapSendResult(row);
  },

  async listStaffConversations(query: { status?: string; limit?: number } = {}) {
    const rows = await coreApiRequest<Record<string, unknown>[]>(
      "/api/core/hr/client-connect/conversations",
      {
        query: {
          status: query.status,
          limit: query.limit ?? 200,
        },
      }
    );
    return rows.map(mapConversation);
  },

  async listStaffMessages(conversationId: string, limit = 300) {
    const rows = await coreApiRequest<Record<string, unknown>[]>(
      `/api/core/hr/client-connect/conversations/${encodeURIComponent(conversationId)}/messages`,
      { query: { limit } }
    );
    return rows.map(mapMessage);
  },

  async sendStaffMessage(conversationId: string, body: string) {
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/hr/client-connect/conversations/${encodeURIComponent(conversationId)}/messages`,
      { method: "POST", body: { body } }
    );
    return mapSendResult(row);
  },

  async listSecurityEvents(query: { reviewStatus?: string; limit?: number } = {}) {
    const rows = await coreApiRequest<Record<string, unknown>[]>(
      "/api/core/admin/client-connect/security-events",
      {
        query: {
          reviewStatus: query.reviewStatus,
          limit: query.limit ?? 200,
        },
      }
    );
    return rows.map(mapSecurityEvent);
  },

  async getSecurityEvent(eventId: string) {
    const row = await coreApiRequest<{
      event: Record<string, unknown>;
      messages: Record<string, unknown>[];
    }>(
      `/api/core/admin/client-connect/security-events/${encodeURIComponent(eventId)}`
    );
    return {
      event: mapSecurityEvent(row.event || {}),
      messages: Array.isArray(row.messages) ? row.messages.map(mapMessage) : [],
    } satisfies ConnectSecurityContext;
  },

  async reviewSecurityEvent(
    eventId: string,
    reviewStatus: "under_review" | "safe" | "warning_issued" | "restricted" | "closed",
    resolutionNotes = ""
  ) {
    const row = await coreApiRequest<{
      event: Record<string, unknown>;
      messages: Record<string, unknown>[];
    }>(
      `/api/core/admin/client-connect/security-events/${encodeURIComponent(eventId)}/review`,
      {
        method: "POST",
        body: { reviewStatus, resolutionNotes },
      }
    );
    return {
      event: mapSecurityEvent(row.event || {}),
      messages: Array.isArray(row.messages) ? row.messages.map(mapMessage) : [],
    } satisfies ConnectSecurityContext;
  },

  async assignConversation(conversationId: string, staffId: string) {
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/admin/client-connect/conversations/${encodeURIComponent(conversationId)}/assign`,
      {
        method: "POST",
        body: { staffId },
      }
    );
    return mapConversation(row);
  },
};
