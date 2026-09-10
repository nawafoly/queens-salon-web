CREATE INDEX IF NOT EXISTS idx_staff_services_salon_service_active_staff
  ON staff_services(salon_id, service_id, active, staff_id);

CREATE INDEX IF NOT EXISTS idx_app_users_salon_firebase_uid
  ON app_users(salon_id, firebase_uid)
  WHERE firebase_uid IS NOT NULL AND TRIM(firebase_uid) <> '';
