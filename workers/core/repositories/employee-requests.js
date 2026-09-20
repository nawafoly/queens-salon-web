// CORE D1 ONLY — Saudi labor compliance guard around the legacy request workflow.
// Existing historical request records remain readable/auditable. New requests
// cannot enter legally-invalid leave-cash or ambiguous leave-type paths.

import {
  cleanText,
  dbFirst,
} from '../d1.js';
import { AppError } from '../errors.js';
import {
  leaveDecisionRuntime,
  requireExplicitSaLeaveType,
} from './leaves.js';
import { executeStatutoryOvertimeRequest } from './employee-request-overtime.js';
import { createSalaryCertificateRequest } from './salary-certificate-requests.js';
import {
  createEmployeeRequest as legacyCreateEmployeeRequest,
  transitionEmployeeRequest as legacyTransitionEmployeeRequest,
} from './employee-requests-legacy.js';

export * from './employee-requests-legacy.js';

function parsePayload(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...value };
  }
  try {
    const parsed = JSON.parse(cleanText(value) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

function normalizeManualLeavePolicy(input = {}) {
  const manualPolicy =
    input?.manualLeavePolicy && typeof input.manualLeavePolicy === 'object'
      ? input.manualLeavePolicy
      : input?.manual_leave_policy && typeof input.manual_leave_policy === 'object'
        ? input.manual_leave_policy
        : null;

  if (!manualPolicy) return null;

  const deductFromBalance =
    manualPolicy.deductFromBalance ?? manualPolicy.deduct_from_balance;
  const affectsPayroll =
    manualPolicy.affectsPayroll ?? manualPolicy.affects_payroll;

  if (
    typeof deductFromBalance !== 'boolean' ||
    typeof affectsPayroll !== 'boolean'
  ) {
    return null;
  }

  return {
    deductFromBalance,
    affectsPayroll,
  };
}

function riyadhMonthKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date()).slice(0, 7);
}

function normalizeSalaryAdvanceExecution(payload, input = {}) {
  const requestedHalalas = Number(payload.amountHalalas || 0);
  const approvedHalalas = input.approvedHalalas !== undefined
    ? Number(input.approvedHalalas)
    : input.approvedAmount !== undefined
      ? Math.round(Number(input.approvedAmount) * 100)
      : requestedHalalas;

  if (!Number.isInteger(requestedHalalas) || requestedHalalas <= 0) {
    throw new AppError(409, 'core_employee_request:salary_advance_request_amount_invalid');
  }
  if (!Number.isInteger(approvedHalalas) || approvedHalalas <= 0) {
    throw new AppError(400, 'core_employee_request:invalid_approved_amount');
  }
  if (approvedHalalas > requestedHalalas) {
    throw new AppError(409, 'core_employee_request:salary_advance_approval_exceeds_request');
  }

  const firstDeductionMonth = cleanText(input.firstDeductionMonth) || riyadhMonthKey();
  if (!/^\d{4}-\d{2}$/.test(firstDeductionMonth)) {
    throw new AppError(400, 'core_employee_request:invalid_first_deduction_month');
  }
  if (firstDeductionMonth < riyadhMonthKey()) {
    throw new AppError(409, 'core_employee_request:salary_advance_deduction_month_in_past');
  }

  return {
    ...input,
    approvedHalalas,
    firstDeductionMonth,
  };
}

function assertSalaryCertificateApproval(input = {}) {
  const payload = parsePayload(input.payload);
  const signerName = cleanText(payload.reviewerName || payload.certificateSignerName);
  const signature = cleanText(payload.reviewerSignatureDataUrl);
  if (!signerName) {
    throw new AppError(400, 'core_employee_request:salary_certificate_reviewer_name_required');
  }
  if (!signature.startsWith('data:image/') || !signature.includes(';base64,') || signature.length < 200) {
    throw new AppError(400, 'core_employee_request:salary_certificate_reviewer_signature_required');
  }
}

export function employeeRequestComplianceGate(
  requestTypeValue,
  actionValue = ''
) {
  const requestType = cleanText(requestTypeValue).toLowerCase();
  const action = cleanText(actionValue).toLowerCase();

  if (requestType === 'exceptional_financial_payment') {
    if (!action || ['approve', 'execute'].includes(action)) {
      return {
        allowed: false,
        code: 'core_employee_request:annual_leave_cash_substitution_during_service_not_allowed',
      };
    }
  }

  return { allowed: true, code: null };
}

function assertGate(requestType, action = '') {
  const gate = employeeRequestComplianceGate(requestType, action);
  if (!gate.allowed) {
    throw new AppError(409, gate.code);
  }
}

function assertLeaveRequestDecisionAllowed(
  payload,
  actionKey,
  input = {},
  options = {}
) {
  if (!['approve', 'execute'].includes(actionKey)) return;

  const resolved = requireExplicitSaLeaveType(payload);
  const runtime = leaveDecisionRuntime(
    {
      leave_type: resolved.leaveType,
      status: 'pending',
    },
    'approved'
  );

  if (runtime === 'hr_review_block') {
    const manualPolicy = normalizeManualLeavePolicy(input);
    const manualPolicyResolved =
      options.manualLeavePolicyAuthorized === true &&
      manualPolicy !== null;

    if (!manualPolicyResolved) {
      throw new AppError(
        409,
        'core_leave:hr_review_resolution_required'
      );
    }
    return;
  }
  if (runtime === 'entitlement_consumption_block') {
    throw new AppError(
      409,
      'core_leave:entitlement_consumption_runtime_required'
    );
  }
  if (runtime === 'statutory_validation_block') {
    throw new AppError(
      409,
      'core_leave:statutory_validation_required'
    );
  }
}

export async function getExceptionalFinancialPaymentPreview() {
  assertGate('exceptional_financial_payment');
}

export async function createEmployeeRequest(
  db,
  salonId,
  data = {},
  actor = {}
) {
  const requestType = cleanText(
    data.requestType || data.request_type
  ).toLowerCase();

  assertGate(requestType);

  if (requestType === 'salary_certificate') {
    return createSalaryCertificateRequest(db, salonId, data, actor);
  }

  if (requestType !== 'leave') {
    return legacyCreateEmployeeRequest(
      db,
      salonId,
      data,
      actor
    );
  }

  const payload = parsePayload(
    data.payload ?? data.payload_json ?? data
  );
  const resolved = requireExplicitSaLeaveType(payload);
  const nextPayload = {
    ...payload,
    leaveType: resolved.leaveType,
  };

  return legacyCreateEmployeeRequest(
    db,
    salonId,
    {
      ...data,
      payload: nextPayload,
      payload_json: undefined,
    },
    actor
  );
}

export async function transitionEmployeeRequest(
  db,
  salonId,
  idValue,
  action,
  input = {},
  actor = {},
  options = {}
) {
  const row = await dbFirst(
    db,
    `SELECT request_type, status, source_reference_id, payload_json
       FROM employee_requests
      WHERE salon_id = ?
        AND id = ?
      LIMIT 1`,
    [salonId, cleanText(idValue)]
  );

  if (!row) {
    throw new AppError(404, 'core_employee_request:not_found');
  }

  const actionKey = cleanText(action).toLowerCase();
  const requestType = cleanText(row.request_type).toLowerCase();
  assertGate(requestType, actionKey);

  if (requestType === 'salary_certificate' && actionKey === 'approve') {
    assertSalaryCertificateApproval(input);
  }

  if (requestType === 'leave') {
    assertLeaveRequestDecisionAllowed(
      parsePayload(row.payload_json),
      actionKey,
      input,
      options
    );
  }

  if (
    requestType === 'leave' &&
    actionKey === 'execute'
  ) {
    const requestPayload = parsePayload(row.payload_json);
    if (cleanText(requestPayload.leaveType).toLowerCase() === 'sick') {
      const approvalEvent = await dbFirst(
        db,
        `SELECT payload_json
           FROM employee_request_events
          WHERE salon_id = ?
            AND request_id = ?
            AND event_type IN ('approve', 'approved')
          ORDER BY created_at DESC
          LIMIT 1`,
        [salonId, cleanText(idValue)]
      );
      const approvalPayload = parsePayload(approvalEvent?.payload_json);
      if (approvalPayload.documentationVerified !== true) {
        throw new AppError(409, 'core_sick_leave:documentation_verification_required');
      }
      options = { ...options, leaveDecision: { documentationVerified: true, documentationStatus: 'verified' } };
    }
  }

  if (
    requestType === 'overtime' &&
    actionKey === 'execute'
  ) {
    if (options.ownOnly) {
      throw new AppError(
        403,
        'core_employee_request:employee_action_forbidden'
      );
    }
    return executeStatutoryOvertimeRequest(
      db,
      salonId,
      idValue,
      input,
      actor
    );
  }

  if (
    requestType === 'salary_advance' &&
    actionKey === 'execute'
  ) {
    if (options.ownOnly) {
      throw new AppError(
        403,
        'core_employee_request:employee_action_forbidden'
      );
    }
    input = normalizeSalaryAdvanceExecution(
      parsePayload(row.payload_json),
      input
    );
  }

  return legacyTransitionEmployeeRequest(
    db,
    salonId,
    idValue,
    action,
    input,
    actor,
    options
  );
}
