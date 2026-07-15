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

function intMoney(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) {
    const error = new Error('invalid_money');
    error.code = 'core_payroll:invalid_money';
    throw error;
  }
  return Math.round(number);
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
  if (employeeId) rows = rows.filter((row) => row.employee_id === employeeId);
  if (payrollMonth) rows = rows.filter((row) => row.payroll_month === payrollMonth);
  return rows;
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
  const now = nowIso();
  const row = {
    id: existing?.id || requiredId(data.id || generatedId('payroll')),
    salon_id: salonId,
    period_id: optionalText(data.periodId || data.period_id) || null,
    employee_id: employeeId,
    payroll_month: payrollMonth,
    base_salary_halalas: intMoney(data.baseSalaryHalalas ?? data.base_salary_halalas),
    allowances_halalas: intMoney(data.allowancesHalalas ?? data.allowances_halalas),
    absence_days: Number(data.absenceDays ?? data.absence_days ?? 0) || 0,
    absence_deduction_halalas: intMoney(data.absenceDeductionHalalas ?? data.absence_deduction_halalas),
    expected_work_hours: data.expectedWorkHours ?? data.expected_work_hours ?? null,
    actual_worked_hours: data.actualWorkedHours ?? data.actual_worked_hours ?? null,
    missing_hours: data.missingHours ?? data.missing_hours ?? null,
    overtime_hours: data.overtimeHours ?? data.overtime_hours ?? null,
    overtime_bonus_halalas: intMoney(data.overtimeBonusHalalas ?? data.overtime_bonus_halalas),
    delay_deduction_halalas: intMoney(data.delayDeductionHalalas ?? data.delay_deduction_halalas),
    insurance_deduction_halalas: intMoney(data.insuranceDeductionHalalas ?? data.insurance_deduction_halalas),
    other_deductions_halalas: intMoney(data.otherDeductionsHalalas ?? data.other_deductions_halalas),
    gross_salary_halalas: intMoney(data.grossSalaryHalalas ?? data.gross_salary_halalas),
    final_salary_halalas: intMoney(data.finalSalaryHalalas ?? data.final_salary_halalas),
    schedule_snapshot_json: JSON.stringify(data.scheduleSnapshot ?? data.schedule_snapshot ?? null),
    absence_entries_json: JSON.stringify(data.absenceEntries ?? data.absence_entries ?? []),
    deductions_json: JSON.stringify(data.deductions ?? data.salaryDeductions ?? []),
    mudad_file_id: optionalText(data.mudadFileId || data.mudad_file_id) || null,
    created_by_uid: existing?.created_by_uid || optionalText(actor.uid) || null,
    created_by_email: existing?.created_by_email || optionalText(actor.email) || null,
    created_at: existing?.created_at || now,
    updated_at: now,
  };
  await dbRun(db, `INSERT INTO payroll_entries
    (id, salon_id, period_id, employee_id, payroll_month, base_salary_halalas, allowances_halalas,
     absence_days, absence_deduction_halalas, expected_work_hours, actual_worked_hours, missing_hours,
     overtime_hours, overtime_bonus_halalas, delay_deduction_halalas, insurance_deduction_halalas,
     other_deductions_halalas, gross_salary_halalas, final_salary_halalas, schedule_snapshot_json,
     absence_entries_json, deductions_json, mudad_file_id, created_by_uid, created_by_email, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(salon_id, employee_id, payroll_month) DO UPDATE SET
      period_id = excluded.period_id, base_salary_halalas = excluded.base_salary_halalas,
      allowances_halalas = excluded.allowances_halalas, absence_days = excluded.absence_days,
      absence_deduction_halalas = excluded.absence_deduction_halalas,
      expected_work_hours = excluded.expected_work_hours, actual_worked_hours = excluded.actual_worked_hours,
      missing_hours = excluded.missing_hours, overtime_hours = excluded.overtime_hours,
      overtime_bonus_halalas = excluded.overtime_bonus_halalas,
      delay_deduction_halalas = excluded.delay_deduction_halalas,
      insurance_deduction_halalas = excluded.insurance_deduction_halalas,
      other_deductions_halalas = excluded.other_deductions_halalas,
      gross_salary_halalas = excluded.gross_salary_halalas, final_salary_halalas = excluded.final_salary_halalas,
      schedule_snapshot_json = excluded.schedule_snapshot_json,
      absence_entries_json = excluded.absence_entries_json, deductions_json = excluded.deductions_json,
      mudad_file_id = excluded.mudad_file_id, updated_at = excluded.updated_at`, Object.values(row));
  return dbFirst(db, 'SELECT * FROM payroll_entries WHERE salon_id = ? AND employee_id = ? AND payroll_month = ? LIMIT 1', [salonId, employeeId, payrollMonth]);
}
