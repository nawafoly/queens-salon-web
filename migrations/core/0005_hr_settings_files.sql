-- Phase 6: HR, operational settings, role metadata and R2 file metadata.
-- CORE D1 ONLY — do not add Firestore fallback.

CREATE TABLE IF NOT EXISTS employee_profiles (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  firebase_uid TEXT,
  name TEXT NOT NULL,
  email TEXT,
  phone_normalized TEXT,
  avatar_file_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_employee_profiles_salon_status ON employee_profiles(salon_id, status);
CREATE INDEX IF NOT EXISTS idx_employee_profiles_firebase_uid ON employee_profiles(salon_id, firebase_uid);
CREATE INDEX IF NOT EXISTS idx_employee_profiles_phone ON employee_profiles(salon_id, phone_normalized);

CREATE TABLE IF NOT EXISTS employee_employment (
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  title TEXT,
  job_title TEXT,
  department TEXT,
  employment_source TEXT,
  partner_id TEXT,
  partner_member_id TEXT,
  contract_id TEXT,
  start_date TEXT,
  leave_balance REAL NOT NULL DEFAULT 0,
  base_salary_halalas INTEGER NOT NULL DEFAULT 0,
  housing_allowance_halalas INTEGER NOT NULL DEFAULT 0,
  transportation_allowance_halalas INTEGER NOT NULL DEFAULT 0,
  other_allowances_halalas INTEGER NOT NULL DEFAULT 0,
  expected_work_days REAL,
  expected_work_hours REAL,
  shift_start_time TEXT,
  shift_end_time TEXT,
  weekly_off_days_json TEXT NOT NULL DEFAULT '[]',
  allowed_zone_ids_json TEXT NOT NULL DEFAULT '[]',
  employment_status TEXT NOT NULL DEFAULT 'active',
  employee_code TEXT,
  fingerprint_number TEXT,
  admin_notes TEXT,
  updated_by_uid TEXT,
  updated_by_email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (salon_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_employee_employment_status ON employee_employment(salon_id, employment_status);
CREATE INDEX IF NOT EXISTS idx_employee_employment_partner ON employee_employment(salon_id, partner_id);

CREATE TABLE IF NOT EXISTS hr_work_schedules (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  weekday INTEGER NOT NULL,
  start_time TEXT,
  end_time TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  effective_from TEXT,
  effective_to TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_schedule_unique
  ON hr_work_schedules(salon_id, employee_id, weekday, COALESCE(start_time, ''), COALESCE(end_time, ''), COALESCE(effective_from, ''));
CREATE INDEX IF NOT EXISTS idx_hr_schedule_employee ON hr_work_schedules(salon_id, employee_id, active, weekday);

CREATE TABLE IF NOT EXISTS attendance_records (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  employee_uid TEXT,
  date_key TEXT NOT NULL,
  record_type TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  accuracy_meters REAL,
  zone_id TEXT,
  device_id TEXT,
  source TEXT,
  note TEXT,
  idempotency_key TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_idempotency
  ON attendance_records(salon_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_employee_date ON attendance_records(salon_id, employee_id, date_key, recorded_at);

CREATE TABLE IF NOT EXISTS attendance_state (
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  last_type TEXT,
  last_record_id TEXT,
  last_time TEXT,
  last_latitude REAL,
  last_longitude REAL,
  last_accuracy_meters REAL,
  last_zone_id TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (salon_id, employee_id)
);

CREATE TABLE IF NOT EXISTS employee_leaves (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  employee_uid TEXT,
  employee_name TEXT,
  employee_email TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  leave_type TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  days_count REAL NOT NULL DEFAULT 0,
  employee_note TEXT,
  hr_note TEXT,
  decided_at TEXT,
  decided_by_uid TEXT,
  decided_by_email TEXT,
  decided_by_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_employee_leaves_employee ON employee_leaves(salon_id, employee_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_employee_leaves_status ON employee_leaves(salon_id, status, start_date);

CREATE TABLE IF NOT EXISTS employee_absences (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  employee_uid TEXT,
  date_key TEXT NOT NULL,
  absence_type TEXT NOT NULL,
  note TEXT,
  created_by_uid TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_absence_unique ON employee_absences(salon_id, employee_id, date_key);
CREATE INDEX IF NOT EXISTS idx_employee_absence_employee ON employee_absences(salon_id, employee_id, date_key);

CREATE TABLE IF NOT EXISTS payroll_periods (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  payroll_month TEXT NOT NULL,
  month_start TEXT NOT NULL,
  month_end TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_by_uid TEXT,
  closed_by_uid TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_period_month ON payroll_periods(salon_id, payroll_month);

CREATE TABLE IF NOT EXISTS payroll_entries (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  period_id TEXT,
  employee_id TEXT NOT NULL,
  payroll_month TEXT NOT NULL,
  base_salary_halalas INTEGER NOT NULL DEFAULT 0,
  allowances_halalas INTEGER NOT NULL DEFAULT 0,
  absence_days REAL NOT NULL DEFAULT 0,
  absence_deduction_halalas INTEGER NOT NULL DEFAULT 0,
  expected_work_hours REAL,
  actual_worked_hours REAL,
  missing_hours REAL,
  overtime_hours REAL,
  overtime_bonus_halalas INTEGER NOT NULL DEFAULT 0,
  delay_deduction_halalas INTEGER NOT NULL DEFAULT 0,
  insurance_deduction_halalas INTEGER NOT NULL DEFAULT 0,
  other_deductions_halalas INTEGER NOT NULL DEFAULT 0,
  gross_salary_halalas INTEGER NOT NULL DEFAULT 0,
  final_salary_halalas INTEGER NOT NULL DEFAULT 0,
  schedule_snapshot_json TEXT,
  absence_entries_json TEXT,
  deductions_json TEXT,
  mudad_file_id TEXT,
  created_by_uid TEXT,
  created_by_email TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_payroll_entry_employee_month ON payroll_entries(salon_id, employee_id, payroll_month);
CREATE INDEX IF NOT EXISTS idx_payroll_entry_period ON payroll_entries(salon_id, period_id);

CREATE TABLE IF NOT EXISTS salon_settings (
  salon_id TEXT NOT NULL,
  setting_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'private',
  updated_by_uid TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (salon_id, setting_key)
);

CREATE TABLE IF NOT EXISTS admin_profiles (
  salon_id TEXT NOT NULL,
  firebase_uid TEXT NOT NULL,
  username TEXT,
  display_name TEXT,
  email TEXT,
  employee_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (salon_id, firebase_uid)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_profile_username ON admin_profiles(salon_id, username) WHERE username IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_profile_email ON admin_profiles(salon_id, email) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS role_assignments (
  salon_id TEXT NOT NULL,
  firebase_uid TEXT NOT NULL,
  role TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'salon',
  active INTEGER NOT NULL DEFAULT 1,
  assigned_by_uid TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (salon_id, firebase_uid, role, scope)
);
CREATE INDEX IF NOT EXISTS idx_role_assignments_uid ON role_assignments(salon_id, firebase_uid, active);

CREATE TABLE IF NOT EXISTS file_metadata (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  employee_id TEXT,
  category TEXT NOT NULL,
  title TEXT,
  description TEXT,
  file_name TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  bucket_name TEXT,
  content_type TEXT,
  size_bytes INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  visibility TEXT NOT NULL DEFAULT 'private',
  uploaded_by_uid TEXT,
  replaced_by_file_id TEXT,
  replaces_file_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_file_storage_key ON file_metadata(salon_id, storage_key);
CREATE INDEX IF NOT EXISTS idx_file_employee_category ON file_metadata(salon_id, employee_id, category, status);

CREATE TABLE IF NOT EXISTS notification_records (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  target_uid TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  notification_type TEXT,
  related_type TEXT,
  related_id TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  read_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_target ON notification_records(salon_id, target_uid, is_read, created_at);
