export type ExportV2FinancialStatusKey =
  | "refunded"
  | "cancelled"
  | "paid"
  | "partial"
  | "unpaid"
  | "unknown";

export type ExportV2FinancialStatus = {
  key: ExportV2FinancialStatusKey;
  label: string;
};

const EMPTY_LABELS = new Set([
  "",
  "-",
  "—",
  "غير محدد",
  "غير محددة",
  "unknown",
  "n/a",
  "null",
  "undefined",
]);

function normalizedText(value: unknown): string {
  return String(value ?? "").trim();
}

export function exportV2IsMeaningfulText(value: unknown): boolean {
  return !EMPTY_LABELS.has(normalizedText(value).toLowerCase());
}

export function exportV2ResolveEmployeeName(
  candidates: unknown | unknown[],
  fallback = "غير محددة"
): string {
  const values = Array.isArray(candidates) ? candidates : [candidates];
  for (const value of values) {
    const text = normalizedText(value);
    if (exportV2IsMeaningfulText(text)) return text;
  }
  return fallback;
}

function money(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

export function exportV2ResolveFinancialStatus(args: {
  totalAmount?: unknown;
  paidAmount?: unknown;
  remainingAmount?: unknown;
  isRefund?: boolean;
  rawStatus?: unknown;
}): ExportV2FinancialStatus {
  const totalAmount = money(args.totalAmount);
  const paidAmount = money(args.paidAmount);
  const remainingAmount = Math.max(
    0,
    money(
      args.remainingAmount ??
        Math.max(0, Math.abs(totalAmount) - Math.max(0, paidAmount))
    )
  );
  const rawStatus = normalizedText(args.rawStatus).toLowerCase();

  if (
    args.isRefund ||
    paidAmount < 0 ||
    rawStatus.includes("استرجاع") ||
    rawStatus.includes("مسترجع") ||
    rawStatus.includes("refund")
  ) {
    return { key: "refunded", label: "مسترجع" };
  }

  if (
    rawStatus.includes("ملغي") ||
    rawStatus.includes("cancel") ||
    rawStatus.includes("void")
  ) {
    return { key: "cancelled", label: "ملغي" };
  }

  const comparableTotal = Math.max(0, totalAmount);
  const comparablePaid = Math.max(0, paidAmount);
  const epsilon = 0.009;

  if (
    comparablePaid > 0 &&
    (remainingAmount <= epsilon ||
      (comparableTotal > 0 && comparablePaid + epsilon >= comparableTotal))
  ) {
    return { key: "paid", label: "مدفوع بالكامل" };
  }

  if (comparablePaid > 0 && remainingAmount > epsilon) {
    return { key: "partial", label: "مدفوع جزئيًا" };
  }

  if (comparableTotal > 0 && comparablePaid <= epsilon) {
    return { key: "unpaid", label: "غير مدفوع" };
  }

  return { key: "unknown", label: "غير محدد" };
}
