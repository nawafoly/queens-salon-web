// IMPORTANT:
// Session packages use Cloudflare D1 as the only operational database.
// Do not reintroduce Firestore reads or writes into package wallet,
// purchase, redeem, reserve, release, or admin package reports.
// Firebase is used only for authentication token verification.
// Any Firestore migration code must remain isolated in one-time migration scripts.

import { auth } from "./firebase";

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

export type PackageClientWalletResult = {
  ok: boolean;
  clientId: string;
  canonicalClientId: string;
  legacyClientDocId?: string;
  aliasClientIds?: string[];
  packages: any[];
  transactions: any[];
  services: Record<string, string>;
  activePackages: any[];
  activePackageCount?: number;
  totalRemainingSessions: number;
  totalUsedSessions: number;
  totalReservedSessions: number;
  nearestExpiryAt?: string | null;
  warnings?: Array<{ packageId?: string; reason?: string }>;
};

function operationId(prefix: string) {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`.replace(/[^A-Za-z0-9_-]/g, "_");
}

const DEFAULT_PACKAGES_WORKER_URL = "https://queens-salon-packages-api.maedin.workers.dev";

function packageWorkerBaseUrl() {
  const env = (import.meta as any).env || {};
  return String(env.VITE_PACKAGES_WORKER_URL || DEFAULT_PACKAGES_WORKER_URL).replace(/\/+$/, "");
}

function isDevRuntime() {
  return Boolean((import.meta as any).env?.DEV);
}

function errorDebugSuffix(error: any) {
  const code = String(error?.code || error?.error || "").trim();
  const status = Number(error?.status || 0);
  const message = String(error?.message || "").trim();
  const parts = [
    code ? `code=${code}` : "",
    status ? `status=${status}` : "",
    message ? `message=${message}` : "",
  ].filter(Boolean);
  return parts.length ? ` [${parts.join(" ")}]` : "";
}

function callableErrorAr(error: any) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  const status = Number(error?.status || 0);
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

async function invoke<T>(path: string, payload: Record<string, unknown> = {}, method: "GET" | "POST" = "POST"): Promise<T> {
  try {
    const baseUrl = packageWorkerBaseUrl();
    if (!baseUrl) throw Object.assign(new Error("packages_worker:not_configured"), { code: "failed-precondition" });
    const user = auth.currentUser;
    if (!user) throw Object.assign(new Error("Authentication is required"), { code: "unauthenticated" });
    const requestOnce = async (forceRefresh = false) => {
      const token = await user.getIdToken(forceRefresh);
      const url = new URL(`${baseUrl}${path}`);
      if (method === "GET") {
        Object.entries(payload).forEach(([key, value]) => {
          if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
        });
      }
      const response = await fetch(url.toString(), {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
        },
        ...(method === "POST" ? { body: JSON.stringify(payload) } : {}),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.ok === false) {
        const err: any = new Error(body?.message || body?.error || `HTTP ${response.status}`);
        err.code = body?.error || `http-${response.status}`;
        err.status = response.status;
        throw err;
      }
      return (body?.data ?? body) as T;
    };
    try {
      return await requestOnce(false);
    } catch (error: any) {
      if (Number(error?.status || 0) === 401) return await requestOnce(true);
      throw error;
    }
  } catch (error: any) {
    const normalized = new Error(`${callableErrorAr(error)}${isDevRuntime() ? errorDebugSuffix(error) : ""}`);
    (normalized as any).code = error?.code || error?.error;
    (normalized as any).status = error?.status;
    throw normalized;
  }
}

export const PackageOperationsService = {
  newOperationId: operationId,
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
      salonId: "main", bookingId, reason, operationId: operationId("package_restore"),
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
