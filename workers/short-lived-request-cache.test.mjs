import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createShortLivedRequestCache } from '../src/helpers/shortLivedRequestCache.ts';

test('coalesces concurrent client directory summary requests without caching indefinitely', async () => {
  let now = 1000, calls = 0;
  const cache = createShortLivedRequestCache(10_000, () => now);
  const fetcher = async () => { calls += 1; return { totalClients: 1449 }; };
  const a = cache.load('main|all', fetcher);
  const b = cache.load('main|all', fetcher);
  assert.strictEqual(a, b, 'simultaneous requests share one in-flight promise');
  assert.deepEqual(await a, { totalClients: 1449 });
  assert.equal(calls, 1);
  await cache.load('main|all', fetcher);
  assert.equal(calls, 1, 'paging and sorting reuse the same aggregate briefly');
  now += 10_001;
  await cache.load('main|all', fetcher);
  assert.equal(calls, 2, 'expiry forces re-read from authoritative Core');
  await cache.load('main|vip', fetcher);
  assert.equal(calls, 3, 'changing filters has an independent key');
});

test('refresh and mutations bypass cached counts and invalidate in-flight work', async () => {
  let now = 1000, calls = 0;
  const cache = createShortLivedRequestCache(10_000, () => now);
  let finishOld;
  const old = cache.load('main', () => new Promise((resolve) => { finishOld = resolve; }));
  await Promise.resolve();
  const fresh = cache.load('main', async () => { calls += 1; return { totalClients: 1520 }; }, true);
  assert.deepEqual(await fresh, { totalClients: 1520 });
  finishOld({ totalClients: 1300 });
  await old;
  assert.deepEqual(await cache.load('main', async () => ({ totalClients: -1 })), { totalClients: 1520 }, 'stale in-flight request cannot overwrite refreshed aggregate');
  assert.equal(calls, 1);
  cache.invalidate();
  assert.deepEqual(await cache.load('main', async () => ({ totalClients: 1521 })), { totalClients: 1521 });
});

test('failed reads do not poison subsequent requests', async () => {
  const cache = createShortLivedRequestCache(10_000);
  await assert.rejects(cache.load('main', async () => { throw new Error('temporary'); }), /temporary/);
  assert.deepEqual(await cache.load('main', async () => ({ totalClients: 4 })), { totalClients: 4 });
});

test('directory page always refreshes summary after explicit refresh, import and client edit', () => {
  const source = readFileSync(new URL('../src/pages/DashboardClients.tsx', import.meta.url), 'utf8');
  assert.match(source, /summaryCacheRef\.current\.load\(/);
  assert.match(source, /JSON\.stringify\(\[currentRole, search, segment, lastVisit, source\]\)/);
  assert.match(source, /onRefresh=\{\(\) => void loadData\(true\)\}/);
  assert.match(source, /const handleCustomerUpdated = async[\s\S]*?await loadData\(true\)/);
  assert.match(source, /onImported=\{async \(\) => \{[\s\S]*?await loadData\(true\)/);
  assert.match(source, /CoreClientService\.list\(search, \{[\s\S]*?limit: PAGE_SIZE \+ 1,[\s\S]*?offset: page \* PAGE_SIZE/);
  assert.match(source, /const EXPORT_PAGE_SIZE = 500;[\s\S]*?while \(true\)/, 'export still paginates all clients; not capped at 500');
});
