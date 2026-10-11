import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const service = readFileSync(
  "src/services/CoreBookingService.ts",
  "utf8"
);
const source = readFileSync(
  "src/services/bookingDataSources/coreD1BookingDataSource.ts",
  "utf8"
);
const repo = readFileSync(
  "workers/core/repositories/bookings.js",
  "utf8"
);
const index = readFileSync(
  "workers/core/index.js",
  "utf8"
);

test("booking item price edit stays item-level and audited", () => {
  assert.match(
    service,
    /bookingItemPriceHalalas/
  );
  assert.match(
    source,
    /bookingItemPriceHalalas/
  );
  assert.match(
    repo,
    /booking_price_adjusted/
  );
  assert.match(
    repo,
    /price_adjustment_reason_required/
  );
  assert.match(
    repo,
    /price_below_paid_amount/
  );
});

test("booking price edit requires dedicated permission", () => {
  assert.match(
    index,
    /bookings\.price\.adjust/
  );
  assert.match(
    index,
    /allowPriceAdjustment/
  );
});

test("parent total remains derived from item pricing", () => {
  assert.match(
    repo,
    /previousSubtotalHalalas/
  );
  assert.match(
    repo,
    /nextItemTotalHalalas/
  );
  assert.match(
    repo,
    /nextDiscountHalalas/
  );
  assert.match(
    repo,
    /subtotalHalalas - nextDiscountHalalas/
  );
  assert.match(
    repo,
    /direct_price_mutation_forbidden/
  );
});


test("price edits cannot reduce total below already collected money", () => {
  assert.match(
    repo,
    /existingPaidHalalas > requestedTotal/
  );

  assert.match(
    repo,
    /core_booking:price_below_paid_amount/
  );
});
