import {
  PackageOperationsService,
  type PackageClientWalletResult,
  type PackageSessionDashboardPackage,
  type PackageSessionDashboardTransaction,
  type PackageWalletItem,
  type PackageWalletTransaction,
} from "./PackageOperationsService";

export type ClientPackageStatus = "active" | "exhausted" | "expired" | "cancelled";

export type ClientPackageCatalogSnapshot = {
  name: string;
  description?: string;
  sessionsCount: number;
  price: number;
  allowedServiceIds: string[];
  validityDays?: number;
};

export type ClientPackage = {
  id?: string;
  clientId: string;
  legacyClientDocId?: string;
  phoneSnapshot?: string;
  packageCatalogId: string;
  packageNameSnapshot: string;
  packageDescriptionSnapshot?: string;
  allowedServiceIdsSnapshot: string[];
  totalSessions: number;
  remainingSessions: number;
  reservedSessions: number;
  usedSessions: number;
  purchasePrice: number;
  purchasedAt: unknown;
  expiresAt?: unknown;
  status: ClientPackageStatus;
  invoiceId: string;
  invoiceDocumentId?: string;
  invoiceNumber?: string;
  catalogSnapshot: ClientPackageCatalogSnapshot;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type ClientPackageTransactionType =
  | "purchase"
  | "reserve"
  | "consume"
  | "restore"
  | "cancel"
  | "admin_adjustment"
  | "admin_restore";

export type ClientPackageTransaction = {
  id?: string;
  clientPackageId: string;
  clientId: string;
  type: ClientPackageTransactionType;
  bookingId?: string;
  invoiceId?: string;
  serviceId?: string;
  sessionsDelta: number;
  remainingBefore: number;
  remainingAfter: number;
  reservedBefore?: number;
  reservedAfter?: number;
  usedBefore?: number;
  usedAfter?: number;
  idempotencyKey: string;
  reason?: string;
  createdBy: string;
  createdAt: unknown;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function statusValue(value: unknown): ClientPackageStatus {
  const status = text(value);
  if (
    status === "active" ||
    status === "exhausted" ||
    status === "expired" ||
    status === "cancelled"
  ) {
    return status;
  }
  return "active";
}

function normalizeWalletPackage(
  raw: PackageWalletItem | PackageSessionDashboardPackage
): ClientPackage {
  const row = raw as PackageWalletItem & PackageSessionDashboardPackage & Record<string, unknown>;
  const allowedServiceIds = Array.isArray(row.allowedServiceIdsSnapshot)
    ? row.allowedServiceIdsSnapshot.map(text).filter(Boolean)
    : Array.isArray(row.allowedServiceIds)
      ? (row.allowedServiceIds as unknown[]).map(text).filter(Boolean)
      : Array.isArray(row.serviceIds)
        ? (row.serviceIds as unknown[]).map(text).filter(Boolean)
        : [];

  const totalSessions = Math.max(0, numberValue(row.totalSessions));
  const usedSessions = Math.max(0, numberValue(row.usedSessions));
  const reservedSessions = Math.max(0, numberValue(row.reservedSessions));
  const remainingSessions = Math.max(
    0,
    numberValue(
      row.remainingSessions ??
        Math.max(0, totalSessions - usedSessions - reservedSessions)
    )
  );
  const packageName = text(
    row.packageNameSnapshot ?? row.packageName ?? row.name
  );

  return {
    id: text(row.id) || undefined,
    clientId: text(row.canonicalClientId ?? row.clientId),
    legacyClientDocId: text(row.legacyClientDocId) || undefined,
    phoneSnapshot: text(row.phoneSnapshot ?? row.phone) || undefined,
    packageCatalogId: text(row.packageCatalogId ?? row.packageId),
    packageNameSnapshot: packageName,
    packageDescriptionSnapshot:
      text(row.packageDescriptionSnapshot ?? row.description) || undefined,
    allowedServiceIdsSnapshot: allowedServiceIds,
    totalSessions,
    remainingSessions,
    reservedSessions,
    usedSessions,
    purchasePrice: Math.max(
      0,
      numberValue(row.purchasePrice ?? row.pricePaid ?? row.price)
    ),
    purchasedAt: row.purchasedAt ?? row.createdAt ?? "",
    expiresAt: row.expiresAt,
    status: statusValue(row.status),
    invoiceId: text(row.invoiceId),
    invoiceDocumentId: text(row.invoiceDocumentId) || undefined,
    invoiceNumber: text(row.invoiceNumber) || undefined,
    catalogSnapshot: {
      name: packageName,
      description:
        text(row.packageDescriptionSnapshot ?? row.description) || undefined,
      sessionsCount: totalSessions,
      price: Math.max(
        0,
        numberValue(row.purchasePrice ?? row.pricePaid ?? row.price)
      ),
      allowedServiceIds,
      validityDays:
        row.validityDays == null
          ? undefined
          : Math.max(1, Math.floor(numberValue(row.validityDays))),
    },
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function normalizeTransaction(
  raw: PackageWalletTransaction | PackageSessionDashboardTransaction
): ClientPackageTransaction {
  const row = raw as PackageWalletTransaction &
    PackageSessionDashboardTransaction &
    Record<string, unknown>;
  return {
    id: text(row.id) || undefined,
    clientPackageId: text(row.clientPackageId),
    clientId: text(row.canonicalClientId ?? row.clientId),
    type: (text(row.type) || "admin_adjustment") as ClientPackageTransactionType,
    bookingId: text(row.bookingId) || undefined,
    invoiceId: text(row.invoiceId) || undefined,
    serviceId: text(row.serviceId) || undefined,
    sessionsDelta: numberValue(row.sessionsDelta),
    remainingBefore: numberValue(row.remainingBefore),
    remainingAfter: numberValue(row.remainingAfter),
    reservedBefore: numberValue(row.reservedBefore),
    reservedAfter: numberValue(row.reservedAfter),
    usedBefore: numberValue(row.usedBefore),
    usedAfter: numberValue(row.usedAfter),
    idempotencyKey: text(row.idempotencyKey ?? row.id) || "core-d1",
    reason: text(row.reason) || undefined,
    createdBy: text(row.createdByUid ?? row.createdBy) || "core-d1",
    createdAt: row.createdAt ?? "",
  };
}

const transactionCache = new Map<string, ClientPackageTransaction[]>();

function cacheTransactions(rows: ClientPackageTransaction[]): void {
  const grouped = new Map<string, ClientPackageTransaction[]>();
  for (const row of rows) {
    const key = text(row.clientPackageId);
    if (!key) continue;
    const current = grouped.get(key) ?? [];
    current.push(row);
    grouped.set(key, current);
  }
  grouped.forEach((value, key) => transactionCache.set(key, value));
}

export const ClientPackageService = {
  normalizePackages(
    rows: Array<PackageWalletItem | PackageSessionDashboardPackage>
  ): ClientPackage[] {
    return rows.map((row) => normalizeWalletPackage(row));
  },

  async getWalletByClient(clientIdRaw: string): Promise<PackageClientWalletResult> {
    const clientId = text(clientIdRaw);
    if (!clientId) {
      return {
        ok: true,
        clientId: "",
        canonicalClientId: "",
        packages: [],
        transactions: [],
        services: {},
        activePackages: [],
        totalRemainingSessions: 0,
        totalUsedSessions: 0,
        totalReservedSessions: 0,
      };
    }
    const wallet = await PackageOperationsService.clientWallet({ clientId });
    cacheTransactions(
      (wallet.transactions ?? []).map((row) => normalizeTransaction(row))
    );
    return wallet;
  },

  async getAll(): Promise<ClientPackage[]> {
    const dashboard = await PackageOperationsService.sessionDashboard();
    const transactions = (dashboard.transactions ?? []).map((row) =>
      normalizeTransaction(row)
    );
    cacheTransactions(transactions);
    return this.normalizePackages(dashboard.packages ?? []);
  },

  async getByClient(clientIdRaw: string): Promise<ClientPackage[]> {
    const wallet = await this.getWalletByClient(clientIdRaw);
    return this.normalizePackages(wallet.packages ?? []);
  },

  async getTransactions(
    clientPackageIdRaw: string
  ): Promise<ClientPackageTransaction[]> {
    const clientPackageId = text(clientPackageIdRaw);
    if (!clientPackageId) return [];
    const cached = transactionCache.get(clientPackageId);
    if (cached) return [...cached];

    const dashboard = await PackageOperationsService.sessionDashboard();
    const rows = (dashboard.transactions ?? [])
      .map((row) => normalizeTransaction(row))
      .filter((row) => row.clientPackageId === clientPackageId);
    transactionCache.set(clientPackageId, rows);
    return rows;
  },
};