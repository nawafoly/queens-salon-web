import test from 'node:test';
import assert from 'node:assert/strict';
import { compareProfiles, sampledQueryRows } from '../scripts/compare-d1-read-cost.mjs';

const q = (id, rowsRead, executions = 10, avgRowsRead = 1) =>
  ({ id, kind: 'SELECT', tables: ['clients'], executions, rowsRead, avgRowsRead, avgDurationMs: 2 });
const report = (db) => ({ period: '1d', source: 'read-only-cloudflare-analytics',
  databases: { 'queens-salon-core': db, 'malikat-attendance': { mostRowsRead: [], mostFrequent: [], slowestAverage: [] } } });
const a = 'a'.repeat(16), b = 'b'.repeat(16), c = 'c'.repeat(16);

test('deduplicates overlapping ranking groups and compares only shared fingerprints', () => {
  const baseline = report({
    mostRowsRead: [q(a, 900, 90, 10), q(b, 300, 30, 10)],
    mostFrequent: [q(a, 900, 90, 10)],
    slowestAverage: [],
  });
  const current = report({
    mostRowsRead: [q(a, 400, 80, 5), q(c, 12, 3, 4)],
    mostFrequent: [q(a, 400, 80, 5)],
    slowestAverage: [],
  });
  const outcome = compareProfiles(baseline, current);
  const core = outcome.databases['queens-salon-core'];
  assert.equal(core.baselineObservedFingerprints, 2);
  assert.equal(core.followupObservedFingerprints, 2);
  assert.equal(core.overlappingFingerprints, 1);
  assert.equal(core.compared[0].rowsRead.delta, -500);
  assert.equal(core.compared[0].rowsRead.percentChange, -55.6);
  assert.equal(core.compared[0].avgRowsRead.delta, -5);
  assert.deepEqual(core.absentFromFollowupTopN, [{ id: b, tables: ['clients'], previouslyObservedRowsRead: 300 }]);
  assert.deepEqual(core.newInFollowupTopN, [{ id: c, tables: ['clients'], observedRowsRead: 12 }]);
  assert.match(outcome.caveat, /NOT zero reads/);
  assert.match(outcome.caveat, /NOT a total daily D1 usage/);
});

test('the comparison cannot silently mistake missing 1d data for zero consumption', () => {
  assert.throws(() => compareProfiles(report({ mostRowsRead: [] }), { period: '7d', databases: {} }),
    /PERIOD_MISMATCH/);
  assert.throws(() => compareProfiles(report({ mostRowsRead: [] }), { period: '1d', databases: {} }),
    /DATABASE_MISSING/);
  assert.throws(() => compareProfiles({ period: '1d', databases: { fixture: {} } },
    { period: '1d', databases: { fixture: {} } }), /NO_SUPPORTED_DATABASE/);
});

test('redacts raw query text and accepts fingerprints only', () => {
  const out = sampledQueryRows({ mostRowsRead: [
    { ...q(a, 1), query: "SELECT * FROM clients WHERE phone = '0501234567'", tables: ['clients', 'secret note'] },
    { ...q('bad', 1), tables: ['clients'] },
  ] });
  assert.equal(out.size, 1);
  assert.deepEqual(out.get(a).tables, ['clients']);
  assert.ok(!JSON.stringify([...out.values()]).includes('0501234567'));
  assert.ok(!JSON.stringify([...out.values()]).includes('secret note'));
});

test('zero-baseline values never create infinite or fabricated percent changes', () => {
  const old = report({ mostRowsRead: [q(a, 0, 0, 0)] });
  const follow = report({ mostRowsRead: [q(a, 4, 2, 2)] });
  assert.equal(compareProfiles(old, follow).databases['queens-salon-core'].compared[0].rowsRead.percentChange, null);
});
