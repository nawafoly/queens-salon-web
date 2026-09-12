-- Canonical employee document classification.
-- category remains the file workflow/domain category.
-- document_type is the employee-facing document classification.

ALTER TABLE file_metadata ADD COLUMN document_type TEXT;

CREATE INDEX IF NOT EXISTS idx_file_metadata_employee_document_type
  ON file_metadata(
    salon_id,
    employee_id,
    category,
    document_type,
    status,
    created_at DESC
  );
