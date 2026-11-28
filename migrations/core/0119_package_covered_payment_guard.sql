-- CORE D1 ONLY.
-- Prevent new collections against zero-total package-covered bookings.
-- Preserve historical financial records and legitimate ordinary overpayments.

CREATE TRIGGER trg_payment_package_covered_zero_total
BEFORE INSERT ON payments
WHEN NEW.amount_halalas > 0
 AND LOWER(TRIM(NEW.status)) IN ('paid', 'completed', 'succeeded')
 AND EXISTS (
    SELECT 1
    FROM bookings AS b
    WHERE b.salon_id = NEW.salon_id
      AND b.total_halalas = 0
      AND (
          b.id = NEW.booking_id
          OR EXISTS (
              SELECT 1
              FROM invoices AS i
              WHERE i.salon_id = NEW.salon_id
                AND i.id = NEW.invoice_id
                AND i.booking_id = b.id
          )
      )
      AND EXISTS (
          SELECT 1
          FROM booking_items AS bi
          WHERE bi.salon_id = b.salon_id
            AND bi.booking_id = b.id
            AND bi.package_covered = 1
      )
 )
BEGIN
    SELECT RAISE(ABORT, 'core_payment:package_covered_no_collection');
END;
