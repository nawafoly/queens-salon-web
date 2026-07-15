export type PackageWalletStatus = "idle" | "loading" | "success" | "error";

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

export function packageWalletDisplayState(args: {
  status: PackageWalletStatus;
  activePackages?: number;
  totalRemainingSessions?: number;
}) {
  if (args.status === "error") {
    return {
      state: "error" as const,
      message: "تعذر تحميل رصيد الباقات",
      showZeroFallback: false,
      activePackages: undefined,
      totalRemainingSessions: undefined,
    };
  }
  if (args.status === "loading") {
    return {
      state: "loading" as const,
      message: "",
      showZeroFallback: false,
      activePackages: undefined,
      totalRemainingSessions: undefined,
    };
  }
  return {
    state: args.status === "success" ? "ready" as const : "idle" as const,
    message: "",
    showZeroFallback: true,
    activePackages: Number(args.activePackages || 0),
    totalRemainingSessions: Number(args.totalRemainingSessions || 0),
  };
}

export function shouldDiscardCachedWallet(args: {
  cachedLocalClientId?: unknown;
  cachedCanonicalClientId?: unknown;
  nextLocalClientId?: unknown;
  nextCanonicalClientId?: unknown;
}) {
  const cachedLocalClientId = cleanText(args.cachedLocalClientId);
  const cachedCanonicalClientId = cleanText(args.cachedCanonicalClientId);
  const nextLocalClientId = cleanText(args.nextLocalClientId);
  const nextCanonicalClientId = cleanText(args.nextCanonicalClientId);

  if (cachedCanonicalClientId && nextCanonicalClientId && cachedCanonicalClientId !== nextCanonicalClientId) return true;
  if (cachedLocalClientId && nextLocalClientId && cachedLocalClientId !== nextLocalClientId) return true;
  if (cachedLocalClientId && nextCanonicalClientId && cachedLocalClientId !== nextCanonicalClientId) return true;
  return false;
}

export function originUsesSamePackagesWorker(args: {
  origin: unknown;
  allowedOrigins: unknown[];
}) {
  const origin = cleanText(args.origin).replace(/\/+$/, "");
  const allowedOrigins = new Set((args.allowedOrigins || []).map((item) => cleanText(item).replace(/\/+$/, "")));
  return Boolean(origin && allowedOrigins.has(origin));
}
