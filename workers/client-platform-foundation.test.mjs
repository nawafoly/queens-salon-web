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
  const expiry = readFileSync('migrations/core/0081_cashback_expiry_lot_state.sql', 'utf8');
  const connectRateLimit = readFileSync('migrations/core/0082_client_connect_security_rate_limit.sql', 'utf8');

  assert.match(cashback, /cash_withdrawal_allowed INTEGER NOT NULL DEFAULT 0 CHECK \(cash_withdrawal_allowed = 0\)/);
  assert.match(cashback, /transfer_allowed INTEGER NOT NULL DEFAULT 0 CHECK \(transfer_allowed = 0\)/);
  assert.match(cashback, /amount_halalas INTEGER NOT NULL/);
  assert.doesNotMatch(cashback, /type IN \([^)]*withdraw/i);

  assert.match(connect, /client_connect_security_events/);
  assert.match(connect, /delivery_status IN \('sent', 'blocked'\)/);
  assert.match(connect, /split_phone_number/);
  assert.match(connect, /review_status/);

  assert.match(expiry, /cashback_expiry_lot_state/);
  assert.match(expiry, /idx_cashback_wallet_expiry_earn_scan/);
  assert.match(expiry, /PRIMARY KEY \(salon_id, source_transaction_id\)/);

  assert.match(connectRateLimit, /idx_client_connect_security_actor_recent/);
  assert.match(connectRateLimit, /conversation_id,[\s\S]*actor_uid,[\s\S]*detected_at DESC/);
});


test('MALIKAT Connect runtime foundation is part of the client platform guard', () => {
  const worker = readFileSync('workers/core/index.js', 'utf8');
  const runtime = readFileSync('workers/core/repositories/client-connect.js', 'utf8');

  assert.match(worker, /client-connect:client-conversations/);
  assert.match(worker, /client-connect:security-review/);
  assert.match(runtime, /sendConnectMessage/);
  assert.match(runtime, /delivery_status/);
});


test('client cashback is exposed through the canonical portal', () => {
  const worker = readFileSync('workers/core/index.js', 'utf8');
  const portal = readFileSync('workers/core/repositories/client-portal.js', 'utf8');

  assert.match(worker, /\/api\/core\/client\/cashback/);
  assert.match(worker, /case "client:cashback"/);
  assert.match(portal, /getSelfCashback/);
  assert.match(portal, /getClientCashbackWallet/);
  assert.match(portal, /return \{ profile, bookings, loyalty, cashback, offers/);
  assert.match(portal, /refunds,[\s\S]*loyalty,[\s\S]*cashback,[\s\S]*offersUsed/);
});


test('cashback lifecycle stays disabled until policy activation and supports closed-loop recovery', () => {
  const cashback = readFileSync('workers/core/repositories/cashback.js', 'utf8');
  const bookings = readFileSync('workers/core/repositories/bookings.js', 'utf8');
  const payments = readFileSync('workers/core/repositories/payments.js', 'utf8');
  const refunds = readFileSync('workers/core/repositories/refunds.js', 'utf8');
  const worker = readFileSync('workers/core/index.js', 'utf8');

  assert.match(cashback, /enabled: false/);
  assert.match(cashback, /earnBps: 0/);
  assert.match(cashback, /reconcileCashbackForBooking/);
  assert.match(cashback, /pendingRecoveryHalalas/);
  assert.match(cashback, /core_cashback:insufficient_balance/);
  assert.match(cashback, /cashWithdrawalAllowed: false/);
  assert.match(cashback, /transferAllowed: false/);

  assert.match(bookings, /reconcileCashbackForBooking/);
  assert.match(payments, /reconcileCashbackForBooking/);
  assert.match(refunds, /reconcileCashbackForBooking/);
  assert.match(worker, /\/api\/core\/admin\/cashback\/policy/);
  assert.match(worker, /cashback:redeem/);
  assert.match(worker, /expireCashbackCredits\(env\.CORE_DB, salonId\)/);
  assert.match(cashback, /loadCashbackLedgerRows/);
  assert.match(cashback, /recoveryHalalas/);
  assert.match(cashback, /cashback_expiry_lot_state/);
});


test('client and staff MALIKAT Connect UI uses canonical Core routes', () => {
  const service = readFileSync('src/services/ClientConnectService.ts', 'utf8');
  const profile = readFileSync('src/pages/Profile.tsx', 'utf8');
  const clientPanel = readFileSync('src/components/client/ClientConnectPanel.tsx', 'utf8');
  const inbox = readFileSync('src/pages/hr/ClientConnectInboxV2.tsx', 'utf8');
  const router = readFileSync('src/pages/hr/EmployeeMessages.tsx', 'utf8');

  assert.match(service, /\/api\/core\/client\/connect\/conversations/);
  assert.match(service, /\/api\/core\/hr\/client-connect\/conversations/);
  assert.match(service, /\/api\/core\/admin\/client-connect\/security-events/);
  assert.match(service, /assignConversation/);

  assert.match(profile, /"connect"/);
  assert.match(profile, /\/client\/connect/);
  assert.match(profile, /ClientConnectPanel/);
  assert.match(profile, /تواصلي مع مختصتك/);

  assert.match(clientPanel, /ClientConnectService\.sendClientMessage/);
  assert.match(clientPanel, /لا يمكن مشاركة أرقام الجوال أو البريد أو حسابات التواصل الخارجية/);

  assert.match(inbox, /ClientConnectService\.listStaffConversations/);
  assert.match(inbox, /ClientConnectService\.listSecurityEvents/);
  assert.match(inbox, /ClientConnectService\.reviewSecurityEvent/);
  assert.match(inbox, /ClientConnectService\.assignConversation/);
  assert.match(inbox, /يتم تسجيل فتح المراجعة في Audit Log/);

  assert.match(router, /ClientConnectInboxV2/);
  assert.match(router, /محادثات العميلات/);
  assert.match(router, /الرسائل الداخلية/);
});


test('client dashboard uses the server-side Client 360 read model', () => {
  const clientsRepo = readFileSync('workers/core/repositories/clients.js', 'utf8');
  const bookingsRepo = readFileSync('workers/core/repositories/bookings.js', 'utf8');
  const service = readFileSync('src/services/CoreClientService.ts', 'utf8');
  const page = readFileSync('src/pages/DashboardClients.tsx', 'utf8');
  const modal = readFileSync('src/features/customers/CustomerRecordModal.tsx', 'utf8');

  assert.match(clientsRepo, /wantsClientMetrics/);
  assert.match(clientsRepo, /WITH selected_clients AS/);
  assert.match(clientsRepo, /booking_metrics AS/);
  assert.match(clientsRepo, /package_metrics AS/);
  assert.match(clientsRepo, /active_packages_count/);
  assert.match(clientsRepo, /remaining_package_sessions/);

  const listStart = bookingsRepo.indexOf('export async function listBookings');
  const rowsQuery = bookingsRepo.indexOf('const rows = await dbAll', listStart);
  const clientScope = bookingsRepo.indexOf('where.push("b.client_id = ?")', listStart);
  assert.ok(clientScope > listStart && clientScope < rowsQuery, 'client filter must be pushed into SQL before the LIMIT/hydration query');

  assert.match(service, /includeMetrics\?: boolean/);
  assert.match(service, /cashback: CoreClientCashback/);
  assert.match(service, /mapCoreBooking/);
  assert.match(page, /includeMetrics:\s*true/);
  assert.doesNotMatch(page, /listCoreBookings/);
  assert.doesNotMatch(page, /PackageOperationsService/);
  assert.doesNotMatch(modal, /services\/firestoreBookings/);
  assert.match(modal, /overview\?\.bookings/);
  assert.match(modal, /overview\.cashback\.balanceHalalas/);
});
