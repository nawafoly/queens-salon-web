import { CoreAccountService } from "./CoreAccountService";
import { CoreCatalogService } from "./CoreCatalogService";
import { CoreHrService } from "./CoreHrService";
import { CoreStaffService } from "./CoreStaffService";
import type { EmployeeDirectoryEntry } from "./employeeHub";
import type { PartnerMemberOperationalProfile } from "../types/partner";

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function cleanEmail(value: unknown) {
  return cleanText(value).toLowerCase();
}

function cleanRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function cleanStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map(cleanText).filter(Boolean)));
  }
  const text = cleanText(value);
  if (!text) return [];
  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      return cleanStringArray(JSON.parse(text));
    } catch {
      // Fall through to delimited parsing.
    }
  }
  return Array.from(
    new Set(text.split(/[,،;|]/g).map(cleanText).filter(Boolean)),
  );
}

function safeNumber(value: unknown): number | undefined {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
}

function isActiveStatus(value: unknown) {
  const status = cleanText(value).toLowerCase();
  return !status || status === "active";
}

/**
 * Canonical employee directory.
 *
 * Core D1 owns employee/profile/employment/account identity. Core staff and
 * catalog rows only enrich the directory with booking specialties/labels.
 * There is deliberately no Firestore fallback here.
 */
async function fetchDirectoryFromCore(): Promise<EmployeeDirectoryEntry[]> {
  const [employees, staffRows, services, accounts] = await Promise.all([
    CoreHrService.listEmployees(),
    CoreStaffService.list({ activeOnly: false }).catch(() => []),
    CoreCatalogService.listServices({ activeOnly: false }).catch(() => []),
    CoreAccountService.list(false, "internal").catch(() => []),
  ]);

  const staffById = new Map(staffRows.map((row) => [cleanText(row.id), row] as const));
  const serviceLabelById = new Map(
    services.map((row) => [cleanText(row.id), cleanText(row.name || row.id)] as const),
  );
  const accountByEmployeeId = new Map<string, (typeof accounts)[number]>();
  for (const account of accounts) {
    const employeeId = cleanText(account.employeeLink?.employeeId);
    if (employeeId && !accountByEmployeeId.has(employeeId)) {
      accountByEmployeeId.set(employeeId, account);
    }
  }

  return employees
    .map((employee): EmployeeDirectoryEntry => {
      const employeeId = cleanText(employee.id);
      const employment = cleanRecord(employee.employment) || {};
      const staff = staffById.get(employeeId);
      const account = accountByEmployeeId.get(employeeId);
      const firebaseUid = cleanText(
        employee.firebaseUid || account?.firebaseUid || account?.uid,
      );
      const specialties = cleanStringArray(staff?.specialties);
      const employmentStatus = cleanText(
        employment.employmentStatus || employment.employment_status || employee.status,
      );
      const profileStatus = cleanText(employee.status);
      const active = isActiveStatus(profileStatus) && isActiveStatus(employmentStatus);

      return {
        employeeId,
        employeeKey: firebaseUid || employeeId,
        employeeUid: firebaseUid || undefined,
        employeeDocId: employeeId,
        linkedEmployeeDocId: employeeId,
        authUid: firebaseUid || undefined,
        userId: firebaseUid || undefined,
        name: cleanText(employee.name),
        email: cleanEmail(employee.email) || cleanEmail(account?.email) || undefined,
        phone: cleanText(employee.phone || employee.phoneNormalized || account?.phone) || undefined,
        role: cleanText(account?.role || account?.primaryRole || "staff") || "staff",
        active,
        linkedUid: firebaseUid || undefined,
        employeeProfileEnabled: true,
        department: cleanText(employment.department) || undefined,
        title: cleanText(employment.title || employment.jobTitle || employment.job_title) || undefined,
        avatarUrl: cleanText(employee.avatarUrl || staff?.avatarUrl) || undefined,
        employmentSource: cleanText(employment.employmentSource || employment.employment_source || "salon") || "salon",
        partnerId: cleanText(employment.partnerId || employment.partner_id) || undefined,
        partnerMemberId: cleanText(employment.partnerMemberId || employment.partner_member_id) || undefined,
        contractId: cleanText(employment.contractId || employment.contract_id) || undefined,
        resourceIds: cleanStringArray(employment.resourceIds || employment.resource_ids_json),
        specialties,
        specialtyLabels: specialties.map((specialty) => serviceLabelById.get(specialty) || specialty),
        bio: cleanText(employee.bio) || undefined,
        showOnBooking: staff ? staff.showOnBooking !== false : false,
        onLeave: false,
        employmentEndDate: cleanText(
          employment.employmentEndDate || employment.employment_end_date,
        ) || undefined,
        rating: safeNumber((staff as any)?.rating),
        reviewsCount: safeNumber((staff as any)?.reviewsCount),
        source: "api",
      };
    })
    .filter((row) => Boolean(row.employeeId) && row.active !== false)
    .sort((a, b) => {
      const an = cleanText(a.name || a.email || a.employeeId);
      const bn = cleanText(b.name || b.email || b.employeeId);
      return an.localeCompare(bn, "ar");
    });
}

export function buildPartnerMemberOperationalProfile(
  employee: EmployeeDirectoryEntry,
  context?: { contractId?: string; resourceIds?: string[] },
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
  return fetchDirectoryFromCore();
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
        cleanText(row.linkedEmployeeDocId) === normalizedId ||
        cleanText(row.employeeUid) === normalizedId ||
        cleanText(row.linkedUid) === normalizedId,
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
