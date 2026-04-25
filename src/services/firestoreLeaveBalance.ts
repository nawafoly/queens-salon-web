import { doc, runTransaction, serverTimestamp } from "firebase/firestore";

import { db } from "./firebase";
import type { LeaveEntry, UiRole } from "../pages/dashboardEmployees/shared";

const SALON_ID = "main";

export type LeaveActionType = "add" | "deduct";

export type LeaveBalanceActor = {
  uid: string;
  role?: UiRole | string | null;
  displayName?: string;
  email?: string;
};

export type ApplyStaffLeaveEntryResult = {
  previousBalance: number;
  leaveBalanceDays: number;
  leaveEntries: LeaveEntry[];
  createdEntry: LeaveEntry;
};

export type DeleteStaffLeaveEntryResult = {
  previousBalance: number;
  leaveBalanceDays: number;
  leaveEntries: LeaveEntry[];
  deletedEntry: LeaveEntry;
  reversedChangeAmount: number;
};

function normalizeArabicText(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, "");
}

function normalizeInteger(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function normalizePositiveInteger(value: unknown): number {
  const n = normalizeInteger(value, 0);
  return n > 0 ? n : 0;
}

function normalizeBalance(value: unknown): number {
  return normalizeInteger(value, 0);
}

function actorDisplayName(actor: LeaveBalanceActor): string {
  return String(actor.displayName || actor.email || actor.uid || "").trim();
}

export function canManageLeaveBalanceRole(role: UiRole | string | null | undefined): boolean {
  const normalized = String(role || "")
    .trim()
    .toLowerCase();
  return normalized === "owner" || normalized === "admin" || normalized === "hr";
}

export function normalizeLeaveEntryType(value: unknown): LeaveActionType | "" {
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

export function getLeaveEntryActionType(entry: LeaveEntry | null | undefined): LeaveActionType | "" {
  return normalizeLeaveEntryType(entry?.actionType || entry?.type);
}

export function getLeaveEntryChangeAmount(entry: LeaveEntry | null | undefined): number {
  const snapshotValue = normalizeInteger(entry?.changeAmount, 0);
  if (snapshotValue !== 0) return snapshotValue;

  const actionType = getLeaveEntryActionType(entry);
  const days = normalizePositiveInteger(entry?.days);
  if (!actionType || days <= 0) return 0;
  return actionType === "add" ? days : -days;
}

export function getLeaveEntryBalanceBefore(entry: LeaveEntry | null | undefined): number | null {
  const value = entry?.balanceBefore;
  return Number.isFinite(Number(value)) ? normalizeInteger(value) : null;
}

export function getLeaveEntryBalanceAfter(entry: LeaveEntry | null | undefined): number | null {
  const value = entry?.balanceAfter;
  return Number.isFinite(Number(value)) ? normalizeInteger(value) : null;
}

export function getLeaveEntryCreatedAt(entry: LeaveEntry | null | undefined): string {
  return String(entry?.createdAt || entry?.createdAtIso || "").trim();
}

export function getLeaveEntryCreatedBy(entry: LeaveEntry | null | undefined): string {
  return String(entry?.createdBy || entry?.byName || "").trim();
}

export function isDeletedLeaveEntry(entry: LeaveEntry | null | undefined): boolean {
  return !!entry?.deleted;
}

function assertActorCanManage(actor: LeaveBalanceActor) {
  const actorUid = String(actor?.uid || "").trim();
  if (!actorUid) throw new Error("تعذر تحديد المستخدم المنفذ للعملية.");
  if (!canManageLeaveBalanceRole(actor?.role)) {
    throw new Error("ليست لديك صلاحية لإدارة رصيد الإجازات.");
  }
}

function buildLeaveEntry(args: {
  actionType: LeaveActionType;
  days: number;
  opDate: string;
  note?: string;
  balanceBefore: number;
  actor: LeaveBalanceActor;
}): LeaveEntry {
  const days = normalizePositiveInteger(args.days);
  const balanceBefore = normalizeBalance(args.balanceBefore);
  const changeAmount = args.actionType === "add" ? days : -days;
  const balanceAfter = balanceBefore + changeAmount;
  const createdAt = new Date().toISOString();
  const createdBy = actorDisplayName(args.actor);

  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type: args.actionType,
    actionType: args.actionType,
    days,
    changeAmount,
    balanceBefore,
    balanceAfter,
    date: args.opDate,
    note: String(args.note || "").trim(),
    createdAt,
    createdAtIso: createdAt,
    createdBy,
    createdByUid: String(args.actor.uid || "").trim(),
    byUid: String(args.actor.uid || "").trim(),
    byName: createdBy,
  };
}

export async function applyStaffLeaveEntryWithBalanceAdjustment(args: {
  staffId: string;
  actionType: LeaveActionType;
  days: number;
  opDate: string;
  note?: string;
  actor: LeaveBalanceActor;
  allowNegativeBalance?: boolean;
}): Promise<ApplyStaffLeaveEntryResult> {
  const staffId = String(args.staffId || "").trim();
  if (!staffId) throw new Error("تعذر تحديد الموظفة المطلوبة.");
  assertActorCanManage(args.actor);

  const actionType = normalizeLeaveEntryType(args.actionType);
  if (!actionType) throw new Error("نوع حركة الإجازة غير صحيح.");

  const days = normalizePositiveInteger(args.days);
  if (days <= 0) throw new Error("اكتب عدد أيام صحيح.");

  const opDate = String(args.opDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opDate)) {
    throw new Error("اختر تاريخ العملية.");
  }

  const staffRef = doc(db, "salons", SALON_ID, "staff_public", staffId);

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(staffRef);
    if (!snap.exists()) {
      throw new Error("الموظفة المطلوبة غير موجودة أو تم حذفها.");
    }

    const data = snap.data() as { leaveBalanceDays?: unknown; leaveEntries?: LeaveEntry[] };
    const previousBalance = normalizeBalance(data?.leaveBalanceDays);
    const createdEntry = buildLeaveEntry({
      actionType,
      days,
      opDate,
      note: args.note,
      balanceBefore: previousBalance,
      actor: args.actor,
    });
    const nextBalance = createdEntry.balanceAfter ?? previousBalance;
    if (!args.allowNegativeBalance && nextBalance < 0) {
      throw new Error("لا يمكن خصم أكثر من الرصيد المتبقي.");
    }

    const currentEntries = Array.isArray(data?.leaveEntries) ? data.leaveEntries : [];
    const nextEntries = [createdEntry, ...currentEntries].slice(0, 200);

    tx.update(staffRef, {
      leaveBalanceDays: nextBalance,
      leaveEntries: nextEntries,
      updatedAt: serverTimestamp(),
    });

    return {
      previousBalance,
      leaveBalanceDays: nextBalance,
      leaveEntries: nextEntries,
      createdEntry,
    };
  });
}

export async function deleteStaffLeaveEntryWithBalanceAdjustment(args: {
  staffId: string;
  entryId: string;
  actor: LeaveBalanceActor;
  allowNegativeBalance?: boolean;
}): Promise<DeleteStaffLeaveEntryResult> {
  const staffId = String(args.staffId || "").trim();
  const entryId = String(args.entryId || "").trim();

  if (!staffId) throw new Error("تعذر تحديد الموظفة المطلوبة.");
  if (!entryId) throw new Error("تعذر تحديد سجل الإجازة المطلوب.");
  assertActorCanManage(args.actor);

  const staffRef = doc(db, "salons", SALON_ID, "staff_public", staffId);
  const deletedAtIso = new Date().toISOString();
  const deletedByName = actorDisplayName(args.actor);
  const deletedByUid = String(args.actor.uid || "").trim();

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(staffRef);
    if (!snap.exists()) {
      throw new Error("الموظفة المطلوبة غير موجودة أو تم حذفها.");
    }

    const data = snap.data() as { leaveBalanceDays?: unknown; leaveEntries?: LeaveEntry[] };
    const previousBalance = normalizeBalance(data?.leaveBalanceDays);
    const leaveEntries = Array.isArray(data?.leaveEntries) ? data.leaveEntries : [];
    const entryIndex = leaveEntries.findIndex((item) => String(item?.id || "").trim() === entryId);

    if (entryIndex < 0) {
      throw new Error("سجل الإجازة المطلوب غير موجود.");
    }

    const currentEntry = leaveEntries[entryIndex] as LeaveEntry;
    if (isDeletedLeaveEntry(currentEntry)) {
      throw new Error("تم حذف هذا السجل مسبقًا.");
    }

    const changeAmount = getLeaveEntryChangeAmount(currentEntry);
    if (changeAmount === 0) {
      throw new Error("تعذر عكس هذا السجل لأن قيمة التغيير غير متوفرة.");
    }

    const reversedChangeAmount = -changeAmount;
    const nextBalance = previousBalance + reversedChangeAmount;
    if (!args.allowNegativeBalance && nextBalance < 0) {
      throw new Error("لا يمكن حذف هذا السجل لأن الرصيد سيصبح بالسالب.");
    }

    const deletedEntry: LeaveEntry = {
      ...currentEntry,
      deleted: true,
      deletedAt: deletedAtIso,
      deletedBy: deletedByUid,
      ...(deletedByName ? { deletedByName } : {}),
    };

    const nextEntries = leaveEntries.map((item, index) => (index === entryIndex ? deletedEntry : item));

    tx.update(staffRef, {
      leaveBalanceDays: nextBalance,
      leaveEntries: nextEntries,
      updatedAt: serverTimestamp(),
    });

    return {
      previousBalance,
      leaveBalanceDays: nextBalance,
      leaveEntries: nextEntries,
      deletedEntry,
      reversedChangeAmount,
    };
  });
}
