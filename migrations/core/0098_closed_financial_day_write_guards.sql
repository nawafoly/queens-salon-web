-- MALIKAT Core D1: closed financial day is immutable at the SQLite write boundary.
-- Apply AFTER 0094 (closings), 0096 (correction journal) and 0097 (revisions).
-- IMPORTANT: Do not deploy without a production D1 backup, schema inventory,
-- historical closed-day impact review, and a validated rollback/forward plan.
-- Accounting dates are Riyadh local calendar days (UTC+03:00).
-- No user/session bypass is available to ad-hoc SQL writers.

CREATE TRIGGER IF NOT EXISTS trg_fin_day_closed_income_insert
BEFORE INSERT ON income_entries
WHEN EXISTS (
    SELECT 1 FROM day_audit_closings c
    WHERE c.salon_id = NEW.salon_id
      AND c.audit_date = date(NEW.occurred_at, '+3 hours')
  )
BEGIN
  SELECT RAISE(ABORT, 'financial_day_closed');
END;

CREATE TRIGGER IF NOT EXISTS trg_fin_day_closed_income_update
BEFORE UPDATE ON income_entries
WHEN EXISTS (
    SELECT 1 FROM day_audit_closings c
    WHERE c.salon_id = OLD.salon_id
      AND c.audit_date = date(OLD.occurred_at, '+3 hours')
  )
  OR EXISTS (
    SELECT 1 FROM day_audit_closings c
    WHERE c.salon_id = NEW.salon_id
      AND c.audit_date = date(NEW.occurred_at, '+3 hours')
  )
BEGIN
  SELECT RAISE(ABORT, 'financial_day_closed');
END;

CREATE TRIGGER IF NOT EXISTS trg_fin_day_closed_income_delete
BEFORE DELETE ON income_entries
WHEN EXISTS (
    SELECT 1 FROM day_audit_closings c
    WHERE c.salon_id = OLD.salon_id
      AND c.audit_date = date(OLD.occurred_at, '+3 hours')
  )
BEGIN
  SELECT RAISE(ABORT, 'financial_day_closed');
END;

CREATE TRIGGER IF NOT EXISTS trg_fin_day_closed_refund_insert
BEFORE INSERT ON refunds
WHEN EXISTS (
    SELECT 1 FROM day_audit_closings c
    WHERE c.salon_id = NEW.salon_id
      AND c.audit_date = date(COALESCE(NULLIF(TRIM(NEW.refunded_at), ''), NEW.created_at), '+3 hours')
  )
BEGIN
  SELECT RAISE(ABORT, 'financial_day_closed');
END;

CREATE TRIGGER IF NOT EXISTS trg_fin_day_closed_refund_update
BEFORE UPDATE ON refunds
WHEN EXISTS (
    SELECT 1 FROM day_audit_closings c
    WHERE c.salon_id = OLD.salon_id
      AND c.audit_date = date(COALESCE(NULLIF(TRIM(OLD.refunded_at), ''), OLD.created_at), '+3 hours')
  )
  OR EXISTS (
    SELECT 1 FROM day_audit_closings c
    WHERE c.salon_id = NEW.salon_id
      AND c.audit_date = date(COALESCE(NULLIF(TRIM(NEW.refunded_at), ''), NEW.created_at), '+3 hours')
  )
BEGIN
  SELECT RAISE(ABORT, 'financial_day_closed');
END;

CREATE TRIGGER IF NOT EXISTS trg_fin_day_closed_refund_delete
BEFORE DELETE ON refunds
WHEN EXISTS (
    SELECT 1 FROM day_audit_closings c
    WHERE c.salon_id = OLD.salon_id
      AND c.audit_date = date(COALESCE(NULLIF(TRIM(OLD.refunded_at), ''), OLD.created_at), '+3 hours')
  )
BEGIN
  SELECT RAISE(ABORT, 'financial_day_closed');
END;

CREATE TRIGGER IF NOT EXISTS trg_fin_day_closed_expense_insert
BEFORE INSERT ON expense_entries
WHEN EXISTS (
    SELECT 1 FROM day_audit_closings c
    WHERE c.salon_id = NEW.salon_id
      AND c.audit_date = date(NEW.occurred_at, '+3 hours')
  )
BEGIN
  SELECT RAISE(ABORT, 'financial_day_closed');
END;

CREATE TRIGGER IF NOT EXISTS trg_fin_day_closed_expense_update
BEFORE UPDATE ON expense_entries
WHEN EXISTS (
    SELECT 1 FROM day_audit_closings c
    WHERE c.salon_id = OLD.salon_id
      AND c.audit_date = date(OLD.occurred_at, '+3 hours')
  )
  OR EXISTS (
    SELECT 1 FROM day_audit_closings c
    WHERE c.salon_id = NEW.salon_id
      AND c.audit_date = date(NEW.occurred_at, '+3 hours')
  )
BEGIN
  SELECT RAISE(ABORT, 'financial_day_closed');
END;

CREATE TRIGGER IF NOT EXISTS trg_fin_day_closed_expense_delete
BEFORE DELETE ON expense_entries
WHEN EXISTS (
    SELECT 1 FROM day_audit_closings c
    WHERE c.salon_id = OLD.salon_id
      AND c.audit_date = date(OLD.occurred_at, '+3 hours')
  )
BEGIN
  SELECT RAISE(ABORT, 'financial_day_closed');
END;

CREATE TRIGGER IF NOT EXISTS trg_fin_day_closed_payment_insert
BEFORE INSERT ON payments
WHEN EXISTS (
    SELECT 1 FROM day_audit_closings c
    WHERE c.salon_id = NEW.salon_id
      AND LOWER(TRIM(NEW.status)) IN ('paid', 'completed', 'succeeded')
      AND c.audit_date = date(
        COALESCE(NULLIF(TRIM(NEW.paid_at), ''), NEW.created_at), '+3 hours'
      )
  )
  OR EXISTS (
    SELECT 1 FROM income_entries i
    JOIN day_audit_closings c
      ON c.salon_id = i.salon_id
     AND c.audit_date = date(i.occurred_at, '+3 hours')
    WHERE i.salon_id = NEW.salon_id
      AND i.payment_id = NEW.id
  )
BEGIN
  SELECT RAISE(ABORT, 'financial_day_closed');
END;

CREATE TRIGGER IF NOT EXISTS trg_fin_day_closed_payment_update
BEFORE UPDATE ON payments
WHEN EXISTS (
    SELECT 1 FROM day_audit_closings c
    WHERE c.salon_id = OLD.salon_id
      AND LOWER(TRIM(OLD.status)) IN ('paid', 'completed', 'succeeded')
      AND c.audit_date = date(
        COALESCE(NULLIF(TRIM(OLD.paid_at), ''), OLD.created_at), '+3 hours'
      )
  )
  OR EXISTS (
    SELECT 1 FROM income_entries i
    JOIN day_audit_closings c
      ON c.salon_id = i.salon_id
     AND c.audit_date = date(i.occurred_at, '+3 hours')
    WHERE i.salon_id = OLD.salon_id
      AND i.payment_id = OLD.id
  )
  OR EXISTS (
    SELECT 1 FROM day_audit_closings c
    WHERE c.salon_id = NEW.salon_id
      AND LOWER(TRIM(NEW.status)) IN ('paid', 'completed', 'succeeded')
      AND c.audit_date = date(
        COALESCE(NULLIF(TRIM(NEW.paid_at), ''), NEW.created_at), '+3 hours'
      )
  )
  OR EXISTS (
    SELECT 1 FROM income_entries i
    JOIN day_audit_closings c
      ON c.salon_id = i.salon_id
     AND c.audit_date = date(i.occurred_at, '+3 hours')
    WHERE i.salon_id = NEW.salon_id
      AND i.payment_id = NEW.id
  )
BEGIN
  SELECT RAISE(ABORT, 'financial_day_closed');
END;

CREATE TRIGGER IF NOT EXISTS trg_fin_day_closed_payment_delete
BEFORE DELETE ON payments
WHEN EXISTS (
    SELECT 1 FROM day_audit_closings c
    WHERE c.salon_id = OLD.salon_id
      AND LOWER(TRIM(OLD.status)) IN ('paid', 'completed', 'succeeded')
      AND c.audit_date = date(
        COALESCE(NULLIF(TRIM(OLD.paid_at), ''), OLD.created_at), '+3 hours'
      )
  )
  OR EXISTS (
    SELECT 1 FROM income_entries i
    JOIN day_audit_closings c
      ON c.salon_id = i.salon_id
     AND c.audit_date = date(i.occurred_at, '+3 hours')
    WHERE i.salon_id = OLD.salon_id
      AND i.payment_id = OLD.id
  )
BEGIN
  SELECT RAISE(ABORT, 'financial_day_closed');
END;

CREATE TRIGGER IF NOT EXISTS trg_fin_day_closed_correction_event_insert
BEFORE INSERT ON payment_correction_applied_events
WHEN EXISTS (
    SELECT 1 FROM day_audit_closings c
    WHERE c.salon_id = NEW.salon_id
      AND c.audit_date = NEW.accounting_date
  )
BEGIN
  SELECT RAISE(ABORT, 'financial_day_closed');
END;

CREATE TRIGGER IF NOT EXISTS trg_fin_day_closed_correction_posting_insert
BEFORE INSERT ON payment_correction_applied_postings
WHEN EXISTS (
    SELECT 1 FROM day_audit_closings c
    WHERE c.salon_id = NEW.salon_id
      AND c.audit_date = NEW.accounting_date
  )
  OR EXISTS (
    SELECT 1
    FROM payment_correction_applied_events e
    JOIN day_audit_closings c
      ON c.salon_id = e.salon_id
     AND c.audit_date = e.accounting_date
    WHERE e.salon_id = NEW.salon_id
      AND e.id = NEW.event_id
  )
BEGIN
  SELECT RAISE(ABORT, 'financial_day_closed');
END;

CREATE TRIGGER IF NOT EXISTS trg_fin_day_closing_immutable_update
BEFORE UPDATE ON day_audit_closings
WHEN 1
BEGIN
  SELECT RAISE(ABORT, 'financial_day_closing_immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_fin_day_closing_immutable_delete
BEFORE DELETE ON day_audit_closings
WHEN 1
BEGIN
  SELECT RAISE(ABORT, 'financial_day_closing_immutable');
END;

CREATE INDEX IF NOT EXISTS idx_fin_day_income_payment_lookup
ON income_entries (salon_id, payment_id, occurred_at);


-- Prevent a malformed timestamp/date from bypassing the date-key lookup.
-- Income and refunds are already fail-closed by NOT NULL revision inserts in 0097.
CREATE TRIGGER IF NOT EXISTS trg_fin_day_expense_date_valid_insert
BEFORE INSERT ON expense_entries
WHEN date(NEW.occurred_at, '+3 hours') IS NULL
BEGIN
  SELECT RAISE(ABORT, 'financial_invalid_accounting_date');
END;

CREATE TRIGGER IF NOT EXISTS trg_fin_day_expense_date_valid_update
BEFORE UPDATE ON expense_entries
WHEN date(NEW.occurred_at, '+3 hours') IS NULL
BEGIN
  SELECT RAISE(ABORT, 'financial_invalid_accounting_date');
END;

CREATE TRIGGER IF NOT EXISTS trg_fin_day_payment_date_valid_insert
BEFORE INSERT ON payments
WHEN LOWER(TRIM(NEW.status)) IN ('paid', 'completed', 'succeeded')
  AND date(COALESCE(NULLIF(TRIM(NEW.paid_at), ''), NEW.created_at), '+3 hours') IS NULL
BEGIN
  SELECT RAISE(ABORT, 'financial_invalid_accounting_date');
END;

CREATE TRIGGER IF NOT EXISTS trg_fin_day_payment_date_valid_update
BEFORE UPDATE ON payments
WHEN LOWER(TRIM(NEW.status)) IN ('paid', 'completed', 'succeeded')
  AND date(COALESCE(NULLIF(TRIM(NEW.paid_at), ''), NEW.created_at), '+3 hours') IS NULL
BEGIN
  SELECT RAISE(ABORT, 'financial_invalid_accounting_date');
END;

CREATE TRIGGER IF NOT EXISTS trg_fin_day_correction_event_date_valid_insert
BEFORE INSERT ON payment_correction_applied_events
WHEN date(NEW.accounting_date, '+0 days') IS NULL
  OR date(NEW.accounting_date, '+0 days') <> NEW.accounting_date
BEGIN
  SELECT RAISE(ABORT, 'financial_invalid_accounting_date');
END;

CREATE TRIGGER IF NOT EXISTS trg_fin_day_correction_posting_date_valid_insert
BEFORE INSERT ON payment_correction_applied_postings
WHEN date(NEW.accounting_date, '+0 days') IS NULL
  OR date(NEW.accounting_date, '+0 days') <> NEW.accounting_date
BEGIN
  SELECT RAISE(ABORT, 'financial_invalid_accounting_date');
END;
