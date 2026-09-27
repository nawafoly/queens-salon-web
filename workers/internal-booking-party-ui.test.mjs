import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const tsx = readFileSync("src/features/internal-booking-v2/BookingInternalV2.tsx", "utf8");
const css = readFileSync("src/features/internal-booking-v2/booking-internal-v2.css", "utf8");
const language = readFileSync("src/helpers/dashboardBookingsLanguage.ts", "utf8");

test("internal booking supports a primary client plus companions without replacing canonical ownership", () => {
  assert.match(tsx, /const \[companions, setCompanions\]/);
  assert.match(tsx, /const bookingClients = useMemo/);
  assert.match(tsx, /addingCompanion && selectedClient/);
  assert.match(tsx, /attachServiceToClient\(service, owner\)/);
  assert.match(tsx, /bookingLineClientKey/);
});

test("same client cannot overlap but different party members may overlap while staff remains globally protected", () => {
  assert.match(tsx, /bookingLineClientKey\(other\) === currentClientKey/);
  assert.match(tsx, /if \(selected\.staffId === staffKey\)/);
  assert.match(tsx, /const key = bookingLineKey\(service\)/);
});

test("one administrative checkout creates one canonical Core booking per party member", () => {
  assert.match(tsx, /for \(const plan of memberPlans\)/);
  assert.match(tsx, /createBookingGroup\(\{ parent, items: itemRows \}\)/);
  assert.match(tsx, /partyLeadClientId: leadCanonicalClientId/);
  assert.match(tsx, /partyMemberOrder: plan\.memberOrder/);
  assert.match(tsx, /partySize: bookingClients\.length/);
  assert.match(tsx, /createdPartyBookings/);
});

test("partial party creation has compensation and payment posting is split across member bookings", () => {
  assert.match(tsx, /Promise\.allSettled/);
  assert.match(tsx, /updateBookingStatus\(bookingId, "cancelled"\)/);
  assert.match(tsx, /const cashByMember = splitAmountByWeights/);
  assert.match(tsx, /const cardByMember = splitAmountByWeights/);
  assert.match(tsx, /const transferByMember = splitAmountByWeights/);
  assert.match(tsx, /const paidByMember = memberPlans\.map/);
  assert.match(tsx, /booking-v2-party:/);
});

test("party booking controls are styled and translated", () => {
  assert.match(css, /\.bk2-party-clients/);
  assert.match(css, /\.bk2-party-service-owner/);
  assert.match(css, /\.bk2-party-success-bookings/);
  assert.match(language, /"إضافة مرافقة": "Add companion"/);
  assert.match(language, /"مجموعة الحجز": "Booking group"/);
});
