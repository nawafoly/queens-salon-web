-- Merge duplicate Nawaf attendance identity into canonical Nawaf identity.
-- Canonical: EkAxHGHMMBfD11OCDP1XavS9KA43
-- Duplicate: t36cUYFVA4fBlrmwUjkRhUJY0f12
-- Preserve historical punch rows; keep canonical attendance_state because it is newer.

UPDATE attendance_records
SET employee_uid = 'EkAxHGHMMBfD11OCDP1XavS9KA43',
    employee_doc_id = 'EkAxHGHMMBfD11OCDP1XavS9KA43',
    updated_at = CURRENT_TIMESTAMP
WHERE employee_uid = 't36cUYFVA4fBlrmwUjkRhUJY0f12'
   OR employee_doc_id = 't36cUYFVA4fBlrmwUjkRhUJY0f12';

DELETE FROM attendance_state
WHERE employee_uid = 't36cUYFVA4fBlrmwUjkRhUJY0f12';

SELECT employee_uid, employee_doc_id, COUNT(*) AS records
FROM attendance_records
WHERE employee_uid IN ('EkAxHGHMMBfD11OCDP1XavS9KA43', 't36cUYFVA4fBlrmwUjkRhUJY0f12')
   OR employee_doc_id IN ('EkAxHGHMMBfD11OCDP1XavS9KA43', 't36cUYFVA4fBlrmwUjkRhUJY0f12')
GROUP BY employee_uid, employee_doc_id;

SELECT employee_uid, employee_doc_id, status, last_type, last_server_time
FROM attendance_state
WHERE employee_uid IN ('EkAxHGHMMBfD11OCDP1XavS9KA43', 't36cUYFVA4fBlrmwUjkRhUJY0f12')
   OR employee_doc_id IN ('EkAxHGHMMBfD11OCDP1XavS9KA43', 't36cUYFVA4fBlrmwUjkRhUJY0f12');
