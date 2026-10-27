// SQL-level coverage of MALIKAT's closed-day write barrier.
// The existing Miniflare suite provides endpoint-level integration coverage.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { normalizeError } from './core/errors.js';

const revisionMigration = readFileSync(
  new URL('../migrations/core/0097_financial_day_revisions.sql', import.meta.url), 'utf8'
);
const guardMigration = readFileSync(
  new URL('../migrations/core/0098_closed_financial_day_write_guards.sql', import.meta.url), 'utf8'
);

const closed = '2026-10-25';
const inClosedDay = '2026-10-24T21:30:00.000Z'; // Oct 25 00:30 Riyadh
const inOpenDay = '2026-10-25T21:30:00.000Z'; // Oct 26 00:30 Riyadh

function fixture(t, { closeDay = true } = {}) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec(`
    CREATE TABLE day_audit_closings (
      id TEXT PRIMARY KEY, salon_id TEXT NOT NULL, audit_date TEXT NOT NULL,
      UNIQUE (salon_id, audit_date)
    );
    CREATE TABLE income_entries (
      id TEXT PRIMARY KEY, salon_id TEXT NOT NULL, occurred_at TEXT NOT NULL,
      payment_id TEXT, amount_halalas INTEGER, method TEXT
    );
    CREATE TABLE refunds (
      id TEXT PRIMARY KEY, salon_id TEXT NOT NULL,
      refunded_at TEXT, created_at TEXT NOT NULL,
      amount_halalas INTEGER, status TEXT
    );
    CREATE TABLE expense_entries (
      id TEXT PRIMARY KEY, salon_id TEXT NOT NULL,
      occurred_at TEXT NOT NULL, amount_halalas INTEGER
    );
    CREATE TABLE payments (
      id TEXT PRIMARY KEY, salon_id TEXT NOT NULL,
      paid_at TEXT, created_at TEXT NOT NULL, status TEXT NOT NULL,
      method TEXT, amount_halalas INTEGER
    );
    CREATE TABLE payment_correction_applied_events (
      id TEXT PRIMARY KEY, salon_id TEXT NOT NULL,
      accounting_date TEXT NOT NULL
    );
    CREATE TABLE payment_correction_applied_postings (
      id TEXT PRIMARY KEY, salon_id TEXT NOT NULL,
      event_id TEXT NOT NULL, accounting_date TEXT NOT NULL,
      signed_amount_halalas INTEGER
    );
  `);
  db.exec(revisionMigration);
  db.exec(guardMigration);
  if (closeDay) db.prepare('INSERT INTO day_audit_closings VALUES (?, ?, ?)').run('close-main', 'main', closed);
  return db;
}

const run = (db, sql, ...params) => db.prepare(sql).run(...params);
const count = (db, table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

function assertBlocked(runMutation, code = 'financial_day_closed') {
  assert.throws(runMutation, error => {
    assert.match(error.message, new RegExp(code));
    return true;
  });
}

test('income INSERT rejects Riyadh closed day; next day and other tenants remain writable', t => {
  const db = fixture(t);
  assertBlocked(() => run(db, 'INSERT INTO income_entries VALUES (?, ?, ?, ?, ?, ?)', 'closed', 'main', inClosedDay, null, 1, 'cash'));
  assert.equal(count(db, 'income_entries'), 0);
  run(db, 'INSERT INTO income_entries VALUES (?, ?, ?, ?, ?, ?)', 'open', 'main', inOpenDay, null, 100, 'cash');
  run(db, 'INSERT INTO income_entries VALUES (?, ?, ?, ?, ?, ?)', 'other', 'tenant-b', inClosedDay, null, 50, 'cash');
  assert.equal(count(db, 'income_entries'), 2);
});

test('income update and delete guard OLD and NEW days, including cross-tenant moves', t => {
  const db = fixture(t, { closeDay: false });
  run(db, 'INSERT INTO income_entries VALUES (?, ?, ?, ?, ?, ?)', 'closed', 'main', inClosedDay, null, 100, 'card');
  run(db, 'INSERT INTO income_entries VALUES (?, ?, ?, ?, ?, ?)', 'open', 'main', inOpenDay, null, 100, 'card');
  run(db, 'INSERT INTO day_audit_closings VALUES (?, ?, ?)', 'close-main', 'main', closed);
  assertBlocked(() => run(db, "UPDATE income_entries SET method = 'cash' WHERE id = 'closed'"));
  assertBlocked(() => run(db, 'UPDATE income_entries SET occurred_at = ? WHERE id = ?', inOpenDay, 'closed'));
  assertBlocked(() => run(db, 'UPDATE income_entries SET occurred_at = ? WHERE id = ?', inClosedDay, 'open'));
  assertBlocked(() => run(db, "UPDATE income_entries SET salon_id = 'tenant-b' WHERE id = 'closed'"));
  assertBlocked(() => run(db, "DELETE FROM income_entries WHERE id = 'closed'"));
  run(db, "UPDATE income_entries SET method = 'cash' WHERE id = 'open'");
  run(db, "DELETE FROM income_entries WHERE id = 'open'");
  assert.equal(db.prepare("SELECT method FROM income_entries WHERE id='closed'").get().method, 'card');
});

test('refund INSERT UPDATE DELETE and void use refunded_at or created_at fallback', t => {
  const db = fixture(t, { closeDay: false });
  run(db, 'INSERT INTO refunds VALUES (?, ?, ?, ?, ?, ?)', 'closed', 'main', '', inClosedDay, 150, 'completed');
  run(db, 'INSERT INTO refunds VALUES (?, ?, ?, ?, ?, ?)', 'open', 'main', inOpenDay, inOpenDay, 150, 'completed');
  run(db, 'INSERT INTO day_audit_closings VALUES (?, ?, ?)', 'close-main', 'main', closed);
  assertBlocked(() => run(db, 'INSERT INTO refunds VALUES (?, ?, ?, ?, ?, ?)', 'new', 'main', inClosedDay, inOpenDay, 5, 'completed'));
  assertBlocked(() => run(db, "UPDATE refunds SET status='voided' WHERE id='closed'"));
  assertBlocked(() => run(db, 'UPDATE refunds SET refunded_at = ? WHERE id = ?', inClosedDay, 'open'));
  assertBlocked(() => run(db, 'UPDATE refunds SET refunded_at = ? WHERE id = ?', inOpenDay, 'closed'));
  assertBlocked(() => run(db, "DELETE FROM refunds WHERE id='closed'"));
  run(db, "UPDATE refunds SET status='voided' WHERE id='open'");
  assert.equal(db.prepare("SELECT status FROM refunds WHERE id='closed'").get().status, 'completed');
});

test('expense history is immutable on a closed day, but another day remains open', t => {
  const db = fixture(t, { closeDay: false });
  run(db, 'INSERT INTO expense_entries VALUES (?, ?, ?, ?)', 'e-closed', 'main', inClosedDay, 100);
  run(db, 'INSERT INTO expense_entries VALUES (?, ?, ?, ?)', 'e-open', 'main', inOpenDay, 100);
  run(db, 'INSERT INTO day_audit_closings VALUES (?, ?, ?)', 'close-main', 'main', closed);
  assertBlocked(() => run(db, 'INSERT INTO expense_entries VALUES (?, ?, ?, ?)', 'e-new', 'main', inClosedDay, 1));
  assertBlocked(() => run(db, "UPDATE expense_entries SET amount_halalas = 1 WHERE id = 'e-closed'"));
  assertBlocked(() => run(db, 'UPDATE expense_entries SET occurred_at = ? WHERE id = ?', inClosedDay, 'e-open'));
  assertBlocked(() => run(db, "DELETE FROM expense_entries WHERE id='e-closed'"));
  run(db, "DELETE FROM expense_entries WHERE id='e-open'");
});

test('settled payments cannot be backdated or rewritten after closing', t => {
  const db = fixture(t, { closeDay: false });
  run(db, 'INSERT INTO payments VALUES (?, ?, ?, ?, ?, ?, ?)', 'closed', 'main', inClosedDay, inClosedDay, 'completed', 'card', 7000);
  run(db, 'INSERT INTO payments VALUES (?, ?, ?, ?, ?, ?, ?)', 'open', 'main', inOpenDay, inOpenDay, 'completed', 'card', 7000);
  run(db, 'INSERT INTO day_audit_closings VALUES (?, ?, ?)', 'close-main', 'main', closed);
  assertBlocked(() => run(db, 'INSERT INTO payments VALUES (?, ?, ?, ?, ?, ?, ?)', 'new', 'main', inClosedDay, inOpenDay, 'completed', 'cash', 7000));
  assertBlocked(() => run(db, "UPDATE payments SET method = 'cash' WHERE id = 'closed'"));
  assertBlocked(() => run(db, 'UPDATE payments SET paid_at = ? WHERE id = ?', inClosedDay, 'open'));
  assertBlocked(() => run(db, "DELETE FROM payments WHERE id = 'closed'"));
  run(db, "UPDATE payments SET method = 'cash' WHERE id = 'open'");
  assert.equal(db.prepare("SELECT method FROM payments WHERE id='closed'").get().method, 'card');
});

test('payment linked to a closed income date cannot be edited even if payment timestamp differs', t => {
  const db = fixture(t, { closeDay: false });
  run(db, 'INSERT INTO payments VALUES (?, ?, ?, ?, ?, ?, ?)', 'p', 'main', inOpenDay, inOpenDay, 'completed', 'card', 7000);
  run(db, 'INSERT INTO income_entries VALUES (?, ?, ?, ?, ?, ?)', 'inc', 'main', inClosedDay, 'p', 7000, 'card');
  run(db, 'INSERT INTO day_audit_closings VALUES (?, ?, ?)', 'close-main', 'main', closed);
  assertBlocked(() => run(db, "UPDATE payments SET amount_halalas = 100 WHERE id = 'p'"));
  assertBlocked(() => run(db, "DELETE FROM payments WHERE id = 'p'"));
});

test('pending payment without posted income does not affect a closed financial day', t => {
  const db = fixture(t);
  run(db, 'INSERT INTO payments VALUES (?, ?, ?, ?, ?, ?, ?)', 'pending', 'main', inClosedDay, inClosedDay, 'pending', 'card', 7000);
  run(db, "DELETE FROM payments WHERE id='pending'");
  assert.equal(count(db, 'payments'), 0);
});

test('correction applied events are blocked for closed dates; tenant isolation preserved', t => {
  const db = fixture(t);
  assertBlocked(() => run(db, 'INSERT INTO payment_correction_applied_events VALUES (?, ?, ?)', 'evt', 'main', closed));
  run(db, 'INSERT INTO payment_correction_applied_events VALUES (?, ?, ?)', 'evt-open', 'main', '2026-10-26');
  run(db, 'INSERT INTO payment_correction_applied_events VALUES (?, ?, ?)', 'evt-other', 'tenant-b', closed);
});

test('correction posting cannot change a closed event even with forged open posting date', t => {
  const db = fixture(t, { closeDay: false });
  run(db, 'INSERT INTO payment_correction_applied_events VALUES (?, ?, ?)', 'evt-closed', 'main', closed);
  run(db, 'INSERT INTO payment_correction_applied_events VALUES (?, ?, ?)', 'evt-open', 'main', '2026-10-26');
  run(db, 'INSERT INTO day_audit_closings VALUES (?, ?, ?)', 'close-main', 'main', closed);
  assertBlocked(() => run(db, 'INSERT INTO payment_correction_applied_postings VALUES (?, ?, ?, ?, ?)', 'p1', 'main', 'evt-closed', '2026-10-26', 100));
  assertBlocked(() => run(db, 'INSERT INTO payment_correction_applied_postings VALUES (?, ?, ?, ?, ?)', 'p2', 'main', 'evt-open', closed, 100));
  run(db, 'INSERT INTO payment_correction_applied_postings VALUES (?, ?, ?, ?, ?)', 'p3', 'main', 'evt-open', '2026-10-26', 100);
  assert.equal(count(db, 'payment_correction_applied_postings'), 1);
});

test('a closing cannot be updated or deleted to bypass closed-day guards', t => {
  const db = fixture(t);
  assertBlocked(() => run(db, "UPDATE day_audit_closings SET audit_date='2026-10-26' WHERE id='close-main'"), 'financial_day_closing_immutable');
  assertBlocked(() => run(db, "DELETE FROM day_audit_closings WHERE id='close-main'"), 'financial_day_closing_immutable');
  assert.equal(count(db, 'day_audit_closings'), 1);
});

test('SQL trigger conflict is translated to HTTP 409, not an unhandled 500', () => {
  const wrapped = normalizeError(new Error('D1_ERROR: financial_day_closed: SQLITE_CONSTRAINT_TRIGGER'));
  assert.equal(wrapped.status, 409);
  assert.equal(wrapped.code, 'core_finance:financial_day_closed');
  const immutable = normalizeError(new Error('D1_ERROR: financial_day_closing_immutable: SQLITE_CONSTRAINT_TRIGGER'));
  assert.equal(immutable.status, 409);
  assert.equal(immutable.code, 'core_day_audit:closing_immutable');
});

test('statement abort can be rolled back with transaction without partial financial writes', t => {
  const db = fixture(t);
  db.exec('BEGIN');
  try {
    run(db, 'INSERT INTO income_entries VALUES (?, ?, ?, ?, ?, ?)', 'open', 'main', inOpenDay, null, 100, 'cash');
    assertBlocked(() => run(db, 'INSERT INTO income_entries VALUES (?, ?, ?, ?, ?, ?)', 'blocked', 'main', inClosedDay, null, 200, 'card'));
  } finally {
    db.exec('ROLLBACK');
  }
  assert.equal(count(db, 'income_entries'), 0);
});

test('revision number is stable after rejected day-closed write', t => {
  const db = fixture(t);
  const before = db.prepare('SELECT COALESCE((SELECT revision FROM financial_day_revisions WHERE salon_id = ? AND audit_date = ?),0) AS n').get('main',closed).n;
  assertBlocked(() => run(db, 'INSERT INTO income_entries VALUES (?, ?, ?, ?, ?, ?)', 'bad','main',inClosedDay,null,100,'cash'));
  const after = db.prepare('SELECT COALESCE((SELECT revision FROM financial_day_revisions WHERE salon_id = ? AND audit_date = ?),0) AS n').get('main',closed).n;
  assert.equal(after, before);
});


test('malformed expense and settled payment timestamps fail closed', t => {
  const db = fixture(t);
  assertBlocked(() => run(db, 'INSERT INTO expense_entries VALUES (?, ?, ?, ?)', 'bad-e', 'main', 'invalid', 100), 'financial_invalid_accounting_date');
  assertBlocked(() => run(db, 'INSERT INTO payments VALUES (?, ?, ?, ?, ?, ?, ?)', 'bad-p', 'main', 'invalid', inOpenDay, 'paid', 'card', 100), 'financial_invalid_accounting_date');
  assert.equal(count(db, 'payments'), 0);
  assert.equal(count(db, 'expense_entries'), 0);
});

test('invalid correction event/posting date cannot evade closed-day checks', t => {
  const db = fixture(t);
  assertBlocked(() => run(db, 'INSERT INTO payment_correction_applied_events VALUES (?, ?, ?)', 'invalid-event', 'main', 'not-a-date'), 'financial_invalid_accounting_date');
  run(db, 'INSERT INTO payment_correction_applied_events VALUES (?, ?, ?)', 'valid-event', 'main', '2026-10-26');
  assertBlocked(() => run(db, 'INSERT INTO payment_correction_applied_postings VALUES (?, ?, ?, ?, ?)', 'invalid-post', 'main', 'valid-event', 'not-a-date', 100), 'financial_invalid_accounting_date');
  assert.equal(count(db, 'payment_correction_applied_postings'), 0);
  const error = normalizeError(new Error('D1_ERROR: financial_invalid_accounting_date: SQLITE_CONSTRAINT'));
  assert.equal(error.status, 422);
  assert.equal(error.code, 'core_finance:invalid_accounting_date');
});

test('financial close guard migration is safely idempotent', t => {
  const db = fixture(t);
  db.exec(guardMigration);
  assertBlocked(() => run(db, 'INSERT INTO income_entries VALUES (?, ?, ?, ?, ?, ?)', 'reapply', 'main', inClosedDay, null, 100, 'cash'));
});
