import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('historical target transfer atomically checks ledger transfer before updating summaries', async () => {
  const source = await readFile(new URL('./core/repositories/booking-item-attribution.js', import.meta.url), 'utf8');
  assert.match(source, /\[update, audit, ledgerUpdate,/);
  assert.match(source, /\.\.\.\(summaryTransfer\.snapshots\.length \? \[assertTransferredLedger\] : \[\]\),\s*\.\.\.summaryTransfer\.statements/);
  assert.match(source, /INVALID_LEDGER_TRANSFER/);
  assert.match(source, /changes\(result\[2\]\)/);
});

test('target transfer eligibility uses persisted ledger row fields, never joined category', async () => {
  const source = await readFile(new URL('./core/repositories/booking-item-target-reconciliation.js', import.meta.url), 'utf8');
  assert.match(source, /const item = \{ service_id: serviceId \};/);
  assert.doesNotMatch(source, /const item = \{[^}]*category_id/);
  assert.match(source, /serviceIncludedByPlan\(calculated\.plan, item\)/);
});
