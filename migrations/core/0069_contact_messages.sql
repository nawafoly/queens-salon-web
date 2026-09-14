CREATE TABLE IF NOT EXISTS contact_messages (
  salon_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  source TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  created_at TEXT NOT NULL,
  read_at TEXT,
  PRIMARY KEY (salon_id, id)
);
CREATE INDEX IF NOT EXISTS idx_contact_messages_salon_created
  ON contact_messages (salon_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_messages_salon_status_created
  ON contact_messages (salon_id, status, created_at DESC);
