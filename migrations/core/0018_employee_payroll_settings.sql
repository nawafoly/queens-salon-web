-- Employee payroll setup fields used by Core HR payroll generation.

ALTER TABLE employee_employment ADD COLUMN daily_scheduled_hours REAL;
ALTER TABLE employee_employment ADD COLUMN overtime_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE employee_employment ADD COLUMN overtime_multiplier REAL NOT NULL DEFAULT 1.5;
ALTER TABLE employee_employment ADD COLUMN payroll_deduction_method TEXT NOT NULL DEFAULT 'hourly';
