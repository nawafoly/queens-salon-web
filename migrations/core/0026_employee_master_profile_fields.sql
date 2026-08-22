-- Stage 4A.1: canonical employee master profile fields.
-- CORE D1 ONLY. No Firestore fallback.

ALTER TABLE employee_profiles ADD COLUMN avatar_url TEXT;
ALTER TABLE employee_profiles ADD COLUMN bio TEXT;
ALTER TABLE employee_profiles ADD COLUMN cv_url TEXT;
ALTER TABLE employee_profiles ADD COLUMN show_on_about INTEGER NOT NULL DEFAULT 1;
ALTER TABLE employee_profiles ADD COLUMN include_in_employee_management INTEGER NOT NULL DEFAULT 1;
ALTER TABLE employee_profiles ADD COLUMN rating REAL NOT NULL DEFAULT 0;
ALTER TABLE employee_profiles ADD COLUMN reviews_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE employee_employment ADD COLUMN end_date TEXT;
