-- Stage 10D: canonical seasonal service price.
-- Source-only until Stage 10E remote schema readiness.
ALTER TABLE services ADD COLUMN season_price_halalas INTEGER;
