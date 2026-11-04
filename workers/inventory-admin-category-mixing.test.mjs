import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildRecipeConsumptionDraft,
  removeMixedCategoryLine,
  splitCategoryConsumptionLine,
  validateRecipeConsumptionDraft,
} from '../src/features/inventory/recipeMixing.ts';

const items = [
  { id: 'dye-a', name: 'Dye A', category_id: 'dyes', unit: 'ml' },
  { id: 'dye-b', name: 'Dye B', category_id: 'dyes', unit: 'ml' },
  { id: 'dye-other', name: 'Other category', category_id: 'other', unit: 'ml' },
  { id: 'dye-grams', name: 'Wrong unit', category_id: 'dyes', unit: 'g' },
  { id: 'oxygen', name: 'Oxidizer', category_id: 'oxidizers', unit: 'ml' },
];
const recipe = [
  { id: 'recipe-category', line_type: 'CATEGORY', category_id: 'dyes', inventory_item_id: null, default_qty: 75, unit: 'ml' },
  { id: 'recipe-fixed', line_type: 'SPECIFIC_ITEM', category_id: null, inventory_item_id: 'oxygen', default_qty: 30, unit: 'ml' },
];

test('admin consumption draft retains CATEGORY and SPECIFIC_ITEM recipe lines', () => {
  const lines = buildRecipeConsumptionDraft(recipe, items);
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((line) => line.recipeLineId), ['recipe-category', 'recipe-fixed']);
  assert.deepEqual(lines.map((line) => line.inventoryItemId), ['', 'oxygen']);
  assert.deepEqual(lines.map((line) => line.quantity), ['75', '30']);
  assert.match(validateRecipeConsumptionDraft(lines, items)['recipe-category'], /اختاري منتج/);
});

test('admin can mix CATEGORY products without increasing the recipe quantity or dropping fixed lines', () => {
  const initial = buildRecipeConsumptionDraft(recipe, items);
  const selected = [{ ...initial[0], inventoryItemId: 'dye-a' }, initial[1]];
  const pendingMix = splitCategoryConsumptionLine(selected, 'recipe-category', 'mix-1', null);
  assert.deepEqual(pendingMix.map((line) => line.inventoryItemId), ['dye-a', '', 'oxygen']);
  assert.match(validateRecipeConsumptionDraft(pendingMix, items)['mix-1'], /اختاري منتج/);
  const mixed = pendingMix.map((line) => line.key === 'mix-1'
    ? { ...line, inventoryItemId: 'dye-b', itemName: 'Dye B' }
    : line);
  assert.deepEqual(mixed.map((line) => line.inventoryItemId), ['dye-a', 'dye-b', 'oxygen']);
  assert.equal(mixed.slice(0, 2).reduce((total, line) => total + Number(line.quantity), 0), 75);
  assert.equal(mixed[2].quantity, '30');
  assert.deepEqual(validateRecipeConsumptionDraft(mixed, items), {});
  assert.deepEqual(removeMixedCategoryLine(mixed, 'mix-1'), selected);
});

test('admin confirmation refuses a missing category product, invalid units or duplicate choices', () => {
  const missing = buildRecipeConsumptionDraft(recipe, items.filter((item) => item.category_id !== 'dyes'));
  assert.equal(missing[0].inventoryItemId, '');
  assert.match(validateRecipeConsumptionDraft(missing, items)['recipe-category'], /اختاري منتج/);

  const initial = buildRecipeConsumptionDraft(recipe, items);
  for (const badItem of ['dye-other', 'dye-grams']) {
    const invalid = [{ ...initial[0], inventoryItemId: badItem }, initial[1]];
    assert.match(validateRecipeConsumptionDraft(invalid, items)['recipe-category'], /لا يتبع فئة/);
  }
  const selected = [{ ...initial[0], inventoryItemId: 'dye-a' }, initial[1]];
  const duplicate = [...selected, { ...selected[0], key: 'mix-duplicate', isMixAddition: true }];
  assert.match(validateRecipeConsumptionDraft(duplicate, items)['recipe-category'], /تكرار المنتج/);
});

test('admin inventory confirmation UI uses the category-capable draft and validates before Core request', () => {
  const source = readFileSync(resolve('src/pages/DashboardInventoryConsumption.tsx'), 'utf8');
  assert.match(source, /buildRecipeConsumptionDraft\(recipeLines, trackedItems\)/);
  assert.match(source, /validateRecipeConsumptionDraft\(lines, trackedItems\)/);
  assert.match(source, /splitCategoryConsumptionLine/);
  assert.match(source, /removeMixedCategoryLine/);
  assert.match(source, /recipeLineId: line\.recipeLineId/);
  assert.match(source, /disabled=\{saving \|\| !bookingItemId \|\| !employeeId \|\| !materialLinesReady\}/);
  assert.doesNotMatch(source, /line\.line_type === "SPECIFIC_ITEM" && line\.inventory_item_id/);
});
