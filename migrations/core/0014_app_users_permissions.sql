-- Phase 1 identity and permissions cutover.
-- Cloudflare D1 is the only operational source for account status, roles,
-- permissions and account-to-employee links. Firebase remains authentication
-- only: sign-in, ID token verification and password reset delivery.

CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY,
  firebase_uid TEXT UNIQUE,
  salon_id TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  display_name TEXT,
  primary_role TEXT NOT NULL DEFAULT 'pending',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('active', 'disabled', 'pending', 'deleted')),
  email_verified INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  legacy_source TEXT,
  legacy_id TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_salon_email
  ON app_users(salon_id, email)
  WHERE email IS NOT NULL AND TRIM(email) <> '';
CREATE INDEX IF NOT EXISTS idx_app_users_salon_role_status
  ON app_users(salon_id, primary_role, status);
CREATE INDEX IF NOT EXISTS idx_app_users_legacy
  ON app_users(legacy_source, legacy_id);

CREATE TABLE IF NOT EXISTS user_employee_links (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  link_status TEXT NOT NULL DEFAULT 'active'
    CHECK (link_status IN ('active', 'pending', 'unlinked')),
  linked_by_user_id TEXT,
  linked_at TEXT,
  updated_at TEXT NOT NULL,
  unlinked_at TEXT,
  legacy_source TEXT,
  legacy_id TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_employee_links_one_active_user
  ON user_employee_links(salon_id, user_id)
  WHERE link_status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_employee_links_one_active_employee
  ON user_employee_links(salon_id, employee_id)
  WHERE link_status = 'active';
CREATE INDEX IF NOT EXISTS idx_user_employee_links_legacy
  ON user_employee_links(legacy_source, legacy_id);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  role_key TEXT NOT NULL,
  label TEXT NOT NULL,
  rank INTEGER NOT NULL DEFAULT 0,
  protected INTEGER NOT NULL DEFAULT 0,
  assignable INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (salon_id, role_key)
);

CREATE TABLE IF NOT EXISTS permissions (
  permission_key TEXT PRIMARY KEY,
  group_key TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  sensitive INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  salon_id TEXT NOT NULL,
  role_key TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (salon_id, role_key, permission_key)
);

CREATE TABLE IF NOT EXISTS user_permissions (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  effect TEXT NOT NULL CHECK (effect IN ('allow', 'deny')),
  reason TEXT,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (salon_id, user_id, permission_key)
);

CREATE INDEX IF NOT EXISTS idx_user_permissions_user
  ON user_permissions(salon_id, user_id, effect);

ALTER TABLE audit_logs ADD COLUMN actor_user_id TEXT;
ALTER TABLE audit_logs ADD COLUMN target_user_id TEXT;
ALTER TABLE audit_logs ADD COLUMN ip TEXT;
ALTER TABLE audit_logs ADD COLUMN user_agent TEXT;
CREATE INDEX IF NOT EXISTS idx_core_audit_actor_user
  ON audit_logs(salon_id, actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_core_audit_target_user
  ON audit_logs(salon_id, target_user_id, created_at DESC);

INSERT OR IGNORE INTO roles
  (id, salon_id, role_key, label, rank, protected, assignable, created_at, updated_at)
VALUES
  ('role_main_owner', 'main', 'owner', 'Owner', 100, 1, 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('role_main_admin', 'main', 'admin', 'Admin', 80, 0, 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('role_main_hr', 'main', 'hr', 'HR', 60, 0, 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('role_main_accountant', 'main', 'accountant', 'Accountant', 55, 0, 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('role_main_reception', 'main', 'reception', 'Reception', 40, 0, 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('role_main_staff', 'main', 'staff', 'Staff', 30, 0, 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('role_main_pending', 'main', 'pending', 'Pending', 10, 0, 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('role_main_client', 'main', 'client', 'Client', 5, 0, 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('role_main_guest', 'main', 'guest', 'Guest', 0, 0, 0, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z');

INSERT OR IGNORE INTO permissions
  (permission_key, group_key, label, description, sensitive, created_at, updated_at)
VALUES
  ('workspace.dashboard.view', 'workspace', 'Open dashboard', 'Access the main internal dashboard.', 0, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('workspace.employee_portal.view', 'workspace', 'Open employee portal', 'Access the employee self-service portal.', 0, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('bookings.view', 'bookings', 'View bookings', 'View booking records.', 0, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('bookings.create', 'bookings', 'Create bookings', 'Create internal bookings.', 0, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('bookings.update', 'bookings', 'Update bookings', 'Edit booking details.', 0, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('bookings.cancel', 'bookings', 'Cancel bookings', 'Cancel active bookings.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('bookings.delete', 'bookings', 'Delete bookings', 'Delete bookings permanently or logically.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('bookings.payment.manage', 'bookings', 'Manage booking payments', 'Create and adjust booking payments.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('bookings.print', 'bookings', 'Print invoices', 'Print booking invoices.', 0, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('bookings.bulk.manage', 'bookings', 'Manage bulk bookings', 'Run bulk booking operations.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('bookings.day_audit.manage', 'bookings', 'Manage day audit', 'Close and review operating day records.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('bookings.queue_tv.view', 'bookings', 'View queue TV', 'Open queue and TV booking view.', 0, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('clients.view', 'customers', 'View clients', 'View client records.', 0, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('clients.manage', 'customers', 'Manage clients', 'Create and update client records.', 0, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('clients.packages.manage', 'customers', 'Manage client packages', 'Manage package balances and sessions.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('clients.loyalty.manage', 'customers', 'Manage loyalty', 'Adjust loyalty balances and offers.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('income.view', 'finance', 'View income', 'View income records.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('income.manage', 'finance', 'Manage income', 'Create and adjust income records.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('expenses.view', 'finance', 'View expenses', 'View expense records.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('expenses.manage', 'finance', 'Manage expenses', 'Create and adjust expense records.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('employees.view', 'workforce', 'View employees', 'View employee records.', 0, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('employees.create', 'workforce', 'Create employees', 'Create employee records.', 0, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('employees.update', 'workforce', 'Update employees', 'Update employee records.', 0, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('employees.delete', 'workforce', 'Delete employees', 'Disable or delete employee records.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('employees.manage', 'workforce', 'Manage employees legacy key', 'Legacy employee management permission.', 0, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('employees.files.view', 'workforce', 'View employee files', 'View employee documents.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('employees.files.manage', 'workforce', 'Manage employee files', 'Upload and update employee documents.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('employees.schedule.manage', 'workforce', 'Manage employee schedules', 'Manage work schedules.', 0, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('attendance.own.view', 'workforce', 'View own attendance', 'View own attendance state.', 0, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('attendance.view', 'workforce', 'View attendance', 'View team attendance.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('attendance.records.create', 'workforce', 'Create attendance records', 'Create manual attendance records.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('attendance.records.update', 'workforce', 'Update attendance records', 'Update attendance records.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('attendance.records.delete', 'workforce', 'Delete attendance records', 'Delete attendance records.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('attendance.absences.manage', 'workforce', 'Manage absences', 'Manage employee absences.', 0, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('attendance.leaves.manage', 'workforce', 'Manage leaves', 'Approve and reject leave requests.', 0, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('attendance.export', 'workforce', 'Export attendance', 'Export attendance reports.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('attendance.settings.manage', 'workforce', 'Manage attendance settings', 'Manage attendance policies.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('payroll.view', 'workforce', 'View payroll', 'View payroll records.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('payroll.manage', 'workforce', 'Manage payroll', 'Create and update payroll records.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('recruitment.view', 'workforce', 'View recruitment', 'View recruitment requests.', 0, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('recruitment.manage', 'workforce', 'Manage recruitment', 'Manage recruitment requests.', 0, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('reports.view', 'reports', 'View reports', 'View operational reports.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('reports.export', 'reports', 'Export reports', 'Export operational reports.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('weekly_reports.manager_notes', 'reports', 'Manage weekly report notes', 'Write manager notes on weekly reports.', 0, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('messages.view', 'reports', 'View messages', 'View internal messages.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('messages.manage', 'reports', 'Manage messages', 'Send and manage internal messages.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('logs.view', 'reports', 'View logs', 'View audit logs legacy key.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('audit.read', 'reports', 'Read audit logs', 'Read D1 audit logs.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('catalog.manage', 'content', 'Manage catalog', 'Manage service catalog.', 0, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('offers.manage', 'content', 'Manage offers', 'Manage offers and coupons.', 0, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('content.manage', 'content', 'Manage content', 'Manage public content.', 0, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('partners.manage', 'content', 'Manage partners', 'Manage partner resources.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('settings.manage', 'system', 'Manage settings legacy key', 'Legacy settings management permission.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('settings.general.manage', 'system', 'Manage general settings', 'Manage salon settings.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('settings.booking.manage', 'system', 'Manage booking settings', 'Manage booking settings.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('settings.content.manage', 'system', 'Manage content settings', 'Manage public content settings.', 0, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('admin_accounts.view', 'system', 'View admin accounts legacy key', 'Legacy account view permission.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('admin_accounts.manage', 'system', 'Manage admin accounts legacy key', 'Legacy account management permission.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('accounts.read', 'system', 'Read accounts', 'Read app accounts.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('accounts.create', 'system', 'Create accounts', 'Create D1 account records.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('accounts.update', 'system', 'Update accounts', 'Update account identity, role and status.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('accounts.disable', 'system', 'Disable accounts', 'Disable account access.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('accounts.restore', 'system', 'Restore accounts', 'Restore disabled accounts.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('accounts.delete', 'system', 'Delete accounts', 'Soft-delete app accounts.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('accounts.reset_password', 'system', 'Send password reset', 'Send Firebase password reset after D1 authorization.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('roles.read', 'system', 'Read roles', 'Read role catalog.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('roles.assign', 'system', 'Assign roles', 'Assign roles within actor authority.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('roles.manage', 'system', 'Manage roles', 'Manage role permission defaults.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('permissions.read', 'system', 'Read permissions', 'Read permission catalog.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('permissions.manage', 'system', 'Manage permissions', 'Grant and deny account permissions.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('employee_links.read', 'system', 'Read account employee links', 'Read account-to-employee links.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('employee_links.manage', 'system', 'Manage account employee links', 'Create and remove account-to-employee links.', 1, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('BOOKINGS_VIEW', 'legacy', 'Legacy bookings view', 'Legacy permission key.', 0, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('BOOKINGS_UPDATE_STATUS', 'legacy', 'Legacy bookings status update', 'Legacy permission key.', 0, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('BOOKINGS_ADD_NOTES', 'legacy', 'Legacy booking notes', 'Legacy permission key.', 0, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('EMPLOYEES_MANAGE', 'legacy', 'Legacy employees manage', 'Legacy permission key.', 0, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('SERVICES_MANAGE', 'legacy', 'Legacy services manage', 'Legacy permission key.', 0, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('OFFERS_MANAGE', 'legacy', 'Legacy offers manage', 'Legacy permission key.', 0, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('REPORTS_VIEW', 'legacy', 'Legacy reports view', 'Legacy permission key.', 0, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('SETTINGS_MANAGE', 'legacy', 'Legacy settings manage', 'Legacy permission key.', 0, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z'),
  ('USERS_MANAGE', 'legacy', 'Legacy users manage', 'Legacy permission key.', 0, '2026-07-20T00:00:00.000Z', '2026-07-20T00:00:00.000Z');

INSERT OR IGNORE INTO role_permissions (salon_id, role_key, permission_key, created_at)
SELECT 'main', 'owner', permission_key, '2026-07-20T00:00:00.000Z' FROM permissions;

INSERT OR IGNORE INTO role_permissions (salon_id, role_key, permission_key, created_at)
VALUES
  ('main', 'admin', 'workspace.dashboard.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'workspace.employee_portal.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'bookings.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'bookings.create', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'bookings.update', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'bookings.cancel', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'bookings.payment.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'bookings.print', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'bookings.bulk.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'bookings.day_audit.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'bookings.queue_tv.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'clients.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'clients.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'clients.packages.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'clients.loyalty.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'income.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'income.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'expenses.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'expenses.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'employees.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'employees.create', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'employees.update', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'employees.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'employees.files.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'employees.files.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'employees.schedule.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'attendance.own.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'attendance.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'attendance.records.create', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'attendance.records.update', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'attendance.absences.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'attendance.leaves.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'attendance.export', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'attendance.settings.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'payroll.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'payroll.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'recruitment.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'recruitment.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'reports.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'reports.export', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'weekly_reports.manager_notes', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'messages.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'messages.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'catalog.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'offers.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'content.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'partners.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'logs.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'audit.read', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'settings.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'settings.general.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'settings.booking.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'settings.content.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'admin_accounts.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'accounts.read', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'accounts.create', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'accounts.update', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'accounts.disable', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'accounts.restore', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'accounts.reset_password', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'roles.read', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'roles.assign', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'permissions.read', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'employee_links.read', '2026-07-20T00:00:00.000Z'),
  ('main', 'admin', 'employee_links.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'hr', 'workspace.employee_portal.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'hr', 'employees.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'hr', 'employees.create', '2026-07-20T00:00:00.000Z'),
  ('main', 'hr', 'employees.update', '2026-07-20T00:00:00.000Z'),
  ('main', 'hr', 'employees.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'hr', 'employees.files.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'hr', 'employees.files.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'hr', 'employees.schedule.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'hr', 'attendance.own.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'hr', 'attendance.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'hr', 'attendance.records.create', '2026-07-20T00:00:00.000Z'),
  ('main', 'hr', 'attendance.records.update', '2026-07-20T00:00:00.000Z'),
  ('main', 'hr', 'attendance.absences.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'hr', 'attendance.leaves.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'hr', 'attendance.export', '2026-07-20T00:00:00.000Z'),
  ('main', 'hr', 'payroll.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'hr', 'payroll.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'hr', 'recruitment.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'hr', 'recruitment.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'hr', 'reports.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'hr', 'weekly_reports.manager_notes', '2026-07-20T00:00:00.000Z'),
  ('main', 'hr', 'messages.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'hr', 'messages.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'hr', 'admin_accounts.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'hr', 'admin_accounts.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'hr', 'accounts.read', '2026-07-20T00:00:00.000Z'),
  ('main', 'hr', 'accounts.update', '2026-07-20T00:00:00.000Z'),
  ('main', 'hr', 'employee_links.read', '2026-07-20T00:00:00.000Z'),
  ('main', 'hr', 'employee_links.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'hr', 'roles.read', '2026-07-20T00:00:00.000Z'),
  ('main', 'hr', 'permissions.read', '2026-07-20T00:00:00.000Z'),
  ('main', 'accountant', 'workspace.dashboard.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'accountant', 'workspace.employee_portal.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'accountant', 'income.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'accountant', 'income.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'accountant', 'expenses.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'accountant', 'expenses.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'accountant', 'reports.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'accountant', 'reports.export', '2026-07-20T00:00:00.000Z'),
  ('main', 'accountant', 'logs.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'accountant', 'audit.read', '2026-07-20T00:00:00.000Z'),
  ('main', 'reception', 'workspace.dashboard.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'reception', 'workspace.employee_portal.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'reception', 'bookings.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'reception', 'bookings.create', '2026-07-20T00:00:00.000Z'),
  ('main', 'reception', 'bookings.update', '2026-07-20T00:00:00.000Z'),
  ('main', 'reception', 'bookings.cancel', '2026-07-20T00:00:00.000Z'),
  ('main', 'reception', 'bookings.payment.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'reception', 'bookings.print', '2026-07-20T00:00:00.000Z'),
  ('main', 'reception', 'bookings.day_audit.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'reception', 'bookings.queue_tv.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'reception', 'clients.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'reception', 'clients.manage', '2026-07-20T00:00:00.000Z'),
  ('main', 'reception', 'employees.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'reception', 'attendance.own.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'reception', 'attendance.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'reception', 'messages.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'staff', 'workspace.employee_portal.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'staff', 'attendance.own.view', '2026-07-20T00:00:00.000Z'),
  ('main', 'staff', 'messages.view', '2026-07-20T00:00:00.000Z');
