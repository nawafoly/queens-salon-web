import { createHash } from "node:crypto";
import { PACKAGE_INPUT_LIMITS } from "./packageSubscriptionValidation.js";

export const CLIENT_PACKAGE_STATUSES = [
  "active",
  "exhausted",
  "expired",
  "cancelled",
] as const;

export type ClientPackageStatus = (typeof CLIENT_PACKAGE_STATUSES)[number];

export const PACKAGE_TRANSACTION_TYPES = [
  "purchase",
  "reserve",
  "consume",
  "restore",
  "cancel",
  "admin_adjustment",
  "admin_restore",
] as const;

export type PackageTransactionType = (typeof PACKAGE_TRANSACTION_TYPES)[number];

export type PackageBalances = {
  totalSessions: number;
  remainingSessions: number;
  reservedSessions: number;
  usedSessions: number;
  status: ClientPackageStatus;
  expiresAtMs?: number;
};

export type PackageCandidate = PackageBalances & {
  id: string;
  clientId: string;
  allowedServiceIdsSnapshot: string[];
  purchasedAtMs?: number;
};

export type PackageCancellationPolicy = {
  lateCancellationWindowMinutes: number;
  lateCancellationConsumesSession: boolean;
  noShowConsumesSession: boolean;
};

export const DEFAULT_PACKAGE_CANCELLATION_POLICY: PackageCancellationPolicy = {
  lateCancellationWindowMinutes: 240,
  lateCancellationConsumesSession: true,
  noShowConsumesSession: true,
};

export type PurchasedPackageSnapshot = {
  name: string;
  description?: string;
  sessionsCount: number;
  price: number;
  allowedServiceIds: string[];
  validityDays?: number;
};

export type BalanceTransition = {
  before: PackageBalances;
  after: PackageBalances;
  sessionsDelta: number;
};

export class PackageDomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "PackageDomainError";
    this.code = code;
  }
}

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  value.forEach((item) => {
    const normalized = String(item || "").trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    out.push(normalized);
  });
  return out;
}

export function positiveInteger(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new PackageDomainError("INVALID_ARGUMENT", `${field} must be a positive integer`);
  }
  return parsed;
}

export function nonNegativeMoney(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new PackageDomainError("INVALID_ARGUMENT", `${field} must be non-negative`);
  }
  return Math.round(parsed * 100) / 100;
}

export function buildPurchasedPackageSnapshot(raw: Record<string, unknown>): PurchasedPackageSnapshot {
  const name = String(raw.name || "").trim();
  if (!name) throw new PackageDomainError("INVALID_CATALOG", "Package name is required");
  if (name.length > PACKAGE_INPUT_LIMITS.packageName) {
    throw new PackageDomainError("INVALID_CATALOG", "Package name is too long");
  }
  const sessionsCount = positiveInteger(raw.sessionsCount, "sessionsCount");
  if (sessionsCount > PACKAGE_INPUT_LIMITS.sessions) {
    throw new PackageDomainError("INVALID_CATALOG", "Package session count is too large");
  }
  const price = nonNegativeMoney(raw.price, "price");
  if (price > PACKAGE_INPUT_LIMITS.price) {
    throw new PackageDomainError("INVALID_CATALOG", "Package price is too large");
  }
  const allowedServiceIds = normalizeStringArray([
    ...(Array.isArray(raw.allowedServiceIds) ? raw.allowedServiceIds : []),
    ...(Array.isArray(raw.serviceIds) ? raw.serviceIds : []),
  ]);
  if (!allowedServiceIds.length) {
    throw new PackageDomainError("INVALID_CATALOG", "Package must include at least one service");
  }
  if (allowedServiceIds.length > PACKAGE_INPUT_LIMITS.allowedServices) {
    throw new PackageDomainError("INVALID_CATALOG", "Package includes too many services");
  }
  if (allowedServiceIds.some((id) => id.length > PACKAGE_INPUT_LIMITS.documentId || id.includes("/"))) {
    throw new PackageDomainError("INVALID_CATALOG", "Package contains an invalid service id");
  }
  const validityRaw = raw.validityDays;
  const validityDays =
    validityRaw === undefined || validityRaw === null || validityRaw === ""
      ? undefined
      : positiveInteger(validityRaw, "validityDays");
  if (validityDays && validityDays > PACKAGE_INPUT_LIMITS.validityDays) {
    throw new PackageDomainError("INVALID_CATALOG", "Package validity is too large");
  }
  const description = String(raw.description || "").trim() || undefined;
  if (description && description.length > PACKAGE_INPUT_LIMITS.packageDescription) {
    throw new PackageDomainError("INVALID_CATALOG", "Package description is too long");
  }
  return {
    name,
    ...(description ? { description } : {}),
    sessionsCount,
    price,
    allowedServiceIds,
    ...(validityDays ? { validityDays } : {}),
  };
}

export function assertBalanceInvariant(value: PackageBalances): void {
  const fields = [
    value.totalSessions,
    value.remainingSessions,
    value.reservedSessions,
    value.usedSessions,
  ];
  if (fields.some((item) => !Number.isInteger(item) || item < 0)) {
    throw new PackageDomainError("INVALID_BALANCE", "Package balances must be non-negative integers");
  }
  if (
    value.totalSessions !==
    value.remainingSessions + value.reservedSessions + value.usedSessions
  ) {
    throw new PackageDomainError("INVALID_BALANCE", "Package balance invariant failed");
  }
}

export function derivePackageStatus(
  balances: Omit<PackageBalances, "status"> & { status?: ClientPackageStatus },
  nowMs: number
): ClientPackageStatus {
  if (balances.status === "cancelled") return "cancelled";
  if (balances.expiresAtMs !== undefined && balances.expiresAtMs < nowMs) return "expired";
  if (balances.remainingSessions === 0 && balances.reservedSessions === 0) return "exhausted";
  return "active";
}

export function normalizeBalances(raw: Partial<PackageBalances>, nowMs: number): PackageBalances {
  const normalized: PackageBalances = {
    totalSessions: Number(raw.totalSessions || 0),
    remainingSessions: Number(raw.remainingSessions || 0),
    reservedSessions: Number(raw.reservedSessions || 0),
    usedSessions: Number(raw.usedSessions || 0),
    status: raw.status || "active",
    ...(raw.expiresAtMs !== undefined ? { expiresAtMs: raw.expiresAtMs } : {}),
  };
  assertBalanceInvariant(normalized);
  normalized.status = derivePackageStatus(normalized, nowMs);
  return normalized;
}

function finishTransition(
  before: PackageBalances,
  draft: Omit<PackageBalances, "status"> & { status?: ClientPackageStatus },
  sessionsDelta: number,
  nowMs: number
): BalanceTransition {
  const after: PackageBalances = {
    ...draft,
    status: derivePackageStatus(draft, nowMs),
  };
  assertBalanceInvariant(after);
  return { before, after, sessionsDelta };
}

export function reserveOneSession(raw: PackageBalances, nowMs: number): BalanceTransition {
  const before = normalizeBalances(raw, nowMs);
  if (before.status !== "active") {
    throw new PackageDomainError("PACKAGE_NOT_ACTIVE", `Package is ${before.status}`);
  }
  if (before.remainingSessions <= 0) {
    throw new PackageDomainError("PACKAGE_EXHAUSTED", "No remaining sessions");
  }
  return finishTransition(
    before,
    {
      ...before,
      remainingSessions: before.remainingSessions - 1,
      reservedSessions: before.reservedSessions + 1,
    },
    -1,
    nowMs
  );
}

export function consumeOneReservedSession(raw: PackageBalances, nowMs: number): BalanceTransition {
  const before = normalizeBalances(raw, nowMs);
  if (before.status === "cancelled") {
    throw new PackageDomainError("PACKAGE_CANCELLED", "Cancelled package cannot be consumed");
  }
  if (before.reservedSessions <= 0) {
    throw new PackageDomainError("NO_RESERVED_SESSION", "No reserved session exists");
  }
  return finishTransition(
    before,
    {
      ...before,
      reservedSessions: before.reservedSessions - 1,
      usedSessions: before.usedSessions + 1,
    },
    0,
    nowMs
  );
}

export function restoreOneReservedSession(raw: PackageBalances, nowMs: number): BalanceTransition {
  const before = normalizeBalances(raw, nowMs);
  if (before.status === "cancelled") {
    throw new PackageDomainError("PACKAGE_CANCELLED", "Cancelled package cannot be restored");
  }
  if (before.reservedSessions <= 0) {
    throw new PackageDomainError("NO_RESERVED_SESSION", "No reserved session exists");
  }
  return finishTransition(
    before,
    {
      ...before,
      reservedSessions: before.reservedSessions - 1,
      remainingSessions: before.remainingSessions + 1,
    },
    1,
    nowMs
  );
}

export function restoreOneUsedSession(raw: PackageBalances, nowMs: number): BalanceTransition {
  const before = normalizeBalances(raw, nowMs);
  if (before.status === "cancelled") {
    throw new PackageDomainError("PACKAGE_CANCELLED", "Cancelled package cannot be restored");
  }
  if (before.usedSessions <= 0) {
    throw new PackageDomainError("NO_USED_SESSION", "No used session exists");
  }
  return finishTransition(
    before,
    {
      ...before,
      usedSessions: before.usedSessions - 1,
      remainingSessions: before.remainingSessions + 1,
    },
    1,
    nowMs
  );
}

export function cancelPackage(raw: PackageBalances, nowMs: number): BalanceTransition {
  const before = normalizeBalances(raw, nowMs);
  if (before.reservedSessions > 0) {
    throw new PackageDomainError("PACKAGE_HAS_RESERVATIONS", "Restore reserved sessions before cancelling");
  }
  if (before.status === "cancelled") return { before, after: before, sessionsDelta: 0 };
  const after: PackageBalances = { ...before, status: "cancelled" };
  assertBalanceInvariant(after);
  return { before, after, sessionsDelta: 0 };
}

export function adjustRemainingBalance(
  raw: PackageBalances,
  sessionsDelta: number,
  nowMs: number
): BalanceTransition {
  const before = normalizeBalances(raw, nowMs);
  if (before.status === "cancelled") {
    throw new PackageDomainError("PACKAGE_CANCELLED", "Cancelled package cannot be adjusted");
  }
  if (!Number.isInteger(sessionsDelta) || sessionsDelta === 0) {
    throw new PackageDomainError("INVALID_ARGUMENT", "sessionsDelta must be a non-zero integer");
  }
  if (before.remainingSessions + sessionsDelta < 0 || before.totalSessions + sessionsDelta < 0) {
    throw new PackageDomainError("NEGATIVE_BALANCE", "Adjustment would create a negative balance");
  }
  return finishTransition(
    before,
    {
      ...before,
      totalSessions: before.totalSessions + sessionsDelta,
      remainingSessions: before.remainingSessions + sessionsDelta,
    },
    sessionsDelta,
    nowMs
  );
}

export function isEligiblePackage(
  candidate: PackageCandidate,
  clientId: string,
  serviceId: string,
  nowMs: number,
  appointmentAtMs = nowMs
): boolean {
  if (candidate.clientId !== clientId) return false;
  const balances = normalizeBalances(candidate, nowMs);
  if (balances.status !== "active" || balances.remainingSessions <= 0) return false;
  if (candidate.expiresAtMs !== undefined && appointmentAtMs > candidate.expiresAtMs) return false;
  return normalizeStringArray(candidate.allowedServiceIdsSnapshot).includes(serviceId);
}

export function selectNearestExpiringPackage(
  candidates: PackageCandidate[],
  clientId: string,
  serviceId: string,
  nowMs: number,
  appointmentAtMs = nowMs
): PackageCandidate | null {
  const eligible = candidates.filter((item) =>
    isEligiblePackage(item, clientId, serviceId, nowMs, appointmentAtMs)
  );
  eligible.sort((a, b) => {
    const aExpiry = a.expiresAtMs ?? Number.POSITIVE_INFINITY;
    const bExpiry = b.expiresAtMs ?? Number.POSITIVE_INFINITY;
    if (aExpiry !== bExpiry) return aExpiry - bExpiry;
    const aPurchased = a.purchasedAtMs ?? 0;
    const bPurchased = b.purchasedAtMs ?? 0;
    if (aPurchased !== bPurchased) return aPurchased - bPurchased;
    return a.id.localeCompare(b.id);
  });
  return eligible[0] || null;
}

export function buildIdempotencyDocumentId(type: PackageTransactionType, entityId: string): string {
  const normalized = String(entityId || "").trim();
  if (!normalized) throw new PackageDomainError("INVALID_ARGUMENT", "Transaction entity id is invalid");
  const safe = normalized.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
  const hash = createHash("sha256").update(normalized).digest("hex").slice(0, 20);
  return `${type}:${safe || "source"}:${hash}`;
}

export const transactionId = buildIdempotencyDocumentId;

export function shouldConsumeCancelledReservation(args: {
  nowMs: number;
  appointmentAtMs: number;
  policy: PackageCancellationPolicy;
}): boolean {
  const cutoffMs = Math.max(0, args.policy.lateCancellationWindowMinutes) * 60_000;
  return args.policy.lateCancellationConsumesSession &&
    args.appointmentAtMs - args.nowMs <= cutoffMs;
}
