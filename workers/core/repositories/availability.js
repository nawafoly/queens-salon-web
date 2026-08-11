// CORE D1 ONLY — do not add Firestore fallback.

import {
  cleanText,
  dbAll,
  integer,
  requiredId,
  validDate,
} from '../d1.js';
import { getStaff, staffIsActive } from './staff.js';
import { resolveStaffBookingDay } from './booking-staff-policy.js';

const CANCELLED_STATUSES = new Set(["cancelled", "canceled", "rejected"]);

function timeToMinutes(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(cleanText(value));
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function minutesToTime(value) {
  const normalized = Math.max(0, Math.min(24 * 60 - 1, Math.floor(value)));
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

function expandRange(startTime, endTime, stepMin, bufferMin = 0) {
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (start === null || end === null || end <= start) return [];
  const out = [];
  const until = Math.min(24 * 60, end + Math.max(0, bufferMin));
  const firstGridMinute = Math.ceil(start / stepMin) * stepMin;
  for (let minute = firstGridMinute; minute < until; minute += stepMin) {
    out.push(minutesToTime(minute));
  }
  return out;
}

function weekdayForDate(date) {
  return new Date(`${date}T12:00:00.000Z`).getUTCDay();
}

async function scheduleRows(db, salonId, staffId, weekday) {
  if (db.__fakeD1 && typeof db.rows === "function") {
    return db
      .rows("staff_schedules")
      .filter(
        (row) =>
          row.salon_id === salonId &&
          row.staff_id === staffId &&
          Number(row.weekday) === weekday &&
          Number(row.active) === 1
      )
      .sort((left, right) => cleanText(left.start_time).localeCompare(cleanText(right.start_time)));
  }
  return dbAll(
    db,
    `SELECT * FROM staff_schedules
      WHERE salon_id = ? AND staff_id = ? AND weekday = ? AND active = 1
      ORDER BY start_time`,
    [salonId, staffId, weekday]
  );
}

async function slotLockRows(db, salonId, staffId, date) {
  if (db.__fakeD1 && typeof db.rows === "function") {
    return db
      .rows("booking_slot_locks")
      .filter(
        (row) =>
          row.salon_id === salonId &&
          row.staff_id === staffId &&
          row.booking_date === date
      )
      .sort((left, right) => cleanText(left.slot_time).localeCompare(cleanText(right.slot_time)));
  }
  return dbAll(
    db,
    `SELECT * FROM booking_slot_locks
      WHERE salon_id = ? AND staff_id = ? AND booking_date = ?
      ORDER BY slot_time`,
    [salonId, staffId, date]
  );
}

async function bookedRows(db, salonId, staffId, date) {
  if (db.__fakeD1 && typeof db.rows === "function") {
    const bookings = db.rows("bookings");
    const clients = db.rows("clients");
    return db
      .rows("booking_items")
      .map((item) => {
        const booking = bookings.find((row) => row.id === item.booking_id && row.salon_id === salonId);
        if (!booking || CANCELLED_STATUSES.has(cleanText(booking.status).toLowerCase())) return null;
        const resolvedStaffId = cleanText(item.staff_id || booking.staff_id);
        const resolvedDate = cleanText(item.booking_date || booking.booking_date);
        if (resolvedStaffId !== staffId || resolvedDate !== date) return null;
        const client = clients.find((row) => row.id === booking.client_id && row.salon_id === salonId);
        return {
          booking_id: booking.id,
          public_id: booking.public_id,
          booking_item_id: item.id,
          service_name_snapshot: item.service_name_snapshot,
          start_time: item.start_time || booking.start_time,
          end_time: item.end_time || booking.end_time,
          buffer_min: Number(booking.buffer_min || 0),
          status: booking.status,
          client_id: booking.client_id,
          client_name: client?.name || null,
          client_phone: client?.phone_normalized || null,
          source: booking.source,
        };
      })
      .filter(Boolean)
      .sort((left, right) => cleanText(left.start_time).localeCompare(cleanText(right.start_time)));
  }

  return dbAll(
    db,
    `SELECT
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
     ORDER BY start_time`,
    [salonId, staffId, date]
  );
}

export async function getStaffAvailability(db, salonId, query = {}) {
  const date = validDate(query.date || query.bookingDate, "date");
  const staffId = requiredId(query.staffId || query.staff_id, "staffId");
  const slotStepMin = integer(query.slotStepMin || query.slot_step_min, "slotStepMin", {
    min: 5,
    max: 120,
    fallback: 10,
  });
  const bufferMin = integer(query.bufferMin || query.buffer_min, "bufferMin", {
    min: 0,
    max: 240,
    fallback: 0,
  });

  const staff = await getStaff(db, salonId, staffId);
  const weekday = weekdayForDate(date);
  const [legacySchedules, locks, bookings, bookingDay] = await Promise.all([
    scheduleRows(db, salonId, staffId, weekday),
    slotLockRows(db, salonId, staffId, date),
    bookedRows(db, salonId, staffId, date),
    resolveStaffBookingDay(db, salonId, staff, date),
  ]);

  const takenTimes = new Set(
    locks
      .map((row) => cleanText(row.slot_time))
      .filter((time) => {
        const minute = timeToMinutes(time);
        return minute !== null && minute % slotStepMin === 0;
      })
  );
  const lockedTimes = locks
    .map((row) => cleanText(row.slot_time))
    .filter((time) => timeToMinutes(time) !== null);
  const bookedSlots = {};

  for (const booking of bookings) {
    const start = cleanText(booking.start_time);
    const end = cleanText(booking.end_time);
    const expanded = expandRange(start, end, slotStepMin, bufferMin);
    for (const time of expanded) {
      takenTimes.add(time);
      if (!bookedSlots[time]) {
        bookedSlots[time] = {
          bookingId: cleanText(booking.booking_id),
          publicId: cleanText(booking.public_id) || cleanText(booking.booking_id),
          bookingItemId: cleanText(booking.booking_item_id),
          serviceName: cleanText(booking.service_name_snapshot),
          clientId: cleanText(booking.client_id),
          clientName: cleanText(booking.client_name),
          clientPhone: cleanText(booking.client_phone),
          source: cleanText(booking.source),
          status: cleanText(booking.status),
          startTime: start,
          endTime: end,
          bufferMin: Number(booking.buffer_min || 0),
        };
      }
    }
  }

  const blockedRanges = Array.isArray(bookingDay.blockedRanges) ? bookingDay.blockedRanges : [];
  for (const range of blockedRanges) {
    for (const time of expandRange(range.startTime, range.endTime, slotStepMin, 0)) {
      takenTimes.add(time);
    }
  }

  let scheduleWindows = [];
  if (bookingDay.available && bookingDay.startTime && bookingDay.endTime) {
    scheduleWindows = [{
      id: `hr:${bookingDay.source || 'schedule'}`,
      startTime: cleanText(bookingDay.startTime),
      endTime: cleanText(bookingDay.endTime),
    }];
  } else if (bookingDay.available && bookingDay.source === 'fallback') {
    scheduleWindows = legacySchedules
      .map((row) => ({
        id: cleanText(row.id),
        startTime: cleanText(row.start_time),
        endTime: cleanText(row.end_time),
      }))
      .filter((row) => row.startTime && row.endTime);
  }

  const showOnBooking = Number(staff.show_on_booking ?? 1) === 1;
  const onLeave = bookingDay.reason === 'approved_leave';

  return {
    salonId,
    date,
    weekday,
    staffId,
    staffName: cleanText(staff.name),
    active: staffIsActive(staff),
    showOnBooking,
    onLeave,
    leaveNote: onLeave ? cleanText(staff.leave_note) : "",
    availableForDate: Boolean(bookingDay.available && showOnBooking),
    unavailableReason: bookingDay.available ? "" : cleanText(bookingDay.reason),
    availabilitySource: cleanText(bookingDay.source),
    scheduleWindows,
    blockedRanges,
    lockedTimes,
    takenTimes: [...takenTimes].sort(),
    bookedSlots,
    bookings,
  };
}
