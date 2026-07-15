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
    'SELECT * FROM hr_work_schedules WHERE salon_id = ? AND employee_id = ? ORDER BY weekday, start_time',
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
         shift_start_time, shift_end_time, weekly_off_days_json, allowed_zone_ids_json, employment_status,
         employee_code, fingerprint_number, admin_notes, updated_by_uid, updated_by_email, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

export async function replaceHrSchedules(db, salonId, employeeIdValue, schedules = []) {
  const employeeId = requiredId(employeeIdValue, 'employeeId');
  const now = nowIso();
  const statements = [
    { sql: 'DELETE FROM hr_work_schedules WHERE salon_id = ? AND employee_id = ?', params: [salonId, employeeId] },
  ];
  for (const schedule of Array.isArray(schedules) ? schedules : []) {
    statements.push({
      sql: `INSERT INTO hr_work_schedules
        (id, salon_id, employee_id, weekday, start_time, end_time, active, effective_from, effective_to, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        requiredId(schedule.id || generatedId('schedule')),
        salonId,
        employeeId,
        integer(schedule.weekday, 'weekday', { min: 0, max: 6 }),
        optionalText(schedule.startTime || schedule.start_time) || null,
        optionalText(schedule.endTime || schedule.end_time) || null,
        activeFlag(schedule.active, 1),
        optionalText(schedule.effectiveFrom || schedule.effective_from) || null,
        optionalText(schedule.effectiveTo || schedule.effective_to) || null,
        now,
        now,
      ],
    });
  }
  await dbBatch(db, statements);
  return getHrEmployee(db, salonId, employeeId);
}
