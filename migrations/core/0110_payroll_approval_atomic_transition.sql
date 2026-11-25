-- Transaction assertion for canonical payroll approval.
-- A failed assertion aborts the enclosing D1 batch.
-- Successful assertions are removed within the same transaction.

CREATE TABLE payroll_approval_transaction_guards (
  id TEXT PRIMARY KEY NOT NULL,
  salon_id TEXT NOT NULL,
  payroll_entry_id TEXT NOT NULL,
  transition_matches INTEGER NOT NULL
    CHECK (transition_matches = 1)
);
