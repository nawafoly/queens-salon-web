import {
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import {
  calculateLeaveDaysCount,
  getEmployeeLeavePolicy,
} from "../helpers/hr/employeeLeave";

import { CoreHrService } from "./CoreHrService";

import {
  approveEmployeeLeaveRequest,
  reviewLeaveRequest,
  type EmployeeLeaveRequest,
} from "./employeeHub";

import { hrDoc } from "./hrCollections";


function cleanText(value: unknown) {
  return String(value || "").trim();
}


function requestEmployeeId(
  request: EmployeeLeaveRequest
) {
  return cleanText(
    request.employeeId ||
      request.employeeUid
  );
}


async function resolveCoreEmployeeId(
  request: EmployeeLeaveRequest
) {
  const requestedId =
    requestEmployeeId(request);

  if (!requestedId) {
    throw new Error(
      "employee_leave_employee_id_required"
    );
  }

  try {
    const employee =
      await CoreHrService.getEmployee(
        requestedId
      );

    return (
      cleanText(employee.id) ||
      requestedId
    );
  } catch (directError) {
    // Historical/mirrored requests may contain
    // Firebase UID where Core employee_profiles.id is required.
    const candidates = new Set(
      [
        requestedId,
        cleanText(request.employeeId),
        cleanText(request.employeeUid),
      ].filter(Boolean)
    );

    const employees =
      await CoreHrService.listEmployees();

    const matched =
      employees.find((employee) => {
        const row = employee as any;

        return [
          row.id,
          row.employeeId,
          row.firebaseUid,
          row.firebase_uid,
        ]
          .map(cleanText)
          .some((value) =>
            candidates.has(value)
          );
      });

    const canonicalId =
      cleanText((matched as any)?.id);

    if (canonicalId) {
      return canonicalId;
    }

    throw directError;
  }
}


function requestDays(
  request: EmployeeLeaveRequest
) {
  const explicit = Number(request.days);

  if (
    Number.isFinite(explicit) &&
    explicit > 0
  ) {
    return explicit;
  }

  return Number(
    calculateLeaveDaysCount(
      request.fromDate,
      request.toDate
    ) || 0
  );
}


async function findCoreLeaveForRequest(
  employeeId: string,
  requestId: string
) {
  const rows =
    await CoreHrService.listLeaves({
      employeeId,
    });

  return (
    rows.find(
      (leave) =>
        cleanText(leave.requestId) ===
        requestId
    ) || null
  );
}


async function ensureCoreLeaveForRequest(
  request: EmployeeLeaveRequest,
  hrNote: string
) {
  const requestId = cleanText(request.id);

  const employeeId =
    await resolveCoreEmployeeId(request);

  if (!requestId) {
    throw new Error(
      "employee_leave_request_id_required"
    );
  }

  if (!employeeId) {
    throw new Error(
      "employee_leave_employee_id_required"
    );
  }

  const days = requestDays(request);

  if (
    !Number.isFinite(days) ||
    days <= 0
  ) {
    throw new Error(
      "employee_leave_days_invalid"
    );
  }

  // Fail closed. Do not create a shadow employee
  // just to approve a leave request.
  await CoreHrService.getEmployee(
    employeeId
  );

  let coreLeave =
    await findCoreLeaveForRequest(
      employeeId,
      requestId
    );

  if (!coreLeave) {
    const policy =
      getEmployeeLeavePolicy(
        request.type
      );

    try {
      coreLeave =
        await CoreHrService.createLeave({
          employeeId,
          employeeUid:
            cleanText(
              request.employeeUid
            ) || undefined,
          employeeName:
            cleanText(
              request.employeeName
            ) || undefined,

          status: "pending",

          leaveType:
            cleanText(
              request.type
            ) || "annual",

          startDate:
            cleanText(
              request.fromDate
            ),

          endDate:
            cleanText(
              request.toDate
            ),

          daysCount: days,

          durationKind:
            request.durationKind ===
            "partial"
              ? "partial"
              : "full_day",

          partialStartTime:
            request.durationKind ===
            "partial"
              ? cleanText(
                  request.partialStartTime
                ) || undefined
              : undefined,

          partialEndTime:
            request.durationKind ===
            "partial"
              ? cleanText(
                  request.partialEndTime
                ) || undefined
              : undefined,

          requestId,

          deductFromBalance:
            policy.deductFromBalance,

          affectsPayroll:
            policy.affectsPayroll,

          employeeNote:
            cleanText(
              request.note
            ) || undefined,

          hrNote:
            cleanText(hrNote) ||
            undefined,
        });
    } catch (error) {
      // Concurrent/retried approval may have created
      // the same request-linked Core leave already.
      coreLeave =
        await findCoreLeaveForRequest(
          employeeId,
          requestId
        );

      if (!coreLeave) {
        throw error;
      }
    }
  }

  return coreLeave;
}


async function syncRequestMirror(
  requestId: string,
  patch: Record<string, unknown>
) {
  await updateDoc(
    hrDoc(
      "employeeLeaveRequests",
      requestId
    ),
    {
      ...patch,
      updatedAt: serverTimestamp(),
    } as any
  );
}


export async function decideCanonicalEmployeeLeaveRequest(
  request: EmployeeLeaveRequest,
  nextStatus:
    | "approved"
    | "rejected"
    | "cancelled",
  reviewer: {
    reviewerUid: string;
    reviewerName?: string;
    hrNote?: string;
  }
) {
  const requestId =
    cleanText(request.id);

  const reviewerUid =
    cleanText(
      reviewer.reviewerUid
    );

  const reviewerName =
    cleanText(
      reviewer.reviewerName
    ) || "الإدارة";

  const hrNote =
    cleanText(reviewer.hrNote);

  if (!requestId) {
    throw new Error(
      "employee_leave_request_id_required"
    );
  }

  if (!reviewerUid) {
    throw new Error(
      "employee_leave_reviewer_required"
    );
  }

  const employeeId =
    await resolveCoreEmployeeId(request);

  if (!employeeId) {
    throw new Error(
      "employee_leave_employee_id_required"
    );
  }


  // =====================================================
  // APPROVE
  // Core first. Firestore is only the request/UI mirror.
  // =====================================================

  if (nextStatus === "approved") {
    let coreLeave =
      await ensureCoreLeaveForRequest(
        request,
        hrNote
      );

    const coreStatus =
      cleanText(
        coreLeave.status
      ).toLowerCase();

    if (coreStatus === "pending") {
      coreLeave =
        await CoreHrService.decideLeave(
          coreLeave.id,
          "approved",
          hrNote ||
            "اعتماد طلب إجازة الموظفة"
        );
    } else if (
      coreStatus !== "approved"
    ) {
      throw new Error(
        `employee_leave_core_invalid_status:${coreStatus}`
      );
    }

    // Only after Core operational approval succeeds
    // may the request mirror become approved.
    await approveEmployeeLeaveRequest({
      requestId,
      reviewerUid,
      reviewerName,
    });

    const policy =
      getEmployeeLeavePolicy(
        request.type
      );

    await syncRequestMirror(
      requestId,
      {
        coreLeaveId: coreLeave.id,
        deductFromBalance:
          policy.deductFromBalance,
        affectsPayroll:
          policy.affectsPayroll,
        hrNote: hrNote || undefined,
      }
    );

    return {
      requestId,
      coreLeave,
    };
  }


  const existingCoreLeave =
    await findCoreLeaveForRequest(
      employeeId,
      requestId
    );


  // =====================================================
  // CANCEL
  //
  // An approved request MUST have Core operational state.
  // Rejection of approved Core leave is its canonical
  // cancellation/reversal path.
  // =====================================================

  if (nextStatus === "cancelled") {
    if (
      cleanText(
        request.status
      ).toLowerCase() === "approved" &&
      !existingCoreLeave
    ) {
      throw new Error(
        "employee_leave_core_record_missing"
      );
    }

    if (existingCoreLeave) {
      const coreStatus =
        cleanText(
          existingCoreLeave.status
        ).toLowerCase();

      if (
        coreStatus === "approved" ||
        coreStatus === "pending"
      ) {
        await CoreHrService.decideLeave(
          existingCoreLeave.id,
          "rejected",
          hrNote ||
            "إلغاء طلب الإجازة"
        );
      } else if (
        coreStatus !== "rejected"
      ) {
        throw new Error(
          `employee_leave_core_invalid_status:${coreStatus}`
        );
      }
    }

    await reviewLeaveRequest({
      requestId,
      status: "cancelled",
      reviewerUid,
      reviewerName,
    });

    if (existingCoreLeave) {
      await syncRequestMirror(
        requestId,
        {
          coreLeaveId:
            existingCoreLeave.id,
          hrNote:
            hrNote || undefined,
        }
      );
    }

    return {
      requestId,
      coreLeave:
        existingCoreLeave,
    };
  }


  // =====================================================
  // REJECT
  //
  // Usually no Core leave exists yet.
  // If a previous partial/retried approval created one,
  // reject/reverse Core first before changing the mirror.
  // =====================================================

  if (existingCoreLeave) {
    const coreStatus =
      cleanText(
        existingCoreLeave.status
      ).toLowerCase();

    if (
      coreStatus === "pending" ||
      coreStatus === "approved"
    ) {
      await CoreHrService.decideLeave(
        existingCoreLeave.id,
        "rejected",
        hrNote ||
          "رفض طلب الإجازة"
      );
    } else if (
      coreStatus !== "rejected"
    ) {
      throw new Error(
        `employee_leave_core_invalid_status:${coreStatus}`
      );
    }
  }

  await reviewLeaveRequest({
    requestId,
    status: "rejected",
    reviewerUid,
    reviewerName,
  });

  if (existingCoreLeave) {
    await syncRequestMirror(
      requestId,
      {
        coreLeaveId:
          existingCoreLeave.id,
        hrNote:
          hrNote || undefined,
      }
    );
  }

  return {
    requestId,
    coreLeave:
      existingCoreLeave,
  };
}