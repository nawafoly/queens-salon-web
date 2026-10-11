import { coreApiRequest } from "./coreApiClient";

export type CoreDayAuditUnclassifiedRow = {
  id: string;
  bookingId?: string | null;
  bookingDate?: string | null;
  amountHalalas: number;
  method?: string | null;
  source?: string | null;
  note?: string | null;
  occurredAt?: string | null;
};

export type CoreDayAuditSnapshot = {
  date: string;
  totalHalalas: number;
  cashHalalas: number;
  cardHalalas: number;
  transferHalalas: number;
  unclassifiedHalalas: number;
  unclassifiedRows: CoreDayAuditUnclassifiedRow[];
  rowCount: number;
  sourceVersion: string;
};

export type CoreDayAuditClosing = {
  id: string;
  auditDate: string;
  totalHalalas: number;
  cashHalalas: number;
  cardHalalas: number;
  transferHalalas: number;
  unclassifiedHalalas: number;
  manualCashHalalas: number;
  cashDiffHalalas: number;
  closedAt: string;
  closedByUid?: string | null;
  closedByName?: string | null;
  sourceSnapshot?: Record<string, unknown>;
  createdAt: string;
  idempotent?: boolean;
};

export type CoreDayAuditView = {
  snapshot: CoreDayAuditSnapshot;
  closing: CoreDayAuditClosing | null;
};

export const CoreDayAuditService = {
  get(date: string) {
    return coreApiRequest<CoreDayAuditView>("/api/core/day-audit", {
      query: { date },
    });
  },

  listClosings(limit = 30, offset = 0) {
    return coreApiRequest<CoreDayAuditClosing[]>("/api/core/day-audit/closings", {
      query: { limit, offset },
    });
  },

  close(date: string, manualCashHalalas: number) {
    return coreApiRequest<CoreDayAuditClosing>("/api/core/day-audit/close", {
      method: "POST",
      body: { date, manualCashHalalas },
    });
  },
};
