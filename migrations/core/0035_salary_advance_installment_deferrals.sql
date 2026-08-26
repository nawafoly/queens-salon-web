-- STAGE 11.3B
-- Canonical salary advance installment deferral.
--
-- salary_advances.first_deduction_month remains the ORIGINAL approved schedule.
-- salary_advance_installments.payroll_month is the CURRENT canonical schedule.
--
-- This migration owns only integrity and state-transition enforcement:
--   - immutable deferral history
--   - exact installment/source snapshot validation
--   - source/target payroll and payroll-period locks
--   - optimistic stale-projection guards
--   - canonical installment schedule movement/linkage
--
-- Payroll financial formulas are NOT duplicated here. Canonical payroll code
-- precomputes the source/target draft projections and applies those rows in the
-- same D1 batch as the immutable event.

CREATE TABLE IF NOT EXISTS salary_advance_installment_deferrals (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  advance_id TEXT NOT NULL,
  installment_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,

  original_payroll_month TEXT NOT NULL,
  from_payroll_month TEXT NOT NULL,
  to_payroll_month TEXT NOT NULL,
  amount_halalas INTEGER NOT NULL CHECK(amount_halalas > 0),

  from_installment_updated_at TEXT NOT NULL,
  from_installment_payroll_entry_id TEXT,

  from_payroll_entry_id TEXT,
  to_payroll_entry_id TEXT,

  from_payroll_entry_updated_at TEXT,
  to_payroll_entry_updated_at TEXT,
  from_payroll_advances_halalas INTEGER,
  to_payroll_advances_halalas INTEGER,

  reason TEXT NOT NULL,
  note TEXT,
  source TEXT NOT NULL,

  idempotency_key TEXT NOT NULL,

  created_by_uid TEXT,
  created_by_email TEXT,
  created_at TEXT NOT NULL,

  CHECK(original_payroll_month <= from_payroll_month),
  CHECK(to_payroll_month > from_payroll_month),
  CHECK(LENGTH(TRIM(reason)) > 0),
  CHECK(LENGTH(TRIM(source)) > 0),
  CHECK(LENGTH(TRIM(idempotency_key)) > 0),
  CHECK(
    COALESCE(TRIM(created_by_uid), '') <> ''
    OR COALESCE(TRIM(created_by_email), '') <> ''
  ),
  CHECK(
    (from_payroll_entry_id IS NULL AND from_payroll_entry_updated_at IS NULL)
    OR
    (from_payroll_entry_id IS NOT NULL AND from_payroll_entry_updated_at IS NOT NULL)
  ),
  CHECK(
    (to_payroll_entry_id IS NULL AND to_payroll_entry_updated_at IS NULL)
    OR
    (to_payroll_entry_id IS NOT NULL AND to_payroll_entry_updated_at IS NOT NULL)
  ),

  UNIQUE(salon_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_salary_advance_installment_deferrals_installment
  ON salary_advance_installment_deferrals(
    salon_id,
    installment_id,
    created_at
  );

CREATE INDEX IF NOT EXISTS idx_salary_advance_installment_deferrals_months
  ON salary_advance_installment_deferrals(
    salon_id,
    employee_id,
    from_payroll_month,
    to_payroll_month
  );

-- The immutable event must describe the exact currently scheduled installment
-- and an advance that is still eligible for collection.
CREATE TRIGGER IF NOT EXISTS trg_salary_advance_deferral_validate_installment
BEFORE INSERT ON salary_advance_installment_deferrals
WHEN NOT EXISTS (
  SELECT 1
    FROM salary_advance_installments sai
    JOIN salary_advances sa
      ON sa.salon_id = sai.salon_id
     AND sa.id = sai.advance_id
   WHERE sai.salon_id = NEW.salon_id
     AND sai.id = NEW.installment_id
     AND sai.advance_id = NEW.advance_id
     AND sa.employee_id = NEW.employee_id
     AND sai.status = 'scheduled'
     AND sai.deducted_at IS NULL
     AND sai.payroll_month = NEW.from_payroll_month
     AND sai.amount_halalas = NEW.amount_halalas
     AND COALESCE(sai.updated_at, '') = COALESCE(NEW.from_installment_updated_at, '')
     AND COALESCE(sai.payroll_entry_id, '') = COALESCE(NEW.from_installment_payroll_entry_id, '')
     AND LOWER(COALESCE(sa.payment_status, '')) NOT IN ('cancelled', 'voided', 'repaid')
)
BEGIN
  SELECT RAISE(
    ABORT,
    'salary_advance_deferral_installment_not_scheduled_or_source_mismatch'
  );
END;

-- Every event carries the immutable original month. On the first deferral it
-- must equal the current source month; later deferrals must preserve the exact
-- original month from the earliest event for this installment.
CREATE TRIGGER IF NOT EXISTS trg_salary_advance_deferral_validate_original_month
BEFORE INSERT ON salary_advance_installment_deferrals
WHEN NEW.original_payroll_month <> COALESCE(
  (
    SELECT d.original_payroll_month
      FROM salary_advance_installment_deferrals d
     WHERE d.salon_id = NEW.salon_id
       AND d.installment_id = NEW.installment_id
     ORDER BY d.created_at, d.id
     LIMIT 1
  ),
  NEW.from_payroll_month
)
BEGIN
  SELECT RAISE(
    ABORT,
    'salary_advance_deferral_original_month_mismatch'
  );
END;

-- A linked source installment must point to the same employee/current month.
CREATE TRIGGER IF NOT EXISTS trg_salary_advance_deferral_validate_source_link
BEFORE INSERT ON salary_advance_installment_deferrals
WHEN EXISTS (
  SELECT 1
    FROM salary_advance_installments sai
   WHERE sai.salon_id = NEW.salon_id
     AND sai.id = NEW.installment_id
     AND sai.payroll_entry_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
         FROM payroll_entries pe
        WHERE pe.salon_id = NEW.salon_id
          AND pe.id = sai.payroll_entry_id
          AND pe.employee_id = NEW.employee_id
          AND pe.payroll_month = NEW.from_payroll_month
     )
)
BEGIN
  SELECT RAISE(
    ABORT,
    'salary_advance_deferral_source_payroll_link_mismatch'
  );
END;

-- Approved/paid payroll rows are immutable for salary-advance movement.
CREATE TRIGGER IF NOT EXISTS trg_salary_advance_deferral_source_payroll_lock
BEFORE INSERT ON salary_advance_installment_deferrals
WHEN EXISTS (
  SELECT 1
    FROM payroll_entries pe
   WHERE pe.salon_id = NEW.salon_id
     AND pe.employee_id = NEW.employee_id
     AND pe.payroll_month = NEW.from_payroll_month
     AND LOWER(COALESCE(pe.status, 'draft')) IN ('approved', 'paid')
)
BEGIN
  SELECT RAISE(
    ABORT,
    'salary_advance_deferral_source_payroll_locked'
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_salary_advance_deferral_target_payroll_lock
BEFORE INSERT ON salary_advance_installment_deferrals
WHEN EXISTS (
  SELECT 1
    FROM payroll_entries pe
   WHERE pe.salon_id = NEW.salon_id
     AND pe.employee_id = NEW.employee_id
     AND pe.payroll_month = NEW.to_payroll_month
     AND LOWER(COALESCE(pe.status, 'draft')) IN ('approved', 'paid')
)
BEGIN
  SELECT RAISE(
    ABORT,
    'salary_advance_deferral_target_payroll_locked'
  );
END;

-- Closed/locked/finalized payroll periods cannot be rewritten.
CREATE TRIGGER IF NOT EXISTS trg_salary_advance_deferral_source_period_lock
BEFORE INSERT ON salary_advance_installment_deferrals
WHEN EXISTS (
  SELECT 1
    FROM payroll_periods pp
   WHERE pp.salon_id = NEW.salon_id
     AND pp.payroll_month = NEW.from_payroll_month
     AND LOWER(COALESCE(pp.status, 'open')) IN (
       'closed', 'approved', 'paid', 'locked', 'posted', 'posted_to_payroll'
     )
)
BEGIN
  SELECT RAISE(
    ABORT,
    'salary_advance_deferral_source_period_locked'
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_salary_advance_deferral_target_period_lock
BEFORE INSERT ON salary_advance_installment_deferrals
WHEN EXISTS (
  SELECT 1
    FROM payroll_periods pp
   WHERE pp.salon_id = NEW.salon_id
     AND pp.payroll_month = NEW.to_payroll_month
     AND LOWER(COALESCE(pp.status, 'open')) IN (
       'closed', 'approved', 'paid', 'locked', 'posted', 'posted_to_payroll'
     )
)
BEGIN
  SELECT RAISE(
    ABORT,
    'salary_advance_deferral_target_period_locked'
  );
END;

-- Optimistic stale guards: presence/identity and the current mutable payroll
-- projection must still match the snapshot that canonical payroll code read
-- before it produced the replacement projection.
CREATE TRIGGER IF NOT EXISTS trg_salary_advance_deferral_source_projection_snapshot
BEFORE INSERT ON salary_advance_installment_deferrals
WHEN
  (
    NEW.from_payroll_entry_id IS NULL
    AND EXISTS (
      SELECT 1
        FROM payroll_entries pe
       WHERE pe.salon_id = NEW.salon_id
         AND pe.employee_id = NEW.employee_id
         AND pe.payroll_month = NEW.from_payroll_month
    )
  )
  OR
  (
    NEW.from_payroll_entry_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
        FROM payroll_entries pe
       WHERE pe.salon_id = NEW.salon_id
         AND pe.id = NEW.from_payroll_entry_id
         AND pe.employee_id = NEW.employee_id
         AND pe.payroll_month = NEW.from_payroll_month
         AND LOWER(COALESCE(pe.status, 'draft')) NOT IN ('approved', 'paid')
         AND COALESCE(pe.updated_at, '') = COALESCE(NEW.from_payroll_entry_updated_at, '')
         AND COALESCE(pe.advances_halalas, 0) = COALESCE(NEW.from_payroll_advances_halalas, 0)
    )
  )
BEGIN
  SELECT RAISE(
    ABORT,
    'salary_advance_deferral_source_projection_stale'
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_salary_advance_deferral_target_projection_snapshot
BEFORE INSERT ON salary_advance_installment_deferrals
WHEN
  (
    NEW.to_payroll_entry_id IS NULL
    AND EXISTS (
      SELECT 1
        FROM payroll_entries pe
       WHERE pe.salon_id = NEW.salon_id
         AND pe.employee_id = NEW.employee_id
         AND pe.payroll_month = NEW.to_payroll_month
    )
  )
  OR
  (
    NEW.to_payroll_entry_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
        FROM payroll_entries pe
       WHERE pe.salon_id = NEW.salon_id
         AND pe.id = NEW.to_payroll_entry_id
         AND pe.employee_id = NEW.employee_id
         AND pe.payroll_month = NEW.to_payroll_month
         AND LOWER(COALESCE(pe.status, 'draft')) NOT IN ('approved', 'paid')
         AND COALESCE(pe.updated_at, '') = COALESCE(NEW.to_payroll_entry_updated_at, '')
         AND COALESCE(pe.advances_halalas, 0) = COALESCE(NEW.to_payroll_advances_halalas, 0)
    )
  )
BEGIN
  SELECT RAISE(
    ABORT,
    'salary_advance_deferral_target_projection_stale'
  );
END;

-- Generic SQL cannot reschedule an installment directly. A matching immutable
-- deferral event is required for the exact movement.
CREATE TRIGGER IF NOT EXISTS trg_salary_advance_installment_payroll_month_canonical_update
BEFORE UPDATE OF payroll_month ON salary_advance_installments
WHEN NEW.payroll_month <> OLD.payroll_month
 AND NOT EXISTS (
   SELECT 1
     FROM salary_advance_installment_deferrals d
    WHERE d.salon_id = OLD.salon_id
      AND d.advance_id = OLD.advance_id
      AND d.installment_id = OLD.id
      AND d.from_payroll_month = OLD.payroll_month
      AND d.to_payroll_month = NEW.payroll_month
      AND d.amount_halalas = OLD.amount_halalas
      AND d.created_at = NEW.updated_at
 )
BEGIN
  SELECT RAISE(
    ABORT,
    'salary_advance_installment_payroll_month_requires_canonical_deferral'
  );
END;

-- Event insertion moves/relinks only canonical schedule state. The source and
-- target payroll projections are separate statements in the SAME D1 batch;
-- any failure rolls the event and this trigger mutation back together.
CREATE TRIGGER IF NOT EXISTS trg_salary_advance_deferral_apply_schedule
AFTER INSERT ON salary_advance_installment_deferrals
BEGIN
  UPDATE salary_advance_installments
     SET payroll_month = NEW.to_payroll_month,
         payroll_entry_id = (
           SELECT pe.id
             FROM payroll_entries pe
            WHERE pe.salon_id = NEW.salon_id
              AND pe.employee_id = NEW.employee_id
              AND pe.payroll_month = NEW.to_payroll_month
              AND LOWER(COALESCE(pe.status, 'draft')) IN ('draft', 'reviewed')
            LIMIT 1
         ),
         updated_at = NEW.created_at
   WHERE salon_id = NEW.salon_id
     AND id = NEW.installment_id
     AND advance_id = NEW.advance_id
     AND status = 'scheduled'
     AND payroll_month = NEW.from_payroll_month;
END;

-- Deferral history is append-only and immutable.
CREATE TRIGGER IF NOT EXISTS trg_salary_advance_installment_deferrals_immutable_update
BEFORE UPDATE ON salary_advance_installment_deferrals
BEGIN
  SELECT RAISE(
    ABORT,
    'salary_advance_installment_deferrals_immutable'
  );
END;

CREATE TRIGGER IF NOT EXISTS trg_salary_advance_installment_deferrals_immutable_delete
BEFORE DELETE ON salary_advance_installment_deferrals
BEGIN
  SELECT RAISE(
    ABORT,
    'salary_advance_installment_deferrals_immutable'
  );
END;
