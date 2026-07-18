-- Unify session packages with the canonical Core D1 database.
-- The existing Core clients table remains the only client source of truth.

ALTER TABLE clients ADD COLUMN canonical_client_id TEXT;
ALTER TABLE clients ADD COLUMN legacy_ids_json TEXT NOT NULL DEFAULT '[]';

UPDATE clients
SET canonical_client_id = id
WHERE canonical_client_id IS NULL OR TRIM(canonical_client_id) = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_core_clients_salon_canonical
  ON clients(salon_id, canonical_client_id);

-- Compatibility view for the former Packages D1 alias table. All writes are
-- redirected into Core's canonical client_aliases table, so aliases are not
-- duplicated across two sources.
CREATE VIEW IF NOT EXISTS client_identity_aliases AS
SELECT salon_id, alias_id, canonical_client_id, alias_type, created_at
FROM client_aliases;

CREATE TRIGGER IF NOT EXISTS trg_core_client_identity_aliases_insert
INSTEAD OF INSERT ON client_identity_aliases
BEGIN
  INSERT OR IGNORE INTO client_aliases
    (salon_id, alias_id, canonical_client_id, alias_type, created_at)
  VALUES
    (NEW.salon_id, NEW.alias_id, NEW.canonical_client_id, COALESCE(NEW.alias_type, 'legacy'), NEW.created_at);
END;

CREATE TABLE IF NOT EXISTS package_catalog (
  id TEXT NOT NULL PRIMARY KEY,
  salon_id TEXT NOT NULL,
  name TEXT NOT NULL,
  total_sessions INTEGER NOT NULL CHECK (total_sessions > 0),
  price REAL NOT NULL DEFAULT 0 CHECK (price >= 0),
  allowed_service_ids_json TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  validity_days INTEGER,
  image_url TEXT,
  terms TEXT,
  starts_at TEXT,
  ends_at TEXT,
  sale_enabled INTEGER NOT NULL DEFAULT 1,
  audience_scope TEXT NOT NULL DEFAULT 'all',
  target_client_ids_json TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS client_packages (
  id TEXT NOT NULL PRIMARY KEY,
  salon_id TEXT NOT NULL,
  canonical_client_id TEXT NOT NULL,
  package_catalog_id TEXT NOT NULL,
  package_name_snapshot TEXT NOT NULL,
  allowed_service_ids_json TEXT NOT NULL DEFAULT '[]',
  total_sessions INTEGER NOT NULL CHECK (total_sessions >= 0),
  remaining_sessions INTEGER NOT NULL CHECK (remaining_sessions >= 0),
  reserved_sessions INTEGER NOT NULL DEFAULT 0 CHECK (reserved_sessions >= 0),
  used_sessions INTEGER NOT NULL DEFAULT 0 CHECK (used_sessions >= 0),
  status TEXT NOT NULL DEFAULT 'active',
  purchased_at TEXT,
  expires_at TEXT,
  invoice_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (salon_id, canonical_client_id) REFERENCES clients(salon_id, canonical_client_id),
  FOREIGN KEY (package_catalog_id) REFERENCES package_catalog(id),
  CHECK (total_sessions = remaining_sessions + reserved_sessions + used_sessions)
);

CREATE TABLE IF NOT EXISTS package_transactions (
  id TEXT NOT NULL PRIMARY KEY,
  salon_id TEXT NOT NULL,
  client_package_id TEXT NOT NULL,
  canonical_client_id TEXT NOT NULL,
  type TEXT NOT NULL,
  sessions_delta INTEGER NOT NULL DEFAULT 0,
  remaining_before INTEGER NOT NULL,
  remaining_after INTEGER NOT NULL,
  reserved_before INTEGER NOT NULL,
  reserved_after INTEGER NOT NULL,
  used_before INTEGER NOT NULL,
  used_after INTEGER NOT NULL,
  service_id TEXT,
  booking_id TEXT,
  cart_item_id TEXT,
  invoice_id TEXT,
  reason TEXT,
  created_by_uid TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (client_package_id) REFERENCES client_packages(id)
);

CREATE INDEX IF NOT EXISTS idx_core_package_catalog_visible
  ON package_catalog(salon_id, active, sale_enabled, starts_at, ends_at, sort_order);
CREATE INDEX IF NOT EXISTS idx_core_client_packages_active_client
  ON client_packages(salon_id, canonical_client_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_core_client_packages_invoice
  ON client_packages(salon_id, invoice_id);
CREATE INDEX IF NOT EXISTS idx_core_package_transactions_package
  ON package_transactions(salon_id, client_package_id, created_at);
CREATE INDEX IF NOT EXISTS idx_core_package_transactions_booking_state
  ON package_transactions(salon_id, booking_id, client_package_id, cart_item_id, created_at);
