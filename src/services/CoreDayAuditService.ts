import { coreApiRequest } from "./coreApiClient";

const LEGACY_LOCK_KEY = "dashboard_day_audit_lock_v1";

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

type LegacyLockSnapshot = {
  date?: string;
  manualCash?: number;
  bookingsRevenue?: number;
  cashRevenue?: number;
  cardRevenue?: number;
  transferRevenue?: number;
  diff?: number;
  lockedAt?: number;
};

function toHalalas(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function readLegacyLocalClosings(): CoreDayAuditClosing[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(LEGACY_LOCK_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Record<string, LegacyLockSnapshot>;
    if (!parsed || typeof parsed !== "object") return [];

    return Object.entries(parsed)
      .map<CoreDayAuditClosing | null>(([key, value]) => {
        const date = String(value?.date || key || "").slice(0, 10);
        const lockedAt = Number(value?.lockedAt || 0);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(lockedAt) || lockedAt <= 0) return null;
        const closedAt = new Date(lockedAt).toISOString();
        const totalHalalas = toHalalas(value?.bookingsRevenue || 0);
        const cashHalalas = toHalalas(value?.cashRevenue ?? value?.bookingsRevenue ?? 0);
        const cardHalalas = toHalalas(value?.cardRevenue || 0);
        const transferHalalas = toHalalas(value?.transferRevenue || 0);
        const manualCashHalalas = toHalalas(value?.manualCash || 0);
        const cashDiffHalalas = toHalalas(value?.diff ?? Number(value?.manualCash || 0) - Number(value?.cashRevenue ?? value?.bookingsRevenue ?? 0));
        return {
          id: `legacy-local:${date}`,
          auditDate: date,
          totalHalalas,
          cashHalalas,
          cardHalalas,
          transferHalalas,
          unclassifiedHalalas: 0,
          manualCashHalalas,
          cashDiffHalalas,
          closedAt,
          closedByName: null,
          closedByUid: null,
          origin: "legacy_local_readonly",
          sourceSnapshot: { sourceVersion: "legacy-localStorage-v1" },
          createdAt: closedAt,
        };
      })
      .filter((row): row is CoreDayAuditClosing => row !== null)
      .sort((a, b) => b.auditDate.localeCompare(a.auditDate));
  } catch {
    return [];
  }
}

function legacyClosingForDate(date: string): CoreDayAuditClosing | null {
  return readLegacyLocalClosings().find((row) => row.auditDate === date) || null;
}

function mergeClosingHistory(coreRows: CoreDayAuditClosing[], limit: number, offset: number) {
  if (offset > 0) return coreRows;
  const seen = new Set(coreRows.map((row) => row.auditDate));
  const legacy = readLegacyLocalClosings().filter((row) => !seen.has(row.auditDate));
  return [...coreRows, ...legacy]
    .sort((a, b) => b.auditDate.localeCompare(a.auditDate) || b.closedAt.localeCompare(a.closedAt))
    .slice(0, Math.max(1, limit));
}

export const CoreDayAuditService = {
  async get(date: string) {
    const result = await coreApiRequest<CoreDayAuditView>("/api/core/day-audit", {
      query: { date },
    });
    if (result.closing) return result;
    const legacy = legacyClosingForDate(date);
    return legacy ? { ...result, closing: legacy } : result;
  },

  async listClosings(limit = 30, offset = 0) {
    const rows = await coreApiRequest<CoreDayAuditClosing[]>("/api/core/day-audit/closings", {
      query: { limit, offset },
    });
    return mergeClosingHistory(rows, limit, offset);
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
