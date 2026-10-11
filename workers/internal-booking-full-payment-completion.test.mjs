import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL(
    "../src/features/internal-booking-v2/BookingInternalV2.tsx",
    import.meta.url
  ),
  "utf8"
);

test(
  "internal full payment completes only after financial synchronization",
  () => {
    assert.match(
      source,
      /INTERNAL_BOOKING_FULL_PAYMENT_COMPLETION_V1/
    );

    const paymentWrite = source.indexOf(
      "await bookingDataSource.recordPayment("
    );

    const financialUpdate = source.indexOf(
      "await bookingDataSource.updateBooking(bookingId"
    );

    const completionGuard = source.indexOf(
      'paymentType === "full"',
      financialUpdate
    );

    const completionWrite = source.indexOf(
      "await bookingDataSource.updateBookingStatus(",
      completionGuard
    );

    assert.ok(paymentWrite >= 0);
    assert.ok(financialUpdate > paymentWrite);
    assert.ok(completionGuard > financialUpdate);
    assert.ok(completionWrite > completionGuard);

    assert.match(
      source,
      /financialPostingSucceeded = false/
    );
  }
);

test(
  "failed financial synchronization cannot enter completion gate",
  () => {
    const failure = source.indexOf(
      "financialPostingSucceeded = false"
    );

    const completion = source.indexOf(
      "INTERNAL_BOOKING_FULL_PAYMENT_COMPLETION_V1"
    );

    assert.ok(failure >= 0);
    assert.ok(completion > failure);
    assert.match(
      source,
      /paymentType === "full"[\s\S]*financialPostingSucceeded/
    );
  }
);
