-- Strengthen Service Promo Price without changing the offers/packages model.
ALTER TABLE service_promo_prices ADD COLUMN created_by TEXT;
ALTER TABLE service_promo_prices ADD COLUMN updated_by TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_promo_one_active_service
  ON service_promo_prices (salon_id, service_id)
  WHERE is_active = 1;

CREATE INDEX IF NOT EXISTS idx_service_promo_service_window
  ON service_promo_prices (salon_id, service_id, starts_at, ends_at);

CREATE TRIGGER IF NOT EXISTS trg_service_promo_validate_insert
BEFORE INSERT ON service_promo_prices
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.promo_price_halalas < 0 THEN RAISE(ABORT, 'service_promo_prices:promo_price_negative')
    WHEN NEW.catalog_price_halalas < 0 THEN RAISE(ABORT, 'service_promo_prices:catalog_price_negative')
    WHEN NEW.ends_at < NEW.starts_at THEN RAISE(ABORT, 'service_promo_prices:invalid_window')
  END;
END;

CREATE TRIGGER IF NOT EXISTS trg_service_promo_validate_update
BEFORE UPDATE ON service_promo_prices
FOR EACH ROW
BEGIN
  SELECT CASE
    WHEN NEW.promo_price_halalas < 0 THEN RAISE(ABORT, 'service_promo_prices:promo_price_negative')
    WHEN NEW.catalog_price_halalas < 0 THEN RAISE(ABORT, 'service_promo_prices:catalog_price_negative')
    WHEN NEW.ends_at < NEW.starts_at THEN RAISE(ABORT, 'service_promo_prices:invalid_window')
  END;
END;
