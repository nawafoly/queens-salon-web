CREATE INDEX IF NOT EXISTS idx_file_metadata_salon_created
  ON file_metadata(salon_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_file_metadata_employee_category_status_created
  ON file_metadata(salon_id, employee_id, category, status, created_at DESC);
