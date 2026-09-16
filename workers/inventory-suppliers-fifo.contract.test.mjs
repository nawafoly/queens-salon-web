import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const inv = readFileSync("workers/core/repositories/inventory.js", "utf8");
const idx = readFileSync("workers/core/index.js", "utf8");
const catalog = readFileSync("workers/core/repositories/catalog-admin.js", "utf8");
const trade = readFileSync("src/pages/DashboardInventoryTrade.tsx", "utf8");
const moves = readFileSync("src/pages/DashboardInventoryMovements.tsx", "utf8");

test("receivePurchase accepts and stores supplierId", () => {
  assert.match(inv, /export async function receivePurchase/);
  assert.match(inv, /supplierId/);
  assert.match(inv, /inventory:supplier_not_found/);
  assert.match(inv, /movementType: 'PURCHASE_RECEIPT_IN'/);
});

test("appendMovement insert includes supplier_id bind", () => {
  assert.match(inv, /employee_id, supplier_id, booking_id/);
  assert.match(inv, /optionalText\(input\.supplierId \|\| input\.supplier_id\)/);
  assert.match(inv, /employee_id, supplier_id, booking_id, booking_item_id, service_id/);
  const afterCols = inv.split("employee_id, supplier_id, booking_id")[1] || "";
  assert.match(afterCols, /\?, \?, \?, \?, \?/);
});

test("listMovements joins supplier name", () => {
  assert.match(inv, /s\.name AS supplier_name/);
  assert.match(inv, /LEFT JOIN inventory_suppliers s/);
  assert.match(moves, /المورد/);
  assert.match(moves, /supplier_name/);
});

test("trade tab sends supplierId on receivePurchase", () => {
  assert.match(trade, /listSuppliers/);
  assert.match(trade, /supplierId: supplierId \|\| undefined/);
});

test("suppliers route requires view or manage", () => {
  assert.match(idx, /case "inventory:suppliers":/);
  assert.match(idx, /requireAnyPermission\(ctx, \["inventory\.view", "inventory\.items\.manage"\]\)/);
  assert.match(idx, /requirePermission\(ctx, "inventory\.items\.manage"\)/);
});

test("catalog ids reject arabic and generate latin", () => {
  assert.match(catalog, /function safeCatalogId/);
  assert.match(catalog, /generatedId\(kind === 'sections' \? 'section' : 'category'\)/);
});

test("FIFO consume uses inbound layers", () => {
  assert.match(inv, /getFifoCostForQuantity/);
  assert.match(inv, /PURCHASE_RECEIPT_IN|OPENING_BALANCE_IN/);
});