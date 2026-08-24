-- Stage 10D: canonical internal account profile photo URL.
-- Source-only until Stage 10E remote schema readiness.
ALTER TABLE app_users ADD COLUMN photo_url TEXT;
