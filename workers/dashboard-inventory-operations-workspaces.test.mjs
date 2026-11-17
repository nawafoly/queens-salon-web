import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const modules = ["Movements","Issue","Ops","Trade","Costs","StaffLocations"];
const get = (name) => readFileSync(new URL(`../src/pages/DashboardInventory${name}.tsx`,import.meta.url),"utf8");
test("six inventory operations remain scoped, labelled and responsive", () => {
  for (const name of modules) {
    const page = get(name);
    assert.ok(page.includes("inventory-inner-workspace inventory-inner-operations"),name);
    assert.ok(page.includes("inventory-inner-operation-content"),name);
    assert.ok(page.includes("inventory-inner-intro"),name);
  }
  const css = readFileSync(new URL("../src/styles/DashboardInventoryCommandCenter.css",import.meta.url),"utf8");
  assert.ok(css.includes(".inventory-inner-operation-content table.table"));
  assert.ok(css.includes("@media(max-width:640px)"));
});
test("existing inventory APIs and authorization gates are preserved", () => {
  const checks = {
    Movements:["CoreInventoryService.listMovements"],
    Issue:["inventory.adjust"],
    Ops:["CoreInventoryService"],
    Trade:["CoreInventoryService"],
    Costs:["CoreInventoryService"],
    StaffLocations:["CoreInventoryService"]
  };
  for (const [name, required] of Object.entries(checks)) {
    const page=get(name);
    required.forEach(token=>assert.ok(page.includes(token),`${name}: ${token}`));
  }
});
