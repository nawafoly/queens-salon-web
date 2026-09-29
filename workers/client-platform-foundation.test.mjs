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
import {
  getClientDirectorySummary,
  listClients,
} from './core/repositories/clients.js';

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
  assert.match(portal, /profile,[\s\S]*bookings,[\s\S]*loyalty,[\s\S]*cashback,[\s\S]*offers,[\s\S]*preferences/);
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


test('client directory search is server-side and pagination is not globally capped', () => {
  const repo = readFileSync('workers/core/repositories/clients.js', 'utf8');
  const page = readFileSync('src/pages/DashboardClients.tsx', 'utf8');
  const formatter = readFileSync('src/features/customers/customerFormatters.ts', 'utf8');

  assert.match(page, /CoreClientService\.list\(search,/);
  assert.match(page, /const PAGE_SIZE = 50/);
  assert.match(page, /limit:\s*PAGE_SIZE \+ 1/);
  assert.match(page, /offset:\s*page \* PAGE_SIZE/);
  assert.match(page, /setHasNextPage\(safeRows\.length > PAGE_SIZE\)/);
  assert.match(page, /safeRows\.slice\(0, PAGE_SIZE\)/);
  assert.match(page, /source,/);
  assert.doesNotMatch(page, /limit:\s*500/);
  assert.doesNotMatch(page, /CoreClientService\.listAll/);
  assert.match(page, /requestGenerationRef\.current/);
  assert.match(page, /const visibleCustomers = customers/);
  assert.doesNotMatch(page, /CoreClientService\.listAll/);

  assert.doesNotMatch(repo, /Math\.min\(50_000,/);
  assert.match(repo, /Math\.min\(Number\.MAX_SAFE_INTEGER,/);
  assert.match(repo, /ORDER BY c\.updated_at DESC, c\.id DESC/);
  assert.match(repo, /LIMIT \? OFFSET \?/);

  assert.match(formatter, /\[?-?\]/);
  assert.match(formatter, /\[?-?\]/);

});

test('client directory preserves localized search normalization', () => {
  const repo = readFileSync('workers/core/repositories/clients.js', 'utf8');

  assert.ok(repo.includes('function normalizeClientDirectoryDigits(value)'));
  assert.ok(repo.includes('function normalizeClientDirectorySearchText(value)'));
  assert.ok(repo.includes('normalizeClientDirectorySearchText(rawSearch)'));
  assert.ok(repo.includes('normalizePhone(normalizeClientDirectoryDigits(rawSearch))'));
  assert.ok(repo.includes('clientDirectoryNormalizedNameSql("c")'));

  assert.ok(repo.includes('CHAR(1571), CHAR(1575)'));
  assert.ok(repo.includes('CHAR(1573), CHAR(1575)'));
  assert.ok(repo.includes('CHAR(1570), CHAR(1575)'));
  assert.ok(repo.includes('CHAR(1649), CHAR(1575)'));
  assert.ok(repo.includes('CHAR(1609), CHAR(1610)'));
  assert.ok(repo.includes('CHAR(1577), CHAR(1607)'));
});

test('client loyalty directory binds the complete directory filter parameter set', () => {
  const repo = readFileSync('workers/core/repositories/clients.js', 'utf8');

  assert.match(
    repo,
    /\[salonId, \.\.\.filters\.params, limit, offset, salonId, salonId, salonId\]/
  );

  assert.doesNotMatch(
    repo,
    /\[salonId, \.\.\.filters\.searchParams, limit, offset, salonId, salonId, salonId\]/
  );
});

test('client directory empty and filtered no-results states are mutually exclusive', () => {
  const page = readFileSync('src/pages/DashboardClients.tsx', 'utf8');

  assert.match(
    page,
    /const noData =[\s\S]*?!hasActiveFilters[\s\S]*?customers\.length === 0;/
  );

  assert.match(
    page,
    /const noResults =[\s\S]*?hasActiveFilters[\s\S]*?visibleCustomers\.length === 0;/
  );
});

test('client Core search resolves common Saudi mobile formats to the same canonical phone', async () => {
  const canonicalClient = {
    id: 'client-phone-regression',
    salon_id: 'main',
    name: 'Phone Regression',
    phone_normalized: '0570142717',
    updated_at: '2026-09-28T00:00:00.000Z',
  };

  for (const search of ['0570142717', '966570142717', '+966570142717']) {
    const db = {
      __fakeD1: true,
      async all(sql, params) {
        const normalized = sql.replace(/\s+/g, ' ').trim();
        assert.match(normalized, /FROM clients/);
        return params.includes(canonicalClient.phone_normalized)
          ? [canonicalClient]
          : [];
      },
    };

    const rows = await listClients(db, 'main', {
      search,
      limit: 500,
      offset: 0,
    });

    assert.equal(rows.length, 1, search);
    assert.equal(rows[0].id, canonicalClient.id, search);
  }
});

test('client Core pagination accepts offsets beyond 50,000 without clamping', async () => {
  let observedOffset = -1;
  let observedSql = '';

  const db = {
    __fakeD1: true,
    async all(sql, params) {
      observedSql = sql.replace(/\s+/g, ' ').trim();
      observedOffset = Number(params.at(-1));
      return [];
    },
  };

  await listClients(db, 'main', {
    limit: 500,
    offset: 50_500,
  });

  assert.equal(observedOffset, 50_500);
  assert.match(
    observedSql,
    /ORDER BY updated_at DESC, id DESC LIMIT \? OFFSET \?/
  );
});


test('client Core applies directory filters before pagination', async () => {
  const cases = [
    {
      options: { segment: 'vip' },
      sql: /COALESCE\(c\.vip, 0\) = 1[\s\S]*LIMIT \? OFFSET \?/,
    },
    {
      options: { segment: 'with-bookings' },
      sql: /EXISTS \(SELECT 1 FROM bookings fb[\s\S]*fb\.deleted_at IS NULL\)[\s\S]*LIMIT \? OFFSET \?/,
    },
    {
      options: { segment: 'without-bookings' },
      sql: /NOT EXISTS \(SELECT 1 FROM bookings fb[\s\S]*fb\.deleted_at IS NULL\)[\s\S]*LIMIT \? OFFSET \?/,
    },
    {
      options: { segment: 'active-packages' },
      sql: /EXISTS \(SELECT 1 FROM client_packages fp[\s\S]*fp\.status = 'active'[\s\S]*LIMIT \? OFFSET \?/,
      parameter: (value) => typeof value === 'string' && value.includes('T'),
    },
    {
      options: { lastVisit: 'never' },
      sql: /NOT EXISTS \(SELECT 1 FROM bookings fv[\s\S]*fv\.status = 'completed'[\s\S]*LIMIT \? OFFSET \?/,
    },
    {
      options: { lastVisit: '30-days' },
      sql: /fv\.booking_date >= date\(\?, '-30 days'\)[\s\S]*LIMIT \? OFFSET \?/,
      parameter: (value) => typeof value === 'string' && value.includes('T'),
    },
    {
      options: { lastVisit: '90-days' },
      sql: /fv\.booking_date >= date\(\?, '-90 days'\)[\s\S]*LIMIT \? OFFSET \?/,
      parameter: (value) => typeof value === 'string' && value.includes('T'),
    },
  ];

  for (const testCase of cases) {
    let observedSql = '';
    let observedParams = [];

    const db = {
      __fakeD1: true,
      async all(sql, params) {
        observedSql = sql.replace(/\s+/g, ' ').trim();
        observedParams = params;
        return [];
      },
    };

    await listClients(db, 'main', {
      includeMetrics: true,
      limit: 25,
      offset: 50,
      ...testCase.options,
    });

    assert.match(observedSql, testCase.sql);
    assert.ok(
      observedSql.indexOf('EXISTS') < 0 ||
        observedSql.indexOf('EXISTS') < observedSql.indexOf('LIMIT ? OFFSET ?'),
      JSON.stringify(testCase.options)
    );

    if (testCase.parameter) {
      assert.ok(
        observedParams.some(testCase.parameter),
        JSON.stringify(testCase.options)
      );
    }
  }
});

test('client Core applies directory sort before pagination', async () => {
  const cases = [
    {
      sort: 'most',
      sql: /ORDER BY \(SELECT COUNT\(\*\) FROM bookings sb[\s\S]*DESC, c\.id DESC[\s\S]*LIMIT \? OFFSET \?/,
    },
    {
      sort: 'latest',
      sql: /ORDER BY COALESCE\(\(SELECT MAX\(sv\.booking_date \|\| ' ' \|\| sv\.start_time\)[\s\S]*DESC, c\.id DESC[\s\S]*LIMIT \? OFFSET \?/,
    },
    {
      sort: 'newest',
      sql: /ORDER BY c\.created_at DESC, c\.id DESC[\s\S]*LIMIT \? OFFSET \?/,
    },
  ];

  for (const testCase of cases) {
    let observedSql = '';

    const db = {
      __fakeD1: true,
      async all(sql) {
        observedSql = sql.replace(/\s+/g, ' ').trim();
        return [];
      },
    };

    await listClients(db, 'main', {
      includeMetrics: true,
      limit: 25,
      offset: 0,
      sort: testCase.sort,
    });

    assert.match(observedSql, testCase.sql, testCase.sort);
  }
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
  assert.match(modal, /usePermissions/);
  assert.match(modal, /hasPermission\("clients\.manage"\)/);
  assert.match(modal, /hasPermission\("clients\.packages\.manage"\)/);
  assert.match(modal, /hasPermission\("clients\.loyalty\.manage"\)/);
  assert.doesNotMatch(modal, /currentRole === "owner"/);
  assert.doesNotMatch(modal, /currentRole === "admin"/);
  assert.match(modal, /overview\?\.bookings/);
  assert.match(modal, /overview\.cashback\.balanceHalalas/);
});


test('client directory summary uses canonical status and directory filters', async () => {
  let observedSql = '';
  let observedParams = [];

  const db = {
    __fakeD1: true,
    async first(sql, params) {
      observedSql = sql.replace(/\s+/g, ' ').trim();
      observedParams = params;

      return {
        total_clients: 7,
        total_bookings: 21,
        active_clients: 5,
        new_this_month: 2,
        vip_clients: 3,
      };
    },
  };

  const result = await getClientDirectorySummary(db, 'main', {
    search: '0570142717',
    segment: 'vip',
    lastVisit: '30-days',
    source: 'combined',
  });

  assert.match(
    observedSql,
    /SELECT c\.id, c\.vip, c\.status, c\.created_at FROM clients c/
  );

  assert.match(
    observedSql,
    /TRIM\(LOWER\(COALESCE\(fc\.status, ''\)\)\) IN \('', 'active'\)/
  );

  assert.doesNotMatch(
    observedSql,
    /CASE WHEN COALESCE\(bm\.bookings_count, 0\) > 0 THEN 1/
  );

  assert.match(
    observedSql,
    /COALESCE\(c\.vip, 0\) = 1/
  );

  assert.match(
    observedSql,
    /fv\.booking_date >= date\(\?, '-30 days'\)/
  );

  assert.match(
    observedSql,
    /EXISTS \(SELECT 1 FROM bookings fs/
  );

  assert.ok(
    observedParams.includes('0570142717'),
    'directory summary must receive the canonical phone search parameter'
  );

  assert.equal(result.totalClients, 7);
  assert.equal(result.totalBookings, 21);
  assert.equal(result.activeClients, 5);
  assert.equal(result.newThisMonth, 2);
  assert.equal(result.vipClients, 3);
  assert.equal(result.averageBookings, 3);
});


test('client directory source contract has no booking-only legacy branch', () => {
  const repo = readFileSync(
    'workers/core/repositories/clients.js',
    'utf8'
  );

  const types = readFileSync(
    'src/features/customers/customerTypes.ts',
    'utf8'
  );

  const sections = readFileSync(
    'src/features/customers/CustomersPageSections.tsx',
    'utf8'
  );

  const formatters = readFileSync(
    'src/features/customers/customerFormatters.ts',
    'utf8'
  );

  assert.doesNotMatch(repo, /booking-only/);
  assert.doesNotMatch(types, /booking-only/);
  assert.doesNotMatch(sections, /booking-only/);
  assert.doesNotMatch(formatters, /booking-only/);

  assert.match(
    types,
    /CustomerSource = "combined" \| "client-record"/
  );
});


test('client directory summary and import upsert routes are wired to Core contracts', () => {
  const worker = readFileSync(
    'workers/core/index.js',
    'utf8'
  );

  assert.match(
    worker,
    /path === "\/api\/core\/clients\/directory-summary" && method === "GET"/
  );

  assert.match(
    worker,
    /return \{ name: "client:directory-summary" \}/
  );

  assert.match(
    worker,
    /case "client:directory-summary":[\s\S]*?requireRole\(ctx\.role, OPERATIONS_ROLES\)[\s\S]*?getClientDirectorySummary/
  );

  assert.match(
    worker,
    /Object\.fromEntries\(new URL\(request\.url\)\.searchParams\.entries\(\)\)/
  );

  assert.match(
    worker,
    /path === "\/api\/core\/clients\/import-upsert" && method === "POST"/
  );

  assert.match(
    worker,
    /return \{ name: "client:import-upsert" \}/
  );

  assert.match(
    worker,
    /case "client:import-upsert":[\s\S]*?requirePermission\(ctx, "clients\.manage"\)[\s\S]*?upsertImportedClient/
  );

  assert.match(
    worker,
    /action: "client_import_upserted"/
  );
});


test('client import and export use canonical Core workflows without a global directory cap', () => {
  const repo = readFileSync(
    'workers/core/repositories/clients.js',
    'utf8'
  );

  const service = readFileSync(
    'src/services/CoreClientService.ts',
    'utf8'
  );

  const modal = readFileSync(
    'src/features/customers/CustomersImportModal.tsx',
    'utf8'
  );

  const page = readFileSync(
    'src/pages/DashboardClients.tsx',
    'utf8'
  );

  assert.match(
    repo,
    /export async function upsertImportedClient/
  );

  assert.match(
    repo,
    /resolveClientIdentity\(db, salonId/
  );

  assert.match(
    repo,
    /if \(identity\.client\)/
  );

  assert.match(
    repo,
    /patchClient\([\s\S]*?identity\.client\.id[\s\S]*?importedData[\s\S]*?\)/
  );

  assert.match(
    repo,
    /return createClient\(db, salonId/
  );

  assert.match(
    service,
    /async importUpsert\(/
  );

  assert.match(
    service,
    /"\/api\/core\/clients\/import-upsert"/
  );

  assert.match(
    modal,
    /CoreClientService\.importUpsert/
  );

  assert.match(
    page,
    /const EXPORT_PAGE_SIZE = 500/
  );

  assert.match(
    page,
    /\boffset,/
  );

  assert.match(
    page,
    /limit:\s*EXPORT_PAGE_SIZE/
  );

  assert.match(
    page,
    /if \(safeBatch\.length < EXPORT_PAGE_SIZE\)[\s\S]*?break;/
  );

  assert.match(
    page,
    /offset \+= safeBatch\.length/
  );

  assert.doesNotMatch(
    page,
    /CoreClientService\.list\("",\s*\{\s*includeMetrics:\s*true,\s*limit:\s*500/
  );
});
