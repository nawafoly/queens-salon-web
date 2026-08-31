import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tsx = readFileSync("src/features/internal-booking-v2/BookingInternalV2.tsx", "utf8");
const css = readFileSync("src/features/internal-booking-v2/booking-internal-v2.css", "utf8");

test("internal booking checks exact phone before client create", () => {
  assert.match(tsx, /CLIENT_PHONE_DEDUP_UI_V1/);
  assert.match(tsx, /const findExistingClientByPhone = useCallback/);
  assert.match(tsx, /phone10Digits\(row\?\.(?:phone|mobile)/);
  const flowStart = tsx.indexOf("const createNewClient = useCallback");
  const lookupAt = tsx.indexOf("await findExistingClientByPhone(phone)", flowStart);
  const createAt = tsx.indexOf("resolveCoreBookingDataSource().createClient", flowStart);
  assert.ok(flowStart >= 0 && lookupAt > flowStart, "create flow must contain phone lookup");
  assert.ok(createAt > lookupAt, "phone lookup must happen before createClient");
});

test("existing phone is surfaced as an explicit choose-existing-client UI", () => {
  assert.match(tsx, /عميلة مسجلة بهذا الرقم/);
  assert.match(tsx, /لن يتم إنشاء سجل جديد/);
  assert.match(tsx, /اختيار العميلة الموجودة/);
  assert.match(tsx, /الاسم الذي كتبتيه مختلف عن الاسم المسجل/);
  assert.match(css, /\.bk2-existing-client-match/);
  assert.match(css, /\.bk2-client-identity-check\.is-clear/);
});