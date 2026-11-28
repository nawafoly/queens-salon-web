-- Guard new package-backed booking items at transaction commit.
-- Historical records are not modified.

CREATE TRIGGER IF NOT EXISTS trg_booking_item_live_package_guard_v2
BEFORE INSERT ON booking_items
WHEN NEW.package_covered = 1
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM package_transactions pt
    JOIN client_packages cp
      ON cp.id = pt.client_package_id
     AND cp.salon_id = pt.salon_id
     AND cp.canonical_client_id = pt.canonical_client_id
    JOIN bookings b
      ON b.id = NEW.booking_id
     AND b.salon_id = NEW.salon_id
    WHERE pt.id = NEW.package_reservation_id
      AND b.client_id = pt.canonical_client_id
      AND pt.salon_id = NEW.salon_id
      AND pt.client_package_id = NEW.client_package_id
      AND pt.booking_id = NEW.booking_id
      AND pt.cart_item_id = NEW.cart_item_id
      AND pt.service_id = NEW.service_id
      AND pt.type = 'reserve'
      AND cp.status = 'active'
      AND cp.reserved_sessions > 0
      AND (
        cp.expires_at IS NULL
        OR (
          julianday(cp.expires_at) IS NOT NULL
          AND julianday(cp.expires_at) > julianday('now')
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM package_transactions other
        WHERE other.salon_id = pt.salon_id
          AND other.client_package_id = pt.client_package_id
          AND other.booking_id = pt.booking_id
          AND (
            other.cart_item_id IS NULL
            OR trim(other.cart_item_id) = ''
            OR (
              other.cart_item_id = pt.cart_item_id
              AND (
                other.canonical_client_id IS NOT pt.canonical_client_id
                OR other.service_id IS NOT pt.service_id
                OR julianday(other.created_at) IS NULL
                OR other.type NOT IN (
                  'reserve','release','consume','restore',
                  'reapply_reserved','reapply_used'
                )
              )
            )
          )
      )
      AND 1 = (
        SELECT COUNT(*)
        FROM package_transactions m
        WHERE m.salon_id = pt.salon_id
          AND m.client_package_id = pt.client_package_id
          AND m.booking_id = pt.booking_id
          AND m.cart_item_id = pt.cart_item_id
          AND m.type IN ('reserve','redeem')
      )
      AND julianday(pt.created_at) = (
        SELECT MIN(julianday(m.created_at))
        FROM package_transactions m
        WHERE m.salon_id = pt.salon_id
          AND m.client_package_id = pt.client_package_id
          AND m.booking_id = pt.booking_id
          AND m.cart_item_id = pt.cart_item_id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM package_transactions m
        WHERE m.salon_id = pt.salon_id
          AND m.client_package_id = pt.client_package_id
          AND m.booking_id = pt.booking_id
          AND m.cart_item_id = pt.cart_item_id
        GROUP BY julianday(m.created_at)
        HAVING COUNT(*) > 1
      )
      AND NOT EXISTS (
        SELECT 1
        FROM (
          SELECT
            m.type,
            m.remaining_after - m.remaining_before AS dr,
            m.reserved_after - m.reserved_before AS ds,
            m.used_after - m.used_before AS du,
            LAG(m.type) OVER (
              ORDER BY julianday(m.created_at), m.id
            ) AS previous_type
          FROM package_transactions m
          WHERE m.salon_id = pt.salon_id
            AND m.client_package_id = pt.client_package_id
            AND m.booking_id = pt.booking_id
            AND m.cart_item_id = pt.cart_item_id
        ) movement
        WHERE CASE
          WHEN type = 'reserve'
            AND previous_type IS NULL
            AND dr = -1 AND ds = 1 AND du = 0 THEN 0
          WHEN type = 'release'
            AND previous_type IN ('reserve','reapply_reserved')
            AND dr = 1 AND ds = -1 AND du = 0 THEN 0
          WHEN type = 'consume'
            AND previous_type IN ('reserve','reapply_reserved')
            AND dr = 0 AND ds = -1 AND du = 1 THEN 0
          WHEN type = 'restore'
            AND previous_type IN ('consume','reapply_used')
            AND dr = 1 AND ds = 0 AND du = -1 THEN 0
          WHEN type = 'reapply_reserved'
            AND previous_type IN ('release','restore')
            AND dr = -1 AND ds = 1 AND du = 0 THEN 0
          WHEN type = 'reapply_used'
            AND previous_type IN ('release','restore')
            AND dr = -1 AND ds = 0 AND du = 1 THEN 0
          ELSE 1
        END = 1
      )
      AND (
        SELECT m.type
        FROM package_transactions m
        WHERE m.salon_id = pt.salon_id
          AND m.client_package_id = pt.client_package_id
          AND m.booking_id = pt.booking_id
          AND m.cart_item_id = pt.cart_item_id
        ORDER BY julianday(m.created_at) DESC, m.id DESC
        LIMIT 1
      ) IN ('reserve','reapply_reserved')
  ) THEN RAISE(
    ABORT,
    'core_booking:package_reservation_missing'
  ) END;

  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM client_packages cp
    WHERE cp.id = NEW.client_package_id
      AND cp.salon_id = NEW.salon_id
      AND CASE
        WHEN json_valid(cp.allowed_service_ids_json) = 0
          THEN 0
        WHEN json_type(cp.allowed_service_ids_json) <> 'array'
          THEN 0
        WHEN EXISTS (
          SELECT 1
          FROM json_each(cp.allowed_service_ids_json)
          WHERE type <> 'text'
             OR trim(value) = ''
        ) THEN 0
        WHEN json_array_length(cp.allowed_service_ids_json) = 0
          THEN 1
        ELSE EXISTS (
          SELECT 1
          FROM json_each(cp.allowed_service_ids_json)
          WHERE type = 'text'
            AND value = NEW.service_id
        )
      END = 1
  ) THEN RAISE(
    ABORT,
    'core_booking:package_reservation_missing'
  ) END;

  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM booking_items bi
    WHERE bi.salon_id = NEW.salon_id
      AND bi.package_reservation_id = NEW.package_reservation_id
  ) THEN RAISE(
    ABORT,
    'core_booking:package_reservation_missing'
  ) END;
END;

-- Package-backed item identity must not be changed by generic edits.
-- Explicit lifecycle operations remain responsible for ledger transitions.

CREATE TRIGGER IF NOT EXISTS trg_booking_item_package_binding_immutable
BEFORE UPDATE ON booking_items
WHEN (
    OLD.package_covered = 1
    OR NEW.package_covered = 1
)
AND (
       NEW.package_covered IS NOT OLD.package_covered
    OR NEW.client_package_id IS NOT OLD.client_package_id
    OR NEW.package_reservation_id IS NOT OLD.package_reservation_id
    OR NEW.cart_item_id IS NOT OLD.cart_item_id
    OR NEW.service_id IS NOT OLD.service_id
    OR NEW.booking_id IS NOT OLD.booking_id
    OR NEW.salon_id IS NOT OLD.salon_id
    OR NEW.quantity IS NOT OLD.quantity
)
BEGIN
    SELECT RAISE(
        ABORT,
        'core_booking:package_binding_change_requires_reconciliation'
    );
END;

CREATE TRIGGER IF NOT EXISTS trg_booking_package_owner_immutable
BEFORE UPDATE ON bookings
WHEN (
       NEW.client_id IS NOT OLD.client_id
    OR NEW.salon_id IS NOT OLD.salon_id
    OR NEW.id IS NOT OLD.id
)
AND EXISTS (
    SELECT 1
    FROM booking_items bi
    WHERE bi.booking_id = OLD.id
      AND bi.salon_id = OLD.salon_id
      AND bi.package_covered = 1
)
BEGIN
    SELECT RAISE(
        ABORT,
        'core_booking:package_binding_change_requires_reconciliation'
    );
END;
