CREATE INDEX IF NOT EXISTS idx_core_services_salon_section_active_sort
  ON services(salon_id, section_id, active, sort_order, name);

CREATE INDEX IF NOT EXISTS idx_core_services_salon_category_active_sort
  ON services(salon_id, category_id, active, sort_order, name);

CREATE INDEX IF NOT EXISTS idx_disciplinary_fine_fund_kind_created
  ON employee_disciplinary_fine_fund_ledger(
    salon_id, entry_kind, created_at DESC, id DESC
  );

CREATE INDEX IF NOT EXISTS idx_disciplinary_fine_fund_case_kind_created
  ON employee_disciplinary_fine_fund_ledger(
    salon_id, disciplinary_case_id, entry_kind, created_at DESC, id DESC
  );
