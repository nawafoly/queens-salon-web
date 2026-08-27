-- Stage 11 employee offboarding concurrency invariants.
-- SOURCE ONLY in the Stage 11 review patch. Do not apply remotely as part of the patch.
--
-- The fence row is written in the same D1 batch as the employee lifecycle transition.
-- SQLite triggers make booking creation/rescheduling/reactivation and offboarding mutually exclusive:
-- - if a conflicting booking wins first, the fence write aborts;
-- - if the fence wins first, no booking or booking-item mutation may make that employee operational again.
-- Finalized/historical rows may still receive harmless non-operational corrections.

CREATE TABLE IF NOT EXISTS employee_offboarding_fences (
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  end_date TEXT NOT NULL,
  business_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'offboarded'
    CHECK (status IN ('offboarded')),
  actor_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (salon_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_employee_offboarding_fences_status
  ON employee_offboarding_fences(salon_id, status, employee_id);

-- Offboarding evidence is durable lifecycle history. Generic SQL must not erase,
-- re-key, reopen, or rewrite the effective termination boundary. A future explicit
-- Rehire lifecycle operation may introduce a new lifecycle model/migration; Stage 11
-- deliberately fails closed instead of mutating this historical fence.
CREATE TRIGGER IF NOT EXISTS trg_employee_offboarding_fence_delete_immutable
BEFORE DELETE ON employee_offboarding_fences
BEGIN
  SELECT RAISE(ABORT, 'core_hr:offboarding_fence_history_immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_employee_offboarding_fence_identity_immutable
BEFORE UPDATE OF salon_id, employee_id, end_date, status ON employee_offboarding_fences
WHEN COALESCE(NEW.salon_id, '') <> COALESCE(OLD.salon_id, '')
  OR COALESCE(NEW.employee_id, '') <> COALESCE(OLD.employee_id, '')
  OR COALESCE(NEW.end_date, '') <> COALESCE(OLD.end_date, '')
  OR COALESCE(NEW.status, '') <> COALESCE(OLD.status, '')
BEGIN
  SELECT RAISE(ABORT, 'core_hr:offboarding_fence_history_immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_employee_profiles_block_fenced_active_insert
BEFORE INSERT ON employee_profiles
WHEN LOWER(COALESCE(NEW.status, '')) = 'active'
  AND EXISTS (
    SELECT 1
      FROM employee_offboarding_fences f
     WHERE f.salon_id = NEW.salon_id
       AND f.employee_id = NEW.id
       AND f.status = 'offboarded'
  )
BEGIN
  SELECT RAISE(ABORT, 'core_hr:employee_rehire_requires_lifecycle_operation');
END;

CREATE TRIGGER IF NOT EXISTS trg_employee_profiles_block_fenced_active_update
BEFORE UPDATE OF id, salon_id, status ON employee_profiles
WHEN LOWER(COALESCE(NEW.status, '')) = 'active'
  AND EXISTS (
    SELECT 1
      FROM employee_offboarding_fences f
     WHERE f.salon_id = NEW.salon_id
       AND f.employee_id = NEW.id
       AND f.status = 'offboarded'
  )
BEGIN
  SELECT RAISE(ABORT, 'core_hr:employee_rehire_requires_lifecycle_operation');
END;

CREATE TRIGGER IF NOT EXISTS trg_employee_employment_block_fenced_rehire_insert
BEFORE INSERT ON employee_employment
WHEN EXISTS (
    SELECT 1
      FROM employee_offboarding_fences f
     WHERE f.salon_id = NEW.salon_id
       AND f.employee_id = NEW.employee_id
       AND f.status = 'offboarded'
       AND (
         LOWER(COALESCE(NEW.employment_status, '')) = 'active'
         OR COALESCE(NEW.end_date, '') <> f.end_date
       )
  )
BEGIN
  SELECT RAISE(ABORT, 'core_hr:employee_rehire_requires_lifecycle_operation');
END;

CREATE TRIGGER IF NOT EXISTS trg_employee_employment_block_fenced_rehire_update
BEFORE UPDATE OF salon_id, employee_id, employment_status, end_date ON employee_employment
WHEN EXISTS (
    SELECT 1
      FROM employee_offboarding_fences f
     WHERE f.salon_id = NEW.salon_id
       AND f.employee_id = NEW.employee_id
       AND f.status = 'offboarded'
       AND (
         LOWER(COALESCE(NEW.employment_status, '')) = 'active'
         OR COALESCE(NEW.end_date, '') <> f.end_date
       )
  )
BEGIN
  SELECT RAISE(ABORT, 'core_hr:employee_rehire_requires_lifecycle_operation');
END;

CREATE TRIGGER IF NOT EXISTS trg_staff_block_fenced_operational_insert
BEFORE INSERT ON staff
WHEN EXISTS (
    SELECT 1
      FROM employee_offboarding_fences f
     WHERE f.salon_id = NEW.salon_id
       AND f.employee_id = NEW.id
       AND f.status = 'offboarded'
       AND (
         COALESCE(NEW.active, 0) = 1
         OR COALESCE(NEW.show_on_booking, 0) = 1
         OR LOWER(COALESCE(NEW.employment_status, '')) = 'active'
       )
  )
BEGIN
  SELECT RAISE(ABORT, 'core_hr:employee_rehire_requires_lifecycle_operation');
END;

CREATE TRIGGER IF NOT EXISTS trg_staff_block_fenced_operational_update
BEFORE UPDATE OF id, salon_id, active, show_on_booking, employment_status ON staff
WHEN EXISTS (
    SELECT 1
      FROM employee_offboarding_fences f
     WHERE f.salon_id = NEW.salon_id
       AND f.employee_id = NEW.id
       AND f.status = 'offboarded'
       AND (
         COALESCE(NEW.active, 0) = 1
         OR COALESCE(NEW.show_on_booking, 0) = 1
         OR LOWER(COALESCE(NEW.employment_status, '')) = 'active'
       )
  )
BEGIN
  SELECT RAISE(ABORT, 'core_hr:employee_rehire_requires_lifecycle_operation');
END;

CREATE TRIGGER IF NOT EXISTS trg_employee_offboarding_fence_insert_booking_guard
BEFORE INSERT ON employee_offboarding_fences
WHEN NEW.status = 'offboarded'
BEGIN
  SELECT (CASE WHEN EXISTS (
    SELECT 1
      FROM bookings b
     WHERE b.salon_id = NEW.salon_id
       AND b.deleted_at IS NULL
       AND (
         (
           b.staff_id = NEW.employee_id
           AND b.booking_date > NEW.end_date
           AND (
             LOWER(COALESCE(b.status, '')) = 'completed'
             OR b.completed_at IS NOT NULL
             OR (
               b.booking_date < NEW.business_date
               AND LOWER(COALESCE(b.status, '')) NOT IN ('cancelled', 'canceled', 'rejected')
             )
           )
         )
         OR EXISTS (
           SELECT 1
             FROM booking_items bi
            WHERE bi.salon_id = b.salon_id
              AND bi.booking_id = b.id
              AND bi.staff_id = NEW.employee_id
              AND (
                b.booking_date > NEW.end_date
                OR COALESCE(bi.booking_date, b.booking_date) > NEW.end_date
              )
              AND (
                LOWER(COALESCE(b.status, '')) = 'completed'
                OR b.completed_at IS NOT NULL
                OR (
                  MIN(COALESCE(bi.booking_date, b.booking_date), b.booking_date) < NEW.business_date
                  AND LOWER(COALESCE(b.status, '')) NOT IN ('cancelled', 'canceled', 'rejected')
                )
              )
         )
       )
  ) THEN RAISE(ABORT, 'core_hr:offboarding_post_end_date_activity_conflict') END);

  SELECT (CASE WHEN EXISTS (
    SELECT 1
      FROM bookings b
     WHERE b.salon_id = NEW.salon_id
       AND b.deleted_at IS NULL
       AND LOWER(COALESCE(b.status, '')) NOT IN ('completed', 'cancelled', 'canceled', 'rejected')
       AND b.completed_at IS NULL
       AND (
         (
           b.staff_id = NEW.employee_id
           AND b.booking_date > NEW.end_date
           AND b.booking_date >= NEW.business_date
         )
         OR EXISTS (
           SELECT 1
             FROM booking_items bi
            WHERE bi.salon_id = b.salon_id
              AND bi.booking_id = b.id
              AND bi.staff_id = NEW.employee_id
              AND (
                b.booking_date > NEW.end_date
                OR COALESCE(bi.booking_date, b.booking_date) > NEW.end_date
              )
              AND MAX(COALESCE(bi.booking_date, b.booking_date), b.booking_date) >= NEW.business_date
         )
       )
  ) THEN RAISE(ABORT, 'core_hr:offboarding_future_bookings_require_reassignment') END);
END;

CREATE TRIGGER IF NOT EXISTS trg_employee_offboarding_fence_update_booking_guard
BEFORE UPDATE OF end_date, business_date, status ON employee_offboarding_fences
WHEN NEW.status = 'offboarded'
BEGIN
  SELECT (CASE WHEN EXISTS (
    SELECT 1
      FROM bookings b
     WHERE b.salon_id = NEW.salon_id
       AND b.deleted_at IS NULL
       AND (
         (
           b.staff_id = NEW.employee_id
           AND b.booking_date > NEW.end_date
           AND (
             LOWER(COALESCE(b.status, '')) = 'completed'
             OR b.completed_at IS NOT NULL
             OR (
               b.booking_date < NEW.business_date
               AND LOWER(COALESCE(b.status, '')) NOT IN ('cancelled', 'canceled', 'rejected')
             )
           )
         )
         OR EXISTS (
           SELECT 1
             FROM booking_items bi
            WHERE bi.salon_id = b.salon_id
              AND bi.booking_id = b.id
              AND bi.staff_id = NEW.employee_id
              AND (
                b.booking_date > NEW.end_date
                OR COALESCE(bi.booking_date, b.booking_date) > NEW.end_date
              )
              AND (
                LOWER(COALESCE(b.status, '')) = 'completed'
                OR b.completed_at IS NOT NULL
                OR (
                  MIN(COALESCE(bi.booking_date, b.booking_date), b.booking_date) < NEW.business_date
                  AND LOWER(COALESCE(b.status, '')) NOT IN ('cancelled', 'canceled', 'rejected')
                )
              )
         )
       )
  ) THEN RAISE(ABORT, 'core_hr:offboarding_post_end_date_activity_conflict') END);

  SELECT (CASE WHEN EXISTS (
    SELECT 1
      FROM bookings b
     WHERE b.salon_id = NEW.salon_id
       AND b.deleted_at IS NULL
       AND LOWER(COALESCE(b.status, '')) NOT IN ('completed', 'cancelled', 'canceled', 'rejected')
       AND b.completed_at IS NULL
       AND (
         (
           b.staff_id = NEW.employee_id
           AND b.booking_date > NEW.end_date
           AND b.booking_date >= NEW.business_date
         )
         OR EXISTS (
           SELECT 1
             FROM booking_items bi
            WHERE bi.salon_id = b.salon_id
              AND bi.booking_id = b.id
              AND bi.staff_id = NEW.employee_id
              AND (
                b.booking_date > NEW.end_date
                OR COALESCE(bi.booking_date, b.booking_date) > NEW.end_date
              )
              AND MAX(COALESCE(bi.booking_date, b.booking_date), b.booking_date) >= NEW.business_date
         )
       )
  ) THEN RAISE(ABORT, 'core_hr:offboarding_future_bookings_require_reassignment') END);
END;

-- Canonical booking STATUS is the operational authority. A stale completed_at timestamp
-- must never mask a transition into an operational status.
-- A newly inserted booking is blocked only when the row would be operational.
-- Finalized/deleted historical rows remain editable/importable without reopening service eligibility.
CREATE TRIGGER IF NOT EXISTS trg_bookings_block_offboarded_staff_insert
BEFORE INSERT ON bookings
WHEN NEW.deleted_at IS NULL
  AND LOWER(COALESCE(NEW.status, '')) NOT IN ('completed', 'cancelled', 'canceled', 'rejected')
  AND EXISTS (
    SELECT 1
      FROM employee_offboarding_fences f
     WHERE f.salon_id = NEW.salon_id
       AND f.status = 'offboarded'
       AND (
         f.employee_id = NEW.staff_id
         OR EXISTS (
           SELECT 1
             FROM booking_items bi
            WHERE bi.salon_id = NEW.salon_id
              AND bi.booking_id = NEW.id
              AND bi.staff_id = f.employee_id
         )
       )
  )
BEGIN
  SELECT RAISE(ABORT, 'core_booking:employee_not_active');
END;

-- Parent booking transitions are the authoritative operational-status boundary.
-- This guard covers direct parent staff assignment/date changes AND every booking_item assignment.
-- It blocks reactivation from cancelled/rejected/completed/deleted state even when the booking date
-- is historical, while allowing harmless mutations that keep the row finalized/non-operational.
-- Prevent a cancelled/finalized parent from escaping its fenced booking-item
-- relationship by changing parent identity first and restoring operational status later.
CREATE TRIGGER IF NOT EXISTS trg_bookings_block_fenced_item_identity_detach
BEFORE UPDATE OF id, salon_id ON bookings
WHEN (
    COALESCE(NEW.id, '') <> COALESCE(OLD.id, '')
    OR COALESCE(NEW.salon_id, '') <> COALESCE(OLD.salon_id, '')
  )
  AND EXISTS (
    SELECT 1
      FROM booking_items bi
      JOIN employee_offboarding_fences f
        ON f.salon_id = OLD.salon_id
       AND f.employee_id = bi.staff_id
       AND f.status = 'offboarded'
     WHERE bi.salon_id = OLD.salon_id
       AND bi.booking_id = OLD.id
  )
BEGIN
  SELECT RAISE(ABORT, 'core_booking:employee_not_active');
END;

CREATE TRIGGER IF NOT EXISTS trg_bookings_block_offboarded_staff_update
BEFORE UPDATE OF staff_id, booking_date, status, completed_at, deleted_at ON bookings
WHEN NEW.deleted_at IS NULL
  AND LOWER(COALESCE(NEW.status, '')) NOT IN ('completed', 'cancelled', 'canceled', 'rejected')
  AND EXISTS (
    SELECT 1
      FROM employee_offboarding_fences f
     WHERE f.salon_id = NEW.salon_id
       AND f.status = 'offboarded'
       AND (
         f.employee_id = NEW.staff_id
         OR EXISTS (
           SELECT 1
             FROM booking_items bi
            WHERE bi.salon_id = NEW.salon_id
              AND bi.booking_id = NEW.id
              AND bi.staff_id = f.employee_id
         )
       )
       AND (
         OLD.deleted_at IS NOT NULL
         OR OLD.completed_at IS NOT NULL
         OR LOWER(COALESCE(OLD.status, '')) IN ('completed', 'cancelled', 'canceled', 'rejected')
         OR (
           f.employee_id = NEW.staff_id
           AND COALESCE(OLD.staff_id, '') <> COALESCE(NEW.staff_id, '')
         )
         OR NEW.booking_date > f.end_date
         OR EXISTS (
           SELECT 1
             FROM booking_items bi
            WHERE bi.salon_id = NEW.salon_id
              AND bi.booking_id = NEW.id
              AND bi.staff_id = f.employee_id
              AND COALESCE(bi.booking_date, NEW.booking_date) > f.end_date
         )
       )
  )
BEGIN
  SELECT RAISE(ABORT, 'core_booking:employee_not_active');
END;

-- Item-level assignment is allowed on finalized parents for historical correction only.
-- If the parent is operational, assigning an offboarded employee is forbidden.
CREATE TRIGGER IF NOT EXISTS trg_booking_items_block_offboarded_staff_insert
BEFORE INSERT ON booking_items
WHEN NEW.staff_id IS NOT NULL
  AND EXISTS (
    SELECT 1
      FROM employee_offboarding_fences f
      JOIN bookings b
        ON b.salon_id = NEW.salon_id
       AND b.id = NEW.booking_id
     WHERE f.salon_id = NEW.salon_id
       AND f.employee_id = NEW.staff_id
       AND f.status = 'offboarded'
       AND b.deleted_at IS NULL
       AND LOWER(COALESCE(b.status, '')) NOT IN ('completed', 'cancelled', 'canceled', 'rejected')
  )
BEGIN
  SELECT RAISE(ABORT, 'core_booking:employee_not_active');
END;

CREATE TRIGGER IF NOT EXISTS trg_booking_items_block_offboarded_staff_update
BEFORE UPDATE OF booking_id, salon_id, staff_id, booking_date ON booking_items
WHEN NEW.staff_id IS NOT NULL
  AND EXISTS (
    SELECT 1
      FROM employee_offboarding_fences f
      JOIN bookings b
        ON b.salon_id = NEW.salon_id
       AND b.id = NEW.booking_id
     WHERE f.salon_id = NEW.salon_id
       AND f.employee_id = NEW.staff_id
       AND f.status = 'offboarded'
       AND b.deleted_at IS NULL
       AND LOWER(COALESCE(b.status, '')) NOT IN ('completed', 'cancelled', 'canceled', 'rejected')
       AND (
         COALESCE(OLD.staff_id, '') <> COALESCE(NEW.staff_id, '')
         OR COALESCE(OLD.booking_id, '') <> COALESCE(NEW.booking_id, '')
         OR COALESCE(OLD.salon_id, '') <> COALESCE(NEW.salon_id, '')
         OR COALESCE(NEW.booking_date, b.booking_date) > f.end_date
       )
  )
BEGIN
  SELECT RAISE(ABORT, 'core_booking:employee_not_active');
END;
