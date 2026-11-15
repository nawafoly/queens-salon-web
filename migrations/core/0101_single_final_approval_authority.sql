-- Reusable, salon-scoped single-actor approval authority.
-- Assignment is independent of primary_role=owner; owner status alone is NOT
-- authority to finalize leave requests.
-- No default assignment: administrator must identify and provision the actual
-- account before enabling new Core deployment.
CREATE TABLE IF NOT EXISTS approval_authorities (
  salon_id TEXT NOT NULL,
  authority_key TEXT NOT NULL,
  approver_user_id TEXT NOT NULL,
  assigned_by_user_id TEXT,
  assigned_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (salon_id, authority_key)
);

CREATE INDEX IF NOT EXISTS idx_approval_authorities_approver
  ON approval_authorities (salon_id, approver_user_id);
