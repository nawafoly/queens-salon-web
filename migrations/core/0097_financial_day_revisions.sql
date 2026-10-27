-- MALIKAT Core D1. Schema-only foundation for day-close OCC.
-- IMPORTANT: This migration DOES NOT enable final day-close protection.
-- A subsequent Core change must enforce revisions at the same SQL write boundary
-- for BOTH closing and payment/refund mutations before production deployment.
-- Accounting date for ISO-8601 timestamps is Asia/Riyadh (UTC+03:00).
-- D1/SQLite date(timestamp, '+3 hours') handles UTC offsets before adding 3h.
-- Event accounting_date is taken as stored; canonicalize it in APPLY first.

CREATE TABLE IF NOT EXISTS financial_day_revisions (
  salon_id TEXT NOT NULL,
  audit_date TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  PRIMARY KEY (salon_id, audit_date)
);

CREATE TRIGGER IF NOT EXISTS trg_fin_day_rev_income_insert
AFTER INSERT ON income_entries
BEGIN
  INSERT INTO financial_day_revisions (salon_id, audit_date, revision)
    VALUES (NEW.salon_id, date(NEW.occurred_at, '+3 hours'), 1)
    ON CONFLICT(salon_id, audit_date)
    DO UPDATE SET revision = financial_day_revisions.revision + 1;
END;

CREATE TRIGGER IF NOT EXISTS trg_fin_day_rev_income_update
AFTER UPDATE ON income_entries
BEGIN
  INSERT INTO financial_day_revisions (salon_id, audit_date, revision)
    VALUES (OLD.salon_id, date(OLD.occurred_at, '+3 hours'), 1)
    ON CONFLICT(salon_id, audit_date)
    DO UPDATE SET revision = financial_day_revisions.revision + 1;
  INSERT INTO financial_day_revisions (salon_id, audit_date, revision)
    VALUES (NEW.salon_id, date(NEW.occurred_at, '+3 hours'), 1)
    ON CONFLICT(salon_id, audit_date)
    DO UPDATE SET revision = financial_day_revisions.revision + 1;
END;

CREATE TRIGGER IF NOT EXISTS trg_fin_day_rev_income_delete
AFTER DELETE ON income_entries
BEGIN
  INSERT INTO financial_day_revisions (salon_id, audit_date, revision)
    VALUES (OLD.salon_id, date(OLD.occurred_at, '+3 hours'), 1)
    ON CONFLICT(salon_id, audit_date)
    DO UPDATE SET revision = financial_day_revisions.revision + 1;
END;

CREATE TRIGGER IF NOT EXISTS trg_fin_day_rev_refund_insert
AFTER INSERT ON refunds
BEGIN
  INSERT INTO financial_day_revisions (salon_id, audit_date, revision)
    VALUES (NEW.salon_id, date(COALESCE(NULLIF(TRIM(NEW.refunded_at), ''), NEW.created_at), '+3 hours'), 1)
    ON CONFLICT(salon_id, audit_date)
    DO UPDATE SET revision = financial_day_revisions.revision + 1;
END;

CREATE TRIGGER IF NOT EXISTS trg_fin_day_rev_refund_update
AFTER UPDATE ON refunds
BEGIN
  INSERT INTO financial_day_revisions (salon_id, audit_date, revision)
    VALUES (OLD.salon_id, date(COALESCE(NULLIF(TRIM(OLD.refunded_at), ''), OLD.created_at), '+3 hours'), 1)
    ON CONFLICT(salon_id, audit_date)
    DO UPDATE SET revision = financial_day_revisions.revision + 1;
  INSERT INTO financial_day_revisions (salon_id, audit_date, revision)
    VALUES (NEW.salon_id, date(COALESCE(NULLIF(TRIM(NEW.refunded_at), ''), NEW.created_at), '+3 hours'), 1)
    ON CONFLICT(salon_id, audit_date)
    DO UPDATE SET revision = financial_day_revisions.revision + 1;
END;

CREATE TRIGGER IF NOT EXISTS trg_fin_day_rev_refund_delete
AFTER DELETE ON refunds
BEGIN
  INSERT INTO financial_day_revisions (salon_id, audit_date, revision)
    VALUES (OLD.salon_id, date(COALESCE(NULLIF(TRIM(OLD.refunded_at), ''), OLD.created_at), '+3 hours'), 1)
    ON CONFLICT(salon_id, audit_date)
    DO UPDATE SET revision = financial_day_revisions.revision + 1;
END;

CREATE TRIGGER IF NOT EXISTS trg_fin_day_rev_correction_insert
AFTER INSERT ON payment_correction_applied_events
BEGIN
  INSERT INTO financial_day_revisions (salon_id, audit_date, revision)
    VALUES (NEW.salon_id, NEW.accounting_date, 1)
    ON CONFLICT(salon_id, audit_date)
    DO UPDATE SET revision = financial_day_revisions.revision + 1;
END;

CREATE TRIGGER IF NOT EXISTS trg_fin_day_rev_correction_update
AFTER UPDATE ON payment_correction_applied_events
BEGIN
  INSERT INTO financial_day_revisions (salon_id, audit_date, revision)
    VALUES (OLD.salon_id, OLD.accounting_date, 1)
    ON CONFLICT(salon_id, audit_date)
    DO UPDATE SET revision = financial_day_revisions.revision + 1;
  INSERT INTO financial_day_revisions (salon_id, audit_date, revision)
    VALUES (NEW.salon_id, NEW.accounting_date, 1)
    ON CONFLICT(salon_id, audit_date)
    DO UPDATE SET revision = financial_day_revisions.revision + 1;
END;

CREATE TRIGGER IF NOT EXISTS trg_fin_day_rev_correction_delete
AFTER DELETE ON payment_correction_applied_events
BEGIN
  INSERT INTO financial_day_revisions (salon_id, audit_date, revision)
    VALUES (OLD.salon_id, OLD.accounting_date, 1)
    ON CONFLICT(salon_id, audit_date)
    DO UPDATE SET revision = financial_day_revisions.revision + 1;
END;
