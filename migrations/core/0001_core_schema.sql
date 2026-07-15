CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone_normalized TEXT,
  email TEXT,
  firebase_uid TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS client_aliases (
  salon_id TEXT NOT NULL,
  alias_id TEXT NOT NULL,
  canonical_client_id TEXT NOT NULL,
  alias_type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (salon_id, alias_id)
);

CREATE TABLE IF NOT EXISTS service_categories (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  name TEXT NOT NULL,
  category_id TEXT,
  description TEXT,
  duration_minutes INTEGER NOT NULL,
  price_halalas INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  image_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  firebase_uid TEXT,
  name TEXT NOT NULL,
  phone_normalized TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  employment_status TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_services (
  salon_id TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (salon_id, staff_id, service_id)
);

CREATE TABLE IF NOT EXISTS staff_schedules (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  weekday INTEGER NOT NULL,
  start_time TEXT,
  end_time TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  staff_id TEXT,
  booking_date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT,
  status TEXT NOT NULL,
  source TEXT,
  notes TEXT,
  subtotal_halalas INTEGER NOT NULL DEFAULT 0,
  discount_halalas INTEGER NOT NULL DEFAULT 0,
  total_halalas INTEGER NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'unpaid',
  package_sessions_used INTEGER NOT NULL DEFAULT 0,
  created_by_uid TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cancelled_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS booking_items (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL,
  salon_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  service_name_snapshot TEXT NOT NULL,
  staff_id TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price_halalas INTEGER NOT NULL,
  total_halalas INTEGER NOT NULL,
  package_covered INTEGER NOT NULL DEFAULT 0,
  client_package_id TEXT,
  duration_minutes INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  booking_id TEXT,
  client_id TEXT NOT NULL,
  invoice_number TEXT,
  subtotal_halalas INTEGER NOT NULL,
  discount_halalas INTEGER NOT NULL DEFAULT 0,
  total_halalas INTEGER NOT NULL,
  paid_halalas INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  invoice_id TEXT,
  booking_id TEXT,
  client_id TEXT,
  method TEXT NOT NULL,
  amount_halalas INTEGER NOT NULL,
  status TEXT NOT NULL,
  provider TEXT,
  provider_reference TEXT,
  idempotency_key TEXT,
  paid_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS income_entries (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  booking_id TEXT,
  invoice_id TEXT,
  payment_id TEXT,
  amount_halalas INTEGER NOT NULL,
  category TEXT,
  description TEXT,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expense_entries (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  amount_halalas INTEGER NOT NULL,
  category TEXT,
  description TEXT,
  payment_method TEXT,
  occurred_at TEXT NOT NULL,
  created_by_uid TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS discounts (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  code TEXT,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  value INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  starts_at TEXT,
  ends_at TEXT,
  usage_limit INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_core_clients_phone
  ON clients(salon_id, phone_normalized);

CREATE INDEX IF NOT EXISTS idx_core_clients_firebase_uid
  ON clients(salon_id, firebase_uid);

CREATE INDEX IF NOT EXISTS idx_core_client_aliases_canonical
  ON client_aliases(salon_id, canonical_client_id);

CREATE INDEX IF NOT EXISTS idx_core_services_active_category
  ON services(salon_id, active, category_id);

CREATE INDEX IF NOT EXISTS idx_core_staff_active
  ON staff(salon_id, active);

CREATE INDEX IF NOT EXISTS idx_core_bookings_date_status
  ON bookings(salon_id, booking_date, status);

CREATE INDEX IF NOT EXISTS idx_core_bookings_client
  ON bookings(salon_id, client_id);

CREATE INDEX IF NOT EXISTS idx_core_bookings_staff_date
  ON bookings(salon_id, staff_id, booking_date);

CREATE UNIQUE INDEX IF NOT EXISTS idx_core_bookings_staff_slot_active
  ON bookings(salon_id, staff_id, booking_date, start_time)
  WHERE staff_id IS NOT NULL AND status NOT IN ('cancelled');

CREATE INDEX IF NOT EXISTS idx_core_booking_items_booking
  ON booking_items(booking_id);

CREATE INDEX IF NOT EXISTS idx_core_invoices_client
  ON invoices(salon_id, client_id);

CREATE INDEX IF NOT EXISTS idx_core_invoices_booking
  ON invoices(booking_id);

CREATE INDEX IF NOT EXISTS idx_core_payments_invoice
  ON payments(invoice_id);

CREATE INDEX IF NOT EXISTS idx_core_payments_booking
  ON payments(booking_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_core_payments_idempotency
  ON payments(salon_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_core_income_occurred
  ON income_entries(salon_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_core_expenses_occurred
  ON expense_entries(salon_id, occurred_at);
