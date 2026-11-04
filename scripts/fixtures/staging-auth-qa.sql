-- SYNTHETIC AUTH ONLY: MALIKAT Staging Tests 2026 / malikat-staging-core.
-- This contains no passwords and must never execute against production.
-- Firebase Auth UID belongs solely to malikat-staging-tests-2026.

INSERT OR IGNORE INTO employee_profiles
  (id, salon_id, firebase_uid, name, email, status, created_at, updated_at)
VALUES
  ('staging-employee-one', 'staging', 'zMfFxo9anAVLR4PxAooe2esiWkK2',
   'موظفة اختبار — أ', 'qa-inventory-pr286@malikat.test', 'active',
   '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z');

UPDATE staff
  SET firebase_uid = 'zMfFxo9anAVLR4PxAooe2esiWkK2'
WHERE id = 'staging-employee-one' AND salon_id = 'staging'
  AND (firebase_uid IS NULL OR firebase_uid = 'zMfFxo9anAVLR4PxAooe2esiWkK2');

INSERT OR IGNORE INTO app_users
  (id, firebase_uid, salon_id, email, display_name, primary_role, status,
   email_verified, created_at, updated_at)
VALUES
  ('staging-qa-owner', 'zMfFxo9anAVLR4PxAooe2esiWkK2', 'staging',
   'qa-inventory-pr286@malikat.test', 'QA Inventory PR286', 'owner', 'active',
   0, '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z');

INSERT OR IGNORE INTO user_employee_links
  (id, salon_id, user_id, employee_id, link_status, linked_at, updated_at)
VALUES
  ('staging-qa-owner-employee-link', 'staging', 'staging-qa-owner',
   'staging-employee-one', 'active',
   '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:00.000Z');
