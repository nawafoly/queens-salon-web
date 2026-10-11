import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(
  "src/pages/DashboardBookings.tsx",
  "utf8"
);

const source = readFileSync(
  "src/services/bookingDataSources/coreD1BookingDataSource.ts",
  "utf8"
);

test("booking edit exposes audited item-level price control", () => {
  assert.match(page, /سعر الخدمة في هذا الحجز/);
  assert.match(page, /bookingItemPrice/);
  assert.match(page, /priceAdjustmentReason/);
  assert.match(page, /bookings\.price\.adjust/);
  assert.match(page, /سعر الكتالوج لم يُحدّث بعد/);
  assert.match(page, /معتمد من الإدارة/);
  assert.match(page, /سعر خاص/);
});

test("price validation occurs before Core write", () => {
  const validation = page.indexOf(
    "bookingItemPriceChanged &&"
  );

  const write = page.indexOf(
    "await updateCoreBookingFields(target.id, patch)"
  );

  assert.ok(validation >= 0);
  assert.ok(write > validation);
});

test("price increase does not invent payment", () => {
  assert.match(
    page,
    /Increasing the booking price must not silently invent/
  );
  assert.match(
    page,
    /alreadyPaid \+ 0\.005 < nextTotal/
  );
  assert.match(
    page,
    /paymentType: "partial" as const/
  );
});

test("parent total remains read-only in payment section", () => {
  assert.match(
    page,
    /إجمالي الحجز \(للقراءة فقط\)/
  );
  assert.match(
    page,
    /value=\{price\}[\s\S]{0,120}disabled/
  );
});

test("frontend sends audited item price to Core", () => {
  assert.match(source, /bookingItemPriceHalalas/);
  assert.match(source, /priceAdjustmentReason/);
});


test("editing an already completed booking does not synthesize payment", () => {
  assert.match(
    page,
    /statusAfterEdit === "completed"[\s\S]{0,100}target\.status !== "completed"/
  );
});
