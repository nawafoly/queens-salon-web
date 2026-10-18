import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync(
  "src/pages/DashboardBookings.tsx",
  "utf8"
);
const mapper = fs.readFileSync(
  "src/services/coreBookingMappers.ts",
  "utf8"
);
const types = fs.readFileSync(
  "src/types/bookingRecord.ts",
  "utf8"
);

test("edit modal hydrates the canonical booking-item discount", () => {
  assert.match(
    types,
    /bookingItemDiscount\?:\s*number/
  );
  assert.match(
    mapper,
    /bookingItemDiscount:/
  );
  assert.match(
    page,
    /bookingItemDiscount:\s*String\(/
  );
});

test("edit modal exposes a permission-gated discount field", () => {
  assert.match(
    page,
    /bookings\.discount\.apply/
  );
  assert.match(
    page,
    /خصم هذا الحجز/
  );
  assert.match(
    page,
    /onBookingItemDiscountChange/
  );
});

test("price and discount recalculate the displayed booking total", () => {
  assert.match(
    page,
    /otherItemsFinal/
  );
  assert.match(
    page,
    /nextUnitPrice \* quantity -\s*nextItemDiscount/
  );
});

test("discount edits preserve financial integrity", () => {
  assert.match(
    page,
    /alreadyCollected > price \+ 0\.005/
  );
  assert.match(
    page,
    /bookingItemDiscountChanged/
  );
  assert.match(
    page,
    /discountAmount:\s*nextBookingDiscountAmount/
  );
});
