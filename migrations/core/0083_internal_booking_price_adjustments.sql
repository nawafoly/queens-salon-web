-- Internal booking pricing separation.
-- Catalog price remains the service master price.
-- unit_price_halalas remains the agreed booking-item price before discounts.
-- Price adjustment metadata is internal/auditable and must not be shown to clients.

ALTER TABLE booking_items
  ADD COLUMN catalog_unit_price_halalas INTEGER;

UPDATE booking_items
   SET catalog_unit_price_halalas = unit_price_halalas
 WHERE catalog_unit_price_halalas IS NULL;

ALTER TABLE booking_items
  ADD COLUMN price_adjustment_reason TEXT
  CHECK (
    price_adjustment_reason IS NULL OR
    price_adjustment_reason IN (
      'catalog_pending_update',
      'management_approved',
      'special_price',
      'other'
    )
  );

ALTER TABLE booking_items
  ADD COLUMN price_adjustment_note TEXT;

ALTER TABLE booking_items
  ADD COLUMN price_adjusted_by_uid TEXT;

ALTER TABLE booking_items
  ADD COLUMN price_adjusted_at TEXT;

INSERT OR IGNORE INTO permissions
  (permission_key, group_key, label, description, sensitive, created_at, updated_at)
VALUES
  (
    'bookings.price.adjust',
    'bookings',
    'Adjust booking item price',
    'Change the agreed price for a single booking item without changing the catalog price.',
    1,
    '2026-09-21T00:00:00.000Z',
    '2026-09-21T00:00:00.000Z'
  ),
  (
    'bookings.discount.apply',
    'bookings',
    'Apply manual booking discount',
    'Apply a manual fixed or percentage discount to a booking.',
    1,
    '2026-09-21T00:00:00.000Z',
    '2026-09-21T00:00:00.000Z'
  );

INSERT OR IGNORE INTO role_permissions
  (salon_id, role_key, permission_key, created_at)
VALUES
  ('main', 'owner', 'bookings.price.adjust', '2026-09-21T00:00:00.000Z'),
  ('main', 'owner', 'bookings.discount.apply', '2026-09-21T00:00:00.000Z'),
  ('main', 'admin', 'bookings.price.adjust', '2026-09-21T00:00:00.000Z'),
  ('main', 'admin', 'bookings.discount.apply', '2026-09-21T00:00:00.000Z'),
  ('main', 'reception', 'bookings.price.adjust', '2026-09-21T00:00:00.000Z'),
  ('main', 'reception', 'bookings.discount.apply', '2026-09-21T00:00:00.000Z');
