-- Auditable legal classification for payroll deductions.
-- Classification is mutable only while affected payroll remains unlocked.

ALTER TABLE employee_recurring_deductions
  ADD COLUMN compliance_classification_reason TEXT;
ALTER TABLE employee_recurring_deductions
  ADD COLUMN compliance_classified_by_uid TEXT;
ALTER TABLE employee_recurring_deductions
  ADD COLUMN compliance_classified_by_email TEXT;
ALTER TABLE employee_recurring_deductions
  ADD COLUMN compliance_classified_at TEXT;

ALTER TABLE employee_payroll_obligations
  ADD COLUMN compliance_classification_reason TEXT;
ALTER TABLE employee_payroll_obligations
  ADD COLUMN compliance_classified_by_uid TEXT;
ALTER TABLE employee_payroll_obligations
  ADD COLUMN compliance_classified_by_email TEXT;
ALTER TABLE employee_payroll_obligations
  ADD COLUMN compliance_classified_at TEXT;

CREATE TABLE employee_payroll_deduction_classification_events (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('recurring_deduction','payroll_obligation')),
  entity_id TEXT NOT NULL,
  previous_class TEXT,
  next_class TEXT NOT NULL,
  written_consent_reference TEXT,
  court_order_reference TEXT,
  judicial_monthly_cap_bps INTEGER,
  evidence_reference TEXT,
  reason TEXT NOT NULL,
  actor_uid TEXT,
  actor_email TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_payroll_deduction_classification_events_entity
  ON employee_payroll_deduction_classification_events(
    salon_id, entity_type, entity_id, created_at DESC
  );
