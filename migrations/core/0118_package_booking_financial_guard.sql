-- Protect newly created package-covered booking items.
-- Existing historical rows are not rewritten.
-- CORE D1 ONLY.

CREATE TRIGGER trg_booking_item_package_financial_insert
BEFORE INSERT ON booking_items
WHEN NEW.package_covered = 1
BEGIN
    SELECT CASE
        WHEN NEW.quantity IS NULL
          OR NEW.quantity <> 1
        THEN RAISE(ABORT, 'core_booking:package_quantity_invalid')
    END;

    SELECT CASE
        WHEN NEW.unit_price_halalas IS NULL
          OR NEW.unit_price_halalas <> 0
          OR NEW.total_halalas IS NULL
          OR NEW.total_halalas <> 0
          OR NEW.final_total_halalas IS NULL
          OR NEW.final_total_halalas <> 0
        THEN RAISE(ABORT, 'core_booking:package_financial_coverage_invalid')
    END;
END;

CREATE TRIGGER trg_booking_item_package_financial_update
BEFORE UPDATE OF
    package_covered,
    quantity,
    unit_price_halalas,
    total_halalas,
    final_total_halalas
ON booking_items
WHEN NEW.package_covered = 1
 AND (
     NEW.package_covered IS NOT OLD.package_covered
     OR NEW.quantity IS NOT OLD.quantity
     OR NEW.unit_price_halalas IS NOT OLD.unit_price_halalas
     OR NEW.total_halalas IS NOT OLD.total_halalas
     OR NEW.final_total_halalas IS NOT OLD.final_total_halalas
 )
BEGIN
    SELECT CASE
        WHEN NEW.quantity IS NULL
          OR NEW.quantity <> 1
        THEN RAISE(ABORT, 'core_booking:package_quantity_invalid')
    END;

    SELECT CASE
        WHEN NEW.unit_price_halalas IS NULL
          OR NEW.unit_price_halalas <> 0
          OR NEW.total_halalas IS NULL
          OR NEW.total_halalas <> 0
          OR NEW.final_total_halalas IS NULL
          OR NEW.final_total_halalas <> 0
        THEN RAISE(ABORT, 'core_booking:package_financial_coverage_invalid')
    END;
END;
