-- Cashback expiry terminal-state read model.
-- Ledger remains append-mostly; this table only records that an earn lot has
-- reached a terminal expiry decision so the hourly scan never re-reads it forever.

CREATE TABLE IF NOT EXISTS cashback_expiry_lot_state (
  salon_id TEXT NOT NULL,
  source_transaction_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('consumed', 'expired')),
  expired_halalas INTEGER NOT NULL DEFAULT 0 CHECK (expired_halalas >= 0),
  evaluated_at TEXT NOT NULL,
  PRIMARY KEY (salon_id, source_transaction_id)
);

CREATE INDEX IF NOT EXISTS idx_cashback_expiry_lot_state_client
  ON cashback_expiry_lot_state(salon_id, client_id, evaluated_at DESC);

CREATE INDEX IF NOT EXISTS idx_cashback_wallet_expiry_earn_scan
  ON cashback_wallet_transactions(salon_id, expires_at, id, client_id)
  WHERE type = 'earn' AND expires_at IS NOT NULL;
