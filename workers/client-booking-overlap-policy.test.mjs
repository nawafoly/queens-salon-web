import assert from "node:assert/strict";
import { test } from "node:test";
import { assertNoClientItemOverlap, existingClientRangeConflict, findClientItemOverlap } from "./core/repositories/bookings.js";

const row = (id, staffId, start, end, date = "2026-08-20") => ({
  id,
  staff_id: staffId,
  booking_date: date,
  start_time: start,
  end_time: end,
});

test("client overlap is detected across different employees", () => {
  const conflict = findClientItemOverlap([
    row("hair", "staff-a", "15:00", "15:30"),
    row("cut", "staff-b", "15:10", "15:40"),
  ]);
  assert.ok(conflict);
  assert.equal(conflict.left.id, "hair");
  assert.equal(conflict.right.id, "cut");
});

test("Core rejects overlapping services in one booking across employees", () => {
  assert.throws(
    () => assertNoClientItemOverlap([
      row("hair", "staff-a", "15:00", "15:30"),
      row("cut", "staff-b", "15:00", "15:20"),
    ]),
    (error) => error?.status === 409 && error?.code === "core_booking:client_schedule_conflict"
  );
});

test("04:20 thirty-minute service blocks a second service at 04:30 but allows 04:50", () => {
  const first = row("service-a", "staff-a", "04:20", "04:50");

  const overlapping = findClientItemOverlap([
    first,
    row("service-b", "staff-b", "04:30", "05:00"),
  ]);
  assert.ok(overlapping, "04:30 must overlap the active 04:20-04:50 service");

  assert.throws(
    () =>
      assertNoClientItemOverlap([
        first,
        row("service-b", "staff-b", "04:30", "05:00"),
      ]),
    (error) =>
      error?.status === 409 &&
      error?.code === "core_booking:client_schedule_conflict"
  );

  assert.equal(
    findClientItemOverlap([
      first,
      row("service-b", "staff-b", "04:50", "05:20"),
    ]),
    null,
    "04:50 is the first valid adjacent start"
  );
});

test("adjacent services are allowed; employee buffer is not client service time", () => {
  assert.equal(findClientItemOverlap([
    row("hair", "staff-a", "15:00", "15:30"),
    row("cut", "staff-b", "15:30", "16:00"),
  ]), null);
});

test("different dates do not conflict", () => {
  assert.equal(findClientItemOverlap([
    row("hair", "staff-a", "15:00", "15:30", "2026-08-20"),
    row("cut", "staff-b", "15:00", "15:30", "2026-08-21"),
  ]), null);
});

test("existing booking for the same client blocks an overlapping new service", async () => {
  const tables = {
    bookings: [{ id: "booking-old", salon_id: "main", client_id: "client-1", status: "booked", booking_date: "2026-08-20", start_time: "15:00", end_time: "15:30" }],
    booking_items: [{ id: "item-old", booking_id: "booking-old", salon_id: "main", staff_id: "staff-a", booking_date: "2026-08-20", start_time: "15:00", end_time: "15:30" }],
  };
  const fake = { __fakeD1: true, rows: (table) => tables[table] || [] };
  const conflict = await existingClientRangeConflict(fake, "main", "client-1", "2026-08-20", "15:10", "15:40");
  assert.equal(conflict?.id, "booking-old");
});

test("another client does not block the requested time", async () => {
  const tables = {
    bookings: [{ id: "booking-other", salon_id: "main", client_id: "client-2", status: "booked", booking_date: "2026-08-20", start_time: "15:00", end_time: "15:30" }],
    booking_items: [{ id: "item-other", booking_id: "booking-other", salon_id: "main", staff_id: "staff-a", booking_date: "2026-08-20", start_time: "15:00", end_time: "15:30" }],
  };
  const fake = { __fakeD1: true, rows: (table) => tables[table] || [] };
  const conflict = await existingClientRangeConflict(fake, "main", "client-1", "2026-08-20", "15:10", "15:40");
  assert.equal(conflict, null);
});
