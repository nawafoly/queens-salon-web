import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { Miniflare } from 'miniflare';

async function database(t) {
  const mf = new Miniflare({
    workers: [{
      config: {
        name: 'applied-ledger-isolated',
        compatibilityDate: '2026-06-24',
        manifest: {
          mainModule: 'stub.mjs',
          modulesRoot: process.cwd(),
          modules: {
            'stub.mjs': {
              type: 'esm',
              contents: 'export default {fetch(){return new Response("ok")}}'
            }
          }
        },
        env: {
          CORE_DB: { type: 'd1', id: 'applied-ledger-isolated' }
        },
        exports: {}
      },
      dev: { rootPath: process.cwd() }
    }]
  });

  t.after(() => mf.dispose());

  const db = await mf.getD1Database('CORE_DB');

  const sql = await readFile(
    new URL('../migrations/core/0096_payment_correction_applied_ledger.sql', import.meta.url),
    'utf8'
  );

  // Remove comment-only lines and normalize Windows line endings.
  // Do not split inside CREATE TRIGGER ... BEGIN ... END.
  const cleaned = sql
    .split(/\r?\n/)
    .filter((line) => !/^\s*--/.test(line))
    .join('\n')
    .trim();

  const statements = cleaned
    .split(/;\s*(?=CREATE\s+(?:TABLE|(?:UNIQUE\s+)?INDEX|VIEW|TRIGGER)\b|$)/i)
    .map((statement) => statement.trim())
    .filter(Boolean);

  if (statements.length !== 11) {
    throw new Error(
      `Expected 11 SQL statements, received ${statements.length}`
    );
  }

  for (const statement of statements) {
    await db.prepare(`${statement};`).run();
  }
  return db;
}

const event = {
  id: 'e1',
  salon_id: 'main',
  proposal_id: 'q1',
  payment_id: 'p1',
  invoice_id: 'i1',
  booking_id: 'b1',
  kind: 'method_reclassification',
  original_amount_halalas: 7000,
  corrected_amount_halalas: 7000,
  amount_delta_halalas: 0,
  original_method: 'card',
  corrected_method: 'cash',
  refunded_snapshot_halalas: 0,
  invoice_paid_before_halalas: 7000,
  invoice_paid_after_halalas: 7000,
  accounting_date: '2026-10-24',
  requested_by_uid: 'reception',
  approved_by_uid: 'owner',
  applied_by_uid: 'owner',
  reason: 'Correct the original payment method',
  idempotency_key: 'k1',
  applied_at: '2026-10-24T13:00:00Z'
};

const keys = Object.keys(event);

async function addEvent(db, changes = {}) {
  const row = { ...event, ...changes };

  return db.prepare(
    `INSERT INTO payment_correction_applied_events
    (${keys.join(',')})
    VALUES (${keys.map(() => '?').join(',')})`
  ).bind(...keys.map(key => row[key])).run();
}

test('events are immutable and corrections cannot be duplicated', async t => {
  const db = await database(t);

  await addEvent(db);

  await assert.rejects(
    addEvent(db, { id: 'e2', proposal_id: 'q2' }),
    /UNIQUE|constraint/i
  );

  await assert.rejects(
    addEvent(db, { id: 'e3', idempotency_key: 'k3' }),
    /UNIQUE|constraint/i
  );

  await assert.rejects(
    addEvent(db, {
      id: 'e4',
      proposal_id: 'q4',
      idempotency_key: 'k4',
      approved_by_uid: 'reception'
    }),
    /CHECK|constraint/i
  );

  await assert.rejects(
    addEvent(db, {
      id: 'e5',
      proposal_id: 'q5',
      idempotency_key: 'k5',
      amount_delta_halalas: 1
    }),
    /CHECK|constraint/i
  );

  await assert.rejects(
    db.prepare(
      "UPDATE payment_correction_applied_events SET reason='changed' WHERE id='e1'"
    ).run(),
    /immutable/i
  );

  await assert.rejects(
    db.prepare(
      "DELETE FROM payment_correction_applied_events WHERE id='e1'"
    ).run(),
    /immutable/i
  );

  const row = await db.prepare(
    'SELECT COUNT(*) AS n FROM payment_correction_applied_events'
  ).first();

  assert.equal(row.n, 1);
});

test('signed postings are immutable and tenant isolated', async t => {
  const db = await database(t);

  await addEvent(db);

  const insert = (id, salon, channel, amount) =>
    db.prepare(
      `INSERT INTO payment_correction_applied_postings
      (id, salon_id, event_id, channel, signed_amount_halalas,
       accounting_date, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, salon, 'e1', channel, amount,
      '2026-10-24', '2026-10-24T13:00:00Z'
    ).run();

  await insert('post-card', 'main', 'card', -7000);
  await insert('post-cash', 'main', 'cash', 7000);

  await assert.rejects(
    insert('post-other', 'another-salon', 'transfer', 100),
    /FOREIGN KEY|constraint/i
  );

  await assert.rejects(
    insert('post-duplicate', 'main', 'card', 100),
    /UNIQUE|constraint/i
  );

  await assert.rejects(
    db.prepare(
      "UPDATE payment_correction_applied_postings SET signed_amount_halalas=1 WHERE id='post-card'"
    ).run(),
    /immutable/i
  );

  await assert.rejects(
    db.prepare(
      "DELETE FROM payment_correction_applied_postings WHERE id='post-card'"
    ).run(),
    /immutable/i
  );

  const totals = await db.prepare(
    `SELECT SUM(signed_amount_halalas) AS total
     FROM payment_correction_applied_postings`
  ).first();

  assert.equal(totals.total, 0);

  const count = await db.prepare(
    'SELECT COUNT(*) AS n FROM payment_correction_applied_postings'
  ).first();

  assert.equal(count.n, 2);
});

async function insertPosting(db, id, channel, amount, date = '2026-10-24') {
  return db.prepare(
    `INSERT INTO payment_correction_applied_postings
    (id, salon_id, event_id, channel, signed_amount_halalas,
     accounting_date, created_at)
    VALUES (?, 'main', 'e1', ?, ?, ?, '2026-10-24T13:00:00Z')`
  ).bind(id, channel, amount, date).run();
}

async function ledgerIntegrity(db) {
  return db.prepare(
    "SELECT * FROM payment_correction_applied_integrity WHERE event_id = 'e1'"
  ).first();
}

test('second applied correction for one payment is rejected', async t => {
  const db = await database(t);
  await addEvent(db);

  await assert.rejects(
    addEvent(db, {
      id: 'e2',
      proposal_id: 'q2',
      idempotency_key: 'k2'
    }),
    /UNIQUE|constraint/i
  );

  const count = await db.prepare(
    'SELECT COUNT(*) AS n FROM payment_correction_applied_events'
  ).first();

  assert.equal(count.n, 1);
});

test('method reclassification requires both correct channel postings', async t => {
  const db = await database(t);
  await addEvent(db);

  assert.equal((await ledgerIntegrity(db)).integrity_status, 'unbalanced');

  await insertPosting(db, 'card-out', 'card', -7000);
  assert.equal((await ledgerIntegrity(db)).integrity_status, 'unbalanced');

  await insertPosting(db, 'cash-in', 'cash', 7000);

  const result = await ledgerIntegrity(db);
  assert.equal(result.integrity_status, 'balanced');
  assert.equal(result.posted_delta_halalas, 0);
  assert.equal(result.posting_count, 2);
});

test('equal net total does not hide wrong channel allocations', async t => {
  const db = await database(t);
  await addEvent(db);

  await insertPosting(db, 'card-wrong', 'card', -6000);
  await insertPosting(db, 'cash-wrong', 'cash', 6000);

  const result = await ledgerIntegrity(db);
  assert.equal(result.posted_delta_halalas, 0);
  assert.equal(result.integrity_status, 'unbalanced');
});

test('amount correction requires exact delta and accounting date', async t => {
  const db = await database(t);

  await addEvent(db, {
    kind: 'amount_correction',
    original_method: 'cash',
    corrected_method: 'cash',
    original_amount_halalas: 7000,
    corrected_amount_halalas: 6500,
    amount_delta_halalas: -500,
    invoice_paid_after_halalas: 6500
  });

  await insertPosting(db, 'amount-out', 'cash', -500);
  assert.equal((await ledgerIntegrity(db)).integrity_status, 'balanced');
});

test('accounting date mismatch is detected', async t => {
  const db = await database(t);
  await addEvent(db);

  await insertPosting(db, 'card-other-day', 'card', -7000, '2026-10-25');
  await insertPosting(db, 'cash-correct-day', 'cash', 7000);

  assert.equal((await ledgerIntegrity(db)).integrity_status, 'unbalanced');
});