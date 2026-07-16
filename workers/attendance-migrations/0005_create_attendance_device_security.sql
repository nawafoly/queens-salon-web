CREATE TABLE IF NOT EXISTS attendance_devices (
  device_id TEXT PRIMARY KEY,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  first_seen_employee_uid TEXT,
  last_seen_employee_uid TEXT,
  platform TEXT,
  user_agent TEXT,
  language TEXT,
  time_zone TEXT,
  app_variant TEXT,
  app_version TEXT,
  screen_size TEXT,
  standalone INTEGER NOT NULL DEFAULT 0 CHECK (standalone IN (0, 1)),
  total_records INTEGER NOT NULL DEFAULT 0,
  allowed_records INTEGER NOT NULL DEFAULT 0,
  rejected_records INTEGER NOT NULL DEFAULT 0,
  trust_status TEXT NOT NULL DEFAULT 'new'
    CHECK (trust_status IN ('new', 'trusted', 'blocked')),
  notes TEXT,
  trusted_by_uid TEXT,
  trusted_at TEXT,
  blocked_by_uid TEXT,
  blocked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attendance_devices_last_seen
  ON attendance_devices (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_devices_status
  ON attendance_devices (trust_status, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS attendance_device_assignments (
  device_id TEXT NOT NULL,
  employee_uid TEXT NOT NULL,
  employee_doc_id TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  records_count INTEGER NOT NULL DEFAULT 0,
  allowed_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (device_id, employee_uid),
  FOREIGN KEY (device_id) REFERENCES attendance_devices(device_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attendance_device_assignments_employee
  ON attendance_device_assignments (employee_uid, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_device_assignments_device
  ON attendance_device_assignments (device_id, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS attendance_security_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL
    CHECK (event_type IN (
      'new_device',
      'device_changed',
      'shared_device',
      'blocked_device_attempt',
      'rejected_punch',
      'poor_accuracy'
    )),
  severity TEXT NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info', 'warning', 'critical')),
  employee_uid TEXT NOT NULL,
  employee_doc_id TEXT,
  device_id TEXT,
  record_id TEXT,
  title TEXT NOT NULL,
  detail TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved', 'ignored')),
  resolved_by_uid TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (device_id) REFERENCES attendance_devices(device_id) ON DELETE SET NULL,
  FOREIGN KEY (record_id) REFERENCES attendance_records(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_attendance_security_events_status_time
  ON attendance_security_events (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_security_events_employee_time
  ON attendance_security_events (employee_uid, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_security_events_device_time
  ON attendance_security_events (device_id, created_at DESC);

-- Backfill the device registry from existing punches so the new dashboard is
-- useful immediately after deployment. Historical security alerts are not
-- generated retroactively; only device/employee usage and counters are seeded.
WITH normalized_records AS (
  SELECT
    id,
    employee_uid,
    employee_doc_id,
    server_time,
    created_at,
    updated_at,
    result,
    trim(json_extract(device_info, '$.deviceId')) AS device_id,
    NULLIF(trim(json_extract(device_info, '$.platform')), '') AS platform,
    NULLIF(trim(json_extract(device_info, '$.userAgent')), '') AS user_agent,
    NULLIF(trim(json_extract(device_info, '$.language')), '') AS language,
    NULLIF(trim(json_extract(device_info, '$.timeZone')), '') AS time_zone,
    NULLIF(trim(json_extract(device_info, '$.appVariant')), '') AS app_variant,
    NULLIF(trim(json_extract(device_info, '$.appVersion')), '') AS app_version,
    NULLIF(trim(json_extract(device_info, '$.screenSize')), '') AS screen_size,
    CASE WHEN json_extract(device_info, '$.standalone') = 1 THEN 1 ELSE 0 END AS standalone,
    ROW_NUMBER() OVER (
      PARTITION BY trim(json_extract(device_info, '$.deviceId'))
      ORDER BY server_time ASC, id ASC
    ) AS first_row,
    ROW_NUMBER() OVER (
      PARTITION BY trim(json_extract(device_info, '$.deviceId'))
      ORDER BY server_time DESC, id DESC
    ) AS last_row
  FROM attendance_records
  WHERE json_valid(device_info) = 1
    AND length(trim(coalesce(json_extract(device_info, '$.deviceId'), ''))) > 0
), aggregated_devices AS (
  SELECT
    device_id,
    MIN(server_time) AS first_seen_at,
    MAX(server_time) AS last_seen_at,
    MAX(CASE WHEN first_row = 1 THEN employee_uid END) AS first_seen_employee_uid,
    MAX(CASE WHEN last_row = 1 THEN employee_uid END) AS last_seen_employee_uid,
    MAX(platform) AS platform,
    MAX(user_agent) AS user_agent,
    MAX(language) AS language,
    MAX(time_zone) AS time_zone,
    MAX(app_variant) AS app_variant,
    MAX(app_version) AS app_version,
    MAX(screen_size) AS screen_size,
    MAX(standalone) AS standalone,
    COUNT(*) AS total_records,
    SUM(CASE WHEN result = 'allowed' THEN 1 ELSE 0 END) AS allowed_records,
    SUM(CASE WHEN result = 'rejected' THEN 1 ELSE 0 END) AS rejected_records,
    MIN(created_at) AS created_at,
    MAX(updated_at) AS updated_at
  FROM normalized_records
  GROUP BY device_id
)
INSERT OR IGNORE INTO attendance_devices (
  device_id, first_seen_at, last_seen_at,
  first_seen_employee_uid, last_seen_employee_uid,
  platform, user_agent, language, time_zone,
  app_variant, app_version, screen_size, standalone,
  total_records, allowed_records, rejected_records,
  trust_status, created_at, updated_at
)
SELECT
  device_id, first_seen_at, last_seen_at,
  first_seen_employee_uid, last_seen_employee_uid,
  platform, user_agent, language, time_zone,
  app_variant, app_version, screen_size, standalone,
  total_records, allowed_records, rejected_records,
  'new', created_at, updated_at
FROM aggregated_devices;

WITH normalized_records AS (
  SELECT
    employee_uid,
    employee_doc_id,
    server_time,
    created_at,
    updated_at,
    result,
    trim(json_extract(device_info, '$.deviceId')) AS device_id
  FROM attendance_records
  WHERE json_valid(device_info) = 1
    AND length(trim(coalesce(json_extract(device_info, '$.deviceId'), ''))) > 0
)
INSERT OR IGNORE INTO attendance_device_assignments (
  device_id, employee_uid, employee_doc_id,
  first_seen_at, last_seen_at, records_count,
  allowed_count, rejected_count, is_primary,
  created_at, updated_at
)
SELECT
  device_id,
  employee_uid,
  MAX(employee_doc_id),
  MIN(server_time),
  MAX(server_time),
  COUNT(*),
  SUM(CASE WHEN result = 'allowed' THEN 1 ELSE 0 END),
  SUM(CASE WHEN result = 'rejected' THEN 1 ELSE 0 END),
  0,
  MIN(created_at),
  MAX(updated_at)
FROM normalized_records
GROUP BY device_id, employee_uid;

