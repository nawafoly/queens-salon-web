import { coreApiRequest } from "./coreApiClient";

function camel<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const nextKey = key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
    if (Array.isArray(value)) {
      out[nextKey] = value.map((item) => item && typeof item === "object" ? camel(item as Record<string, unknown>) : item);
    } else if (value && typeof value === "object") {
      out[nextKey] = camel(value as Record<string, unknown>);
    } else {
      out[nextKey] = value;
    }
  }
  return out as T;
}

export type EmployeeTargetTier = {
  id: string;
  planId?: string;
  tierName: string;
  tierOrder: number;
  targetAmount: number;
  bonusAmount: number;
  bonusPercentBps: number;
  status: "active" | "inactive";
};

export type EmployeeTargetPlan = {
  id: string;
  name: string;
  description?: string | null;
  status: "active" | "inactive";
  effectiveStart: string;
  effectiveEnd?: string | null;
  cumulativeTiers: number;
  bonusType: "fixed" | "percentage";
  tiers: EmployeeTargetTier[];
  assignments: Array<Record<string, unknown>>;
};

export type EmployeeTargetDashboardRow = {
  employeeId: string;
  employeeName: string;
  plan: EmployeeTargetPlan | null;
  achievedTier: EmployeeTargetTier | null;
  nextTier: EmployeeTargetTier | null;
  currentTargetAmount: number;
  totalEligibleServices: number;
  totalRefunds: number;
  netTargetAmount: number;
  earnedBonusAmount: number;
  progressRatio: number;
  remainingToNextTier: number;
  ledger?: EmployeeTargetLedgerRow[];
};

export type EmployeeTargetLedgerRow = {
  id: string;
  employeeId: string;
  bookingId?: string | null;
  bookingItemId?: string | null;
  serviceId?: string | null;
  serviceName?: string | null;
  transactionType: string;
  grossAmount: number;
  discountAmount: number;
  refundAmount: number;
  eligibleAmount: number;
  performedAt: string;
  detailsJson?: string;
  reason?: string | null;
  rawEmployeeId?: string | null;
  bookingItemStaffId?: string | null;
  bookingStaffId?: string | null;
  details?: Record<string, unknown>;
};

export type EmployeeTargetExcludedTransaction = {
  bookingId?: string | null;
  bookingItemId?: string | null;
  serviceId?: string | null;
  serviceName?: string | null;
  transactionDate?: string | null;
  performedAt?: string | null;
  bookingStatus?: string | null;
  rawEmployeeId?: string | null;
  bookingItemStaffId?: string | null;
  bookingStaffId?: string | null;
  invoicePaidAmount: number;
  grossAmount: number;
  discountAmount: number;
  eligibleAmount: number;
  exclusionReason: string;
};

export type EmployeeTargetDashboard = {
  period: { id?: string | null; payrollMonth?: string | null; monthStart: string; monthEnd: string };
  summary: {
    totalEligibleSales: number;
    unassignedSales?: number;
    unmatchedEmployeeIds?: Array<{
      rawEmployeeId: string;
      eligibleAmount: number;
      rowCount: number;
      bookingIds: string[];
    }>;
    achievedCount: number;
    expectedBonuses: number;
    closeToNextTierCount: number;
    topEmployee: { employeeId: string; employeeName: string; amount: number } | null;
  };
  rows: EmployeeTargetDashboardRow[];
};

export type EmployeeTargetMineSummary = EmployeeTargetDashboardRow & {
  countedBookingCount?: number;
  countedServiceItemCount?: number;
  refundDeductionAmount?: number;
  manualAdjustmentAmount?: number;
  serviceEligibleAmount?: number;
  lastUpdatedAt?: string | null;
  hasTargetPlan?: boolean;
};

export type EmployeeTargetMine = {
  period: {
    id?: string | null;
    payrollMonth?: string | null;
    monthStart: string;
    monthEnd: string;
    status?: string | null;
    isClosed?: number | boolean;
  };
  summary: EmployeeTargetMineSummary;
  groupedByService: Array<{ name: string; amount: number }>;
  groupedByDate: Array<{ date: string; amount: number }>;
  ledger: EmployeeTargetLedgerRow[];
  countedTransactions: EmployeeTargetLedgerRow[];
  refundDeductions: EmployeeTargetLedgerRow[];
  manualAdjustments: EmployeeTargetLedgerRow[];
  excludedTransactions: EmployeeTargetExcludedTransaction[];
  targetCalculation: {
    planId?: string | null;
    planName?: string | null;
    targetAmount: number;
    netTargetAmount: number;
    progressRatio: number;
    achievedTier: EmployeeTargetTier | null;
    nextTier: EmployeeTargetTier | null;
    earnedBonusAmount: number;
    remainingToNextTier: number;
    cumulativeTiers?: number | boolean;
    bonusType?: "fixed" | "percentage" | string;
  };
  lastUpdatedAt?: string | null;
  isPayrollClosed?: boolean;
  authScope?: { ownOnly?: boolean };
};

export const CoreEmployeeTargetService = {
  async dashboard(query: Record<string, string | undefined> = {}) {
    const row = await coreApiRequest<Record<string, unknown>>("/api/core/hr/employee-targets", { query });
    return camel<EmployeeTargetDashboard>(row);
  },
  async mine(query: Record<string, string | undefined> = {}) {
    const row = await coreApiRequest<Record<string, unknown>>("/api/core/hr/employee-targets/mine", { query });
    return camel<EmployeeTargetMine>(row);
  },
  async details(employeeId: string, query: Record<string, string | undefined> = {}) {
    const row = await coreApiRequest<Record<string, unknown>>(`/api/core/hr/employee-targets/${encodeURIComponent(employeeId)}`, { query });
    return camel<Record<string, unknown>>(row);
  },
  async plans() {
    const rows = await coreApiRequest<Record<string, unknown>[]>("/api/core/hr/employee-targets/plans");
    return rows.map((row) => camel<EmployeeTargetPlan>(row));
  },
  async savePlan(input: Record<string, unknown>) {
    const id = String(input.id || "").trim();
    const row = await coreApiRequest<Record<string, unknown>>(
      id ? `/api/core/hr/employee-targets/plans/${encodeURIComponent(id)}` : "/api/core/hr/employee-targets/plans",
      { method: id ? "PATCH" : "POST", body: input }
    );
    return camel<EmployeeTargetPlan>(row);
  },
  async rebuild(input: Record<string, unknown>) {
    return coreApiRequest<{ inserted: number }>("/api/core/hr/employee-targets/rebuild", { method: "POST", body: input });
  },
  async adjust(input: Record<string, unknown>) {
    return coreApiRequest<Record<string, unknown>>("/api/core/hr/employee-targets/adjustments", { method: "POST", body: input });
  },
};
