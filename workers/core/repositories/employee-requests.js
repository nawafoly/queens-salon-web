// CORE D1 ONLY — Saudi labor compliance guard around the legacy request workflow.
// Existing historical request records remain readable/auditable. New requests
// cannot enter legally-invalid leave-cash or ambiguous leave-type paths.

import {
  cleanText,
  dbFirst,
} from '../d1.js';
import { AppError } from '../errors.js';
import { requireExplicitSaLeaveType } from './leaves.js';
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

  if (
    requestType === 'overtime' &&
    action === 'execute'
  ) {
    return {
      allowed: false,
      code: 'core_employee_request:overtime_statutory_runtime_required',
    };
  }

  return { allowed: true, code: null };
}

function assertGate(requestType, action = '') {
  const gate = employeeRequestComplianceGate(requestType, action);
  if (!gate.allowed) {
    throw new AppError(409, gate.code);
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
    `SELECT request_type, status, source_reference_id
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
  assertGate(row.request_type, actionKey);

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
