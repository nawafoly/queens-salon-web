import type { CartItem } from "../types/bookingShared";

export type PackageWalletLike = {
  id?: string;
  packageNameSnapshot?: string;
  allowedServiceIdsSnapshot?: string[];
  remainingSessions?: number;
  reservedSessions?: number;
  status?: string;
  expiresAt?: unknown;
};

export type PackageCartEligibility = {
  cartItemId: string;
  serviceId: string;
  isPackageEligible: boolean;
  eligiblePackageId: string;
  eligiblePackages: PackageWalletLike[];
  remainingSessions: number;
  canRedeem: boolean;
  paymentMode: "package" | "cash/card";
};

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function millis(value: unknown) {
  if (typeof (value as any)?.toMillis === "function") return (value as any).toMillis();
  if (typeof (value as any)?.seconds === "number") return (value as any).seconds * 1000;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return Number(value || 0);
}

function packageSortValue(pkg: PackageWalletLike) {
  const expiresAt = millis(pkg.expiresAt);
  return expiresAt || Number.MAX_SAFE_INTEGER;
}

function activePackageSupportsService(pkg: PackageWalletLike, serviceId: string, nowMs: number) {
  if (cleanText(pkg.status) !== "active") return false;
  if (Number(pkg.remainingSessions || 0) <= 0) return false;
  const expiresAt = millis(pkg.expiresAt);
  if (expiresAt && expiresAt < nowMs) return false;
  const allowed = Array.isArray(pkg.allowedServiceIdsSnapshot) ? pkg.allowedServiceIdsSnapshot : [];
  return allowed.map(cleanText).includes(serviceId);
}

export function buildPackageCartEligibility(args: {
  items: Array<Partial<Pick<CartItem, "id" | "serviceId">>>;
  packages: PackageWalletLike[];
  selectedPackageByItemId?: Record<string, string>;
  nowMs?: number;
}): PackageCartEligibility[] {
  const nowMs = Number(args.nowMs || Date.now());
  const selected = args.selectedPackageByItemId || {};
  const reservedInDraft = new Map<string, number>();

  return (args.items || []).map((item, index) => {
    const serviceId = cleanText(item.serviceId);
    const cartItemId = cleanText(item.id) || `draft_${index}_${serviceId || "service"}`;
    const eligiblePackages = (args.packages || [])
      .filter((pkg) => serviceId && activePackageSupportsService(pkg, serviceId, nowMs))
      .sort((a, b) => {
        const expiry = packageSortValue(a) - packageSortValue(b);
        if (expiry) return expiry;
        return cleanText(a.id).localeCompare(cleanText(b.id));
      });

    const requestedPackageId = cleanText(selected[cartItemId]);
    const selectedPackage = eligiblePackages.find((pkg) => cleanText(pkg.id) === requestedPackageId) || eligiblePackages[0];
    const eligiblePackageId = cleanText(selectedPackage?.id);
    const alreadyReserved = eligiblePackageId ? Number(reservedInDraft.get(eligiblePackageId) || 0) : 0;
    const packageRemaining = Math.max(0, Number(selectedPackage?.remainingSessions || 0));
    const remainingSessions = Math.max(0, packageRemaining - alreadyReserved);
    const canRedeem = Boolean(eligiblePackageId && remainingSessions > 0);

    if (canRedeem) {
      reservedInDraft.set(eligiblePackageId, alreadyReserved + 1);
    }

    return {
      cartItemId,
      serviceId,
      isPackageEligible: eligiblePackages.length > 0,
      eligiblePackageId,
      eligiblePackages,
      remainingSessions,
      canRedeem,
      paymentMode: canRedeem ? "package" : "cash/card",
    };
  });
}
