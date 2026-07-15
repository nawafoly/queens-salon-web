-- Cloudflare D1 schema for daily session package operations.
-- Firestore remains a migration/reference source only after this schema is populated.

CREATE TABLE IF NOT EXISTS package_catalog (
  id TEXT NOT NULL PRIMARY KEY,
  salon_id TEXT NOT NULL,
  name TEXT NOT NULL,
  total_sessions INTEGER NOT NULL CHECK (total_sessions > 0),
  price REAL NOT NULL DEFAULT 0 CHECK (price >= 0),
  allowed_service_ids_json TEXT NOT NULL DEFAULT '[]',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
  canonical_client_id TEXT NOT NULL,
  salon_id TEXT NOT NULL,
  name TEXT,
  phone_normalized TEXT,
  firebase_uid TEXT,
  legacy_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (salon_id, canonical_client_id)
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
  created_at TEXT NOT NULL,
  FOREIGN KEY (client_package_id) REFERENCES client_packages(id)
);

CREATE TABLE IF NOT EXISTS client_identity_aliases (
  salon_id TEXT NOT NULL,
  alias_id TEXT NOT NULL,
  canonical_client_id TEXT NOT NULL,
  alias_type TEXT NOT NULL DEFAULT 'legacy',
  created_at TEXT NOT NULL,
  PRIMARY KEY (salon_id, alias_id),
  FOREIGN KEY (salon_id, canonical_client_id) REFERENCES clients(salon_id, canonical_client_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_client_packages_id
  ON client_packages(id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_client_identity_aliases_salon_alias
  ON client_identity_aliases(salon_id, alias_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_salon_canonical
  ON clients(salon_id, canonical_client_id);

CREATE INDEX IF NOT EXISTS idx_clients_salon_phone
  ON clients(salon_id, phone_normalized);

CREATE INDEX IF NOT EXISTS idx_clients_salon_firebase_uid
  ON clients(salon_id, firebase_uid);

CREATE INDEX IF NOT EXISTS idx_package_transactions_package
  ON package_transactions(salon_id, client_package_id, created_at);

CREATE INDEX IF NOT EXISTS idx_client_packages_active_client
  ON client_packages(salon_id, canonical_client_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_client_packages_invoice
  ON client_packages(salon_id, invoice_id);
