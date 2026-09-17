import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dashboard = readFileSync(
  "src/pages/DashboardEmployees.tsx",
  "utf8"
);

const hrEmployees = readFileSync(
  "workers/core/repositories/hr-employees.js",
  "utf8"
);

test("DashboardEmployees preserves Core staff showOnBooking regardless of administrative login role", () => {
  assert.match(
    dashboard,
    /showOnBooking:\s*\n\s*source === "core_staff" &&\s*\n\s*specialties\.length > 0\s*\n\s*\? combined\?\.showOnBooking !== false\s*\n\s*: false/,
    "Core staff showOnBooking must be projected from Core staff without administrative-role suppression"
  );

  assert.doesNotMatch(
    dashboard,
    /showOnBooking:\s*\n\s*!administrative &&\s*\n\s*source === "core_staff"/,
    "Administrative login role must not override Core staff showOnBooking"
  );
});

test("Core HR employee save persists bookingStaff showOnBooking into staff.show_on_booking", () => {
  assert.match(
    hrEmployees,
    /show_on_booking:\s*activeFlag\([\s\S]*?bookingStaffInput\.showOnBooking/,
    "Core employee save must consume bookingStaff.showOnBooking"
  );

  assert.match(
    hrEmployees,
    /show_on_booking = excluded\.show_on_booking/,
    "Core employee save must persist show_on_booking during staff upsert"
  );
});
