import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  removeMixedCategoryLine,
  splitCategoryConsumptionLine,
} from '../src/features/inventory/recipeMixing.ts';

const original = {
  key: 'recipe-1', recipeLineId: 'recipe-1', lineType: 'CATEGORY',
  inventoryItemId: 'cream-a', itemName: 'Cream A', quantity: '12', defaultQty: '12',
};
const otherLine = {
  key: 'recipe-2', recipeLineId: 'recipe-2', lineType: 'SPECIFIC_ITEM',
  inventoryItemId: 'mask', itemName: 'Mask', quantity: '3', defaultQty: '3',
};

test('one category recipe slot can split into two products without increasing total use', () => {
  const result = splitCategoryConsumptionLine([original, otherLine], 'recipe-1', 'mix-1', {
    id: 'cream-b', name: 'Cream B',
  });
  assert.equal(result.length, 3);
  assert.equal(result[0].quantity, '6');
  assert.equal(result[1].quantity, '6');
  assert.equal(result[0].recipeLineId, result[1].recipeLineId);
  assert.equal(result[1].isMixAddition, true);
  assert.equal(result[1].inventoryItemId, 'cream-b');
  assert.equal(result[2], otherLine);
  assert.equal(result.slice(0, 2).reduce((qty, row) => qty + Number(row.quantity), 0), 12);
  assert.deepEqual(removeMixedCategoryLine(result, 'mix-1'), [original, otherLine]);
});

test('mix supports three distinct products in the same category slot', () => {
  const two = splitCategoryConsumptionLine([original], 'recipe-1', 'mix-1', {
    id: 'cream-b', name: 'Cream B',
  });
  const three = splitCategoryConsumptionLine(two, 'mix-1', 'mix-2', {
    id: 'cream-c', name: 'Cream C',
  });
  assert.equal(three.length, 3);
  assert.equal(three.reduce((qty, row) => qty + Number(row.quantity), 0), 12);
  assert.deepEqual(three.map((row) => row.inventoryItemId), ['cream-a', 'cream-b', 'cream-c']);
  assert.deepEqual(removeMixedCategoryLine(three, 'mix-2').map((row) => row.quantity), ['9', '3']);
});

test('mix never changes a fixed-item recipe or duplicates the same product', () => {
  const lines = [original, otherLine];
  assert.equal(splitCategoryConsumptionLine(lines, 'recipe-2', 'mix-1', { id: 'cream-c', name: 'C' }), lines);
  assert.equal(splitCategoryConsumptionLine(lines, 'recipe-1', 'mix-1', { id: 'cream-a', name: 'A' }), lines);
  assert.equal(splitCategoryConsumptionLine(lines, 'recipe-1', 'recipe-2', { id: 'cream-b', name: 'B' }), lines);
  assert.equal(splitCategoryConsumptionLine([{ ...original, inventoryItemId: '' }], 'recipe-1', 'mix-1', { id: 'cream-b', name: 'B' }).length, 1);
  assert.equal(removeMixedCategoryLine(lines, 'recipe-1'), lines);
});

test('Core validates every material against its recipe category and totals item requirements', () => {
  const core = readFileSync(resolve('workers/core/repositories/inventory.js'), 'utf8');
  assert.match(core, /inventory:item_not_in_recipe_category/);
  assert.match(core, /SUM\(requested\.required_qty\) AS required_qty/);
  assert.match(core, /GROUP BY requested\.item_id/);
  const portal = readFileSync(resolve('src/pages/EmployeeServiceConsumption.tsx'), 'utf8');
  assert.match(portal, /splitCategoryConsumptionLine/);
  assert.match(portal, /removeMixedCategoryLine/);
  assert.match(portal, /recipeLineId: line\.recipeLineId/);
});
