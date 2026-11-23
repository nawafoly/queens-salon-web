SELECT
       b.id AS booking_id,
       b.public_id,
       bi.id AS booking_item_id,
       bi.service_name_snapshot,
       COALESCE(bi.start_time, b.start_time) AS start_time,
       COALESCE(bi.end_time, b.end_time) AS end_time,
       COALESCE(b.buffer_min, 0) AS buffer_min,
       b.status,
       b.client_id,
       c.name AS client_name,
       c.phone_normalized AS client_phone,
       b.source
     FROM booking_items bi
     INNER JOIN bookings b ON b.id = bi.booking_id AND b.salon_id = bi.salon_id
     LEFT JOIN clients c ON c.id = b.client_id AND c.salon_id = b.salon_id
     WHERE bi.salon_id = ?
       AND COALESCE(bi.staff_id, b.staff_id) = ?
       AND COALESCE(bi.booking_date, b.booking_date) = ?
       AND LOWER(b.status) NOT IN ('cancelled', 'canceled', 'rejected')
     ORDER BY start_time
