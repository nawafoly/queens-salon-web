CREATE TABLE IF NOT EXISTS work_zones (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'radius' CHECK (type = 'radius'),
  center_lat REAL NOT NULL CHECK (center_lat BETWEEN -90 AND 90),
  center_lng REAL NOT NULL CHECK (center_lng BETWEEN -180 AND 180),
  radius_meters REAL NOT NULL CHECK (radius_meters > 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_by_uid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by_uid TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_work_zones_active
  ON work_zones (active, name);

CREATE TABLE IF NOT EXISTS attendance_records (
  id TEXT PRIMARY KEY,
  employee_uid TEXT NOT NULL,
  employee_doc_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('check_in', 'check_out')),
  server_time TEXT NOT NULL,
  client_time TEXT,
  location_lat REAL NOT NULL,
  location_lng REAL NOT NULL,
  location_accuracy REAL NOT NULL,
  zone_id TEXT,
  zone_name TEXT,
  zone_type TEXT,
  allowed_zone_ids TEXT NOT NULL DEFAULT '[]',
  distance_meters INTEGER,
  result TEXT NOT NULL CHECK (result IN ('allowed', 'rejected')),
  rejection_reason TEXT,
  accuracy_accepted INTEGER NOT NULL CHECK (accuracy_accepted IN (0, 1)),
  device_info TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT '{}',
  created_by_uid TEXT NOT NULL,
  created_by_email TEXT,
  created_by_role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (zone_id) REFERENCES work_zones(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_attendance_records_employee_time
  ON attendance_records (employee_uid, server_time DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_records_result_time
  ON attendance_records (result, server_time DESC);

CREATE TABLE IF NOT EXISTS attendance_state (
  employee_uid TEXT PRIMARY KEY,
  employee_doc_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('checked_in', 'checked_out')),
  last_type TEXT CHECK (last_type IN ('check_in', 'check_out')),
  last_record_id TEXT,
  last_server_time TEXT,
  last_location_lat REAL,
  last_location_lng REAL,
  last_location_accuracy REAL,
  last_zone_id TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (last_record_id) REFERENCES attendance_records(id),
  FOREIGN KEY (last_zone_id) REFERENCES work_zones(id) ON DELETE SET NULL
);
