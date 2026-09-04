-- Enforce exactly one historical weekly-rest opening credit per employee.
-- Source-reference idempotency remains handled by the canonical comp-time ledger.

CREATE UNIQUE INDEX IF NOT EXISTS
  idx_employee_comp_time_historical_weekly_rest_opening_once
ON employee_comp_time_ledger (
  salon_id,
  employee_id,
  entitlement_type,
  source_type,
  entry_kind
)
WHERE entitlement_type = 'weekly_rest_due'
  AND source_type = 'historical_opening_balance'
  AND entry_kind = 'credit';
