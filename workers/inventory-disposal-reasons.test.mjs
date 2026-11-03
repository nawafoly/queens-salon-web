import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { normalizeDisposalMovementType } from './core/repositories/inventory.js';

const read = (file) => readFileSync(resolve(file), 'utf8');

test('disposal types are strictly limited to waste, damage and expiry', () => {
  assert.equal(normalizeDisposalMovementType(undefined), 'WASTE_OUT');
  for (const kind of ['WASTE_OUT', 'DAMAGED_OUT', 'EXPIRED_OUT']) {
    assert.equal(normalizeDisposalMovementType(kind), kind);
  }
  assert.throws(() => normalizeDisposalMovementType('ADJUSTMENT_CORRECTION'), /Unsupported disposal movement type/);
  assert.throws(() => normalizeDisposalMovementType('PURCHASE_RECEIPT_IN'), /Unsupported disposal movement type/);
  assert.throws(() => normalizeDisposalMovementType('TRANSFER_OUT'), /Unsupported disposal movement type/);
});

test('disposal writes retain the same stock-deduction and audit ledger path', () => {
  const repository = read('workers/core/repositories/inventory.js');
  const start = repository.indexOf('export async function recordWaste');
  const end = repository.indexOf('export async function adjustAfterStocktake', start);
  assert.notEqual(start, -1);
  const snippet = repository.slice(start, end);
  assert.match(snippet, /normalizeDisposalMovementType/);
  assert.match(snippet, /quantityDelta: -quantity/);
  assert.match(snippet, /movementType,/);
  assert.match(snippet, /sourceType: 'WASTE'/);
  assert.match(snippet, /return appendMovement\(/);
  assert.match(read('migrations/core/0069_inventory_foundation.sql'), /'WASTE_OUT'[\s\S]*'DAMAGED_OUT'[\s\S]*'EXPIRED_OUT'/);
});

test('UI supplies the validated movement type and movements have localized labels', () => {
  const ui = read('src/pages/DashboardInventoryOps.tsx');
  assert.match(ui, /movementType: disposalType/);
  assert.match(ui, /"DAMAGED_OUT", label: "تالف"/);
  assert.match(ui, /"EXPIRED_OUT", label: "منتهي الصلاحية"/);
  const movements = read('src/pages/DashboardInventoryMovements.tsx');
  assert.match(movements, /DAMAGED_OUT: "تالف"/);
  assert.match(movements, /EXPIRED_OUT: "منتهي الصلاحية"/);
});
