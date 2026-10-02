-- Booking-item slot locks are the canonical concurrency guard.
-- The original parent-booking unique index from 0001 only models one
-- staff/start pair per parent booking and conflicts with multi-item / party
-- bookings. Range validation plus booking_slot_locks now own overlap safety.

DROP INDEX IF EXISTS idx_core_bookings_staff_slot_active;
