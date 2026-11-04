-- SYNTHETIC DATA ONLY: malikat-staging-core (3ffae051-12d6-4cce-a992-5e39245b80a3).
-- NEVER execute against queens-salon-core or any production database.
-- Idempotent fixture; it does not overwrite subsequent staging changes.

-- Legacy schema migrations bootstrap role grants for 'main'. In this isolated
-- database, copy role definitions to the staging tenant after all migrations.
INSERT OR IGNORE INTO roles
  (id, salon_id, role_key, label, rank, protected, assignable, created_at, updated_at)
SELECT 'staging_role_' || role_key, 'staging', role_key, label, rank, protected,
       assignable, '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z'
FROM roles WHERE salon_id = 'main';

INSERT OR IGNORE INTO role_permissions
  (salon_id, role_key, permission_key, created_at)
SELECT 'staging', role_key, permission_key, '2026-11-04T00:00:00.000Z'
FROM role_permissions WHERE salon_id = 'main';

INSERT OR IGNORE INTO service_categories
  (id, salon_id, name, active, sort_order, created_at, updated_at)
VALUES ('staging-svc-color', 'staging', 'خدمات صبغة تجريبية', 1, 1,
        '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z');

INSERT OR IGNORE INTO services
  (id, salon_id, name, category_id, duration_minutes, price_halalas,
   active, created_at, updated_at)
VALUES ('staging-service-color', 'staging', 'صبغة شعر — اختبار فقط',
        'staging-svc-color', 90, 25000, 1,
        '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z');

INSERT OR IGNORE INTO staff
  (id, salon_id, name, active, employment_status, created_at, updated_at)
VALUES
  ('staging-employee-one', 'staging', 'موظفة اختبار — أ', 1, 'active',
   '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z'),
  ('staging-employee-two', 'staging', 'موظفة اختبار — ب', 1, 'active',
   '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z');

INSERT OR IGNORE INTO staff_services (salon_id, staff_id, service_id)
VALUES ('staging', 'staging-employee-one', 'staging-service-color');

INSERT OR IGNORE INTO clients
  (id, salon_id, name, status, created_at, updated_at)
VALUES ('staging-client-one', 'staging', 'عميلة اختبار وهمية', 'active',
        '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z');

INSERT OR IGNORE INTO bookings
  (id, salon_id, client_id, staff_id, booking_date, start_time, end_time,
   status, source, subtotal_halalas, total_halalas, payment_status,
   created_at, updated_at, completed_at)
VALUES ('staging-booking-one', 'staging', 'staging-client-one',
        'staging-employee-one', '2026-11-04', '13:00', '14:30', 'completed',
        'internal', 25000, 25000, 'paid', '2026-11-04T10:00:00.000Z',
        '2026-11-04T11:30:00.000Z', '2026-11-04T11:30:00.000Z');

INSERT OR IGNORE INTO booking_items
  (id, booking_id, salon_id, service_id, service_name_snapshot, staff_id,
   quantity, unit_price_halalas, total_halalas, duration_minutes, created_at)
VALUES ('staging-booking-item-one', 'staging-booking-one', 'staging',
        'staging-service-color', 'صبغة شعر — اختبار فقط',
        'staging-employee-one', 1, 25000, 25000, 90,
        '2026-11-04T10:00:00.000Z');

INSERT OR IGNORE INTO inventory_categories
  (id, salon_id, name, created_at, updated_at)
VALUES
  ('staging-cat-color', 'staging', 'صبغات تجريبية', '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z'),
  ('staging-cat-hair', 'staging', 'عناية بالشعر — اختبار', '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z'),
  ('staging-cat-tools', 'staging', 'مستلزمات تشغيل — اختبار', '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z');

INSERT OR IGNORE INTO inventory_items
  (id, salon_id, category_id, name, sku, unit, consumption_policy,
   min_stock_qty, created_at, updated_at)
VALUES
  ('staging-item-shampoo', 'staging', 'staging-cat-hair', 'شامبو احترافي (وهمي)', 'STG-SHAMP', 'ml', 'SERVICE_TRACKED', 500, '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z'),
  ('staging-item-color-a', 'staging', 'staging-cat-color', 'صبغة A (وهمية)', 'STG-COLA', 'ml', 'SERVICE_TRACKED', 200, '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z'),
  ('staging-item-color-b', 'staging', 'staging-cat-color', 'صبغة B (وهمية)', 'STG-COLB', 'ml', 'SERVICE_TRACKED', 200, '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z'),
  ('staging-item-oxidant', 'staging', 'staging-cat-color', 'أوكسجين (وهمي)', 'STG-OX', 'ml', 'SERVICE_TRACKED', 500, '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z'),
  ('staging-item-gloves', 'staging', 'staging-cat-tools', 'قفازات (وهمية)', 'STG-GLOVE', 'pair', 'EMPLOYEE_ISSUED', 15, '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z'),
  ('staging-item-cleaner', 'staging', 'staging-cat-tools', 'منظف عام (وهمي)', 'STG-CLEAN', 'ml', 'SHARED_OPERATIONAL', 500, '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z'),
  ('staging-item-sale', 'staging', 'staging-cat-hair', 'منتج بيع مباشر (وهمي)', 'STG-SALE', 'piece', 'DIRECT_SALE', 5, '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z'),
  ('staging-item-no-cost', 'staging', 'staging-cat-color', 'مادة بلا تكلفة موثوقة (وهمية)', 'STG-NOCOST', 'ml', 'SERVICE_TRACKED', 10, '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z');

INSERT OR IGNORE INTO inventory_locations
  (id, salon_id, name, is_default, created_at, updated_at)
VALUES
  ('staging-loc-main', 'staging', 'مستودع رئيسي — تجريبي', 1, '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z'),
  ('staging-loc-stylist', 'staging', 'عهدة موظفة — تجريبية', 0, '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z');

INSERT OR IGNORE INTO inventory_staff_locations
  (salon_id, employee_id, location_id, updated_at)
VALUES ('staging', 'staging-employee-one', 'staging-loc-stylist',
        '2026-11-04T00:00:00.000Z');

INSERT OR IGNORE INTO service_consumption_recipes
  (id, salon_id, service_id, created_at, updated_at)
VALUES ('staging-recipe-color', 'staging', 'staging-service-color',
        '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z');

INSERT OR IGNORE INTO service_consumption_recipe_lines
  (id, salon_id, recipe_id, line_type, inventory_item_id, category_id,
   default_qty, unit, sort_order, created_at)
VALUES
  ('staging-recipe-line-color', 'staging', 'staging-recipe-color', 'CATEGORY', NULL, 'staging-cat-color', 75, 'ml', 1, '2026-11-04T00:00:00.000Z'),
  ('staging-recipe-line-ox', 'staging', 'staging-recipe-color', 'SPECIFIC_ITEM', 'staging-item-oxidant', NULL, 30, 'ml', 2, '2026-11-04T00:00:00.000Z');

-- Exactly eight opening balances, including an unknown-cost material.
WITH opening(item_id, location_id, quantity, unit, cost) AS (
  VALUES
    ('staging-item-shampoo', 'staging-loc-main', 5000, 'ml', 20),
    ('staging-item-color-a', 'staging-loc-stylist', 1200, 'ml', 65),
    ('staging-item-color-b', 'staging-loc-stylist', 1100, 'ml', 55),
    ('staging-item-oxidant', 'staging-loc-stylist', 4000, 'ml', 12),
    ('staging-item-gloves', 'staging-loc-main', 100, 'pair', 100),
    ('staging-item-cleaner', 'staging-loc-main', 8000, 'ml', 4),
    ('staging-item-sale', 'staging-loc-main', 30, 'piece', 3500),
    ('staging-item-no-cost', 'staging-loc-stylist', 100, 'ml', NULL)
)
INSERT OR IGNORE INTO inventory_stock_movements
  (id, salon_id, item_id, location_id, movement_type, quantity_delta, unit,
   unit_cost_halalas, balance_after, source_type, source_id, line_key,
   note, created_at)
SELECT 'staging-open-' || item_id, 'staging', item_id, location_id,
       'OPENING_BALANCE_IN', quantity, unit, cost, quantity,
       'opening_balance', 'staging-open-' || item_id, '0',
       'رصيد افتتاحي وهمي للاختبارات فقط', '2026-11-04T09:00:00.000Z'
FROM opening;

-- 75ml CATEGORY recipe split over two distinct dye items (40 + 35).
INSERT OR IGNORE INTO service_consumptions
  (id, salon_id, booking_id, booking_item_id, service_id, employee_id,
   location_id, status, total_material_cost_halalas, confirmed_at, created_at)
VALUES ('staging-consumption-one', 'staging', 'staging-booking-one',
        'staging-booking-item-one', 'staging-service-color',
        'staging-employee-one', 'staging-loc-stylist', 'confirmed', 4885,
        '2026-11-04T11:30:00.000Z', '2026-11-04T11:30:00.000Z');

INSERT OR IGNORE INTO inventory_stock_movements
  (id, salon_id, item_id, location_id, movement_type, quantity_delta, unit,
   unit_cost_halalas, balance_after, source_type, source_id, line_key,
   employee_id, booking_id, booking_item_id, service_id, note, created_at)
VALUES
  ('staging-cons-move-a', 'staging', 'staging-item-color-a', 'staging-loc-stylist', 'SERVICE_CONSUMPTION_OUT', -40, 'ml', 65, 1160, 'service_consumption', 'staging-consumption-one', 'a', 'staging-employee-one', 'staging-booking-one', 'staging-booking-item-one', 'staging-service-color', 'خلط تجريبي أ', '2026-11-04T11:30:00.000Z'),
  ('staging-cons-move-b', 'staging', 'staging-item-color-b', 'staging-loc-stylist', 'SERVICE_CONSUMPTION_OUT', -35, 'ml', 55, 1065, 'service_consumption', 'staging-consumption-one', 'b', 'staging-employee-one', 'staging-booking-one', 'staging-booking-item-one', 'staging-service-color', 'خلط تجريبي ب', '2026-11-04T11:30:00.000Z'),
  ('staging-cons-move-ox', 'staging', 'staging-item-oxidant', 'staging-loc-stylist', 'SERVICE_CONSUMPTION_OUT', -30, 'ml', 12, 3970, 'service_consumption', 'staging-consumption-one', 'ox', 'staging-employee-one', 'staging-booking-one', 'staging-booking-item-one', 'staging-service-color', 'أوكسجين تجريبي', '2026-11-04T11:30:00.000Z'),
  ('staging-cons-move-no-cost', 'staging', 'staging-item-no-cost', 'staging-loc-stylist', 'SERVICE_CONSUMPTION_OUT', -5, 'ml', NULL, 95, 'service_consumption', 'staging-consumption-one', 'unknown', 'staging-employee-one', 'staging-booking-one', 'staging-booking-item-one', 'staging-service-color', 'سعر غير موثوق — اختبار التقرير', '2026-11-04T11:30:00.000Z');

INSERT OR IGNORE INTO service_consumption_lines
  (id, salon_id, consumption_id, recipe_line_id, inventory_item_id, quantity,
   unit, unit_cost_halalas, line_cost_halalas, stock_movement_id, created_at)
VALUES
  ('staging-cons-line-a', 'staging', 'staging-consumption-one', 'staging-recipe-line-color', 'staging-item-color-a', 40, 'ml', 65, 2600, 'staging-cons-move-a', '2026-11-04T11:30:00.000Z'),
  ('staging-cons-line-b', 'staging', 'staging-consumption-one', 'staging-recipe-line-color', 'staging-item-color-b', 35, 'ml', 55, 1925, 'staging-cons-move-b', '2026-11-04T11:30:00.000Z'),
  ('staging-cons-line-ox', 'staging', 'staging-consumption-one', 'staging-recipe-line-ox', 'staging-item-oxidant', 30, 'ml', 12, 360, 'staging-cons-move-ox', '2026-11-04T11:30:00.000Z'),
  ('staging-cons-line-unknown', 'staging', 'staging-consumption-one', NULL, 'staging-item-no-cost', 5, 'ml', NULL, 0, 'staging-cons-move-no-cost', '2026-11-04T11:30:00.000Z');

-- Different disposal reasons — never conflate them in the Ledger.
INSERT OR IGNORE INTO inventory_stock_movements
  (id, salon_id, item_id, location_id, movement_type, quantity_delta, unit,
   unit_cost_halalas, balance_after, source_type, source_id, line_key,
   note, created_at)
VALUES
  ('staging-waste-one', 'staging', 'staging-item-shampoo', 'staging-loc-main', 'WASTE_OUT', -50, 'ml', 20, 4950, 'WASTE', 'staging-disposal-waste', 'staging-item-shampoo', 'هدر تجريبي', '2026-11-04T12:00:00.000Z'),
  ('staging-damaged-one', 'staging', 'staging-item-gloves', 'staging-loc-main', 'DAMAGED_OUT', -5, 'pair', 100, 95, 'WASTE', 'staging-disposal-damaged', 'staging-item-gloves', 'تالف تجريبي', '2026-11-04T12:01:00.000Z'),
  ('staging-expired-one', 'staging', 'staging-item-color-b', 'staging-loc-stylist', 'EXPIRED_OUT', -10, 'ml', 55, 1055, 'WASTE', 'staging-disposal-expired', 'staging-item-color-b', 'منتهي تجريبي', '2026-11-04T12:02:00.000Z');

-- Materialized stock levels reflect ALL opening, consumption and disposal movements.
WITH final(item_id, location_id, quantity) AS (
  VALUES
    ('staging-item-shampoo', 'staging-loc-main', 4950),
    ('staging-item-color-a', 'staging-loc-stylist', 1160),
    ('staging-item-color-b', 'staging-loc-stylist', 1055),
    ('staging-item-oxidant', 'staging-loc-stylist', 3970),
    ('staging-item-gloves', 'staging-loc-main', 95),
    ('staging-item-cleaner', 'staging-loc-main', 8000),
    ('staging-item-sale', 'staging-loc-main', 30),
    ('staging-item-no-cost', 'staging-loc-stylist', 95)
)
INSERT OR IGNORE INTO inventory_stock_levels
  (id, salon_id, item_id, location_id, qty_on_hand, updated_at)
SELECT 'staging-level-' || item_id, 'staging', item_id, location_id,
       quantity, '2026-11-04T12:05:00.000Z' FROM final;
