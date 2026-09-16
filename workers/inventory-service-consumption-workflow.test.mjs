import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) =>
  readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");

test("Guard: booking create/status paths never call inventory consumption deduct", () => {
  const bookings = read("workers/core/repositories/bookings.js");
  assert.doesNotMatch(bookings, /confirmServiceConsumption/);
  assert.doesNotMatch(bookings, /SERVICE_CONSUMPTION_OUT/);
  assert.doesNotMatch(bookings, /from ['\"].*inventory/);
});

test("Guard: confirm binds booking item, SERVICE_TRACKED only, and is idempotent", () => {
  const inv = read("workers/core/repositories/inventory.js");
  assert.match(inv, /export async function confirmServiceConsumption/);
  assert.match(inv, /bookingItemId/);
  assert.match(inv, /consumption_policy !== 'SERVICE_TRACKED'/);
  assert.match(inv, /inventory:consumption_already_confirmed/);
  assert.match(inv, /idx_svc_consumptions_booking_item_confirmed|status = 'confirmed'/);
  assert.match(inv, /SERVICE_CONSUMPTION_OUT/);
  assert.match(inv, /source_type[\s\S]*service_consumption|'service_consumption'/);
});

test("Guard: pending worklist is booking-item grain and excludes confirmed", () => {
  const inv = read("workers/core/repositories/inventory.js");
  const worker = read("workers/core/index.js");
  const ui = read("src/pages/EmployeeServiceConsumption.tsx");
  const service = read("src/services/CoreInventoryService.ts");

  assert.match(inv, /export async function listPendingServiceConsumptions/);
  assert.match(inv, /sc\.status = 'confirmed'/);
  assert.match(inv, /sc\.id IS NULL/);
  assert.match(inv, /service_consumption_recipes/);
  assert.match(inv, /bi\.staff_id = \? OR b\.staff_id = \?/);

  assert.match(worker, /inventory:consumptions-pending/);
  assert.match(worker, /\/api\/core\/inventory\/consumptions\/pending/);
  assert.match(worker, /listPendingServiceConsumptions/);

  assert.match(service, /listPendingConsumptions/);
  assert.match(ui, /listPendingConsumptions/);
  assert.match(ui, /booking_item_id/);
  assert.match(ui, /refreshPending|setPending/);
  assert.match(ui, /policy: "SERVICE_TRACKED"/);
});

test("Guard: employee portal wires consumption confirm route", () => {
  const portal = read("src/pages/EmployeePortal.tsx");
  assert.match(portal, /EmployeeServiceConsumption/);
  assert.match(portal, /\/employee\/consumption/);
  assert.match(portal, /inventory\.consume\.confirm/);
});

test("Guard: recipe default qty shown and product\/qty editable before confirm", () => {
  const ui = read("src/pages/EmployeeServiceConsumption.tsx");
  assert.match(ui, /default_qty/);
  assert.match(ui, /changeProduct|inventoryItemId/);
  assert.match(ui, /<select/);
  assert.match(ui, /quantity/);
  assert.match(ui, /confirmConsumption/);
});
