-- MALIKAT Core: append-only applied payment correction journal.
-- Schema only. Does not apply corrections or mutate existing money.

CREATE TABLE IF NOT EXISTS payment_correction_applied_events (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  payment_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  booking_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (
    kind IN ('amount_correction', 'method_reclassification')
  ),
  original_amount_halalas INTEGER NOT NULL CHECK (original_amount_halalas > 0),
  corrected_amount_halalas INTEGER NOT NULL CHECK (corrected_amount_halalas > 0),
  amount_delta_halalas INTEGER NOT NULL,
  original_method TEXT NOT NULL CHECK (
    original_method IN ('cash', 'card', 'transfer')
  ),
  corrected_method TEXT NOT NULL CHECK (
    corrected_method IN ('cash', 'card', 'transfer')
  ),
  refunded_snapshot_halalas INTEGER NOT NULL CHECK (refunded_snapshot_halalas >= 0),
  invoice_paid_before_halalas INTEGER NOT NULL CHECK (invoice_paid_before_halalas >= 0),
  invoice_paid_after_halalas INTEGER NOT NULL CHECK (invoice_paid_after_halalas >= 0),
  accounting_date TEXT NOT NULL CHECK (LENGTH(accounting_date) = 10),
  requested_by_uid TEXT NOT NULL,
  approved_by_uid TEXT NOT NULL,
  applied_by_uid TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (LENGTH(TRIM(reason)) >= 8),
  idempotency_key TEXT NOT NULL,
  applied_at TEXT NOT NULL,

  CHECK (
    amount_delta_halalas =
    corrected_amount_halalas - original_amount_halalas
  ),
  CHECK (
    invoice_paid_after_halalas =
    invoice_paid_before_halalas + amount_delta_halalas
  ),
  CHECK (corrected_amount_halalas >= refunded_snapshot_halalas),
  CHECK (approved_by_uid <> requested_by_uid),
  CHECK (
    (
      kind = 'amount_correction'
      AND original_amount_halalas <> corrected_amount_halalas
      AND original_method = corrected_method
    )
    OR
    (
      kind = 'method_reclassification'
      AND original_amount_halalas = corrected_amount_halalas
      AND original_method <> corrected_method
    )
  ),

  UNIQUE (salon_id, id),
  UNIQUE (salon_id, proposal_id),
  UNIQUE (salon_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS payment_correction_applied_postings (
  id TEXT PRIMARY KEY,
  salon_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('cash', 'card', 'transfer')),
  signed_amount_halalas INTEGER NOT NULL CHECK (signed_amount_halalas <> 0),
  accounting_date TEXT NOT NULL CHECK (LENGTH(accounting_date) = 10),
  created_at TEXT NOT NULL,

  UNIQUE (salon_id, event_id, channel),

  FOREIGN KEY (salon_id, event_id)
    REFERENCES payment_correction_applied_events (salon_id, id)
);

CREATE INDEX IF NOT EXISTS idx_payment_correction_applied_events_payment
  ON payment_correction_applied_events (salon_id, payment_id, applied_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_correction_applied_events_booking
  ON payment_correction_applied_events (salon_id, booking_id, applied_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_correction_applied_postings_date
  ON payment_correction_applied_postings (salon_id, accounting_date, channel);

CREATE TRIGGER IF NOT EXISTS trg_payment_correction_applied_events_immutable_update
BEFORE UPDATE ON payment_correction_applied_events
BEGIN
  SELECT RAISE(ABORT, 'payment_correction_applied_events_are_immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_payment_correction_applied_events_immutable_delete
BEFORE DELETE ON payment_correction_applied_events
BEGIN
  SELECT RAISE(ABORT, 'payment_correction_applied_events_are_immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_payment_correction_applied_postings_immutable_update
BEFORE UPDATE ON payment_correction_applied_postings
BEGIN
  SELECT RAISE(ABORT, 'payment_correction_applied_postings_are_immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_payment_correction_applied_postings_immutable_delete
BEFORE DELETE ON payment_correction_applied_postings
BEGIN
  SELECT RAISE(ABORT, 'payment_correction_applied_postings_are_immutable');
END;