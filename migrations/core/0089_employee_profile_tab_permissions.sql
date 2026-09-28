-- Staff Management profile-tab visibility permissions.
-- Existing privileged roles keep full visibility. Reception is intentionally
-- least-privilege by default: Services only. Per-account overrides remain
-- editable through user_permissions in Account Management.

INSERT OR IGNORE INTO permissions
  (permission_key, group_key, label, description, sensitive, created_at, updated_at)
VALUES
  ('employees.tabs.basic.view', 'workforce', 'View staff basic-information tab', 'Show Basic information inside Staff Management employee profiles.', 0, '2026-09-28T00:00:00.000Z', '2026-09-28T00:00:00.000Z'),
  ('employees.tabs.profile.view', 'workforce', 'View staff files-and-photos tab', 'Show Files & photos inside Staff Management employee profiles.', 0, '2026-09-28T00:00:00.000Z', '2026-09-28T00:00:00.000Z'),
  ('employees.tabs.services.view', 'workforce', 'View staff services tab', 'Show Services inside Staff Management employee profiles.', 0, '2026-09-28T00:00:00.000Z', '2026-09-28T00:00:00.000Z'),
  ('employees.tabs.schedule.view', 'workforce', 'View staff schedule-and-shifts tab', 'Show Schedule & shifts inside Staff Management employee profiles.', 0, '2026-09-28T00:00:00.000Z', '2026-09-28T00:00:00.000Z'),
  ('employees.tabs.attendance.view', 'workforce', 'View staff attendance tab', 'Show Attendance inside Staff Management employee profiles.', 1, '2026-09-28T00:00:00.000Z', '2026-09-28T00:00:00.000Z'),
  ('employees.tabs.payroll.view', 'workforce', 'View staff payroll tab', 'Show Payroll record inside Staff Management employee profiles.', 1, '2026-09-28T00:00:00.000Z', '2026-09-28T00:00:00.000Z'),
  ('employees.tabs.requests.view', 'workforce', 'View staff requests tab', 'Show Requests inside Staff Management employee profiles.', 1, '2026-09-28T00:00:00.000Z', '2026-09-28T00:00:00.000Z'),
  ('employees.tabs.leave.view', 'workforce', 'View staff leave-balance tab', 'Show Leave balance inside Staff Management employee profiles.', 1, '2026-09-28T00:00:00.000Z', '2026-09-28T00:00:00.000Z'),
  ('employees.tabs.messages.view', 'workforce', 'View staff messages tab', 'Show Messages inside Staff Management employee profiles.', 1, '2026-09-28T00:00:00.000Z', '2026-09-28T00:00:00.000Z');

-- Owner/admin/HR preserve the full Staff Management profile surface.
INSERT OR IGNORE INTO role_permissions (salon_id, role_key, permission_key, created_at)
SELECT 'main', role_key, permission_key, '2026-09-28T00:00:00.000Z'
FROM (
  SELECT 'owner' AS role_key
  UNION ALL SELECT 'admin'
  UNION ALL SELECT 'hr'
) roles
CROSS JOIN (
  SELECT 'employees.tabs.basic.view' AS permission_key
  UNION ALL SELECT 'employees.tabs.profile.view'
  UNION ALL SELECT 'employees.tabs.services.view'
  UNION ALL SELECT 'employees.tabs.schedule.view'
  UNION ALL SELECT 'employees.tabs.attendance.view'
  UNION ALL SELECT 'employees.tabs.payroll.view'
  UNION ALL SELECT 'employees.tabs.requests.view'
  UNION ALL SELECT 'employees.tabs.leave.view'
  UNION ALL SELECT 'employees.tabs.messages.view'
) tabs;

-- Reception gets only Services by default. Additional tabs can be granted per
-- account from Account Management without changing the reception role itself.
INSERT OR IGNORE INTO role_permissions
  (salon_id, role_key, permission_key, created_at)
VALUES
  ('main', 'reception', 'employees.tabs.services.view', '2026-09-28T00:00:00.000Z');
