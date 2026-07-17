-- Preserve the reason and actor for every package/session balance movement.
ALTER TABLE package_transactions ADD COLUMN reason TEXT;
ALTER TABLE package_transactions ADD COLUMN created_by_uid TEXT;

CREATE INDEX IF NOT EXISTS idx_package_transactions_booking_state
  ON package_transactions(salon_id, booking_id, client_package_id, cart_item_id, created_at);
