// CORE D1 ONLY — deterministic Saudi statutory special-leave validators.
// Sensitive/complex family-leave cases remain fail-closed until their dedicated
// calendar/evidence runtime is connected; we never infer eligibility from name,
// nationality, gender or religion.

import {
  changes,
  cleanText,
  dbFirst,
  nowIso,
  optionalText,
  validDate,
} from '../d1.js';
import { AppError } from '../errors.js';
import { SA_LABOR_POLICY_VERSION } from '../../../src/helpers/hr/saLaborPolicy.js';
import { SA_LEAVE_TYPES } from '../../../src/helpers/hr/saLeaveEntitlements.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const SIMPLE_SPECIAL_TYPES = new Set([
  SA_LEAVE_TYPES.marriage,
  SA_LEAVE_TYPES.bereavementSpouseAscendantDescendant,
  SA_LEAVE_TYPES.bereavementSibling,
  SA_LEAVE_TYPES.newborn,
  SA_LEAVE_TYPES.hajj,
  SA_LEAVE_TYPES.exam,
]);

const COMPLEX_SPECIAL_TYPES = new Set([
  SA_LEAVE_TYPES.maternity,
  SA_LEAVE_TYPES.childMedicalCare,
  SA_LEAVE_TYPES.widowMuslim,
  SA_LEAVE_TYPES.widowNonMuslim,
]);

function dateMs(dateKey) {
  return Date.parse(`${validDate(dateKey, 'date')}T12:00:00.000Z`);
}

function dateRangeDays(startDate, endDate) {
  const start = dateMs(startDate);
  const end = dateMs(endDate);
  const days = Math.round((end - start) / DAY_MS) + 1;
  if (!Number.isInteger(days) || days <= 0) {
    throw new AppError(400, 'core_special_leave:invalid_range');
  }
  return days;
}

function addDays(dateKey, days) {
  const date = new Date(dateMs(dateKey));
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function addYears(dateKey, years) {
  const [year, month, day] = validDate(dateKey, 'date').split('-').map(Number);
  const targetYear = year + Number(years || 0);
  const candidate = new Date(Date.UTC(targetYear, month - 1, day, 12));
  if (candidate.getUTCMonth() !== month - 1) {
    return `${targetYear}-02-28`;
  }
  return candidate.toISOString().slice(0, 10);
}

function bool(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function evidenceReference(decision = {}) {
  const reference = cleanText(
    decision.evidenceReference ||
      decision.evidence_reference ||
      decision.documentationReference ||
      decision.documentation_reference
  );
  if (!reference || reference.length > 500) {
    throw new AppError(409, 'core_special_leave:evidence_reference_required');
  }
  return reference;
}

function eventDate(decision = {}) {
  return validDate(
    decision.eventDate ||
      decision.event_date ||
      decision.statutoryEventDate ||
      decision.statutory_event_date,
    'eventDate'
  );
}

function assertFullDayRange(leave) {
  if (cleanText(leave.duration_kind || 'full_day').toLowerCase() !== 'full_day') {
    throw new AppError(409, 'core_special_leave:full_day_required');
  }
  const days = dateRangeDays(leave.start_date, leave.end_date);
  const storedDays = Number(leave.days_count || 0);
  if (!Number.isFinite(storedDays) || Math.abs(storedDays - days) > 0.0001) {
    throw new AppError(409, 'core_special_leave:days_count_mismatch');
  }
  return days;
}

function requireStartsOnEvent(leave, date) {
  if (cleanText(leave.start_date) !== date) {
    throw new AppError(409, 'core_special_leave:must_start_on_event_date');
  }
}

function maxDays(days, maximum, code) {
  if (days > maximum) throw new AppError(409, code);
}

function legalBasis(type) {
  switch (type) {
    case SA_LEAVE_TYPES.marriage:
    case SA_LEAVE_TYPES.bereavementSpouseAscendantDescendant:
    case SA_LEAVE_TYPES.bereavementSibling:
    case SA_LEAVE_TYPES.newborn:
      return 'SA_LABOR_ARTICLE_113';
    case SA_LEAVE_TYPES.hajj:
      return 'SA_LABOR_ARTICLE_114';
    case SA_LEAVE_TYPES.exam:
      return 'SA_LABOR_ARTICLE_115';
    default:
      return 'HR_REVIEW_REQUIRED';
  }
}

async function employmentStartDate(db, salonId, employeeId) {
  const row = await dbFirst(
    db,
    `SELECT start_date, employment_status
       FROM employee_employment
      WHERE salon_id = ? AND employee_id = ?
      LIMIT 1`,
    [salonId, employeeId]
  );
  if (!row || cleanText(row.employment_status).toLowerCase() !== 'active') {
    throw new AppError(409, 'core_special_leave:active_employment_required');
  }
  return validDate(row.start_date, 'startDate');
}

async function validateHajj(db, salonId, leave, decision, days) {
  if (days < 10 || days > 15) {
    throw new AppError(409, 'core_special_leave:hajj_requires_10_to_15_days');
  }

  const startDate = await employmentStartDate(db, salonId, leave.employee_id);
  if (cleanText(leave.start_date) < addYears(startDate, 2)) {
    throw new AppError(409, 'core_special_leave:hajj_two_year_service_required');
  }

  if (!bool(
    decision.priorHajjAttestedNotPerformed ??
      decision.prior_hajj_attested_not_performed
  )) {
    throw new AppError(409, 'core_special_leave:hajj_prior_performance_attestation_required');
  }

  const previous = await dbFirst(
    db,
    `SELECT id
       FROM employee_leaves
      WHERE salon_id = ? AND employee_id = ?
        AND leave_type = 'hajj' AND status = 'approved'
        AND id <> ?
      LIMIT 1`,
    [salonId, leave.employee_id, leave.id]
  );
  if (previous) {
    throw new AppError(409, 'core_special_leave:hajj_once_per_service');
  }

  const eid = await dbFirst(
    db,
    `SELECT id, holiday_date
       FROM sa_public_holiday_calendar
      WHERE holiday_code = 'eid_al_adha'
        AND status = 'verified'
        AND holiday_date BETWEEN ? AND ?
      ORDER BY holiday_date
      LIMIT 1`,
    [leave.start_date, leave.end_date]
  );
  if (!eid) {
    throw new AppError(409, 'core_special_leave:hajj_verified_eid_calendar_required');
  }

  return {
    validationCode: 'HAJJ_ART114_VERIFIED',
    eventDate: eid.holiday_date,
    details: {
      serviceStartDate: startDate,
      twoYearAnniversary: addYears(startDate, 2),
      eidAlAdhaCalendarId: eid.id,
      priorHajjAttestedNotPerformed: true,
    },
  };
}

function normalizedExamDates(decision = {}) {
  const raw = decision.examDates ?? decision.exam_dates;
  if (!Array.isArray(raw) || !raw.length) {
    throw new AppError(409, 'core_special_leave:exam_dates_required');
  }
  return [...new Set(raw.map((value) => validDate(value, 'examDate')))].sort();
}

function validateExam(leave, decision, days) {
  if (!bool(
    decision.educationEnrollmentApproved ??
      decision.education_enrollment_approved
  )) {
    // Article 115 routes a non-approved enrollment to annual leave when
    // available, otherwise unpaid leave. This special-leave runtime must not
    // silently debit the annual bucket or invent an unpaid payroll effect.
    throw new AppError(409, 'core_special_leave:exam_requires_annual_or_unpaid_route');
  }
  if (bool(decision.examYearRepeated ?? decision.exam_year_repeated)) {
    // A repeated-year exam is unpaid under Article 115. Keep it fail-closed
    // until its dedicated payroll treatment is connected.
    throw new AppError(409, 'core_special_leave:repeated_exam_payroll_runtime_required');
  }

  const examDates = normalizedExamDates(decision);
  if (examDates.length !== days) {
    throw new AppError(409, 'core_special_leave:exam_actual_days_mismatch');
  }
  for (let index = 0; index < examDates.length; index += 1) {
    if (examDates[index] !== addDays(leave.start_date, index)) {
      throw new AppError(409, 'core_special_leave:exam_nonconsecutive_dates_require_separate_requests');
    }
  }
  if (examDates[0] !== leave.start_date || examDates.at(-1) !== leave.end_date) {
    throw new AppError(409, 'core_special_leave:exam_range_mismatch');
  }

  const createdDate = cleanText(leave.created_at).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(createdDate)) {
    throw new AppError(409, 'core_special_leave:request_created_at_required');
  }
  const noticeDays = Math.round((dateMs(leave.start_date) - dateMs(createdDate)) / DAY_MS);
  if (noticeDays < 15) {
    throw new AppError(409, 'core_special_leave:exam_15_day_notice_required');
  }

  return {
    validationCode: 'EXAM_ART115_PAID_VERIFIED',
    eventDate: leave.start_date,
    details: {
      examDates,
      educationEnrollmentApproved: true,
      examYearRepeated: false,
      noticeDays,
    },
  };
}

async function validateSimpleSpecial(db, salonId, leave, decision) {
  const type = cleanText(leave.leave_type).toLowerCase();
  const days = assertFullDayRange(leave);

  if (type === SA_LEAVE_TYPES.hajj) {
    return {
      ...(await validateHajj(db, salonId, leave, decision, days)),
      days,
    };
  }
  if (type === SA_LEAVE_TYPES.exam) {
    return {
      ...validateExam(leave, decision, days),
      days,
    };
  }

  const date = eventDate(decision);
  if (type === SA_LEAVE_TYPES.marriage) {
    maxDays(days, 5, 'core_special_leave:marriage_max_5_days');
    requireStartsOnEvent(leave, date);
    return { days, eventDate: date, validationCode: 'MARRIAGE_ART113_VERIFIED', details: {} };
  }
  if (type === SA_LEAVE_TYPES.bereavementSpouseAscendantDescendant) {
    maxDays(days, 5, 'core_special_leave:bereavement_max_5_days');
    requireStartsOnEvent(leave, date);
    return { days, eventDate: date, validationCode: 'BEREAVEMENT_5_ART113_VERIFIED', details: {} };
  }
  if (type === SA_LEAVE_TYPES.bereavementSibling) {
    maxDays(days, 3, 'core_special_leave:sibling_bereavement_max_3_days');
    requireStartsOnEvent(leave, date);
    return { days, eventDate: date, validationCode: 'BEREAVEMENT_SIBLING_3_ART113_VERIFIED', details: {} };
  }
  if (type === SA_LEAVE_TYPES.newborn) {
    maxDays(days, 3, 'core_special_leave:newborn_max_3_days');
    if (leave.start_date < date || leave.end_date > addDays(date, 6)) {
      throw new AppError(409, 'core_special_leave:newborn_must_be_within_7_days');
    }
    return { days, eventDate: date, validationCode: 'NEWBORN_ART113_VERIFIED', details: {} };
  }

  throw new AppError(409, 'core_special_leave:unsupported_type');
}

export function specialStatutoryLeaveRuntimeSupport(leaveTypeValue) {
  const type = cleanText(leaveTypeValue).toLowerCase();
  if (SIMPLE_SPECIAL_TYPES.has(type)) return 'deterministic';
  if (COMPLEX_SPECIAL_TYPES.has(type)) return 'specialized_required';
  return 'unsupported';
}

export async function approveSpecialStatutoryLeave(
  db,
  salonId,
  leave,
  decision = {},
  actor = {}
) {
  const type = cleanText(leave?.leave_type).toLowerCase();
  if (cleanText(leave?.status).toLowerCase() !== 'pending') {
    throw new AppError(409, 'core_special_leave:invalid_approval_state');
  }
  if (COMPLEX_SPECIAL_TYPES.has(type)) {
    throw new AppError(409, `core_special_leave:${type}_specialized_runtime_required`);
  }
  if (!SIMPLE_SPECIAL_TYPES.has(type)) {
    throw new AppError(409, 'core_special_leave:unsupported_type');
  }

  const reference = evidenceReference(decision);
  const validation = await validateSimpleSpecial(db, salonId, leave, decision);
  const now = nowIso();
  const actorUid = optionalText(actor.uid) || null;
  const actorEmail = optionalText(actor.email) || null;
  const actorName = optionalText(actor.name || actor.displayName) || null;
  const note = optionalText(decision.hrNote || decision.hr_note) || null;
  const evidence = {
    ...validation.details,
    evidenceReference: reference,
    validatedLeaveDays: validation.days,
    policyVersion: SA_LABOR_POLICY_VERSION,
  };

  const result = await db
    .prepare(
      `UPDATE employee_leaves
          SET status = 'approved',
              deduct_from_balance = 0,
              affects_payroll = 0,
              policy_version = ?,
              pay_rate_bps = 10000,
              balance_bucket = 'special_statutory',
              legal_basis = ?,
              documentation_status = 'verified',
              statutory_review_required = 0,
              statutory_event_date = ?,
              statutory_evidence_reference = ?,
              statutory_evidence_json = ?,
              statutory_validation_code = ?,
              statutory_validated_at = ?,
              statutory_validated_by_uid = ?,
              hr_note = ?,
              decided_at = ?,
              decided_by_uid = ?,
              decided_by_email = ?,
              decided_by_name = ?,
              updated_at = ?
        WHERE salon_id = ? AND id = ?
          AND employee_id = ? AND status = 'pending'
          AND leave_type = ?`
    )
    .bind(
      SA_LABOR_POLICY_VERSION,
      legalBasis(type),
      validation.eventDate,
      reference,
      JSON.stringify(evidence),
      validation.validationCode,
      now,
      actorUid,
      note,
      now,
      actorUid,
      actorEmail,
      actorName,
      now,
      salonId,
      leave.id,
      leave.employee_id,
      type
    )
    .run();

  if (changes(result) !== 1) {
    const latest = await dbFirst(
      db,
      'SELECT * FROM employee_leaves WHERE salon_id = ? AND id = ? LIMIT 1',
      [salonId, leave.id]
    );
    if (
      cleanText(latest?.status).toLowerCase() === 'approved' &&
      cleanText(latest?.statutory_validation_code) === validation.validationCode
    ) {
      return { ...latest, idempotent: true };
    }
    throw new AppError(409, 'core_special_leave:approval_concurrency_conflict');
  }

  const approved = await dbFirst(
    db,
    'SELECT * FROM employee_leaves WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, leave.id]
  );
  return { ...approved, idempotent: false };
}

export async function cancelSpecialStatutoryLeave(
  db,
  salonId,
  leave,
  decision = {},
  actor = {}
) {
  if (cleanText(leave?.status).toLowerCase() !== 'approved') {
    throw new AppError(409, 'core_special_leave:invalid_cancellation_state');
  }
  const now = nowIso();
  const note = optionalText(decision.hrNote || decision.hr_note) || 'Cancelled approved statutory leave';
  const result = await db
    .prepare(
      `UPDATE employee_leaves
          SET status = 'rejected',
              hr_note = ?,
              decided_at = ?,
              decided_by_uid = ?,
              decided_by_email = ?,
              decided_by_name = ?,
              updated_at = ?
        WHERE salon_id = ? AND id = ? AND status = 'approved'`
    )
    .bind(
      note,
      now,
      optionalText(actor.uid) || null,
      optionalText(actor.email) || null,
      optionalText(actor.name || actor.displayName) || null,
      now,
      salonId,
      leave.id
    )
    .run();
  if (changes(result) !== 1) {
    throw new AppError(409, 'core_special_leave:cancellation_concurrency_conflict');
  }
  return dbFirst(
    db,
    'SELECT * FROM employee_leaves WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, leave.id]
  );
}
