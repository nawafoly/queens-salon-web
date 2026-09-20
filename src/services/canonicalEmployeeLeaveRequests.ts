import { CoreHrService } from "./CoreHrService";
import {
  employeeRequestAction,
  getEmployeeRequest,
  type EmployeeRequest,
} from "./employeeRequests";
import type { EmployeeLeaveRequest } from "./employeeHub";

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function requestVersion(request: EmployeeLeaveRequest) {
  const value = Number(request.coreVersion);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("employee_leave_request_version_required");
  }
  return value;
}

function requestCoreStatus(request: EmployeeLeaveRequest) {
  const explicit = cleanText(request.coreStatus).toLowerCase();
  if (explicit) return explicit;
  const legacy = cleanText(request.status).toLowerCase();
  if (legacy === "approved") return "completed";
  if (legacy === "rejected") return "rejected";
  if (legacy === "cancelled") return "cancelled";
  return "submitted";
}

function updateRequestState(
  base: EmployeeLeaveRequest,
  row: EmployeeRequest
): EmployeeLeaveRequest {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const status = cleanText(row.status).toLowerCase();
  return {
    ...base,
    employeeUid: cleanText(row.employee_uid || base.employeeUid),
    employeeId: cleanText(row.employee_id || base.employeeId) || undefined,
    employeeName: cleanText(row.employee_name_snapshot || base.employeeName) || undefined,
    type: (cleanText(payload.leaveType || base.type || "annual") || "annual") as EmployeeLeaveRequest["type"],
    fromDate: cleanText(payload.startDate || base.fromDate),
    toDate: cleanText(payload.endDate || base.toDate),
    durationKind: cleanText(payload.durationKind).toLowerCase() === "partial" ? "partial" : "full_day",
    partialStartTime: cleanText(payload.partialStartTime || base.partialStartTime) || undefined,
    partialEndTime: cleanText(payload.partialEndTime || base.partialEndTime) || undefined,
    note: cleanText(payload.reason || base.note) || undefined,
    status:
      status === "rejected"
        ? "rejected"
        : status === "cancelled"
          ? "cancelled"
          : ["approved", "executing", "completed"].includes(status)
            ? "approved"
            : "pending",
    requestNumber: cleanText(row.request_number || base.requestNumber) || undefined,
    coreStatus: status,
    coreVersion: Number(row.version),
    coreLeaveId:
      cleanText(row.source_reference_type) === "employee_leave"
        ? cleanText(row.source_reference_id) || undefined
        : base.coreLeaveId,
    updatedAt: row.updated_at,
    reviewedAt: row.approved_at || row.rejected_at || base.reviewedAt,
  };
}

export async function refreshCanonicalEmployeeLeaveRequest(
  request: EmployeeLeaveRequest
) {
  const requestId = cleanText(request.id);
  if (!requestId) {
    throw new Error("employee_leave_request_id_required");
  }

  const row = await getEmployeeRequest(requestId);
  return updateRequestState(request, row);
}

async function act(
  request: EmployeeLeaveRequest,
  action: Parameters<typeof employeeRequestAction>[1],
  body: Record<string, unknown> = {}
) {
  const row = await employeeRequestAction(request.id, action, {
    ...body,
    version: requestVersion(request),
  });
  return updateRequestState(request, row);
}

async function moveToReview(request: EmployeeLeaveRequest) {
  let current = request;
  let status = requestCoreStatus(current);

  if (status === "submitted") {
    current = await act(current, "receive");
    status = requestCoreStatus(current);
  }

  if (status === "received") {
    current = await act(current, "start-review");
    status = requestCoreStatus(current);
  }

  if (status === "needs_info") {
    current = await act(current, "answer-info", {
      note: "استكمال المراجعة من إدارة الموظفات",
    });
    status = requestCoreStatus(current);
  }

  if (status === "rejected" || status === "cancelled") {
    current = await act(current, "reopen", {
      note: "إعادة فتح طلب الإجازة من إدارة الموظفات",
    });
  }

  return current;
}

async function findOperationalLeave(request: EmployeeLeaveRequest) {
  const employeeId = cleanText(request.employeeId);
  if (!employeeId) {
    throw new Error("employee_leave_employee_id_required");
  }

  const rows = await CoreHrService.listLeaves({ employeeId });
  return (
    rows.find((leave) => cleanText(leave.requestId) === cleanText(request.id)) ||
    (request.coreLeaveId
      ? rows.find((leave) => cleanText(leave.id) === cleanText(request.coreLeaveId))
      : null) ||
    null
  );
}

export async function decideCanonicalEmployeeLeaveRequest(
  request: EmployeeLeaveRequest,
  nextStatus: "approved" | "rejected" | "cancelled",
  reviewer: {
    reviewerUid: string;
    reviewerName?: string;
    hrNote?: string;
    manualLeavePolicy?: {
      deductFromBalance: boolean;
      affectsPayroll: boolean;
    };
  }
) {
  const requestId = cleanText(request.id);
  const reviewerUid = cleanText(reviewer.reviewerUid);
  const reviewerName = cleanText(reviewer.reviewerName) || "الإدارة";
  const hrNote = cleanText(reviewer.hrNote);

  if (!requestId) throw new Error("employee_leave_request_id_required");
  if (!reviewerUid) throw new Error("employee_leave_reviewer_required");
  if (!Number.isInteger(Number(request.coreVersion))) {
    throw new Error("employee_leave_core_request_required");
  }

  let current = request;
  let status = requestCoreStatus(current);

  if (nextStatus === "approved") {
    if (status !== "completed") {
      current = await moveToReview(current);
      status = requestCoreStatus(current);
    }

    if (status === "under_review") {
      current = await act(current, "approve", {
        note: hrNote || `اعتماد طلب الإجازة بواسطة ${reviewerName}`,
        ...(reviewer.manualLeavePolicy
          ? {
              manualLeavePolicy: {
                deductFromBalance: reviewer.manualLeavePolicy.deductFromBalance === true,
                affectsPayroll: reviewer.manualLeavePolicy.affectsPayroll === true,
              },
            }
          : {}),
      });
      status = requestCoreStatus(current);
    }

    if (status === "approved" || status === "executing") {
      current = await act(current, "execute", {
        note: hrNote || "تنفيذ الإجازة المعتمدة",
        ...(reviewer.manualLeavePolicy
          ? {
              manualLeavePolicy: {
                deductFromBalance: reviewer.manualLeavePolicy.deductFromBalance === true,
                affectsPayroll: reviewer.manualLeavePolicy.affectsPayroll === true,
              },
            }
          : {}),
      });
      status = requestCoreStatus(current);
    }

    if (status !== "completed") {
      throw new Error(`employee_leave_core_request_invalid_status:${status}`);
    }

    const coreLeave = await findOperationalLeave(current);
    if (!coreLeave || cleanText(coreLeave.status).toLowerCase() !== "approved") {
      throw new Error("employee_leave_core_approval_missing");
    }

    return { requestId, request: current, coreLeave };
  }

  if (nextStatus === "rejected") {
    if (status === "rejected") {
      return { requestId, request: current, coreLeave: await findOperationalLeave(current).catch(() => null) };
    }

    if (["approved", "executing", "completed"].includes(status)) {
      current = await act(current, "cancel", {
        note: hrNote || "إلغاء إجازة سبق اعتمادها",
      });
    } else {
      if (status === "submitted") {
        current = await act(current, "receive");
      }
      current = await act(current, "reject", {
        reason: hrNote || "تم رفض طلب الإجازة",
      });
    }

    return { requestId, request: current, coreLeave: await findOperationalLeave(current).catch(() => null) };
  }

  if (status !== "cancelled") {
    current = await act(current, "cancel", {
      note: hrNote || "تم إلغاء طلب الإجازة",
    });
  }

  const coreLeave = await findOperationalLeave(current).catch(() => null);
  if (coreLeave && cleanText(coreLeave.status).toLowerCase() === "approved") {
    throw new Error("employee_leave_core_cancellation_missing");
  }

  return { requestId, request: current, coreLeave };
}
