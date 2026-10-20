import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare } from 'miniflare';
import { createPayment } from './core/repositories/payments.js';
import { createRefund, patchRefund, voidRefund } from './core/repositories/refunds.js';

async function setup(t) {
  const mf = new Miniflare({ workers: [{ config: {
    name: 'payments-d1-race', compatibilityDate: '2026-06-24',
    manifest: { mainModule: 'script-0.mjs', modulesRoot: process.cwd(),
      modules: { 'script-0.mjs': { type: 'esm', contents: 'export default {fetch(){return new Response("ok")}}' } } },
    env: { CORE_DB: { type: 'd1', id: 'payments-d1-race' } }, exports: {},
  }, dev: { rootPath: process.cwd() } }] });
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('CORE_DB');
  for (const name of [
    '0001_core_schema.sql', '0003_booking_availability.sql',
    '0004_admin_operations.sql', '0006_booking_discount_snapshots.sql',
    '0014_app_users_permissions.sql',
    '0079_client_cashback_wallet.sql', '0081_cashback_expiry_lot_state.sql',
  ]) {
    const sql = (await readFile(new URL(`../migrations/core/${name}`, import.meta.url), 'utf8'))
      .replace(/\r/g, '').split('\n').filter((x) => !x.trim().startsWith('--')).join('\n');
    for (const statement of sql.split(';').map((x) => x.trim()).filter(Boolean)) await db.prepare(statement).run();
  }
  const now = '2026-10-10T08:00:00.000Z';
  await db.prepare("INSERT INTO clients (id,salon_id,name,status,created_at,updated_at) VALUES ('test-client','main','Test Client','active',?,?)").bind(now,now).run();
  await db.prepare(`INSERT INTO bookings
    (id,salon_id,client_id,booking_date,start_time,end_time,status,source,subtotal_halalas,discount_halalas,total_halalas,payment_status,package_sessions_used,created_at,updated_at)
    VALUES ('test-booking','main','test-client','2026-10-10','09:00','10:00','booked','internal',10000,0,10000,'unpaid',0,?,?)`).bind(now,now).run();
  await db.prepare(`INSERT INTO invoices
    (id,salon_id,booking_id,client_id,subtotal_halalas,total_halalas,discount_halalas,paid_halalas,status,issued_at,created_at,updated_at)
    VALUES ('test-invoice','main','test-booking','test-client',10000,10000,0,0,'unpaid',?,?,?)`).bind(now,now,now).run();
  return db;
}

function gateBothInvoiceReads(db) {
  let reads = 0, open;
  const release = new Promise((resolve) => { open = resolve; });
  return {
    get reads() { return reads; },
    prepare(sql) {
      return { bind(...params) {
        const bound = db.prepare(sql).bind(...params);
        return {
          bound,
          async first() {
            const row = await bound.first();
            if (/^SELECT \* FROM invoices WHERE salon_id = \? AND id = \?/.test(sql)) {
              reads += 1;
              if (reads === 2) open();
              await release;
            }
            return row;
          },
          all: () => bound.all(), run: () => bound.run(),
        };
      }};
    },
    batch(statements) { return db.batch(statements.map((item) => item.bound)); },
  };
}

function gateBothRefundReads(db) {
  let reads = 0, open;
  const release = new Promise((resolve) => { open = resolve; });
  return {
    get reads() { return reads; },
    prepare(sql) {
      return { bind(...params) {
        const bound = db.prepare(sql).bind(...params);
        return {
          bound,
          async first() {
            const row = await bound.first();
            if (/^SELECT \* FROM refunds WHERE salon_id = \? AND id = \? LIMIT 1/.test(sql) && reads < 2) {
              reads += 1;
              if (reads === 2) open();
              await release;
            }
            return row;
          },
          all: () => bound.all(), run: () => bound.run(),
        };
      }};
    },
    batch(statements) { return db.batch(statements.map((item) => item.bound)); },
  };
}

async function table(db, query) { return (await db.prepare(query).all()).results; }

test('different concurrent payments are summed and audited from the live invoice row', async (t) => {
  const db = await setup(t), gate = gateBothInvoiceReads(db);
  const result = await Promise.all([4000, 6000].map((amount, i) =>
    createPayment(gate, 'main', {
      id: `payment-${i}`, invoiceId: 'test-invoice',
      amountHalalas: amount, method: i ? 'card' : 'cash', idempotencyKey: `key-${i}`,
    })
  ));
  assert.equal(gate.reads, 2);
  assert.equal(result.length, 2);
  assert.equal((await db.prepare("SELECT paid_halalas FROM invoices WHERE id='test-invoice'").first()).paid_halalas, 10000);
  assert.equal((await db.prepare("SELECT payment_status FROM bookings WHERE id='test-booking'").first()).payment_status, 'paid');
  const payments = await table(db, "SELECT * FROM payments WHERE invoice_id='test-invoice'");
  const incomes = await table(db, "SELECT * FROM income_entries WHERE invoice_id='test-invoice'");
  assert.equal(payments.length, 2);
  assert.equal(incomes.length, 2);
  assert.equal(payments.reduce((n, p) => n + p.amount_halalas, 0), 10000);
  const audits = (await table(db, "SELECT before_json,after_json FROM audit_logs WHERE action='invoice_payment_updated'")).map(a => ({
    before: JSON.parse(a.before_json), after: JSON.parse(a.after_json),
  })).sort((a,b) => a.before.paidHalalas - b.before.paidHalalas);
  assert.equal(audits.length, 2);
  assert.equal(audits[0].before.paidHalalas, 0);
  assert.equal(audits[0].after.paidHalalas, audits[1].before.paidHalalas);
  assert.equal(audits[1].after.paidHalalas, 10000);
  assert.equal(audits[1].after.status, 'paid');
});

test('simultaneous same idempotency key returns one committed payment and no duplicate income', async (t) => {
  const db = await setup(t), gate = gateBothInvoiceReads(db);
  const results = await Promise.all(['retry-a','retry-b'].map(id =>
    createPayment(gate, 'main', { id, invoiceId: 'test-invoice',
      amountHalalas: 4000, idempotencyKey: 'same-key' })
  ));
  assert.equal(gate.reads, 2);
  assert.equal(results[0].id, results[1].id);
  assert.equal(results.filter(p => p.idempotent).length, 1);
  assert.equal((await db.prepare("SELECT paid_halalas FROM invoices WHERE id='test-invoice'").first()).paid_halalas, 4000);
  assert.equal((await table(db, "SELECT id FROM payments WHERE idempotency_key='same-key'")).length, 1);
  assert.equal((await table(db, "SELECT id FROM income_entries WHERE invoice_id='test-invoice'")).length, 1);
  assert.equal((await table(db, "SELECT id FROM audit_logs WHERE action='invoice_payment_updated'")).length, 1);
});

async function setupRefundInvoice(db) {
  const now = '2026-10-10T08:00:00.000Z';
  await db.prepare(`INSERT INTO invoices
    (id,salon_id,booking_id,client_id,subtotal_halalas,total_halalas,discount_halalas,paid_halalas,status,issued_at,created_at,updated_at)
    VALUES ('refund-invoice','main',NULL,'test-client',20000,20000,0,5000,'partial',?,?,?)`)
    .bind(now, now, now).run();
  await db.prepare(`INSERT INTO payments
    (id,salon_id,invoice_id,client_id,method,amount_halalas,status,paid_at,created_at)
    VALUES ('seed-payment','main','refund-invoice','test-client','cash',5000,'paid',?,?)`)
    .bind(now, now).run();
}

test('a refund and a payment raced from the same invoice snapshot preserve both deltas', async (t) => {
  const db = await setup(t);
  await setupRefundInvoice(db);
  const gate = gateBothInvoiceReads(db);
  const result = await Promise.all([
    createPayment(gate, 'main', {
      id: 'refund-race-payment', invoiceId: 'refund-invoice',
      amountHalalas: 4000, idempotencyKey: 'refund-race-payment',
    }),
    createRefund(gate, 'main', {
      id: 'refund-race-refund', paymentId: 'seed-payment',
      amountHalalas: 1000, idempotencyKey: 'refund-race-refund',
    }),
  ]);
  assert.equal(gate.reads, 2);
  assert.equal(result.length, 2);
  const invoice = await db.prepare("SELECT paid_halalas,status FROM invoices WHERE id='refund-invoice'").first();
  assert.equal(invoice.paid_halalas, 8000, '5,000 + 4,000 - 1,000 must not lose the payment');
  assert.equal(invoice.status, 'partial');
  assert.equal((await table(db, "SELECT id FROM payments WHERE invoice_id='refund-invoice'")).length, 2);
  assert.equal((await table(db, "SELECT id FROM refunds WHERE invoice_id='refund-invoice'")).length, 1);
  const invoiceAudit = (await table(db, "SELECT before_json,after_json FROM audit_logs WHERE action='invoice_payment_updated' AND entity_id='refund-invoice'"))[0];
  assert.ok(invoiceAudit, 'payment keeps its own accurate transaction-time audit');
  const before = JSON.parse(invoiceAudit.before_json).paidHalalas;
  const after = JSON.parse(invoiceAudit.after_json).paidHalalas;
  assert.equal(after - before, 4000);
});

test('refund amount edits and void restore only their delta against the live invoice row', async (t) => {
  const db = await setup(t);
  await setupRefundInvoice(db);
  const original = await createRefund(db, 'main', {
    id: 'refund-edit', paymentId: 'seed-payment', amountHalalas: 1000,
  });
  assert.equal(original.amount_halalas, 1000);
  assert.equal((await db.prepare("SELECT paid_halalas FROM invoices WHERE id='refund-invoice'").first()).paid_halalas, 4000);
  const patched = await patchRefund(db, 'main', 'refund-edit', { amountHalalas: 1500 });
  assert.equal(patched.amount_halalas, 1500);
  assert.equal((await db.prepare("SELECT paid_halalas FROM invoices WHERE id='refund-invoice'").first()).paid_halalas, 3500);
  const voided = await voidRefund(db, 'main', 'refund-edit');
  assert.equal(voided.status, 'voided');
  assert.equal((await db.prepare("SELECT paid_halalas FROM invoices WHERE id='refund-invoice'").first()).paid_halalas, 5000);
});

test('two simultaneous voids of one refund credit the invoice only once', async (t) => {
  const db = await setup(t);
  await setupRefundInvoice(db);
  await createRefund(db, 'main', { id: 'void-race', paymentId: 'seed-payment', amountHalalas: 1000 });
  const gate = gateBothRefundReads(db);
  const results = await Promise.all([
    voidRefund(gate, 'main', 'void-race'), voidRefund(gate, 'main', 'void-race'),
  ]);
  assert.equal(gate.reads, 2);
  assert.equal((await db.prepare("SELECT paid_halalas FROM invoices WHERE id='refund-invoice'").first()).paid_halalas, 5000);
  assert.equal(results.filter(p => p.idempotent).length, 1);
  assert.equal((await table(db, "SELECT id FROM audit_logs WHERE action='refund_voided' AND entity_id='void-race'")).length, 1);
});

test('raced edits to one refund reject a stale update without double subtracting', async (t) => {
  const db = await setup(t);
  await setupRefundInvoice(db);
  await createRefund(db, 'main', { id: 'edit-race', paymentId: 'seed-payment', amountHalalas: 1000 });
  const gate = gateBothRefundReads(db);
  const result = await Promise.allSettled([
    patchRefund(gate, 'main', 'edit-race', { amountHalalas: 1500 }),
    patchRefund(gate, 'main', 'edit-race', { amountHalalas: 2000 }),
  ]);
  assert.equal(gate.reads, 2);
  const accepted = result.filter(p => p.status === 'fulfilled');
  assert.equal(accepted.length, 1);
  const rejected = result.find(p => p.status === 'rejected');
  assert.equal(rejected.reason.code, 'core_refund:concurrent_modification');
  const refund = await db.prepare("SELECT amount_halalas FROM refunds WHERE id='edit-race'").first();
  const invoice = await db.prepare("SELECT paid_halalas FROM invoices WHERE id='refund-invoice'").first();
  assert.equal(invoice.paid_halalas, 5000 - refund.amount_halalas);
});

test('concurrent distinct refunds cannot exceed the original payment budget', async (t) => {
  const db = await setup(t);
  await setupRefundInvoice(db);
  let checks = 0, open;
  const release = new Promise((resolve) => { open = resolve; });
  const racing = {
    prepare(sql) {
      return { bind(...params) {
        const bound = db.prepare(sql).bind(...params);
        return {
          bound,
          async first() {
            const row = await bound.first();
            if (sql.startsWith("SELECT COALESCE(SUM(amount_halalas), 0) AS total FROM refunds") && checks < 2) {
              checks += 1;
              if (checks === 2) open();
              await release;
            }
            return row;
          },
          all: () => bound.all(), run: () => bound.run(),
        };
      }};
    },
    batch(statements) { return db.batch(statements.map((statement) => statement.bound)); },
  };
  const results = await Promise.allSettled(['refund-cap-a','refund-cap-b'].map(id =>
    createRefund(racing, 'main', {
      id, paymentId: 'seed-payment', amountHalalas: 3000, idempotencyKey: id,
    })
  ));
  assert.equal(checks, 2, 'both requests must pass their stale preflight refund sum');
  assert.equal(results.filter(p => p.status === 'fulfilled').length, 1);
  const denied = results.find(p => p.status === 'rejected');
  assert.equal(denied.reason.code, 'core_refund:amount_exceeds_remaining');
  assert.equal((await db.prepare("SELECT paid_halalas FROM invoices WHERE id='refund-invoice'").first()).paid_halalas, 2000);
  const refunds = await table(db, "SELECT * FROM refunds WHERE payment_id='seed-payment' AND status='completed'");
  assert.equal(refunds.length, 1);
  assert.equal(refunds[0].amount_halalas, 3000);
  assert.equal((await table(db, "SELECT id FROM audit_logs WHERE action='refund_created'")).length, 1);
});

test('invoice lookups do not cross salon boundaries', async (t) => {
  const db = await setup(t);
  await assert.rejects(
    createPayment(db, 'other-salon', { id: 'cross-salon', invoiceId: 'test-invoice', amountHalalas: 100 }),
    (error) => error?.code === 'core_invoice:not_found'
  );
  assert.equal((await table(db, 'SELECT id FROM payments')).length, 0);
});
