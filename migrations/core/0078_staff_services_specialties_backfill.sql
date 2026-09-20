-- Backfill canonical staff_services from the legacy staff.specialties_json mirror.
-- This migration only inserts/reactivates valid catalog assignments.
-- It deliberately does NOT deactivate staff_services rows that are absent from
-- specialties_json, because staff_services is the canonical authority.

INSERT INTO staff_services (salon_id, staff_id, service_id, active)
SELECT
  s.salon_id,
  s.id,
  TRIM(CAST(j.value AS TEXT)) AS service_id,
  1
FROM staff AS s
JOIN json_each(
  CASE
    WHEN json_valid(COALESCE(s.specialties_json, '[]'))
      THEN COALESCE(s.specialties_json, '[]')
    ELSE '[]'
  END
) AS j
JOIN services AS svc
  ON svc.salon_id = s.salon_id
 AND svc.id = TRIM(CAST(j.value AS TEXT))
 AND svc.active = 1
WHERE TRIM(CAST(j.value AS TEXT)) <> ''
ON CONFLICT(salon_id, staff_id, service_id)
DO UPDATE SET active = 1;
