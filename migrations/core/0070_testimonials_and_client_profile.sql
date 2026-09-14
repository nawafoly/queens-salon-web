-- Reachable web cutover: testimonials + client profile fields on clients.
-- Non-destructive / additive only.

CREATE TABLE IF NOT EXISTS testimonials (
  salon_id TEXT NOT NULL,
  id TEXT NOT NULL,
  uid TEXT,
  name TEXT NOT NULL DEFAULT '',
  role_label TEXT NOT NULL DEFAULT 'عميلة',
  image_url TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  rating INTEGER NOT NULL DEFAULT 5,
  vip INTEGER NOT NULL DEFAULT 0,
  approved INTEGER NOT NULL DEFAULT 1,
  hidden INTEGER NOT NULL DEFAULT 0,
  admin_reply TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (salon_id, id)
);

CREATE INDEX IF NOT EXISTS idx_testimonials_salon_created
  ON testimonials (salon_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_testimonials_salon_public
  ON testimonials (salon_id, approved, hidden, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_testimonials_salon_uid
  ON testimonials (salon_id, uid);

ALTER TABLE clients ADD COLUMN city TEXT;
ALTER TABLE clients ADD COLUMN birthdate TEXT;
ALTER TABLE clients ADD COLUMN avatar_url TEXT;
ALTER TABLE clients ADD COLUMN membership_id TEXT;
ALTER TABLE clients ADD COLUMN membership_percent INTEGER NOT NULL DEFAULT 0;
