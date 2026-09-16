-- Inventory permissions: tenant-safe role grants.
INSERT OR IGNORE INTO role_permissions (salon_id, role_key, permission_key, created_at)
SELECT r.salon_id, r.role_key, 'inventory.view', '2026-09-14T00:00:00.000Z'
FROM roles r
WHERE r.role_key IN ('owner', 'admin', 'reception') AND r.salon_id IS NOT NULL AND TRIM(r.salon_id) <> '';

INSERT OR IGNORE INTO role_permissions (salon_id, role_key, permission_key, created_at)
SELECT r.salon_id, r.role_key, 'inventory.items.manage', '2026-09-14T00:00:00.000Z'
FROM roles r
WHERE r.role_key IN ('owner', 'admin') AND r.salon_id IS NOT NULL AND TRIM(r.salon_id) <> '';

INSERT OR IGNORE INTO role_permissions (salon_id, role_key, permission_key, created_at)
SELECT r.salon_id, r.role_key, 'inventory.recipes.manage', '2026-09-14T00:00:00.000Z'
FROM roles r
WHERE r.role_key IN ('owner', 'admin') AND r.salon_id IS NOT NULL AND TRIM(r.salon_id) <> '';

INSERT OR IGNORE INTO role_permissions (salon_id, role_key, permission_key, created_at)
SELECT r.salon_id, r.role_key, 'inventory.consume.confirm', '2026-09-14T00:00:00.000Z'
FROM roles r
WHERE r.role_key IN ('owner', 'admin', 'staff') AND r.salon_id IS NOT NULL AND TRIM(r.salon_id) <> '';

INSERT OR IGNORE INTO role_permissions (salon_id, role_key, permission_key, created_at)
SELECT r.salon_id, r.role_key, 'inventory.movements.view', '2026-09-14T00:00:00.000Z'
FROM roles r
WHERE r.role_key IN ('owner', 'admin') AND r.salon_id IS NOT NULL AND TRIM(r.salon_id) <> '';

INSERT OR IGNORE INTO role_permissions (salon_id, role_key, permission_key, created_at)
SELECT r.salon_id, r.role_key, 'inventory.adjust', '2026-09-14T00:00:00.000Z'
FROM roles r
WHERE r.role_key IN ('owner', 'admin') AND r.salon_id IS NOT NULL AND TRIM(r.salon_id) <> '';

INSERT OR IGNORE INTO role_permissions (salon_id, role_key, permission_key, created_at)
SELECT r.salon_id, r.role_key, 'inventory.waste.record', '2026-09-14T00:00:00.000Z'
FROM roles r
WHERE r.role_key IN ('owner', 'admin') AND r.salon_id IS NOT NULL AND TRIM(r.salon_id) <> '';
