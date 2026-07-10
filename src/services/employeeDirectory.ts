import { collection, getDocs } from "firebase/firestore";

import { db } from "./firebase";
import type { EmployeeDirectoryEntry } from "./employeeHub";
import { SALON_ID } from "./employeeHub";

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

function normalizeEntry(raw: any, id: string, source: DirectorySource): DirectoryEntryWithSource {
  const employeeUid = cleanText(
    raw?.employeeUid ||
      raw?.linkedUid ||
      raw?.authUid ||
      raw?.uid ||
      raw?.userId ||
      raw?.linkedUserId ||
      ""
  );
  const employeeDocId = cleanText(
    raw?.employeeDocId ||
      raw?.linkedEmployeeDocId ||
      raw?.employeeId ||
      id
  );
  const employeeId = cleanText(
    raw?.employeeDocId ||
      raw?.linkedEmployeeDocId ||
      raw?.employeeId ||
      raw?.id ||
      id
  );

  const linkedUid = cleanText(
    raw?.linkedUid ||
      raw?.employeeUid ||
      raw?.authUid ||
      raw?.uid ||
      raw?.userId ||
      raw?.linkedUserId ||
      ""
  );

  return {
    employeeId,
    employeeUid: employeeUid || undefined,
    employeeDocId: employeeDocId || undefined,
    linkedEmployeeDocId: cleanText(raw?.linkedEmployeeDocId) || undefined,
    authUid: cleanText(raw?.authUid) || undefined,
    userId: cleanText(raw?.userId) || undefined,
    employeeKey:
      cleanText(raw?.employeeKey || employeeUid || linkedUid || employeeDocId || id) ||
      undefined,
    name: cleanText(raw?.name || raw?.displayName || raw?.fullName || ""),
    email: cleanEmail(raw?.email || raw?.userEmail || "") || undefined,
    phone: cleanText(raw?.phone || "") || undefined,
    role: normalizeRole(raw?.role || "") || undefined,
    active: raw?.active !== false && raw?.isActive !== false,
    linkedUid: linkedUid || undefined,
    employeeProfileEnabled: raw?.employeeProfileEnabled !== false,
    department: cleanText(raw?.department || raw?.employeeProfile?.department || "") || undefined,
    title: cleanText(raw?.title || raw?.employeeProfile?.title || "") || undefined,
    avatarUrl:
      cleanText(raw?.avatarUrl || raw?.photoURL || raw?.photoUrl || raw?.imageUrl || "") ||
      undefined,
    source: "firestore",
    directorySource: source,
  };
}

function directoryKeys(row: EmployeeDirectoryEntry | undefined) {
  if (!row) return [];

  return Array.from(new Set([
    cleanText(row.linkedUid) ||
      "",
    cleanText(row.employeeKey) || "",
    cleanText(row.employeeUid) || "",
    cleanText(row.employeeDocId) || "",
    cleanText(row.linkedEmployeeDocId) || "",
    cleanText(row.authUid) || "",
    cleanText(row.userId) || "",
    cleanEmail(row.email) || "",
    cleanText(row.employeeId) || "",
  ].filter(Boolean)));
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

async function fetchDirectoryFromFirestore(): Promise<EmployeeDirectoryEntry[]> {
  const [employees, staffPublic, adminUsers] = await Promise.all([
    readDirectoryCollection("employees"),
    readDirectoryCollection("staff_public"),
    readDirectoryCollection("admin_users"),
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
    .map((cluster) => cluster.entry)
    .filter((row) => row.active !== false)
    .sort((a, b) => {
      const an = cleanText(a.name || a.email || a.employeeId);
      const bn = cleanText(b.name || b.email || b.employeeId);
      return an.localeCompare(bn, "ar");
    });
}

export async function listEmployeeDirectory(): Promise<EmployeeDirectoryEntry[]> {
  return fetchDirectoryFromFirestore();
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
    ]
      .map((x) => cleanText(x).toLowerCase())
      .join(" ");

    return hay.includes(q);
  });
}
