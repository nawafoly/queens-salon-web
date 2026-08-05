// CORE D1 ONLY — do not add Firestore fallback.
// Firebase is allowed only for authentication token verification.

import {
  activeFlag,
  cleanText,
  dbAll,
  dbBatch,
  dbFirst,
  generatedId,
  integer,
  normalizePhone,
  nowIso,
  optionalText,
  requiredId,
  requiredText,
  rowNotFound,
  validDate,
} from '../d1.js';

function moneyHalalas(value, field) {
  if (value === undefined || value === null || value === '') return 0;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    const error = new Error(`${field}_invalid`);
    error.code = 'core_hr:invalid_money';
    throw error;
  }
  return Number.isInteger(numeric) ? numeric : Math.round(numeric * 100);
}

function jsonArray(value) {
  if (Array.isArray(value)) return JSON.stringify(value.map((item) => cleanText(item)).filter(Boolean));
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return JSON.stringify(parsed);
    } catch {}
  }
  return '[]';
}

function optionalNumber(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    const error = new Error(`${field}_invalid`);
    error.code = 'core_hr:invalid_number';
    throw error;
  }
  return Math.round(numeric * 100) / 100;
}

function positiveNumber(value, fallback, field) {
  if (value === undefined || value === null || value === '') return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    const error = new Error(`${field}_invalid`);
    error.code = 'core_hr:invalid_number';
    throw error;
  }
  return Math.round(numeric * 100) / 100;
}

function payrollDeductionMethod(value) {
  const clean = cleanText(value).toLowerCase();
  return clean === 'daily' ? 'daily' : 'hourly';
}

async function employmentFor(db, salonId, employeeId) {
  return dbFirst(
    db,
    'SELECT * FROM employee_employment WHERE salon_id = ? AND employee_id = ? LIMIT 1',
    [salonId, employeeId]
  );
}

async function schedulesFor(db, salonId, employeeId) {
  return dbAll(
    db,
    `SELECT s.*, t.name AS shift_name, t.code AS shift_code,
      t.start_time AS template_start_time, t.end_time AS template_end_time,
      t.late_grace_minutes, 0 AS early_leave_grace_minutes,
      t.attendance_lock_enabled, t.attendance_lock_after_minutes
     FROM hr_work_schedules s
     LEFT JOIN hr_shift_templates t ON t.id = s.shift_template_id AND t.salon_id = s.salon_id
     WHERE s.salon_id = ? AND s.employee_id = ?
     ORDER BY s.weekday, COALESCE(s.effective_from, '0000-01-01') DESC`,
    [salonId, employeeId]
  );
}

export async function getHrEmployee(db, salonId, id) {
  const employeeId = requiredId(id);
  const profile = await dbFirst(
    db,
    'SELECT * FROM employee_profiles WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, employeeId]
  );
  if (!profile) rowNotFound('employee');
  const [employment, schedules] = await Promise.all([
    employmentFor(db, salonId, employeeId),
    schedulesFor(db, salonId, employeeId),
  ]);
  return { ...profile, employment, schedules };
}

export async function listHrEmployees(db, salonId, query = {}) {
  const rows = await dbAll(
    db,
    'SELECT * FROM employee_profiles WHERE salon_id = ? ORDER BY status, name LIMIT 1000',
    [salonId]
  );
  const search = cleanText(query.search || query.q).toLowerCase();
  const status = cleanText(query.status).toLowerCase();
  const filtered = rows.filter((row) => {
    if (status && cleanText(row.status).toLowerCase() !== status) return false;
    if (!search) return true;
    return [row.id, row.firebase_uid, row.name, row.email, row.phone_normalized]
      .some((value) => cleanText(value).toLowerCase().includes(search));
  });
  return Promise.all(filtered.map((row) => getHrEmployee(db, salonId, row.id)));
}

export async function upsertHrEmployee(db, salonId, data, actor = {}) {
  const now = nowIso();
  const id = requiredId(data.id || data.employeeId || generatedId('employee'));
  const existing = await dbFirst(
    db,
    'SELECT id, created_at FROM employee_profiles WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, id]
  );
  const profile = {
    id,
    salon_id: salonId,
    firebase_uid: optionalText(data.firebaseUid || data.employeeUid || data.uid) || null,
    name: requiredText(data.name || data.personal?.name, 'name'),
    email: optionalText(data.email || data.personal?.email) || null,
    phone_normalized: normalizePhone(data.phone || data.personal?.phone) || null,
    avatar_file_id: optionalText(data.avatarFileId || data.avatar_file_id) || null,
    status: cleanText(data.status || data.employment?.status || 'active'),
    created_at: existing?.created_at || now,
    updated_at: now,
  };
  const employmentInput = data.employment || data;
  const employment = {
    salon_id: salonId,
    employee_id: id,
    title: optionalText(employmentInput.title) || null,
    job_title: optionalText(employmentInput.jobTitle || employmentInput.job_title) || null,
    department: optionalText(employmentInput.department) || null,
    employment_source: optionalText(employmentInput.employmentSource || employmentInput.employment_source) || 'salon',
    partner_id: optionalText(employmentInput.partnerId || employmentInput.partner_id) || null,
    partner_member_id: optionalText(employmentInput.partnerMemberId || employmentInput.partner_member_id) || null,
    contract_id: optionalText(employmentInput.contractId || employmentInput.contract_id) || null,
    start_date: optionalText(employmentInput.startDate || employmentInput.start_date) || null,
    leave_balance: Number(employmentInput.leaveBalance ?? employmentInput.leave_balance ?? 0) || 0,
    base_salary_halalas: moneyHalalas(employmentInput.baseSalaryHalalas ?? employmentInput.base_salary_halalas ?? employmentInput.baseSalary, 'baseSalary'),
    housing_allowance_halalas: moneyHalalas(employmentInput.housingAllowanceHalalas ?? employmentInput.housing_allowance_halalas ?? employmentInput.housingAllowance, 'housingAllowance'),
    transportation_allowance_halalas: moneyHalalas(employmentInput.transportationAllowanceHalalas ?? employmentInput.transportation_allowance_halalas ?? employmentInput.transportationAllowance, 'transportationAllowance'),
    other_allowances_halalas: moneyHalalas(employmentInput.otherAllowancesHalalas ?? employmentInput.other_allowances_halalas ?? employmentInput.otherAllowances ?? employmentInput.allowances, 'otherAllowances'),
    expected_work_days: employmentInput.expectedWorkDays ?? employmentInput.expected_work_days ?? null,
    expected_work_hours: employmentInput.expectedWorkHours ?? employmentInput.expected_work_hours ?? null,
    daily_scheduled_hours: optionalNumber(
      employmentInput.dailyScheduledHours ??
        employmentInput.daily_scheduled_hours ??
        employmentInput.expectedDailyHours ??
        employmentInput.expected_daily_hours,
      'dailyScheduledHours'
    ),
    overtime_enabled: activeFlag(
      employmentInput.overtimeEnabled ??
        employmentInput.overtime_enabled ??
        employmentInput.payrollOvertimeEnabled ??
        employmentInput.payroll_overtime_enabled,
      0
    ),
    overtime_multiplier: positiveNumber(
      employmentInput.overtimeMultiplier ?? employmentInput.overtime_multiplier,
      1.5,
      'overtimeMultiplier'
    ),
    payroll_deduction_method: payrollDeductionMethod(
      employmentInput.payrollDeductionMethod ?? employmentInput.payroll_deduction_method
    ),
    shift_start_time: optionalText(employmentInput.shiftStartTime || employmentInput.shift_start_time) || null,
    shift_end_time: optionalText(employmentInput.shiftEndTime || employmentInput.shift_end_time) || null,
    weekly_off_days_json: jsonArray(employmentInput.weeklyOffDays || employmentInput.weekly_off_days_json),
    allowed_zone_ids_json: jsonArray(employmentInput.allowedZoneIds || employmentInput.allowed_zone_ids_json),
    employment_status: cleanText(employmentInput.employmentStatus || employmentInput.employment_status || employmentInput.status || 'active'),
    employee_code: optionalText(employmentInput.employeeCode || employmentInput.employee_code) || null,
    fingerprint_number: optionalText(employmentInput.fingerprintNumber || employmentInput.fingerprint_number) || null,
    admin_notes: optionalText(employmentInput.adminNotes || employmentInput.admin_notes) || null,
    updated_by_uid: optionalText(actor.uid) || null,
    updated_by_email: optionalText(actor.email) || null,
    created_at: now,
    updated_at: now,
  };

  await dbBatch(db, [
    {
      sql: `INSERT INTO employee_profiles
        (id, salon_id, firebase_uid, name, email, phone_normalized, avatar_file_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
        firebase_uid = excluded.firebase_uid, name = excluded.name, email = excluded.email,
        phone_normalized = excluded.phone_normalized, avatar_file_id = excluded.avatar_file_id,
        status = excluded.status, updated_at = excluded.updated_at`,
      params: Object.values(profile),
    },
    {
      sql: `INSERT INTO employee_employment
        (salon_id, employee_id, title, job_title, department, employment_source, partner_id, partner_member_id,
         contract_id, start_date, leave_balance, base_salary_halalas, housing_allowance_halalas,
         transportation_allowance_halalas, other_allowances_halalas, expected_work_days, expected_work_hours,
         daily_scheduled_hours, overtime_enabled, overtime_multiplier, payroll_deduction_method,
         shift_start_time, shift_end_time, weekly_off_days_json, allowed_zone_ids_json, employment_status,
         employee_code, fingerprint_number, admin_notes, updated_by_uid, updated_by_email, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(salon_id, employee_id) DO UPDATE SET
        title = excluded.title, job_title = excluded.job_title, department = excluded.department,
        employment_source = excluded.employment_source, partner_id = excluded.partner_id,
        partner_member_id = excluded.partner_member_id, contract_id = excluded.contract_id,
        start_date = excluded.start_date, leave_balance = excluded.leave_balance,
        base_salary_halalas = excluded.base_salary_halalas,
        housing_allowance_halalas = excluded.housing_allowance_halalas,
        transportation_allowance_halalas = excluded.transportation_allowance_halalas,
        other_allowances_halalas = excluded.other_allowances_halalas,
        expected_work_days = excluded.expected_work_days, expected_work_hours = excluded.expected_work_hours,
        daily_scheduled_hours = excluded.daily_scheduled_hours,
        overtime_enabled = excluded.overtime_enabled,
        overtime_multiplier = excluded.overtime_multiplier,
        payroll_deduction_method = excluded.payroll_deduction_method,
        shift_start_time = excluded.shift_start_time, shift_end_time = excluded.shift_end_time,
        weekly_off_days_json = excluded.weekly_off_days_json, allowed_zone_ids_json = excluded.allowed_zone_ids_json,
        employment_status = excluded.employment_status, employee_code = excluded.employee_code,
        fingerprint_number = excluded.fingerprint_number, admin_notes = excluded.admin_notes,
        updated_by_uid = excluded.updated_by_uid, updated_by_email = excluded.updated_by_email,
        updated_at = excluded.updated_at`,
      params: Object.values(employment),
    },
  ]);
  return getHrEmployee(db, salonId, id);
}

function previousDateKey(value) {
  const [year, month, day] = validDate(value, 'effectiveFrom').split('-').map(Number);
  const previous = new Date(Date.UTC(year, month - 1, day) - 86400000);
  return previous.toISOString().slice(0, 10);
}

export async function replaceHrSchedules(db, salonId, employeeIdValue, schedules = []) {
  const employeeId = requiredId(employeeIdValue, 'employeeId');
  const now = nowIso();
  const normalizedSchedules = [];
  const weekdays = new Set();

  for (const schedule of Array.isArray(schedules) ? schedules : []) {
    const active = activeFlag(schedule.active, 1);
    const requestedTemplateId = optionalText(schedule.shiftTemplateId || schedule.shift_template_id) || null;
    const shiftTemplateId = active === 1 ? requestedTemplateId : null;
    let template = null;
    if (active === 1) {
      if (!shiftTemplateId) {
        const error = new Error('shift_template_required_for_workday');
        error.code = 'core_hr:shift_template_required_for_workday';
        throw error;
      }
      template = await dbFirst(
        db,
        'SELECT * FROM hr_shift_templates WHERE salon_id = ? AND id = ? LIMIT 1',
        [salonId, shiftTemplateId]
      );
      if (!template) rowNotFound('shift_template');
    }

    const weekday = integer(schedule.weekday, 'weekday', { min: 0, max: 6 });
    if (weekdays.has(weekday)) {
      const error = new Error('duplicate_schedule_weekday');
      error.code = 'core_hr:duplicate_schedule_weekday';
      throw error;
    }
    weekdays.add(weekday);

    const effectiveFromRaw = optionalText(schedule.effectiveFrom || schedule.effective_from);
    const effectiveToRaw = optionalText(schedule.effectiveTo || schedule.effective_to);
    const effectiveFrom = effectiveFromRaw ? validDate(effectiveFromRaw, 'effectiveFrom') : null;
    const effectiveTo = effectiveToRaw ? validDate(effectiveToRaw, 'effectiveTo') : null;
    if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) {
      const error = new Error('schedule_effective_range_invalid');
      error.code = 'core_hr:invalid_date_range';
      throw error;
    }

    normalizedSchedules.push({
      id: requiredId(schedule.id || generatedId('schedule')),
      salonId,
      employeeId,
      weekday,
      shiftTemplateId,
      startTime: active === 1 ? optionalText(template?.start_time) || null : null,
      endTime: active === 1 ? optionalText(template?.end_time) || null : null,
      active,
      scheduleSource: active === 1 ? 'shift_template' : 'weekly_off',
      effectiveFrom,
      effectiveTo,
    });
  }

  const effectiveFromValues = Array.from(new Set(normalizedSchedules.map((row) => row.effectiveFrom || '')));
  if (effectiveFromValues.length > 1) {
    const error = new Error('schedule_effective_from_must_match');
    error.code = 'core_hr:schedule_effective_from_must_match';
    throw error;
  }
  const replacementDate = effectiveFromValues[0] || null;
  const statements = [];
  if (replacementDate) {
    statements.push(
      {
        sql: `DELETE FROM hr_work_schedules
          WHERE salon_id = ? AND employee_id = ? AND effective_from IS NOT NULL AND effective_from >= ?`,
        params: [salonId, employeeId, replacementDate],
      },
      {
        sql: `UPDATE hr_work_schedules SET effective_to = ?, updated_at = ?
          WHERE salon_id = ? AND employee_id = ?
            AND (effective_from IS NULL OR effective_from < ?)
            AND (effective_to IS NULL OR effective_to >= ?)`,
        params: [previousDateKey(replacementDate), now, salonId, employeeId, replacementDate, replacementDate],
      }
    );
  } else {
    statements.push({
      sql: 'DELETE FROM hr_work_schedules WHERE salon_id = ? AND employee_id = ?',
      params: [salonId, employeeId],
    });
  }

  for (const schedule of normalizedSchedules) {
    statements.push({
      sql: `INSERT INTO hr_work_schedules
        (id, salon_id, employee_id, weekday, shift_template_id, start_time, end_time, active,
         schedule_source, effective_from, effective_to, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        schedule.id, schedule.salonId, schedule.employeeId, schedule.weekday,
        schedule.shiftTemplateId, schedule.startTime, schedule.endTime, schedule.active,
        schedule.scheduleSource, schedule.effectiveFrom, schedule.effectiveTo, now, now,
      ],
    });
  }
  await dbBatch(db, statements);
  return getHrEmployee(db, salonId, employeeId);
}
