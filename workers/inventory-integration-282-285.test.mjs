import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = (path) => readFileSync(resolve(path), 'utf8');

test('inventory dashboard retains both newly integrated administrative workspaces', () => {
  const ui = source('src/pages/DashboardInventory.tsx');
  assert.match(ui, /import DashboardInventoryCosts/);
  assert.match(ui, /import DashboardInventoryStaffLocations/);
  assert.match(ui, /tab === "costs" && canViewCosts/);
  assert.match(ui, /tab === "staff-locations" && canManage/);
  assert.match(ui, /hasPermission\("inventory\.movements\.view"\)/);
  assert.match(ui, /hasPermission\("inventory\.items\.manage"\)/);
});

test('cost report and staff location routes coexist in Core with isolated permissions', () => {
  const worker = source('workers/core/index.js');
  for (const path of [
    '/api/core/inventory/consumption-costs',
    '/api/core/inventory/staff-home-locations',
    '/api/core/inventory/waste',
    '/api/core/inventory/consumptions/confirm',
  ]) assert.ok(worker.includes(path), `Missing route ${path}`);
  assert.equal((worker.match(/case "inventory:consumption-costs":/g) || []).length, 1);
  assert.equal((worker.match(/case "inventory:staff-home-locations":/g) || []).length, 1);
  assert.match(worker, /requirePermission\(ctx, "inventory\.movements\.view"\)/);
  assert.match(worker, /requirePermission\(ctx, "inventory\.items\.manage"\)/);
});

test('frontend service keeps mixing, disposal and reporting contracts separate', () => {
  const service = source('src/services/CoreInventoryService.ts');
  const portal = source('src/pages/EmployeeServiceConsumption.tsx');
  assert.match(service, /getConsumptionCostReport/);
  assert.match(service, /setStaffHomeLocation/);
  assert.match(service, /InventoryDisposalType/);
  assert.match(portal, /splitCategoryConsumptionLine/);
  assert.match(portal, /confirmConsumption/);
});
