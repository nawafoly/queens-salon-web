// CORE D1 ONLY — canonical Saudi leave runtime dispatcher.
// The legacy repository remains available only for storage/lifecycle operations
// that do not own statutory entitlement calculations.

import {
  cleanText,
  dbFirst,
  dbRun,
} from '../d1.js';
import { AppError } from '../errors.js';
import {
  SA_LEAVE_TYPES,
  getSaLeaveTypePolicy,
  normalizeSaLeaveType,
} from '../../../src/helpers/hr/saLeaveEntitlements.js';
import {
  listLeaves as legacyListLeaves,
  createLeave as legacyCreateLeave,
  decideLeave as legacyDecideLeave,
} from './leaves-legacy.js';
import { approveAnnualLeave } from './annual-leave.js';
import { cancelApprovedAnnualLeave } from './annual-leave-cancellation.js';
import {
  approveSickLeave,
  cancelApprovedSickLeave,
} from './sick-leave.js';
import {
  approveTimeEntitlementLeave,
  cancelTimeEntitlementLeave,
} from './leave-time-entitlements.js';
import { WEEKLY_REST_MINUTES } from './weekly-rest-entitlements.js';
import {
  approveSpecialStatutoryLeave,
  cancelSpecialStatutoryLeave,
  specialStatutoryLeaveRuntimeSupport,
} from './special-statutory-leave.js';
import {
  approveSensitiveFamilyLeave,
  cancelSensitiveFamilyLeave,
} from './sensitive-family-leave.js';
import { annualLeavePublicHolidayExtension } from './public-holiday-overlap.js';

const DETERMINISTIC_SPECIAL_TYPES = new Set([
  SA_LEAVE_TYPES.marriage,
  SA_LEAVE_TYPES.bereavementSpouseAscendantDescendant,
  SA_LEAVE_TYPES.bereavementSibling,
  SA_LEAVE_TYPES.newborn,
  SA_LEAVE_TYPES.hajj,
  SA_LEAVE_TYPES.exam,
]);

const SENSITIVE_FAMILY_TYPES = new Set([
  SA_LEAVE_TYPES.maternity,
  SA_LEAVE_TYPES.childMedicalCare,
  SA_LEAVE_TYPES.widowMuslim,
  SA_LEAVE_TYPES.widowNonMuslim,
]);

const CANONICAL_APPROVAL_TYPES = new Set([
  SA_LEAVE_TYPES.annual,
  SA_LEAVE_TYPES.sick,
  SA_LEAVE_TYPES.overtimeCompTimeUse,
  SA_LEAVE_TYPES.weeklyRestSubstituteUse,
  ...DETERMINISTIC_SPECIAL_TYPES,
  ...SENSITIVE_FAMILY_TYPES,
]);

const LEGACY_SAFE_APPROVAL_TYPES = new Set([
  SA_LEAVE_TYPES.unpaid,
]);

const ENTITLEMENT_CONSUMPTION_TYPES = new Set([
  SA_LEAVE_TYPES.overtimeCompTimeUse,
  SA_LEAVE_TYPES.weeklyRestSubstituteUse,
]);

const STATUTORY_VALIDATION_TYPES = new Set([
  SA_LEAVE_TYPES.marriage,
  SA_LEAVE_TYPES.bereavementSpouseAscendantDescendant,
  SA_LEAVE_TYPES.bereavementSibling,
  SA_LEAVE_TYPES.newborn,
  SA_LEAVE_TYPES.hajj,
  SA_LEAVE_TYPES.exam,
  ...SENSITIVE_FAMILY_TYPES,
]);

function legalBasisForLeaveType(leaveType) {
  switch (leaveType) {
    case SA_LEAVE_TYPES.annual:
      return 'SA_LABOR_ARTICLE_109';
    case SA_LEAVE_TYPES.sick:
      return 'SA_LABOR_ARTICLE_117';
    case SA_LEAVE_TYPES.unpaid:
      return 'SA_LABOR_UNPAID_LEAVE';
    case SA_LEAVE_TYPES.marriage:
    case SA_LEAVE_TYPES.bereavementSpouseAscendantDescendant:
    case SA_LEAVE_TYPES.bereavementSibling:
    case SA_LEAVE_TYPES.newborn:
      return 'SA_LABOR_ARTICLE_113';
    case SA_LEAVE_TYPES.hajj:
      return 'SA_LABOR_ARTICLE_114';
    case SA_LEAVE_TYPES.exam:
      return 'SA_LABOR_ARTICLE_115';
    case SA_LEAVE_TYPES.maternity:
    case SA_LEAVE_TYPES.childMedicalCare:
      return 'SA_LABOR_ARTICLE_151';
    case SA_LEAVE_TYPES.widowMuslim:
    case SA_LEAVE_TYPES.widowNonMuslim:
      return 'SA_LABOR_ARTICLE_160';
    case SA_LEAVE_TYPES.overtimeCompTimeUse:
      return 'SA_LABOR_OVERTIME_COMP_TIME';
    case SA_LEAVE_TYPES.weeklyRestSubstituteUse:
      return 'SA_LABOR_WEEKLY_REST_SUBSTITUTE';
    default:
      return 'HR_REVIEW_REQUIRED';
  }
}

function validClockMinutes(value, field) {
  const text = cleanText(value);
  const match = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (!match) {
    throw new AppError(400, `core_leave:invalid_${field}`);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new AppError(400, `core_leave:invalid_${field}`);
  }
  return hour * 60 + minute;
}

function explicitEntitlementMinutes(data = {}) {
  const raw = data.entitlementMinutes ?? data.entitlement_minutes;
  if (raw === undefined || raw === null || raw === '') return null;
  const minutes = Number(raw);
  if (!Number.isInteger(minutes) || minutes <= 0 || minutes > 60 * 24 * 366) {
    throw new AppError(400, 'core_leave:invalid_entitlement_minutes');
  }
  return minutes;
}

function timeEntitlementRequestMinutes(data, leaveType) {
  if (!ENTITLEMENT_CONSUMPTION_TYPES.has(leaveType)) return 0;

  const durationKind = cleanText(
    data.durationKind ?? data.duration_kind ?? 'full_day'
  ).toLowerCase() === 'partial'
    ? 'partial'
    : 'full_day';
  const explicit = explicitEntitlementMinutes(data);

  if (leaveType === SA_LEAVE_TYPES.weeklyRestSubstituteUse) {
    const startDate = cleanText(data.startDate ?? data.start_date);
    const endDate = cleanText(data.endDate ?? data.end_date);
    if (durationKind !== 'full_day' || !startDate || startDate !== endDate) {
      throw new AppError(409, 'core_leave:weekly_rest_requires_single_full_day');
    }
    if (explicit != null && explicit !== WEEKLY_REST_MINUTES) {
      throw new AppError(409, 'core_leave:weekly_rest_requires_24h_block');
    }
    return WEEKLY_REST_MINUTES;
  }

  if (durationKind === 'partial') {
    const from = validClockMinutes(
      data.partialStartTime ?? data.partial_start_time,
      'partial_start_time'
    );
    const to = validClockMinutes(
      data.partialEndTime ?? data.partial_end_time,
      'partial_end_time'
    );
    if (to <= from) {
      throw new AppError(400, 'core_leave:invalid_partial_range');
    }
    const derived = to - from;
    if (explicit != null && explicit !== derived) {
      throw new AppError(409, 'core_leave:entitlement_minutes_mismatch');
    }
    return derived;
  }

  if (explicit == null) {
    throw new AppError(409, 'core_leave:overtime_comp_minutes_required');
  }
  return explicit;
}

export function requireExplicitSaLeaveType(data = {}) {
  const raw = cleanText(
    data.leaveType ?? data.leave_type
  ).toLowerCase();

  if (!raw) {
    throw new AppError(
      400,
      'core_leave:leave_type_required',
      'leaveType is required'
    );
  }

  const leaveType = normalizeSaLeaveType(raw);
  const policy = getSaLeaveTypePolicy(raw);

  return {
    rawLeaveType: raw,
    leaveType,
    policy,
  };
}

export function leaveDecisionRuntime(leave, requestedStatus) {
  const leaveType = normalizeSaLeaveType(leave?.leave_type);
  const currentStatus = cleanText(leave?.status).toLowerCase();
  const status = cleanText(requestedStatus).toLowerCase();

  if (!['approved', 'rejected'].includes(status)) {
    throw new AppError(400, 'core_leave:invalid_decision');
  }

  if (status === 'approved') {
    if (leaveType === SA_LEAVE_TYPES.annual) return 'annual_approve';
    if (leaveType === SA_LEAVE_TYPES.sick) return 'sick_approve';
    if (ENTITLEMENT_CONSUMPTION_TYPES.has(leaveType)) {
      return 'time_entitlement_approve';
    }
    if (leaveType === SA_LEAVE_TYPES.otherHrReview) return 'hr_review_block';
    if (DETERMINISTIC_SPECIAL_TYPES.has(leaveType)) {
      return 'special_statutory_approve';
    }
    if (SENSITIVE_FAMILY_TYPES.has(leaveType)) {
      return 'sensitive_family_approve';
    }
    if (STATUTORY_VALIDATION_TYPES.has(leaveType)) {
      return 'statutory_validation_block';
    }
    if (LEGACY_SAFE_APPROVAL_TYPES.has(leaveType)) return 'legacy_safe';
    return 'hr_review_block';
  }

  if (currentStatus === 'approved') {
    if (leaveType === SA_LEAVE_TYPES.annual) return 'annual_cancel';
    if (leaveType === SA_LEAVE_TYPES.sick) return 'sick_cancel';
    if (ENTITLEMENT_CONSUMPTION_TYPES.has(leaveType)) {
      return 'time_entitlement_cancel';
    }
    if (DETERMINISTIC_SPECIAL_TYPES.has(leaveType)) {
      return 'special_statutory_cancel';
    }
    if (SENSITIVE_FAMILY_TYPES.has(leaveType)) {
      return 'sensitive_family_cancel';
    }
  }

  return 'legacy_safe';
}

async function leaveById(db, salonId, id) {
  return dbFirst(
    db,
    `SELECT *
       FROM employee_leaves
      WHERE salon_id = ?
        AND id = ?
      LIMIT 1`,
    [salonId, id]
  );
}

export async function listLeaves(db, salonId, query = {}) {
  return legacyListLeaves(db, salonId, query);
}

export async function createLeave(
  db,
  salonId,
  data = {},
  actor = {}
) {
  const resolved = requireExplicitSaLeaveType(data);
  const entitlementMinutesRequested = timeEntitlementRequestMinutes(
    data,
    resolved.leaveType
  );
  const created = await legacyCreateLeave(
    db,
    salonId,
    {
      ...data,
      leaveType: resolved.leaveType,
      leave_type: resolved.leaveType,
    },
    actor
  );

  const documentationStatus = resolved.policy.documentationRequired
    ? 'required'
    : 'not_required';

  await dbRun(
    db,
    `UPDATE employee_leaves
        SET policy_version = ?,
            balance_bucket = ?,
            legal_basis = ?,
            documentation_status = ?,
            statutory_review_required = ?,
            deduct_from_balance = ?,
            affects_payroll = ?,
            entitlement_minutes_requested = ?,
            updated_at = ?
      WHERE salon_id = ?
        AND id = ?
        AND status = 'pending'`,
    [
      resolved.policy.policyVersion || null,
      resolved.policy.entitlementBucket || null,
      legalBasisForLeaveType(resolved.leaveType),
      documentationStatus,
      resolved.policy.reviewRequired ? 1 : 0,
      resolved.policy.deductAnnualBalance ? 1 : 0,
      resolved.policy.affectsPayroll ? 1 : 0,
      entitlementMinutesRequested,
      created.updated_at,
      salonId,
      created.id,
    ]
  );

  return (
    await leaveById(db, salonId, created.id)
  ) || created;
}

export async function decideLeave(
  db,
  salonId,
  idValue,
  decision = {},
  actor = {}
) {
  const id = cleanText(idValue);
  if (!id) {
    throw new AppError(400, 'core_leave:invalid_leave_id');
  }

  const leave = await leaveById(db, salonId, id);
  if (!leave) {
    throw new AppError(404, 'core_leave:not_found');
  }

  const requestedStatus = cleanText(decision.status).toLowerCase();
  if (cleanText(leave.status).toLowerCase() === requestedStatus) {
    return {
      ...leave,
      idempotent: true,
    };
  }

  const runtime = leaveDecisionRuntime(leave, requestedStatus);

  switch (runtime) {
    case 'annual_approve': {
      const overlap = await annualLeavePublicHolidayExtension(
        db,
        salonId,
        leave
      );
      const approved = await approveAnnualLeave(
        db,
        salonId,
        overlap.leave,
        decision,
        actor
      );
      return {
        ...approved,
        publicHolidayOverlap: {
          originalEndDate: overlap.originalEndDate,
          effectiveEndDate: overlap.effectiveEndDate,
          overlapDays: overlap.overlapDays,
          holidays: overlap.holidays,
        },
      };
    }

    case 'annual_cancel':
      return cancelApprovedAnnualLeave(
        db,
        salonId,
        leave,
        decision,
        actor
      );

    case 'sick_approve':
      return approveSickLeave(
        db,
        salonId,
        leave,
        decision,
        actor
      );

    case 'sick_cancel':
      return cancelApprovedSickLeave(
        db,
        salonId,
        leave,
        decision,
        actor
      );

    case 'time_entitlement_approve':
      return approveTimeEntitlementLeave(
        db,
        salonId,
        leave,
        decision,
        actor
      );

    case 'time_entitlement_cancel':
      return cancelTimeEntitlementLeave(
        db,
        salonId,
        leave,
        decision,
        actor
      );

    case 'special_statutory_approve':
      return approveSpecialStatutoryLeave(
        db,
        salonId,
        leave,
        decision,
        actor
      );

    case 'special_statutory_cancel':
      return cancelSpecialStatutoryLeave(
        db,
        salonId,
        leave,
        decision,
        actor
      );

    case 'sensitive_family_approve':
      return approveSensitiveFamilyLeave(
        db,
        salonId,
        leave,
        decision,
        actor
      );

    case 'sensitive_family_cancel':
      return cancelSensitiveFamilyLeave(
        db,
        salonId,
        leave,
        decision,
        actor
      );

    case 'statutory_validation_block': {
      const support = specialStatutoryLeaveRuntimeSupport(leave.leave_type);
      throw new AppError(
        409,
        support === 'specialized_required'
          ? `core_leave:${normalizeSaLeaveType(leave.leave_type)}_specialized_validation_required`
          : 'core_leave:statutory_validation_required'
      );
    }

    case 'hr_review_block':
      throw new AppError(
        409,
        'core_leave:hr_review_resolution_required'
      );

    default:
      return legacyDecideLeave(
        db,
        salonId,
        id,
        decision,
        actor
      );
  }
}

export {
  CANONICAL_APPROVAL_TYPES,
  LEGACY_SAFE_APPROVAL_TYPES,
};
