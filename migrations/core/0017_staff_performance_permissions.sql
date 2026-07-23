-- Add staff performance permissions for the dashboard analytics page.

INSERT OR IGNORE INTO permissions
  (permission_key, group_key, label, description, sensitive, created_at, updated_at)
VALUES
  ('staffPerformance.view', 'workforce', 'View staff performance', 'View staff performance analytics.', 1, '2026-07-23T00:00:00.000Z', '2026-07-23T00:00:00.000Z'),
  ('staffPerformance.manage', 'workforce', 'Manage staff performance', 'Manage staff performance analytics settings.', 1, '2026-07-23T00:00:00.000Z', '2026-07-23T00:00:00.000Z');

INSERT OR IGNORE INTO role_permissions (salon_id, role_key, permission_key, created_at)
VALUES
  ('main', 'owner', 'staffPerformance.view', '2026-07-23T00:00:00.000Z'),
  ('main', 'owner', 'staffPerformance.manage', '2026-07-23T00:00:00.000Z'),
  ('main', 'admin', 'staffPerformance.view', '2026-07-23T00:00:00.000Z'),
  ('main', 'admin', 'staffPerformance.manage', '2026-07-23T00:00:00.000Z'),
  ('main', 'hr', 'staffPerformance.view', '2026-07-23T00:00:00.000Z'),
  ('main', 'hr', 'staffPerformance.manage', '2026-07-23T00:00:00.000Z');
