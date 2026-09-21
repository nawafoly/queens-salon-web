import { coreApiRequest } from "./coreApiClient";
import { mapCoreBooking, mapCoreClient } from "./coreBookingMappers";
import type { CoreBooking, CoreClient } from "../types/coreApi";

export type CoreClientLoyaltySummary = {
  totalClients: number;
  vipCount: number;
  activeLoyaltyCount: number;
  totalPoints: number;
};

const LOYALTY_SUMMARY_TTL_MS = 60_000;
let loyaltySummaryCache: { value: CoreClientLoyaltySummary; expiresAt: number } | null = null;
let loyaltySummaryRequest: Promise<CoreClientLoyaltySummary> | null = null;

function invalidateLoyaltySummary() {
  loyaltySummaryCache = null;
}

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

export type CoreClientCashbackTransaction = {
  id: string;
  type: string;
  amountHalalas: number;
  bookingId?: string | null;
  refundId?: string | null;
  reason?: string | null;
  createdAt: string;
};

export type CoreClientCashback = {
  clientId: string;
  enabled: boolean;
  balanceHalalas: number;
  ledgerBalanceHalalas: number;
  pendingRecoveryHalalas: number;
  earnedHalalas: number;
  redeemedHalalas: number;
  reversedHalalas: number;
  currency: "SAR";
  redeemScope: "salon_only";
  cashWithdrawalAllowed: false;
  transferAllowed: false;
  transactions: CoreClientCashbackTransaction[];
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
  bookings: CoreBooking[];
  payments: CoreClientMoneyRow[];
  refunds: CoreClientMoneyRow[];
  loyalty: CoreClientLoyalty;
  cashback: CoreClientCashback;
  offersUsed: Array<{
    id?: string | null;
    code?: string | null;
    title: string;
    bookingId?: string | null;
    usedAt?: string | null;
  }>;
  relationship: {
    preferredSpecialist: {
      id: string;
      name: string;
      source?: string | null;
    } | null;
    mostBookedSpecialists: Array<{
      id: string;
      name: string;
      visits: number;
    }>;
    mostBookedServices: Array<{
      id: string;
      name: string;
      visits: number;
    }>;
  };
  summary: {
    bookings: number;
    completedBookings: number;
    cancelledBookings: number;
    noShowBookings: number;
    paidHalalas: number;
    refundedHalalas: number;
    netPaidHalalas: number;
    averageCompletedVisitHalalas: number;
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

function mapClient(row: Record<string, unknown>): CoreClient {
  const client = mapCoreClient(row);
  return {
    ...client,
    loyaltyBalance: finiteNumber(row.loyaltyBalance ?? row.loyalty_balance),
    loyaltyEarned: finiteNumber(row.loyaltyEarned ?? row.loyalty_earned),
    loyaltyUsed: finiteNumber(row.loyaltyUsed ?? row.loyalty_used),
    loyaltyReversed: finiteNumber(row.loyaltyReversed ?? row.loyalty_reversed),
    lastCompletedAt: text(row.lastCompletedAt ?? row.last_completed_at) || null,
    bookingsCount: finiteNumber(row.bookingsCount ?? row.bookings_count),
    completedBookingsCount: finiteNumber(
      row.completedBookingsCount ?? row.completed_bookings_count
    ),
    cancelledBookingsCount: finiteNumber(
      row.cancelledBookingsCount ?? row.cancelled_bookings_count
    ),
    noShowBookingsCount: finiteNumber(
      row.noShowBookingsCount ?? row.no_show_bookings_count
    ),
    lastVisitDate: text(row.lastVisitDate ?? row.last_visit_date) || null,
    lastVisitTime: text(row.lastVisitTime ?? row.last_visit_time) || null,
    activePackagesCount: finiteNumber(
      row.activePackagesCount ?? row.active_packages_count
    ),
    remainingPackageSessions: finiteNumber(
      row.remainingPackageSessions ?? row.remaining_package_sessions
    ),
  };
}

function mapCashback(row: Record<string, unknown>): CoreClientCashback {
  const transactions = Array.isArray(row.transactions)
    ? row.transactions.map((entry) => {
        const item = entry as Record<string, unknown>;
        return {
          id: text(item.id),
          type: text(item.type),
          amountHalalas: finiteNumber(item.amountHalalas ?? item.amount_halalas),
          bookingId: text(item.bookingId ?? item.booking_id) || null,
          refundId: text(item.refundId ?? item.refund_id) || null,
          reason: text(item.reason) || null,
          createdAt: text(item.createdAt ?? item.created_at),
        };
      })
    : [];
  return {
    clientId: text(row.clientId ?? row.client_id),
    enabled: row.enabled === true || Number(row.enabled) === 1,
    balanceHalalas: finiteNumber(row.balanceHalalas ?? row.balance_halalas),
    ledgerBalanceHalalas: finiteNumber(
      row.ledgerBalanceHalalas ?? row.ledger_balance_halalas
    ),
    pendingRecoveryHalalas: finiteNumber(
      row.pendingRecoveryHalalas ?? row.pending_recovery_halalas
    ),
    earnedHalalas: finiteNumber(row.earnedHalalas ?? row.earned_halalas),
    redeemedHalalas: finiteNumber(row.redeemedHalalas ?? row.redeemed_halalas),
    reversedHalalas: finiteNumber(row.reversedHalalas ?? row.reversed_halalas),
    currency: "SAR",
    redeemScope: "salon_only",
    cashWithdrawalAllowed: false,
    transferAllowed: false,
    transactions,
  };
}

function mapOverview(row: Record<string, unknown>): CoreClientOverview {
  const summary = (row.summary ?? {}) as Record<string, unknown>;
  const rawClient = (row.client ?? {}) as Record<string, unknown>;
  const relationship = (row.relationship ?? {}) as Record<string, unknown>;
  const preferredSpecialistRaw = relationship.preferredSpecialist as
    | Record<string, unknown>
    | null
    | undefined;
  return {
    client: mapClient(rawClient),
    bookings: Array.isArray(row.bookings)
      ? (row.bookings as Array<Record<string, unknown>>).map(mapCoreBooking)
      : [],
    payments: Array.isArray(row.payments)
      ? (row.payments as CoreClientMoneyRow[])
      : [],
    refunds: Array.isArray(row.refunds)
      ? (row.refunds as CoreClientMoneyRow[])
      : [],
    loyalty: mapLoyalty((row.loyalty ?? {}) as Record<string, unknown>),
    cashback: mapCashback((row.cashback ?? {}) as Record<string, unknown>),
    offersUsed: Array.isArray(row.offersUsed)
      ? (row.offersUsed as CoreClientOverview["offersUsed"])
      : [],
    relationship: {
      preferredSpecialist: preferredSpecialistRaw
        ? {
            id: text(preferredSpecialistRaw.id),
            name: text(preferredSpecialistRaw.name),
            source: text(preferredSpecialistRaw.source) || null,
          }
        : null,
      mostBookedSpecialists: Array.isArray(relationship.mostBookedSpecialists)
        ? (relationship.mostBookedSpecialists as Array<Record<string, unknown>>).map(
            (item) => ({
              id: text(item.id),
              name: text(item.name),
              visits: finiteNumber(item.visits),
            })
          )
        : [],
      mostBookedServices: Array.isArray(relationship.mostBookedServices)
        ? (relationship.mostBookedServices as Array<Record<string, unknown>>).map(
            (item) => ({
              id: text(item.id),
              name: text(item.name),
              visits: finiteNumber(item.visits),
            })
          )
        : [],
    },
    summary: {
      bookings: finiteNumber(summary.bookings),
      completedBookings: finiteNumber(summary.completedBookings),
      cancelledBookings: finiteNumber(summary.cancelledBookings),
      noShowBookings: finiteNumber(summary.noShowBookings),
      paidHalalas: finiteNumber(summary.paidHalalas),
      refundedHalalas: finiteNumber(summary.refundedHalalas),
      netPaidHalalas: finiteNumber(summary.netPaidHalalas),
      averageCompletedVisitHalalas: finiteNumber(
        summary.averageCompletedVisitHalalas
      ),
      lastActivityAt: text(summary.lastActivityAt) || null,
    },
  };
}

export const CoreClientService = {
  async list(
    search = "",
    options: {
      includeLoyalty?: boolean;
      includeMetrics?: boolean;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<CoreClient[]> {
    const rows = await coreApiRequest<Record<string, unknown>[]>(
      "/api/core/clients",
      {
        query: {
          search,
          ...(options.includeLoyalty ? { includeLoyalty: "1" } : {}),
          ...(options.includeMetrics ? { includeMetrics: "1" } : {}),
          limit: options.limit,
          offset: options.offset,
        },
      }
    );
    return rows.map(mapClient);
  },

  async loyaltySummary(): Promise<CoreClientLoyaltySummary> {
    const now = Date.now();
    if (loyaltySummaryCache && loyaltySummaryCache.expiresAt > now) {
      return loyaltySummaryCache.value;
    }
    if (loyaltySummaryRequest) return loyaltySummaryRequest;

    loyaltySummaryRequest = (async () => {
      const row = await coreApiRequest<Record<string, unknown>>(
        "/api/core/clients/loyalty-summary"
      );
      const value = {
        totalClients: finiteNumber(row.totalClients ?? row.total_clients),
        vipCount: finiteNumber(row.vipCount ?? row.vip_count),
        activeLoyaltyCount: finiteNumber(
          row.activeLoyaltyCount ?? row.active_loyalty_count
        ),
        totalPoints: finiteNumber(row.totalPoints ?? row.total_points),
      };
      loyaltySummaryCache = {
        value,
        expiresAt: Date.now() + LOYALTY_SUMMARY_TTL_MS,
      };
      return value;
    })();

    try {
      return await loyaltySummaryRequest;
    } finally {
      loyaltySummaryRequest = null;
    }
  },

  async get(id: string): Promise<CoreClient> {
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/clients/${encodeURIComponent(id)}`
    );
    return mapClient(row);
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
    invalidateLoyaltySummary();
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
    invalidateLoyaltySummary();
    return mapClient(row);
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
    invalidateLoyaltySummary();
    return mapClient(row);
  },

  async updateProfile(
    id: string,
    input: { name: string; phone: string }
  ): Promise<CoreClient> {
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/clients/${encodeURIComponent(id)}`,
      { method: "PATCH", body: input }
    );
    return mapClient(row);
  },
};
