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

  const authority =
    employment.attendance_policy_authority ?? 'legacy';

  if (!['legacy', 'effective_dated'].includes(authority)) {
    throw new AppError(
      409,
      'core_attendance_policy:invalid_authority'
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

  if (authority === 'effective_dated') {
    return {
      date,
      mode: 'required',
      reason: null,
      policyId: null,
      version: null,
      source: 'effective_dated_default',
      effectiveFrom: null,
      effectiveTo: null,
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
              attendance_payroll_exemption_reason,
              attendance_policy_authority
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

function requiredPolicyText(value, field, maxLength = 500) {
  if (typeof value !== 'string') {
    throw new AppError(
      400,
      `core_attendance_policy:invalid_${field}`
    );
  }

  const text = value.trim();

  if (!text || text.length > maxLength) {
    throw new AppError(
      400,
      `core_attendance_policy:invalid_${field}`
    );
  }

  return text;
}

function validatePolicyVersion(value) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new AppError(
      400,
      'core_attendance_policy:invalid_version'
    );
  }

  return value;
}

function normalizePolicyPeriod(input) {
  const mode = input.mode;

  if (!['required', 'exempt'].includes(mode)) {
    throw new AppError(
      400,
      'core_attendance_policy:invalid_mode'
    );
  }

  const effectiveFrom =
    attendancePolicyDate(input.effectiveFrom);

  const effectiveTo = input.effectiveTo == null
    ? null
    : attendancePolicyDate(input.effectiveTo);

  if (effectiveTo && effectiveTo < effectiveFrom) {
    throw new AppError(
      400,
      'core_attendance_policy:invalid_period'
    );
  }

  return {
    mode,
    effectiveFrom,
    effectiveTo,
    reason: requiredPolicyText(input.reason, 'reason'),
  };
}

async function readScopedPolicy(
  db,
  salonId,
  employeeId,
  policyId
) {
  const row = await dbFirst(
    db,
    `SELECT *
       FROM employee_attendance_policy_periods
      WHERE salon_id = ?
        AND employee_id = ?
        AND id = ?`,
    [salonId, employeeId, policyId]
  );

  if (!row) {
    throw new AppError(
      404,
      'core_attendance_policy:period_not_found'
    );
  }

  return row;
}

function assertMutablePolicy(row, version) {
  validatePolicyVersion(version);

  if (row.status !== 'active') {
    throw new AppError(
      409,
      'core_attendance_policy:period_not_active'
    );
  }

  if (Number(row.version) !== version) {
    throw new AppError(
      409,
      'core_attendance_policy:version_conflict'
    );
  }
}

function requirePolicyMutation(result) {
  if (Number(result?.meta?.changes) !== 1) {
    throw new AppError(
      409,
      'core_attendance_policy:mutation_conflict'
    );
  }
}

export async function createAttendancePolicyPeriod(
  db,
  salonId,
  employeeId,
  input,
  actor
) {
  const actorUid =
    requiredPolicyText(actor?.uid, 'actor', 256);

  const policy = normalizePolicyPeriod(input);

  const employment = await dbFirst(
    db,
    `SELECT attendance_policy_authority,
            attendance_payroll_mode
       FROM employee_employment
      WHERE salon_id = ?
        AND employee_id = ?`,
    [salonId, employeeId]
  );

  if (!employment) {
    throw new AppError(
      404,
      'core_attendance_policy:employee_not_found'
    );
  }

  if (
    employment.attendance_policy_authority === 'legacy' &&
    employment.attendance_payroll_mode === 'exempt' &&
    input.confirmLegacyAdoption !== true
  ) {
    throw new AppError(
      409,
      'core_attendance_policy:legacy_adoption_confirmation_required'
    );
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  const result = await db.prepare(`
    INSERT INTO employee_attendance_policy_periods (
      id,
      salon_id,
      employee_id,
      policy_mode,
      effective_from,
      effective_to,
      reason,
      created_by_uid,
      created_at,
      updated_at,
      updated_by_uid
    )
    SELECT ?,?,?,?,?,?,?,?,?,?,?
    WHERE EXISTS (
      SELECT 1
      FROM employee_employment
      WHERE salon_id = ?
        AND employee_id = ?
        AND attendance_policy_authority = ?
        AND attendance_payroll_mode IS ?
    )
  `).bind(
    id,
    salonId,
    employeeId,
    policy.mode,
    policy.effectiveFrom,
    policy.effectiveTo,
    policy.reason,
    actorUid,
    now,
    now,
    actorUid,
    salonId,
    employeeId,
    employment.attendance_policy_authority,
    employment.attendance_payroll_mode
  ).run();

  requirePolicyMutation(result);

  return readScopedPolicy(
    db, salonId, employeeId, id
  );
}

export async function updateAttendancePolicyPeriod(
  db,
  salonId,
  employeeId,
  policyId,
  input,
  actor
) {
  const actorUid =
    requiredPolicyText(actor?.uid, 'actor', 256);

  const version = validatePolicyVersion(input.version);

  const current = await readScopedPolicy(
    db, salonId, employeeId, policyId
  );

  assertMutablePolicy(current, version);

  const policy = normalizePolicyPeriod({
    mode: input.mode ?? current.policy_mode,
    effectiveFrom:
      input.effectiveFrom ?? current.effective_from,
    effectiveTo: Object.hasOwn(input, 'effectiveTo')
      ? input.effectiveTo
      : current.effective_to,
    reason: input.reason ?? current.reason,
  });

  const now = new Date().toISOString();

  const result = await db.prepare(`
    UPDATE employee_attendance_policy_periods
    SET policy_mode = ?,
        effective_from = ?,
        effective_to = ?,
        reason = ?,
        updated_by_uid = ?,
        updated_at = ?,
        version = version + 1
    WHERE salon_id = ?
      AND employee_id = ?
      AND id = ?
      AND status = 'active'
      AND version = ?
  `).bind(
    policy.mode,
    policy.effectiveFrom,
    policy.effectiveTo,
    policy.reason,
    actorUid,
    now,
    salonId,
    employeeId,
    policyId,
    version
  ).run();

  requirePolicyMutation(result);

  return readScopedPolicy(
    db, salonId, employeeId, policyId
  );
}

export async function cancelAttendancePolicyPeriod(
  db,
  salonId,
  employeeId,
  policyId,
  input,
  actor
) {
  const actorUid =
    requiredPolicyText(actor?.uid, 'actor', 256);

  const version = validatePolicyVersion(input.version);

  const reason =
    requiredPolicyText(input.reason, 'cancellation_reason');

  const current = await readScopedPolicy(
    db, salonId, employeeId, policyId
  );

  assertMutablePolicy(current, version);

  const now = new Date().toISOString();

  const result = await db.prepare(`
    UPDATE employee_attendance_policy_periods
    SET status = 'cancelled',
        cancelled_at = ?,
        cancelled_by_uid = ?,
        cancellation_reason = ?,
        updated_at = ?,
        updated_by_uid = ?,
        version = version + 1
    WHERE salon_id = ?
      AND employee_id = ?
      AND id = ?
      AND status = 'active'
      AND version = ?
  `).bind(
    now,
    actorUid,
    reason,
    now,
    actorUid,
    salonId,
    employeeId,
    policyId,
    version
  ).run();

  requirePolicyMutation(result);

  return readScopedPolicy(
    db, salonId, employeeId, policyId
  );
}
