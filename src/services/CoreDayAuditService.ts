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
  origin?: string;
  sourceSnapshot?: Record<string, unknown>;
  createdAt: string;
  idempotent?: boolean;
};

export type CoreDayAuditView = {
  snapshot: CoreDayAuditSnapshot;
  closing: CoreDayAuditClosing | null;
};

export type LegacyDayAuditImportRow = {
  date: string;
  totalHalalas: number;
  cashHalalas: number;
  cardHalalas: number;
  transferHalalas: number;
  manualCashHalalas: number;
  cashDiffHalalas: number;
  closedAt: string;
};

export type LegacyDayAuditImportResult = {
  imported: CoreDayAuditClosing[];
  skipped: Array<{ date: string; reason: string }>;
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

  importLegacy(closings: LegacyDayAuditImportRow[]) {
    return coreApiRequest<LegacyDayAuditImportResult>("/api/core/day-audit/import-legacy", {
      method: "POST",
      body: { closings },
    });
  },
};
