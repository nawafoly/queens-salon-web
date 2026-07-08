CREATE TABLE IF NOT EXISTS attendance_monthly_summaries (
  id TEXT PRIMARY KEY,
  employee_uid TEXT NOT NULL,
  employee_doc_id TEXT,
  year_month TEXT NOT NULL,
  present_days INTEGER NOT NULL DEFAULT 0,
  check_in_count INTEGER NOT NULL DEFAULT 0,
  check_out_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  worked_minutes INTEGER NOT NULL DEFAULT 0,
  late_minutes INTEGER NOT NULL DEFAULT 0,
  early_leave_minutes INTEGER NOT NULL DEFAULT 0,
  overtime_minutes INTEGER NOT NULL DEFAULT 0,
  shortage_minutes INTEGER NOT NULL DEFAULT 0,
  device_ids_json TEXT NOT NULL DEFAULT '[]',
  zone_ids_json TEXT NOT NULL DEFAULT '[]',
  first_check_in TEXT,
  last_check_out TEXT,
  source_records_count INTEGER NOT NULL DEFAULT 0,
  generated_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_monthly_summaries_employee_month
  ON attendance_monthly_summaries (employee_uid, year_month);

