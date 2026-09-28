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

test("service selection is isolated to the explicitly active canonical client", () => {
  assert.match(tsx, /if \(rawId && !rawId\.startsWith\("history:"\)\) return `id:\$\{rawId\}`/);
  assert.match(tsx, /function clientHasService\(cart: CatalogService\[\], client: ClientCandidate, service: CatalogService\)/);
  assert.match(tsx, /bookingLineClientKey\(item\) === clientKey/);
  assert.match(tsx, /function addServiceForClient/);
  assert.match(tsx, /if \(clientHasService\(cart, client, service\)\) return cart/);
  assert.match(tsx, /setCart\(\(current\) => addServiceForClient\(current, service, owner\)\)/);
  assert.match(tsx, /setCart\(\(current\) => removeServiceForClient\(current, service, owner\)\)/);
});

test("schedule step groups services under a prominent client header", () => {
  assert.match(tsx, /const scheduleGroups = useMemo/);
  assert.match(tsx, /services: cart\.filter\(\(service\) => bookingLineClientKey\(service\) === clientKey\)/);
  assert.match(tsx, /className="bk2-party-schedule-groups"/);
  assert.match(tsx, /className="bk2-party-schedule-group-head"/);
  assert.match(tsx, /className="bk2-party-schedule-client"/);
  assert.match(tsx, /\{group\.client\.name\}/);
  assert.match(css, /\.bk2-party-schedule-group-head/);
  assert.match(css, /\.bk2-party-schedule-client strong/);
  assert.match(css, /font-size:20px/);
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
