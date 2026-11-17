import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../src/pages/DashboardInventory.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles/DashboardInventoryCommandCenter.css", import.meta.url), "utf8");

test("inventory navigation preserves every operational workspace and permission boundary", () => {
  for (const id of ["items", "recipes", "consume", "moves", "issue", "ops", "trade", "suppliers", "po", "costs", "staff-locations"]) {
    assert.ok(page.includes(`id: "${id}"`), `missing tab ${id}`);
  }
  assert.ok(page.includes('item.id === "costs" ? canViewCosts'));
  assert.ok(page.includes('item.id === "staff-locations" ? canManage'));
  assert.ok(page.includes('tab === "costs" && canViewCosts'));
  assert.ok(page.includes('tab === "staff-locations" && canManage'));
});
test("inventory mutations and stock logic remain backed by Core service", () => {
  assert.ok(page.includes("CoreInventoryService.createItem(payload)"));
  assert.ok(page.includes("CoreInventoryService.updateItem(editing.id, payload)"));
  assert.ok(page.includes("CoreInventoryService.recordOpeningBalance"));
  assert.ok(page.includes("CoreInventoryService.listStockLevels()"));
  assert.ok(page.includes("CoreInventoryService.listLocations()"));
});
test("inventory dashboard contains responsive scrollable tabs, real summary counts, and accessible search", () => {
  assert.ok(page.includes("inventory-command-stats"));
  assert.ok(page.includes("inventory-command-tabs"));
  assert.ok(page.includes("aria-label=\"أقسام المخزون\""));
  assert.ok(page.includes("type=\"search\""));
  assert.ok(page.includes('onClick={() => { setSearch(""); void load(""); }}'));
  assert.match(css, /\.inventory-command-tabs\s*\{[^}]*overflow-x:\s*auto/);
  assert.match(css, /@media\s*\(max-width:\s*640px\)/);
});
