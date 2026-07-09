PRAGMA foreign_keys = ON;

CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_members_unique_user_uid
  ON partner_members(user_uid)
  WHERE user_uid IS NOT NULL AND user_uid <> '';

CREATE INDEX IF NOT EXISTS idx_partner_members_email
  ON partner_members(email COLLATE NOCASE)
  WHERE email IS NOT NULL AND email <> '';
