import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const servicesRepository = source("./core/repositories/services.js");
const bookingsRepository = source("./core/repositories/bookings.js");
const promoPage = source("../src/pages/DashboardServicePromoPrices.tsx");
const dashboardPage = source("../src/pages/Dashboard.tsx");

test("service list exposes active promo price as the service price while preserving catalog price", () => {
  assert.match(servicesRepository, /import \{ getActivePromosMap \} from '\.\/service-promo-prices\.js';/);
  assert.match(servicesRepository, /const promos = await getActivePromosMap\(db, salonId\);/);
  assert.match(servicesRepository, /promoActive:\s*true/);
  assert.match(servicesRepository, /catalogPriceHalalas:\s*row\.price_halalas/);
  assert.match(servicesRepository, /price_halalas:\s*promo\.promo_price_halalas/);
  assert.match(servicesRepository, /priceHalalas:\s*promo\.promo_price_halalas/);
});

test("booking item pricing uses the active promo as the final unit price by default", () => {
  assert.match(bookingsRepository, /import \{ getActivePromoForService \} from '\.\/service-promo-prices\.js';/);
  assert.match(bookingsRepository, /const activePromo = await getActivePromoForService\(db, salonId, service\.id, now\);/);
  assert.match(bookingsRepository, /const effectiveCatalogUnit = activePromo/);
  assert.match(bookingsRepository, /promo_price_halalas/);
  assert.match(bookingsRepository, /item\.unitPriceHalalas \?\?[\s\S]*?effectiveCatalogUnit/);
  assert.match(bookingsRepository, /unit_price_halalas:\s*unit/);
  assert.match(bookingsRepository, /catalog_unit_price_halalas:\s*catalogUnit/);
});

test("promo prices dashboard is bilingual and receives the selected dashboard language", () => {
  assert.match(promoPage, /import type \{ DashboardLanguage \}/);
  assert.match(promoPage, /import \{ translateBookingCatalogLabel \}/);
  assert.match(promoPage, /function serviceDisplayName\(service: CoreService, language: DashboardLanguage\)/);
  assert.match(promoPage, /translateBookingCatalogLabel\(language, service\.name, "service"\)/);
  assert.match(promoPage, /title:\s*"أسعار العروض"/);
  assert.match(promoPage, /title:\s*"Promo Prices"/);
  assert.match(promoPage, /language = "ar"/);
  assert.match(promoPage, /lang=\{language\}/);
  assert.match(promoPage, /label: `\$\{serviceDisplayName\(service, language\)\}/);
  assert.match(promoPage, /<strong>\{serviceDisplayName\(service, language\)\}<\/strong>/);
  assert.match(dashboardPage, /DashboardServicePromoPrices language=\{dashboardLanguage\}/);
  assert.match(dashboardPage, /dashboardLanguage === "en" \? "Promo prices" : "أسعار العروض"/);
});

test("promo price UI remains independent from saved offers and discount applications", () => {
  assert.doesNotMatch(promoPage, /DashboardOffers/);
  assert.doesNotMatch(promoPage, /offerId/);
  assert.doesNotMatch(promoPage, /discountApplication/);
});
