import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";

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
  packageTransactionId: string;
};

function operationId(prefix: string) {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${random}`.replace(/[^A-Za-z0-9_-]/g, "_");
}

function callableErrorAr(error: any) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
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

async function invoke<T>(name: string, payload: Record<string, unknown>): Promise<T> {
  try {
    const result = await httpsCallable<Record<string, unknown>, T>(functions, name)(payload);
    return result.data;
  } catch (error) {
    throw new Error(callableErrorAr(error));
  }
}

export const PackageOperationsService = {
  newOperationId: operationId,
  myWallet() {
    return invoke<{
      ok: boolean;
      clientId: string;
      packages: any[];
      transactions: any[];
      services: Record<string, string>;
    }>("getMyPackageWallet", { salonId: "main" });
  },
  purchase(args: {
    clientId: string;
    packageCatalogId: string;
    paymentMethod: "cash" | "card" | "transfer";
    invoiceId?: string;
  }) {
    return invoke<PackagePurchaseResult>("purchaseClientPackage", {
      salonId: "main",
      ...args,
      invoiceId: args.invoiceId || operationId("package_sale"),
    });
  },
  redeem(args: {
    clientId: string;
    clientPackageId?: string;
    serviceId: string;
    employeeId: string;
    date: string;
    time: string;
    operationId?: string;
  }) {
    return invoke<PackageRedemptionResult>("createPackageRedemptionBooking", {
      salonId: "main",
      ...args,
      operationId: args.operationId || operationId("package_booking"),
    });
  },
  adjust(clientPackageId: string, sessionsDelta: number, reason: string) {
    return invoke("adjustClientPackageBalance", {
      salonId: "main", clientPackageId, sessionsDelta, reason,
      operationId: operationId("package_adjust"),
    });
  },
  cancel(clientPackageId: string, reason: string) {
    return invoke("cancelClientPackage", { salonId: "main", clientPackageId, reason });
  },
  restoreConsumed(bookingId: string, reason: string) {
    return invoke("adminRestoreConsumedPackageSession", {
      salonId: "main", bookingId, reason, operationId: operationId("package_restore"),
    });
  },
  consumeReserved(bookingId: string) {
    return invoke("consumeReservedPackageSession", { salonId: "main", bookingId });
  },
  restoreReserved(bookingId: string, reason: string) {
    return invoke("restoreReservedPackageSession", { salonId: "main", bookingId, reason });
  },
  cancelRedemptionBooking(bookingId: string, reason: string) {
    return invoke("cancelPackageRedemptionBooking", { salonId: "main", bookingId, reason });
  },
};
