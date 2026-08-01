-- Employee target plans, ledger and payroll bonus snapshots.
-- Monetary columns store halalas (integer minor units) following Core D1.

CREATE TABLE IF NOT EXISTS employee_target_plans (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  effective_start TEXT NOT NULL,
  effective_end TEXT,
  period_type TEXT NOT NULL DEFAULT 'payroll_cycle',
  branch_id TEXT,
  applies_to_all_branches INTEGER NOT NULL DEFAULT 1,
  cumulative_tiers INTEGER NOT NULL DEFAULT 0,
  bonus_type TEXT NOT NULL DEFAULT 'fixed'
    CHECK (bonus_type IN ('fixed', 'percentage')),
  included_service_ids_json TEXT NOT NULL DEFAULT '[]',
  included_category_ids_json TEXT NOT NULL DEFAULT '[]',
  excluded_service_ids_json TEXT NOT NULL DEFAULT '[]',
  excluded_category_ids_json TEXT NOT NULL DEFAULT '[]',
  created_by_uid TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_employee_target_plans_active
  ON employee_target_plans(salon_id, status, effective_start, effective_end);

CREATE TABLE IF NOT EXISTS employee_target_tiers (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  tier_name TEXT NOT NULL,
  tier_order INTEGER NOT NULL,
  target_amount INTEGER NOT NULL CHECK (target_amount >= 0),
  bonus_amount INTEGER NOT NULL DEFAULT 0 CHECK (bonus_amount >= 0),
  bonus_percent_bps INTEGER NOT NULL DEFAULT 0 CHECK (bonus_percent_bps >= 0),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (plan_id) REFERENCES employee_target_plans(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_target_tiers_amount
  ON employee_target_tiers(salon_id, plan_id, target_amount);
CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_target_tiers_order
  ON employee_target_tiers(salon_id, plan_id, tier_order);

CREATE TABLE IF NOT EXISTS employee_target_assignments (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  scope_type TEXT NOT NULL DEFAULT 'default'
    CHECK (scope_type IN ('default', 'employee', 'branch')),
  employee_id TEXT,
  branch_id TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  effective_start TEXT NOT NULL,
  effective_end TEXT,
  created_by_uid TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (plan_id) REFERENCES employee_target_plans(id)
);

CREATE INDEX IF NOT EXISTS idx_employee_target_assignments_employee
  ON employee_target_assignments(salon_id, employee_id, status, effective_start, effective_end);
CREATE INDEX IF NOT EXISTS idx_employee_target_assignments_default
  ON employee_target_assignments(salon_id, scope_type, status, effective_start, effective_end);

CREATE TABLE IF NOT EXISTS employee_target_ledger (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  booking_id TEXT,
  booking_item_id TEXT,
  service_id TEXT,
  package_session_id TEXT,
  transaction_type TEXT NOT NULL
    CHECK (transaction_type IN ('service_completed', 'service_refund', 'manual_adjustment', 'package_session', 'reversal')),
  gross_amount INTEGER NOT NULL DEFAULT 0,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  refund_amount INTEGER NOT NULL DEFAULT 0,
  eligible_amount INTEGER NOT NULL DEFAULT 0,
  performed_at TEXT NOT NULL,
  payroll_period_id TEXT,
  source_reference TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_by_uid TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_target_ledger_source
  ON employee_target_ledger(salon_id, source_reference);
CREATE INDEX IF NOT EXISTS idx_employee_target_ledger_employee_period
  ON employee_target_ledger(salon_id, employee_id, payroll_period_id, performed_at);
CREATE INDEX IF NOT EXISTS idx_employee_target_ledger_booking
  ON employee_target_ledger(salon_id, booking_id, booking_item_id);

CREATE TABLE IF NOT EXISTS employee_target_period_summaries (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  payroll_period_id TEXT,
  payroll_month TEXT,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  plan_id TEXT,
  plan_snapshot_json TEXT,
  total_eligible_services INTEGER NOT NULL DEFAULT 0,
  total_refunds INTEGER NOT NULL DEFAULT 0,
  net_target_amount INTEGER NOT NULL DEFAULT 0,
  achieved_tier_id TEXT,
  achieved_tier_snapshot_json TEXT,
  earned_bonus_amount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'under_review', 'approved', 'posted_to_payroll', 'closed')),
  approved_at TEXT,
  approved_by_uid TEXT,
  payroll_entry_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (salon_id, employee_id, payroll_period_id)
);

CREATE INDEX IF NOT EXISTS idx_employee_target_period_summaries_period
  ON employee_target_period_summaries(salon_id, payroll_period_id, status);

INSERT OR IGNORE INTO permissions
  (permission_key, group_key, label, description, sensitive, created_at, updated_at)
VALUES
  ('targets.view', 'workforce', 'View employee targets', 'View employee sales target summaries.', 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('targets.manage', 'workforce', 'Manage employee targets', 'Create and update target plans and assignments.', 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('targets.approve', 'workforce', 'Approve employee target bonus', 'Approve target bonus snapshots.', 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('targets.adjust', 'workforce', 'Adjust employee targets', 'Create documented target ledger adjustments.', 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('targets.view_all', 'workforce', 'View all employee targets', 'View targets for all employees.', 1, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z'),
  ('targets.view_own', 'workforce', 'View own target', 'View only the linked employee target.', 0, '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');

INSERT OR IGNORE INTO role_permissions (salon_id, role_key, permission_key, created_at)
SELECT 'main', 'owner', permission_key, '2026-08-01T00:00:00.000Z'
FROM permissions
WHERE permission_key LIKE 'targets.%';

INSERT OR IGNORE INTO role_permissions (salon_id, role_key, permission_key, created_at)
VALUES
  ('main', 'admin', 'targets.view', '2026-08-01T00:00:00.000Z'),
  ('main', 'admin', 'targets.manage', '2026-08-01T00:00:00.000Z'),
  ('main', 'admin', 'targets.approve', '2026-08-01T00:00:00.000Z'),
  ('main', 'admin', 'targets.adjust', '2026-08-01T00:00:00.000Z'),
  ('main', 'admin', 'targets.view_all', '2026-08-01T00:00:00.000Z'),
  ('main', 'hr', 'targets.view', '2026-08-01T00:00:00.000Z'),
  ('main', 'hr', 'targets.manage', '2026-08-01T00:00:00.000Z'),
  ('main', 'hr', 'targets.approve', '2026-08-01T00:00:00.000Z'),
  ('main', 'hr', 'targets.adjust', '2026-08-01T00:00:00.000Z'),
  ('main', 'hr', 'targets.view_all', '2026-08-01T00:00:00.000Z'),
  ('main', 'accountant', 'targets.view', '2026-08-01T00:00:00.000Z'),
  ('main', 'accountant', 'targets.view_all', '2026-08-01T00:00:00.000Z'),
  ('main', 'staff', 'targets.view_own', '2026-08-01T00:00:00.000Z');
