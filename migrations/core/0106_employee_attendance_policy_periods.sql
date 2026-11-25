-- Effective-dated attendance policy.
-- Existing employment policy remains a compatibility baseline.
-- No historical exemption dates are inferred during migration.

CREATE TABLE IF NOT EXISTS employee_attendance_policy_periods (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,

  policy_mode TEXT NOT NULL
    CHECK (policy_mode IN ('required', 'exempt')),

  effective_from TEXT NOT NULL
    CHECK (
      length(effective_from) = 10
      AND date(effective_from, '+0 days') IS NOT NULL
      AND effective_from = date(effective_from, '+0 days')
    ),

  effective_to TEXT
    CHECK (
      effective_to IS NULL OR (
        length(effective_to) = 10
        AND date(effective_to, '+0 days') IS NOT NULL
        AND effective_to = date(effective_to, '+0 days')
        AND effective_to >= effective_from
      )
    ),

  reason TEXT NOT NULL
    CHECK (length(trim(reason)) > 0),

  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'cancelled')),

  version INTEGER NOT NULL DEFAULT 1
    CHECK (version >= 1),

  created_by_uid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by_uid TEXT NOT NULL,

  cancelled_at TEXT,
  cancelled_by_uid TEXT,
  cancellation_reason TEXT,

  CHECK (
    (
      status = 'active'
      AND cancelled_at IS NULL
      AND cancelled_by_uid IS NULL
      AND cancellation_reason IS NULL
    )
    OR
    (
      status = 'cancelled'
      AND cancelled_at IS NOT NULL
      AND cancelled_by_uid IS NOT NULL
      AND cancellation_reason IS NOT NULL
      AND length(trim(cancellation_reason)) > 0
    )
  )
);

CREATE INDEX IF NOT EXISTS
  idx_employee_attendance_policy_period_lookup
ON employee_attendance_policy_periods (
  salon_id,
  employee_id,
  status,
  effective_from,
  effective_to
);

CREATE TRIGGER IF NOT EXISTS
  trg_attendance_policy_employee_insert
BEFORE INSERT ON employee_attendance_policy_periods
WHEN NOT EXISTS (
  SELECT 1
  FROM employee_employment
  WHERE salon_id = NEW.salon_id
    AND employee_id = NEW.employee_id
)
BEGIN
  SELECT RAISE(ABORT, 'attendance_policy_employee_not_found');
END;

CREATE TRIGGER IF NOT EXISTS
  trg_attendance_policy_overlap_insert
BEFORE INSERT ON employee_attendance_policy_periods
WHEN NEW.status = 'active'
AND EXISTS (
  SELECT 1
  FROM employee_attendance_policy_periods p
  WHERE p.salon_id = NEW.salon_id
    AND p.employee_id = NEW.employee_id
    AND p.status = 'active'
    AND p.effective_from <= COALESCE(NEW.effective_to, '9999-12-31')
    AND COALESCE(p.effective_to, '9999-12-31') >= NEW.effective_from
)
BEGIN
  SELECT RAISE(ABORT, 'attendance_policy_period_overlap');
END;

CREATE TRIGGER IF NOT EXISTS
  trg_attendance_policy_overlap_update
BEFORE UPDATE ON employee_attendance_policy_periods
WHEN NEW.status = 'active'
AND EXISTS (
  SELECT 1
  FROM employee_attendance_policy_periods p
  WHERE p.id <> OLD.id
    AND p.salon_id = NEW.salon_id
    AND p.employee_id = NEW.employee_id
    AND p.status = 'active'
    AND p.effective_from <= COALESCE(NEW.effective_to, '9999-12-31')
    AND COALESCE(p.effective_to, '9999-12-31') >= NEW.effective_from
)
BEGIN
  SELECT RAISE(ABORT, 'attendance_policy_period_overlap');
END;

CREATE TRIGGER IF NOT EXISTS
  trg_attendance_policy_identity_immutable
BEFORE UPDATE ON employee_attendance_policy_periods
WHEN NEW.id IS NOT OLD.id
  OR NEW.salon_id IS NOT OLD.salon_id
  OR NEW.employee_id IS NOT OLD.employee_id
  OR NEW.created_at IS NOT OLD.created_at
  OR NEW.created_by_uid IS NOT OLD.created_by_uid
BEGIN
  SELECT RAISE(ABORT, 'attendance_policy_identity_immutable');
END;

CREATE TRIGGER IF NOT EXISTS
  trg_attendance_policy_revision_guard
BEFORE UPDATE ON employee_attendance_policy_periods
WHEN NEW.version <> OLD.version + 1
BEGIN
  SELECT RAISE(ABORT, 'attendance_policy_revision_invalid');
END;

CREATE TRIGGER IF NOT EXISTS
  trg_attendance_policy_cancelled_immutable
BEFORE UPDATE ON employee_attendance_policy_periods
WHEN OLD.status = 'cancelled'
BEGIN
  SELECT RAISE(ABORT, 'attendance_policy_cancelled_immutable');
END;

CREATE TRIGGER IF NOT EXISTS
  trg_attendance_policy_no_delete
BEFORE DELETE ON employee_attendance_policy_periods
BEGIN
  SELECT RAISE(ABORT, 'attendance_policy_delete_forbidden');
END;

CREATE TABLE IF NOT EXISTS employee_attendance_policy_events (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('created', 'updated', 'cancelled')),
  version INTEGER NOT NULL,
  actor_uid TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT NOT NULL,
  UNIQUE (policy_id, version),
  FOREIGN KEY (policy_id)
    REFERENCES employee_attendance_policy_periods(id)
);

CREATE TRIGGER IF NOT EXISTS
  trg_attendance_policy_audit_no_update
BEFORE UPDATE ON employee_attendance_policy_events
BEGIN
  SELECT RAISE(ABORT, 'attendance_policy_audit_immutable');
END;

CREATE TRIGGER IF NOT EXISTS
  trg_attendance_policy_audit_no_delete
BEFORE DELETE ON employee_attendance_policy_events
BEGIN
  SELECT RAISE(ABORT, 'attendance_policy_audit_immutable');
END;

CREATE TRIGGER IF NOT EXISTS
  trg_attendance_policy_audit_insert
AFTER INSERT ON employee_attendance_policy_periods
BEGIN
  INSERT INTO employee_attendance_policy_events (
    id, policy_id, salon_id, employee_id,
    event_type, version, actor_uid,
    occurred_at, before_json, after_json
  ) VALUES (
    NEW.id || ':' || NEW.version,
    NEW.id, NEW.salon_id, NEW.employee_id,
    'created', NEW.version, NEW.created_by_uid,
    NEW.created_at, NULL,
    json_object(
      'mode', NEW.policy_mode,
      'from', NEW.effective_from,
      'to', NEW.effective_to,
      'reason', NEW.reason,
      'status', NEW.status,
      'version', NEW.version
    )
  );
END;

CREATE TRIGGER IF NOT EXISTS
  trg_attendance_policy_audit_update
AFTER UPDATE ON employee_attendance_policy_periods
BEGIN
  INSERT INTO employee_attendance_policy_events (
    id, policy_id, salon_id, employee_id,
    event_type, version, actor_uid,
    occurred_at, before_json, after_json
  ) VALUES (
    NEW.id || ':' || NEW.version,
    NEW.id, NEW.salon_id, NEW.employee_id,
    CASE
      WHEN NEW.status = 'cancelled' THEN 'cancelled'
      ELSE 'updated'
    END,
    NEW.version,
    NEW.updated_by_uid,
    NEW.updated_at,
    json_object(
      'mode', OLD.policy_mode,
      'from', OLD.effective_from,
      'to', OLD.effective_to,
      'reason', OLD.reason,
      'status', OLD.status,
      'version', OLD.version
    ),
    json_object(
      'mode', NEW.policy_mode,
      'from', NEW.effective_from,
      'to', NEW.effective_to,
      'reason', NEW.reason,
      'status', NEW.status,
      'version', NEW.version,
      'cancelledAt', NEW.cancelled_at,
      'cancelledByUid', NEW.cancelled_by_uid,
      'cancellationReason', NEW.cancellation_reason
    )
  );
END;

-- Explicit policy ownership.
-- Legacy exemptions remain unchanged until administrative adoption.

ALTER TABLE employee_employment
  ADD COLUMN attendance_policy_authority TEXT NOT NULL
  DEFAULT 'legacy'
  CHECK (
    attendance_policy_authority IN (
      'legacy',
      'effective_dated'
    )
  );

CREATE TRIGGER IF NOT EXISTS
  trg_attendance_policy_authority_no_downgrade
BEFORE UPDATE OF attendance_policy_authority
ON employee_employment
WHEN OLD.attendance_policy_authority = 'effective_dated'
AND NEW.attendance_policy_authority <> 'effective_dated'
BEGIN
  SELECT RAISE(
    ABORT,
    'attendance_policy_authority_downgrade_forbidden'
  );
END;

-- Legacy policy columns become read-only after effective-dated adoption.
-- Unchanged compatibility writes remain allowed.

CREATE TRIGGER IF NOT EXISTS
  trg_attendance_policy_legacy_write_guard
BEFORE UPDATE OF
  attendance_payroll_mode,
  attendance_payroll_exemption_reason
ON employee_employment
WHEN OLD.attendance_policy_authority = 'effective_dated'
AND (
  NEW.attendance_payroll_mode IS NOT OLD.attendance_payroll_mode
  OR NEW.attendance_payroll_exemption_reason
     IS NOT OLD.attendance_payroll_exemption_reason
)
BEGIN
  SELECT RAISE(
    ABORT,
    'attendance_policy_legacy_write_forbidden'
  );
END;
