-- Durable booking concurrency and package-wallet read revisions.
-- Existing rows start at revision zero; no historical state is inferred.

ALTER TABLE bookings
ADD COLUMN lifecycle_revision INTEGER NOT NULL DEFAULT 0
CHECK (
  typeof(lifecycle_revision) = 'integer'
  AND lifecycle_revision >= 0
  AND lifecycle_revision <= 9007199254740991
);

-- A conditional INSERT of NULL into this table is used as a named,
-- transaction-aborting compare-and-set fence. Successful CAS operations
-- insert no row, so this table remains empty.
CREATE TABLE booking_lifecycle_cas_guard (
  id TEXT NOT NULL
);

CREATE TABLE package_wallet_versions (
  salon_id TEXT NOT NULL,
  canonical_client_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0
    CHECK (revision >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (salon_id, canonical_client_id)
);

CREATE TRIGGER trg_package_wallet_version_insert
AFTER INSERT ON client_packages
BEGIN
  INSERT INTO package_wallet_versions (
    salon_id, canonical_client_id, revision, updated_at
  ) VALUES (
    NEW.salon_id, NEW.canonical_client_id, 1, NEW.updated_at
  )
  ON CONFLICT(salon_id, canonical_client_id) DO UPDATE SET
    revision = package_wallet_versions.revision + 1,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER trg_package_wallet_version_update
AFTER UPDATE ON client_packages
BEGIN
  INSERT INTO package_wallet_versions (
    salon_id, canonical_client_id, revision, updated_at
  ) VALUES (
    NEW.salon_id, NEW.canonical_client_id, 1, NEW.updated_at
  )
  ON CONFLICT(salon_id, canonical_client_id) DO UPDATE SET
    revision = package_wallet_versions.revision + 1,
    updated_at = excluded.updated_at;

  INSERT INTO package_wallet_versions (
    salon_id, canonical_client_id, revision, updated_at
  )
  SELECT OLD.salon_id, OLD.canonical_client_id, 1, NEW.updated_at
  WHERE OLD.salon_id IS NOT NEW.salon_id
     OR OLD.canonical_client_id IS NOT NEW.canonical_client_id
  ON CONFLICT(salon_id, canonical_client_id) DO UPDATE SET
    revision = package_wallet_versions.revision + 1,
    updated_at = excluded.updated_at;
END;

CREATE TRIGGER trg_package_wallet_version_delete
AFTER DELETE ON client_packages
BEGIN
  INSERT INTO package_wallet_versions (
    salon_id, canonical_client_id, revision, updated_at
  ) VALUES (
    OLD.salon_id,
    OLD.canonical_client_id,
    1,
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
  ON CONFLICT(salon_id, canonical_client_id) DO UPDATE SET
    revision = package_wallet_versions.revision + 1,
    updated_at = excluded.updated_at;
END;
