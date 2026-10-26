// Query-level SQLite regression: >500 rows, legacy missing refund timestamps,
// Riyadh midnight, tenant boundaries, and expression-index plans.
// The existing Miniflare suite remains the endpoint integration gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { buildDayAuditPageQuery, DAY_AUDIT_PAGE_SIZE } from './core/repositories/day-audit-queries.js';

const migration = readFileSync(
  new URL('../migrations/core/0099_day_audit_query_indexes.sql', import.meta.url), 'utf8'
);

function setup(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE bookings (id TEXT PRIMARY KEY, salon_id TEXT NOT NULL, booking_date TEXT);
    CREATE TABLE income_entries (
      id TEXT PRIMARY KEY, salon_id TEXT NOT NULL, booking_id TEXT,
      source TEXT, occurred_at TEXT NOT NULL
    );
    CREATE TABLE refunds (
      id TEXT PRIMARY KEY, salon_id TEXT NOT NULL,
      refunded_at TEXT, created_at TEXT NOT NULL,
      status TEXT, amount_halalas INTEGER, method TEXT
    );
  `);
  db.exec(migration);
  // Index migrations must be repeatable.
  db.exec(migration);
  return db;
}

function pageAll(db, kind, salon, day) {
  const ids = [];
  let cursor = null;
  let pageCount = 0;
  for (;;) {
    assert.ok(pageCount++ < 20, 'Pagination never advances');
    const { sql, params, cursorColumn } = buildDayAuditPageQuery(kind, salon, day, cursor);
    const page = db.prepare(sql).all(...params);
    assert.ok(page.length <= DAY_AUDIT_PAGE_SIZE);
    ids.push(...page.map(row => row.id));
    if (page.length < DAY_AUDIT_PAGE_SIZE) break;
    const last = page.at(-1);
    assert.ok(last[cursorColumn], 'Full-page cursor timestamp must exist');
    cursor = { timestamp: last[cursorColumn], id: last.id };
  }
  assert.equal(ids.length, new Set(ids).size, 'Duplicate accounting row');
  return ids;
}

function checkIndexPlan(db, kind) {
  const { sql, params } = buildDayAuditPageQuery(kind, 'main', '2026-10-25');
  const plan = db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...params)
    .map(row => row.detail).join('\n');
  const expected = kind === 'income'
    ? 'idx_core_income_audit_day_page'
    : 'idx_core_refunds_audit_day_page';
  assert.match(plan, new RegExp(expected));
  assert.doesNotMatch(plan, /USE TEMP B-TREE/i);
}

test('income date filtering and pagination use date and timestamp index across 610 rows', t => {
  const db = setup(t);
  const stmt = db.prepare(
    `INSERT INTO income_entries (id,salon_id,booking_id,source,occurred_at)
     VALUES (?,?,?,?,?)`
  );
  for (let i = 0; i < 610; i++) {
    // All timestamp ties exercise the ID desc keyset, including boundary 250/500.
    stmt.run(`income-${String(i).padStart(4,'0')}`, 'main', null, 'invoice', '2026-10-24T21:30:00.000Z');
  }
  stmt.run('yesterday', 'main', null, 'invoice', '2026-10-24T20:59:59.999Z');
  stmt.run('tomorrow', 'main', null, 'invoice', '2026-10-25T21:00:00.000Z');
  stmt.run('foreign', 'other', null, 'invoice', '2026-10-24T21:30:00.000Z');
  const ids = pageAll(db, 'income', 'main', '2026-10-25');
  assert.equal(ids.length, 610);
  assert.equal(ids[0], 'income-0609');
  assert.equal(ids.at(-1), 'income-0000');
  checkIndexPlan(db, 'income');
});

test('refund pagination handles NULL, empty, whitespace and real refunded_at across >500 rows', t => {
  const db = setup(t);
  const stmt = db.prepare(
    `INSERT INTO refunds (id,salon_id,refunded_at,created_at,status,amount_halalas,method)
     VALUES (?,?,?,?,?,?,?)`
  );
  for (let i = 0; i < 610; i++) {
    const refundedAt = [null, '', '   ', '2026-10-24T21:30:00.000Z'][i % 4];
    stmt.run(`refund-${String(i).padStart(4,'0')}`, 'main', refundedAt,
      '2026-10-24T21:30:00.000Z', 'completed', 100, 'cash');
  }
  stmt.run('outside-before', 'main', null, '2026-10-24T20:59:59.999Z', 'completed', 100, 'cash');
  stmt.run('outside-after', 'main', '2026-10-25T21:00:00.000Z', '2026-10-24T21:30:00.000Z', 'completed', 100, 'cash');
  stmt.run('foreign', 'other', null, '2026-10-24T21:30:00.000Z', 'completed', 100, 'cash');
  const ids = pageAll(db, 'refund', 'main', '2026-10-25');
  assert.equal(ids.length, 610);
  assert.equal(ids[0], 'refund-0609');
  assert.equal(ids.at(-1), 'refund-0000');
  checkIndexPlan(db, 'refund');
});

test('refund cursor sorts by effective timestamp rather than bare refunded_at', t => {
  const db = setup(t);
  const stmt = db.prepare(
    `INSERT INTO refunds (id,salon_id,refunded_at,created_at,status)
     VALUES (?,?,?,?,?)`
  );
  stmt.run('missing-late', 'main', null, '2026-10-25T20:50:00Z', 'completed');
  stmt.run('explicit-early', 'main', '2026-10-25T01:00:00Z', '2026-10-25T20:50:00Z', 'completed');
  stmt.run('blank-middle', 'main', '  ', '2026-10-25T10:00:00Z', 'completed');
  const { sql, params, cursorColumn } = buildDayAuditPageQuery('refund','main','2026-10-25');
  assert.equal(cursorColumn, 'audit_cursor_timestamp');
  assert.deepEqual(db.prepare(sql).all(...params).map(row => row.id), [
    'missing-late', 'blank-middle', 'explicit-early'
  ]);
  const next = buildDayAuditPageQuery('refund','main','2026-10-25',{
    timestamp: '2026-10-25T10:00:00Z', id: 'blank-middle'
  });
  assert.deepEqual(db.prepare(next.sql).all(...next.params).map(row => row.id), [
    'explicit-early'
  ]);
});

test('SQL builder rejects invalid kinds and incomplete cursors', () => {
  assert.throws(() => buildDayAuditPageQuery('anything', 'main', '2026-10-25'));
  assert.throws(() => buildDayAuditPageQuery('refund', 'main', '2026-10-25', { timestamp: '', id: 'a' }));
});
