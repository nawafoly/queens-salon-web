import { collection, getDocs } from "firebase/firestore";

import { db } from "./firebase";
import type { EmployeeDirectoryEntry } from "./employeeHub";
import { SALON_ID } from "./employeeHub";
import type { PartnerMemberOperationalProfile } from "../types/partner";

type DirectorySource = "employees" | "staff_public" | "admin_users";
type DirectoryEntryWithSource = EmployeeDirectoryEntry & {
  directorySource: DirectorySource;
};

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function cleanEmail(value: unknown) {
  return cleanText(value).toLowerCase();
}

function normalizeRole(value: unknown) {
  return cleanText(value).toLowerCase();
}

function cleanStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((item) => {
            if (item && typeof item === "object") {
              const row = item as Record<string, unknown>;
              return cleanText(row.serviceId || row.id || row.name || row.value);
            }
            return cleanText(item);
          })
          .filter(Boolean)
      )
    );
  }

  const text = cleanText(value);
  if (!text) return [];

  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      return cleanStringArray(JSON.parse(text));
    } catch {
      // Fall through to the delimited text parser.
    }
  }

  return Array.from(
    new Set(
      text
        .split(/[,،;|]/g)
        .map(cleanText)
        .filter(Boolean)
    )
  );
}

function extractSpecialties(raw: Record<string, unknown>): string[] {
  const nested = Array.isArray(raw.services)
    ? raw.services.map((item) => {
        const row = cleanRecord(item);
        return row?.serviceId || row?.id || row?.name;
      })
    : [];

  return Array.from(
    new Set([
      ...cleanStringArray(raw.specialties),
      ...cleanStringArray(raw.serviceIds),
      ...cleanStringArray(raw.servicesIds),
      ...cleanStringArray(raw.providedServices),
      ...cleanStringArray(nested),
    ])
  );
}

function cleanRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function cleanRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object" && !Array.isArray(item))
    .map((item) => item as Record<string, unknown>);
}

function safeNumber(value: unknown): number | undefined {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function normalizeEntry(
  rawInput: unknown,
  id: string,
  source: DirectorySource
): DirectoryEntryWithSource {
  const raw = cleanRecord(rawInput) || {};
  const employeeProfile = cleanRecord(raw.employeeProfile);
  const employment = cleanRecord(raw.employment);
  const employeeProfileEmployment = cleanRecord(employeeProfile?.employment);

  const employeeUid = cleanText(
    raw.employeeUid ||
      raw.linkedUid ||
      raw.authUid ||
      raw.uid ||
      raw.userId ||
      raw.linkedUserId ||
      ""
  );
  const employeeDocId = cleanText(
    raw.employeeDocId ||
      raw.linkedEmployeeDocId ||
      raw.employeeId ||
      id
  );
  const employeeId = cleanText(
    raw.employeeDocId ||
      raw.linkedEmployeeDocId ||
      raw.employeeId ||
      raw.id ||
      id
  );

  const linkedUid = cleanText(
    raw.linkedUid ||
      raw.employeeUid ||
      raw.authUid ||
      raw.uid ||
      raw.userId ||
      raw.linkedUserId ||
      ""
  );

  const specialties = extractSpecialties(raw);

  return {
    employeeId,
    employeeUid: employeeUid || undefined,
    employeeDocId: employeeDocId || undefined,
    linkedEmployeeDocId: cleanText(raw.linkedEmployeeDocId) || undefined,
    authUid: cleanText(raw.authUid) || undefined,
    userId: cleanText(raw.userId) || undefined,
    employeeKey:
      cleanText(raw.employeeKey || employeeUid || linkedUid || employeeDocId || id) ||
      undefined,
    name: cleanText(raw.name || raw.displayName || raw.fullName || ""),
    email: cleanEmail(raw.email || raw.userEmail || "") || undefined,
    phone: cleanText(raw.phone || "") || undefined,
    role: normalizeRole(raw.role || "") || undefined,
    active: raw.active !== false && raw.isActive !== false,
    linkedUid: linkedUid || undefined,
    employeeProfileEnabled: raw.employeeProfileEnabled !== false,
    department:
      cleanText(
        raw.department ||
          employeeProfileEmployment?.department ||
          employment?.department
      ) || undefined,
    title:
      cleanText(
        raw.title ||
          raw.jobTitle ||
          employeeProfileEmployment?.title ||
          employment?.title
      ) || undefined,
    avatarUrl:
      cleanText(
        raw.avatarUrl ||
          raw.avatarURL ||
          raw.photoURL ||
          raw.photoUrl ||
          raw.imageUrl ||
          raw.imageURL ||
          raw.profileImageUrl ||
          raw.profileImage ||
          raw.picture ||
          raw.avatar ||
          ""
      ) || undefined,
    employmentSource: cleanText(raw.employmentSource || "salon") || "salon",
    partnerId: cleanText(raw.partnerId || "") || undefined,
    partnerMemberId: cleanText(raw.partnerMemberId || "") || undefined,
    partnerName: cleanText(raw.partnerName || "") || undefined,
    contractId: cleanText(raw.contractId || "") || undefined,
    resourceIds: cleanStringArray(raw.resourceIds),
    specialties,
    specialtyLabels: [],
    bio: cleanText(raw.bio || "") || undefined,
    showOnBooking: raw.showOnBooking !== false,
    onLeave: raw.onLeave === true,
    leaveUntil: cleanText(raw.leaveUntil || "") || undefined,
    employmentEndDate:
      cleanText(raw.employmentEndDate || raw.lastWorkingDate || raw.resignationDate || "") ||
      undefined,
    useCustomWorkingHours: raw.useCustomWorkingHours === true,
    customWorkingHours: cleanRecord(raw.customWorkingHours),
    customWorkingHourOverrides: cleanRecordArray(raw.customWorkingHourOverrides),
    exceptionalLeaveDates: cleanStringArray(raw.exceptionalLeaveDates),
    exceptionalLeaveWeekdays: cleanStringArray(
      raw.exceptionalLeaveWeekdays || raw.weeklyOffDays || raw.offWeekdays
    ),
    rating: safeNumber(raw.rating),
    reviewsCount: safeNumber(raw.reviewsCount || raw.reviewCount),
    source: "firestore",
    directorySource: source,
  };
}

function directoryKeys(row: EmployeeDirectoryEntry | undefined) {
  if (!row) return [];

  return Array.from(
    new Set(
      [
        cleanText(row.linkedUid),
        cleanText(row.employeeKey),
        cleanText(row.employeeUid),
        cleanText(row.employeeDocId),
        cleanText(row.linkedEmployeeDocId),
        cleanText(row.authUid),
        cleanText(row.userId),
        cleanEmail(row.email),
        cleanText(row.employeeId),
      ].filter(Boolean)
    )
  );
}

function scoreSource(source: DirectorySource) {
  if (source === "employees") return 3;
  if (source === "admin_users") return 2;
  return 1;
}

function mergeEntry(
  current: DirectoryEntryWithSource | undefined,
  next: DirectoryEntryWithSource
): DirectoryEntryWithSource {
  if (!current) return next;

  const preferNext = scoreSource(next.directorySource) >= scoreSource(current.directorySource);
  const nextSpecialties = next.specialties?.length ? next.specialties : current.specialties;

  return {
    employeeId: preferNext ? next.employeeId || current.employeeId : current.employeeId || next.employeeId,
    employeeKey: current.employeeKey || next.employeeKey,
    employeeUid: current.employeeUid || next.employeeUid,
    employeeDocId: current.employeeDocId || next.employeeDocId,
    linkedEmployeeDocId: current.linkedEmployeeDocId || next.linkedEmployeeDocId,
    authUid: current.authUid || next.authUid,
    userId: current.userId || next.userId,
    name: next.name || current.name,
    email: next.email || current.email,
    phone: next.phone || current.phone,
    role: next.role || current.role,
    active: current.active !== false && next.active !== false,
    linkedUid: current.linkedUid || next.linkedUid,
    employeeProfileEnabled:
      current.employeeProfileEnabled !== false && next.employeeProfileEnabled !== false,
    department: next.department || current.department,
    title: next.title || current.title,
    avatarUrl: next.avatarUrl || current.avatarUrl,
    employmentSource: next.employmentSource || current.employmentSource,
    partnerId: next.partnerId || current.partnerId,
    partnerMemberId: next.partnerMemberId || current.partnerMemberId,
    partnerName: next.partnerName || current.partnerName,
    contractId: next.contractId || current.contractId,
    resourceIds: next.resourceIds?.length ? next.resourceIds : current.resourceIds,
    specialties: nextSpecialties,
    specialtyLabels: next.specialtyLabels?.length ? next.specialtyLabels : current.specialtyLabels,
    bio: next.bio || current.bio,
    showOnBooking:
      next.directorySource === "staff_public" ? next.showOnBooking : current.showOnBooking ?? next.showOnBooking,
    onLeave: next.onLeave === true || current.onLeave === true,
    leaveUntil: next.leaveUntil || current.leaveUntil,
    employmentEndDate: next.employmentEndDate || current.employmentEndDate,
    useCustomWorkingHours: next.useCustomWorkingHours === true || current.useCustomWorkingHours === true,
    customWorkingHours: next.customWorkingHours || current.customWorkingHours,
    customWorkingHourOverrides:
      next.customWorkingHourOverrides?.length
        ? next.customWorkingHourOverrides
        : current.customWorkingHourOverrides,
    exceptionalLeaveDates:
      next.exceptionalLeaveDates?.length ? next.exceptionalLeaveDates : current.exceptionalLeaveDates,
    exceptionalLeaveWeekdays:
      next.exceptionalLeaveWeekdays?.length
        ? next.exceptionalLeaveWeekdays
        : current.exceptionalLeaveWeekdays,
    rating: next.rating ?? current.rating,
    reviewsCount: next.reviewsCount ?? current.reviewsCount,
    source: "firestore",
    directorySource: preferNext ? next.directorySource : current.directorySource,
  };
}

async function readDirectoryCollection(
  collectionName: "employees" | "staff_public" | "admin_users"
): Promise<DirectoryEntryWithSource[]> {
  try {
    const snap = await getDocs(collection(db, "salons", SALON_ID, collectionName));

    return snap.docs
      .map((d) => normalizeEntry(d.data(), d.id, collectionName))
      .filter((row) => !!row.employeeId);
  } catch (error) {
    console.warn(`[employeeDirectory] failed to read ${collectionName}`, error);
    return [];
  }
}

async function readServiceLabels() {
  const labels = new Map<string, string>();
  try {
    const snap = await getDocs(collection(db, "salons", SALON_ID, "services"));
    snap.docs.forEach((serviceDoc) => {
      const data = cleanRecord(serviceDoc.data()) || {};
      const label = cleanText(data?.name || data?.title || data?.label || serviceDoc.id);
      if (label) labels.set(serviceDoc.id, label);
      const aliases = cleanStringArray([data?.serviceId, data?.code, data?.slug, data?.name]);
      aliases.forEach((alias) => {
        if (alias && label && !labels.has(alias)) labels.set(alias, label);
      });
    });
  } catch (error) {
    console.warn("[employeeDirectory] failed to read services", error);
  }
  return labels;
}

async function fetchDirectoryFromFirestore(): Promise<EmployeeDirectoryEntry[]> {
  const [employees, staffPublic, adminUsers, serviceLabels] = await Promise.all([
    readDirectoryCollection("employees"),
    readDirectoryCollection("staff_public"),
    readDirectoryCollection("admin_users"),
    readServiceLabels(),
  ]);

  type DirectoryCluster = {
    entry: DirectoryEntryWithSource;
    keys: Set<string>;
  };

  const clusters: DirectoryCluster[] = [];

  for (const row of [...staffPublic, ...adminUsers, ...employees]) {
    const rowKeys = new Set(directoryKeys(row));
    if (!rowKeys.size) continue;

    const matchedIndexes: number[] = [];
    for (let index = 0; index < clusters.length; index += 1) {
      const cluster = clusters[index];
      if (Array.from(rowKeys).some((key) => cluster.keys.has(key))) {
        matchedIndexes.push(index);
      }
    }

    let merged: DirectoryEntryWithSource | undefined;
    const mergedKeys = new Set(rowKeys);

    for (const index of matchedIndexes) {
      const cluster = clusters[index];
      merged = mergeEntry(merged, cluster.entry);
      for (const key of cluster.keys) mergedKeys.add(key);
    }

    merged = mergeEntry(merged, row);
    for (const key of directoryKeys(merged)) mergedKeys.add(key);

    for (let index = matchedIndexes.length - 1; index >= 0; index -= 1) {
      clusters.splice(matchedIndexes[index], 1);
    }

    clusters.push({ entry: merged, keys: mergedKeys });
  }

  return clusters
    .map((cluster) => ({
      ...cluster.entry,
      specialtyLabels: (cluster.entry.specialties || []).map(
        (specialty) => serviceLabels.get(specialty) || specialty
      ),
    }))
    .filter((row) => row.active !== false)
    .sort((a, b) => {
      const an = cleanText(a.name || a.email || a.employeeId);
      const bn = cleanText(b.name || b.email || b.employeeId);
      return an.localeCompare(bn, "ar");
    });
}

export function buildPartnerMemberOperationalProfile(
  employee: EmployeeDirectoryEntry,
  context?: { contractId?: string; resourceIds?: string[] }
): PartnerMemberOperationalProfile {
  return {
    employeeId: cleanText(employee.employeeId) || undefined,
    department: cleanText(employee.department) || undefined,
    title: cleanText(employee.title) || undefined,
    avatarUrl: cleanText(employee.avatarUrl) || undefined,
    specialties: cleanStringArray(employee.specialties),
    specialtyLabels:
      cleanStringArray(employee.specialtyLabels).length > 0
        ? cleanStringArray(employee.specialtyLabels)
        : cleanStringArray(employee.specialties),
    bio: cleanText(employee.bio) || undefined,
    showOnBooking: employee.showOnBooking !== false,
    onLeave: employee.onLeave === true,
    leaveUntil: cleanText(employee.leaveUntil) || undefined,
    employmentEndDate: cleanText(employee.employmentEndDate) || undefined,
    useCustomWorkingHours: employee.useCustomWorkingHours === true,
    customWorkingHours: cleanRecord(employee.customWorkingHours),
    customWorkingHourOverrides: cleanRecordArray(employee.customWorkingHourOverrides),
    exceptionalLeaveDates: cleanStringArray(employee.exceptionalLeaveDates),
    exceptionalLeaveWeekdays: cleanStringArray(employee.exceptionalLeaveWeekdays),
    resourceIds:
      cleanStringArray(employee.resourceIds).length > 0
        ? cleanStringArray(employee.resourceIds)
        : cleanStringArray(context?.resourceIds),
    contractId: cleanText(employee.contractId || context?.contractId) || undefined,
    rating: safeNumber(employee.rating),
    reviewsCount: safeNumber(employee.reviewsCount),
    syncedAt: new Date().toISOString(),
  };
}

export async function listEmployeeDirectory(): Promise<EmployeeDirectoryEntry[]> {
  return fetchDirectoryFromFirestore();
}

export async function getEmployeeDirectoryEntry(employeeId: string) {
  const normalizedId = cleanText(employeeId);
  if (!normalizedId) return null;
  const rows = await listEmployeeDirectory();
  return (
    rows.find(
      (row) =>
        cleanText(row.employeeId) === normalizedId ||
        cleanText(row.employeeDocId) === normalizedId ||
        cleanText(row.linkedEmployeeDocId) === normalizedId
    ) || null
  );
}

export async function searchEmployeeDirectory(term: string): Promise<EmployeeDirectoryEntry[]> {
  const q = cleanText(term).toLowerCase();
  const rows = await listEmployeeDirectory();
  if (!q) return rows;

  return rows.filter((row) => {
    const hay = [
      row.employeeId,
      row.employeeKey,
      row.name,
      row.email,
      row.phone,
      row.role,
      row.department,
      row.title,
      row.employmentSource,
      row.partnerName,
      row.partnerId,
      ...(row.specialtyLabels || []),
    ]
      .map((x) => cleanText(x).toLowerCase())
      .join(" ");

    return hay.includes(q);
  });
}
