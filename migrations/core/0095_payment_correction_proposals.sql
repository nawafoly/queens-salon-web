-- MALIKAT Core, phase 4b (proposal only; NO settlement side effects).
-- A proposal records intent with the exact original payment snapshot.
-- The authoritative payment, income, invoice, refund and cashback ledgers
-- remain unchanged until a separate, reviewed correction APPLY operation exists.
-- No UPDATE/DELETE API may ever be introduced for these immutable proposals.
CREATE TABLE IF NOT EXISTS payment_correction_proposals (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  booking_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  payment_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('amount_correction', 'method_reclassification')),
  original_amount_halalas INTEGER NOT NULL CHECK (original_amount_halalas > 0),
  proposed_amount_halalas INTEGER NOT NULL CHECK (proposed_amount_halalas > 0),
  original_method TEXT NOT NULL,
  proposed_method TEXT NOT NULL,
  completed_refund_halalas INTEGER NOT NULL DEFAULT 0 CHECK (completed_refund_halalas >= 0),
  reason TEXT NOT NULL CHECK (LENGTH(TRIM(reason)) >= 8),
  idempotency_key TEXT NOT NULL,
  intent_fingerprint TEXT NOT NULL,
  actor_uid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status = 'proposed'),
  CHECK (
    (kind = 'amount_correction' AND original_amount_halalas <> proposed_amount_halalas
      AND original_method = proposed_method)
    OR
    (kind = 'method_reclassification' AND original_amount_halalas = proposed_amount_halalas
      AND original_method <> proposed_method)
  ),
  CHECK (proposed_amount_halalas >= completed_refund_halalas),
  UNIQUE (salon_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_payment_correction_proposals_payment
  ON payment_correction_proposals(salon_id, payment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payment_correction_proposals_booking
  ON payment_correction_proposals(salon_id, booking_id, created_at DESC);
