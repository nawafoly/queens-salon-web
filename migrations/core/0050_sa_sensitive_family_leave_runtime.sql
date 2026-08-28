-- Sensitive Saudi family-leave runtime.
-- Eligibility is driven by the explicit leave type plus verified evidence.
-- The system does not infer gender, religion, pregnancy or family status from
-- profile fields, names, nationality or any other proxy.

ALTER TABLE employee_leaves
  ADD COLUMN statutory_linked_leave_id TEXT;

ALTER TABLE employee_leaves
  ADD COLUMN statutory_end_date TEXT;

ALTER TABLE employee_leaves
  ADD COLUMN statutory_pay_phase TEXT;

CREATE INDEX idx_employee_leave_statutory_link
  ON employee_leaves(
    salon_id,
    statutory_linked_leave_id,
    status
  );

CREATE UNIQUE INDEX idx_employee_leave_statutory_link_code
  ON employee_leaves(
    salon_id,
    employee_id,
    statutory_linked_leave_id,
    statutory_validation_code
  )
  WHERE statutory_linked_leave_id IS NOT NULL
    AND statutory_validation_code IS NOT NULL;

CREATE UNIQUE INDEX idx_child_medical_one_active_episode
  ON employee_leaves(
    salon_id,
    employee_id,
    statutory_linked_leave_id
  )
  WHERE leave_type = 'child_medical_care'
    AND status = 'approved'
    AND statutory_linked_leave_id IS NOT NULL;

CREATE TABLE employee_maternity_leave_episodes (
  leave_id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,

  expected_birth_date TEXT NOT NULL,
  actual_birth_date TEXT,

  expected_date_evidence_reference TEXT NOT NULL,
  birth_evidence_reference TEXT,

  paid_entitlement_days INTEGER NOT NULL DEFAULT 84
    CHECK (paid_entitlement_days = 84),
  mandatory_post_birth_days INTEGER NOT NULL DEFAULT 42
    CHECK (mandatory_post_birth_days = 42),

  birth_reconciliation_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (
      birth_reconciliation_status IN (
        'pending',
        'reconciled',
        'review_required',
        'cancelled'
      )
    ),

  mandatory_post_birth_end_date TEXT,
  unpaid_completion_leave_id TEXT,

  policy_version TEXT NOT NULL,
  created_by_uid TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_maternity_episode_employee_leave
  ON employee_maternity_leave_episodes(
    salon_id,
    employee_id,
    leave_id
  );

CREATE INDEX idx_maternity_episode_reconciliation
  ON employee_maternity_leave_episodes(
    salon_id,
    birth_reconciliation_status,
    expected_birth_date
  );

CREATE TRIGGER trg_maternity_approval_requires_episode
BEFORE UPDATE OF status, leave_type, statutory_validation_code,
                 statutory_validated_at, documentation_status,
                 statutory_review_required, pay_rate_bps
ON employee_leaves
WHEN
  NEW.status = 'approved' AND
  NEW.leave_type = 'maternity' AND
  NOT EXISTS (
    SELECT 1
      FROM employee_maternity_leave_episodes episode
     WHERE episode.salon_id = NEW.salon_id
       AND episode.employee_id = NEW.employee_id
       AND episode.leave_id = NEW.id
       AND episode.expected_date_evidence_reference IS NOT NULL
       AND TRIM(episode.expected_date_evidence_reference) <> ''
       AND episode.paid_entitlement_days = 84
       AND episode.mandatory_post_birth_days = 42
       AND episode.birth_reconciliation_status IN ('pending','reconciled')
  )
BEGIN
  SELECT RAISE(
    ABORT,
    'maternity_leave_requires_canonical_episode'
  );
END;

CREATE TRIGGER trg_child_medical_care_requires_maternity_link
BEFORE UPDATE OF status, leave_type, statutory_linked_leave_id,
                 statutory_validation_code, statutory_validated_at,
                 documentation_status, statutory_review_required,
                 pay_rate_bps
ON employee_leaves
WHEN
  NEW.status = 'approved' AND
  NEW.leave_type = 'child_medical_care' AND
  (
    NEW.statutory_linked_leave_id IS NULL OR
    NOT EXISTS (
      SELECT 1
        FROM employee_leaves maternity
        JOIN employee_maternity_leave_episodes episode
          ON episode.salon_id = maternity.salon_id
         AND episode.employee_id = maternity.employee_id
         AND episode.leave_id = maternity.id
       WHERE maternity.salon_id = NEW.salon_id
         AND maternity.employee_id = NEW.employee_id
         AND maternity.id = NEW.statutory_linked_leave_id
         AND maternity.leave_type = 'maternity'
         AND maternity.status = 'approved'
         AND episode.birth_reconciliation_status = 'reconciled'
         AND NEW.start_date = date(
           COALESCE(maternity.statutory_end_date, maternity.end_date),
           '+1 day'
         )
    ) OR
    NEW.days_count <> 30
  )
BEGIN
  SELECT RAISE(
    ABORT,
    'child_medical_care_requires_reconciled_maternity_link'
  );
END;

CREATE TRIGGER trg_widow_non_muslim_paid_limit
BEFORE UPDATE OF status, leave_type, statutory_event_date,
                 statutory_validation_code, statutory_validated_at,
                 documentation_status, statutory_review_required,
                 pay_rate_bps
ON employee_leaves
WHEN
  NEW.status = 'approved' AND
  NEW.leave_type = 'widow_non_muslim' AND
  (
    NEW.statutory_event_date IS NULL OR
    NEW.start_date <> NEW.statutory_event_date OR
    NEW.days_count <> 15
  )
BEGIN
  SELECT RAISE(
    ABORT,
    'widow_non_muslim_leave_invalid_period'
  );
END;

CREATE TRIGGER trg_widow_muslim_requires_verified_end
BEFORE UPDATE OF status, leave_type, statutory_event_date,
                 statutory_end_date, statutory_validation_code,
                 statutory_validated_at, documentation_status,
                 statutory_review_required, pay_rate_bps
ON employee_leaves
WHEN
  NEW.status = 'approved' AND
  NEW.leave_type = 'widow_muslim' AND
  (
    NEW.statutory_event_date IS NULL OR
    NEW.statutory_end_date IS NULL OR
    NEW.start_date <> NEW.statutory_event_date OR
    NEW.end_date <> NEW.statutory_end_date OR
    NEW.days_count <= 0
  )
BEGIN
  SELECT RAISE(
    ABORT,
    'widow_muslim_leave_requires_verified_statutory_end'
  );
END;

-- A maternity leave approved before birth may remain payroll-safe only until
-- the expected birth date reaches the payroll period. From that point the
-- actual birth date must be reconciled so the mandatory six-week post-birth
-- period and any linked unpaid completion are known before payroll is locked.
CREATE TRIGGER trg_payroll_blocks_unreconciled_maternity
BEFORE UPDATE OF status ON payroll_entries
WHEN
  NEW.status = 'approved' AND
  OLD.status <> 'approved' AND
  EXISTS (
    SELECT 1
      FROM employee_maternity_leave_episodes episode
      JOIN employee_leaves maternity
        ON maternity.salon_id = episode.salon_id
       AND maternity.employee_id = episode.employee_id
       AND maternity.id = episode.leave_id
     WHERE maternity.salon_id = NEW.salon_id
       AND maternity.employee_id = NEW.employee_id
       AND maternity.status = 'approved'
       AND maternity.leave_type = 'maternity'
       AND episode.birth_reconciliation_status = 'pending'
       AND maternity.start_date <= date(NEW.payroll_month || '-01', '+1 month', '-1 day')
       AND maternity.end_date >= (NEW.payroll_month || '-01')
       AND episode.expected_birth_date <= date(NEW.payroll_month || '-01', '+1 month', '-1 day')
  )
BEGIN
  SELECT RAISE(
    ABORT,
    'maternity_birth_reconciliation_required_before_payroll_approval'
  );
END;
