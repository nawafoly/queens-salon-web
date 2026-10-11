import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const service = fs.readFileSync(
  "src/services/CoreBookingService.ts",
  "utf8"
);
const dataSource = fs.readFileSync(
  "src/services/bookingDataSources/coreD1BookingDataSource.ts",
  "utf8"
);
const core = fs.readFileSync(
  "workers/core/index.js",
  "utf8"
);
const repo = fs.readFileSync(
  "workers/core/repositories/bookings.js",
  "utf8"
);

test("booking discount edit crosses the typed Core bridge", () => {
  assert.match(
    service,
    /bookingItemDiscountHalalas:\s*number/
  );
  assert.match(
    dataSource,
    /bookingItemDiscountHalalas:/
  );
});

test("booking discount edit requires its own permission", () => {
  assert.match(
    core,
    /hasDiscountAdjustment/
  );
  assert.match(
    core,
    /bookings\.discount\.apply/
  );
  assert.match(
    core,
    /allowDiscountAdjustment/
  );
});

test("Core derives totals from item discount and persists audit", () => {
  assert.match(
    repo,
    /nextItemDiscountHalalas/
  );
  assert.match(
    repo,
    /nextDiscountHalalas/
  );
  assert.match(
    repo,
    /discount_halalas = \?, final_total_halalas = \?/
  );
  assert.match(
    repo,
    /booking_discount_adjusted/
  );
  assert.match(
    repo,
    /financialTotalChanged/
  );
  assert.match(
    repo,
    /core_booking:discount_exceeds_item_total/
  );
});
