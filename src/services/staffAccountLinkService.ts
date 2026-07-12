import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";

import { db } from "./firebase";

const SALON_ID = "main";
const USERS_COLLECTION = ["salons", SALON_ID, "users"] as const;
const STAFF_PUBLIC_COLLECTION = ["salons", SALON_ID, "staff_public"] as const;
const EMPLOYEES_COLLECTION = ["salons", SALON_ID, "employees"] as const;

export type AccountUserLinkRow = {
  uid: string;
  email?: string;
  userEmail?: string;
  phone?: string;
  displayName?: string;
  name?: string;
  fullName?: string;
  role?: string;
  active?: boolean;
  linkedEmployeeDocId?: string;
  employeeId?: string;
  deletedAt?: unknown;
  [key: string]: unknown;
};

export type StaffAccountLinkRow = {
  id: string;
  uid?: string;
  linkedUid?: string;
  linkedUserId?: string;
  email?: string;
  userEmail?: string;
  phone?: string;
  name?: string;
  displayName?: string;
  fullName?: string;
  role?: string;
  active?: boolean;
  deletedAt?: unknown;
  removedFromStaff?: boolean;
  employmentStatus?: string;
  [key: string]: unknown;
};

type MatchReason =
  | "employee_doc_id"
  | "employee_id"
  | "uid"
  | "email"
  | "phone"
  | "name";

function cleanText(value: unknown): string {
  return String(value || "").trim();
}

function cleanEmail(value: unknown): string {
  return cleanText(value).toLowerCase();
}

function cleanPhone(value: unknown): string {
  return cleanText(value).replace(/\D+/g, "");
}

function normalizeArabicName(value: unknown): string {
  return cleanText(value)
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\u0600-\u06FFa-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasValue(value: unknown): boolean {
  return cleanText(value).length > 0;
}

function pushUnique(rows: StaffAccountLinkRow[], seen: Set<string>, row: StaffAccountLinkRow) {
  if (!row?.id || seen.has(row.id)) return;
  seen.add(row.id);
  rows.push(row);
}

function shouldPatchField(currentValue: unknown, nextValue: unknown, reason: MatchReason): boolean {
  const current = cleanText(currentValue);
  const next = cleanText(nextValue);
  if (!next) return false;
  if (!current) return true;
  return reason !== "name" && current !== next;
}

function getStaffDocIdCandidates(user: AccountUserLinkRow): string[] {
  return Array.from(
    new Set(
      [user.linkedEmployeeDocId, user.employeeId]
        .map((value) => cleanText(value))
        .filter(Boolean)
    )
  );
}

function getStaffUidCandidates(user: AccountUserLinkRow): string[] {
  return Array.from(new Set([user.uid].map((value) => cleanText(value)).filter(Boolean)));
}

function getUserUidCandidates(staff: StaffAccountLinkRow): string[] {
  return Array.from(
    new Set(
      [staff.linkedUid, staff.uid, staff.linkedUserId]
        .map((value) => cleanText(value))
        .filter(Boolean)
    )
  );
}

function getUserEmailCandidates(user: AccountUserLinkRow): string[] {
  return Array.from(
    new Set([user.email, user.userEmail].map((value) => cleanEmail(value)).filter(Boolean))
  );
}

function getStaffEmailCandidates(staff: StaffAccountLinkRow): string[] {
  return Array.from(
    new Set([staff.email, staff.userEmail].map((value) => cleanEmail(value)).filter(Boolean))
  );
}

function getUserNameCandidates(user: AccountUserLinkRow): string[] {
  return Array.from(
    new Set(
      [user.displayName, user.name, user.fullName]
        .map((value) => normalizeArabicName(value))
        .filter(Boolean)
    )
  );
}

function getStaffNameCandidates(staff: StaffAccountLinkRow): string[] {
  return Array.from(
    new Set(
      [staff.name, staff.displayName, staff.fullName]
        .map((value) => normalizeArabicName(value))
        .filter(Boolean)
    )
  );
}

export function isRemovedFromStaffRecord(data: unknown): boolean {
  const row = (data || {}) as Record<string, unknown>;
  const employmentStatus = cleanText(row.employmentStatus).toLowerCase();

  const status = cleanText(row.status).toLowerCase();
  return (
    Boolean(row.deletedAt) ||
    row.removedFromStaff === true ||
    row.archived === true ||
    row.deleted === true ||
    employmentStatus === "deleted" ||
    employmentStatus === "archived" ||
    status === "deleted" ||
    status === "archived"
  );
}

export async function listStaffLinkRows(): Promise<StaffAccountLinkRow[]> {
  const snap = await getDocs(collection(db, ...STAFF_PUBLIC_COLLECTION));

  return snap.docs.map((staffDoc) => ({
    id: staffDoc.id,
    ...(staffDoc.data() as Record<string, unknown>),
  })) as StaffAccountLinkRow[];
}

export async function listUserLinkRows(): Promise<AccountUserLinkRow[]> {
  const snap = await getDocs(collection(db, ...USERS_COLLECTION));

  return snap.docs.map((userDoc) => ({
    uid: userDoc.id,
    ...(userDoc.data() as Record<string, unknown>),
  })) as AccountUserLinkRow[];
}

export function findStaffMatchesForUser(
  user: AccountUserLinkRow,
  staffRows: StaffAccountLinkRow[]
): StaffAccountLinkRow[] {
  const seen = new Set<string>();
  const matches: StaffAccountLinkRow[] = [];

  const docIds = getStaffDocIdCandidates(user);
  if (docIds.length) {
    staffRows.forEach((staff) => {
      if (docIds.includes(cleanText(staff.id))) {
        pushUnique(matches, seen, staff);
      }
    });

    if (matches.length) return matches;
  }

  const userUids = getStaffUidCandidates(user);
  if (userUids.length) {
    staffRows.forEach((staff) => {
      const staffUids = getUserUidCandidates(staff);

      if (staffUids.some((candidate) => userUids.includes(candidate))) {
        pushUnique(matches, seen, staff);
      }
    });

    if (matches.length) return matches;
  }

  const userEmails = getUserEmailCandidates(user);
  if (userEmails.length) {
    staffRows.forEach((staff) => {
      const staffEmails = getStaffEmailCandidates(staff);

      if (staffEmails.some((candidate) => userEmails.includes(candidate))) {
        pushUnique(matches, seen, staff);
      }
    });

    if (matches.length) return matches;
  }

  const userPhone = cleanPhone(user.phone);
  if (userPhone) {
    staffRows.forEach((staff) => {
      const staffPhone = cleanPhone(staff.phone);

      if (staffPhone && staffPhone === userPhone) {
        pushUnique(matches, seen, staff);
      }
    });

    if (matches.length) return matches;
  }

  const userNames = getUserNameCandidates(user);
  if (userNames.length) {
    const nameHits = staffRows.filter((staff) => {
      const staffNames = getStaffNameCandidates(staff);
      return staffNames.some((candidate) => userNames.includes(candidate));
    });

    // الاسم خطر لو فيه تكرار، لذلك نستخدمه فقط إذا جاب نتيجة واحدة واضحة.
    if (nameHits.length === 1) {
      pushUnique(matches, seen, nameHits[0]);
      return matches;
    }
  }

  return matches;
}

function findBestUserMatchForStaff(
  staff: StaffAccountLinkRow,
  users: AccountUserLinkRow[],
  usedUserUids: Set<string>
): { user: AccountUserLinkRow; reason: MatchReason } | null {
  const availableUsers = users.filter((user) => !usedUserUids.has(cleanText(user.uid)));
  if (!availableUsers.length) return null;

  const uidCandidates = getUserUidCandidates(staff);
  if (uidCandidates.length) {
    const hit = availableUsers.find((user) => uidCandidates.includes(cleanText(user.uid)));
    if (hit) return { user: hit, reason: "uid" };
  }

  const emailCandidates = getStaffEmailCandidates(staff);
  if (emailCandidates.length) {
    const hit = availableUsers.find((user) =>
      emailCandidates.some((email) => getUserEmailCandidates(user).includes(email))
    );

    if (hit) return { user: hit, reason: "email" };
  }

  const phone = cleanPhone(staff.phone);
  if (phone) {
    const hit = availableUsers.find((user) => cleanPhone(user.phone) === phone);
    if (hit) return { user: hit, reason: "phone" };
  }

  const staffNames = getStaffNameCandidates(staff);
  if (staffNames.length) {
    const nameHits = availableUsers.filter((user) => {
      const userNames = getUserNameCandidates(user);
      return userNames.some((name) => staffNames.includes(name));
    });

    if (nameHits.length === 1) return { user: nameHits[0], reason: "name" };
  }

  return null;
}

export async function softDeleteLinkedStaffByUser(args: {
  user: AccountUserLinkRow;
  actorUid?: string;
  staffRows?: StaffAccountLinkRow[];
}) {
  const staffRows = args.staffRows ?? (await listStaffLinkRows());

  const matches = findStaffMatchesForUser(args.user, staffRows).filter(
    (staff) => !isRemovedFromStaffRecord(staff)
  );

  if (!matches.length) {
    console.warn("[softDeleteLinkedStaffByUser] no linked staff matched", {
      uid: args.user.uid,
      email: args.user.email,
      phone: args.user.phone,
      displayName: args.user.displayName || args.user.name || args.user.fullName || "",
      linkedEmployeeDocId: args.user.linkedEmployeeDocId,
      employeeId: args.user.employeeId,
    });

    return { matchedStaffIds: [] as string[] };
  }

  let batch = writeBatch(db);
  let writes = 0;
  const actorUid = cleanText(args.actorUid);

  const commitIfNeeded = async (force = false) => {
    if (writes <= 0) return;
    if (!force && writes < 350) return;

    await batch.commit();

    batch = writeBatch(db);
    writes = 0;
  };

  for (const staff of matches) {
    const staffRef = doc(db, ...STAFF_PUBLIC_COLLECTION, staff.id);
    const employeeRef = doc(db, ...EMPLOYEES_COLLECTION, staff.id);

    const deletePatch = {
      active: false,
      isActive: false,
      showOnAbout: false,
      showOnBooking: false,
      removedFromStaff: true,
      employmentStatus: "deleted",
      deletedAt: serverTimestamp(),
      deletedBy: actorUid || null,
      updatedAt: serverTimestamp(),
    };

    batch.set(
      staffRef,
      {
        active: false,
        showOnAbout: false,
        showOnBooking: false,
        removedFromStaff: true,
        employmentStatus: "deleted",
        deletedAt: serverTimestamp(),
        deletedBy: actorUid || null,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    batch.set(employeeRef, deletePatch, { merge: true });

    writes += 2;
    await commitIfNeeded();
  }

  await commitIfNeeded(true);

  console.log("[softDeleteLinkedStaffByUser] matched staff deleted", {
    uid: args.user.uid,
    matchedStaffIds: matches.map((staff) => staff.id),
  });

  return { matchedStaffIds: matches.map((staff) => staff.id) };
}

export async function repairLegacyStaffUserLinks() {
  const [users, staffRows] = await Promise.all([listUserLinkRows(), listStaffLinkRows()]);
  const activeUsers = users.filter((user) => !user.deletedAt);
  const candidateStaff = staffRows.filter((staff) => !isRemovedFromStaffRecord(staff));

  let batch = writeBatch(db);
  let writes = 0;
  let patchedUsers = 0;
  let patchedStaff = 0;
  let linkedPairs = 0;
  const usedUserUids = new Set<string>();

  const commitIfNeeded = async (force = false) => {
    if (writes <= 0) return;
    if (!force && writes < 350) return;

    await batch.commit();

    batch = writeBatch(db);
    writes = 0;
  };

  const patchPair = async (user: AccountUserLinkRow, staff: StaffAccountLinkRow, reason: MatchReason) => {
    const staffPatch: Record<string, unknown> = {};
    const userPatch: Record<string, unknown> = {};

    const cleanUid = cleanText(user.uid);
    const cleanUserEmail = cleanEmail(user.email || user.userEmail);
    const cleanUserPhone = cleanText(user.phone);
    const cleanStaffId = cleanText(staff.id);
    const cleanDisplayName = cleanText(user.displayName || user.name || user.fullName);
    const cleanRole = cleanText(user.role || staff.role);

    if (shouldPatchField(staff.linkedUid, cleanUid, reason)) staffPatch.linkedUid = cleanUid;
    if (shouldPatchField(staff.linkedUserId, cleanUid, reason)) staffPatch.linkedUserId = cleanUid;
    if (shouldPatchField(staff.uid, cleanUid, reason)) staffPatch.uid = cleanUid;
    if (shouldPatchField(staff.userEmail, cleanUserEmail, reason)) staffPatch.userEmail = cleanUserEmail;
    if (!hasValue(staff.email) && cleanUserEmail) staffPatch.email = cleanUserEmail;
    if (!hasValue(staff.phone) && cleanUserPhone) staffPatch.phone = cleanUserPhone;
    if (!hasValue(staff.name) && cleanDisplayName) staffPatch.name = cleanDisplayName;
    if (!hasValue(staff.role) && cleanRole) staffPatch.role = cleanRole;

    if (typeof staff.active !== "boolean" && typeof user.active === "boolean") {
      staffPatch.active = user.active;
    }

    if (shouldPatchField(user.linkedEmployeeDocId, cleanStaffId, reason)) {
      userPatch.linkedEmployeeDocId = cleanStaffId;
    }

    if (shouldPatchField(user.employeeId, cleanStaffId, reason)) {
      userPatch.employeeId = cleanStaffId;
    }

    if (!hasValue(user.displayName) && hasValue(staff.name)) {
      userPatch.displayName = cleanText(staff.name);
    }

    if (!hasValue(user.name) && hasValue(staff.name)) {
      userPatch.name = cleanText(staff.name);
    }

    if (!hasValue(user.phone) && hasValue(staff.phone)) {
      userPatch.phone = cleanText(staff.phone);
    }

    if (!hasValue(user.role) && hasValue(staff.role)) {
      userPatch.role = cleanText(staff.role);
    }

    if (Object.keys(staffPatch).length) {
      batch.set(
        doc(db, ...STAFF_PUBLIC_COLLECTION, cleanStaffId),
        { ...staffPatch, updatedAt: serverTimestamp() },
        { merge: true }
      );

      batch.set(
        doc(db, ...EMPLOYEES_COLLECTION, cleanStaffId),
        {
          ...staffPatch,
          ...(staffPatch.active !== undefined ? { isActive: staffPatch.active } : {}),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      patchedStaff += 1;
      writes += 2;
    }

    if (Object.keys(userPatch).length) {
      batch.set(
        doc(db, ...USERS_COLLECTION, cleanUid),
        { ...userPatch, updatedAt: serverTimestamp() },
        { merge: true }
      );

      patchedUsers += 1;
      writes += 1;
    }

    if (Object.keys(staffPatch).length || Object.keys(userPatch).length) {
      linkedPairs += 1;
      usedUserUids.add(cleanUid);
    }

    await commitIfNeeded();
  };

  for (const user of activeUsers) {
    const directMatches = findStaffMatchesForUser(user, candidateStaff).filter(
      (staff) => !usedUserUids.has(cleanText(user.uid))
    );

    if (!directMatches.length) continue;

    const reason = getStaffDocIdCandidates(user)[0]
      ? "employee_doc_id"
      : getStaffUidCandidates(user)[0]
        ? "uid"
        : getUserEmailCandidates(user)[0]
          ? "email"
          : cleanPhone(user.phone)
            ? "phone"
            : "name";

    await patchPair(user, directMatches[0], reason);
  }

  for (const staff of candidateStaff) {
    const match = findBestUserMatchForStaff(staff, activeUsers, usedUserUids);
    if (!match) continue;

    await patchPair(match.user, staff, match.reason);
  }

  await commitIfNeeded(true);

  return {
    usersScanned: activeUsers.length,
    staffScanned: candidateStaff.length,
    linkedPairs,
    patchedUsers,
    patchedStaff,
  };
}
