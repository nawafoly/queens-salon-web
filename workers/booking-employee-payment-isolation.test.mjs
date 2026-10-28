import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const bookingUi = readFileSync('src/pages/DashboardBookings.tsx', 'utf8');
const adapter = readFileSync('src/services/bookingDataSources/coreD1BookingDataSource.ts', 'utf8');
const repo = readFileSync('workers/core/repositories/bookings.js', 'utf8');

test('operational booking edits do not send payment fields without an explicit edit', () => {
  assert.match(bookingUi, /paymentEditTouchedRef\.current/);
  assert.match(bookingUi, /const employeePatch = shouldUpdateEmployee/);
  assert.match(bookingUi, /paymentEditTouchedRef\.current && alreadyCollected > 0/);
  assert.match(bookingUi, /await updateCoreBookingFields\(target.id, patch\)/);
});

test('undefined payment breakdown remains absent through Core adapter', () => {
  assert.match(adapter, /paymentBreakdown = rawBreakdown === undefined/);
  assert.match(adapter, /patch.paymentBreakdown !== undefined/);
  assert.match(repo, /core_booking:payment_history_immutable/);
});


test('only an employee change uses the minimal operational update payload', () => {
  assert.match(bookingUi, /const staffOnlyEdit =/);
  assert.match(bookingUi, /shouldUpdateEmployee &&/);
  assert.match(bookingUi, /staffOnlyEdit \? \(employeePatch as Partial<Booking>\) : patch/);
  assert.match(bookingUi, /staffOnlyEdit \? \(employeePatch as Partial<Booking>\) : \{/);
  assert.match(bookingUi, /paymentEditTouchedRef\.current/);
});
