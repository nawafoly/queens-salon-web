CREATE TABLE IF NOT EXISTS attendance_permission_cache (
  uid TEXT PRIMARY KEY,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'guest',
  active INTEGER NOT NULL DEFAULT 1,
  permission_version INTEGER NOT NULL DEFAULT 0,
  permissions_json TEXT NOT NULL DEFAULT '[]',
  overrides_enabled_json TEXT NOT NULL DEFAULT '[]',
  overrides_disabled_json TEXT NOT NULL DEFAULT '[]',
  effective_permissions_json TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'firestore',
  cached_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attendance_permission_cache_expires_at
  ON attendance_permission_cache (expires_at);
