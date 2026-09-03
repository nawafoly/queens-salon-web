-- D1 read-scope indexes for date-scoped finance surfaces.
CREATE INDEX IF NOT EXISTS idx_core_income_booking_occurred
  ON income_entries(salon_id, booking_id, occurred_at);

CREATE INDEX IF NOT EXISTS idx_core_refunds_refunded
  ON refunds(salon_id, refunded_at);
