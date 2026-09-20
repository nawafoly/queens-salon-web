-- MALIKAT client cashback wallet foundation.
-- Monetary store credit only: usable inside MALIKAT, never cash-withdrawable or transferable.

CREATE TABLE IF NOT EXISTS cashback_policies (
  salon_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  earn_basis TEXT NOT NULL DEFAULT 'paid' CHECK (earn_basis IN ('paid')),
  earn_bps INTEGER NOT NULL DEFAULT 0 CHECK (earn_bps >= 0 AND earn_bps <= 10000),
  minimum_eligible_halalas INTEGER NOT NULL DEFAULT 0 CHECK (minimum_eligible_halalas >= 0),
  expiry_days INTEGER CHECK (expiry_days IS NULL OR expiry_days > 0),
  redeem_scope TEXT NOT NULL DEFAULT 'salon_only' CHECK (redeem_scope = 'salon_only'),
  cash_withdrawal_allowed INTEGER NOT NULL DEFAULT 0 CHECK (cash_withdrawal_allowed = 0),
  transfer_allowed INTEGER NOT NULL DEFAULT 0 CHECK (transfer_allowed = 0),
  excluded_service_ids_json TEXT NOT NULL DEFAULT '[]',
  excluded_package_ids_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cashback_wallet_transactions (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('earn', 'redeem', 'reverse', 'expire', 'adjustment')),
  amount_halalas INTEGER NOT NULL CHECK (amount_halalas <> 0),
  booking_id TEXT,
  refund_id TEXT,
  source_transaction_id TEXT,
  reason TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  expires_at TEXT,
  created_by_uid TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cashback_wallet_idempotency
  ON cashback_wallet_transactions(salon_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_cashback_wallet_client_created
  ON cashback_wallet_transactions(salon_id, client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cashback_wallet_booking
  ON cashback_wallet_transactions(salon_id, booking_id);

CREATE INDEX IF NOT EXISTS idx_cashback_wallet_expiry
  ON cashback_wallet_transactions(salon_id, expires_at)
  WHERE expires_at IS NOT NULL;
