import { coreApiRequest } from "./coreApiClient";

export type EmployeePermissionSource = "employee_request" | "admin_direct";
export type EmployeePermissionStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "out"
  | "returned"
  | "cancelled";
export type EmployeePermissionFinancialEffect = "none" | "paid" | "unpaid";

export type EmployeePermissionRequest = {
  id: string;
  employeeUid: string;
  employeeId?: string;
  employeeName?: string;
  date: string;
  startTime: string;
  expectedReturnTime?: string;
  actualExitTime?: string;
  actualReturnTime?: string;
  reason: string;
  note?: string;
  source: EmployeePermissionSource;
  status: EmployeePermissionStatus;
  financialEffect: EmployeePermissionFinancialEffect;
  durationMinutes?: number;
  unpaidMinutes?: number;
  createdByUid?: string;
  createdByName?: string;
  reviewerUid?: string;
  reviewerName?: string;
  returnedByUid?: string;
  returnedByName?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  reviewedAt?: unknown;
  exitedAt?: unknown;
  returnedAt?: unknown;
};

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function camelRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row || {})) {
    out[key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())] = value;
  }
  return out;
}

function normalizeSource(value: unknown): EmployeePermissionSource {
  return cleanText(value) === "admin_direct" ? "admin_direct" : "employee_request";
}

function normalizeStatus(value: unknown): EmployeePermissionStatus {
  const raw = cleanText(value).toLowerCase();
  if (raw === "approved") return "approved";
  if (raw === "rejected") return "rejected";
  if (raw === "out") return "out";
  if (raw === "returned") return "returned";
  if (raw === "cancelled") return "cancelled";
  return "pending";
}

function normalizeFinancialEffect(value: unknown): EmployeePermissionFinancialEffect {
  const raw = cleanText(value).toLowerCase();
  if (raw === "paid") return "paid";
  if (raw === "unpaid") return "unpaid";
  return "none";
}

function normalizePermissionRequest(raw: Record<string, unknown>): EmployeePermissionRequest {
  const data = camelRow(raw);
  return {
    id: cleanText(data.id),
    employeeUid: cleanText(data.employeeUid),
    employeeId: cleanText(data.employeeId) || undefined,
    employeeName: cleanText(data.employeeName) || undefined,
    date: cleanText(data.dateKey || data.date),
    startTime: cleanText(data.requestedExitTime || data.startTime),
    expectedReturnTime: cleanText(data.expectedReturnTime) || undefined,
    actualExitTime: cleanText(data.actualExitTime) || undefined,
    actualReturnTime: cleanText(data.actualReturnTime) || undefined,
    reason: cleanText(data.reason),
    note: cleanText(data.note) || undefined,
    source: normalizeSource(data.source),
    status: normalizeStatus(data.status),
    financialEffect: normalizeFinancialEffect(data.financialEffect),
    durationMinutes: Number.isFinite(Number(data.durationMinutes))
      ? Math.max(0, Number(data.durationMinutes))
      : undefined,
    unpaidMinutes: Number.isFinite(Number(data.unpaidMinutes))
      ? Math.max(0, Number(data.unpaidMinutes))
      : undefined,
    createdByUid: cleanText(data.createdByUid) || undefined,
    createdByName: cleanText(data.createdByName) || undefined,
    reviewerUid: cleanText(data.reviewerUid) || undefined,
    reviewerName: cleanText(data.reviewerName) || undefined,
    returnedByUid: cleanText(data.returnedByUid) || undefined,
    returnedByName: cleanText(data.returnedByName) || undefined,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    reviewedAt: data.reviewedAt,
    exitedAt: data.exitedAt,
    returnedAt: data.returnedAt,
  };
}

async function listPermissionRequests(query: Record<string, string | number | undefined>) {
  const rows = await coreApiRequest<Record<string, unknown>[]>(
    "/api/core/hr/permissions",
    { query }
  );
  return rows.map(normalizePermissionRequest);
}

export async function createPermissionRequest(input: {
  employeeUid: string;
  employeeId?: string;
  employeeName?: string;
  date: string;
  startTime: string;
  expectedReturnTime?: string;
  reason: string;
  note?: string;
  source?: EmployeePermissionSource;
  status?: EmployeePermissionStatus;
  financialEffect?: EmployeePermissionFinancialEffect;
  createdByUid: string;
  createdByName?: string;
}) {
  const row = await coreApiRequest<Record<string, unknown>>(
    "/api/core/hr/permissions",
    {
      method: "POST",
      body: {
        employeeUid: cleanText(input.employeeUid),
        employeeId: cleanText(input.employeeId),
        employeeName: cleanText(input.employeeName),
        date: cleanText(input.date),
        startTime: cleanText(input.startTime),
        expectedReturnTime: cleanText(input.expectedReturnTime),
        reason: cleanText(input.reason),
        note: cleanText(input.note),
        source: normalizeSource(input.source),
        financialEffect: normalizeFinancialEffect(input.financialEffect),
      },
    }
  );
  return normalizePermissionRequest(row);
}

export async function listPermissionRequestsByEmployee(
  employeeUid: string,
  limitCount = 100
): Promise<EmployeePermissionRequest[]> {
  return listPermissionRequests({
    employeeUid: cleanText(employeeUid),
    limit: Math.max(1, Number(limitCount || 100)),
  });
}

export async function listEmployeePermissionRequests(
  limitCount = 250
): Promise<EmployeePermissionRequest[]> {
  return listPermissionRequests({
    limit: Math.max(1, Number(limitCount || 250)),
  });
}

export async function reviewPermissionRequest(args: {
  requestId: string;
  status: "approved" | "rejected" | "cancelled";
  reviewerUid: string;
  reviewerName?: string;
  financialEffect?: EmployeePermissionFinancialEffect;
}) {
  const requestId = cleanText(args.requestId);
  if (!requestId) throw new Error("معرّف طلب الاستئذان غير صالح.");
  const action = args.status === "approved" ? "approve" : args.status === "rejected" ? "reject" : "cancel";
  const row = await coreApiRequest<Record<string, unknown>>(
    `/api/core/hr/permissions/${encodeURIComponent(requestId)}/${action}`,
    {
      method: "POST",
      body: {
        financialEffect: args.financialEffect,
      },
    }
  );
  return normalizePermissionRequest(row);
}

export async function markPermissionRequestOut(args: {
  requestId: string;
  actorUid: string;
  actorName?: string;
  actualExitTime: string;
}) {
  const requestId = cleanText(args.requestId);
  if (!requestId) throw new Error("معرّف طلب الاستئذان غير صالح.");
  const row = await coreApiRequest<Record<string, unknown>>(
    `/api/core/hr/permissions/${encodeURIComponent(requestId)}/out`,
    {
      method: "POST",
      body: { actualExitTime: cleanText(args.actualExitTime) },
    }
  );
  return normalizePermissionRequest(row);
}

export async function markPermissionRequestReturned(args: {
  requestId: string;
  actorUid: string;
  actorName?: string;
  actualReturnTime: string;
}) {
  const requestId = cleanText(args.requestId);
  if (!requestId) throw new Error("معرّف طلب الاستئذان غير صالح.");
  const row = await coreApiRequest<Record<string, unknown>>(
    `/api/core/hr/permissions/${encodeURIComponent(requestId)}/return`,
    {
      method: "POST",
      body: { actualReturnTime: cleanText(args.actualReturnTime) },
    }
  );
  return normalizePermissionRequest(row);
}

export async function getPermissionPayrollSummary(input: {
  employeeId: string;
  fromDate: string;
  toDate: string;
}) {
  const permissionSummary = await coreApiRequest<{
    employeeId?: string;
    fromDate?: string;
    toDate?: string;
    permissionMinutes?: number;
    unpaidPermissionMinutes?: number;
    entries?: Record<string, unknown>[];
  }>("/api/core/hr/permissions/payroll-summary", {
    query: {
      employeeId: cleanText(input.employeeId),
      from: cleanText(input.fromDate),
      to: cleanText(input.toDate),
    },
  });

  return {
    employeeId: cleanText(permissionSummary.employeeId || input.employeeId),
    fromDate: cleanText(permissionSummary.fromDate || input.fromDate),
    toDate: cleanText(permissionSummary.toDate || input.toDate),
    permissionMinutes: Math.max(0, Number(permissionSummary.permissionMinutes || 0)),
    unpaidPermissionMinutes: Math.max(0, Number(permissionSummary.unpaidPermissionMinutes || 0)),
    entries: Array.isArray(permissionSummary.entries)
      ? permissionSummary.entries.map(normalizePermissionRequest)
      : [],
  };
}
