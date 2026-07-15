import { coreApiRequest } from "./coreApiClient";
import type { CoreRefund } from "../types/coreApi";

function mapRefund(row: Record<string, unknown>): CoreRefund {
  return {
    id: String(row.id || ""),
    salonId: String(row.salon_id || "main"),
    paymentId: row.payment_id == null ? null : String(row.payment_id),
    invoiceId: row.invoice_id == null ? null : String(row.invoice_id),
    bookingId: row.booking_id == null ? null : String(row.booking_id),
    clientId: row.client_id == null ? null : String(row.client_id),
    amountHalalas: Number(row.amount_halalas || 0),
    method: String(row.method || "cash"),
    reason: row.reason == null ? null : String(row.reason),
    status: String(row.status || "completed"),
    idempotencyKey: row.idempotency_key == null ? null : String(row.idempotency_key),
    providerReference: row.provider_reference == null ? null : String(row.provider_reference),
    createdByUid: row.created_by_uid == null ? null : String(row.created_by_uid),
    refundedAt: String(row.refunded_at || ""),
    voidedAt: row.voided_at == null ? null : String(row.voided_at),
    voidedByUid: row.voided_by_uid == null ? null : String(row.voided_by_uid),
    createdAt: String(row.created_at || ""),
    idempotent: Boolean(row.idempotent),
  };
}

export const CoreRefundService = {
  async list(query: { bookingId?: string; paymentId?: string } = {}): Promise<CoreRefund[]> {
    const rows = await coreApiRequest<Record<string, unknown>[]>("/api/core/refunds", { query });
    return rows.map(mapRefund);
  },
  async create(input: Record<string, unknown>): Promise<CoreRefund> {
    return mapRefund(await coreApiRequest<Record<string, unknown>>("/api/core/refunds", { method: "POST", body: input }));
  },
  async patch(id: string, input: Record<string, unknown>): Promise<CoreRefund> {
    return mapRefund(await coreApiRequest<Record<string, unknown>>(`/api/core/refunds/${encodeURIComponent(id)}`, { method: "PATCH", body: input }));
  },
  async remove(id: string): Promise<CoreRefund> {
    return mapRefund(await coreApiRequest<Record<string, unknown>>(`/api/core/refunds/${encodeURIComponent(id)}`, { method: "DELETE" }));
  },
};
