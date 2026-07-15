-- PHASE 5 — Admin operations cutover. CORE D1 ONLY.

ALTER TABLE clients ADD COLUMN vip INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clients ADD COLUMN legacy_client_doc_id TEXT;
ALTER TABLE service_categories ADD COLUMN section_id TEXT;

ALTER TABLE income_entries ADD COLUMN method TEXT;
ALTER TABLE income_entries ADD COLUMN payment_breakdown_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE income_entries ADD COLUMN source TEXT;
ALTER TABLE income_entries ADD COLUMN note TEXT;
ALTER TABLE income_entries ADD COLUMN client_name TEXT;
ALTER TABLE income_entries ADD COLUMN client_phone TEXT;

ALTER TABLE expense_entries ADD COLUMN title TEXT;
ALTER TABLE expense_entries ADD COLUMN note TEXT;
ALTER TABLE expense_entries ADD COLUMN added_by TEXT;
ALTER TABLE expense_entries ADD COLUMN source_kind TEXT;
ALTER TABLE expense_entries ADD COLUMN source_ref_id TEXT;
ALTER TABLE expense_entries ADD COLUMN source_type TEXT;
ALTER TABLE expense_entries ADD COLUMN staff_id TEXT;
ALTER TABLE expense_entries ADD COLUMN staff_name TEXT;
ALTER TABLE expense_entries ADD COLUMN month_key TEXT;
ALTER TABLE expense_entries ADD COLUMN payroll_kind TEXT;

ALTER TABLE discounts ADD COLUMN code_key TEXT;
ALTER TABLE discounts ADD COLUMN applies_to TEXT NOT NULL DEFAULT 'all';
ALTER TABLE discounts ADD COLUMN service_ids_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE discounts ADD COLUMN sequence_steps_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE discounts ADD COLUMN image_url TEXT;
ALTER TABLE discounts ADD COLUMN deleted_at TEXT;

CREATE TABLE IF NOT EXISTS service_sections (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS refunds (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  payment_id TEXT,
  invoice_id TEXT,
  booking_id TEXT,
  client_id TEXT,
  amount_halalas INTEGER NOT NULL,
  method TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  idempotency_key TEXT,
  provider_reference TEXT,
  created_by_uid TEXT,
  refunded_at TEXT NOT NULL,
  voided_at TEXT,
  voided_by_uid TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  description TEXT,
  source TEXT,
  actor_uid TEXT,
  actor_email TEXT,
  actor_name TEXT,
  before_json TEXT,
  after_json TEXT,
  meta_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_core_clients_phone_lookup
  ON clients(salon_id, phone_normalized)
  WHERE phone_normalized IS NOT NULL AND phone_normalized <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_core_discounts_code_key
  ON discounts(salon_id, code_key)
  WHERE code_key IS NOT NULL AND code_key <> '' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_core_discounts_active_dates
  ON discounts(salon_id, active, starts_at, ends_at);

CREATE INDEX IF NOT EXISTS idx_core_sections_active_order
  ON service_sections(salon_id, active, sort_order);

CREATE INDEX IF NOT EXISTS idx_core_categories_section_order
  ON service_categories(salon_id, section_id, active, sort_order);

CREATE UNIQUE INDEX IF NOT EXISTS idx_core_refunds_idempotency
  ON refunds(salon_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL AND idempotency_key <> '';

CREATE INDEX IF NOT EXISTS idx_core_refunds_payment
  ON refunds(salon_id, payment_id, refunded_at);

CREATE INDEX IF NOT EXISTS idx_core_refunds_booking
  ON refunds(salon_id, booking_id, refunded_at);

CREATE INDEX IF NOT EXISTS idx_core_audit_created
  ON audit_logs(salon_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_core_audit_entity
  ON audit_logs(salon_id, entity_type, entity_id, created_at DESC);
