// CORE D1 ONLY — do not add Firestore fallback.
// Firebase is allowed only for authentication token verification.

import {
  cleanText,
  dbAll,
  dbFirst,
  dbRun,
  generatedId,
  nowIso,
  optionalText,
  requiredId,
  validDate,
} from '../d1.js';
import { AppError } from '../errors.js';

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
  await dbRun(db, `INSERT INTO payroll_entries
    (id, salon_id, period_id, employee_id, payroll_month, employee_name, job_title,
     base_salary_halalas, allowances_halalas, work_days, monthly_hours, daily_rate_halalas,
     hourly_rate_halalas, absence_days, absence_deduction_halalas, expected_work_hours,
     actual_worked_hours, missing_hours, overtime_hours, attendance_summary_json,
     detected_extra_hours, overtime_enabled, financial_overtime_hours, overtime_multiplier,
     overtime_value_halalas, overtime_bonus_halalas, delay_deduction_halalas,
     insurance_deduction_halalas, other_deductions_halalas, missing_hours_deduction_halalas,
     additions_json, manual_additions_halalas, manual_deductions_halalas, advances_halalas,
     total_deductions_halalas, gross_salary_halalas, final_salary_halalas, net_salary_halalas,
     schedule_snapshot_json, absence_entries_json, deductions_json, mudad_file_id, status,
     approved_at, approved_by_uid, paid_at, paid_by_uid, notes, audit_log_json,
     created_by_uid, created_by_email, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  return dbFirst(db, 'SELECT * FROM payroll_entries WHERE salon_id = ? AND employee_id = ? AND payroll_month = ? LIMIT 1', [salonId, employeeId, payrollMonth]);
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
  const now = nowIso();
  await dbRun(
    db,
    `UPDATE payroll_entries
       SET status = 'approved', approved_at = COALESCE(approved_at, ?),
           approved_by_uid = COALESCE(approved_by_uid, ?), audit_log_json = ?, updated_at = ?
     WHERE salon_id = ? AND id = ?`,
    [now, optionalText(actor.uid) || null, appendAudit(existing, 'approved', actor), now, salonId, existing.id]
  );
  return getPayrollEntry(db, salonId, existing.id);
}

export async function markPayrollEntryPaid(db, salonId, id, actor = {}) {
  const existing = await getPayrollEntry(db, salonId, id);
  if (cleanText(existing.status) === 'paid') return existing;
  const now = nowIso();
  await dbRun(
    db,
    `UPDATE payroll_entries
       SET status = 'paid',
           approved_at = COALESCE(approved_at, ?),
           approved_by_uid = COALESCE(approved_by_uid, ?),
           paid_at = COALESCE(paid_at, ?), paid_by_uid = COALESCE(paid_by_uid, ?),
           audit_log_json = ?, updated_at = ?
     WHERE salon_id = ? AND id = ?`,
    [
      now,
      optionalText(actor.uid) || null,
      now,
      optionalText(actor.uid) || null,
      appendAudit(existing, 'paid', actor),
      now,
      salonId,
      existing.id,
    ]
  );
  return getPayrollEntry(db, salonId, existing.id);
}
