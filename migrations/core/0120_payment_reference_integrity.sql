-- CORE D1 ONLY.
-- Enforce consistent references for newly inserted payments.
-- Preserve historical records and standalone package invoices.

CREATE TRIGGER trg_payment_reference_integrity_insert
BEFORE INSERT ON payments
BEGIN
    SELECT CASE
        WHEN NEW.invoice_id IS NOT NULL
         AND NOT EXISTS (
            SELECT 1
            FROM invoices AS i
            WHERE i.salon_id = NEW.salon_id
              AND i.id = NEW.invoice_id
              AND (
                  NEW.booking_id IS NULL
                  OR NEW.booking_id IS i.booking_id
              )
              AND (
                  NEW.client_id IS NULL
                  OR NEW.client_id IS i.client_id
              )
         )
        THEN RAISE(ABORT, 'core_payment:reference_conflict')
    END;

    SELECT CASE
        WHEN NEW.booking_id IS NOT NULL
         AND NOT EXISTS (
            SELECT 1
            FROM bookings AS b
            WHERE b.salon_id = NEW.salon_id
              AND b.id = NEW.booking_id
              AND (
                  NEW.client_id IS NULL
                  OR NEW.client_id IS b.client_id
              )
         )
        THEN RAISE(ABORT, 'core_payment:reference_conflict')
    END;

    SELECT CASE
        WHEN NEW.client_id IS NOT NULL
         AND NOT EXISTS (
            SELECT 1
            FROM clients AS c
            WHERE c.salon_id = NEW.salon_id
              AND c.id = NEW.client_id
         )
        THEN RAISE(ABORT, 'core_payment:reference_conflict')
    END;
END;

-- Prevent direct mutation of an established payment's identity.
-- Financial corrections must use dedicated audited workflows.

CREATE TRIGGER trg_payment_reference_identity_immutable
BEFORE UPDATE OF
    id,
    salon_id,
    invoice_id,
    booking_id,
    client_id
ON payments
WHEN NEW.id IS NOT OLD.id
  OR NEW.salon_id IS NOT OLD.salon_id
  OR NEW.invoice_id IS NOT OLD.invoice_id
  OR NEW.booking_id IS NOT OLD.booking_id
  OR NEW.client_id IS NOT OLD.client_id
BEGIN
    SELECT RAISE(ABORT, 'core_payment:reference_immutable');
END;

-- Extend the package collection barrier to payment updates.

CREATE TRIGGER trg_payment_package_covered_zero_total_update
BEFORE UPDATE OF
    amount_halalas,
    status
ON payments
WHEN NEW.amount_halalas > 0
 AND LOWER(TRIM(NEW.status)) IN ('paid', 'completed', 'succeeded')
 AND (
     NEW.amount_halalas IS NOT OLD.amount_halalas
     OR NEW.status IS NOT OLD.status
 )
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
