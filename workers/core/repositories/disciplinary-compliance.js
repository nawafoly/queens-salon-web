// CORE D1 ONLY — Saudi disciplinary case and fine enforcement.

import {
  cleanText,
  dbAll,
  dbBatch,
  dbFirst,
  generatedId,
  nowIso,
  optionalText,
  requiredId,
  validDate,
} from '../d1.js';
import { AppError } from '../errors.js';
import {
  SA_LABOR_POLICY_VERSION,
  calculateMonthlyDailyWageHalalas,
} from '../../../src/helpers/hr/saLaborPolicy.js';

function requiredText(value, code) {
  const text = cleanText(value);
  if (!text) throw new AppError(400, code);
  return text;
}

function validIso(value, code) {
  const text = cleanText(value);
  if (!text || !Number.isFinite(Date.parse(text))) {
    throw new AppError(400, code);
  }
  return text;
}

function payrollMonth(value) {
  const month = cleanText(value);
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new AppError(400, 'core_discipline:invalid_payroll_month');
  }
  return month;
}

async function employmentWage(db, salonId, employeeId) {
  const row = await dbFirst(
    db,
    `SELECT employment_status, base_salary_halalas,
            housing_allowance_halalas, transportation_allowance_halalas,
            other_allowances_halalas
       FROM employee_employment
      WHERE salon_id = ? AND employee_id = ? LIMIT 1`,
    [salonId, employeeId]
  );
  if (!row || cleanText(row.employment_status).toLowerCase() !== 'active') {
    throw new AppError(409, 'core_discipline:employee_not_active');
  }
  const dailyWageHalalas = calculateMonthlyDailyWageHalalas({
    baseSalaryHalalas: Number(row.base_salary_halalas || 0),
    housingAllowanceHalalas: Number(row.housing_allowance_halalas || 0),
    transportationAllowanceHalalas: Number(row.transportation_allowance_halalas || 0),
    otherAllowancesHalalas: Number(row.other_allowances_halalas || 0),
  });
  if (dailyWageHalalas <= 0) {
    throw new AppError(409, 'core_discipline:wage_snapshot_required');
  }
  return { row, dailyWageHalalas };
}

async function assertPayrollMonthMutable(db, salonId, employeeId, month) {
  const locked = await dbFirst(
    db,
    `SELECT id FROM payroll_entries
      WHERE salon_id = ? AND employee_id = ? AND payroll_month = ?
        AND status IN ('approved','paid') LIMIT 1`,
    [salonId, employeeId, month]
  );
  if (locked) throw new AppError(409, 'core_discipline:target_payroll_locked');
}

export async function createDisciplinaryCase(
  db,
  salonId,
  data = {},
  actor = {}
) {
  const employeeId = requiredId(data.employeeId || data.employee_id, 'employeeId');
  const violationReference = requiredText(
    data.violationReference || data.violation_reference,
    'core_discipline:violation_reference_required'
  );
  const existing = await dbFirst(
    db,
    `SELECT * FROM employee_disciplinary_cases
      WHERE salon_id = ? AND employee_id = ? AND violation_reference = ? LIMIT 1`,
    [salonId, employeeId, violationReference]
  );
  if (existing) return { ...existing, idempotent: true };

  const discoveredDate = validDate(
    data.discoveredDate || data.discovered_date,
    'discoveredDate'
  );
  const incidentRaw = cleanText(data.incidentDate || data.incident_date);
  const incidentDate = incidentRaw ? validDate(incidentRaw, 'incidentDate') : null;
  const allegationNotifiedAt = validIso(
    data.allegationNotifiedAt || data.allegation_notified_at,
    'core_discipline:allegation_notice_required'
  );
  const investigationCompletedAt = validIso(
    data.investigationCompletedAt || data.investigation_completed_at,
    'core_discipline:investigation_completed_at_required'
  );
  const defenseMinutesReference = requiredText(
    data.defenseMinutesReference || data.defense_minutes_reference,
    'core_discipline:defense_minutes_reference_required'
  );
  const decisionAt = validIso(
    data.decisionAt || data.decision_at,
    'core_discipline:decision_at_required'
  );
  const employeeNotificationReference = requiredText(
    data.employeeNotificationReference || data.employee_notification_reference,
    'core_discipline:employee_notification_reference_required'
  );
  const decisionReason = requiredText(
    data.decisionReason || data.decision_reason || data.reason,
    'core_discipline:decision_reason_required'
  );
  const penaltyType = cleanText(data.penaltyType || data.penalty_type).toLowerCase();
  if (!['warning', 'fine'].includes(penaltyType)) {
    throw new AppError(400, 'core_discipline:invalid_penalty_type');
  }

  const { dailyWageHalalas } = await employmentWage(db, salonId, employeeId);
  let fineHalalas = 0;
  let targetPayrollMonth = null;
  if (penaltyType === 'fine') {
    fineHalalas = Math.round(Number(data.fineHalalas ?? data.fine_halalas ?? 0));
    if (!Number.isSafeInteger(fineHalalas) || fineHalalas <= 0) {
      throw new AppError(400, 'core_discipline:fine_amount_required');
    }
    if (fineHalalas > dailyWageHalalas * 5) {
      throw new AppError(409, 'core_discipline:single_violation_fine_limit_exceeded');
    }
    targetPayrollMonth = payrollMonth(data.targetPayrollMonth || data.target_payroll_month);
    await assertPayrollMonthMutable(db, salonId, employeeId, targetPayrollMonth);
    const monthFine = await dbFirst(
      db,
      `SELECT COALESCE(SUM(fine_halalas),0) AS total
         FROM employee_disciplinary_cases
        WHERE salon_id = ? AND employee_id = ?
          AND target_payroll_month = ? AND penalty_type = 'fine'
          AND status = 'decided'`,
      [salonId, employeeId, targetPayrollMonth]
    );
    if (Number(monthFine?.total || 0) + fineHalalas > dailyWageHalalas * 5) {
      throw new AppError(409, 'core_discipline:monthly_fine_limit_exceeded');
    }
  }

  const now = nowIso();
  const caseId = requiredId(data.id || generatedId('disciplinary_case'));
  const obligationId = penaltyType === 'fine'
    ? generatedId('payroll_obligation')
    : null;
  const installmentId = penaltyType === 'fine'
    ? generatedId('payroll_obligation_installment')
    : null;
  const actorUid = optionalText(actor.uid) || null;
  const actorEmail = optionalText(actor.email) || null;

  const statements = [{
    sql: `INSERT INTO employee_disciplinary_cases (
      id, salon_id, employee_id, violation_reference, violation_code,
      incident_date, discovered_date, allegation_notified_at,
      investigation_completed_at, defense_minutes_reference, decision_at,
      employee_notification_reference, penalty_type, fine_halalas,
      daily_wage_snapshot_halalas, target_payroll_month, payroll_obligation_id,
      status, decision_reason, policy_version,
      created_by_uid, created_by_email, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              'decided', ?, ?, ?, ?, ?)`,
    params: [
      caseId,
      salonId,
      employeeId,
      violationReference,
      optionalText(data.violationCode || data.violation_code) || null,
      incidentDate,
      discoveredDate,
      allegationNotifiedAt,
      investigationCompletedAt,
      defenseMinutesReference,
      decisionAt,
      employeeNotificationReference,
      penaltyType,
      fineHalalas,
      dailyWageHalalas,
      targetPayrollMonth,
      obligationId,
      decisionReason,
      SA_LABOR_POLICY_VERSION,
      actorUid,
      actorEmail,
      now,
    ],
  }];

  if (penaltyType === 'fine') {
    statements.push(
      {
        sql: `INSERT INTO employee_payroll_obligations (
          id, salon_id, employee_id, recurring_deduction_id, obligation_kind,
          source_type, source_ref, original_payroll_month,
          original_amount_halalas, remaining_amount_halalas, status, reason, note,
          created_by_uid, created_by_email, created_at, updated_at,
          labor_deduction_class, evidence_reference,
          compliance_classification_reason, compliance_classified_by_uid,
          compliance_classified_by_email, compliance_classified_at
        ) VALUES (?, ?, ?, NULL, 'disciplinary_fine', 'disciplinary_case', ?, ?, ?, ?,
                  'scheduled', ?, NULL, ?, ?, ?, ?, 'disciplinary_fine', ?, ?, ?, ?, ?)`,
        params: [
          obligationId,
          salonId,
          employeeId,
          caseId,
          targetPayrollMonth,
          fineHalalas,
          fineHalalas,
          decisionReason,
          actorUid,
          actorEmail,
          now,
          now,
          caseId,
          'Canonical disciplinary case with investigation and decision evidence.',
          actorUid,
          actorEmail,
          now,
        ],
      },
      {
        sql: `INSERT INTO employee_payroll_obligation_installments (
          id, salon_id, obligation_id, sequence_no, target_payroll_month,
          amount_halalas, status, decision_reason, note,
          created_by_uid, created_by_email, created_at, updated_at
        ) VALUES (?, ?, ?, 1, ?, ?, 'scheduled', ?, NULL, ?, ?, ?, ?)`,
        params: [
          installmentId,
          salonId,
          obligationId,
          targetPayrollMonth,
          fineHalalas,
          decisionReason,
          actorUid,
          actorEmail,
          now,
          now,
        ],
      }
    );
  }

  await dbBatch(db, statements);
  return dbFirst(
    db,
    `SELECT * FROM employee_disciplinary_cases
      WHERE salon_id = ? AND id = ? LIMIT 1`,
    [salonId, caseId]
  );
}

export async function cancelDisciplinaryCase(
  db,
  salonId,
  idValue,
  data = {},
  actor = {}
) {
  const id = requiredId(idValue, 'disciplinaryCaseId');
  const row = await dbFirst(
    db,
    `SELECT * FROM employee_disciplinary_cases
      WHERE salon_id = ? AND id = ? LIMIT 1`,
    [salonId, id]
  );
  if (!row) throw new AppError(404, 'core_discipline:not_found');
  if (cleanText(row.status) === 'cancelled') return { ...row, idempotent: true };

  if (row.payroll_obligation_id) {
    const locked = await dbFirst(
      db,
      `SELECT payroll.id
         FROM employee_payroll_obligation_installments installment
         JOIN payroll_entries payroll
           ON payroll.salon_id = installment.salon_id
          AND payroll.employee_id = ?
          AND payroll.payroll_month = installment.target_payroll_month
        WHERE installment.salon_id = ?
          AND installment.obligation_id = ?
          AND payroll.status IN ('approved','paid')
        LIMIT 1`,
      [row.employee_id, salonId, row.payroll_obligation_id]
    );
    if (locked) {
      throw new AppError(409, 'core_discipline:locked_payroll_requires_carryover_correction');
    }
  }

  const reason = requiredText(
    data.reason || data.cancellationReason || data.cancellation_reason,
    'core_discipline:cancellation_reason_required'
  );
  const now = nowIso();
  const statements = [{
    sql: `UPDATE employee_disciplinary_cases
             SET status = 'cancelled', cancelled_by_uid = ?,
                 cancelled_at = ?, cancellation_reason = ?
           WHERE salon_id = ? AND id = ? AND status = 'decided'`,
    params: [optionalText(actor.uid) || null, now, reason, salonId, id],
  }];

  if (row.payroll_obligation_id) {
    statements.push(
      {
        sql: `UPDATE employee_payroll_obligation_installments
                 SET status = 'cancelled', updated_at = ?
               WHERE salon_id = ? AND obligation_id = ? AND status = 'scheduled'`,
        params: [now, salonId, row.payroll_obligation_id],
      },
      {
        sql: `UPDATE employee_payroll_obligations
                 SET status = 'cancelled', cancelled_by_uid = ?,
                     cancelled_by_email = ?, cancelled_at = ?,
                     cancellation_reason = ?, updated_at = ?
               WHERE salon_id = ? AND id = ?
                 AND status IN ('open','scheduled','partially_settled')`,
        params: [
          optionalText(actor.uid) || null,
          optionalText(actor.email) || null,
          now,
          reason,
          now,
          salonId,
          row.payroll_obligation_id,
        ],
      }
    );
  }

  await dbBatch(db, statements);
  return dbFirst(
    db,
    `SELECT * FROM employee_disciplinary_cases
      WHERE salon_id = ? AND id = ? LIMIT 1`,
    [salonId, id]
  );
}

export async function listDisciplinaryCases(db, salonId, query = {}) {
  let rows = await dbAll(
    db,
    `SELECT * FROM employee_disciplinary_cases
      WHERE salon_id = ? ORDER BY decision_at DESC LIMIT 1000`,
    [salonId]
  );
  const employeeId = cleanText(query.employeeId || query.employee_id);
  const status = cleanText(query.status).toLowerCase();
  const payrollMonth = cleanText(query.payrollMonth || query.payroll_month);
  if (employeeId) rows = rows.filter((row) => cleanText(row.employee_id) === employeeId);
  if (status) rows = rows.filter((row) => cleanText(row.status) === status);
  if (payrollMonth) rows = rows.filter((row) => cleanText(row.target_payroll_month) === payrollMonth);
  return rows;
}
