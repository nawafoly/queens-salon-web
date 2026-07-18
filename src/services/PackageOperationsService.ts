// IMPORTANT:
// Session packages use Cloudflare D1 as the only operational database.
// Do not reintroduce Firestore reads or writes into package wallet,
// purchase, redeem, reserve, release, or admin package reports.
// Firebase is used only for authentication token verification.
// Any Firestore migration code must remain isolated in one-time migration scripts.

import { auth } from "./firebase";
import { requireCoreWorkerUrl } from "../config/dataSourceFlags";

export type PackagePurchaseResult = {
  ok: boolean;
  idempotent?: boolean;
  clientPackageId: string;
  invoiceId: string;
  invoiceDocumentId: string;
  invoiceNumber: string;
  clientId: string;
};

export type PackageRedemptionResult = {
  ok: boolean;
  idempotent?: boolean;
  bookingId: string;
  publicId: string;
  clientPackageId: string;
  packageDocumentId?: string;
  packageTransactionId: string;
  canonicalClientId?: string;
  beforeRemaining?: number;
  afterRemaining?: number;
  redeemedServiceId?: string;
  cartItemId?: string;
};


export type PackageSessionDashboardPackage = {
  id: string;
  clientName: string;
  phone: string;
  canonicalClientId: string;
  packageCatalogId: string;
  packageName: string;
  totalSessions: number;
  remainingSessions: number;
  usedSessions: number;
  reservedSessions: number;
  status: "active" | "exhausted" | "expired" | "cancelled" | string;
  purchasedAt: string;
  expiresAt: string;
  invoiceId: string;
  updatedAt: string;
};

export type PackageSessionDashboardTransaction = {
  id: string;
  clientPackageId: string;
  canonicalClientId: string;
  clientName: string;
  phone: string;
  packageName: string;
  type: string;
  sessionsDelta: number;
  remainingBefore: number;
  remainingAfter: number;
  reservedBefore: number;
  reservedAfter: number;
  usedBefore: number;
  usedAfter: number;
  serviceId: string;
  bookingId: string;
  cartItemId: string;
  invoiceId: string;
  reason?: string;
  createdByUid?: string;
  createdAt: string;
};

export type PackageSessionDashboardResult = {
  summary: {
    subscribedClients: number;
    totalPackages: number;
    activePackages: number;
    totalRemainingSessions: number;
    totalUsedSessions: number;
    totalReservedSessions: number;
    expiringSoonCount: number;
    exhaustedPackages: number;
    expiredPackages: number;
  };
  packages: PackageSessionDashboardPackage[];
  transactions: PackageSessionDashboardTransaction[];
};

export type PackageClientLookup = {
  id?: string;
  docId?: string;
  uid?: string;
  clientId?: string;
  customerId?: string;
  authUid?: string;
  userId?: string;
  firebaseUid?: string;
  phone?: string;
  mobile?: string;
  clientPhone?: string;
  phoneNumber?: string;
};

export type PackageCatalogRecord = {
  id: string;
  name: string;
  description?: string;
  serviceIds: string[];
  allowedServiceIds: string[];
  sessionsCount: number;
  price: number;
  validityDays?: number;
  active: boolean;
  saleEnabled: boolean;
  imageUrl?: string;
  terms?: string;
  startsAt?: string;
  endsAt?: string;
  audienceScope?: string;
  targetClientIds?: string[];
  sortOrder?: number;
  createdAt?: string;
  updatedAt?: string;
};

export type PackageWalletTimestamp = {
  seconds?: number;
  _seconds?: number;
};

export type PackageWalletItem = {
  id?: string;
  packageNameSnapshot?: string;
  allowedServiceIdsSnapshot?: string[];
  totalSessions?: number;
  remainingSessions?: number;
  reservedSessions?: number;
  usedSessions?: number;
  purchasedAt?: string;
  expiresAt?: string | PackageWalletTimestamp;
  status?: string;
  invoiceId?: string;
  clientId?: string;
  canonicalClientId?: string;
  packageCatalogId?: string;
  [key: string]: unknown;
};

export type PackageWalletTransaction = {
  id?: string;
  clientPackageId?: string;
  type?: string;
  bookingId?: string;
  sessionsDelta?: number;
  createdAt?: string;
  [key: string]: unknown;
};

export type PackageClientWalletResult = {
  ok: boolean;
  clientId: string;
  canonicalClientId: string;
  legacyClientDocId?: string;
  aliasClientIds?: string[];
  packages: PackageWalletItem[];
  transactions: PackageWalletTransaction[];
  services: Record<string, string>;
  activePackages: PackageWalletItem[];
  activePackageCount?: number;
  totalRemainingSessions: number;
  totalUsedSessions: number;
  totalReservedSessions: number;
  nearestExpiryAt?: string | null;
  warnings?: Array<{ packageId?: string; reason?: string }>;
};


type ApiErrorLike = {
  code?: unknown;
  error?: unknown;
  status?: unknown;
  message?: unknown;
};

type ApiEnvelope<T> = {
  ok?: boolean;
  data?: T;
  error?: string;
  message?: string;
};

function asApiError(error: unknown): ApiErrorLike {
  if (typeof error === "object" && error !== null) return error as ApiErrorLike;
  return { message: String(error ?? "") };
}

function operationId(prefix: string) {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`.replace(/[^A-Za-z0-9_-]/g, "_");
}

function normalizePackagesWorkerBaseUrl(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    const packagePathIndex = Math.max(
      url.pathname.indexOf("/api/core/packages"),
      url.pathname.indexOf("/api/packages")
    );
    if (packagePathIndex >= 0) url.pathname = url.pathname.slice(0, packagePathIndex) || "/";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return raw
      .replace(/\/api\/core\/packages(?:\/.*)?$/i, "")
      .replace(/\/api\/packages(?:\/.*)?$/i, "")
      .replace(/\/+$/, "");
  }
}

function packageWorkerBaseUrl() {
  return normalizePackagesWorkerBaseUrl(requireCoreWorkerUrl());
}

function isDevRuntime() {
  return Boolean((import.meta as ImportMeta & { env?: Record<string, unknown> }).env?.DEV);
}

function errorDebugSuffix(error: unknown) {
  const details = asApiError(error);
  const code = String(details.code || details.error || "").trim();
  const status = Number(details.status || 0);
  const message = String(details.message || "").trim();
  const parts = [
    code ? `code=${code}` : "",
    status ? `status=${status}` : "",
    message ? `message=${message}` : "",
  ].filter(Boolean);
  return parts.length ? ` [${parts.join(" ")}]` : "";
}

function callableErrorAr(error: unknown) {
  const details = asApiError(error);
  const code = String(details.code || "");
  const message = String(details.message || "");
  const status = Number(details.status || 0);
  if (code.includes("package_has_reserved_sessions")) {
    return "لا يمكن حذف الباقة لأنها تحتوي على جلسات محجوزة. ألغِ الحجز أو أعِد الجلسة أولًا.";
  }
  if (code.includes("client_package_not_found")) {
    return "الباقة غير موجودة أو تم حذفها مسبقًا. حدّثي البيانات.";
  }
  if (code.includes("client_package_delete_failed")) {
    return "تعذر حذف الباقة من قاعدة البيانات. حدّثي الصفحة ثم حاولي مرة أخرى.";
  }
  if (code.includes("invalid_document_id")) {
    return "معرّف الباقة غير صالح. حدّثي البيانات ثم حاولي مجددًا.";
  }
  if (code.includes("packages_client:not_found")) {
    return "تعذر ربط حساب العميلة بمحفظة الباقات. سجّلي الخروج ثم الدخول وحاولي مجددًا.";
  }
  if (code.includes("packages_api:not_found")) {
    return "واجهة الباقات داخل Core Worker غير محدثة. يجب نشر Core Worker ثم المحاولة مجددًا.";
  }
  if (status === 404) {
    return "تعذر العثور على سجل الباقة أو العميلة المطلوب.";
  }
  if (status === 401) return "يجب تسجيل الدخول مرة أخرى.";
  if (status === 403) return "ليست لديك صلاحية لتنفيذ هذه العملية.";
  if (status === 409) {
    if (message.includes("slot")) return "الموعد محجوز بالفعل. اختاري وقتًا آخر.";
    if (message.includes("included")) return "الخدمة غير مشمولة في الباقة.";
    if (message.includes("balance") || message.includes("exhaust")) return "لا يوجد رصيد باقة صالح لهذه الخدمة.";
    return "تعذر تنفيذ العملية بسبب تعارض في البيانات. حدّثي الصفحة وحاولي مجددًا.";
  }
  if (status === 422 || status === 400) return "بعض البيانات غير صحيحة. تحققي من الحقول وحاولي مجددًا.";
  if (status >= 500) return "الخدمة غير متاحة مؤقتًا. حاولي مجددًا بعد قليل.";
  if (code.includes("unauthenticated")) return "يجب تسجيل الدخول أولًا.";
  if (code.includes("permission-denied")) return "ليست لديك صلاحية لتنفيذ هذه العملية.";
  if (code.includes("not-found")) return "تعذر العثور على العميلة أو الباقة أو الخدمة.";
  if (code.includes("already-exists")) return message.includes("slot")
    ? "الموعد محجوز بالفعل. اختاري وقتًا آخر."
    : "تم تنفيذ هذه العملية مسبقًا أو أن الموعد محجوز.";
  if (message.includes("expiry")) return "موعد الحجز بعد انتهاء صلاحية الباقة.";
  if (message.includes("included")) return "الخدمة غير مشمولة في الباقة.";
  if (message.includes("eligible") || message.includes("balance") || message.includes("exhaust")) {
    return "لا يوجد رصيد باقة صالح لهذه الخدمة.";
  }
  if (message.includes("Employee")) return "الموظفة غير متاحة لهذه الخدمة أو في هذا الموعد.";
  return "تعذر تنفيذ العملية. تحققي من البيانات وحاولي مجددًا.";
}

async function invoke<T>(path: string, payload: Record<string, unknown> = {}, method: "GET" | "POST" | "PATCH" | "DELETE" = "POST"): Promise<T> {
  try {
    const baseUrl = packageWorkerBaseUrl();
    if (!baseUrl) throw Object.assign(new Error("packages_worker:not_configured"), { code: "failed-precondition" });
    const user = auth.currentUser;
    if (!user) throw Object.assign(new Error("Authentication is required"), { code: "unauthenticated" });
    const requestOnce = async (forceRefresh = false) => {
      const token = await user.getIdToken(forceRefresh);
      const unifiedPath = path.startsWith("/api/packages")
        ? path.replace(/^\/api\/packages/, "/api/core/packages")
        : path;
      const url = new URL(`${baseUrl}${unifiedPath}`);
      if (method === "GET" || method === "DELETE") {
        Object.entries(payload).forEach(([key, value]) => {
          if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
        });
      }
      const response = await fetch(url.toString(), {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(["POST", "PATCH"].includes(method) ? { "Content-Type": "application/json" } : {}),
        },
        ...(["POST", "PATCH"].includes(method) ? { body: JSON.stringify(payload) } : {}),
      });
      const body = await response.json().catch(() => ({})) as ApiEnvelope<T>;
      if (!response.ok || body.ok === false) {
        throw Object.assign(
          new Error(body.message || body.error || `HTTP ${response.status}`),
          {
            code: body.error || `http-${response.status}`,
            status: response.status,
          }
        );
      }
      return (body.data ?? body) as T;
    };
    try {
      return await requestOnce(false);
    } catch (error: unknown) {
      const details = asApiError(error);
      if (Number(details.status || 0) === 401) return await requestOnce(true);
      throw error;
    }
  } catch (error: unknown) {
    const details = asApiError(error);
    throw Object.assign(
      new Error(`${callableErrorAr(error)}${isDevRuntime() ? errorDebugSuffix(error) : ""}`),
      {
        code: details.code || details.error,
        status: details.status,
      }
    );
  }
}

export const PackageOperationsService = {
  newOperationId: operationId,
  listCatalog(includeInactive = false) {
    return invoke<PackageCatalogRecord[]>(
      includeInactive ? "/api/packages/admin/catalog" : "/api/packages/catalog",
      { salonId: "main", ...(includeInactive ? { includeInactive: true } : {}) },
      "GET"
    );
  },
  myCatalog() {
    return invoke<PackageCatalogRecord[]>("/api/packages/my-catalog", { salonId: "main" }, "GET");
  },
  createCatalog(item: Omit<PackageCatalogRecord, "id"> & { id?: string }) {
    return invoke<PackageCatalogRecord>("/api/packages/admin/catalog", { salonId: "main", ...item }, "POST");
  },
  updateCatalog(id: string, patch: Partial<PackageCatalogRecord>) {
    return invoke<PackageCatalogRecord>("/api/packages/admin/catalog", { salonId: "main", id, ...patch }, "PATCH");
  },
  deleteCatalog(id: string) {
    return invoke<{ id: string; deleted: boolean; archived?: boolean }>("/api/packages/admin/catalog", { salonId: "main", id }, "DELETE");
  },
  sessionDashboard() {
    return invoke<PackageSessionDashboardResult>("/api/packages/admin/session-dashboard", { salonId: "main" }, "GET");
  },
  updateClientPackage(args: { clientPackageId: string; packageName: string; remainingSessions: number; expiresAt?: string; status?: string }) {
    return invoke<{ id: string; updated: boolean }>("/api/packages/admin/client-package", { salonId: "main", ...args }, "PATCH");
  },
  async deleteClientPackage(clientPackageId: string) {
    const payload = { salonId: "main", clientPackageId };
    try {
      // The DELETE endpoint existed before the POST compatibility alias and is
      // therefore the safest first choice for already-deployed workers.
      return await invoke<{ id: string; deleted: boolean }>(
        "/api/packages/admin/client-package",
        payload,
        "DELETE"
      );
    } catch (error: unknown) {
      const details = asApiError(error);
      const status = Number(details.status || 0);
      const code = String(details.code || "");
      if (status !== 404 && status !== 405 && !code.includes("packages_api:not_found")) throw error;
      return invoke<{ id: string; deleted: boolean }>(
        "/api/packages/admin/delete-client-package",
        payload,
        "POST"
      );
    }
  },
  myWallet() {
    return invoke<PackageClientWalletResult>("/api/packages/my-wallet", { salonId: "main" }, "GET");
  },
  clientWallet(args: { clientId?: string; clientLookup?: PackageClientLookup }) {
    return invoke<PackageClientWalletResult>("/api/packages/client-wallet", {
      salonId: "main",
      ...args,
    });
  },
  purchase(args: {
    clientId: string;
    clientLookup?: PackageClientLookup;
    packageCatalogId: string;
    paymentMethod: "cash" | "card" | "transfer";
    invoiceId?: string;
  }) {
    return invoke<PackagePurchaseResult>("/api/packages/purchase", {
      salonId: "main",
      ...args,
      invoiceId: args.invoiceId || operationId("package_sale"),
    });
  },
  reserve(args: {
    clientId: string;
    clientLookup?: PackageClientLookup;
    clientPackageId?: string;
    serviceId: string;
    employeeId: string;
    date: string;
    time: string;
    bookingId: string;
    cartItemId: string;
    operationId?: string;
  }) {
    return invoke<PackageRedemptionResult>("/api/packages/reserve", {
      salonId: "main",
      ...args,
      operationId:
        args.operationId ||
        `reserve_${args.bookingId}_${args.cartItemId}`,
    });
  },
  release(args: {
    bookingId: string;
    clientPackageId?: string;
    cartItemId?: string;
    reason?: string;
    operationId?: string;
  }) {
    return invoke("/api/packages/release", {
      salonId: "main",
      ...args,
      operationId:
        args.operationId ||
        `release_${args.bookingId}_${args.cartItemId || "item"}`,
    });
  },
  redeem(args: {
    clientId: string;
    clientLookup?: PackageClientLookup;
    clientPackageId?: string;
    serviceId: string;
    employeeId: string;
    date: string;
    time: string;
    operationId?: string;
    cartItemId?: string;
  }) {
    return invoke<PackageRedemptionResult>("/api/packages/redeem", {
      salonId: "main",
      ...args,
      operationId: args.operationId || operationId("package_booking"),
    });
  },
  adjust(clientPackageId: string, sessionsDelta: number, reason: string) {
    return invoke("/api/packages/adjust", {
      salonId: "main", clientPackageId, sessionsDelta, reason,
      operationId: operationId("package_adjust"),
    });
  },
  cancel(clientPackageId: string, reason: string) {
    return invoke("/api/packages/cancel", { salonId: "main", clientPackageId, reason });
  },
  restoreConsumed(bookingId: string, reason: string) {
    return invoke("/api/packages/redemption/restore", {
      salonId: "main", bookingId, reason,
    });
  },
  reapplyBookingSession(bookingId: string, targetState: "reserved" | "used", reason: string) {
    return invoke("/api/packages/redemption/reapply", {
      salonId: "main", bookingId, targetState, reason,
    });
  },
  consumeReserved(bookingId: string) {
    return invoke("/api/packages/redemption/consume", { salonId: "main", bookingId });
  },
  restoreReserved(bookingId: string, reason: string) {
    return invoke("/api/packages/redemption/restore", { salonId: "main", bookingId, reason });
  },
  cancelRedemptionBooking(bookingId: string, reason: string) {
    return invoke("/api/packages/redemption/cancel", { salonId: "main", bookingId, reason });
  },
};
