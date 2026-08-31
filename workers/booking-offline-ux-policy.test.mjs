import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const publicBooking = readFileSync("src/pages/Booking.tsx", "utf8");
const checkout = readFileSync("src/pages/Checkout.tsx", "utf8");
const adminBooking = readFileSync("src/features/internal-booking-v2/BookingInternalV2.tsx", "utf8");

test("public booking does not classify Core verification failure as an unavailable slot", () => {
  assert.match(publicBooking, /BOOKING_CORE_PREFLIGHT_ERROR_CLASSIFICATION_V1/);
  assert.match(publicBooking, /reason: "core" as const, error/);
  assert.match(publicBooking, /title: "تعذر التحقق من توفر الموعد"/);
  assert.match(publicBooking, /بسبب انقطاع الاتصال\. لم يتم إنشاء الحجز/);
  const coreBranch = publicBooking.indexOf('if (failureReason === "core")');
  const timeTitle = publicBooking.indexOf('title: isStaffFailure ? "الموظفة غير متاحة للحجز" : "الوقت لم يعد متاحًا"', coreBranch);
  assert.ok(coreBranch >= 0 && timeTitle > coreBranch, "Core failure must be handled before actual staff/time invalidity");
});

test("checkout has a definite offline gate and preserves ambiguous write semantics", () => {
  assert.match(checkout, /CHECKOUT_DEFINITE_OFFLINE_GATE_V1/);
  assert.match(checkout, /navigator\.onLine === false/);
  assert.match(checkout, /لم يتم إنشاء الحجز/);
  assert.match(checkout, /CHECKOUT_CORE_CONNECTIVITY_UX_V1/);
  assert.match(checkout, /core_api:write_outcome_unknown/);
  assert.match(checkout, /نتيجة الحجز غير مؤكدة/);
  assert.match(checkout, /لا تعيدي تأكيد الحجز الآن/);
});

test("administrative booking distinguishes definite offline from unknown write outcome", () => {
  assert.match(adminBooking, /core_api:offline/);
  assert.match(adminBooking, /غير متصل بالإنترنت\. لم يتم إنشاء العميلة/);
  assert.match(adminBooking, /الناتج غير مؤكد|النتيجة غير مؤكدة/);
  assert.match(adminBooking, /core_api:write_outcome_unknown/);
  assert.match(adminBooking, /نتيجة العملية غير مؤكدة؛ لا تعيدي الحفظ/);
  assert.match(adminBooking, /افتحي صفحة الحجوزات للتحقق أولًا/);
});