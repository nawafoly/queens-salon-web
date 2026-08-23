-- Canonical social-insurance configuration + immutable payroll GOSI snapshot fields.
-- Additive only. Does NOT rewrite Approved/Paid payroll history.
-- Existing insurance_deduction_halalas remains the employee-side deduction for compatibility.

ALTER TABLE employee_employment
  ADD COLUMN social_insurance_category TEXT
  CHECK(social_insurance_category IS NULL OR social_insurance_category IN ('saudi_existing', 'saudi_new', 'gcc', 'non_saudi'));

ALTER TABLE employee_employment
  ADD COLUMN social_insurance_effective_from TEXT;

ALTER TABLE employee_employment
  ADD COLUMN social_insurance_classification_note TEXT;

ALTER TABLE employee_employment
  ADD COLUMN gosi_wage_mode TEXT NOT NULL DEFAULT 'derived'
  CHECK(gosi_wage_mode IN ('derived', 'override'));

ALTER TABLE employee_employment
  ADD COLUMN gosi_contributory_wage_override_halalas INTEGER;

ALTER TABLE employee_employment
  ADD COLUMN gosi_contributory_wage_override_reason TEXT;

ALTER TABLE employee_employment
  ADD COLUMN gcc_home_country_code TEXT;

ALTER TABLE employee_employment
  ADD COLUMN social_insurance_updated_by_uid TEXT;

ALTER TABLE employee_employment
  ADD COLUMN social_insurance_updated_by_email TEXT;

ALTER TABLE employee_employment
  ADD COLUMN social_insurance_updated_at TEXT;

ALTER TABLE payroll_entries
  ADD COLUMN gosi_insurance_category TEXT;

ALTER TABLE payroll_entries
  ADD COLUMN gosi_policy_version TEXT;

ALTER TABLE payroll_entries
  ADD COLUMN gosi_contributory_wage_halalas INTEGER NOT NULL DEFAULT 0;

ALTER TABLE payroll_entries
  ADD COLUMN employer_gosi_contribution_halalas INTEGER NOT NULL DEFAULT 0;

ALTER TABLE payroll_entries
  ADD COLUMN gosi_snapshot_json TEXT;

ALTER TABLE payroll_entries
  ADD COLUMN gosi_calculated_at TEXT;

ALTER TABLE payroll_approval_snapshots
  ADD COLUMN gosi_snapshot_json TEXT;

ALTER TABLE payroll_approval_snapshots
  ADD COLUMN employer_gosi_contribution_halalas INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_employee_employment_social_insurance
  ON employee_employment(salon_id, social_insurance_category);
