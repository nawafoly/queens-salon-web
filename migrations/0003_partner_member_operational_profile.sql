PRAGMA foreign_keys = ON;

ALTER TABLE partner_members
  ADD COLUMN operational_profile_json TEXT NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_partner_members_employee_id
  ON partner_members(salon_id, employee_id)
  WHERE employee_id IS NOT NULL AND employee_id <> '';
