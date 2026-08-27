-- Canonical payroll attendance policy for each employee.
-- required: payroll requires confirmed attendance punches.
-- exempt: schedule remains canonical, but punches are not required for payroll.

ALTER TABLE employee_employment
  ADD COLUMN attendance_payroll_mode TEXT NOT NULL DEFAULT 'required';

ALTER TABLE employee_employment
  ADD COLUMN attendance_payroll_exemption_reason TEXT;
