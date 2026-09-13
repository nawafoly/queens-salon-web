-- Inventory permissions: tenant-safe role grants.
-- CORE D1 ONLY. Do not hard-code a single salon_id.
-- permissions catalog stays global; role_permissions are per salon.

-- Owner + admin: full inventory baseline for every salon that has those roles
INSERT OR IGNORE INTO role_permissions (salon_id, role_key, permission_key, created_at)
SELECT r.salon_id, r.role_key, p.permission_key, '2026-09-14T00:00:00.000Z'
FROM roles r
CROSS JOIN (
  SELECT 'inventory.view' AS permission_key
  UNION ALL SELECT 'inventory.items.manage'
  UNION ALL SELECT 'inventory.recipes.manage'
  UNION ALL SELECT 'inventory.consume.confirm'
  UNION ALL SELECT 'inventory.movements.view'
  UNION ALL SELECT 'inventory.adjust'
  UNION ALL SELECT 'inventory.waste.record'
) p
WHERE r.role_key IN ('owner', 'admin')
  AND r.salon_id IS NOT NULL
  AND TRIM(r.salon_id) <> '';

-- Staff: confirm consumption only
INSERT OR IGNORE INTO role_permissions (salon_id, role_key, permission_key, created_at)
SELECT r.salon_id, r.role_key, 'inventory.consume.confirm', '2026-09-14T00:00:00.000Z'
FROM roles r
WHERE r.role_key = 'staff'
  AND r.salon_id IS NOT NULL
  AND TRIM(r.salon_id) <> '';

-- Reception: view only
INSERT OR IGNORE INTO role_permissions (salon_id, role_key, permission_key, created_at)
SELECT r.salon_id, r.role_key, 'inventory.view', '2026-09-14T00:00:00.000Z'
FROM roles r
WHERE r.role_key = 'reception'
  AND r.salon_id IS NOT NULL
  AND TRIM(r.salon_id) <> '';