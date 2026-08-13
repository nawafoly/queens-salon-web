import {
  isRemovedFromStaffRecord as isRemovalFlaggedStaffRecord,
} from "./staffAccountLinkServiceCore";

export type {
  AccountUserLinkRow,
  StaffAccountLinkRow,
} from "./staffAccountLinkServiceCore";

export {
  listStaffLinkRows,
  listEmployeeLinkRows,
  listUserLinkRows,
  findStaffMatchesForUser,
  softDeleteLinkedStaffByUser,
  repairLegacyStaffUserLinks,
} from "./staffAccountLinkServiceCore";

function cleanText(value: unknown): string {
  return String(value || "").trim();
}

function firestoreLikeTimestampMs(value: unknown): number {
  if (!value) return 0;

  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : 0;
  }

  if (typeof (value as { toMillis?: unknown })?.toMillis === "function") {
    const millis = Number((value as { toMillis: () => number }).toMillis());
    return Number.isFinite(millis) ? millis : 0;
  }

  const record = value as Record<string, unknown>;
  const seconds = Number(record?.seconds ?? record?._seconds);
  const nanoseconds = Number(record?.nanoseconds ?? record?._nanoseconds ?? 0);
  if (Number.isFinite(seconds)) {
    return seconds * 1000 + Math.floor((Number.isFinite(nanoseconds) ? nanoseconds : 0) / 1_000_000);
  }

  const parsed = Date.parse(cleanText(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isExplicitRemovedStatus(value: unknown) {
  const status = cleanText(value).toLowerCase();
  return status === "deleted" || status === "archived";
}

/**
 * Legacy staff rows can retain removedFromStaff/archived/deleted flags after an
 * administrator saves the canonical employee again. A fresh active canonical
 * write restores that employee unless the current record still carries an
 * explicit deleted/archived status. This keeps old removal metadata from
 * excluding the correct staff_public row during DashboardEmployees reload.
 */
export function isRemovedFromStaffRecord(data: unknown): boolean {
  const row = (data || {}) as Record<string, unknown>;
  if (!isRemovalFlaggedStaffRecord(row)) return false;

  const deletedAtMs = firestoreLikeTimestampMs(row.deletedAt);
  const updatedAtMs = firestoreLikeTimestampMs(row.updatedAt);
  const active = row.active === true || row.isActive === true;
  const explicitlyRemovedStatus =
    isExplicitRemovedStatus(row.employmentStatus) ||
    isExplicitRemovedStatus(row.status);
  const hasFreshCanonicalWrite =
    updatedAtMs > 0 &&
    (deletedAtMs <= 0 || updatedAtMs > deletedAtMs);

  if (hasFreshCanonicalWrite && active && !explicitlyRemovedStatus) {
    return false;
  }

  return true;
}
