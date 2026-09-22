-- Service Promo Price. Independent from offers/packages.
CREATE TABLE IF NOT EXISTS service_promo_prices (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  catalog_price_halalas INTEGER NOT NULL,
  promo_price_halalas INTEGER NOT NULL,
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_service_promo_salon_service
  ON service_promo_prices (salon_id, service_id, is_active);
CREATE INDEX IF NOT EXISTS idx_service_promo_window
  ON service_promo_prices (salon_id, starts_at, ends_at);
