CREATE TABLE IF NOT EXISTS core_idempotency_operations (
  salon_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'completed')),
  response_status INTEGER
    CHECK (
      response_status IS NULL OR
      (response_status >= 100 AND response_status <= 599)
    ),
  response_body TEXT,
  first_request_id TEXT NOT NULL,
  last_request_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (salon_id, operation_id)
);

CREATE INDEX IF NOT EXISTS idx_core_idempotency_state_created
  ON core_idempotency_operations(salon_id, state, created_at);
