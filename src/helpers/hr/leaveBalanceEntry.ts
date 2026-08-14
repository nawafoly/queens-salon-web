function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeArabicText(value: unknown): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, "");
}

function finiteNumber(
  value: unknown
): number | null {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : null;
}

export function normalizeLeaveEntryType(
  value: unknown
): string {
  const normalized =
    normalizeArabicText(value);

  if (!normalized) return "";

  if (
    normalized === "add" ||
    normalized === "addition" ||
    normalized === "credit" ||
    normalized === "increase" ||
    normalized === "اضافه" ||
    normalized === "اضافة"
  ) {
    return "add";
  }

  if (
    normalized === "deduct" ||
    normalized === "deduction" ||
    normalized === "debit" ||
    normalized === "decrease" ||
    normalized === "leave" ||
    normalized === "خصم" ||
    normalized === "اجازه" ||
    normalized === "اجازة"
  ) {
    return "deduct";
  }

  return "";
}

export function getLeaveEntryActionType(
  entry: any
): string {
  return normalizeLeaveEntryType(
    entry?.actionType ??
      entry?.action_type ??
      entry?.type ??
      entry?.leaveType ??
      entry?.leave_type ??
      entry?.requestType ??
      entry?.request_type ??
      entry?.kind
  );
}

export function getLeaveEntryChangeAmount(
  entry: any
): number {
  const explicit =
    finiteNumber(
      entry?.changeAmount ??
        entry?.change_amount
    );

  if (
    explicit != null &&
    explicit !== 0
  ) {
    // Canonical ledger supports 0.5-day increments.
    // Never Math.trunc() this value.
    return explicit;
  }

  const days =
    finiteNumber(entry?.days);

  if (
    days == null ||
    days <= 0
  ) {
    return 0;
  }

  const actionType =
    getLeaveEntryActionType(entry);

  if (!actionType) return 0;

  return actionType === "add"
    ? days
    : -days;
}

export function getLeaveEntryBalanceBefore(
  entry: any
): number | null {
  return finiteNumber(
    entry?.balanceBefore ??
      entry?.balance_before
  );
}

export function getLeaveEntryBalanceAfter(
  entry: any
): number | null {
  return finiteNumber(
    entry?.balanceAfter ??
      entry?.balance_after
  );
}

export function getLeaveEntryCreatedAt(
  entry: any
): string {
  return cleanText(
    entry?.createdAt ??
      entry?.created_at ??
      entry?.createdAtIso
  );
}

export function getLeaveEntryCreatedBy(
  entry: any
): string {
  return cleanText(
    entry?.createdBy ??
      entry?.created_by ??
      entry?.byName ??
      entry?.createdByName
  );
}

export function isDeletedLeaveEntry(
  entry: any
): boolean {
  return (
    entry?.deleted === true ||
    entry?.isDeleted === true ||
    entry?.is_deleted === true
  );
}