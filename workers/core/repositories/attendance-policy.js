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

function requirePolicyMutation(result, expectedId) {
  const rows = result?.results;

  if (
    result?.success !== true ||
    !Array.isArray(rows) ||
    rows.length !== 1 ||
    rows[0]?.id !== expectedId
  ) {
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
    RETURNING id
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
  ).all();

  requirePolicyMutation(result, id);

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
    RETURNING id
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
  ).all();

  requirePolicyMutation(result, policyId);

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
    RETURNING id
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
  ).all();

  requirePolicyMutation(result, policyId);

  return readScopedPolicy(
    db, salonId, employeeId, policyId
  );
}

/**
 * Record automatic check-in-lock absence only when attendance
 * is required on the actual work date.
 *
 * Policy evaluation and insertion happen in one SQL statement.
 * Existing absence evidence is never deleted by this function.
 */
export async function recordAutomaticAttendanceAbsence(
  db,
  salonId,
  employeeId,
  employeeUid,
  dateValue,
  now = new Date().toISOString()
) {
  const date = attendancePolicyDate(dateValue);

  if (!db || !salonId || !employeeId) {
    throw new AppError(
      400,
      'core_attendance_policy:invalid_absence_target'
    );
  }

  const id =
    `auto-check-in-lock-${salonId}-${employeeId}-${date}`;

  const result = await db.prepare(`
    INSERT OR IGNORE INTO employee_absences (
      id,
      salon_id,
      employee_id,
      employee_uid,
      date_key,
      absence_type,
      note,
      created_by_uid,
      created_at,
      updated_at
    )
    SELECT ?,?,?,?,?,
           'automatic_check_in_lock',
           ?,
           'system',
           ?,?
    WHERE EXISTS (
      SELECT 1
      FROM employee_employment e
      WHERE e.salon_id = ?
        AND e.employee_id = ?
        AND (
          e.attendance_policy_authority = 'effective_dated'
          OR (
            e.attendance_policy_authority = 'legacy'
            AND e.attendance_payroll_mode = 'required'
          )
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM employee_attendance_policy_periods p
      WHERE p.salon_id = ?
        AND p.employee_id = ?
        AND p.status = 'active'
        AND p.policy_mode = 'exempt'
        AND p.effective_from <= ?
        AND (
          p.effective_to IS NULL
          OR p.effective_to >= ?
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM employee_absences a
      WHERE a.salon_id = ?
        AND a.employee_id = ?
        AND a.date_key = ?
    )
  `).bind(
    id,
    salonId,
    employeeId,
    employeeUid || null,
    date,
    'غياب تلقائي بعد انتهاء مهلة بصمة الحضور',
    now,
    now,
    salonId,
    employeeId,
    salonId,
    employeeId,
    date,
    date,
    salonId,
    employeeId,
    date
  ).run();

  return {
    created: Number(result?.meta?.changes ?? 0),
    date,
  };
}

export const PAYROLL_ATTENDANCE_POLICY_SNAPSHOT_VERSION = 1;

function policyDateRange(fromValue, toValue) {
  const from = attendancePolicyDate(fromValue);
  const to = attendancePolicyDate(toValue);

  if (from > to) {
    throw new AppError(
      400,
      'core_attendance_policy:invalid_period'
    );
  }

  const dates = [];

  const current = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);

  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));

    if (dates.length > 366) {
      throw new AppError(
        400,
        'core_attendance_policy:period_too_large'
      );
    }

    current.setUTCDate(current.getUTCDate() + 1);
  }

  return dates;
}

export function buildPayrollAttendancePolicySnapshot(
  employment,
  periods,
  fromValue,
  toValue
) {
  const dates = policyDateRange(fromValue, toValue);

  const days = dates.map(date =>
    resolveAttendancePolicyForDate(
      employment,
      periods,
      date
    )
  );

  const exemptDays = days.filter(
    day => day.mode === 'exempt'
  );

  const requiredDays = days.filter(
    day => day.mode === 'required'
  );

  const reasons = [
    ...new Set(
      exemptDays
        .map(day => String(day.reason ?? '').trim())
        .filter(Boolean)
    ),
  ].sort();

  return {
    schemaVersion:
      PAYROLL_ATTENDANCE_POLICY_SNAPSHOT_VERSION,

    authority:
      employment.attendance_policy_authority ?? 'legacy',

    from: dates[0],
    to: dates[dates.length - 1],

    coverage: exemptDays.length === 0
      ? 'required'
      : requiredDays.length === 0
        ? 'exempt'
        : 'mixed',

    mode: requiredDays.length > 0
      ? 'required'
      : 'exempt',

    requiredDayCount: requiredDays.length,
    exemptDayCount: exemptDays.length,

    exemptionReasons: reasons,

    exemptionReasonComplete:
      exemptDays.every(
        day => Boolean(String(day.reason ?? '').trim())
      ),

    days,
  };
}

export function validatePayrollAttendancePolicySnapshot(
  snapshot,
  fromValue,
  toValue
) {
  const expectedDates =
    policyDateRange(fromValue, toValue);

  const invalid = () => {
    throw new AppError(
      409,
      'core_attendance_policy:invalid_payroll_snapshot'
    );
  };

  if (
    !snapshot ||
    snapshot.schemaVersion !==
      PAYROLL_ATTENDANCE_POLICY_SNAPSHOT_VERSION ||
    !['legacy', 'effective_dated'].includes(
      snapshot.authority
    ) ||
    snapshot.from !== expectedDates[0] ||
    snapshot.to !== expectedDates[expectedDates.length - 1] ||
    !Array.isArray(snapshot.days) ||
    snapshot.days.length !== expectedDates.length
  ) {
    invalid();
  }

  let requiredDayCount = 0;
  let exemptDayCount = 0;

  for (let index = 0; index < expectedDates.length; index++) {
    const day = snapshot.days[index];

    if (
      !day ||
      day.date !== expectedDates[index] ||
      !['required', 'exempt'].includes(day.mode) ||
      ![
        'effective_period',
        'effective_dated_default',
        'legacy_employment_baseline',
      ].includes(day.source)
    ) {
      invalid();
    }

    if (day.source === 'effective_period') {
      if (
        typeof day.policyId !== 'string' ||
        !day.policyId.trim() ||
        !Number.isSafeInteger(day.version) ||
        day.version < 1 ||
        typeof day.effectiveFrom !== 'string'
      ) {
        invalid();
      }

      const from = attendancePolicyDate(
        day.effectiveFrom
      );

      const to = day.effectiveTo == null
        ? null
        : attendancePolicyDate(day.effectiveTo);

      if (
        from > day.date ||
        (to && to < day.date) ||
        (to && to < from)
      ) {
        invalid();
      }
    } else if (
      day.policyId !== null ||
      day.version !== null ||
      day.effectiveFrom !== null ||
      day.effectiveTo !== null
    ) {
      invalid();
    }

    if (
      day.source === 'effective_dated_default' &&
      (
        snapshot.authority !== 'effective_dated' ||
        day.mode !== 'required'
      )
    ) {
      invalid();
    }

    if (
      day.source === 'legacy_employment_baseline' &&
      snapshot.authority !== 'legacy'
    ) {
      invalid();
    }

    if (day.mode === 'exempt') exemptDayCount++;
    else requiredDayCount++;
  }

  const coverage = exemptDayCount === 0
    ? 'required'
    : requiredDayCount === 0
      ? 'exempt'
      : 'mixed';

  const mode = requiredDayCount > 0
    ? 'required'
    : 'exempt';

  const exemptDays = snapshot.days.filter(
    day => day.mode === 'exempt'
  );

  const reasons = [
    ...new Set(
      exemptDays
        .map(day => String(day.reason ?? '').trim())
        .filter(Boolean)
    ),
  ].sort();

  const reasonComplete = exemptDays.every(
    day => Boolean(String(day.reason ?? '').trim())
  );

  if (
    snapshot.requiredDayCount !== requiredDayCount ||
    snapshot.exemptDayCount !== exemptDayCount ||
    snapshot.coverage !== coverage ||
    snapshot.mode !== mode ||
    snapshot.exemptionReasonComplete !== reasonComplete ||
    JSON.stringify(snapshot.exemptionReasons) !==
      JSON.stringify(reasons)
  ) {
    invalid();
  }

  return snapshot;
}

export function payrollAttendancePolicyMap(snapshot) {
  const valid = validatePayrollAttendancePolicySnapshot(
    snapshot,
    snapshot?.from,
    snapshot?.to
  );

  return new Map(
    valid.days.map(day => [day.date, day])
  );
}

export function payrollAttendancePolicySnapshotsMatch(
  previous,
  current
) {
  const left =
    validatePayrollAttendancePolicySnapshot(
      previous,
      previous?.from,
      previous?.to
    );

  const right =
    validatePayrollAttendancePolicySnapshot(
      current,
      current?.from,
      current?.to
    );

  const comparable = snapshot => JSON.stringify({
    schemaVersion: snapshot.schemaVersion,
    authority: snapshot.authority,
    from: snapshot.from,
    to: snapshot.to,
    days: snapshot.days.map(day => [
      day.date,
      day.mode,
      day.reason ?? null,
      day.policyId ?? null,
      day.version ?? null,
      day.source,
      day.effectiveFrom ?? null,
      day.effectiveTo ?? null,
    ]),
  });

  return comparable(left) === comparable(right);
}

export function filterPayrollAttendanceAbsences(
  absenceRows,
  snapshot
) {
  const policies =
    payrollAttendancePolicyMap(snapshot);

  return (absenceRows || []).filter(row => {
    const date = String(row?.date_key ?? '').trim();

    const policy = policies.get(date);

    if (!policy) return false;

    return attendanceAbsenceApplies(row, policy);
  });
}

export function validateAttendancePolicyRevision(value) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new AppError(
      409,
      'core_attendance_policy:invalid_revision'
    );
  }

  return value;
}

export async function readAttendancePolicyRevision(
  db,
  salonId,
  employeeId
) {
  const row = await dbFirst(
    db,
    `SELECT attendance_policy_revision
       FROM employee_employment
      WHERE salon_id = ?
        AND employee_id = ?
      LIMIT 1`,
    [salonId, employeeId]
  );

  if (!row) {
    throw new AppError(
      404,
      'core_attendance_policy:employment_not_found'
    );
  }

  return validateAttendancePolicyRevision(
    row.attendance_policy_revision
  );
}

export async function loadStablePayrollAttendancePolicy(
  db,
  salonId,
  employeeId,
  fromValue,
  toValue
) {
  const employment = await dbFirst(
    db,
    `SELECT
        attendance_policy_authority,
        attendance_policy_revision,
        attendance_payroll_mode,
        attendance_payroll_exemption_reason
       FROM employee_employment
      WHERE salon_id = ?
        AND employee_id = ?
      LIMIT 1`,
    [salonId, employeeId]
  );

  if (!employment) {
    throw new AppError(
      404,
      'core_attendance_policy:employment_not_found'
    );
  }

  const initialRevision =
    validateAttendancePolicyRevision(
      employment.attendance_policy_revision
    );

  const periods = await loadAttendancePolicyPeriods(
    db,
    salonId,
    employeeId
  );

  const snapshot = buildPayrollAttendancePolicySnapshot(
    employment,
    periods,
    fromValue,
    toValue
  );

  const finalRevision =
    await readAttendancePolicyRevision(
      db,
      salonId,
      employeeId
    );

  if (initialRevision !== finalRevision) {
    throw new AppError(
      409,
      'core_attendance_policy:concurrent_policy_change'
    );
  }

  return {
    revision: initialRevision,
    snapshot,
  };
}

/**
 * Clear an automatic absence only when attendance is required
 * on the actual work date.
 *
 * Keep suppressed evidence while an exemption is active.
 * Evaluate policy and deletion within one SQL statement.
 */
export async function clearAutomaticAttendanceAbsence(
  db,
  salonId,
  employeeId,
  dateValue
) {
  const date = attendancePolicyDate(dateValue);

  if (!db || !salonId || !employeeId) {
    throw new AppError(
      400,
      'core_attendance_policy:invalid_absence_target'
    );
  }

  const result = await db.prepare(`
    DELETE FROM employee_absences
     WHERE salon_id = ?
       AND employee_id = ?
       AND date_key = ?
       AND absence_type = 'automatic_check_in_lock'

       AND EXISTS (
         SELECT 1
           FROM employee_employment e
          WHERE e.salon_id = ?
            AND e.employee_id = ?
            AND (
              e.attendance_policy_authority = 'effective_dated'
              OR (
                e.attendance_policy_authority = 'legacy'
                AND e.attendance_payroll_mode = 'required'
              )
            )
       )

       AND NOT EXISTS (
         SELECT 1
           FROM employee_attendance_policy_periods p
          WHERE p.salon_id = ?
            AND p.employee_id = ?
            AND p.status = 'active'
            AND p.policy_mode = 'exempt'
            AND p.effective_from <= ?
            AND (
              p.effective_to IS NULL
              OR p.effective_to >= ?
            )
       )
  `).bind(
    salonId,
    employeeId,
    date,
    salonId,
    employeeId,
    salonId,
    employeeId,
    date,
    date
  ).run();

  return {
    cleared: Number(result?.meta?.changes ?? 0),
    date,
  };
}

/**
 * Canonical attendance policy state for authorized HR consumers.
 * Returns policy history and optional daily resolution.
 */
export async function getEmployeeAttendancePolicyState(
  db,
  salonId,
  employeeId,
  query = {}
) {
  const employment = await dbFirst(
    db,
    `SELECT employee_id,
            attendance_policy_authority,
            attendance_policy_revision,
            attendance_payroll_mode,
            attendance_payroll_exemption_reason
       FROM employee_employment
      WHERE salon_id = ?
        AND employee_id = ?
      LIMIT 1`,
    [salonId, employeeId]
  );

  if (!employment) {
    throw new AppError(
      404,
      'core_attendance_policy:employee_not_found'
    );
  }

  const revision = validateAttendancePolicyRevision(
    employment.attendance_policy_revision
  );

  const periods = await loadAttendancePolicyPeriods(
    db,
    salonId,
    employeeId
  );

  const from = query.dateFrom ?? query.date_from;
  const to = query.dateTo ?? query.date_to;

  if (Boolean(from) !== Boolean(to)) {
    throw new AppError(
      400,
      'core_attendance_policy:invalid_period'
    );
  }

  const snapshot = from && to
    ? buildPayrollAttendancePolicySnapshot(
        employment,
        periods,
        from,
        to
      )
    : null;

  const finalRevision = await readAttendancePolicyRevision(
    db,
    salonId,
    employeeId
  );

  if (revision !== finalRevision) {
    throw new AppError(
      409,
      'core_attendance_policy:concurrent_policy_change'
    );
  }

  return {
    employeeId,
    authority: employment.attendance_policy_authority,
    revision,
    legacyMode: employment.attendance_payroll_mode,
    legacyReason:
      employment.attendance_payroll_exemption_reason,
    periods,
    snapshot,
  };
}
