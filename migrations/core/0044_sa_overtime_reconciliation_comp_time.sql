-- Canonical overtime attendance reconciliation and entitlement balance state.
-- This migration does not create payroll money. It stores verified attendance
-- evidence and a concurrency-safe projection for non-cash time entitlements.

ALTER TABLE employee_overtime_records
  ADD COLUMN attendance_evidence_json TEXT NOT NULL DEFAULT '{}';

ALTER TABLE employee_overtime_records
  ADD COLUMN reconciliation_note TEXT;

ALTER TABLE employee_overtime_records
  ADD COLUMN reconciled_by_uid TEXT;

ALTER TABLE employee_overtime_records
  ADD COLUMN comp_time_ledger_entry_id TEXT;

CREATE TABLE employee_comp_time_balances (
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  entitlement_type TEXT NOT NULL CHECK (
    entitlement_type IN (
      'overtime_comp',
      'weekly_rest_due',
      'public_holiday_overlap_due'
    )
  ),
  balance_minutes INTEGER NOT NULL DEFAULT 0 CHECK (balance_minutes >= 0),
  last_entry_id TEXT,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (salon_id, employee_id, entitlement_type)
);

CREATE INDEX idx_employee_comp_time_balances_employee
  ON employee_comp_time_balances(
    salon_id,
    employee_id,
    entitlement_type
  );

ALTER TABLE employee_weekly_rest_events
  ADD COLUMN entitlement_ledger_entry_id TEXT;

ALTER TABLE employee_weekly_rest_events
  ADD COLUMN restoration_confirmed_at TEXT;

ALTER TABLE employee_weekly_rest_events
  ADD COLUMN restoration_confirmed_by_uid TEXT;

CREATE UNIQUE INDEX idx_employee_weekly_rest_entitlement_ledger
  ON employee_weekly_rest_events(
    salon_id,
    entitlement_ledger_entry_id
  )
  WHERE entitlement_ledger_entry_id IS NOT NULL;
