import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const path = "workers/core/repositories/availability.js";

const oldSource = execFileSync(
  "git",
  ["show", `HEAD:${path}`],
  { encoding: "utf8" }
);

const newSource = readFileSync(path, "utf8");

function extractQuery(source) {
  const start = source.indexOf("async function bookedRows(");
  const end = source.indexOf("export async function getStaffAvailability(", start);

  assert.ok(start >= 0 && end > start, "Cannot locate bookedRows");

  const block = source.slice(start, end);

  const match = block.match(
    /return dbAll\(\s*db,\s*`([\s\S]*?)`,\s*\[salonId, staffId, date(?:, salonId, staffId, date)?\]\s*\);/
  );

  assert.ok(match, "Cannot extract booking SQL");

  return {
    sql: match[1],
    parameterCount: (match[1].match(/\?/g) || []).length,
  };
}

const original = extractQuery(oldSource);
const optimized = extractQuery(newSource);

test("optimized search returns exactly the same appointments", () => {
  const db = new DatabaseSync(":memory:");

  try {
    db.exec(`
      CREATE TABLE bookings (
        id TEXT PRIMARY KEY,
        salon_id TEXT,
        public_id TEXT,
        staff_id TEXT,
        booking_date TEXT,
        start_time TEXT,
        end_time TEXT,
        buffer_min INTEGER,
        status TEXT,
        client_id TEXT,
        source TEXT
      );

      CREATE TABLE booking_items (
        id TEXT PRIMARY KEY,
        salon_id TEXT,
        booking_id TEXT,
        staff_id TEXT,
        booking_date TEXT,
        start_time TEXT,
        end_time TEXT,
        service_name_snapshot TEXT
      );

      CREATE TABLE clients (
        id TEXT PRIMARY KEY,
        salon_id TEXT,
        name TEXT,
        phone_normalized TEXT
      );

      CREATE INDEX idx_core_booking_items_staff_date
        ON booking_items (
          salon_id,
          staff_id,
          booking_date,
          start_time,
          end_time
        );

      CREATE INDEX idx_core_booking_items_salon_booking
        ON booking_items (salon_id, booking_id);
    `);

    db.prepare(
      "INSERT INTO clients VALUES (?, ?, ?, ?)"
    ).run("client-1", "main", "Test Client", "0500000000");

    const add = (id, {
      salon = "main",
      bookingStaff = "staff-a",
      itemStaff = "staff-a",
      bookingDate = "2026-11-23",
      itemDate = "2026-11-23",
      status = "confirmed",
    } = {}) => {
      db.prepare(
        `INSERT INTO bookings VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id, salon, id, bookingStaff, bookingDate,
        "10:00", "11:00", 0, status, "client-1", "admin"
      );

      db.prepare(
        `INSERT INTO booking_items VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        `item-${id}`, salon, id, itemStaff,
        itemDate, "10:00", "11:00", "Test Service"
      );
    };

    // Normal appointments.
    add("normal-a");
    add("normal-b", { itemStaff: "staff-b", bookingStaff: "staff-b" });

    // Item staff overrides booking staff.
    add("different-staff", {
      bookingStaff: "staff-b",
      itemStaff: "staff-a",
    });

    // Legacy appointment inherits staff from booking.
    add("legacy-staff", {
      itemStaff: null,
      bookingStaff: "staff-a",
    });

    // Legacy appointment inherits date from booking.
    add("legacy-date", {
      itemDate: null,
      bookingDate: "2026-11-23",
    });

    // Legacy appointment inherits both.
    add("legacy-both", {
      itemStaff: null,
      itemDate: null,
    });

    // Appointment without any staff must not become assigned.
    add("unassigned", {
      itemStaff: null,
      bookingStaff: null,
    });

    // Cancelled/rejected appointments must remain excluded.
    add("cancelled", { status: "cancelled" });
    add("rejected", { status: "rejected" });

    // Other dates and other salons must remain isolated.
    add("tomorrow", {
      bookingDate: "2026-11-24",
      itemDate: "2026-11-24",
    });

    add("other-salon", { salon: "other" });

    const scenarios = [
      ["main", "staff-a", "2026-11-23"],
      ["main", "staff-b", "2026-11-23"],
      ["main", "staff-a", "2026-11-24"],
      ["other", "staff-a", "2026-11-23"],
      ["main", "staff-c", "2026-11-23"],
    ];

    for (const [salonId, staffId, date] of scenarios) {
      const oldParams =
        [salonId, staffId, date];

      const newParams =
        [salonId, staffId, date, salonId, staffId, date];

      assert.equal(original.parameterCount, 3);
      assert.equal(optimized.parameterCount, 6);

      const oldRows = db.prepare(original.sql).all(...oldParams);
      const newRows = db.prepare(optimized.sql).all(...newParams);

      // SQL does not guarantee the order of rows with identical
      // start_time values. Compare the actual appointment data
      // independently of tie ordering.
      const normalize = (rows) =>
        rows.map((row) => ({ ...row }))
          .sort((a, b) =>
            String(a.booking_item_id).localeCompare(String(b.booking_item_id))
          );

      assert.deepEqual(
        normalize(newRows),
        normalize(oldRows),
        `Booking results changed for ${salonId}/${staffId}/${date}`
      );

      for (const rows of [oldRows, newRows]) {
        for (let i = 1; i < rows.length; i++) {
          assert.ok(
            String(rows[i - 1].start_time) <= String(rows[i].start_time),
            "Appointments are not ordered by start time"
          );
        }
      }
    }

    const plan = db.prepare(
      `EXPLAIN QUERY PLAN ${optimized.sql}`
    ).all(
      "main", "staff-a", "2026-11-23",
      "main", "staff-a", "2026-11-23"
    );

    const usesStaffDateIndex = plan.some(
      row => String(row.detail).includes(
        "idx_core_booking_items_staff_date"
      )
    );

    assert.equal(
      usesStaffDateIndex,
      true,
      "Optimized query is not using the staff/date index"
    );

    console.log("BOOKING_RESULTS_MATCH");
    console.log("STAFF_DATE_INDEX_USED");

  } finally {
    db.close();
  }
});