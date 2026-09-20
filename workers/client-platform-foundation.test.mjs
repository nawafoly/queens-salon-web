import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  inspectContactExchange,
  normalizeConnectText,
} from './core/repositories/contact-exchange-guard.js';
import {
  calculateCashbackEarnHalalas,
  DEFAULT_CASHBACK_POLICY,
} from './core/repositories/cashback.js';

test('MALIKAT Connect normalizes Arabic and Persian digits', () => {
  assert.equal(normalizeConnectText('٠٥٤ ۶۵۳ ٥٤٠٤'), '054 653 5404');
});

test('MALIKAT Connect blocks a normal KSA phone number', () => {
  const result = inspectContactExchange({ body: '0546535404' });
  assert.equal(result.blocked, true);
  assert.equal(result.detectionType, 'phone_number');
});

test('MALIKAT Connect blocks numeric-fragment evasion before the first digit leaks', () => {
  const result = inspectContactExchange({ body: '0' });
  assert.equal(result.blocked, true);
  assert.equal(result.detectionType, 'numeric_fragment');
});

test('MALIKAT Connect detects a split phone sequence across messages', () => {
  const result = inspectContactExchange({
    recentBodies: ['05', '46', '53', '54'],
    body: '04',
  });
  assert.equal(result.blocked, true);
  assert.ok(['numeric_fragment', 'split_phone_number'].includes(result.detectionType));
});

test('MALIKAT Connect blocks email, social handles and external links', () => {
  assert.equal(inspectContactExchange({ body: 'mail me test@example.com' }).blocked, true);
  assert.equal(inspectContactExchange({ body: 'سنابي @nawaf_123' }).blocked, true);
  assert.equal(inspectContactExchange({ body: 'https://instagram.com/example' }).blocked, true);
});

test('MALIKAT Connect allows normal salon conversation and official links', () => {
  assert.equal(inspectContactExchange({ body: 'موعدي الساعة 6:30 وأحتاج خدمتين' }).blocked, false);
  assert.equal(
    inspectContactExchange({ body: 'https://malikat.com/booking', allowedDomains: ['malikat.com'] }).blocked,
    false
  );
});

test('cashback policy is salon-only, non-withdrawable and non-transferable', () => {
  assert.equal(DEFAULT_CASHBACK_POLICY.redeemScope, 'salon_only');
  assert.equal(DEFAULT_CASHBACK_POLICY.cashWithdrawalAllowed, false);
  assert.equal(DEFAULT_CASHBACK_POLICY.transferAllowed, false);
  assert.equal(calculateCashbackEarnHalalas(50000, 1000), 5000);
});

test('client platform migrations enforce money and communication boundaries', () => {
  const cashback = readFileSync('migrations/core/0079_client_cashback_wallet.sql', 'utf8');
  const connect = readFileSync('migrations/core/0080_client_connect_foundation.sql', 'utf8');

  assert.match(cashback, /cash_withdrawal_allowed INTEGER NOT NULL DEFAULT 0 CHECK \(cash_withdrawal_allowed = 0\)/);
  assert.match(cashback, /transfer_allowed INTEGER NOT NULL DEFAULT 0 CHECK \(transfer_allowed = 0\)/);
  assert.match(cashback, /amount_halalas INTEGER NOT NULL/);
  assert.doesNotMatch(cashback, /type IN \([^)]*withdraw/i);

  assert.match(connect, /client_connect_security_events/);
  assert.match(connect, /delivery_status IN \('sent', 'blocked'\)/);
  assert.match(connect, /split_phone_number/);
  assert.match(connect, /review_status/);
});


test('MALIKAT Connect runtime foundation is part of the client platform guard', () => {
  const worker = readFileSync('workers/core/index.js', 'utf8');
  const runtime = readFileSync('workers/core/repositories/client-connect.js', 'utf8');

  assert.match(worker, /client-connect:client-conversations/);
  assert.match(worker, /client-connect:security-review/);
  assert.match(runtime, /sendConnectMessage/);
  assert.match(runtime, /delivery_status/);
});
