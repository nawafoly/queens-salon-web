// SQL-level regression for migration 0097; DOES NOT claim D1 endpoint coverage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  new URL('../migrations/core/0097_financial_day_revisions.sql', import.meta.url),
  'utf8'
);

function fixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE income_entries (
      id TEXT PRIMARY KEY, salon_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL, amount_halalas INTEGER, method TEXT
    );
    CREATE TABLE refunds (
      id TEXT PRIMARY KEY, salon_id TEXT NOT NULL,
      refunded_at TEXT, created_at TEXT NOT NULL,
      amount_halalas INTEGER, status TEXT
    );
    CREATE TABLE payment_correction_applied_events (
      id TEXT PRIMARY KEY, salon_id TEXT NOT NULL,
      accounting_date TEXT NOT NULL
    );
  `);
  db.exec(migration);
  return db;
}

function revision(db, salon, date) {
  return db.prepare(
    'SELECT revision FROM financial_day_revisions WHERE salon_id = ? AND audit_date = ?'
  ).get(salon, date)?.revision ?? 0;
}

test('income insert, update, move and delete bump the correct Riyadh days', t => {
  const db = fixture(t);
  const insert = db.prepare(
    'INSERT INTO income_entries (id, salon_id, occurred_at, amount_halalas, method) VALUES (?, ?, ?, ?, ?)'
  );
  insert.run('a', 'main', '2026-10-25T20:30:00.000Z', 7000, 'card');
  assert.equal(revision(db, 'main', '2026-10-25'), 1);
  assert.equal(revision(db, 'main', '2026-10-26'), 0);

  db.prepare("UPDATE income_entries SET method = 'cash' WHERE id = 'a'").run();
  assert.ok(revision(db, 'main', '2026-10-25') > 1);
  const oldRevision = revision(db, 'main', '2026-10-25');
  db.prepare("UPDATE income_entries SET occurred_at = '2026-10-25T21:30:00.000Z' WHERE id = 'a'").run();
  assert.ok(revision(db, 'main', '2026-10-25') > oldRevision);
  assert.ok(revision(db, 'main', '2026-10-26') > 0);

  const newRevision = revision(db, 'main', '2026-10-26');
  db.prepare("DELETE FROM income_entries WHERE id = 'a'").run();
  assert.ok(revision(db, 'main', '2026-10-26') > newRevision);
  assert.equal(revision(db, 'other', '2026-10-26'), 0);
});

test('refund lifecycle and correction events invalidate the right salon/day', t => {
  const db = fixture(t);
  db.prepare(
    'INSERT INTO refunds (id, salon_id, refunded_at, created_at, amount_halalas, status) VALUES (?, ?, ?, ?, ?, ?)'
  ).run('r', 'main', '2026-10-25T21:01:00.000Z', '2026-10-25T21:01:00.000Z', 100, 'completed');
  const first = revision(db, 'main', '2026-10-26');
  assert.equal(first, 1);
  db.prepare("UPDATE refunds SET status = 'voided' WHERE id = 'r'").run();
  assert.ok(revision(db, 'main', '2026-10-26') > first);
  db.prepare("DELETE FROM refunds WHERE id = 'r'").run();
  db.prepare(
    'INSERT INTO payment_correction_applied_events (id, salon_id, accounting_date) VALUES (?, ?, ?)'
  ).run('c', 'main', '2026-10-26');
  assert.ok(revision(db, 'main', '2026-10-26') > first + 1);
  assert.equal(revision(db, 'other', '2026-10-26'), 0);
});

test('SQL-boundary optimistic concurrency rejects a stale day revision', t => {
  const db = fixture(t);
  db.exec('CREATE TABLE demo_closings (salon_id TEXT, audit_date TEXT, PRIMARY KEY (salon_id, audit_date))');
  const guard = db.prepare(`
    INSERT INTO demo_closings (salon_id, audit_date)
    SELECT ?, ? WHERE COALESCE((
      SELECT revision FROM financial_day_revisions
      WHERE salon_id = ? AND audit_date = ?
    ), 0) = ?
  `);
  const initialRevision = revision(db, 'main', '2026-10-25');
  db.prepare('INSERT INTO income_entries (id, salon_id, occurred_at, amount_halalas) VALUES (?, ?, ?, ?)')
    .run('new-money', 'main', '2026-10-25T14:00:00Z', 900);
  assert.equal(guard.run('main', '2026-10-25', 'main', '2026-10-25', initialRevision).changes, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM demo_closings').get().n, 0);
  const fresh = revision(db, 'main', '2026-10-25');
  assert.equal(guard.run('main', '2026-10-25', 'main', '2026-10-25', fresh).changes, 1);
});

test('a malformed accounting timestamp fails closed instead of silently escaping revision', t => {
  const db = fixture(t);
  assert.throws(() => {
    db.prepare('INSERT INTO income_entries (id, salon_id, occurred_at) VALUES (?, ?, ?)')
      .run('invalid', 'main', 'not-a-date');
  }, /NOT NULL/i);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM income_entries').get().n, 0);
});
