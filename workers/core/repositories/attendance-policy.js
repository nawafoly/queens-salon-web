import { dbAll, dbFirst } from '../d1.js';
import { AppError } from '../errors.js';

export function attendancePolicyDate(value) {
  const date = String(value ?? '').trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new AppError(400, 'core_attendance_policy:invalid_date');
  }

  const parsed = new Date(`${date}T12:00:00.000Z`);

  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  ) {
    throw new AppError(400, 'core_attendance_policy:invalid_date');
  }

  return date;
}

export function resolveAttendancePolicyForDate(
  employment,
  periods,
  dateValue
) {
  const date = attendancePolicyDate(dateValue);

  if (!employment) {
    throw new AppError(
      404,
      'core_attendance_policy:employee_not_found'
    );
  }

  if (!Array.isArray(periods)) {
    throw new AppError(
      409,
      'core_attendance_policy:invalid_history'
    );
  }

  const matching = periods.filter(period =>
    period.status === 'active' &&
    period.effective_from <= date &&
    (
      period.effective_to == null ||
      period.effective_to >= date
    )
  );

  if (matching.length > 1) {
    throw new AppError(
      409,
      'core_attendance_policy:overlapping_periods'
    );
  }

  if (matching.length === 1) {
    const period = matching[0];

    if (!['required', 'exempt'].includes(period.policy_mode)) {
      throw new AppError(
        409,
        'core_attendance_policy:invalid_mode'
      );
    }

    return {
      date,
      mode: period.policy_mode,
      reason: period.reason,
      policyId: period.id,
      version: Number(period.version),
      source: 'effective_period',
      effectiveFrom: period.effective_from,
      effectiveTo: period.effective_to ?? null,
    };
  }

  const baseline =
    employment.attendance_payroll_mode || 'required';

  if (!['required', 'exempt'].includes(baseline)) {
    throw new AppError(
      409,
      'core_attendance_policy:invalid_baseline'
    );
  }

  return {
    date,
    mode: baseline,
    reason: baseline === 'exempt'
      ? employment.attendance_payroll_exemption_reason || null
      : null,
    policyId: null,
    version: null,
    source: 'legacy_employment_baseline',
    effectiveFrom: null,
    effectiveTo: null,
  };
}

export async function loadAttendancePolicyPeriods(
  db,
  salonId,
  employeeId
) {
  return dbAll(
    db,
    `SELECT *
       FROM employee_attendance_policy_periods
      WHERE salon_id = ?
        AND employee_id = ?
      ORDER BY effective_from, id`,
    [salonId, employeeId]
  );
}

export async function resolveEmployeeAttendancePolicy(
  db,
  salonId,
  employeeId,
  dateValue
) {
  const date = attendancePolicyDate(dateValue);

  const [employment, periods] = await Promise.all([
    dbFirst(
      db,
      `SELECT attendance_payroll_mode,
              attendance_payroll_exemption_reason
         FROM employee_employment
        WHERE salon_id = ?
          AND employee_id = ?
        LIMIT 1`,
      [salonId, employeeId]
    ),
    loadAttendancePolicyPeriods(
      db,
      salonId,
      employeeId
    ),
  ]);

  return resolveAttendancePolicyForDate(
    employment,
    periods,
    date
  );
}

export function isAttendancePolicyExempt(policy) {
  return policy?.mode === 'exempt';
}

export function isAutomaticAttendanceAbsence(row) {
  return String(
    row?.absence_type ?? row?.absenceType ?? ''
  ).trim().toLowerCase() === 'automatic_check_in_lock';
}

export function attendanceAbsenceApplies(row, policy) {
  return !(
    isAttendancePolicyExempt(policy) &&
    isAutomaticAttendanceAbsence(row)
  );
}
