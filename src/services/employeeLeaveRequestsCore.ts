import {
  createManagedEmployeeRequest,
  listEmployeeRequests as listCoreEmployeeRequests,
  listMyEmployeeRequests,
  type EmployeeRequest as CoreEmployeeRequest,
} from "./employeeRequests";

function cleanText(value: unknown) {
  return String(value || "").trim();
}

export type EmployeeLeaveRequest = {
  id: string;
  employeeUid: string;
  employeeId?: string;
  employeeName?: string;
  type?:
    | "annual"
    | "sick"
    | "emergency"
    | "unpaid"
    | "rest"
    | "weekly_rest_substitute_use"
    | "other";
  fromDate: string;
  toDate: string;
  days?: number;
  durationKind?: "full_day" | "partial";
  partialStartTime?: string;
  partialEndTime?: string;
  note?: string;
  status?: "pending" | "approved" | "rejected" | "cancelled";
  reviewerUid?: string;
  reviewerName?: string;
  createdByUid?: string;
  createdByName?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  reviewedAt?: unknown;
  requestNumber?: string;
  coreStatus?: string;
  coreVersion?: number;
  coreLeaveId?: string;
};

function coreLeaveRequestStatus(status: unknown): EmployeeLeaveRequest["status"] {
  const normalized = cleanText(status).toLowerCase();
  if (normalized === "rejected") return "rejected";
  if (normalized === "cancelled") return "cancelled";
  if (["approved", "executing", "completed"].includes(normalized)) return "approved";
  return "pending";
}

export function mapCoreLeaveRequest(row: CoreEmployeeRequest): EmployeeLeaveRequest {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const fromDate = cleanText(payload.startDate || payload.fromDate);
  const toDate = cleanText(payload.endDate || payload.toDate) || fromDate;
  const explicitDays = Number(payload.days || payload.daysCount);
  let days = Number.isFinite(explicitDays) && explicitDays > 0 ? explicitDays : undefined;
  if (!days && fromDate && toDate) {
    const start = Date.parse(`${fromDate}T12:00:00Z`);
    const end = Date.parse(`${toDate}T12:00:00Z`);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      days = Math.floor((end - start) / 86400000) + 1;
    }
  }
  return {
    id: cleanText(row.id),
    employeeUid: cleanText(row.employee_uid || ""),
    employeeId: cleanText(row.employee_id || "") || undefined,
    employeeName: cleanText(row.employee_name_snapshot || "") || undefined,
    type: (cleanText(payload.leaveType || payload.type || "annual") || "annual") as EmployeeLeaveRequest["type"],
    fromDate,
    toDate,
    days,
    durationKind: cleanText(payload.durationKind).toLowerCase() === "partial" ? "partial" : "full_day",
    partialStartTime: cleanText(payload.partialStartTime || "") || undefined,
    partialEndTime: cleanText(payload.partialEndTime || "") || undefined,
    note: cleanText(payload.reason || payload.note || "") || undefined,
    status: coreLeaveRequestStatus(row.status),
    createdAt: row.submitted_at,
    updatedAt: row.updated_at,
    reviewedAt: row.approved_at || row.rejected_at || undefined,
    requestNumber: cleanText(row.request_number || "") || undefined,
    coreStatus: cleanText(row.status || "") || undefined,
    coreVersion: Number.isInteger(Number(row.version)) ? Number(row.version) : undefined,
    coreLeaveId:
      cleanText(row.source_reference_type || "") === "employee_leave"
        ? cleanText(row.source_reference_id || "") || undefined
        : undefined,
  };
}

export async function createManagedLeaveRequest(input: {
  employeeUid?: string;
  employeeId: string;
  employeeName?: string;
  type?: EmployeeLeaveRequest["type"];
  fromDate: string;
  toDate: string;
  note?: string;
  days?: number;
  durationKind?: "full_day" | "partial";
  partialStartTime?: string;
  partialEndTime?: string;
}) {
  const durationKind = cleanText(input.durationKind).toLowerCase() === "partial" ? "partial" : "full_day";
  const row = await createManagedEmployeeRequest({
    employeeId: cleanText(input.employeeId),
    employeeUid: cleanText(input.employeeUid || "") || undefined,
    employeeName: cleanText(input.employeeName || "") || undefined,
    requestType: "leave",
    title: "طلب إجازة",
    payload: {
      leaveType: cleanText(input.type || "annual") || "annual",
      startDate: cleanText(input.fromDate),
      endDate: cleanText(input.toDate),
      durationKind,
      ...(durationKind === "partial"
        ? {
            partialStartTime: cleanText(input.partialStartTime || ""),
            partialEndTime: cleanText(input.partialEndTime || ""),
          }
        : {}),
      reason: cleanText(input.note || "") || "تسجيل إجازة معتمدة من إدارة الموظفات",
      ...(Number.isFinite(Number(input.days)) && Number(input.days) > 0 ? { days: Number(input.days) } : {}),
    },
  });
  return mapCoreLeaveRequest(row);
}

export async function listLeaveRequestsByEmployee(_employeeUid: string, limitCount = 24) {
  const rows = await listMyEmployeeRequests({ type: "leave", limit: Math.max(1, Number(limitCount || 24)) });
  return rows.map(mapCoreLeaveRequest);
}

export async function listEmployeeLeaveRequests(limitCount = 80): Promise<EmployeeLeaveRequest[]> {
  const rows = await listCoreEmployeeRequests({ type: "leave", limit: Math.max(1, Number(limitCount || 80)) });
  return rows.map(mapCoreLeaveRequest);
}
