function normalizeArabicText(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, "");
}

export function normalizeLeaveEntryType(value: unknown): string {
  const normalized = normalizeArabicText(value);
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
    normalized === "leave" ||
    normalized === "خصم" ||
    normalized === "اجازه" ||
    normalized === "اجازة"
  ) {
    return "deduct";
  }
  return "";
}

export function getLeaveEntryActionType(entry: any): string {
  return normalizeLeaveEntryType(entry?.actionType || entry?.type || entry?.leaveType || entry?.leave_type || entry?.requestType || entry?.kind);
}

export function getLeaveEntryChangeAmount(entry: any): number {
  const snapshotValue = Number(entry?.changeAmount || 0);
  if (Number.isFinite(snapshotValue) && snapshotValue !== 0) return Math.trunc(snapshotValue);

  const actionType = getLeaveEntryActionType(entry);
  const days = Number.isFinite(Number(entry?.days)) ? Math.trunc(Number(entry.days)) : 0;
  if (!actionType || days <= 0) return 0;
  return actionType === "add" ? days : -days;
}

export default {
  normalizeLeaveEntryType,
  getLeaveEntryActionType,
  getLeaveEntryChangeAmount,
};
