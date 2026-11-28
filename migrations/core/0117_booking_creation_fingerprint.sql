-- Preserve immutable evidence of the original booking creation request.
-- Existing bookings deliberately remain unverified; do not backfill guesses.

ALTER TABLE bookings
ADD COLUMN creation_request_fingerprint TEXT;

CREATE TRIGGER IF NOT EXISTS trg_booking_creation_fingerprint_immutable
BEFORE UPDATE OF creation_request_fingerprint ON bookings
WHEN NEW.creation_request_fingerprint IS NOT OLD.creation_request_fingerprint
BEGIN
  SELECT RAISE(
    ABORT,
    'core_booking:creation_fingerprint_immutable'
  );
END;
