// CORE D1 ONLY — do not add Firestore fallback.
import { coreApiRequest } from "./coreApiClient";

export type ContactMessage = {
  id: string;
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
  source?: string;
  status: "new" | "read";
  createdAt: string;
  readAt?: string;
};

export type ContactMessageSubmitInput = {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
  source?: string;
};

function mapMessage(row: Record<string, unknown>): ContactMessage {
  const statusRaw = String(row.status || "new").trim().toLowerCase();
  return {
    id: String(row.id || ""),
    name: String(row.name || ""),
    email: String(row.email || ""),
    phone: String(row.phone || ""),
    subject: String(row.subject || ""),
    message: String(row.message || ""),
    source: row.source == null || row.source === "" ? undefined : String(row.source),
    status: statusRaw === "read" ? "read" : "new",
    createdAt: String(row.createdAt || row.created_at || ""),
    readAt:
      row.readAt == null && row.read_at == null
        ? undefined
        : String(row.readAt || row.read_at || ""),
  };
}

export const CoreContactService = {
  async submit(input: ContactMessageSubmitInput): Promise<ContactMessage> {
    const row = await coreApiRequest<Record<string, unknown>>(
      "/api/core/contact-messages",
      { method: "POST", body: { ...input } }
    );
    return mapMessage(row);
  },

  async list(limit = 20): Promise<ContactMessage[]> {
    const rows = await coreApiRequest<Record<string, unknown>[]>(
      "/api/core/contact-messages",
      { query: { limit } }
    );
    return (Array.isArray(rows) ? rows : []).map(mapMessage);
  },

  async markRead(id: string): Promise<ContactMessage> {
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/contact-messages/${encodeURIComponent(id)}`,
      { method: "PATCH", body: { status: "read" } }
    );
    return mapMessage(row);
  },
};
