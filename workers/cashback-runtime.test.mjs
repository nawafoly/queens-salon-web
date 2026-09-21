import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare } from 'miniflare';

import {
  getClientCashbackWallet,
  reconcileCashbackForBooking,
  redeemCashbackForBooking,
  upsertCashbackPolicy,
} from './core/repositories/cashback.js';

async function setup() {
  const script = 'export default { fetch(){ return new Response("ok") } }';
  const mf = new Miniflare({
    workers: [
      {
        config: {
          type: 'worker',
          name: 'cashback-runtime-test',
          compatibilityDate: '2026-06-24',
          manifest: {
            mainModule: 'script-0.mjs',
            modulesRoot: process.cwd(),
            modules: {
              'script-0.mjs': { type: 'esm', contents: script },
            },
          },
          env: {
            CORE_DB: { type: 'd1', id: 'cashback-runtime' },
          },
          exports: {},
        },
        dev: { rootPath: process.cwd() },
      },
    ],
  });
  const db = await mf.getD1Database('CORE_DB');

  for (const name of [
    '0001_core_schema.sql',
    '0003_booking_availability.sql',
    '0004_admin_operations.sql',
    '0006_booking_discount_snapshots.sql',
    '0079_client_cashback_wallet.sql',
  ]) {
    const raw = await readFile(new URL(`../migrations/core/${name}`, import.meta.url), 'utf8');
    const sql = raw
      .replace(/\r/g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    for (const statement of sql.split(';').map((value) => value.trim()).filter(Boolean)) {
      await db.prepare(statement).run();
    }
  }

  return { mf, db };
}

async function seedCompletedBooking(db) {
  const now = '2026-09-20T12:00:00.000Z';
  await db.prepare(`
    INSERT INTO clients
      (id, salon_id, name, phone_normalized, status, vip, created_at, updated_at)
    VALUES ('client-cashback', 'main', 'Cashback Client', '0500009999', 'active', 0, ?, ?)
  `).bind(now, now).run();

  await db.prepare(`
    INSERT INTO bookings
      (id, salon_id, client_id, booking_date, start_time, end_time, status, source,
       subtotal_halalas, discount_halalas, total_halalas, payment_status,
       package_sessions_used, created_at, updated_at, completed_at)
    VALUES
      ('booking-earned', 'main', 'client-cashback', '2026-09-20', '12:00', '13:00',
       'completed', 'internal', 50000, 0, 50000, 'paid', 0, ?, ?, ?)
  `).bind(now, now, now).run();

  await db.prepare(`
    INSERT INTO booking_items
      (id, salon_id, booking_id, service_id, service_name_snapshot, duration_minutes,
       booking_date, start_time, end_time, quantity, unit_price_halalas,
       total_halalas, final_total_halalas, created_at)
    VALUES
      ('item-earned', 'main', 'booking-earned', 'service-hair', 'Hair',
       60, '2026-09-20', '12:00', '13:00', 1, 50000, 50000, 50000, ?)
  `).bind(now).run();

  await db.prepare(`
    INSERT INTO payments
      (id, salon_id, booking_id, client_id, method, amount_halalas, status, paid_at, created_at)
    VALUES
      ('payment-earned', 'main', 'booking-earned', 'client-cashback',
       'card', 50000, 'paid', ?, ?)
  `).bind(now, now).run();

  await db.prepare(`
    INSERT INTO bookings
      (id, salon_id, client_id, booking_date, start_time, end_time, status, source,
       subtotal_halalas, discount_halalas, total_halalas, payment_status,
       package_sessions_used, created_at, updated_at)
    VALUES
      ('booking-next', 'main', 'client-cashback', '2026-09-27', '12:00', '13:00',
       'confirmed', 'internal', 10000, 0, 10000, 'unpaid', 0, ?, ?)
  `).bind(now, now).run();
}

test('cashback earns only after policy activation and remains idempotent', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());
  await seedCompletedBooking(db);

  const disabled = await reconcileCashbackForBooking(db, 'main', 'booking-earned');
  assert.equal(disabled.enabled, false);

  await upsertCashbackPolicy(
    db,
    'main',
    {
      enabled: true,
      earnBps: 1000,
      minimumEligibleHalalas: 0,
    },
    'uid-admin'
  );

  const first = await reconcileCashbackForBooking(
    db,
    'main',
    'booking-earned',
    'uid-admin'
  );
  assert.equal(first.changed, true);
  assert.equal(first.eligiblePaidHalalas, 50000);
  assert.equal(first.expectedEarnHalalas, 5000);
  assert.equal(first.deltaHalalas, 5000);

  const second = await reconcileCashbackForBooking(
    db,
    'main',
    'booking-earned',
    'uid-admin'
  );
  assert.equal(second.changed, false);
  assert.equal(second.recordedEarnHalalas, 5000);

  const count = await db.prepare(`
    SELECT COUNT(*) AS count
      FROM cashback_wallet_transactions
     WHERE salon_id = 'main'
       AND booking_id = 'booking-earned'
  `).first();
  assert.equal(Number(count.count), 1);
});

test('refunds reverse earned cashback and spent credit becomes future recovery', async (t) => {
  const { mf, db } = await setup();
  t.after(() => mf.dispose());
  await seedCompletedBooking(db);

  await upsertCashbackPolicy(
    db,
    'main',
    { enabled: true, earnBps: 1000 },
    'uid-admin'
  );
  await reconcileCashbackForBooking(db, 'main', 'booking-earned', 'uid-admin');

  await db.prepare(`
    INSERT INTO refunds
      (id, salon_id, payment_id, booking_id, client_id, amount_halalas,
       method, status, refunded_at, created_at)
    VALUES
      ('refund-1', 'main', 'payment-earned', 'booking-earned', 'client-cashback',
       20000, 'card', 'completed', '2026-09-21T10:00:00.000Z',
       '2026-09-21T10:00:00.000Z')
  `).run();

  const afterRefund = await reconcileCashbackForBooking(
    db,
    'main',
    'booking-earned',
    'uid-admin'
  );
  assert.equal(afterRefund.expectedEarnHalalas, 3000);
  assert.equal(afterRefund.deltaHalalas, -2000);

  let wallet = await getClientCashbackWallet(db, 'main', 'client-cashback');
  assert.equal(wallet.balanceHalalas, 3000);
  assert.equal(wallet.pendingRecoveryHalalas, 0);

  wallet = await redeemCashbackForBooking(
    db,
    'main',
    'client-cashback',
    {
      bookingId: 'booking-next',
      amountHalalas: 3000,
      operationId: 'redeem-next-1',
    },
    'uid-admin'
  );
  assert.equal(wallet.balanceHalalas, 0);

  await db.prepare(`
    INSERT INTO refunds
      (id, salon_id, payment_id, booking_id, client_id, amount_halalas,
       method, status, refunded_at, created_at)
    VALUES
      ('refund-2', 'main', 'payment-earned', 'booking-earned', 'client-cashback',
       10000, 'card', 'completed', '2026-09-22T10:00:00.000Z',
       '2026-09-22T10:00:00.000Z')
  `).run();

  const recovery = await reconcileCashbackForBooking(
    db,
    'main',
    'booking-earned',
    'uid-admin'
  );
  assert.equal(recovery.expectedEarnHalalas, 2000);
  assert.equal(recovery.deltaHalalas, -1000);

  wallet = await getClientCashbackWallet(db, 'main', 'client-cashback');
  assert.equal(wallet.balanceHalalas, 0);
  assert.equal(wallet.ledgerBalanceHalalas, -1000);
  assert.equal(wallet.pendingRecoveryHalalas, 1000);

  await assert.rejects(
    () =>
      redeemCashbackForBooking(
        db,
        'main',
        'client-cashback',
        {
          bookingId: 'booking-next',
          amountHalalas: 1,
          operationId: 'redeem-blocked-1',
        },
        'uid-admin'
      ),
    { code: 'core_cashback:insufficient_balance' }
  );
});
