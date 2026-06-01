import { collection, getDocs } from "firebase/firestore";

import { db } from "./firebase";
import type { EmployeeDirectoryEntry } from "./employeeHub";
import { SALON_ID } from "./employeeHub";

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function cleanEmail(value: unknown) {
  return cleanText(value).toLowerCase();
}

function normalizeEntry(raw: any, id: string, source: "api" | "firestore"): EmployeeDirectoryEntry {
  return {
    employeeId: cleanText(raw?.employeeId || raw?.id || id),
    employeeKey: cleanText(raw?.employeeKey || raw?.linkedUid || raw?.uid || id) || undefined,
    name: cleanText(raw?.name || raw?.displayName || ""),
    email: cleanEmail(raw?.email || raw?.userEmail || "") || undefined,
    phone: cleanText(raw?.phone || "") || undefined,
    role: cleanText(raw?.role || "") || undefined,
    active: raw?.active !== false,
    linkedUid: cleanText(raw?.linkedUid || raw?.uid || "") || undefined,
    employeeProfileEnabled: raw?.employeeProfileEnabled !== false,
    department: cleanText(raw?.department || "") || undefined,
    title: cleanText(raw?.title || "") || undefined,
    avatarUrl: cleanText(raw?.avatarUrl || raw?.photoURL || raw?.photoUrl || "") || undefined,
    source,
  };
}

async function fetchDirectoryFromApi(): Promise<EmployeeDirectoryEntry[] | null> {
  try {
    const res = await fetch("/api/employee-directory", {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    const payload = await res.json().catch(() => null);
    const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : [];
    if (!Array.isArray(rows)) return null;
    return rows
      .map((item: any, index: number) =>
        normalizeEntry(item, cleanText(item?.employeeId || item?.id || `api_${index}`), "api")
      )
      .filter((item) => !!item.employeeId);
  } catch {
    return null;
  }
}

async function fetchDirectoryFromFirestore(): Promise<EmployeeDirectoryEntry[]> {
  const snap = await getDocs(collection(db, "salons", SALON_ID, "employees"));
  return snap.docs
    .map((d) => normalizeEntry(d.data(), d.id, "firestore"))
    .filter((row) => !!row.employeeId);
}

export async function listEmployeeDirectory(): Promise<EmployeeDirectoryEntry[]> {
  const apiRows = await fetchDirectoryFromApi();
  if (apiRows?.length) return apiRows;
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
