-- Package-backed booking items and their session reservation commit in the
-- same Core D1 transaction. The trigger is the final CAS fence: if a package
-- balance update lost a race and therefore did not insert its movement, the
-- booking item insert aborts the whole D1 batch.

CREATE TRIGGER IF NOT EXISTS trg_booking_item_requires_live_package_reservation
BEFORE INSERT ON booking_items
WHEN NEW.package_covered = 1
BEGIN
  SELECT CASE
    WHEN NEW.client_package_id IS NULL
      OR NEW.package_reservation_id IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM package_transactions pt
        WHERE pt.id = NEW.package_reservation_id
          AND pt.salon_id = NEW.salon_id
          AND pt.client_package_id = NEW.client_package_id
          AND pt.booking_id = NEW.booking_id
          AND pt.cart_item_id = NEW.cart_item_id
          AND pt.type = 'reserve'
      )
    THEN RAISE(ABORT, 'core_booking:package_reservation_missing')
  END;
END;
