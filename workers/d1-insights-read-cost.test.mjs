import test from 'node:test';
import assert from 'node:assert/strict';
import { parseInsights, summarize } from '../scripts/profile-d1-read-cost.mjs';

test('parses JSON with or without Wrangler experimental banner', () => {
  assert.equal(parseInsights('[{"query":"SELECT 1"}]').length, 1);
  assert.equal(parseInsights('warning\n[{"query":"SELECT 1"}]').length, 1);
  assert.throws(() => parseInsights('{"error":true}'), /EXPECTED_ARRAY/);
});

test('deduplicates repeated SQL across insights sort orders', () => {
  const a = { query: 'SELECT id FROM bookings', totalRowsRead: 500, numberOfTimesRun: 5 };
  const b = { query: 'SELECT id FROM staff', totalRowsRead: 10, numberOfTimesRun: 20 };
  const summary = summarize([a, b, a]);
  assert.equal(summary.queriesObserved, 2);
  assert.equal(summary.mostRowsRead[0].rowsRead, 500);
  assert.equal(summary.mostFrequent[0].executions, 20);
});

test('redacts query text, literals, and injected table-like text', () => {
  const summary = summarize([{ query: "SELECT id FROM clients WHERE mobile='0501234567' AND note='FROM secretname'", totalRowsRead: 32 }]);
  const safe = JSON.stringify(summary);
  for (const secret of ['0501234567', 'secretname', 'WHERE mobile', 'SELECT id']) assert.equal(safe.includes(secret), false);
  assert.equal(summary.mostRowsRead[0].tables[0], 'clients');
  assert.match(summary.note, /not total database consumption/);
});
