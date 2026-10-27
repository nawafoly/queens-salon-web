-- MALIKAT Core: read-only day-audit query acceleration, no data rewrite.
-- SQL expressions must exactly match workers/core/repositories/day-audit-queries.js.
-- Apply ONLY after production 0096/0097/0098 readiness checks, a validated
-- D1 backup, and a verified maintenance/rollback plan. Index builds consume D1 resources.

CREATE INDEX IF NOT EXISTS idx_core_income_audit_day_page
  ON income_entries (
    salon_id,
    date(occurred_at, '+3 hours'),
    occurred_at DESC,
    id DESC
  );

CREATE INDEX IF NOT EXISTS idx_core_refunds_audit_day_page
  ON refunds (
    salon_id,
    date(COALESCE(NULLIF(TRIM(refunded_at), ''), created_at), '+3 hours'),
    COALESCE(NULLIF(TRIM(refunded_at), ''), created_at) DESC,
    id DESC
  );
