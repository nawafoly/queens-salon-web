// CORE D1 ONLY — sensitive Saudi family-leave validators.
// Eligibility is driven by an explicit leave type and verified evidence.
// Never infer religion, pregnancy, gender or family status from profile data.

import {
  changes,
  cleanText,
  dbFirst,
  dbRun,
  generatedId,
  nowIso,
  optionalText,
  validDate,
} from '../d1.js';
import { AppError } from '../errors.js';
import {
  SA_LABOR_POLICY_VERSION,
  SA_SPECIAL_LEAVE_ENTITLEMENTS,
} from '../../../src/helpers/hr/saLaborPolicy.js';
import { SA_LEAVE_TYPES } from '../../../src/helpers/hr/saLeaveEntitlements.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MATERNITY_PAID_DAYS = SA_SPECIAL_LEAVE_ENTITLEMENTS.maternityWeeks * 7;
const MATERNITY_MANDATORY_POST_BIRTH_DAYS =
  SA_SPECIAL_LEAVE_ENTITLEMENTS.maternityMandatoryPostBirthWeeks * 7;
const CHILD_MEDICAL_PAID_DAYS =
  SA_SPECIAL_LEAVE_ENTITLEMENTS.childMedicalCarePaidDays;
const CHILD_MEDICAL_UNPAID_MAX_DAYS =
  SA_SPECIAL_LEAVE_ENTITLEMENTS.childMedicalCareUnpaidExtensionDays;
const WIDOW_NON_MUSLIM_DAYS = SA_SPECIAL_LEAVE_ENTITLEMENTS.nonMuslimWidowDays;

const SENSITIVE_FAMILY_TYPES = new Set([
  SA_LEAVE_TYPES.maternity,
  SA_LEAVE_TYPES.childMedicalCare,
  SA_LEAVE_TYPES.widowMuslim,
  SA_LEAVE_TYPES.widowNonMuslim,
]);

function dateMs(value, field = 'date') {
  return Date.parse(`${validDate(value, field)}T12:00:00.000Z`);
}

function addDays(value, days) {
  const date = new Date(dateMs(value));
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function rangeDays(startDate, endDate) {
  const start = dateMs(startDate, 'startDate');
  const end = dateMs(endDate, 'endDate');
  const days = Math.round((end - start) / DAY_MS) + 1;
  if (!Number.isInteger(days) || days <= 0) {
    throw new AppError(400, 'core_family_leave:invalid_range');
  }
  return days;
}

function bool(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function requiredEvidenceReference(decision = {}, field = 'evidenceReference') {
  const snake = field.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  const value = cleanText(decision[field] ?? decision[snake]);
  if (!value || value.length > 500) {
    throw new AppError(409, `core_family_leave:${snake}_required`);
  }
  return value;
}

function optionalDate(decision = {}, camel, snake) {
  const raw = cleanText(decision[camel] ?? decision[snake]);
  return raw ? validDate(raw, camel) : null;
}

function actorValues(actor = {}) {
  return {
    uid: optionalText(actor.uid) || null,
    email: optionalText(actor.email) || null,
    name: optionalText(actor.name || actor.displayName) || null,
  };
}

function assertPendingFullDay(leave) {
  if (cleanText(leave?.status).toLowerCase() !== 'pending') {
    throw new AppError(409, 'core_family_leave:invalid_approval_state');
  }
  if (cleanText(leave?.duration_kind || 'full_day').toLowerCase() !== 'full_day') {
    throw new AppError(409, 'core_family_leave:full_day_required');
  }
  const days = rangeDays(leave.start_date, leave.end_date);
  if (Math.abs(Number(leave.days_count || 0) - days) > 0.0001) {
    throw new AppError(409, 'core_family_leave:days_count_mismatch');
  }
  return days;
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(cleanText(value) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function leaveById(db, salonId, id) {
  return dbFirst(
    db,
    'SELECT * FROM employee_leaves WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, id]
  );
}

async function createLinkedStatutoryUnpaidLeave(
  db,
  salonId,
  parentLeave,
  startDate,
  endDate,
  validationCode,
  evidenceReference,
  actor = {}
) {
  const existing = await dbFirst(
    db,
    `SELECT *
       FROM employee_leaves
      WHERE salon_id = ?
        AND employee_id = ?
        AND leave_type = 'unpaid'
        AND statutory_linked_leave_id = ?
        AND statutory_validation_code = ?
        AND status = 'approved'
      LIMIT 1`,
    [salonId, parentLeave.employee_id, parentLeave.id, validationCode]
  );
  if (existing) return { ...existing, idempotent: true };

  const days = rangeDays(startDate, endDate);
  const now = nowIso();
  const actorInfo = actorValues(actor);
  const id = generatedId('statutory_unpaid_leave');
  await dbRun(
    db,
    `INSERT INTO employee_leaves (
       id, salon_id, employee_id, employee_uid, employee_name, employee_email,
       status, leave_type, start_date, end_date, days_count,
       employee_note, hr_note, decided_at, decided_by_uid, decided_by_email,
       decided_by_name, created_at, updated_at,
       deduct_from_balance, affects_payroll, policy_version, pay_rate_bps,
       balance_bucket, legal_basis, documentation_status,
       statutory_review_required, statutory_event_date,
       statutory_evidence_reference, statutory_evidence_json,
       statutory_validation_code, statutory_validated_at,
       statutory_validated_by_uid, statutory_linked_leave_id,
       statutory_end_date, statutory_pay_phase
     ) VALUES (
       ?, ?, ?, ?, ?, ?,
       'approved', 'unpaid', ?, ?, ?,
       ?, ?, ?, ?, ?, ?, ?, ?,
       0, 1, ?, 0,
       'none', 'SA_LABOR_ARTICLE_151', 'verified',
       0, ?, ?, ?, ?, ?, ?, ?, ?, 'statutory_unpaid'
     )`,
    [
      id,
      salonId,
      parentLeave.employee_id,
      parentLeave.employee_uid || null,
      parentLeave.employee_name || null,
      parentLeave.employee_email || null,
      startDate,
      endDate,
      days,
      `Linked statutory unpaid period for ${parentLeave.leave_type}`,
      'Generated by canonical statutory family-leave runtime.',
      now,
      actorInfo.uid,
      actorInfo.email,
      actorInfo.name,
      now,
      now,
      SA_LABOR_POLICY_VERSION,
      parentLeave.statutory_event_date || null,
      evidenceReference,
      JSON.stringify({
        parentLeaveId: parentLeave.id,
        parentLeaveType: parentLeave.leave_type,
        policyVersion: SA_LABOR_POLICY_VERSION,
      }),
      validationCode,
      now,
      actorInfo.uid,
      parentLeave.id,
      endDate,
    ]
  );
  return leaveById(db, salonId, id);
}

async function approveMaternity(db, salonId, leave, decision, actor) {
  let days = assertPendingFullDay(leave);
  if (days !== MATERNITY_PAID_DAYS) {
    throw new AppError(409, 'core_family_leave:maternity_requires_12_weeks');
  }

  const expectedBirthDate = validDate(
    decision.expectedBirthDate ?? decision.expected_birth_date,
    'expectedBirthDate'
  );
  const medicalReference = requiredEvidenceReference(
    decision,
    'expectedDateEvidenceReference'
  );
  const earliestPreBirthStart = addDays(expectedBirthDate, -28);
  const actualBirthDate = optionalDate(
    decision,
    'actualBirthDate',
    'actual_birth_date'
  );
  const birthReference = actualBirthDate
    ? requiredEvidenceReference(decision, 'birthEvidenceReference')
    : null;

  let effectiveStart = validDate(leave.start_date, 'startDate');
  let effectiveEnd = validDate(leave.end_date, 'endDate');

  if (actualBirthDate && actualBirthDate < effectiveStart) {
    // Early birth moves the maternity episode to the actual birth date so the
    // mandatory post-birth period cannot contain a working gap.
    effectiveStart = actualBirthDate;
    effectiveEnd = addDays(effectiveStart, MATERNITY_PAID_DAYS - 1);
    days = MATERNITY_PAID_DAYS;
  } else if (effectiveStart < earliestPreBirthStart) {
    throw new AppError(409, 'core_family_leave:maternity_starts_too_early');
  }

  const mandatoryPostBirthEnd = actualBirthDate
    ? addDays(actualBirthDate, MATERNITY_MANDATORY_POST_BIRTH_DAYS - 1)
    : null;
  const now = nowIso();
  const actorInfo = actorValues(actor);
  const reconciliationStatus = actualBirthDate ? 'reconciled' : 'pending';

  await dbRun(
    db,
    `INSERT INTO employee_maternity_leave_episodes (
       leave_id, salon_id, employee_id, expected_birth_date, actual_birth_date,
       expected_date_evidence_reference, birth_evidence_reference,
       paid_entitlement_days, mandatory_post_birth_days,
       birth_reconciliation_status, mandatory_post_birth_end_date,
       unpaid_completion_leave_id, policy_version,
       created_by_uid, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 84, 42, ?, ?, NULL, ?, ?, ?, ?)
     ON CONFLICT(leave_id) DO UPDATE SET
       expected_birth_date = excluded.expected_birth_date,
       actual_birth_date = excluded.actual_birth_date,
       expected_date_evidence_reference = excluded.expected_date_evidence_reference,
       birth_evidence_reference = excluded.birth_evidence_reference,
       birth_reconciliation_status = excluded.birth_reconciliation_status,
       mandatory_post_birth_end_date = excluded.mandatory_post_birth_end_date,
       policy_version = excluded.policy_version,
       updated_at = excluded.updated_at`,
    [
      leave.id,
      salonId,
      leave.employee_id,
      expectedBirthDate,
      actualBirthDate,
      medicalReference,
      birthReference,
      reconciliationStatus,
      mandatoryPostBirthEnd,
      SA_LABOR_POLICY_VERSION,
      actorInfo.uid,
      now,
      now,
    ]
  );

  const evidence = {
    expectedBirthDate,
    actualBirthDate,
    expectedDateEvidenceReference: medicalReference,
    birthEvidenceReference: birthReference,
    paidEntitlementDays: MATERNITY_PAID_DAYS,
    mandatoryPostBirthDays: MATERNITY_MANDATORY_POST_BIRTH_DAYS,
    mandatoryPostBirthEndDate: mandatoryPostBirthEnd,
    birthReconciliationStatus: reconciliationStatus,
    policyVersion: SA_LABOR_POLICY_VERSION,
  };

  const result = await db
    .prepare(
      `UPDATE employee_leaves
          SET status = 'approved',
              start_date = ?, end_date = ?, days_count = ?,
              deduct_from_balance = 0, affects_payroll = 0,
              policy_version = ?, pay_rate_bps = 10000,
              balance_bucket = 'special_statutory',
              legal_basis = 'SA_LABOR_ARTICLE_151',
              documentation_status = 'verified',
              statutory_review_required = 0,
              statutory_event_date = ?,
              statutory_evidence_reference = ?,
              statutory_evidence_json = ?,
              statutory_validation_code = ?,
              statutory_validated_at = ?,
              statutory_validated_by_uid = ?,
              statutory_end_date = ?,
              statutory_pay_phase = 'paid',
              hr_note = ?, decided_at = ?,
              decided_by_uid = ?, decided_by_email = ?, decided_by_name = ?,
              updated_at = ?
        WHERE salon_id = ? AND id = ? AND employee_id = ?
          AND status = 'pending' AND leave_type = 'maternity'`
    )
    .bind(
      effectiveStart,
      effectiveEnd,
      days,
      SA_LABOR_POLICY_VERSION,
      actualBirthDate || expectedBirthDate,
      medicalReference,
      JSON.stringify(evidence),
      actualBirthDate
        ? 'MATERNITY_ART151_BIRTH_RECONCILED'
        : 'MATERNITY_ART151_EXPECTED_DATE_VERIFIED',
      now,
      actorInfo.uid,
      effectiveEnd,
      optionalText(decision.hrNote || decision.hr_note) || null,
      now,
      actorInfo.uid,
      actorInfo.email,
      actorInfo.name,
      now,
      salonId,
      leave.id,
      leave.employee_id
    )
    .run();

  if (changes(result) !== 1) {
    const latest = await leaveById(db, salonId, leave.id);
    if (cleanText(latest?.status) === 'approved') {
      return { ...latest, idempotent: true };
    }
    throw new AppError(409, 'core_family_leave:maternity_approval_conflict');
  }

  let approved = await leaveById(db, salonId, leave.id);
  let unpaidCompletion = null;
  if (actualBirthDate && mandatoryPostBirthEnd > effectiveEnd) {
    unpaidCompletion = await createLinkedStatutoryUnpaidLeave(
      db,
      salonId,
      approved,
      addDays(effectiveEnd, 1),
      mandatoryPostBirthEnd,
      'MATERNITY_ART151_DELAY_COMPLETION_UNPAID',
      birthReference,
      actor
    );
    await dbRun(
      db,
      `UPDATE employee_maternity_leave_episodes
          SET unpaid_completion_leave_id = ?, updated_at = ?
        WHERE salon_id = ? AND leave_id = ?`,
      [unpaidCompletion.id, nowIso(), salonId, leave.id]
    );
  }

  approved = await leaveById(db, salonId, leave.id);
  return {
    ...approved,
    maternityEpisode: await maternityEpisode(db, salonId, leave.id),
    unpaidCompletion,
    idempotent: false,
  };
}

async function maternityEpisode(db, salonId, leaveId) {
  return dbFirst(
    db,
    `SELECT * FROM employee_maternity_leave_episodes
      WHERE salon_id = ? AND leave_id = ? LIMIT 1`,
    [salonId, leaveId]
  );
}

export async function reconcileMaternityBirth(
  db,
  salonId,
  leaveId,
  decision = {},
  actor = {}
) {
  let leave = await leaveById(db, salonId, leaveId);
  if (!leave || cleanText(leave.leave_type) !== SA_LEAVE_TYPES.maternity) {
    throw new AppError(404, 'core_family_leave:maternity_not_found');
  }
  if (cleanText(leave.status) !== 'approved') {
    throw new AppError(409, 'core_family_leave:maternity_must_be_approved');
  }
  const episode = await maternityEpisode(db, salonId, leave.id);
  if (!episode) {
    throw new AppError(409, 'core_family_leave:maternity_episode_missing');
  }

  const actualBirthDate = validDate(
    decision.actualBirthDate ?? decision.actual_birth_date,
    'actualBirthDate'
  );
  const birthReference = requiredEvidenceReference(decision, 'birthEvidenceReference');

  if (
    cleanText(episode.birth_reconciliation_status) === 'reconciled' &&
    cleanText(episode.actual_birth_date) === actualBirthDate &&
    cleanText(episode.birth_evidence_reference) === birthReference
  ) {
    return {
      leave,
      maternityEpisode: episode,
      idempotent: true,
    };
  }

  let effectiveStart = leave.start_date;
  let effectiveEnd = leave.end_date;
  if (actualBirthDate < effectiveStart) {
    effectiveStart = actualBirthDate;
    effectiveEnd = addDays(actualBirthDate, MATERNITY_PAID_DAYS - 1);
  }
  const mandatoryPostBirthEnd = addDays(
    actualBirthDate,
    MATERNITY_MANDATORY_POST_BIRTH_DAYS - 1
  );
  const now = nowIso();
  const actorInfo = actorValues(actor);

  let unpaidCompletion = null;
  if (mandatoryPostBirthEnd > effectiveEnd) {
    unpaidCompletion = await createLinkedStatutoryUnpaidLeave(
      db,
      salonId,
      { ...leave, start_date: effectiveStart, end_date: effectiveEnd, statutory_event_date: actualBirthDate },
      addDays(effectiveEnd, 1),
      mandatoryPostBirthEnd,
      'MATERNITY_ART151_DELAY_COMPLETION_UNPAID',
      birthReference,
      actor
    );
  }

  const priorEvidence = parseJsonObject(leave.statutory_evidence_json);
  const evidence = {
    ...priorEvidence,
    actualBirthDate,
    birthEvidenceReference: birthReference,
    mandatoryPostBirthEndDate: mandatoryPostBirthEnd,
    birthReconciliationStatus: 'reconciled',
    unpaidCompletionLeaveId: unpaidCompletion?.id || null,
    policyVersion: SA_LABOR_POLICY_VERSION,
  };

  await dbRun(
    db,
    `UPDATE employee_maternity_leave_episodes
        SET actual_birth_date = ?, birth_evidence_reference = ?,
            birth_reconciliation_status = 'reconciled',
            mandatory_post_birth_end_date = ?,
            unpaid_completion_leave_id = ?, policy_version = ?, updated_at = ?
      WHERE salon_id = ? AND leave_id = ?`,
    [
      actualBirthDate,
      birthReference,
      mandatoryPostBirthEnd,
      unpaidCompletion?.id || episode.unpaid_completion_leave_id || null,
      SA_LABOR_POLICY_VERSION,
      now,
      salonId,
      leave.id,
    ]
  );
  await dbRun(
    db,
    `UPDATE employee_leaves
        SET start_date = ?, end_date = ?, days_count = 84,
            statutory_event_date = ?, statutory_evidence_json = ?,
            statutory_validation_code = 'MATERNITY_ART151_BIRTH_RECONCILED',
            statutory_validated_at = ?, statutory_validated_by_uid = ?,
            statutory_end_date = ?, updated_at = ?
      WHERE salon_id = ? AND id = ? AND status = 'approved'`,
    [
      effectiveStart,
      effectiveEnd,
      actualBirthDate,
      JSON.stringify(evidence),
      now,
      actorInfo.uid,
      effectiveEnd,
      now,
      salonId,
      leave.id,
    ]
  );

  leave = await leaveById(db, salonId, leave.id);
  return {
    leave,
    maternityEpisode: await maternityEpisode(db, salonId, leave.id),
    unpaidCompletion,
    idempotent: false,
  };
}

async function approveChildMedicalCare(db, salonId, leave, decision, actor) {
  const days = assertPendingFullDay(leave);
  if (days > CHILD_MEDICAL_PAID_DAYS) {
    throw new AppError(409, 'core_family_leave:child_medical_paid_max_30_days');
  }
  if (!bool(
    decision.continuousCompanionRequired ??
      decision.continuous_companion_required
  )) {
    throw new AppError(409, 'core_family_leave:continuous_companion_evidence_required');
  }

  const maternityLeaveId = cleanText(
    decision.maternityLeaveId ?? decision.maternity_leave_id
  );
  if (!maternityLeaveId) {
    throw new AppError(409, 'core_family_leave:maternity_leave_link_required');
  }
  const maternity = await leaveById(db, salonId, maternityLeaveId);
  const episode = maternity
    ? await maternityEpisode(db, salonId, maternity.id)
    : null;
  if (
    !maternity ||
    maternity.employee_id !== leave.employee_id ||
    cleanText(maternity.leave_type) !== SA_LEAVE_TYPES.maternity ||
    cleanText(maternity.status) !== 'approved' ||
    cleanText(episode?.birth_reconciliation_status) !== 'reconciled'
  ) {
    throw new AppError(409, 'core_family_leave:reconciled_maternity_link_required');
  }

  const maternityStatutoryEnd =
    cleanText(episode.mandatory_post_birth_end_date) > cleanText(maternity.end_date)
      ? cleanText(episode.mandatory_post_birth_end_date)
      : cleanText(maternity.end_date);
  const expectedStart = addDays(maternityStatutoryEnd, 1);
  if (leave.start_date !== expectedStart) {
    throw new AppError(409, 'core_family_leave:child_medical_must_follow_maternity');
  }

  const evidenceReference = requiredEvidenceReference(decision, 'evidenceReference');
  const now = nowIso();
  const actorInfo = actorValues(actor);
  const evidence = {
    maternityLeaveId,
    maternityEpisodeLeaveId: episode.leave_id,
    maternityStatutoryEnd,
    continuousCompanionRequired: true,
    evidenceReference,
    paidDays: days,
    policyVersion: SA_LABOR_POLICY_VERSION,
  };

  const result = await db
    .prepare(
      `UPDATE employee_leaves
          SET status = 'approved', deduct_from_balance = 0, affects_payroll = 0,
              policy_version = ?, pay_rate_bps = 10000,
              balance_bucket = 'special_statutory',
              legal_basis = 'SA_LABOR_ARTICLE_151',
              documentation_status = 'verified', statutory_review_required = 0,
              statutory_event_date = ?, statutory_linked_leave_id = ?,
              statutory_evidence_reference = ?, statutory_evidence_json = ?,
              statutory_validation_code = 'CHILD_MEDICAL_CARE_ART151_VERIFIED',
              statutory_validated_at = ?, statutory_validated_by_uid = ?,
              statutory_end_date = ?, statutory_pay_phase = 'paid',
              hr_note = ?, decided_at = ?, decided_by_uid = ?,
              decided_by_email = ?, decided_by_name = ?, updated_at = ?
        WHERE salon_id = ? AND id = ? AND employee_id = ?
          AND status = 'pending' AND leave_type = 'child_medical_care'`
    )
    .bind(
      SA_LABOR_POLICY_VERSION,
      episode.actual_birth_date,
      maternityLeaveId,
      evidenceReference,
      JSON.stringify(evidence),
      now,
      actorInfo.uid,
      leave.end_date,
      optionalText(decision.hrNote || decision.hr_note) || null,
      now,
      actorInfo.uid,
      actorInfo.email,
      actorInfo.name,
      now,
      salonId,
      leave.id,
      leave.employee_id
    )
    .run();
  if (changes(result) !== 1) {
    throw new AppError(409, 'core_family_leave:child_medical_approval_conflict');
  }

  let approved = await leaveById(db, salonId, leave.id);
  const unpaidExtensionDays = Number(
    decision.unpaidExtensionDays ?? decision.unpaid_extension_days ?? 0
  );
  if (
    !Number.isInteger(unpaidExtensionDays) ||
    unpaidExtensionDays < 0 ||
    unpaidExtensionDays > CHILD_MEDICAL_UNPAID_MAX_DAYS
  ) {
    throw new AppError(400, 'core_family_leave:invalid_child_medical_unpaid_extension');
  }

  let unpaidExtension = null;
  if (unpaidExtensionDays > 0) {
    if (days !== CHILD_MEDICAL_PAID_DAYS) {
      throw new AppError(409, 'core_family_leave:paid_month_required_before_unpaid_extension');
    }
    unpaidExtension = await createLinkedStatutoryUnpaidLeave(
      db,
      salonId,
      approved,
      addDays(approved.end_date, 1),
      addDays(approved.end_date, unpaidExtensionDays),
      'CHILD_MEDICAL_CARE_ART151_UNPAID_EXTENSION',
      evidenceReference,
      actor
    );
  }

  approved = await leaveById(db, salonId, leave.id);
  return {
    ...approved,
    unpaidExtension,
    idempotent: false,
  };
}

async function approveWidowNonMuslim(db, salonId, leave, decision, actor) {
  const days = assertPendingFullDay(leave);
  if (days > WIDOW_NON_MUSLIM_DAYS) {
    throw new AppError(409, 'core_family_leave:widow_non_muslim_max_15_days');
  }
  const deathDate = validDate(
    decision.eventDate ?? decision.event_date ?? decision.deathDate ?? decision.death_date,
    'deathDate'
  );
  if (leave.start_date !== deathDate) {
    throw new AppError(409, 'core_family_leave:widow_leave_must_start_on_death_date');
  }
  const reference = requiredEvidenceReference(decision, 'evidenceReference');
  return approveWidowRecord(
    db,
    salonId,
    leave,
    {
      eventDate: deathDate,
      endDate: leave.end_date,
      days,
      evidenceReference: reference,
      validationCode: 'WIDOW_NON_MUSLIM_ART160_VERIFIED',
      evidence: {
        routeSelectedExplicitly: 'widow_non_muslim',
        religionInferred: false,
      },
    },
    decision,
    actor
  );
}

async function approveWidowMuslim(db, salonId, leave, decision, actor) {
  assertPendingFullDay(leave);
  const deathDate = validDate(
    decision.eventDate ?? decision.event_date ?? decision.deathDate ?? decision.death_date,
    'deathDate'
  );
  if (leave.start_date !== deathDate) {
    throw new AppError(409, 'core_family_leave:widow_leave_must_start_on_death_date');
  }
  const verifiedEndDate = validDate(
    decision.verifiedStatutoryEndDate ?? decision.verified_statutory_end_date,
    'verifiedStatutoryEndDate'
  );
  if (verifiedEndDate < deathDate) {
    throw new AppError(409, 'core_family_leave:invalid_verified_widow_end_date');
  }
  const reference = requiredEvidenceReference(decision, 'evidenceReference');
  const calendarReference = requiredEvidenceReference(
    decision,
    'calendarCalculationReference'
  );
  if (
    decision.pregnancyExtensionEndDate ||
    decision.pregnancy_extension_end_date
  ) {
    throw new AppError(
      409,
      'core_family_leave:widow_pregnancy_extension_requires_separate_unpaid_runtime'
    );
  }

  return approveWidowRecord(
    db,
    salonId,
    leave,
    {
      eventDate: deathDate,
      endDate: verifiedEndDate,
      days: rangeDays(deathDate, verifiedEndDate),
      evidenceReference: reference,
      validationCode: 'WIDOW_MUSLIM_ART160_VERIFIED_END',
      evidence: {
        routeSelectedExplicitly: 'widow_muslim',
        religionInferred: false,
        calendarCalculationReference: calendarReference,
        verifiedStatutoryEndDate: verifiedEndDate,
      },
    },
    decision,
    actor
  );
}

async function approveWidowRecord(
  db,
  salonId,
  leave,
  validation,
  decision,
  actor
) {
  const now = nowIso();
  const actorInfo = actorValues(actor);
  const evidence = {
    ...validation.evidence,
    evidenceReference: validation.evidenceReference,
    policyVersion: SA_LABOR_POLICY_VERSION,
  };
  const result = await db
    .prepare(
      `UPDATE employee_leaves
          SET status = 'approved', end_date = ?, days_count = ?,
              deduct_from_balance = 0, affects_payroll = 0,
              policy_version = ?, pay_rate_bps = 10000,
              balance_bucket = 'special_statutory',
              legal_basis = 'SA_LABOR_ARTICLE_160',
              documentation_status = 'verified', statutory_review_required = 0,
              statutory_event_date = ?, statutory_evidence_reference = ?,
              statutory_evidence_json = ?, statutory_validation_code = ?,
              statutory_validated_at = ?, statutory_validated_by_uid = ?,
              statutory_end_date = ?, statutory_pay_phase = 'paid',
              hr_note = ?, decided_at = ?, decided_by_uid = ?,
              decided_by_email = ?, decided_by_name = ?, updated_at = ?
        WHERE salon_id = ? AND id = ? AND employee_id = ?
          AND status = 'pending' AND leave_type = ?`
    )
    .bind(
      validation.endDate,
      validation.days,
      SA_LABOR_POLICY_VERSION,
      validation.eventDate,
      validation.evidenceReference,
      JSON.stringify(evidence),
      validation.validationCode,
      now,
      actorInfo.uid,
      validation.endDate,
      optionalText(decision.hrNote || decision.hr_note) || null,
      now,
      actorInfo.uid,
      actorInfo.email,
      actorInfo.name,
      now,
      salonId,
      leave.id,
      leave.employee_id,
      leave.leave_type
    )
    .run();
  if (changes(result) !== 1) {
    throw new AppError(409, 'core_family_leave:widow_approval_conflict');
  }
  return { ...(await leaveById(db, salonId, leave.id)), idempotent: false };
}

export function sensitiveFamilyLeaveRuntimeSupport(leaveTypeValue) {
  const type = cleanText(leaveTypeValue).toLowerCase();
  return SENSITIVE_FAMILY_TYPES.has(type) ? 'deterministic_evidence' : 'unsupported';
}

export async function approveSensitiveFamilyLeave(
  db,
  salonId,
  leave,
  decision = {},
  actor = {}
) {
  const type = cleanText(leave?.leave_type).toLowerCase();
  if (type === SA_LEAVE_TYPES.maternity) {
    return approveMaternity(db, salonId, leave, decision, actor);
  }
  if (type === SA_LEAVE_TYPES.childMedicalCare) {
    return approveChildMedicalCare(db, salonId, leave, decision, actor);
  }
  if (type === SA_LEAVE_TYPES.widowMuslim) {
    return approveWidowMuslim(db, salonId, leave, decision, actor);
  }
  if (type === SA_LEAVE_TYPES.widowNonMuslim) {
    return approveWidowNonMuslim(db, salonId, leave, decision, actor);
  }
  throw new AppError(409, 'core_family_leave:unsupported_type');
}

export async function cancelSensitiveFamilyLeave(
  db,
  salonId,
  leave,
  decision = {},
  actor = {}
) {
  const type = cleanText(leave?.leave_type).toLowerCase();
  if (!SENSITIVE_FAMILY_TYPES.has(type)) {
    throw new AppError(409, 'core_family_leave:unsupported_type');
  }
  if (cleanText(leave?.status).toLowerCase() !== 'approved') {
    throw new AppError(409, 'core_family_leave:invalid_cancellation_state');
  }
  const now = nowIso();
  const actorInfo = actorValues(actor);
  const note = optionalText(decision.hrNote || decision.hr_note) ||
    'Cancelled approved sensitive statutory leave';

  const result = await db
    .prepare(
      `UPDATE employee_leaves
          SET status = 'rejected', hr_note = ?, decided_at = ?,
              decided_by_uid = ?, decided_by_email = ?, decided_by_name = ?,
              updated_at = ?
        WHERE salon_id = ? AND id = ? AND status = 'approved'`
    )
    .bind(
      note,
      now,
      actorInfo.uid,
      actorInfo.email,
      actorInfo.name,
      now,
      salonId,
      leave.id
    )
    .run();
  if (changes(result) !== 1) {
    throw new AppError(409, 'core_family_leave:cancellation_conflict');
  }

  await dbRun(
    db,
    `UPDATE employee_leaves
        SET status = 'rejected', hr_note = ?, decided_at = ?,
            decided_by_uid = ?, decided_by_email = ?, decided_by_name = ?,
            updated_at = ?
      WHERE salon_id = ? AND statutory_linked_leave_id = ?
        AND leave_type = 'unpaid' AND status = 'approved'`,
    [
      `Parent statutory leave cancelled: ${leave.id}`,
      now,
      actorInfo.uid,
      actorInfo.email,
      actorInfo.name,
      now,
      salonId,
      leave.id,
    ]
  );

  if (type === SA_LEAVE_TYPES.maternity) {
    await dbRun(
      db,
      `UPDATE employee_maternity_leave_episodes
          SET birth_reconciliation_status = 'cancelled', updated_at = ?
        WHERE salon_id = ? AND leave_id = ?`,
      [now, salonId, leave.id]
    );
  }

  return leaveById(db, salonId, leave.id);
}
