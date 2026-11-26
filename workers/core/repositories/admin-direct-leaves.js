import {
  cleanText,
  dbFirst,
  validDate,
  requiredId,
} from '../d1.js';

import { AppError } from '../errors.js';

import {
  createLeave,
  decideLeave,
  requireExplicitSaLeaveType,
} from './leaves.js';

import {
  requireFinalLeaveAuthority,
} from './approval-authorities.js';

async function findRegistration(db, salonId, operationId) {
  return dbFirst(
    db,
    `SELECT *
       FROM employee_leaves
      WHERE salon_id = ?
        AND registration_operation_id = ?
      LIMIT 1`,
    [salonId, operationId]
  );
}

function assertMatchingRegistration(row, expected) {
  if (
    row.registration_source !== 'admin_direct' ||
    row.registered_by_uid !== expected.actorUid ||
    row.employee_id !== expected.employeeId ||
    row.leave_type !== expected.leaveType ||
    row.start_date !== expected.startDate ||
    (
      row.leave_type === 'annual'
        ? cleanText(row.annual_original_end_date) || row.end_date
        : row.end_date
    ) !== expected.endDate ||
    row.duration_kind !== 'full_day' ||
    cleanText(row.employee_note) !== expected.reason ||
    (
      expected.manualPolicy &&
      row.legal_basis === 'HR_MANUAL_POLICY' &&
      (
        Number(row.deduct_from_balance) !==
          Number(expected.manualPolicy.deductFromBalance) ||
        Number(row.affects_payroll) !==
          Number(expected.manualPolicy.affectsPayroll)
      )
    )
  ) {
    throw new AppError(
      409,
      'core_leave:registration_operation_conflict'
    );
  }
}

export async function registerAdminDirectLeave(
  db,
  salonId,
  input = {},
  actor = {},
  options = {}
) {
  const actorUid = cleanText(actor.uid);

  if (!actorUid || !cleanText(actor.userId)) {
    throw new AppError(
      403,
      'core_leave:authenticated_admin_required'
    );
  }

  const employeeId = requiredId(
    input.employeeId,
    'employeeId'
  );

  const operationId = requiredId(
    input.operationId,
    'operationId'
  );

  if (operationId.length > 128) {
    throw new AppError(
      400,
      'core_leave:invalid_registration_context'
    );
  }

  await requireFinalLeaveAuthority(
    db,
    salonId,
    actor,
    employeeId
  );

  const employee = await dbFirst(
    db,
    `SELECT p.id, p.name, p.firebase_uid
       FROM employee_profiles p
       JOIN employee_employment e
         ON e.salon_id = p.salon_id
        AND e.employee_id = p.id
      WHERE p.salon_id = ?
        AND p.id = ?
        AND p.status = 'active'
        AND e.employment_status = 'active'
      LIMIT 1`,
    [salonId, employeeId]
  );

  if (!employee) {
    throw new AppError(
      404,
      'core_leave:employee_employment_not_found'
    );
  }

  if (
    cleanText(employee.firebase_uid) &&
    cleanText(employee.firebase_uid) === actorUid
  ) {
    throw new AppError(
      403,
      'core_approval_authority:self_approval_forbidden'
    );
  }

  const resolved = requireExplicitSaLeaveType(input);

  // Initially connect only leave types with a fully
  // established canonical approval runtime.
  const supportedTypes = new Set([
    'annual',
    'emergency',
    'sick',
    'unpaid',
    'weekly_rest_substitute_use',
    'other_hr_review',
  ]);

  if (!supportedTypes.has(resolved.leaveType)) {
    throw new AppError(
      409,
      'core_leave:admin_direct_type_requires_review'
    );
  }

  if (
    cleanText(input.durationKind || 'full_day') !== 'full_day' ||
    input.requestId ||
    input.request_id
  ) {
    throw new AppError(
      400,
      'core_leave:invalid_admin_direct_leave'
    );
  }

  const isManualLeave =
    resolved.leaveType === 'other_hr_review';

  const suppliedPolicy = input.manualLeavePolicy;

  if (
    isManualLeave &&
    (
      !suppliedPolicy ||
      typeof suppliedPolicy.deductFromBalance !== 'boolean' ||
      typeof suppliedPolicy.affectsPayroll !== 'boolean'
    )
  ) {
    throw new AppError(
      400,
      'core_leave:explicit_manual_policy_required'
    );
  }

  if (!isManualLeave && suppliedPolicy != null) {
    throw new AppError(
      400,
      'core_leave:manual_policy_type_mismatch'
    );
  }

  const manualPolicy = isManualLeave
    ? {
        deductFromBalance:
          suppliedPolicy.deductFromBalance,
        affectsPayroll:
          suppliedPolicy.affectsPayroll,
      }
    : null;

  const startDate = validDate(
    input.startDate,
    'startDate'
  );

  const endDate = validDate(
    input.endDate,
    'endDate'
  );

  const days =
    Math.floor(
      (
        Date.parse(`${endDate}T12:00:00Z`) -
        Date.parse(`${startDate}T12:00:00Z`)
      ) / 86400000
    ) + 1;

  if (
    !Number.isInteger(days) ||
    days < 1 ||
    days > 366
  ) {
    throw new AppError(
      400,
      'core_leave:invalid_range'
    );
  }

  const reason = cleanText(input.reason);

  if (!reason || reason.length > 2000) {
    throw new AppError(
      400,
      'core_leave:registration_reason_required'
    );
  }

  const expected = {
    employeeId,
    actorUid,
    leaveType: resolved.leaveType,
    startDate,
    endDate,
    reason,
    manualPolicy,
  };

  let leave = await findRegistration(
    db,
    salonId,
    operationId
  );

  if (leave) {
    assertMatchingRegistration(leave, expected);
  } else {
    const overlap = await dbFirst(
      db,
      `SELECT id
         FROM employee_leaves
        WHERE salon_id = ?
          AND employee_id = ?
          AND status IN ('pending', 'approved')
          AND start_date <= ?
          AND end_date >= ?
        LIMIT 1`,
      [salonId, employeeId, endDate, startDate]
    );

    if (overlap) {
      throw new AppError(
        409,
        'core_leave:admin_direct_overlap'
      );
    }

    try {
      leave = await createLeave(
        db,
        salonId,
        {
          employeeId,
          employeeName: employee.name,
          employeeUid: employee.firebase_uid || null,
          leaveType: resolved.leaveType,
          startDate,
          endDate,
          daysCount: days,
          durationKind: 'full_day',
          employeeNote: reason,
          hrNote: reason,
        },
        actor,
        {
          registration: {
            source: 'admin_direct',
            operationId,
          },
          manualPolicy,
        }
      );
    } catch (error) {
      const existing = await findRegistration(
        db,
        salonId,
        operationId
      );

      if (!existing) {
        if (/admin_direct_leave_overlap/i.test(
          String(error?.message || '')
        )) {
          throw new AppError(
            409,
            'core_leave:admin_direct_overlap'
          );
        }

        throw error;
      }

      assertMatchingRegistration(existing, expected);

      // The registration and canonical policy now share
      // one INSERT. Recover only the matching persisted
      // operation, then validate its policy below.
      leave = existing;
    }
  }

  if (!['pending', 'approved'].includes(leave.status)) {
    throw new AppError(
      409,
      'core_leave:invalid_transition'
    );
  }

  if (!leave.policy_version || !leave.legal_basis) {
    throw new AppError(
      409,
      'core_leave:registration_requires_recovery'
    );
  }

  if (
    manualPolicy &&
    (
      leave.legal_basis !== 'HR_MANUAL_POLICY' ||
      Number(leave.statutory_review_required) !== 0 ||
      Number(leave.deduct_from_balance) !==
        Number(manualPolicy.deductFromBalance) ||
      Number(leave.affects_payroll) !==
        Number(manualPolicy.affectsPayroll)
    )
  ) {
    throw new AppError(
      409,
      'core_leave:registration_requires_recovery'
    );
  }

  // Check authority again before financial execution.
  await requireFinalLeaveAuthority(
    db,
    salonId,
    actor,
    employeeId
  );

  return decideLeave(
    db,
    salonId,
    leave.id,
    {
      status: 'approved',
      hrNote: reason,
    },
    actor,
    {
      externalAttendanceDb:
        options.externalAttendanceDb || null,
      manualHrReviewResolved: manualPolicy !== null,
    }
  );
}
