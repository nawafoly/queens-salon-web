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
import { AppError } from '../errors.js';

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

function hasOwn(object, key) {
  return object && Object.prototype.hasOwnProperty.call(object, key);
}

function nullableTextField(candidates, fallback) {
  for (const [object, key] of candidates) {
    if (hasOwn(object, key)) return optionalText(object[key]) || null;
  }
  return optionalText(fallback) || null;
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

function attendancePayrollMode(value) {
  return cleanText(value).toLowerCase() === 'exempt'
    ? 'exempt'
    : 'required';
}

function socialInsuranceCategory(value) {
  const clean = cleanText(value).toLowerCase();
  if (!clean) return null;
  if (![
    'saudi_existing',
    'saudi_new',
    'gcc',
    'non_saudi',
  ].includes(clean)) {
    const error = new Error('invalid_social_insurance_category');
    error.code = 'core_hr:invalid_social_insurance_category';
    throw error;
  }
  return clean;
}

function gosiWageMode(value) {
  return cleanText(value).toLowerCase() === 'override'
    ? 'override'
    : 'derived';
}

function optionalMoneyHalalas(value, field) {
  if (value === null || value === undefined || value === '') return null;
  return moneyHalalas(value, field);
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

export async function getHrEmployeeAvatarProfile(db, salonId, id) {
  const employeeId = requiredId(id);
  const profile = await dbFirst(
    db,
    `SELECT id, status, avatar_file_id, show_on_about
       FROM employee_profiles
      WHERE salon_id = ? AND id = ?
      LIMIT 1`,
    [salonId, employeeId]
  );

  if (!profile) rowNotFound('employee');
  return profile;
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
    'SELECT * FROM employee_profiles WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, id]
  );

  // EMPLOYEE_OPTIMISTIC_CONCURRENCY_V1
  // Dashboard writes opt into a canonical updated_at precondition.
  // Compatibility callers remain unchanged until they migrate to this contract.
  const enforceConcurrency =
    existing &&
    (
      data.enforceConcurrency === true ||
      data.enforce_concurrency === true ||
      data.enforceConcurrency === 1 ||
      data.enforce_concurrency === 1
    );

  const expectedUpdatedAt =
    optionalText(
      data.expectedUpdatedAt ??
        data.expected_updated_at
    ) || null;

  if (
    enforceConcurrency &&
    !expectedUpdatedAt
  ) {
    throw new AppError(
      409,
      'core_hr:employee_write_precondition_required'
    );
  }
  const existingEmployment = existing
    ? await employmentFor(db, salonId, id)
    : null;
  const existingStaff = await dbFirst(
    db,
    'SELECT * FROM staff WHERE salon_id = ? AND id = ? LIMIT 1',
    [salonId, id]
  );
  const personal = data.personal || {};
  const requestedProfileStatus = data.status ?? data.employment?.status;
  const profile = {
    id,
    salon_id: salonId,
    firebase_uid: optionalText(
      data.firebaseUid ?? data.employeeUid ?? data.uid ?? existing?.firebase_uid
    ) || null,
    name: requiredText(data.name ?? personal.name ?? existing?.name, 'name'),
    email: optionalText(data.email ?? personal.email ?? existing?.email) || null,
    phone_normalized:
      data.phone === undefined && personal.phone === undefined
        ? (existing?.phone_normalized || null)
        : (normalizePhone(data.phone ?? personal.phone) || null),
    avatar_file_id: nullableTextField(
      [[data, 'avatarFileId'], [data, 'avatar_file_id']],
      existing?.avatar_file_id
    ),
    avatar_url: nullableTextField([[data, 'avatarUrl'], [data, 'avatar_url']], existing?.avatar_url),
    bio: nullableTextField([[data, 'bio']], existing?.bio),
    cv_url: nullableTextField([[data, 'cvUrl'], [data, 'cv_url']], existing?.cv_url),
    show_on_about: activeFlag(
      data.showOnAbout ?? data.show_on_about ?? existing?.show_on_about,
      1
    ),
    include_in_employee_management: activeFlag(
      data.includeInEmployeeManagement ??
        data.include_in_employee_management ??
        existing?.include_in_employee_management,
      1
    ),
    rating: optionalNumber(data.rating ?? existing?.rating, 'rating') ?? 0,
    reviews_count: Math.max(
      0,
      Math.floor(
        optionalNumber(
          data.reviewsCount ?? data.reviews_count ?? existing?.reviews_count,
          'reviewsCount'
        ) ?? 0
      )
    ),
    status: cleanText(requestedProfileStatus ?? existing?.status ?? 'active') || 'active',
    created_at: existing?.created_at || now,
    updated_at: now,
  };
  const employmentInput = data.employment || data;
  const socialInsuranceKeys = [
    'socialInsuranceCategory',
    'social_insurance_category',
    'socialInsuranceEffectiveFrom',
    'social_insurance_effective_from',
    'socialInsuranceClassificationNote',
    'social_insurance_classification_note',
    'gosiWageMode',
    'gosi_wage_mode',
    'gosiContributoryWageOverrideHalalas',
    'gosi_contributory_wage_override_halalas',
    'gosiContributoryWageOverrideReason',
    'gosi_contributory_wage_override_reason',
    'gccHomeCountryCode',
    'gcc_home_country_code',
  ];
  const socialInsuranceTouched = socialInsuranceKeys.some((key) =>
    Object.prototype.hasOwnProperty.call(employmentInput, key)
  );

  const employment = {
    salon_id: salonId,
    employee_id: id,
    title: optionalText(employmentInput.title ?? existingEmployment?.title) || null,
    job_title: optionalText(
      employmentInput.jobTitle ?? employmentInput.job_title ?? existingEmployment?.job_title
    ) || null,
    department: optionalText(employmentInput.department ?? existingEmployment?.department) || null,
    employment_source: optionalText(
      employmentInput.employmentSource ??
        employmentInput.employment_source ??
        existingEmployment?.employment_source ??
        'salon'
    ) || 'salon',
    partner_id: optionalText(
      employmentInput.partnerId ?? employmentInput.partner_id ?? existingEmployment?.partner_id
    ) || null,
    partner_member_id: optionalText(
      employmentInput.partnerMemberId ??
        employmentInput.partner_member_id ??
        existingEmployment?.partner_member_id
    ) || null,
    contract_id: optionalText(
      employmentInput.contractId ?? employmentInput.contract_id ?? existingEmployment?.contract_id
    ) || null,
    start_date: optionalText(
      employmentInput.startDate ?? employmentInput.start_date ?? existingEmployment?.start_date
    ) || null,
    end_date: optionalText(
      employmentInput.endDate ??
        employmentInput.end_date ??
        employmentInput.employmentEndDate ??
        existingEmployment?.end_date
    ) || null,
    leave_balance: Number(
      employmentInput.leaveBalance ??
        employmentInput.leave_balance ??
        existingEmployment?.leave_balance ??
        0
    ) || 0,
    base_salary_halalas: moneyHalalas(
      employmentInput.baseSalaryHalalas ??
        employmentInput.base_salary_halalas ??
        employmentInput.baseSalary ??
        existingEmployment?.base_salary_halalas,
      'baseSalary'
    ),
    housing_allowance_halalas: moneyHalalas(
      employmentInput.housingAllowanceHalalas ??
        employmentInput.housing_allowance_halalas ??
        employmentInput.housingAllowance ??
        existingEmployment?.housing_allowance_halalas,
      'housingAllowance'
    ),
    transportation_allowance_halalas: moneyHalalas(
      employmentInput.transportationAllowanceHalalas ??
        employmentInput.transportation_allowance_halalas ??
        employmentInput.transportationAllowance ??
        existingEmployment?.transportation_allowance_halalas,
      'transportationAllowance'
    ),
    other_allowances_halalas: moneyHalalas(
      employmentInput.otherAllowancesHalalas ??
        employmentInput.other_allowances_halalas ??
        employmentInput.otherAllowances ??
        employmentInput.allowances ??
        existingEmployment?.other_allowances_halalas,
      'otherAllowances'
    ),
    expected_work_days:
      employmentInput.expectedWorkDays ??
      employmentInput.expected_work_days ??
      existingEmployment?.expected_work_days ??
      null,
    expected_work_hours:
      employmentInput.expectedWorkHours ??
      employmentInput.expected_work_hours ??
      existingEmployment?.expected_work_hours ??
      null,
    daily_scheduled_hours: optionalNumber(
      employmentInput.dailyScheduledHours ??
        employmentInput.daily_scheduled_hours ??
        employmentInput.expectedDailyHours ??
        employmentInput.expected_daily_hours ??
        existingEmployment?.daily_scheduled_hours,
      'dailyScheduledHours'
    ),
    overtime_enabled: activeFlag(
      employmentInput.overtimeEnabled ??
        employmentInput.overtime_enabled ??
        employmentInput.payrollOvertimeEnabled ??
        employmentInput.payroll_overtime_enabled ??
        existingEmployment?.overtime_enabled,
      0
    ),
    overtime_multiplier: positiveNumber(
      employmentInput.overtimeMultiplier ??
        employmentInput.overtime_multiplier ??
        existingEmployment?.overtime_multiplier,
      1.5,
      'overtimeMultiplier'
    ),
    payroll_deduction_method: payrollDeductionMethod(
      employmentInput.payrollDeductionMethod ??
        employmentInput.payroll_deduction_method ??
        existingEmployment?.payroll_deduction_method ??
        'hourly'
    ),
    attendance_payroll_mode: attendancePayrollMode(
      employmentInput.attendancePayrollMode ??
        employmentInput.attendance_payroll_mode ??
        existingEmployment?.attendance_payroll_mode ??
        'required'
    ),
    attendance_payroll_exemption_reason:
      attendancePayrollMode(
        employmentInput.attendancePayrollMode ??
          employmentInput.attendance_payroll_mode ??
          existingEmployment?.attendance_payroll_mode ??
          'required'
      ) === 'exempt'
        ? optionalText(
            employmentInput.attendancePayrollExemptionReason ??
              employmentInput.attendance_payroll_exemption_reason ??
              existingEmployment?.attendance_payroll_exemption_reason
          ) || null
        : null,
    social_insurance_category: socialInsuranceCategory(
      employmentInput.socialInsuranceCategory ??
        employmentInput.social_insurance_category ??
        existingEmployment?.social_insurance_category
    ),
    social_insurance_effective_from: optionalText(
      employmentInput.socialInsuranceEffectiveFrom ??
        employmentInput.social_insurance_effective_from ??
        existingEmployment?.social_insurance_effective_from
    ) || null,
    social_insurance_classification_note: optionalText(
      employmentInput.socialInsuranceClassificationNote ??
        employmentInput.social_insurance_classification_note ??
        existingEmployment?.social_insurance_classification_note
    ) || null,
    gosi_wage_mode: gosiWageMode(
      employmentInput.gosiWageMode ??
        employmentInput.gosi_wage_mode ??
        existingEmployment?.gosi_wage_mode ??
        'derived'
    ),
    gosi_contributory_wage_override_halalas: optionalMoneyHalalas(
      employmentInput.gosiContributoryWageOverrideHalalas ??
        employmentInput.gosi_contributory_wage_override_halalas ??
        existingEmployment?.gosi_contributory_wage_override_halalas,
      'gosiContributoryWageOverride'
    ),
    gosi_contributory_wage_override_reason: optionalText(
      employmentInput.gosiContributoryWageOverrideReason ??
        employmentInput.gosi_contributory_wage_override_reason ??
        existingEmployment?.gosi_contributory_wage_override_reason
    ) || null,
    gcc_home_country_code: optionalText(
      employmentInput.gccHomeCountryCode ??
        employmentInput.gcc_home_country_code ??
        existingEmployment?.gcc_home_country_code
    ) || null,
    social_insurance_updated_by_uid: socialInsuranceTouched
      ? optionalText(actor.uid) || null
      : existingEmployment?.social_insurance_updated_by_uid || null,
    social_insurance_updated_by_email: socialInsuranceTouched
      ? optionalText(actor.email) || null
      : existingEmployment?.social_insurance_updated_by_email || null,
    social_insurance_updated_at: socialInsuranceTouched
      ? now
      : existingEmployment?.social_insurance_updated_at || null,
    shift_start_time: optionalText(
      employmentInput.shiftStartTime ??
        employmentInput.shift_start_time ??
        existingEmployment?.shift_start_time
    ) || null,
    shift_end_time: optionalText(
      employmentInput.shiftEndTime ??
        employmentInput.shift_end_time ??
        existingEmployment?.shift_end_time
    ) || null,
    weekly_off_days_json: jsonArray(
      employmentInput.weeklyOffDays ??
        employmentInput.weekly_off_days_json ??
        existingEmployment?.weekly_off_days_json ??
        []
    ),
    allowed_zone_ids_json: jsonArray(
      employmentInput.allowedZoneIds ??
        employmentInput.allowed_zone_ids_json ??
        existingEmployment?.allowed_zone_ids_json ??
        []
    ),
    employment_status: cleanText(
      employmentInput.employmentStatus ??
        employmentInput.employment_status ??
        employmentInput.status ??
        existingEmployment?.employment_status ??
        'active'
    ) || 'active',
    employee_code: optionalText(
      employmentInput.employeeCode ??
        employmentInput.employee_code ??
        existingEmployment?.employee_code
    ) || null,
    fingerprint_number: optionalText(
      employmentInput.fingerprintNumber ??
        employmentInput.fingerprint_number ??
        existingEmployment?.fingerprint_number
    ) || null,
    admin_notes: optionalText(
      employmentInput.adminNotes ??
        employmentInput.admin_notes ??
        existingEmployment?.admin_notes
    ) || null,
    updated_by_uid: optionalText(actor.uid) || existingEmployment?.updated_by_uid || null,
    updated_by_email: optionalText(actor.email) || existingEmployment?.updated_by_email || null,
    created_at: existingEmployment?.created_at || now,
    updated_at: now,
  };

  if (employment.social_insurance_effective_from) {
    employment.social_insurance_effective_from = validDate(
      employment.social_insurance_effective_from,
      'socialInsuranceEffectiveFrom'
    );
  }
  if (
    profile.status === 'active' &&
    employment.employment_status === 'active' &&
    employment.social_insurance_category &&
    !employment.social_insurance_effective_from
  ) {
    throw new AppError(409, 'core_hr:gosi_effective_date_required');
  }

  const bookingStaffInput = data.bookingStaff || data.booking_staff || data.staff || {};
  const staff = {
    id,
    salon_id: salonId,
    firebase_uid: optionalText(
      bookingStaffInput.firebaseUid ?? bookingStaffInput.firebase_uid ?? profile.firebase_uid ?? existingStaff?.firebase_uid
    ) || null,
    name: requiredText(bookingStaffInput.name ?? profile.name ?? existingStaff?.name, 'name'),
    phone_normalized:
      bookingStaffInput.phone === undefined && bookingStaffInput.phoneNormalized === undefined
        ? (profile.phone_normalized || existingStaff?.phone_normalized || null)
        : (normalizePhone(bookingStaffInput.phoneNormalized || bookingStaffInput.phone) || null),
    active: activeFlag(
      bookingStaffInput.active ??
        (profile.status === 'active' && employment.employment_status === 'active'),
      1
    ),
    employment_status: cleanText(
      bookingStaffInput.employmentStatus ??
        bookingStaffInput.employment_status ??
        employment.employment_status ??
        existingStaff?.employment_status ??
        'active'
    ) || 'active',
    avatar_url: optionalText(
      bookingStaffInput.avatarUrl ?? bookingStaffInput.avatar_url ?? profile.avatar_url ?? existingStaff?.avatar_url
    ) || null,
    show_on_booking: activeFlag(
      bookingStaffInput.showOnBooking ??
        bookingStaffInput.show_on_booking ??
        existingStaff?.show_on_booking,
      0
    ),
    specialties_json: JSON.stringify(
      Array.isArray(bookingStaffInput.specialties)
        ? bookingStaffInput.specialties.map((value) => cleanText(value)).filter(Boolean)
        : (() => {
            try {
              const parsed = JSON.parse(cleanText(existingStaff?.specialties_json) || '[]');
              return Array.isArray(parsed) ? parsed : [];
            } catch {
              return [];
            }
          })()
    ),
    created_at: existingStaff?.created_at || now,
    updated_at: now,
  };

  const offboardingFence = await dbFirst(
    db,
    `SELECT status, end_date
       FROM employee_offboarding_fences
      WHERE salon_id = ? AND employee_id = ? AND status = 'offboarded'
      LIMIT 1`,
    [salonId, id]
  );
  if (offboardingFence) {
    const targetOperational =
      cleanText(profile.status).toLowerCase() === 'active' ||
      cleanText(employment.employment_status).toLowerCase() === 'active' ||
      Number(staff.active) === 1 ||
      Number(staff.show_on_booking) === 1 ||
      cleanText(staff.employment_status).toLowerCase() === 'active';

    if (targetOperational) {
      throw new AppError(409, 'core_hr:employee_rehire_requires_lifecycle_operation');
    }

    const startDateChanged = Boolean(
      existingEmployment &&
      cleanText(employment.start_date) !== cleanText(existingEmployment.start_date)
    );
    const endDateChanged =
      cleanText(employment.end_date) !== cleanText(offboardingFence.end_date);
    if (startDateChanged || endDateChanged) {
      throw new AppError(
        409,
        'core_hr:offboarding_lifecycle_fields_locked',
        'Offboarded employment lifecycle dates require a dedicated lifecycle operation'
      );
    }
  }

  const writeResults = await dbBatch(db, [
    {
      sql: `INSERT INTO employee_profiles
        (id, salon_id, firebase_uid, name, email, phone_normalized, avatar_file_id, avatar_url, bio, cv_url,
         show_on_about, include_in_employee_management, rating, reviews_count, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
        firebase_uid = excluded.firebase_uid, name = excluded.name, email = excluded.email,
        phone_normalized = excluded.phone_normalized, avatar_file_id = excluded.avatar_file_id,
        avatar_url = excluded.avatar_url, bio = excluded.bio, cv_url = excluded.cv_url,
        show_on_about = excluded.show_on_about,
        include_in_employee_management = excluded.include_in_employee_management,
        rating = excluded.rating, reviews_count = excluded.reviews_count,
        status = excluded.status, updated_at = excluded.updated_at
       WHERE ? = 0 OR employee_profiles.updated_at = ?`,
      params: [
        ...Object.values(profile),
        enforceConcurrency ? 1 : 0,
        expectedUpdatedAt || '',
      ],
    },
    {
      sql: `INSERT INTO employee_employment
        (salon_id, employee_id, title, job_title, department, employment_source, partner_id, partner_member_id,
         contract_id, start_date, end_date, leave_balance, base_salary_halalas, housing_allowance_halalas,
         transportation_allowance_halalas, other_allowances_halalas, expected_work_days, expected_work_hours,
         daily_scheduled_hours, overtime_enabled, overtime_multiplier, payroll_deduction_method,
         attendance_payroll_mode, attendance_payroll_exemption_reason,
         social_insurance_category, social_insurance_effective_from, social_insurance_classification_note,
         gosi_wage_mode, gosi_contributory_wage_override_halalas, gosi_contributory_wage_override_reason,
         gcc_home_country_code, social_insurance_updated_by_uid, social_insurance_updated_by_email,
         social_insurance_updated_at,
         shift_start_time, shift_end_time, weekly_off_days_json, allowed_zone_ids_json, employment_status,
         employee_code, fingerprint_number, admin_notes, updated_by_uid, updated_by_email, created_at, updated_at)
       VALUES (${Object.keys(employment).map(() => '?').join(', ')})
       ON CONFLICT(salon_id, employee_id) DO UPDATE SET
        title = excluded.title, job_title = excluded.job_title, department = excluded.department,
        employment_source = excluded.employment_source, partner_id = excluded.partner_id,
        partner_member_id = excluded.partner_member_id, contract_id = excluded.contract_id,
        start_date = excluded.start_date, end_date = excluded.end_date,
        base_salary_halalas = excluded.base_salary_halalas,
        housing_allowance_halalas = excluded.housing_allowance_halalas,
        transportation_allowance_halalas = excluded.transportation_allowance_halalas,
        other_allowances_halalas = excluded.other_allowances_halalas,
        expected_work_days = excluded.expected_work_days, expected_work_hours = excluded.expected_work_hours,
        daily_scheduled_hours = excluded.daily_scheduled_hours,
        overtime_enabled = excluded.overtime_enabled,
        overtime_multiplier = excluded.overtime_multiplier,
        payroll_deduction_method = excluded.payroll_deduction_method,
        attendance_payroll_mode = excluded.attendance_payroll_mode,
        attendance_payroll_exemption_reason = excluded.attendance_payroll_exemption_reason,
        social_insurance_category = excluded.social_insurance_category,
        social_insurance_effective_from = excluded.social_insurance_effective_from,
        social_insurance_classification_note = excluded.social_insurance_classification_note,
        gosi_wage_mode = excluded.gosi_wage_mode,
        gosi_contributory_wage_override_halalas = excluded.gosi_contributory_wage_override_halalas,
        gosi_contributory_wage_override_reason = excluded.gosi_contributory_wage_override_reason,
        gcc_home_country_code = excluded.gcc_home_country_code,
        social_insurance_updated_by_uid = excluded.social_insurance_updated_by_uid,
        social_insurance_updated_by_email = excluded.social_insurance_updated_by_email,
        social_insurance_updated_at = excluded.social_insurance_updated_at,
        shift_start_time = excluded.shift_start_time, shift_end_time = excluded.shift_end_time,
        weekly_off_days_json = excluded.weekly_off_days_json, allowed_zone_ids_json = excluded.allowed_zone_ids_json,
        employment_status = excluded.employment_status, employee_code = excluded.employee_code,
        fingerprint_number = excluded.fingerprint_number, admin_notes = excluded.admin_notes,
        updated_by_uid = excluded.updated_by_uid, updated_by_email = excluded.updated_by_email,
        updated_at = excluded.updated_at
       WHERE ? = 0 OR EXISTS (
         SELECT 1
           FROM employee_profiles AS concurrency_profile
          WHERE concurrency_profile.salon_id = excluded.salon_id
            AND concurrency_profile.id = excluded.employee_id
            AND concurrency_profile.updated_at = ?
       )`,
      params: [
        ...Object.values(employment),
        enforceConcurrency ? 1 : 0,
        now,
      ],
    },
    {
      sql: `INSERT INTO staff
        (id, salon_id, firebase_uid, name, phone_normalized, active, employment_status, avatar_url, show_on_booking, specialties_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
        firebase_uid = excluded.firebase_uid, name = excluded.name, phone_normalized = excluded.phone_normalized,
        active = excluded.active, employment_status = excluded.employment_status, avatar_url = excluded.avatar_url,
        show_on_booking = excluded.show_on_booking, specialties_json = excluded.specialties_json, updated_at = excluded.updated_at
       WHERE ? = 0 OR EXISTS (
         SELECT 1
           FROM employee_profiles AS concurrency_profile
          WHERE concurrency_profile.salon_id = excluded.salon_id
            AND concurrency_profile.id = excluded.id
            AND concurrency_profile.updated_at = ?
       )`,
      params: [
        ...Object.values(staff),
        enforceConcurrency ? 1 : 0,
        now,
      ],
    },
  ]);

  if (
    enforceConcurrency &&
    Number(
      writeResults?.[0]?.meta?.changes ??
        writeResults?.[0]?.changes ??
        0
    ) < 1
  ) {
    throw new AppError(
      409,
      'core_hr:employee_changed'
    );
  }

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
