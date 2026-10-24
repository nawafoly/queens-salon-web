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
    .split(/;\s*(?=CREATE\s+(?:TABLE|INDEX|TRIGGER)\b|$)/i)
    .map((statement) => statement.trim())
    .filter(Boolean);

  if (statements.length !== 9) {
    throw new Error(
      `Expected 9 SQL statements, received ${statements.length}`
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