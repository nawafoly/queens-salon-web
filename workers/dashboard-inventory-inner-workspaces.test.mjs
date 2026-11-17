import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (name) => readFileSync(new URL(`../src/pages/DashboardInventory${name}.tsx`, import.meta.url), "utf8");
const css = readFileSync(new URL("../src/styles/DashboardInventoryCommandCenter.css", import.meta.url), "utf8");

test("purchase order redesign retains create, add line and receive APIs", () => {
  const page = source("PurchaseOrders");
  for (const method of ["createPurchaseOrder", "addPurchaseOrderLine", "receivePurchaseOrderLine", "listPurchaseOrders"]) {
    assert.ok(page.includes(`CoreInventoryService.${method}`), method);
  }
  for (const id of ["inventory-po-supplier", "inventory-po-order-id", "inventory-po-item", "inventory-po-qty", "inventory-po-cost", "inventory-po-line", "inventory-po-received"]) {
    assert.ok(page.includes(`htmlFor="${id}"`), id);
    assert.ok(page.includes(`id="${id}"`), id);
  }
});
test("recipe redesign retains canonical permissions, validation and save endpoint", () => {
  const page = source("Recipes");
  for (const token of ["inventory.recipes.manage", "CoreInventoryService.getRecipeByService", "CoreInventoryService.saveRecipe", "nextErrors", "lineErrors", "inventory-inner-recipe-line"]) {
    assert.ok(page.includes(token), token);
  }
});
test("supplier redesign retains permissions and refresh behavior", () => {
  const page = source("Suppliers");
  for (const token of ["inventory.items.manage", "CoreInventoryService.createSupplier", "CoreInventoryService.listSuppliers", "inventory-inner-supplier-form", "inventory-inner-supplier-list"]) {
    assert.ok(page.includes(token), token);
  }
});
test("shared redesign stays scoped and adapts to mobile viewports", () => {
  for (const token of [".inventory-command-center .inventory-inner-panel", ".inventory-command-center .inventory-inner-supplier-form", "@media (max-width:640px)"]) {
    assert.ok(css.includes(token), token);
  }
});
