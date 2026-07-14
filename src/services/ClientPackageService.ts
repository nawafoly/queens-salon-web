import {
  collection,
  getDocs,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import { db } from "./firebase";

const SALON_ID = "main";
const PACKAGES_PATH = ["salons", SALON_ID, "client_packages"] as const;
const TRANSACTIONS_PATH = ["salons", SALON_ID, "client_package_transactions"] as const;

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
  purchasedAt: Timestamp | any;
  expiresAt?: Timestamp | any;
  status: ClientPackageStatus;
  invoiceId: string;
  invoiceDocumentId?: string;
  invoiceNumber?: string;
  catalogSnapshot: ClientPackageCatalogSnapshot;
  createdAt?: Timestamp | any;
  updatedAt?: Timestamp | any;
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
  createdAt: Timestamp | any;
};

function timestampMillis(value: any): number {
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  return 0;
}

function normalizeClientPackage(id: string, raw: any): ClientPackage {
  const totalSessions = Math.max(0, Number(raw?.totalSessions || 0));
  const usedSessions = Math.max(0, Number(raw?.usedSessions || 0));
  const reservedSessions = Math.max(0, Number(raw?.reservedSessions || 0));
  const remainingSessions = Math.max(
    0,
    Number(raw?.remainingSessions ?? totalSessions - usedSessions - reservedSessions)
  );
  const allowedServiceIdsSnapshot = Array.isArray(raw?.allowedServiceIdsSnapshot)
    ? raw.allowedServiceIdsSnapshot
    : Array.isArray(raw?.serviceIds)
      ? raw.serviceIds
      : [];
  const packageNameSnapshot = String(raw?.packageNameSnapshot || raw?.packageName || "").trim();
  const purchasePrice = Math.max(0, Number(raw?.purchasePrice ?? raw?.pricePaid ?? 0));
  const status: ClientPackageStatus =
    raw?.status === "active" ||
    raw?.status === "exhausted" ||
    raw?.status === "expired" ||
    raw?.status === "cancelled"
      ? raw.status
      : raw?.active === false
        ? "cancelled"
        : remainingSessions <= 0 && reservedSessions <= 0
          ? "exhausted"
          : "active";

  return {
    id,
    clientId: String(raw?.clientId || "").trim(),
    legacyClientDocId: String(raw?.legacyClientDocId || "").trim() || undefined,
    phoneSnapshot: String(raw?.phoneSnapshot || "").trim() || undefined,
    packageCatalogId: String(raw?.packageCatalogId || raw?.packageId || "").trim(),
    packageNameSnapshot,
    packageDescriptionSnapshot:
      String(raw?.packageDescriptionSnapshot || "").trim() || undefined,
    allowedServiceIdsSnapshot,
    totalSessions,
    remainingSessions,
    reservedSessions,
    usedSessions,
    purchasePrice,
    purchasedAt: raw?.purchasedAt || raw?.createdAt,
    expiresAt: raw?.expiresAt,
    status,
    invoiceId: String(raw?.invoiceId || "").trim(),
    invoiceDocumentId: String(raw?.invoiceDocumentId || "").trim() || undefined,
    invoiceNumber: String(raw?.invoiceNumber || "").trim() || undefined,
    catalogSnapshot: raw?.catalogSnapshot || {
      name: packageNameSnapshot,
      sessionsCount: totalSessions,
      price: purchasePrice,
      allowedServiceIds: allowedServiceIdsSnapshot,
    },
    createdAt: raw?.createdAt,
    updatedAt: raw?.updatedAt,
  };
}

export const ClientPackageService = {
  async getAll(): Promise<ClientPackage[]> {
    const snap = await getDocs(collection(db, ...PACKAGES_PATH));
    return snap.docs
      .map((doc) => normalizeClientPackage(doc.id, doc.data()))
      .sort((a, b) => timestampMillis(b.purchasedAt) - timestampMillis(a.purchasedAt));
  },

  async getByClient(clientIdRaw: string): Promise<ClientPackage[]> {
    const clientId = String(clientIdRaw || "").trim();
    if (!clientId) return [];
    const snap = await getDocs(
      query(collection(db, ...PACKAGES_PATH), where("clientId", "==", clientId))
    );
    return snap.docs
      .map((doc) => normalizeClientPackage(doc.id, doc.data()))
      .sort((a, b) => timestampMillis(b.purchasedAt) - timestampMillis(a.purchasedAt));
  },

  async getTransactions(clientPackageIdRaw: string): Promise<ClientPackageTransaction[]> {
    const clientPackageId = String(clientPackageIdRaw || "").trim();
    if (!clientPackageId) return [];
    const snap = await getDocs(
      query(
        collection(db, ...TRANSACTIONS_PATH),
        where("clientPackageId", "==", clientPackageId)
      )
    );
    return snap.docs
      .map((doc) => ({
        id: doc.id,
        ...(doc.data() as Omit<ClientPackageTransaction, "id">),
      }))
      .sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt));
  },
};
