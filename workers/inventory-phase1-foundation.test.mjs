import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (path) =>
  readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");

test("inventory foundation migration defines ledger and consumption tables", () => {
  const migration = read("migrations/core/0069_inventory_foundation.sql");

  assert.match(migration, /CREATE TABLE IF NOT EXISTS inventory_items/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS inventory_stock_levels/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS inventory_stock_movements/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS service_consumption_recipes/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS service_consumptions/);
  assert.match(migration, /SERVICE_CONSUMPTION_OUT/);
  assert.match(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS idx_svc_consumptions_booking_item_confirmed/
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_movements_source_line_unique/
  );
});

test("inventory role grants are tenant-safe and not hard-coded to main only", () => {
  const fix = read(
    "migrations/core/0070_inventory_role_permissions_tenant_safe.sql"
  );

  assert.match(fix, /INSERT OR IGNORE INTO role_permissions/);
  assert.match(fix, /FROM roles r/);
  assert.match(fix, /CROSS JOIN/);
  assert.match(fix, /inventory\.view/);
  assert.match(fix, /inventory\.consume\.confirm/);
  assert.doesNotMatch(
    fix,
    /\('main',\s*'owner',\s*'inventory\.view'/
  );
});

test("confirmServiceConsumption enforces recipe membership before stock writes", () => {
  const source = read("workers/core/repositories/inventory.js");

  assert.match(source, /export async function confirmServiceConsumption/);
  assert.match(source, /inventory:recipe_line_not_found/);
  assert.match(source, /inventory:item_not_matching_recipe_line/);
  assert.match(source, /inventory:item_not_in_recipe_category/);
  assert.match(source, /line_type[\s\S]*SPECIFIC_ITEM/);
  assert.match(source, /line_type[\s\S]*CATEGORY/);
  assert.match(
    source,
    /FROM service_consumption_recipe_lines[\s\S]*id IN/
  );
});

test("service consumption cost is trusted-source only", () => {
  const source = read("workers/core/repositories/inventory.js");

  assert.match(source, /getTrustedUnitCostsByItemIds/);
  assert.match(source, /PURCHASE_RECEIPT_IN/);
  assert.match(source, /OPENING_BALANCE_IN/);
  // Client-supplied unit cost must not drive consumption costing path
  assert.match(
    source,
    /trustedUnitCostsByItemId/
  );
});

test("core worker exposes inventory routes and permission gates", () => {
  const worker = read("workers/core/index.js");

  assert.match(worker, /from '\.\/repositories\/inventory\.js'/);
  assert.match(worker, /inventory:categories/);
  assert.match(worker, /inventory:items/);
  assert.match(worker, /inventory:opening-balance/);
  assert.match(worker, /inventory:recipe-by-service/);
  assert.match(worker, /inventory:consumption-confirm/);
  assert.match(worker, /inventory:consumption-by-booking-item/);
  assert.match(worker, /requirePermission\(ctx, "inventory\.consume\.confirm"\)/);
  assert.match(worker, /requirePermission\(ctx, "inventory\.items\.manage"\)/);
  assert.match(worker, /requirePermission\(ctx, "inventory\.adjust"\)/);
});

test("inventory repository remains CORE D1 only", () => {
  const source = read("workers/core/repositories/inventory.js");
  const migration = read("migrations/core/0069_inventory_foundation.sql");

  assert.match(source, /CORE D1 ONLY/);
  assert.doesNotMatch(source, /firestore/i);
  assert.doesNotMatch(migration, /firestore/i);
});