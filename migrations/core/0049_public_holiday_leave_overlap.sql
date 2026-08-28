-- Public-holiday overlap evidence for annual leave and weekly-rest replacement.
-- Annual entitlement days are never consumed by verified public holidays that
-- fall inside the annual-leave period; the operational leave end is extended.

ALTER TABLE employee_leaves
  ADD COLUMN annual_original_end_date TEXT;

ALTER TABLE employee_leaves
  ADD COLUMN public_holiday_overlap_days INTEGER NOT NULL DEFAULT 0
  CHECK (public_holiday_overlap_days >= 0);

ALTER TABLE employee_leaves
  ADD COLUMN public_holiday_overlap_json TEXT NOT NULL DEFAULT '[]';

CREATE INDEX idx_employee_leave_public_holiday_overlap
  ON employee_leaves(
    salon_id,
    employee_id,
    leave_type,
    public_holiday_overlap_days,
    start_date,
    end_date
  );

-- The entitlement ledger already supports public_holiday_overlap_due. Guard its
-- source at the balance layer so one employee/date can create at most one credit,
-- even when multiple official holiday codes overlap the same calendar date.
CREATE UNIQUE INDEX idx_public_holiday_weekly_rest_overlap_credit
  ON employee_comp_time_ledger(
    salon_id,
    employee_id,
    entitlement_type,
    source_type,
    source_id,
    entry_kind
  )
  WHERE entitlement_type = 'public_holiday_overlap_due'
    AND source_type = 'public_holiday_weekly_rest_overlap'
    AND entry_kind = 'credit';
