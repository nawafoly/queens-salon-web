-- Weekly rest rescheduling foundation.
-- A work/rest swap is distinct from compensated weekly-rest work.
-- Original schedule evidence and operation identity are retained.

CREATE TABLE employee_weekly_rest_rescheduling (
    id TEXT PRIMARY KEY,
    salon_id TEXT NOT NULL,
    employee_id TEXT NOT NULL,

    original_rest_date TEXT NOT NULL,
    replacement_rest_date TEXT NOT NULL,

    work_start_time TEXT NOT NULL,
    work_end_time TEXT NOT NULL,

    original_rest_snapshot_json TEXT NOT NULL,
    replacement_work_snapshot_json TEXT NOT NULL,

    original_rest_exception_id TEXT,

    work_exception_id TEXT NOT NULL UNIQUE,
    rest_exception_id TEXT NOT NULL UNIQUE,

    reason TEXT NOT NULL
        CHECK (length(trim(reason)) BETWEEN 1 AND 1500),

    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'cancelled')),

    created_by_uid TEXT NOT NULL
        CHECK (length(trim(created_by_uid)) > 0),

    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    cancelled_by_uid TEXT,
    cancelled_at TEXT,
    cancellation_reason TEXT,

    CHECK (original_rest_date <> replacement_rest_date),

    CHECK (work_exception_id <> rest_exception_id),

    CHECK (
        status = 'active'
        OR (
            length(trim(COALESCE(cancelled_by_uid, ''))) > 0
            AND cancelled_at IS NOT NULL
            AND length(trim(COALESCE(cancellation_reason, ''))) > 0
        )
    )
);

CREATE INDEX idx_weekly_rest_rescheduling_employee
ON employee_weekly_rest_rescheduling (
    salon_id,
    employee_id,
    original_rest_date,
    replacement_rest_date,
    status
);

CREATE UNIQUE INDEX idx_weekly_rest_rescheduling_original_active
ON employee_weekly_rest_rescheduling (
    salon_id,
    employee_id,
    original_rest_date
)
WHERE status = 'active';

CREATE UNIQUE INDEX idx_weekly_rest_rescheduling_replacement_active
ON employee_weekly_rest_rescheduling (
    salon_id,
    employee_id,
    replacement_rest_date
)
WHERE status = 'active';

CREATE TRIGGER trg_weekly_rest_rescheduling_no_cross_date_overlap
BEFORE INSERT ON employee_weekly_rest_rescheduling
WHEN NEW.status = 'active'
AND EXISTS (
    SELECT 1
    FROM employee_weekly_rest_rescheduling existing
    WHERE existing.salon_id = NEW.salon_id
      AND existing.employee_id = NEW.employee_id
      AND existing.status = 'active'
      AND (
          existing.original_rest_date IN (
              NEW.original_rest_date,
              NEW.replacement_rest_date
          )
          OR existing.replacement_rest_date IN (
              NEW.original_rest_date,
              NEW.replacement_rest_date
          )
      )
)
BEGIN
    SELECT RAISE(ABORT, 'weekly_rest_rescheduling_overlap');
END;

CREATE TRIGGER trg_weekly_rest_rescheduling_initial_state
BEFORE INSERT ON employee_weekly_rest_rescheduling
WHEN NEW.status <> 'active'
BEGIN
    SELECT RAISE(ABORT, 'weekly_rest_rescheduling_invalid_initial_state');
END;

CREATE TRIGGER trg_weekly_rest_rescheduling_identity_immutable
BEFORE UPDATE ON employee_weekly_rest_rescheduling
WHEN
    NEW.id IS NOT OLD.id
    OR NEW.salon_id IS NOT OLD.salon_id
    OR NEW.employee_id IS NOT OLD.employee_id
    OR NEW.original_rest_date IS NOT OLD.original_rest_date
    OR NEW.replacement_rest_date IS NOT OLD.replacement_rest_date
    OR NEW.work_start_time IS NOT OLD.work_start_time
    OR NEW.work_end_time IS NOT OLD.work_end_time
    OR NEW.original_rest_exception_id IS NOT OLD.original_rest_exception_id
    OR NEW.work_exception_id IS NOT OLD.work_exception_id
    OR NEW.rest_exception_id IS NOT OLD.rest_exception_id
    OR NEW.original_rest_snapshot_json IS NOT OLD.original_rest_snapshot_json
    OR NEW.replacement_work_snapshot_json IS NOT OLD.replacement_work_snapshot_json
    OR NEW.created_by_uid IS NOT OLD.created_by_uid
    OR NEW.created_at IS NOT OLD.created_at
    OR NEW.reason IS NOT OLD.reason
BEGIN
    SELECT RAISE(ABORT, 'weekly_rest_rescheduling_identity_immutable');
END;

CREATE TRIGGER trg_weekly_rest_rescheduling_cancelled_immutable
BEFORE UPDATE ON employee_weekly_rest_rescheduling
WHEN OLD.status = 'cancelled'
BEGIN
    SELECT RAISE(ABORT, 'weekly_rest_rescheduling_cancelled_immutable');
END;

CREATE TRIGGER trg_weekly_rest_rescheduling_no_delete
BEFORE DELETE ON employee_weekly_rest_rescheduling
BEGIN
    SELECT RAISE(ABORT, 'weekly_rest_rescheduling_history_immutable');
END;

-- Prevent a payroll approval race between validation and commit.

CREATE TRIGGER trg_rest_rescheduling_payroll_insert
BEFORE INSERT ON employee_weekly_rest_rescheduling
WHEN EXISTS (
    SELECT 1
    FROM employee_attendance_policy_locked_ranges l
    WHERE l.salon_id = NEW.salon_id
      AND (
          l.employee_id IS NULL
          OR l.employee_id = NEW.employee_id
      )
      AND (
          NEW.original_rest_date BETWEEN l.date_from AND l.date_to
          OR NEW.replacement_rest_date BETWEEN l.date_from AND l.date_to
      )
)
OR EXISTS (
    SELECT 1
    FROM payroll_periods p
    WHERE p.salon_id = NEW.salon_id
      AND p.status IN ('closed', 'approved', 'paid', 'locked')
      AND (
          NEW.original_rest_date BETWEEN p.month_start AND p.month_end
          OR NEW.replacement_rest_date BETWEEN p.month_start AND p.month_end
      )
)
BEGIN
    SELECT RAISE(
        ABORT,
        'weekly_rest_rescheduling_payroll_locked'
    );
END;

-- A compensated assignment and a rest swap cannot own the same date.

CREATE TRIGGER trg_rest_rescheduling_assignment_insert
BEFORE INSERT ON employee_weekly_rest_rescheduling
WHEN EXISTS (
    SELECT 1
    FROM employee_weekly_rest_work_assignments a
    WHERE a.salon_id = NEW.salon_id
      AND a.employee_id = NEW.employee_id
      AND a.status IN ('assigned', 'completed')
      AND a.rest_date IN (
          NEW.original_rest_date,
          NEW.replacement_rest_date
      )
)
BEGIN
    SELECT RAISE(
        ABORT,
        'weekly_rest_rescheduling_assignment_conflict'
    );
END;

CREATE TRIGGER trg_rest_assignment_rescheduling_insert
BEFORE INSERT ON employee_weekly_rest_work_assignments
WHEN NEW.status IN ('assigned', 'completed')
AND EXISTS (
    SELECT 1
    FROM employee_weekly_rest_rescheduling r
    WHERE r.salon_id = NEW.salon_id
      AND r.employee_id = NEW.employee_id
      AND r.status = 'active'
      AND NEW.rest_date IN (
          r.original_rest_date,
          r.replacement_rest_date
      )
)
BEGIN
    SELECT RAISE(
        ABORT,
        'weekly_rest_rescheduling_assignment_conflict'
    );
END;

CREATE TRIGGER trg_rest_assignment_rescheduling_update
BEFORE UPDATE ON employee_weekly_rest_work_assignments
WHEN NEW.status IN ('assigned', 'completed')
AND EXISTS (
    SELECT 1
    FROM employee_weekly_rest_rescheduling r
    WHERE r.salon_id = NEW.salon_id
      AND r.employee_id = NEW.employee_id
      AND r.status = 'active'
      AND NEW.rest_date IN (
          r.original_rest_date,
          r.replacement_rest_date
      )
)
BEGIN
    SELECT RAISE(
        ABORT,
        'weekly_rest_rescheduling_assignment_conflict'
    );
END;

-- Recheck operational exceptions in the same write transaction.

CREATE TRIGGER trg_rest_rescheduling_schedule_insert
BEFORE INSERT ON employee_weekly_rest_rescheduling
WHEN EXISTS (
    SELECT 1
    FROM hr_schedule_exceptions e
    WHERE e.salon_id = NEW.salon_id
      AND e.employee_id = NEW.employee_id
      AND e.status IN ('approved', 'active')
      AND (
          NEW.original_rest_date BETWEEN e.date_from AND e.date_to
          OR NEW.replacement_rest_date BETWEEN e.date_from AND e.date_to
      )
      AND NOT (
          NEW.original_rest_exception_id IS NOT NULL
          AND e.id = NEW.original_rest_exception_id
          AND e.date_from = NEW.original_rest_date
          AND e.date_to = NEW.original_rest_date
          AND e.exception_type = 'off'
          AND substr(lower(trim(COALESCE(e.note, ''))), 1, 17)
              = '[temp_weekly_off:'
      )
)
BEGIN
    SELECT RAISE(
        ABORT,
        'weekly_rest_rescheduling_schedule_conflict'
    );
END;

CREATE TRIGGER trg_rest_rescheduling_original_exception_evidence
BEFORE INSERT ON employee_weekly_rest_rescheduling
WHEN NEW.original_rest_exception_id IS NOT NULL
BEGIN
    SELECT RAISE(
        ABORT,
        'weekly_rest_rescheduling_schedule_conflict'
    )
    WHERE NOT EXISTS (
        SELECT 1
        FROM hr_schedule_exceptions e
        WHERE e.id = NEW.original_rest_exception_id
          AND e.salon_id = NEW.salon_id
          AND e.employee_id = NEW.employee_id
          AND e.date_from = NEW.original_rest_date
          AND e.date_to = NEW.original_rest_date
          AND e.status IN ('approved', 'active')
          AND e.exception_type = 'off'
          AND substr(lower(trim(COALESCE(e.note, ''))), 1, 17)
              = '[temp_weekly_off:'
          AND e.id IS json_extract(
              NEW.original_rest_snapshot_json, '$.id'
          )
          AND e.note IS json_extract(
              NEW.original_rest_snapshot_json, '$.note'
          )
          AND e.status IS json_extract(
              NEW.original_rest_snapshot_json, '$.status'
          )
          AND e.enabled IS json_extract(
              NEW.original_rest_snapshot_json, '$.enabled'
          )
          AND e.updated_at IS json_extract(
              NEW.original_rest_snapshot_json, '$.updated_at'
          )
          AND e.start_time IS json_extract(
              NEW.original_rest_snapshot_json, '$.start_time'
          )
          AND e.end_time IS json_extract(
              NEW.original_rest_snapshot_json, '$.end_time'
          )
          AND e.shift_template_id IS json_extract(
              NEW.original_rest_snapshot_json, '$.shift_template_id'
          )
          AND e.id NOT IN (
              NEW.work_exception_id,
              NEW.rest_exception_id
          )
    );
END;

CREATE TRIGGER trg_rest_rescheduling_leave_insert
BEFORE INSERT ON employee_weekly_rest_rescheduling
WHEN EXISTS (
    SELECT 1
    FROM employee_leaves l
    WHERE l.salon_id = NEW.salon_id
      AND l.employee_id = NEW.employee_id
      AND l.status IN ('pending', 'approved')
      AND (
          NEW.original_rest_date BETWEEN l.start_date AND l.end_date
          OR NEW.replacement_rest_date BETWEEN l.start_date AND l.end_date
      )
)
BEGIN
    SELECT RAISE(
        ABORT,
        'weekly_rest_rescheduling_leave_conflict'
    );
END;

-- Linked schedule exceptions cannot be independently modified
-- while their rescheduling operation remains active.

CREATE TRIGGER trg_rest_rescheduling_exception_delete
BEFORE DELETE ON hr_schedule_exceptions
WHEN EXISTS (
    SELECT 1
    FROM employee_weekly_rest_rescheduling r
    WHERE r.salon_id = OLD.salon_id
      AND r.status = 'active'
      AND (
          OLD.id IN (
              r.work_exception_id,
              r.rest_exception_id
          )
          OR OLD.id = r.original_rest_exception_id
      )
)
BEGIN
    SELECT RAISE(
        ABORT,
        'weekly_rest_rescheduling_exception_protected'
    );
END;

CREATE TRIGGER trg_rest_rescheduling_exception_update
BEFORE UPDATE ON hr_schedule_exceptions
WHEN EXISTS (
    SELECT 1
    FROM employee_weekly_rest_rescheduling r
    WHERE r.salon_id = OLD.salon_id
      AND r.status = 'active'
      AND (
          OLD.id IN (
              r.work_exception_id,
              r.rest_exception_id
          )
          OR OLD.id = r.original_rest_exception_id
      )
)
BEGIN
    SELECT RAISE(
        ABORT,
        'weekly_rest_rescheduling_exception_protected'
    );
END;

-- Prevent later exceptions from overriding either protected date.

CREATE TRIGGER trg_rest_rescheduling_competing_exception_insert
BEFORE INSERT ON hr_schedule_exceptions
WHEN NEW.status IN ('approved', 'active')
AND EXISTS (
    SELECT 1
    FROM employee_weekly_rest_rescheduling r
    WHERE r.salon_id = NEW.salon_id
      AND r.employee_id = NEW.employee_id
      AND r.status = 'active'
      AND NEW.id NOT IN (
          r.work_exception_id,
          r.rest_exception_id
      )
      AND (
          r.original_rest_date BETWEEN NEW.date_from AND NEW.date_to
          OR r.replacement_rest_date BETWEEN NEW.date_from AND NEW.date_to
      )
)
BEGIN
    SELECT RAISE(
        ABORT,
        'weekly_rest_rescheduling_exception_protected'
    );
END;

CREATE TRIGGER trg_rest_rescheduling_competing_exception_update
BEFORE UPDATE ON hr_schedule_exceptions
WHEN NEW.status IN ('approved', 'active')
AND EXISTS (
    SELECT 1
    FROM employee_weekly_rest_rescheduling r
    WHERE r.salon_id = NEW.salon_id
      AND r.employee_id = NEW.employee_id
      AND r.status = 'active'
      AND NEW.id NOT IN (
          r.work_exception_id,
          r.rest_exception_id
      )
      AND (
          r.original_rest_date BETWEEN NEW.date_from AND NEW.date_to
          OR r.replacement_rest_date BETWEEN NEW.date_from AND NEW.date_to
      )
)
BEGIN
    SELECT RAISE(
        ABORT,
        'weekly_rest_rescheduling_exception_protected'
    );
END;

-- Reject Core attendance introduced after the application-level check
-- but before the rescheduling transaction commits.

CREATE TRIGGER trg_rest_rescheduling_attendance_insert
BEFORE INSERT ON employee_weekly_rest_rescheduling
WHEN EXISTS (
    SELECT 1
    FROM attendance_records a
    WHERE a.salon_id = NEW.salon_id
      AND a.employee_id = NEW.employee_id
      AND a.date_key = NEW.replacement_rest_date
      AND a.record_type IN ('check_in', 'check_out')
)
BEGIN
    SELECT RAISE(
        ABORT,
        'weekly_rest_rescheduling_replacement_attendance'
    );
END;

-- Preserve existing weekly-rest compliance evidence.

CREATE TRIGGER trg_rest_rescheduling_event_insert
BEFORE INSERT ON employee_weekly_rest_rescheduling
WHEN EXISTS (
    SELECT 1
    FROM employee_weekly_rest_events e
    WHERE e.salon_id = NEW.salon_id
      AND e.employee_id = NEW.employee_id
      AND e.rest_date IN (
          NEW.original_rest_date,
          NEW.replacement_rest_date
      )
)
BEGIN
    SELECT RAISE(
        ABORT,
        'weekly_rest_rescheduling_event_conflict'
    );
END;

-- Persist one financial reconciliation operation for each affected date.
-- These operations commit or roll back with the rescheduling transaction.

CREATE TRIGGER trg_rest_rescheduling_payroll_outbox_insert
AFTER INSERT ON employee_weekly_rest_rescheduling
WHEN NEW.status = 'active'
BEGIN
    INSERT INTO hr_payroll_operations (
        id,
        origin,
        salon_id,
        employee_uid,
        employee_id,
        work_date,
        request_hash,
        actor_json,
        required_permissions,
        reason,
        before_records,
        after_records,
        response_json,
        next_attempt_at,
        created_at,
        updated_at,
        snapshot_matches
    )
    SELECT
        'rest-swap:' ||
            json_array(NEW.salon_id, NEW.id, affected.work_date, 'create'),
        'core',
        NEW.salon_id,
        COALESCE(
            NULLIF(
                (
                    SELECT p.firebase_uid
                    FROM employee_profiles p
                    WHERE p.salon_id = NEW.salon_id
                      AND p.id = NEW.employee_id
                    LIMIT 1
                ),
                ''
            ),
            NEW.employee_id
        ),
        NEW.employee_id,
        affected.work_date,
        json_array(NEW.id, affected.work_date, 'create'),
        json_object('uid', NEW.created_by_uid),
        '[]',
        NEW.reason,
        affected.before_snapshot,
        json_object(
            'operationId', NEW.id,
            'employeeId', NEW.employee_id,
            'date', affected.work_date,
            'classification', affected.classification,
            'exceptionId', affected.exception_id,
            'status', NEW.status
        ),
        json_object(
            'sourceType', 'weekly_rest_rescheduling',
            'sourceId', NEW.id,
            'date', affected.work_date,
            'endDate', affected.work_date,
            'action', 'create',
            'classification', affected.classification
        ),
        '1970-01-01T00:00:00.000Z',
        NEW.created_at,
        NEW.created_at,
        1
    FROM (
        SELECT
            NEW.original_rest_date AS work_date,
            NEW.original_rest_snapshot_json AS before_snapshot,
            'work' AS classification,
            NEW.work_exception_id AS exception_id

        UNION ALL

        SELECT
            NEW.replacement_rest_date,
            NEW.replacement_work_snapshot_json,
            'weekly_rest',
            NEW.rest_exception_id
    ) affected;
END;

-- Pending rest-swap reconciliation cannot silently enter locked payroll.

CREATE TRIGGER trg_rest_swap_pending_payroll_approval
BEFORE UPDATE OF status ON payroll_entries
WHEN NEW.status IN ('approved', 'paid')
AND OLD.status NOT IN ('approved', 'paid')
AND EXISTS (
    SELECT 1
    FROM hr_payroll_operations op
    WHERE op.salon_id = NEW.salon_id
      AND op.employee_id = NEW.employee_id
      AND op.status IN ('pending', 'needs_attention')
      AND json_extract(
          op.response_json,
          '$.sourceType'
      ) = 'weekly_rest_rescheduling'
      AND substr(op.work_date, 1, 7) = NEW.payroll_month
)
BEGIN
    SELECT RAISE(
        ABORT,
        'weekly_rest_rescheduling_payroll_pending'
    );
END;

CREATE TRIGGER trg_rest_swap_pending_payroll_insert
BEFORE INSERT ON payroll_entries
WHEN NEW.status IN ('approved', 'paid')
AND EXISTS (
    SELECT 1
    FROM hr_payroll_operations op
    WHERE op.salon_id = NEW.salon_id
      AND op.employee_id = NEW.employee_id
      AND op.status IN ('pending', 'needs_attention')
      AND json_extract(
          op.response_json,
          '$.sourceType'
      ) = 'weekly_rest_rescheduling'
      AND substr(op.work_date, 1, 7) = NEW.payroll_month
)
BEGIN
    SELECT RAISE(
        ABORT,
        'weekly_rest_rescheduling_payroll_pending'
    );
END;

-- A rest swap cannot be cancelled while either affected
-- date belongs to a locked payroll period.

CREATE TRIGGER trg_rest_rescheduling_cancel_payroll_guard
BEFORE UPDATE OF status
ON employee_weekly_rest_rescheduling
WHEN OLD.status = 'active'
 AND NEW.status = 'cancelled'
BEGIN
    SELECT RAISE(
        ABORT,
        'weekly_rest_rescheduling_payroll_locked'
    )
    WHERE EXISTS (
        SELECT 1
        FROM employee_attendance_policy_locked_ranges l
        WHERE l.salon_id = OLD.salon_id
          AND (
              l.employee_id IS NULL
              OR l.employee_id = OLD.employee_id
          )
          AND (
              OLD.original_rest_date
                  BETWEEN l.date_from AND l.date_to
              OR OLD.replacement_rest_date
                  BETWEEN l.date_from AND l.date_to
          )
    )
    OR EXISTS (
        SELECT 1
        FROM payroll_periods p
        WHERE p.salon_id = OLD.salon_id
          AND p.status IN (
              'closed',
              'approved',
              'paid',
              'locked'
          )
          AND (
              OLD.original_rest_date
                  BETWEEN p.month_start AND p.month_end
              OR OLD.replacement_rest_date
                  BETWEEN p.month_start AND p.month_end
          )
    );

    SELECT RAISE(
        ABORT,
        'weekly_rest_rescheduling_finance_pending'
    )
    WHERE EXISTS (
        SELECT 1
        FROM hr_payroll_operations op
        WHERE op.salon_id = OLD.salon_id
          AND op.employee_id = OLD.employee_id
          AND op.status IN ('pending', 'needs_attention')
          AND json_extract(
              op.response_json,
              '$.sourceType'
          ) = 'weekly_rest_rescheduling'
          AND json_extract(
              op.response_json,
              '$.sourceId'
          ) = OLD.id
    );
END;

-- Cancellation creates new financial work rather than
-- rewriting the original completed reconciliation.

CREATE TRIGGER trg_rest_rescheduling_cancel_payroll_outbox
AFTER UPDATE OF status
ON employee_weekly_rest_rescheduling
WHEN OLD.status = 'active'
 AND NEW.status = 'cancelled'
BEGIN
    INSERT INTO hr_payroll_operations (
        id,
        origin,
        salon_id,
        employee_uid,
        employee_id,
        work_date,
        request_hash,
        actor_json,
        required_permissions,
        reason,
        before_records,
        after_records,
        response_json,
        next_attempt_at,
        created_at,
        updated_at,
        snapshot_matches
    )
    SELECT
        'rest-swap:' ||
            json_array(
                NEW.salon_id,
                NEW.id,
                affected.work_date,
                'cancel'
            ),
        'core',
        NEW.salon_id,
        COALESCE(
            NULLIF(
                (
                    SELECT p.firebase_uid
                    FROM employee_profiles p
                    WHERE p.salon_id = NEW.salon_id
                      AND p.id = NEW.employee_id
                    LIMIT 1
                ),
                ''
            ),
            NEW.employee_id
        ),
        NEW.employee_id,
        affected.work_date,
        json_array(
            NEW.id,
            affected.work_date,
            'cancel'
        ),
        json_object(
            'uid',
            NEW.cancelled_by_uid
        ),
        '[]',
        NEW.cancellation_reason,
        json_object(
            'operationId', OLD.id,
            'exceptionId', affected.exception_id,
            'status', OLD.status,
            'classification', affected.before_classification
        ),
        affected.after_snapshot,
        json_object(
            'sourceType', 'weekly_rest_rescheduling',
            'sourceId', NEW.id,
            'date', affected.work_date,
            'endDate', affected.work_date,
            'action', 'cancel',
            'classification', affected.after_classification
        ),
        '1970-01-01T00:00:00.000Z',
        NEW.cancelled_at,
        NEW.cancelled_at,
        1
    FROM (
        SELECT
            NEW.original_rest_date AS work_date,
            NEW.work_exception_id AS exception_id,
            'work' AS before_classification,
            'weekly_rest' AS after_classification,
            NEW.original_rest_snapshot_json AS after_snapshot

        UNION ALL

        SELECT
            NEW.replacement_rest_date,
            NEW.rest_exception_id,
            'weekly_rest',
            'work',
            NEW.replacement_work_snapshot_json
    ) affected;
END;

-- Restore both dates in the same database statement that cancels
-- the rescheduling operation. Never delete historical exceptions.

CREATE TRIGGER trg_rest_rescheduling_restore_exceptions
AFTER UPDATE OF status ON employee_weekly_rest_rescheduling
WHEN OLD.status = 'active'
 AND NEW.status = 'cancelled'
BEGIN
    SELECT RAISE(
        ABORT,
        'weekly_rest_rescheduling_invalid_exception_evidence'
    )
    WHERE (
        SELECT COUNT(*)
        FROM hr_schedule_exceptions e
        WHERE e.salon_id = OLD.salon_id
          AND e.employee_id = OLD.employee_id
          AND e.status IN ('approved', 'active')
          AND (
              (
                  e.id = OLD.work_exception_id
                  AND e.date_from = OLD.original_rest_date
                  AND e.date_to = OLD.original_rest_date
                  AND e.exception_type = 'custom'
                  AND e.start_time = OLD.work_start_time
                  AND e.end_time = OLD.work_end_time
              )
              OR (
                  e.id = OLD.rest_exception_id
                  AND e.date_from = OLD.replacement_rest_date
                  AND e.date_to = OLD.replacement_rest_date
                  AND e.exception_type = 'off'
              )
          )
    ) <> 2;

    SELECT RAISE(
        ABORT,
        'weekly_rest_rescheduling_event_conflict'
    )
    WHERE EXISTS (
        SELECT 1
        FROM employee_weekly_rest_events e
        WHERE e.salon_id = OLD.salon_id
          AND e.employee_id = OLD.employee_id
          AND e.rest_date IN (
              OLD.original_rest_date,
              OLD.replacement_rest_date
          )
    );

    INSERT INTO hr_shift_audit_log (
        id,
        salon_id,
        actor_uid,
        action,
        entity_type,
        entity_id,
        before_json,
        after_json,
        reason,
        created_at
    )
    SELECT
        'rest-swap-cancel:' || json_array(
            NEW.salon_id,
            NEW.id,
            e.id
        ),
        NEW.salon_id,
        NEW.cancelled_by_uid,
        'update',
        'schedule_exception',
        e.id,
        json_object(
            'id', e.id,
            'employee_id', e.employee_id,
            'status', e.status,
            'enabled', e.enabled,
            'date_from', e.date_from,
            'date_to', e.date_to,
            'exception_type', e.exception_type,
            'start_time', e.start_time,
            'end_time', e.end_time,
            'note', e.note
        ),
        json_object(
            'id', e.id,
            'employee_id', e.employee_id,
            'status', 'cancelled',
            'enabled', 0,
            'date_from', e.date_from,
            'date_to', e.date_to,
            'exception_type', e.exception_type,
            'start_time', e.start_time,
            'end_time', e.end_time,
            'note', e.note
        ),
        NEW.cancellation_reason,
        NEW.cancelled_at
    FROM hr_schedule_exceptions e
    WHERE e.salon_id = OLD.salon_id
      AND e.employee_id = OLD.employee_id
      AND e.id IN (
          OLD.work_exception_id,
          OLD.rest_exception_id
      );

    UPDATE hr_schedule_exceptions
       SET status = 'cancelled',
           enabled = 0,
           updated_at = NEW.cancelled_at
     WHERE salon_id = OLD.salon_id
       AND employee_id = OLD.employee_id
       AND id IN (
           OLD.work_exception_id,
           OLD.rest_exception_id
       );

    SELECT RAISE(
        ABORT,
        'weekly_rest_rescheduling_restore_incomplete'
    )
    WHERE (
        SELECT COUNT(*)
        FROM hr_schedule_exceptions e
        WHERE e.salon_id = OLD.salon_id
          AND e.employee_id = OLD.employee_id
          AND e.status = 'cancelled'
          AND e.enabled = 0
          AND e.id IN (
              OLD.work_exception_id,
              OLD.rest_exception_id
          )
    ) <> 2;
END;

-- Retired exceptions remain immutable evidence.

CREATE TRIGGER trg_rest_rescheduling_cancelled_exception_update
BEFORE UPDATE ON hr_schedule_exceptions
WHEN OLD.status = 'cancelled'
AND EXISTS (
    SELECT 1
    FROM employee_weekly_rest_rescheduling r
    WHERE r.salon_id = OLD.salon_id
      AND r.status = 'cancelled'
      AND OLD.id IN (
          r.work_exception_id,
          r.rest_exception_id
      )
)
BEGIN
    SELECT RAISE(
        ABORT,
        'weekly_rest_rescheduling_exception_history_immutable'
    );
END;

CREATE TRIGGER trg_rest_rescheduling_cancelled_exception_delete
BEFORE DELETE ON hr_schedule_exceptions
WHEN EXISTS (
    SELECT 1
    FROM employee_weekly_rest_rescheduling r
    WHERE r.salon_id = OLD.salon_id
      AND r.status = 'cancelled'
      AND OLD.id IN (
          r.work_exception_id,
          r.rest_exception_id
      )
)
BEGIN
    SELECT RAISE(
        ABORT,
        'weekly_rest_rescheduling_exception_history_immutable'
    );
END;

-- Do not start another rest swap on either affected date
-- until previous restoration finance has completed.

CREATE TRIGGER trg_rest_rescheduling_pending_restoration_insert
BEFORE INSERT ON employee_weekly_rest_rescheduling
WHEN EXISTS (
    SELECT 1
    FROM hr_payroll_operations op
    WHERE op.salon_id = NEW.salon_id
      AND op.employee_id = NEW.employee_id
      AND op.status <> 'completed'
      AND json_extract(
          op.response_json,
          '$.sourceType'
      ) = 'weekly_rest_rescheduling'
      AND json_extract(
          op.response_json,
          '$.action'
      ) = 'cancel'
      AND op.work_date IN (
          NEW.original_rest_date,
          NEW.replacement_rest_date
      )
)
BEGIN
    SELECT RAISE(
        ABORT,
        'weekly_rest_rescheduling_finance_pending'
    );
END;

-- Cancellation metadata cannot be introduced before cancellation.

CREATE TRIGGER trg_rest_rescheduling_active_metadata_insert
BEFORE INSERT ON employee_weekly_rest_rescheduling
WHEN NEW.status = 'active'
 AND (
     NEW.cancelled_by_uid IS NOT NULL
     OR NEW.cancelled_at IS NOT NULL
     OR NEW.cancellation_reason IS NOT NULL
 )
BEGIN
    SELECT RAISE(
        ABORT,
        'weekly_rest_rescheduling_invalid_cancellation_evidence'
    );
END;

CREATE TRIGGER trg_rest_rescheduling_active_metadata_update
BEFORE UPDATE ON employee_weekly_rest_rescheduling
WHEN OLD.status = 'active'
 AND NEW.status = 'active'
 AND (
     NEW.cancelled_by_uid IS NOT NULL
     OR NEW.cancelled_at IS NOT NULL
     OR NEW.cancellation_reason IS NOT NULL
 )
BEGIN
    SELECT RAISE(
        ABORT,
        'weekly_rest_rescheduling_invalid_cancellation_evidence'
    );
END;
