import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const tsx = readFileSync("src/features/internal-booking-v2/BookingInternalV2.tsx", "utf8");
const language = readFileSync("src/helpers/dashboardBookingsLanguage.ts", "utf8");
const css = readFileSync("src/features/internal-booking-v2/booking-internal-v2.css", "utf8");

test("administrative booking surfaces active saved offers in the service step", () => {
  assert.match(tsx, /bk2-catalog-offers/);
  assert.match(tsx, /offers\.map\(\(offer\)/);
  assert.match(tsx, /selectCatalogOffer\(offer\)/);
  assert.match(tsx, /setDiscountMode\("offer"\)/);
});

test("service-specific saved offer adds its linked canonical services without fake service rows", () => {
  assert.match(tsx, /offerLinkedServiceIds/);
  assert.match(tsx, /setCart\(\(current\)/);
  assert.match(tsx, /linkedServices\.filter/);
});

test("active service promo is visibly distinguished from catalog price", () => {
  assert.match(tsx, /serviceHasActivePromo/);
  assert.match(tsx, /t\("سعر العرض"\)/);
  assert.match(tsx, /serviceCatalogPrice/);
  assert.match(language, /"سعر العرض": "Offer price"/);
  assert.match(css, /\.bk2-service-price\.is-promo/);
});
