-- Protect target summaries linked to financially locked payroll.
-- Preserve historical data without rewriting existing summaries.

CREATE TRIGGER employee_target_locked_payroll_update_guard
BEFORE UPDATE ON employee_target_period_summaries
FOR EACH ROW
WHEN EXISTS (
    SELECT 1
      FROM payroll_entries AS pe
     WHERE pe.salon_id = OLD.salon_id
       AND pe.employee_id = OLD.employee_id
       AND pe.status IN ('approved', 'paid')
       AND (
           pe.id = OLD.payroll_entry_id
           OR pe.payroll_month = OLD.payroll_month
       )
)
AND (
    NEW.id IS NOT OLD.id
    OR NEW.salon_id IS NOT OLD.salon_id
    OR NEW.employee_id IS NOT OLD.employee_id
    OR NEW.payroll_period_id IS NOT OLD.payroll_period_id
    OR NEW.payroll_month IS NOT OLD.payroll_month
    OR NEW.period_start IS NOT OLD.period_start
    OR NEW.period_end IS NOT OLD.period_end
    OR NEW.plan_id IS NOT OLD.plan_id
    OR NEW.plan_snapshot_json IS NOT OLD.plan_snapshot_json
    OR NEW.total_eligible_services IS NOT OLD.total_eligible_services
    OR NEW.total_refunds IS NOT OLD.total_refunds
    OR NEW.net_target_amount IS NOT OLD.net_target_amount
    OR NEW.achieved_tier_id IS NOT OLD.achieved_tier_id
    OR NEW.achieved_tier_snapshot_json IS NOT OLD.achieved_tier_snapshot_json
    OR NEW.earned_bonus_amount IS NOT OLD.earned_bonus_amount
    OR NEW.payroll_entry_id IS NOT OLD.payroll_entry_id
    OR NEW.created_at IS NOT OLD.created_at
    OR (
        NEW.status IS NOT OLD.status
        AND NOT (
            OLD.status IN ('open', 'under_review')
            AND NEW.status = 'posted_to_payroll'
            AND OLD.approved_at IS NULL
            AND OLD.approved_by_uid IS NULL
            AND NEW.approved_at IS NOT NULL
            AND NEW.payroll_entry_id IS NOT NULL
            AND EXISTS (
                SELECT 1
                  FROM payroll_approval_transaction_guards AS g
                 WHERE g.salon_id = OLD.salon_id
                   AND g.payroll_entry_id = OLD.payroll_entry_id
                   AND g.transition_matches = 1
            )
        )
    )
    OR (
        (
            NEW.approved_at IS NOT OLD.approved_at
            OR NEW.approved_by_uid IS NOT OLD.approved_by_uid
        )
        AND NOT (
            OLD.status IN ('open', 'under_review')
            AND NEW.status = 'posted_to_payroll'
            AND OLD.approved_at IS NULL
            AND OLD.approved_by_uid IS NULL
            AND NEW.approved_at IS NOT NULL
            AND NEW.payroll_entry_id IS NOT NULL
            AND EXISTS (
                SELECT 1
                  FROM payroll_approval_transaction_guards AS g
                 WHERE g.salon_id = OLD.salon_id
                   AND g.payroll_entry_id = OLD.payroll_entry_id
                   AND g.transition_matches = 1
            )
        )
    )
)
BEGIN
    SELECT RAISE(ABORT, 'employee_target_locked_payroll');
END;

CREATE TRIGGER employee_target_locked_payroll_delete_guard
BEFORE DELETE ON employee_target_period_summaries
FOR EACH ROW
WHEN EXISTS (
    SELECT 1
      FROM payroll_entries AS pe
     WHERE pe.salon_id = OLD.salon_id
       AND pe.employee_id = OLD.employee_id
       AND pe.status IN ('approved', 'paid')
       AND (
           pe.id = OLD.payroll_entry_id
           OR pe.payroll_month = OLD.payroll_month
       )
)
BEGIN
    SELECT RAISE(ABORT, 'employee_target_locked_payroll_delete');
END;

CREATE TRIGGER employee_target_locked_payroll_insert_guard
BEFORE INSERT ON employee_target_period_summaries
FOR EACH ROW
WHEN EXISTS (
    SELECT 1
      FROM payroll_entries AS pe
     WHERE pe.salon_id = NEW.salon_id
       AND pe.employee_id = NEW.employee_id
       AND pe.status IN ('approved', 'paid')
       AND (
           pe.id = NEW.payroll_entry_id
           OR pe.payroll_month = NEW.payroll_month
       )
)
BEGIN
    SELECT RAISE(ABORT, 'employee_target_locked_payroll_insert');
END;
