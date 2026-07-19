import { coreApiRequest } from "./coreApiClient";
import { mapCoreClient } from "./coreBookingMappers";
import type { CoreClient } from "../types/coreApi";

export type CoreClientLoyaltyTransaction = {
  id: string;
  type: string;
  points: number;
  booking_id?: string | null;
  refund_id?: string | null;
  reason?: string | null;
  created_at: string;
  created_by_uid?: string | null;
};

export type CoreClientLoyalty = {
  clientId: string;
  membershipId: string;
  balance: number;
  earned: number;
  used: number;
  reversed: number;
  level: number;
  levelKey: string;
  levelLabel: string;
  progress: number;
  pointsToNext: number;
  nextLevelLabel?: string | null;
  transactions: CoreClientLoyaltyTransaction[];
};

export type CoreClientMoneyRow = Record<string, unknown> & {
  id?: string;
  booking_id?: string;
  amount_halalas?: number;
  status?: string;
  method?: string;
  provider?: string;
  paid_at?: string;
  refunded_at?: string;
  created_at?: string;
};

export type CoreClientOverview = {
  client: CoreClient;
  bookings: Array<Record<string, unknown>>;
  payments: CoreClientMoneyRow[];
  refunds: CoreClientMoneyRow[];
  loyalty: CoreClientLoyalty;
  offersUsed: Array<{
    id?: string | null;
    code?: string | null;
    title: string;
    bookingId?: string | null;
    usedAt?: string | null;
  }>;
  summary: {
    bookings: number;
    completedBookings: number;
    paidHalalas: number;
    refundedHalalas: number;
    netPaidHalalas: number;
    lastActivityAt?: string | null;
  };
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapLoyalty(row: Record<string, unknown>): CoreClientLoyalty {
  return {
    clientId: text(row.clientId ?? row.client_id),
    membershipId: text(row.membershipId ?? row.membership_id),
    balance: finiteNumber(row.balance),
    earned: finiteNumber(row.earned),
    used: finiteNumber(row.used),
    reversed: finiteNumber(row.reversed),
    level: Math.max(1, finiteNumber(row.level)),
    levelKey: text(row.levelKey ?? row.level_key),
    levelLabel: text(row.levelLabel ?? row.level_label),
    progress: Math.max(0, Math.min(100, finiteNumber(row.progress))),
    pointsToNext: Math.max(0, finiteNumber(row.pointsToNext ?? row.points_to_next)),
    nextLevelLabel: text(row.nextLevelLabel ?? row.next_level_label) || null,
    transactions: Array.isArray(row.transactions)
      ? (row.transactions as CoreClientLoyaltyTransaction[])
      : [],
  };
}

function mapOverview(row: Record<string, unknown>): CoreClientOverview {
  const summary = (row.summary ?? {}) as Record<string, unknown>;
  const rawClient = (row.client ?? {}) as Record<string, unknown>;
  return {
    client: mapCoreClient(rawClient),
    bookings: Array.isArray(row.bookings)
      ? (row.bookings as Array<Record<string, unknown>>)
      : [],
    payments: Array.isArray(row.payments)
      ? (row.payments as CoreClientMoneyRow[])
      : [],
    refunds: Array.isArray(row.refunds)
      ? (row.refunds as CoreClientMoneyRow[])
      : [],
    loyalty: mapLoyalty((row.loyalty ?? {}) as Record<string, unknown>),
    offersUsed: Array.isArray(row.offersUsed)
      ? (row.offersUsed as CoreClientOverview["offersUsed"])
      : [],
    summary: {
      bookings: finiteNumber(summary.bookings),
      completedBookings: finiteNumber(summary.completedBookings),
      paidHalalas: finiteNumber(summary.paidHalalas),
      refundedHalalas: finiteNumber(summary.refundedHalalas),
      netPaidHalalas: finiteNumber(summary.netPaidHalalas),
      lastActivityAt: text(summary.lastActivityAt) || null,
    },
  };
}

export const CoreClientService = {
  async list(search = ""): Promise<CoreClient[]> {
    const rows = await coreApiRequest<Record<string, unknown>[]>(
      "/api/core/clients",
      { query: { search } }
    );
    return rows.map(mapCoreClient);
  },

  async get(id: string): Promise<CoreClient> {
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/clients/${encodeURIComponent(id)}`
    );
    return mapCoreClient(row);
  },

  async overview(id: string): Promise<CoreClientOverview> {
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/clients/${encodeURIComponent(id)}/overview`
    );
    return mapOverview(row);
  },

  async adjustLoyalty(
    id: string,
    input: { points: number; reason: string; operationId: string }
  ): Promise<CoreClientLoyalty> {
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/clients/${encodeURIComponent(id)}/loyalty-adjustments`,
      { method: "POST", body: input }
    );
    return mapLoyalty(row);
  },

  async create(input: {
    id?: string;
    name: string;
    phone: string;
    email?: string;
    firebaseUid?: string;
    notes?: string;
    vip?: boolean;
    legacyClientDocId?: string;
  }): Promise<CoreClient> {
    const row = await coreApiRequest<Record<string, unknown>>(
      "/api/core/clients",
      { method: "POST", body: input }
    );
    return mapCoreClient(row);
  },

  async patch(
    id: string,
    input: Partial<{
      name: string;
      phone: string;
      email: string;
      firebaseUid: string;
      status: string;
      notes: string;
      vip: boolean;
      legacyClientDocId: string;
    }>
  ): Promise<CoreClient> {
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/clients/${encodeURIComponent(id)}`,
      { method: "PATCH", body: input }
    );
    return mapCoreClient(row);
  },

  async updateProfile(
    id: string,
    input: { name: string; phone: string }
  ): Promise<CoreClient> {
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/clients/${encodeURIComponent(id)}`,
      { method: "PATCH", body: input }
    );
    return mapCoreClient(row);
  },
};
