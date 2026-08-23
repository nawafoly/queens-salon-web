// CORE D1 ONLY — do not add Firestore fallback.
// Firebase is allowed only for authentication token verification.

import {
  cleanText,
  dbAll,
  dbBatch,
  dbFirst,
  dbRun,
  generatedId,
  nowIso,
  optionalText,
  requiredId,
  validDate,
} from '../d1.js';
import { AppError } from '../errors.js';
import { payrollAttendanceReadiness } from '../../../src/helpers/hr/payrollReadiness.js';
import {
  payrollCarryoverDelta,
  PAYROLL_CARRYOVER_SOURCE_TYPE,
} from '../../../src/helpers/hr/payrollCarryoverPolicy.js';
import {
  applyTargetBonusToPayrollData,
  approveEmployeeTargetSummary,
} from './employee-targets.js';
import {
  assertPayrollObligationSnapshotCurrent,
  canonicalizePayrollObligationDeductions,
  payrollObligationPaidStatements,
} from './payroll-obligations.js';

function intMoney(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) {
    const error = new Error('invalid_money');
    error.code = 'core_payroll:invalid_money';
    throw error;
  }
  return Math.round(number);
}

function numberValue(value, fallback = 0) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}

function optionalNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function activeFlag(value) {
  return value === true || value === 1 || value === '1' || value === 'true' ? 1 : 0;
}

function targetSchemaUnavailable(error) {
  const message = cleanText(error?.message).toLowerCase();
  return message.includes('no such table') || message.includes('unhandled fake d1');
}

function jsonText(value, fallback) {
  if (typeof value === 'string') {
    try {
      JSON.parse(value);
      return value;
    } catch {}
  }
  return JSON.stringify(value === undefined ? fallback : value);
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(cleanText(value) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseJsonObject(value) {
  try {
    const parsed = JSON.parse(cleanText(value) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function deductionItemsTotal(items) {
  return (Array.isArray(items) ? items : []).reduce((sum, item) => {
    const amount = Number(item?.amountHalalas ?? item?.amount_halalas ?? item?.amount ?? 0);
    return sum + (Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0);
  }, 0);
}

function cleanStatus(value) {
  const status = cleanText(value || 'draft');
  if (['draft', 'reviewed', 'approved', 'paid'].includes(status)) return status;
  throw new AppError(400, 'core_payroll:invalid_status');
}

function lockedStatus(status) {
  return ['approved', 'paid'].includes(cleanText(status));
}

function appendAudit(row, action, actor = {}) {
  const entries = parseJsonArray(row?.audit_log_json);
  entries.push({
    action,
    byUid: optionalText(actor.uid) || null,
    byEmail: optionalText(actor.email) || null,
    at: nowIso(),
  });
  return JSON.stringify(entries);
}

function appendAuditEntry(row, entry = {}) {
  const entries = parseJsonArray(row?.audit_log_json);
  entries.push({
    ...entry,
    byUid: optionalText(entry.byUid ?? entry.by_uid) || null,
    byEmail: optionalText(entry.byEmail ?? entry.by_email) || null,
    at: optionalText(entry.at) || nowIso(),
  });
  return JSON.stringify(entries);
}

function payrollSetupMissing(row = {}, attendancePayrollMode = 'required') {
  const missing = [];
  const scheduleSnapshot = parseJsonObject(row.schedule_snapshot_json);
  const scheduleMissing = Array.isArray(scheduleSnapshot.payrollSetupMissing)
    ? scheduleSnapshot.payrollSetupMissing.map((item) => cleanText(item)).filter(Boolean)
    : [];
  const dailyScheduledHours = numberValue(
    scheduleSnapshot.dailyScheduledHours ?? scheduleSnapshot.daily_scheduled_hours,
    0
  );
  const attendanceExempt = attendancePayrollMode === 'exempt';

  if (!cleanText(row.employee_id)) missing.push('employeeId');
  if (numberValue(row.base_salary_halalas, 0) <= 0) missing.push('baseSalary');
  if (numberValue(row.work_days, 0) <= 0) missing.push('workDays');
  if (
    !attendanceExempt &&
    numberValue(row.monthly_hours, 0) <= 0 &&
    dailyScheduledHours <= 0
  ) {
    missing.push('monthlyHours');
  }

  for (const key of scheduleMissing) {
    if (key === 'overtimeMultiplier') continue;
    if (attendanceExempt && key === 'monthlyHours') continue;
    if (!missing.includes(key)) missing.push(key);
  }
  return missing;
}

function assertPayrollSetupComplete(row, attendancePayrollMode = 'required') {
  const missing = payrollSetupMissing(row, attendancePayrollMode);
  if (missing.length) {
    throw new AppError(409, 'core_payroll:setup_incomplete');
  }
}

async function assertPayrollApprovalReady(
  db,
  salonId,
  row,
  options = {}
) {
  const snapshot = parseJsonObject(
    row?.attendance_summary_json
  );
  const snapshotMode =
    cleanText(
      snapshot.attendancePayrollMode ??
        snapshot.attendance_payroll_mode
    ).toLowerCase() === 'exempt'
      ? 'exempt'
      : 'required';
  let effectiveMode = snapshotMode;

  if (options.validateCanonicalPolicy !== false) {
    const employment = await dbFirst(
      db,
      `SELECT attendance_payroll_mode,
              attendance_payroll_exemption_reason,
              employment_status,
              base_salary_halalas,
              social_insurance_category,
              social_insurance_effective_from
         FROM employee_employment
        WHERE salon_id = ?
          AND employee_id = ?
        LIMIT 1`,
      [salonId, row.employee_id]
    );

    if (
      !employment ||
      cleanText(employment.employment_status).toLowerCase() !== 'active'
    ) {
      throw new AppError(409, 'core_payroll:employee_not_active');
    }

    const canonicalBaseSalaryHalalas = intMoney(
      employment.base_salary_halalas
    );
    if (canonicalBaseSalaryHalalas <= 0) {
      throw new AppError(409, 'core_payroll:employee_not_payroll_eligible');
    }

    const canonicalMode =
      cleanText(
        employment?.attendance_payroll_mode
      ).toLowerCase() === 'exempt'
        ? 'exempt'
        : 'required';

    if (canonicalMode !== snapshotMode) {
      throw new AppError(
        409,
        'core_payroll:attendance_policy_mismatch'
      );
    }

    const canonicalInsuranceCategory = cleanText(
      employment?.social_insurance_category
    ).toLowerCase();
    const canonicalInsuranceEffectiveFrom = cleanText(
      employment?.social_insurance_effective_from
    );
    const payrollPolicyDate = /^\d{4}-\d{2}$/.test(cleanText(row.payroll_month))
      ? `${cleanText(row.payroll_month)}-28`
      : '';

    if (
      canonicalInsuranceEffectiveFrom &&
      payrollPolicyDate &&
      canonicalInsuranceEffectiveFrom > payrollPolicyDate
    ) {
      throw new AppError(
        409,
        'core_payroll:gosi_not_effective_for_payroll_period'
      );
    }

    if (!canonicalInsuranceCategory) {
      throw new AppError(
        409,
        'core_payroll:gosi_classification_required'
      );
    }
    if (canonicalInsuranceCategory === 'gcc') {
      throw new AppError(
        409,
        'core_payroll:gosi_gcc_extension_policy_required'
      );
    }

    const gosiSnapshot = parseJsonObject(row?.gosi_snapshot_json);
    if (!cleanText(gosiSnapshot.policyVersion)) {
      throw new AppError(409, 'core_payroll:gosi_snapshot_required');
    }
    if (
      cleanText(gosiSnapshot.insuranceCategory).toLowerCase() !==
      canonicalInsuranceCategory
    ) {
      throw new AppError(409, 'core_payroll:gosi_policy_mismatch');
    }
    const snapshotEmployee =
      gosiSnapshot.employee &&
      typeof gosiSnapshot.employee === 'object' &&
      !Array.isArray(gosiSnapshot.employee)
        ? gosiSnapshot.employee
        : {};
    const snapshotEmployer =
      gosiSnapshot.employer &&
      typeof gosiSnapshot.employer === 'object' &&
      !Array.isArray(gosiSnapshot.employer)
        ? gosiSnapshot.employer
        : {};
    if (
      intMoney(row.insurance_deduction_halalas) !==
      intMoney(snapshotEmployee.deductionHalalas)
    ) {
      throw new AppError(409, 'core_payroll:gosi_employee_deduction_mismatch');
    }
    if (
      intMoney(row.employer_gosi_contribution_halalas) !==
      intMoney(snapshotEmployer.contributionHalalas)
    ) {
      throw new AppError(409, 'core_payroll:gosi_employer_contribution_mismatch');
    }

    effectiveMode = canonicalMode;
    if (canonicalMode === 'exempt') {
      snapshot.attendancePayrollExemptionReason =
        optionalText(
          employment?.attendance_payroll_exemption_reason
        ) || null;
      snapshot.attendanceLinkStatus = 'exempt';
      snapshot.attendanceDeductionEligible = false;
    }
  }

  assertPayrollSetupComplete(row, effectiveMode);

  const attendanceReadiness =
    payrollAttendanceReadiness(snapshot);

  if (!attendanceReadiness.ready) {
    throw new AppError(
      409,
      `core_payroll:${attendanceReadiness.code}`
    );
  }
}

export async function listPayrollPeriods(db, salonId) {
  return dbAll(db, 'SELECT * FROM payroll_periods WHERE salon_id = ? ORDER BY payroll_month DESC LIMIT 120', [salonId]);
}

export async function upsertPayrollPeriod(db, salonId, data, actor = {}) {
  const payrollMonth = cleanText(data.payrollMonth || data.payroll_month);
  if (!/^\d{4}-\d{2}$/.test(payrollMonth)) {
    const error = new Error('invalid_payroll_month');
    error.code = 'core_payroll:invalid_month';
    throw error;
  }
  const now = nowIso();
  const monthStart = validDate(data.monthStart || data.month_start || `${payrollMonth}-01`, 'monthStart');
  const monthEnd = validDate(data.monthEnd || data.month_end, 'monthEnd');
  const existing = await dbFirst(db, 'SELECT * FROM payroll_periods WHERE salon_id = ? AND payroll_month = ? LIMIT 1', [salonId, payrollMonth]);
  const row = {
    id: existing?.id || requiredId(data.id || generatedId('payroll_period')),
    salon_id: salonId,
    payroll_month: payrollMonth,
    month_start: monthStart,
    month_end: monthEnd,
    status: cleanText(data.status || existing?.status || 'open'),
    created_by_uid: existing?.created_by_uid || optionalText(actor.uid) || null,
    closed_by_uid: data.closedByUid === undefined ? existing?.closed_by_uid || null : optionalText(data.closedByUid) || null,
    closed_at: data.closedAt === undefined ? existing?.closed_at || null : optionalText(data.closedAt) || null,
    created_at: existing?.created_at || now,
    updated_at: now,
  };
  await dbRun(db, `INSERT INTO payroll_periods
    (id, salon_id, payroll_month, month_start, month_end, status, created_by_uid, closed_by_uid, closed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(salon_id, payroll_month) DO UPDATE SET
      month_start = excluded.month_start, month_end = excluded.month_end, status = excluded.status,
      closed_by_uid = excluded.closed_by_uid, closed_at = excluded.closed_at, updated_at = excluded.updated_at`, Object.values(row));
  return dbFirst(db, 'SELECT * FROM payroll_periods WHERE salon_id = ? AND payroll_month = ? LIMIT 1', [salonId, payrollMonth]);
}

export async function listPayrollEntries(db, salonId, query = {}) {
  let rows = await dbAll(db, 'SELECT * FROM payroll_entries WHERE salon_id = ? ORDER BY payroll_month DESC, employee_id LIMIT 2000', [salonId]);
  const employeeId = cleanText(query.employeeId || query.employee_id);
  const payrollMonth = cleanText(query.payrollMonth || query.payroll_month);
  const status = cleanText(query.status);
  if (employeeId) rows = rows.filter((row) => row.employee_id === employeeId);
  if (payrollMonth) rows = rows.filter((row) => row.payroll_month === payrollMonth);
  if (status) rows = rows.filter((row) => cleanText(row.status || 'draft') === status);
  return rows;
}

export async function getPayrollEntry(db, salonId, id) {
  const entryId = requiredId(id, 'payrollEntryId');
  const row = await dbFirst(db, 'SELECT * FROM payroll_entries WHERE salon_id = ? AND id = ? LIMIT 1', [salonId, entryId]);
  if (!row) throw new AppError(404, 'core_payroll:not_found');
  return row;
}

export async function listPayrollAdvanceDeductions(db, salonId, query = {}) {
  const employeeId = cleanText(query.employeeId || query.employee_id);
  const payrollMonth = cleanText(query.payrollMonth || query.payroll_month);
  const rows = await dbAll(
    db,
    `SELECT sa.employee_id, sai.payroll_month,
            COALESCE(SUM(sai.amount_halalas), 0) AS amount_halalas
       FROM salary_advance_installments sai
       JOIN salary_advances sa
         ON sa.salon_id = sai.salon_id
        AND sa.id = sai.advance_id
      WHERE sai.salon_id = ?
        AND sai.status IN ('scheduled', 'deducted')
      GROUP BY sa.employee_id, sai.payroll_month
      ORDER BY sai.payroll_month, sa.employee_id`,
    [salonId]
  );
  return rows.filter((row) =>
    (!employeeId || cleanText(row.employee_id) === employeeId) &&
    (!payrollMonth || cleanText(row.payroll_month) === payrollMonth)
  );
}


function carryoverSchemaUnavailable(error) {
  const message = cleanText(error?.message).toLowerCase();
  return message.includes('no such table') || message.includes('unhandled fake d1');
}

function validPayrollMonthKey(value, field = 'payrollMonth') {
  const payrollMonth = cleanText(value);
  if (!/^\d{4}-\d{2}$/.test(payrollMonth)) {
    throw new AppError(400, `core_payroll:invalid_${field}`);
  }
  return payrollMonth;
}

function carryoverSignedAmount(row) {
  const amount = Math.max(0, Number(row?.amount_halalas || 0));
  return cleanText(row?.direction) === 'addition' ? amount : -amount;
}

function carryoverSourceIds(row) {
  return [...new Set([
    ...parseJsonArray(row?.additions_json),
    ...parseJsonArray(row?.deductions_json),
  ]
    .filter((item) => cleanText(item?.sourceType ?? item?.source_type) === PAYROLL_CARRYOVER_SOURCE_TYPE)
    .map((item) => cleanText(item?.sourceId ?? item?.source_id))
    .filter(Boolean))];
}

async function latestPayrollApprovalSnapshot(db, salonId, payrollEntryId) {
  try {
    return await dbFirst(
      db,
      `SELECT *
         FROM payroll_approval_snapshots
        WHERE salon_id = ?
          AND payroll_entry_id = ?
        ORDER BY approval_version DESC
        LIMIT 1`,
      [salonId, payrollEntryId]
    );
  } catch (error) {
    if (carryoverSchemaUnavailable(error)) return null;
    throw error;
  }
}

async function nextApprovalSnapshotVersion(db, salonId, payrollEntryId) {
  const row = await dbFirst(
    db,
    `SELECT COALESCE(MAX(approval_version), 0) AS version
       FROM payroll_approval_snapshots
      WHERE salon_id = ?
        AND payroll_entry_id = ?`,
    [salonId, payrollEntryId]
  );
  return Math.max(0, Number(row?.version || 0)) + 1;
}

async function buildApprovalSnapshotStatement(db, salonId, entry, actor = {}, approvedAt = nowIso()) {
  const approvalVersion = await nextApprovalSnapshotVersion(db, salonId, entry.id);
  const snapshotId = generatedId('payroll_approval_snapshot');
  const approvedNetHalalas = Math.max(0, Number(entry.net_salary_halalas ?? entry.final_salary_halalas ?? 0));
  const baseSalaryHalalas = Math.max(0, Number(entry.base_salary_halalas || 0));
  const grossSalaryHalalas = Math.max(0, Number(entry.gross_salary_halalas || 0));
  const totalAdditionsHalalas = Math.max(0, grossSalaryHalalas - baseSalaryHalalas);
  const totalDeductionsHalalas = Math.max(0, Number(entry.total_deductions_halalas || 0));
  return {
    id: snapshotId,
    sql: `INSERT INTO payroll_approval_snapshots
      (id, salon_id, payroll_entry_id, employee_id, payroll_month, approval_version,
       approved_at, approved_by_uid, approved_net_halalas, base_salary_halalas,
       total_additions_halalas, total_deductions_halalas, attendance_summary_json,
       gosi_snapshot_json, employer_gosi_contribution_halalas,
       entry_snapshot_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    params: [
      snapshotId,
      salonId,
      entry.id,
      entry.employee_id,
      entry.payroll_month,
      approvalVersion,
      approvedAt,
      optionalText(actor.uid) || null,
      approvedNetHalalas,
      baseSalaryHalalas,
      totalAdditionsHalalas,
      totalDeductionsHalalas,
      entry.attendance_summary_json || null,
      entry.gosi_snapshot_json || null,
      Math.max(0, Number(entry.employer_gosi_contribution_halalas || 0)),
      JSON.stringify(entry),
      approvedAt,
    ],
  };
}

async function ensureApprovalSnapshotExists(db, salonId, entry, actor = {}) {
  const existingSnapshot = await latestPayrollApprovalSnapshot(db, salonId, entry.id);
  if (existingSnapshot) return existingSnapshot;
  const approvedAt = optionalText(entry.approved_at) || nowIso();
  const statement = await buildApprovalSnapshotStatement(db, salonId, entry, actor, approvedAt);
  await dbRun(db, statement.sql, statement.params);
  return latestPayrollApprovalSnapshot(db, salonId, entry.id);
}

export async function listPayrollCarryoverAdjustments(db, salonId, query = {}) {
  let rows;
  try {
    rows = await dbAll(
      db,
      `SELECT *
         FROM payroll_carryover_adjustments
        WHERE salon_id = ?
        ORDER BY target_payroll_month DESC, employee_id, created_at`,
      [salonId]
    );
  } catch (error) {
    if (carryoverSchemaUnavailable(error)) return [];
    throw error;
  }
  const employeeId = cleanText(query.employeeId || query.employee_id);
  const targetPayrollMonth = cleanText(query.targetPayrollMonth || query.target_payroll_month);
  const sourcePayrollMonth = cleanText(query.sourcePayrollMonth || query.source_payroll_month);
  const status = cleanText(query.status);
  return rows.filter((row) =>
    (!employeeId || cleanText(row.employee_id) === employeeId) &&
    (!targetPayrollMonth || cleanText(row.target_payroll_month) === targetPayrollMonth) &&
    (!sourcePayrollMonth || cleanText(row.source_payroll_month) === sourcePayrollMonth) &&
    (!status || status === 'active'
      ? ['pending', 'applied'].includes(cleanText(row.status))
      : cleanText(row.status) === status)
  );
}

async function reconcilePayrollCarryover(db, salonId, data, actor = {}) {
  const sourcePayrollEntryId = requiredId(
    data.sourcePayrollEntryId || data.source_payroll_entry_id,
    'sourcePayrollEntryId'
  );
  const targetPayrollMonth = validPayrollMonthKey(
    data.targetPayrollMonth || data.target_payroll_month,
    'target_month'
  );
  const recalculatedNetHalalas = intMoney(
    data.recalculatedNetHalalas ?? data.recalculated_net_halalas
  );
  const sourceEntry = await getPayrollEntry(db, salonId, sourcePayrollEntryId);
  if (!['approved', 'paid'].includes(cleanText(sourceEntry.status))) {
    throw new AppError(409, 'core_payroll:carryover_source_not_approved');
  }
  if (targetPayrollMonth <= cleanText(sourceEntry.payroll_month)) {
    throw new AppError(400, 'core_payroll:carryover_target_must_be_future');
  }

  const snapshot = await ensureApprovalSnapshotExists(db, salonId, sourceEntry, actor);
  if (!snapshot) throw new AppError(409, 'core_payroll:approval_snapshot_missing');

  const desired = payrollCarryoverDelta(
    snapshot.approved_net_halalas,
    recalculatedNetHalalas
  );
  const rows = await dbAll(
    db,
    `SELECT *
       FROM payroll_carryover_adjustments
      WHERE salon_id = ?
        AND source_snapshot_id = ?
        AND status <> 'void'
      ORDER BY created_at`,
    [salonId, snapshot.id]
  );
  const appliedSigned = rows
    .filter((row) => cleanText(row.status) === 'applied')
    .reduce((total, row) => total + carryoverSignedAmount(row), 0);
  const pending = rows.find(
    (row) => cleanText(row.status) === 'pending' && cleanText(row.target_payroll_month) === targetPayrollMonth
  );
  const residualSigned = desired.signedDeltaHalalas - appliedSigned;
  const now = nowIso();
  const sourceDate = optionalText(data.sourceDate || data.source_date) || null;
  const reason = optionalText(data.reason) ||
    `تسوية فرق مسيرة ${sourceEntry.payroll_month} بعد إعادة الاحتساب النهائي للحضور والإجازات والخصومات.`;

  if (residualSigned === 0) {
    if (pending) {
      await dbRun(
        db,
        `UPDATE payroll_carryover_adjustments
            SET status = 'void', amount_halalas = 0,
                recalculated_net_halalas = ?, reason = ?, source_date = ?, updated_at = ?
          WHERE salon_id = ? AND id = ? AND status = 'pending'`,
        [recalculatedNetHalalas, reason, sourceDate, now, salonId, pending.id]
      );
    }
    return {
      sourcePayrollEntryId,
      sourcePayrollMonth: sourceEntry.payroll_month,
      targetPayrollMonth,
      employeeId: sourceEntry.employee_id,
      approvedNetHalalas: desired.approvedNetHalalas,
      recalculatedNetHalalas: desired.recalculatedNetHalalas,
      desiredSignedDeltaHalalas: desired.signedDeltaHalalas,
      appliedSignedHalalas: appliedSigned,
      residualSignedHalalas: 0,
      adjustment: null,
    };
  }

  const direction = residualSigned > 0 ? 'addition' : 'deduction';
  const amountHalalas = Math.abs(residualSigned);
  let adjustmentId = pending?.id || generatedId('payroll_carryover');
  if (pending) {
    await dbRun(
      db,
      `UPDATE payroll_carryover_adjustments
          SET direction = ?, amount_halalas = ?, approved_net_halalas = ?,
              recalculated_net_halalas = ?, reason = ?, source_date = ?, updated_at = ?
        WHERE salon_id = ? AND id = ? AND status = 'pending'`,
      [
        direction,
        amountHalalas,
        desired.approvedNetHalalas,
        recalculatedNetHalalas,
        reason,
        sourceDate,
        now,
        salonId,
        pending.id,
      ]
    );
  } else {
    await dbRun(
      db,
      `INSERT INTO payroll_carryover_adjustments
        (id, salon_id, employee_id, source_payroll_month, target_payroll_month,
         source_payroll_entry_id, source_snapshot_id, direction, amount_halalas,
         approved_net_halalas, recalculated_net_halalas, reason, source_date,
         status, target_payroll_entry_id, applied_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)`,
      [
        adjustmentId,
        salonId,
        sourceEntry.employee_id,
        sourceEntry.payroll_month,
        targetPayrollMonth,
        sourceEntry.id,
        snapshot.id,
        direction,
        amountHalalas,
        desired.approvedNetHalalas,
        recalculatedNetHalalas,
        reason,
        sourceDate,
        now,
        now,
      ]
    );
  }

  const adjustment = await dbFirst(
    db,
    `SELECT * FROM payroll_carryover_adjustments WHERE salon_id = ? AND id = ? LIMIT 1`,
    [salonId, adjustmentId]
  );
  return {
    sourcePayrollEntryId,
    sourcePayrollMonth: sourceEntry.payroll_month,
    targetPayrollMonth,
    employeeId: sourceEntry.employee_id,
    approvedNetHalalas: desired.approvedNetHalalas,
    recalculatedNetHalalas: desired.recalculatedNetHalalas,
    desiredSignedDeltaHalalas: desired.signedDeltaHalalas,
    appliedSignedHalalas: appliedSigned,
    residualSignedHalalas: residualSigned,
    adjustment,
  };
}

export async function reconcilePayrollCarryoversBatch(db, salonId, data = {}, actor = {}) {
  const items = Array.isArray(data.items) ? data.items : [];
  if (items.length > 200) throw new AppError(400, 'core_payroll:carryover_batch_too_large');
  const results = [];
  for (const item of items) {
    results.push(await reconcilePayrollCarryover(db, salonId, item, actor));
  }
  return { results };
}

export async function upsertPayrollEntry(db, salonId, data, actor = {}) {
  const employeeId = requiredId(data.employeeId || data.employee_id, 'employeeId');
  const payrollMonth = cleanText(data.payrollMonth || data.payroll_month);
  if (!/^\d{4}-\d{2}$/.test(payrollMonth)) {
    const error = new Error('invalid_payroll_month');
    error.code = 'core_payroll:invalid_month';
    throw error;
  }
  const existing = await dbFirst(db, 'SELECT * FROM payroll_entries WHERE salon_id = ? AND employee_id = ? AND payroll_month = ? LIMIT 1', [salonId, employeeId, payrollMonth]);
  if (existing && lockedStatus(existing.status) && data.allowLockedUpdate !== true) {
    throw new AppError(409, 'core_payroll:locked_entry');
  }
  const now = nowIso();
  const status = cleanStatus(data.status || existing?.status || 'draft');
  let targetBonus = null;
  if (!['approved', 'paid'].includes(cleanText(existing?.status || '')) && data.skipTargetBonus !== true) {
    try {
      targetBonus = await applyTargetBonusToPayrollData(db, salonId, {
        ...data,
        employeeId,
        payrollMonth,
      }, actor);
      data = {
        ...data,
        additions: targetBonus.additions,
        manualAdditionsHalalas: targetBonus.manualAdditionsHalalas,
        grossSalaryHalalas: targetBonus.grossSalaryHalalas,
        finalSalaryHalalas: targetBonus.finalSalaryHalalas,
        netSalaryHalalas: targetBonus.netSalaryHalalas,
      };
    } catch (error) {
      if (!targetSchemaUnavailable(error)) throw error;
    }
  }
  const submittedDeductions = Array.isArray(data.deductions)
    ? data.deductions
    : Array.isArray(data.salaryDeductions)
      ? data.salaryDeductions
      : parseJsonArray(data.deductions_json);
  if (submittedDeductions.some((item) => cleanText(item?.kind) === 'advance')) {
    throw new AppError(400, 'core_payroll:manual_advance_not_allowed');
  }

  const obligationCanonical = await canonicalizePayrollObligationDeductions(
    db,
    salonId,
    {
      ...data,
      employeeId,
      payrollMonth,
      deductions: submittedDeductions,
    },
    actor
  );
  const canonicalDeductions = obligationCanonical.deductions;
  const canonicalManualDeductionsHalalas = deductionItemsTotal(canonicalDeductions);

  const canonicalAdvanceRows = await listPayrollAdvanceDeductions(
    db,
    salonId,
    { employeeId, payrollMonth }
  );
  const canonicalAdvanceHalalas = Math.max(
    0,
    Number(canonicalAdvanceRows[0]?.amount_halalas || 0)
  );
  const canonicalGrossSalaryHalalas =
    intMoney(data.baseSalaryHalalas ?? data.base_salary_halalas) +
    intMoney(data.allowancesHalalas ?? data.allowances_halalas) +
    intMoney(data.manualAdditionsHalalas ?? data.manual_additions_halalas) +
    intMoney(data.overtimeValueHalalas ?? data.overtime_value_halalas);
  const submittedOtherDeductionsHalalas = intMoney(
    data.otherDeductionsHalalas ?? data.other_deductions_halalas
  );
  const submittedManualDeductionsHalalas = intMoney(
    data.manualDeductionsHalalas ?? data.manual_deductions_halalas
  );
  // `other_deductions_halalas` was historically used as an alias of manual deductions
  // by the web client. Equal values are one financial amount, not two deductions.
  const canonicalLegacyOtherDeductionsHalalas =
    submittedOtherDeductionsHalalas > 0 &&
    submittedOtherDeductionsHalalas !== submittedManualDeductionsHalalas
      ? submittedOtherDeductionsHalalas
      : 0;
  const canonicalTotalDeductionsHalalas =
    intMoney(data.absenceDeductionHalalas ?? data.absence_deduction_halalas) +
    intMoney(data.delayDeductionHalalas ?? data.delay_deduction_halalas) +
    intMoney(data.insuranceDeductionHalalas ?? data.insurance_deduction_halalas) +
    canonicalLegacyOtherDeductionsHalalas +
    intMoney(data.missingHoursDeductionHalalas ?? data.missing_hours_deduction_halalas) +
    canonicalManualDeductionsHalalas +
    canonicalAdvanceHalalas;
  const canonicalNetSalaryHalalas = Math.max(
    0,
    canonicalGrossSalaryHalalas - canonicalTotalDeductionsHalalas
  );
  data = {
    ...data,
    deductions: canonicalDeductions,
    otherDeductionsHalalas: canonicalLegacyOtherDeductionsHalalas,
    manualDeductionsHalalas: canonicalManualDeductionsHalalas,
    advancesHalalas: canonicalAdvanceHalalas,
    totalDeductionsHalalas: canonicalTotalDeductionsHalalas,
    grossSalaryHalalas: canonicalGrossSalaryHalalas,
    netSalaryHalalas: canonicalNetSalaryHalalas,
    finalSalaryHalalas: canonicalNetSalaryHalalas,
  };

  const overtimeEnabled = activeFlag(data.overtimeEnabled ?? data.overtime_enabled ?? existing?.overtime_enabled ?? 0);
  const auditLog = existing?.audit_log_json || jsonText([{ action: 'created', byUid: optionalText(actor.uid) || null, at: now }], []);
  const row = {
    id: existing?.id || requiredId(data.id || generatedId('payroll')),
    salon_id: salonId,
    period_id: optionalText(data.periodId || data.period_id) || null,
    employee_id: employeeId,
    payroll_month: payrollMonth,
    employee_name: optionalText(data.employeeName || data.employee_name) || existing?.employee_name || null,
    job_title: optionalText(data.jobTitle || data.job_title) || existing?.job_title || null,
    base_salary_halalas: intMoney(data.baseSalaryHalalas ?? data.base_salary_halalas),
    allowances_halalas: intMoney(data.allowancesHalalas ?? data.allowances_halalas),
    work_days: optionalNumber(data.workDays ?? data.work_days),
    monthly_hours: optionalNumber(data.monthlyHours ?? data.monthly_hours),
    daily_rate_halalas: intMoney(data.dailyRateHalalas ?? data.daily_rate_halalas),
    hourly_rate_halalas: intMoney(data.hourlyRateHalalas ?? data.hourly_rate_halalas),
    absence_days: Number(data.absenceDays ?? data.absence_days ?? 0) || 0,
    absence_deduction_halalas: intMoney(data.absenceDeductionHalalas ?? data.absence_deduction_halalas),
    expected_work_hours: data.expectedWorkHours ?? data.expected_work_hours ?? null,
    actual_worked_hours: data.actualWorkedHours ?? data.actual_worked_hours ?? null,
    missing_hours: data.missingHours ?? data.missing_hours ?? null,
    overtime_hours: data.overtimeHours ?? data.overtime_hours ?? null,
    attendance_summary_json: jsonText(data.attendanceSummary ?? data.attendance_summary, null),
    detected_extra_hours: numberValue(data.detectedExtraHours ?? data.detected_extra_hours, 0),
    overtime_enabled: overtimeEnabled,
    financial_overtime_hours: numberValue(data.financialOvertimeHours ?? data.financial_overtime_hours, 0),
    overtime_multiplier: numberValue(data.overtimeMultiplier ?? data.overtime_multiplier, 1.5),
    overtime_value_halalas: intMoney(data.overtimeValueHalalas ?? data.overtime_value_halalas),
    overtime_bonus_halalas: intMoney(data.overtimeBonusHalalas ?? data.overtime_bonus_halalas),
    delay_deduction_halalas: intMoney(data.delayDeductionHalalas ?? data.delay_deduction_halalas),
    insurance_deduction_halalas: intMoney(data.insuranceDeductionHalalas ?? data.insurance_deduction_halalas),
    gosi_insurance_category: optionalText(
      data.gosiInsuranceCategory ?? data.gosi_insurance_category
    ) || null,
    gosi_policy_version: optionalText(
      data.gosiPolicyVersion ?? data.gosi_policy_version
    ) || null,
    gosi_contributory_wage_halalas: intMoney(
      data.gosiContributoryWageHalalas ??
        data.gosi_contributory_wage_halalas
    ),
    employer_gosi_contribution_halalas: intMoney(
      data.employerGosiContributionHalalas ??
        data.employer_gosi_contribution_halalas
    ),
    gosi_snapshot_json:
      data.gosiSnapshot || data.gosi_snapshot
        ? JSON.stringify(data.gosiSnapshot ?? data.gosi_snapshot)
        : null,
    gosi_calculated_at: optionalText(
      data.gosiCalculatedAt ?? data.gosi_calculated_at
    ) || (data.gosiSnapshot || data.gosi_snapshot ? now : null),
    other_deductions_halalas: intMoney(data.otherDeductionsHalalas ?? data.other_deductions_halalas),
    missing_hours_deduction_halalas: intMoney(data.missingHoursDeductionHalalas ?? data.missing_hours_deduction_halalas),
    additions_json: jsonText(data.additions ?? data.additions_json, []),
    manual_additions_halalas: intMoney(data.manualAdditionsHalalas ?? data.manual_additions_halalas),
    manual_deductions_halalas: intMoney(data.manualDeductionsHalalas ?? data.manual_deductions_halalas),
    advances_halalas: intMoney(data.advancesHalalas ?? data.advances_halalas),
    total_deductions_halalas: intMoney(data.totalDeductionsHalalas ?? data.total_deductions_halalas),
    gross_salary_halalas: intMoney(data.grossSalaryHalalas ?? data.gross_salary_halalas),
    final_salary_halalas: intMoney(data.finalSalaryHalalas ?? data.final_salary_halalas),
    net_salary_halalas: intMoney(data.netSalaryHalalas ?? data.net_salary_halalas ?? data.finalSalaryHalalas ?? data.final_salary_halalas),
    schedule_snapshot_json: JSON.stringify(data.scheduleSnapshot ?? data.schedule_snapshot ?? null),
    absence_entries_json: JSON.stringify(data.absenceEntries ?? data.absence_entries ?? []),
    deductions_json: JSON.stringify(data.deductions ?? data.salaryDeductions ?? []),
    mudad_file_id: optionalText(data.mudadFileId || data.mudad_file_id) || null,
    status,
    approved_at: data.approvedAt === undefined ? existing?.approved_at || null : optionalText(data.approvedAt) || null,
    approved_by_uid: data.approvedByUid === undefined ? existing?.approved_by_uid || null : optionalText(data.approvedByUid) || null,
    paid_at: data.paidAt === undefined ? existing?.paid_at || null : optionalText(data.paidAt) || null,
    paid_by_uid: data.paidByUid === undefined ? existing?.paid_by_uid || null : optionalText(data.paidByUid) || null,
    notes: optionalText(data.notes) || existing?.notes || null,
    audit_log_json: data.auditLog ? jsonText(data.auditLog, []) : auditLog,
    created_by_uid: existing?.created_by_uid || optionalText(actor.uid) || null,
    created_by_email: existing?.created_by_email || optionalText(actor.email) || null,
    created_at: existing?.created_at || now,
    updated_at: now,
  };
  if (['approved', 'paid'].includes(status)) {
    await assertPayrollApprovalReady(
      db,
      salonId,
      row,
      {
        validateCanonicalPolicy: true,
      }
    );
  }
  await dbRun(db, `INSERT INTO payroll_entries
    (id, salon_id, period_id, employee_id, payroll_month, employee_name, job_title,
     base_salary_halalas, allowances_halalas, work_days, monthly_hours, daily_rate_halalas,
     hourly_rate_halalas, absence_days, absence_deduction_halalas, expected_work_hours,
     actual_worked_hours, missing_hours, overtime_hours, attendance_summary_json,
     detected_extra_hours, overtime_enabled, financial_overtime_hours, overtime_multiplier,
     overtime_value_halalas, overtime_bonus_halalas, delay_deduction_halalas,
     insurance_deduction_halalas, gosi_insurance_category, gosi_policy_version,
     gosi_contributory_wage_halalas, employer_gosi_contribution_halalas, gosi_snapshot_json,
     gosi_calculated_at, other_deductions_halalas, missing_hours_deduction_halalas,
     additions_json, manual_additions_halalas, manual_deductions_halalas, advances_halalas,
     total_deductions_halalas, gross_salary_halalas, final_salary_halalas, net_salary_halalas,
     schedule_snapshot_json, absence_entries_json, deductions_json, mudad_file_id, status,
     approved_at, approved_by_uid, paid_at, paid_by_uid, notes, audit_log_json,
     created_by_uid, created_by_email, created_at, updated_at)
    VALUES (${Object.keys(row).map(() => '?').join(', ')})
    ON CONFLICT(salon_id, employee_id, payroll_month) DO UPDATE SET
      period_id = excluded.period_id, employee_name = excluded.employee_name, job_title = excluded.job_title,
      base_salary_halalas = excluded.base_salary_halalas,
      allowances_halalas = excluded.allowances_halalas, work_days = excluded.work_days,
      monthly_hours = excluded.monthly_hours, daily_rate_halalas = excluded.daily_rate_halalas,
      hourly_rate_halalas = excluded.hourly_rate_halalas, absence_days = excluded.absence_days,
      absence_deduction_halalas = excluded.absence_deduction_halalas,
      expected_work_hours = excluded.expected_work_hours, actual_worked_hours = excluded.actual_worked_hours,
      missing_hours = excluded.missing_hours, overtime_hours = excluded.overtime_hours,
      attendance_summary_json = excluded.attendance_summary_json,
      detected_extra_hours = excluded.detected_extra_hours, overtime_enabled = excluded.overtime_enabled,
      financial_overtime_hours = excluded.financial_overtime_hours,
      overtime_multiplier = excluded.overtime_multiplier,
      overtime_value_halalas = excluded.overtime_value_halalas,
      overtime_bonus_halalas = excluded.overtime_bonus_halalas,
      delay_deduction_halalas = excluded.delay_deduction_halalas,
      insurance_deduction_halalas = excluded.insurance_deduction_halalas,
      gosi_insurance_category = excluded.gosi_insurance_category,
      gosi_policy_version = excluded.gosi_policy_version,
      gosi_contributory_wage_halalas = excluded.gosi_contributory_wage_halalas,
      employer_gosi_contribution_halalas = excluded.employer_gosi_contribution_halalas,
      gosi_snapshot_json = excluded.gosi_snapshot_json,
      gosi_calculated_at = excluded.gosi_calculated_at,
      other_deductions_halalas = excluded.other_deductions_halalas,
      missing_hours_deduction_halalas = excluded.missing_hours_deduction_halalas,
      additions_json = excluded.additions_json,
      manual_additions_halalas = excluded.manual_additions_halalas,
      manual_deductions_halalas = excluded.manual_deductions_halalas,
      advances_halalas = excluded.advances_halalas,
      total_deductions_halalas = excluded.total_deductions_halalas,
      gross_salary_halalas = excluded.gross_salary_halalas, final_salary_halalas = excluded.final_salary_halalas,
      net_salary_halalas = excluded.net_salary_halalas,
      schedule_snapshot_json = excluded.schedule_snapshot_json,
      absence_entries_json = excluded.absence_entries_json, deductions_json = excluded.deductions_json,
      mudad_file_id = excluded.mudad_file_id, status = excluded.status,
      approved_at = excluded.approved_at, approved_by_uid = excluded.approved_by_uid,
      paid_at = excluded.paid_at, paid_by_uid = excluded.paid_by_uid, notes = excluded.notes,
      audit_log_json = excluded.audit_log_json, updated_at = excluded.updated_at`, Object.values(row));
  const saved = await dbFirst(db, 'SELECT * FROM payroll_entries WHERE salon_id = ? AND employee_id = ? AND payroll_month = ? LIMIT 1', [salonId, employeeId, payrollMonth]);
  if (saved?.id) {
    await dbRun(
      db,
      `UPDATE salary_advance_installments
          SET payroll_entry_id = ?, updated_at = ?
        WHERE salon_id = ?
          AND payroll_month = ?
          AND status = 'scheduled'
          AND advance_id IN (
            SELECT id
              FROM salary_advances
             WHERE salon_id = ?
               AND employee_id = ?
          )`,
      [saved.id, nowIso(), salonId, payrollMonth, salonId, employeeId]
    );
  }

  if (targetBonus?.targetSummary?.id && saved?.id) {
    await dbRun(
      db,
      `UPDATE employee_target_period_summaries
          SET payroll_entry_id = ?, status = CASE WHEN status = 'open' THEN 'posted_to_payroll' ELSE status END,
              updated_at = ?
        WHERE salon_id = ? AND id = ?`,
      [saved.id, nowIso(), salonId, targetBonus.targetSummary.id]
    ).catch((error) => {
      if (!targetSchemaUnavailable(error)) throw error;
    });
  }
  return saved;
}

export async function updatePayrollEntryAdjustments(db, salonId, id, data, actor = {}) {
  const existing = await getPayrollEntry(db, salonId, id);
  if (lockedStatus(existing.status)) throw new AppError(409, 'core_payroll:locked_entry');
  return upsertPayrollEntry(db, salonId, {
    ...data,
    id: existing.id,
    employeeId: existing.employee_id,
    payrollMonth: existing.payroll_month,
    periodId: existing.period_id,
    status: existing.status || 'draft',
    auditLog: parseJsonArray(existing.audit_log_json).concat({
      action: 'adjusted',
      byUid: optionalText(actor.uid) || null,
      byEmail: optionalText(actor.email) || null,
      at: nowIso(),
    }),
  }, actor);
}

export async function togglePayrollOvertime(db, salonId, id, data, actor = {}) {
  const existing = await getPayrollEntry(db, salonId, id);
  if (lockedStatus(existing.status)) throw new AppError(409, 'core_payroll:locked_entry');
  return upsertPayrollEntry(db, salonId, {
    ...data,
    id: existing.id,
    employeeId: existing.employee_id,
    payrollMonth: existing.payroll_month,
    periodId: existing.period_id,
    status: existing.status || 'draft',
    auditLog: parseJsonArray(existing.audit_log_json).concat({
      action: activeFlag(data.overtimeEnabled ?? data.overtime_enabled) ? 'overtime_enabled' : 'overtime_disabled',
      byUid: optionalText(actor.uid) || null,
      byEmail: optionalText(actor.email) || null,
      at: nowIso(),
    }),
  }, actor);
}

export async function approvePayrollEntry(db, salonId, id, actor = {}) {
  const existing = await getPayrollEntry(db, salonId, id);
  if (cleanText(existing.status) === 'paid') throw new AppError(409, 'core_payroll:already_paid');
  if (cleanText(existing.status) === 'approved') return existing;
  await assertPayrollApprovalReady(
    db,
    salonId,
    existing,
    {
      validateCanonicalPolicy: true,
    }
  );
  await assertPayrollObligationSnapshotCurrent(db, salonId, existing);
  const now = nowIso();
  try {
    await approveEmployeeTargetSummary(db, salonId, {
      employeeId: existing.employee_id,
      payrollMonth: existing.payroll_month,
      periodId: existing.period_id,
    }, actor, existing.id);
  } catch (error) {
    if (!targetSchemaUnavailable(error)) throw error;
  }

  const snapshotStatement = await buildApprovalSnapshotStatement(db, salonId, existing, actor, now);
  const statements = [
    { sql: snapshotStatement.sql, params: snapshotStatement.params },
    {
      sql: `UPDATE payroll_entries
         SET status = 'approved', approved_at = COALESCE(approved_at, ?),
             approved_by_uid = COALESCE(approved_by_uid, ?), audit_log_json = ?, updated_at = ?
       WHERE salon_id = ? AND id = ?`,
      params: [now, optionalText(actor.uid) || null, appendAudit(existing, 'approved', actor), now, salonId, existing.id],
    },
  ];

  for (const carryoverId of carryoverSourceIds(existing)) {
    statements.push({
      sql: `UPDATE payroll_carryover_adjustments
               SET status = 'applied', target_payroll_entry_id = ?, applied_at = ?, updated_at = ?
             WHERE salon_id = ?
               AND id = ?
               AND target_payroll_month = ?
               AND status = 'pending'`,
      params: [existing.id, now, now, salonId, carryoverId, existing.payroll_month],
    });
  }

  await dbBatch(db, statements);
  return getPayrollEntry(db, salonId, existing.id);
}

export async function reopenPayrollEntry(db, salonId, id, data = {}, actor = {}) {
  const existing = await getPayrollEntry(db, salonId, id);
  const currentStatus = cleanText(existing.status || 'draft');
  if (currentStatus === 'paid') throw new AppError(409, 'core_payroll:paid_reopen_not_allowed');
  if (currentStatus !== 'approved') throw new AppError(409, 'core_payroll:not_approved');

  const nextStatus = cleanStatus(data.status || data.nextStatus || data.next_status || 'draft');
  if (!['draft', 'reviewed'].includes(nextStatus)) {
    throw new AppError(400, 'core_payroll:invalid_reopen_status');
  }

  const now = nowIso();
  const reason = optionalText(data.reason) || 'recalculate_approved_payroll';
  await dbRun(
    db,
    `UPDATE payroll_entries
       SET status = ?, approved_at = NULL, approved_by_uid = NULL,
           audit_log_json = ?, updated_at = ?
     WHERE salon_id = ? AND id = ?`,
    [
      nextStatus,
      appendAuditEntry(existing, {
        action: 'reopened',
        byUid: optionalText(actor.uid) || null,
        byEmail: optionalText(actor.email) || null,
        at: now,
        reason,
        previousStatus: currentStatus,
        previousApprovedAt: existing.approved_at || null,
        previousApprovedByUid: existing.approved_by_uid || null,
      }),
      now,
      salonId,
      existing.id,
    ]
  );
  return getPayrollEntry(db, salonId, existing.id);
}

export async function markPayrollEntryPaid(db, salonId, id, actor = {}) {
  const existing = await getPayrollEntry(db, salonId, id);
  if (cleanText(existing.status) === 'paid') return existing;
  if (cleanText(existing.status) !== 'approved') throw new AppError(409, 'core_payroll:not_approved');
  await assertPayrollApprovalReady(
    db,
    salonId,
    existing,
    {
      validateCanonicalPolicy: false,
    }
  );
  await ensureApprovalSnapshotExists(db, salonId, existing, actor);
  const now = nowIso();
  const installments = await dbAll(
    db,
    `SELECT sai.advance_id, COALESCE(SUM(sai.amount_halalas), 0) AS amount_halalas
       FROM salary_advance_installments sai
       JOIN salary_advances sa
         ON sa.salon_id = sai.salon_id
        AND sa.id = sai.advance_id
      WHERE sai.salon_id = ?
        AND sa.employee_id = ?
        AND sai.payroll_month = ?
        AND sai.status = 'scheduled'
      GROUP BY sai.advance_id`,
    [salonId, existing.employee_id, existing.payroll_month]
  );
  const scheduledAdvanceHalalas = installments.reduce(
    (total, installment) => total + Math.max(0, Number(installment.amount_halalas || 0)),
    0
  );
  if (scheduledAdvanceHalalas !== Math.max(0, Number(existing.advances_halalas || 0))) {
    throw new AppError(409, 'core_payroll:advance_deduction_mismatch');
  }

  const obligationStatements = await payrollObligationPaidStatements(
    db,
    salonId,
    existing,
    now
  );

  const statements = [
    {
      sql: `UPDATE payroll_entries
               SET status = 'paid',
                   approved_at = COALESCE(approved_at, ?),
                   approved_by_uid = COALESCE(approved_by_uid, ?),
                   paid_at = COALESCE(paid_at, ?),
                   paid_by_uid = COALESCE(paid_by_uid, ?),
                   audit_log_json = ?,
                   updated_at = ?
             WHERE salon_id = ?
               AND id = ?
               AND status = 'approved'`,
      params: [
        now,
        optionalText(actor.uid) || null,
        now,
        optionalText(actor.uid) || null,
        appendAudit(existing, 'paid', actor),
        now,
        salonId,
        existing.id,
      ],
    },
  ];

  for (const installment of installments) {
    const amount = Math.max(0, Number(installment.amount_halalas || 0));
    statements.push(
      {
        sql: `UPDATE salary_advances
                 SET paid_halalas = MIN(approved_halalas, paid_halalas + ?),
                     remaining_halalas = MAX(0, remaining_halalas - ?),
                     payment_status = CASE
                       WHEN remaining_halalas <= ? THEN 'repaid'
                       ELSE 'partially_repaid'
                     END,
                     updated_at = ?
               WHERE salon_id = ?
                 AND id = ?
                 AND EXISTS (
                   SELECT 1
                     FROM salary_advance_installments
                    WHERE salon_id = ?
                      AND advance_id = ?
                      AND payroll_month = ?
                      AND status = 'scheduled'
                 )`,
        params: [
          amount,
          amount,
          amount,
          now,
          salonId,
          installment.advance_id,
          salonId,
          installment.advance_id,
          existing.payroll_month,
        ],
      },
      {
        sql: `UPDATE salary_advance_installments
                 SET status = 'deducted',
                     payroll_entry_id = ?,
                     deducted_at = ?,
                     updated_at = ?
               WHERE salon_id = ?
                 AND advance_id = ?
                 AND payroll_month = ?
                 AND status = 'scheduled'`,
        params: [
          existing.id,
          now,
          now,
          salonId,
          installment.advance_id,
          existing.payroll_month,
        ],
      }
    );
  }

  statements.push(...obligationStatements);
  await dbBatch(db, statements);
  return getPayrollEntry(db, salonId, existing.id);
}
