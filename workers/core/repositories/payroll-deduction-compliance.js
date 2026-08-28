// CORE D1 ONLY — auditable Saudi wage-deduction legal classification.

import {
  cleanText,
  dbAll,
  dbBatch,
  dbFirst,
  generatedId,
  nowIso,
  optionalText,
  requiredId,
} from '../d1.js';
import { AppError } from '../errors.js';
import {
  SA_LABOR_LIMITS,
} from '../../../src/helpers/hr/saLaborPolicy.js';
import {
  isUserClassifiableSaPayrollDeduction,
  normalizeSaPayrollDeductionClass,
  SA_PAYROLL_DEDUCTION_CLASSES,
} from '../../../src/helpers/hr/saPayrollDeductionPolicy.js';

function requiredReason(value) {
  const reason = cleanText(value);
  if (!reason || reason.length > 1500) {
    throw new AppError(400, 'core_payroll:deduction_classification_reason_required');
  }
  return reason;
}

function classificationInput(data = {}) {
  const deductionClass = normalizeSaPayrollDeductionClass(
    data.laborDeductionClass ??
      data.labor_deduction_class ??
      data.deductionClass
  );
  if (!isUserClassifiableSaPayrollDeduction(deductionClass)) {
    throw new AppError(400, 'core_payroll:deduction_class_not_user_assignable');
  }

  const writtenConsentReference = optionalText(
    data.writtenConsentReference ?? data.written_consent_reference
  ) || null;
  const courtOrderReference = optionalText(
    data.courtOrderReference ?? data.court_order_reference
  ) || null;
  const evidenceReference = optionalText(
    data.evidenceReference ?? data.evidence_reference
  ) || null;
  const rawJudicialCap = data.judicialMonthlyCapBps ?? data.judicial_monthly_cap_bps;
  const judicialMonthlyCapBps = rawJudicialCap === undefined || rawJudicialCap === null || rawJudicialCap === ''
    ? deductionClass === SA_PAYROLL_DEDUCTION_CLASSES.judicialDebt
      ? SA_LABOR_LIMITS.courtOrderDefaultDeductionCapBps
      : null
    : Math.round(Number(rawJudicialCap));

  if (
    judicialMonthlyCapBps != null &&
    (!Number.isInteger(judicialMonthlyCapBps) || judicialMonthlyCapBps <= 0 || judicialMonthlyCapBps > 10000)
  ) {
    throw new AppError(400, 'core_payroll:judicial_monthly_cap_invalid');
  }

  if (
    deductionClass === SA_PAYROLL_DEDUCTION_CLASSES.otherWithWrittenConsent &&
    !writtenConsentReference
  ) {
    throw new AppError(409, 'core_payroll:written_consent_reference_required');
  }
  if (
    deductionClass === SA_PAYROLL_DEDUCTION_CLASSES.judicialDebt &&
    !courtOrderReference
  ) {
    throw new AppError(409, 'core_payroll:court_order_reference_required');
  }
  if (
    [
      SA_PAYROLL_DEDUCTION_CLASSES.employerLoan,
      SA_PAYROLL_DEDUCTION_CLASSES.thriftFund,
      SA_PAYROLL_DEDUCTION_CLASSES.housingOrBenefitInstallment,
      SA_PAYROLL_DEDUCTION_CLASSES.disciplinaryFine,
      SA_PAYROLL_DEDUCTION_CLASSES.damageRecovery,
    ].includes(deductionClass) &&
    !evidenceReference
  ) {
    throw new AppError(409, 'core_payroll:deduction_evidence_reference_required');
  }

  return {
    deductionClass,
    writtenConsentReference,
    courtOrderReference,
    judicialMonthlyCapBps,
    evidenceReference,
    reason: requiredReason(data.reason),
  };
}

async function assertObligationClassificationMutable(db, salonId, obligation) {
  const locked = await dbFirst(
    db,
    `SELECT payroll.id, payroll.payroll_month, payroll.status
       FROM employee_payroll_obligation_installments installment
       JOIN payroll_entries payroll
         ON payroll.salon_id = installment.salon_id
        AND payroll.employee_id = ?
        AND payroll.payroll_month = installment.target_payroll_month
      WHERE installment.salon_id = ?
        AND installment.obligation_id = ?
        AND payroll.status IN ('approved','paid')
      LIMIT 1`,
    [obligation.employee_id, salonId, obligation.id]
  );
  if (locked) {
    throw new AppError(409, 'core_payroll:deduction_classification_payroll_locked');
  }
}

async function assertRecurringClassificationMutable(db, salonId, recurring) {
  const locked = await dbFirst(
    db,
    `SELECT payroll.id
       FROM employee_payroll_obligations obligation
       JOIN employee_payroll_obligation_installments installment
         ON installment.salon_id = obligation.salon_id
        AND installment.obligation_id = obligation.id
       JOIN payroll_entries payroll
         ON payroll.salon_id = obligation.salon_id
        AND payroll.employee_id = obligation.employee_id
        AND payroll.payroll_month = installment.target_payroll_month
      WHERE obligation.salon_id = ?
        AND obligation.recurring_deduction_id = ?
        AND payroll.status IN ('approved','paid')
      LIMIT 1`,
    [salonId, recurring.id]
  );
  if (locked) {
    throw new AppError(409, 'core_payroll:deduction_classification_payroll_locked');
  }
}

function eventStatement({ salonId, employeeId, entityType, entityId, previousClass, next, actor, now }) {
  return {
    sql: `INSERT INTO employee_payroll_deduction_classification_events (
      id, salon_id, employee_id, entity_type, entity_id,
      previous_class, next_class, written_consent_reference,
      court_order_reference, judicial_monthly_cap_bps, evidence_reference,
      reason, actor_uid, actor_email, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      generatedId('deduction_classification'),
      salonId,
      employeeId,
      entityType,
      entityId,
      cleanText(previousClass) || null,
      next.deductionClass,
      next.writtenConsentReference,
      next.courtOrderReference,
      next.judicialMonthlyCapBps,
      next.evidenceReference,
      next.reason,
      optionalText(actor.uid) || null,
      optionalText(actor.email) || null,
      now,
    ],
  };
}

export async function classifyPayrollObligationDeduction(
  db,
  salonId,
  idValue,
  data = {},
  actor = {}
) {
  const id = requiredId(idValue, 'obligationId');
  const row = await dbFirst(
    db,
    `SELECT * FROM employee_payroll_obligations
      WHERE salon_id = ? AND id = ? LIMIT 1`,
    [salonId, id]
  );
  if (!row) throw new AppError(404, 'core_payroll:obligation_not_found');

  if (
    cleanText(row.source_type).toLowerCase() === 'attendance' &&
    cleanText(row.obligation_kind).toLowerCase() === 'attendance_missing_hours'
  ) {
    throw new AppError(409, 'core_payroll:canonical_attendance_classification_immutable');
  }

  await assertObligationClassificationMutable(db, salonId, row);
  const next = classificationInput(data);
  const now = nowIso();

  await dbBatch(db, [
    {
      sql: `UPDATE employee_payroll_obligations
               SET labor_deduction_class = ?,
                   written_consent_reference = ?,
                   court_order_reference = ?,
                   judicial_monthly_cap_bps = ?,
                   evidence_reference = ?,
                   compliance_classification_reason = ?,
                   compliance_classified_by_uid = ?,
                   compliance_classified_by_email = ?,
                   compliance_classified_at = ?,
                   updated_at = ?
             WHERE salon_id = ? AND id = ?`,
      params: [
        next.deductionClass,
        next.writtenConsentReference,
        next.courtOrderReference,
        next.judicialMonthlyCapBps,
        next.evidenceReference,
        next.reason,
        optionalText(actor.uid) || null,
        optionalText(actor.email) || null,
        now,
        now,
        salonId,
        id,
      ],
    },
    eventStatement({
      salonId,
      employeeId: row.employee_id,
      entityType: 'payroll_obligation',
      entityId: id,
      previousClass: row.labor_deduction_class,
      next,
      actor,
      now,
    }),
  ]);

  return dbFirst(
    db,
    `SELECT * FROM employee_payroll_obligations
      WHERE salon_id = ? AND id = ? LIMIT 1`,
    [salonId, id]
  );
}

export async function classifyRecurringPayrollDeduction(
  db,
  salonId,
  idValue,
  data = {},
  actor = {}
) {
  const id = requiredId(idValue, 'recurringDeductionId');
  const row = await dbFirst(
    db,
    `SELECT * FROM employee_recurring_deductions
      WHERE salon_id = ? AND id = ? LIMIT 1`,
    [salonId, id]
  );
  if (!row) throw new AppError(404, 'core_payroll:recurring_deduction_not_found');

  await assertRecurringClassificationMutable(db, salonId, row);
  const next = classificationInput(data);
  const now = nowIso();

  await dbBatch(db, [
    {
      sql: `UPDATE employee_recurring_deductions
               SET labor_deduction_class = ?,
                   written_consent_reference = ?,
                   court_order_reference = ?,
                   judicial_monthly_cap_bps = ?,
                   evidence_reference = ?,
                   compliance_classification_reason = ?,
                   compliance_classified_by_uid = ?,
                   compliance_classified_by_email = ?,
                   compliance_classified_at = ?,
                   updated_at = ?
             WHERE salon_id = ? AND id = ?`,
      params: [
        next.deductionClass,
        next.writtenConsentReference,
        next.courtOrderReference,
        next.judicialMonthlyCapBps,
        next.evidenceReference,
        next.reason,
        optionalText(actor.uid) || null,
        optionalText(actor.email) || null,
        now,
        now,
        salonId,
        id,
      ],
    },
    {
      sql: `UPDATE employee_payroll_obligations
               SET labor_deduction_class = ?,
                   written_consent_reference = ?,
                   court_order_reference = ?,
                   judicial_monthly_cap_bps = ?,
                   evidence_reference = ?,
                   compliance_classification_reason = ?,
                   compliance_classified_by_uid = ?,
                   compliance_classified_by_email = ?,
                   compliance_classified_at = ?,
                   updated_at = ?
             WHERE salon_id = ?
               AND recurring_deduction_id = ?
               AND status IN ('open','scheduled','partially_settled')`,
      params: [
        next.deductionClass,
        next.writtenConsentReference,
        next.courtOrderReference,
        next.judicialMonthlyCapBps,
        next.evidenceReference,
        next.reason,
        optionalText(actor.uid) || null,
        optionalText(actor.email) || null,
        now,
        now,
        salonId,
        id,
      ],
    },
    eventStatement({
      salonId,
      employeeId: row.employee_id,
      entityType: 'recurring_deduction',
      entityId: id,
      previousClass: row.labor_deduction_class,
      next,
      actor,
      now,
    }),
  ]);

  return dbFirst(
    db,
    `SELECT * FROM employee_recurring_deductions
      WHERE salon_id = ? AND id = ? LIMIT 1`,
    [salonId, id]
  );
}

export async function listPayrollDeductionClassificationEvents(
  db,
  salonId,
  query = {}
) {
  let rows = await dbAll(
    db,
    `SELECT * FROM employee_payroll_deduction_classification_events
      WHERE salon_id = ? ORDER BY created_at DESC LIMIT 1000`,
    [salonId]
  );
  const employeeId = cleanText(query.employeeId || query.employee_id);
  const entityId = cleanText(query.entityId || query.entity_id);
  if (employeeId) rows = rows.filter((row) => cleanText(row.employee_id) === employeeId);
  if (entityId) rows = rows.filter((row) => cleanText(row.entity_id) === entityId);
  return rows;
}

export async function savePayrollDeductionCourtOverride(
  db,
  salonId,
  data = {},
  actor = {}
) {
  const employeeId = requiredId(data.employeeId || data.employee_id, 'employeeId');
  const payrollMonth = cleanText(data.payrollMonth || data.payroll_month);
  if (!/^\d{4}-\d{2}$/.test(payrollMonth)) {
    throw new AppError(400, 'core_payroll:invalid_month');
  }
  const maxBps = Math.round(Number(
    data.maxTotalDeductionBps ?? data.max_total_deduction_bps
  ));
  if (
    !Number.isInteger(maxBps) ||
    maxBps <= SA_LABOR_LIMITS.generalDeductionCapBps ||
    maxBps > 10000
  ) {
    throw new AppError(400, 'core_payroll:deduction_override_bps_invalid');
  }
  const courtReference = cleanText(
    data.laborCourtReference || data.labor_court_reference
  );
  if (!courtReference) {
    throw new AppError(409, 'core_payroll:labor_court_override_reference_required');
  }
  const reason = requiredReason(data.reason);
  const locked = await dbFirst(
    db,
    `SELECT id FROM payroll_entries
      WHERE salon_id = ? AND employee_id = ? AND payroll_month = ?
        AND status IN ('approved','paid') LIMIT 1`,
    [salonId, employeeId, payrollMonth]
  );
  if (locked) throw new AppError(409, 'core_payroll:deduction_override_payroll_locked');

  const existing = await dbFirst(
    db,
    `SELECT * FROM employee_payroll_deduction_overrides
      WHERE salon_id = ? AND employee_id = ? AND payroll_month = ?
        AND status = 'active' LIMIT 1`,
    [salonId, employeeId, payrollMonth]
  );
  if (existing) {
    if (
      Number(existing.max_total_deduction_bps) === maxBps &&
      cleanText(existing.labor_court_reference) === courtReference &&
      cleanText(existing.reason) === reason
    ) {
      return { ...existing, idempotent: true };
    }
    throw new AppError(409, 'core_payroll:active_deduction_override_exists');
  }

  const now = nowIso();
  const id = requiredId(data.id || generatedId('deduction_override'));
  await dbBatch(db, [{
    sql: `INSERT INTO employee_payroll_deduction_overrides (
      id, salon_id, employee_id, payroll_month, max_total_deduction_bps,
      labor_court_reference, reason, status,
      created_by_uid, created_by_email, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`,
    params: [
      id,
      salonId,
      employeeId,
      payrollMonth,
      maxBps,
      courtReference,
      reason,
      optionalText(actor.uid) || null,
      optionalText(actor.email) || null,
      now,
    ],
  }]);
  return dbFirst(
    db,
    `SELECT * FROM employee_payroll_deduction_overrides
      WHERE salon_id = ? AND id = ? LIMIT 1`,
    [salonId, id]
  );
}

export async function cancelPayrollDeductionCourtOverride(
  db,
  salonId,
  idValue,
  data = {},
  actor = {}
) {
  const id = requiredId(idValue, 'overrideId');
  const row = await dbFirst(
    db,
    `SELECT * FROM employee_payroll_deduction_overrides
      WHERE salon_id = ? AND id = ? LIMIT 1`,
    [salonId, id]
  );
  if (!row) throw new AppError(404, 'core_payroll:deduction_override_not_found');
  if (cleanText(row.status) === 'cancelled') return { ...row, idempotent: true };

  const locked = await dbFirst(
    db,
    `SELECT id FROM payroll_entries
      WHERE salon_id = ? AND employee_id = ? AND payroll_month = ?
        AND status IN ('approved','paid') LIMIT 1`,
    [salonId, row.employee_id, row.payroll_month]
  );
  if (locked) throw new AppError(409, 'core_payroll:deduction_override_payroll_locked');

  const reason = requiredReason(data.reason || data.cancellationReason || data.cancellation_reason);
  const now = nowIso();
  await dbBatch(db, [{
    sql: `UPDATE employee_payroll_deduction_overrides
             SET status = 'cancelled', cancelled_by_uid = ?,
                 cancelled_at = ?, cancellation_reason = ?
           WHERE salon_id = ? AND id = ? AND status = 'active'`,
    params: [optionalText(actor.uid) || null, now, reason, salonId, id],
  }]);
  return dbFirst(
    db,
    `SELECT * FROM employee_payroll_deduction_overrides
      WHERE salon_id = ? AND id = ? LIMIT 1`,
    [salonId, id]
  );
}
