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

test("saved offers belong to one party client and do not leak to companions", () => {
  assert.match(tsx, /const \[selectedOfferByClientKey, setSelectedOfferByClientKey\]/);
  assert.match(tsx, /const selectedOfferId = String\(selectedOfferByClientKey\[activePartyClientKey\]/);
  assert.match(tsx, /setOfferForClient\(clientKey, nextOfferId\)/);
  assert.match(tsx, /const memberOfferId = String\(selectedOfferByClientKey\[key\]/);
  assert.match(tsx, /results\.set\([\s\S]*?memberOffer[\s\S]*?buildDiscountSnapshot/);
});

test("deselecting a saved offer removes only services that the offer auto-added", () => {
  assert.match(tsx, /function offerAutoAddedId\(service: any\)/);
  assert.match(tsx, /function attachOfferServiceToClient/);
  assert.match(tsx, /__autoAddedByOfferId/);
  assert.match(tsx, /const togglingOff = previousOfferId === offerId/);
  assert.match(tsx, /const removedLineKeys = cart/);
  assert.match(tsx, /if \(!nextOfferId \|\| !nextLinkedIdSet\.has\(serviceId\)\) return \[\]/);
  assert.match(tsx, /setScheduleByService\(\(current\) =>[\s\S]*?removedKeySet/);
  assert.match(tsx, /attachOfferServiceToClient\(service, activeBookingClient, nextOfferId\)/);
});

test("booking summary visibly separates services by party client", () => {
  assert.match(tsx, /className="bk2-summary-party-groups"/);
  assert.match(tsx, /className="bk2-summary-party-group"/);
  assert.match(tsx, /group\.client\.name/);
  assert.match(tsx, /className="bk2-summary-party-offer"/);
  assert.match(css, /\.bk2-summary-party-group>header/);
  assert.match(css, /\.bk2-summary-party-offer/);
});

test("client step has explicit primary/companion modes instead of leaving the full picker visually static", () => {
  assert.match(tsx, /const \[clientPickerOpen, setClientPickerOpen\]/);
  assert.match(tsx, /className=\{\`bk2-client-action-banner/);
  assert.match(tsx, /اختاري المرافقة الآن/);
  assert.match(tsx, /تغيير العميلة الأساسية/);
  assert.match(tsx, /className="bk2-client-card-action"/);
  assert.match(tsx, /setClientPickerOpen\(false\)/);
  assert.match(css, /\.bk2-client-action-banner\.is-companion/);
  assert.match(css, /\.bk2-client-picker-shell\.is-companion/);
});

test("step continue action is rendered only after the current step becomes complete", () => {
  assert.match(tsx, /const sidebarCanAdvance =/);
  assert.match(tsx, /step === 2\s*\? allPartyClientsHaveServices/);
  assert.match(tsx, /\{sidebarCanAdvance \? \(/);
  assert.match(tsx, /className="bk2-continue is-revealed"/);
  assert.doesNotMatch(tsx, /className="bk2-continue" disabled=/);
  assert.match(css, /@keyframes bk2-cta-reveal/);
  assert.match(css, /\.bk2-stepper button\.is-complete \.bk2-step-number/);
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
  assert.match(tsx, /rollbackBookingCreation\(bookingId\)/);
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


test("no-phone companions stay booking-only instead of creating client profiles", () => {
  assert.match(tsx, /if \(addingCompanion && !phone\)/);
  assert.match(tsx, /const guestId = `booking_guest_/);
  assert.match(tsx, /bookingGuest:\s*true/);
  assert.match(tsx, /source:\s*"booking_guest"/);
  assert.match(tsx, /!isBookingGuest\(client\) && phone10Digits\(client\.phone\)\.length !== 10/);
  assert.match(tsx, /guestParticipant:\s*isBookingGuest\(client\)/);
  assert.match(tsx, /إضافة المرافقة للحجز/);
  assert.match(tsx, /بدون رقم جوال ستُضاف كمرافقة لهذا الحجز فقط ولن يتم إنشاء ملف عميلة لها/);
  assert.match(language, /"إضافة المرافقة للحجز": "Add companion to booking"/);
});

test("party members can be edited without changing their booking ownership key", () => {
  assert.match(tsx, /const \[editingPartyClientKey, setEditingPartyClientKey\]/);
  assert.match(tsx, /const stablePartyKey = String\(client\.partyKey \|\| ""\)\.trim\(\)/);
  assert.match(tsx, /partyKey:\s*oldKey/);
  assert.match(tsx, /bookingLineClientKey\(item\) === oldKey/);
  assert.match(tsx, /__partyClientName:\s*next\.name/);
  assert.match(tsx, /className="bk2-party-client-edit"/);
  assert.match(tsx, /openPartyMemberEditor\(client\)/);
  assert.match(tsx, /className="bk2-party-review-members"/);
  assert.match(css, /\.bk2-party-client-edit/);
  assert.match(css, /\.bk2-party-review-member/);
});
