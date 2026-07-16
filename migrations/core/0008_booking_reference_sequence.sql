CREATE TABLE IF NOT EXISTS booking_counters (
  salon_id TEXT PRIMARY KEY,
  last_number INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

-- The last verified production reference is MK-10422. Existing higher MK
-- references always win, making this migration safe to apply after imports.
INSERT INTO booking_counters (salon_id, last_number, updated_at)
VALUES ('main', 10422, CURRENT_TIMESTAMP)
ON CONFLICT(salon_id) DO UPDATE SET
  last_number = CASE
    WHEN booking_counters.last_number > excluded.last_number
      THEN booking_counters.last_number
    ELSE excluded.last_number
  END,
  updated_at = excluded.updated_at;

INSERT INTO booking_counters (salon_id, last_number, updated_at)
SELECT
  salon_id,
  MAX(CAST(SUBSTR(public_id, 4) AS INTEGER)) AS last_number,
  CURRENT_TIMESTAMP
FROM bookings
WHERE public_id GLOB 'MK-[0-9]*'
  AND SUBSTR(public_id, 4) NOT GLOB '*[^0-9]*'
GROUP BY salon_id
ON CONFLICT(salon_id) DO UPDATE SET
  last_number = CASE
    WHEN booking_counters.last_number > excluded.last_number
      THEN booking_counters.last_number
    ELSE excluded.last_number
  END,
  updated_at = excluded.updated_at;
