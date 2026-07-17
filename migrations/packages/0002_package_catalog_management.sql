-- Complete D1 package catalog metadata used by dashboard and client portal.
ALTER TABLE package_catalog ADD COLUMN description TEXT;
ALTER TABLE package_catalog ADD COLUMN validity_days INTEGER;
ALTER TABLE package_catalog ADD COLUMN image_url TEXT;
ALTER TABLE package_catalog ADD COLUMN terms TEXT;
ALTER TABLE package_catalog ADD COLUMN starts_at TEXT;
ALTER TABLE package_catalog ADD COLUMN ends_at TEXT;
ALTER TABLE package_catalog ADD COLUMN sale_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE package_catalog ADD COLUMN audience_scope TEXT NOT NULL DEFAULT 'all';
ALTER TABLE package_catalog ADD COLUMN target_client_ids_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE package_catalog ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_package_catalog_visible
  ON package_catalog(salon_id, active, sale_enabled, starts_at, ends_at, sort_order);
