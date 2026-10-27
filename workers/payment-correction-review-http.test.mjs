import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { AppError } from './core/errors.js';
import {
  handlePaymentCorrectionReviewRequest,
  isPaymentCorrectionReviewRequest,
} from './core/payment-correction-review-http.js';

const PATH = '/api/core/payment-corrections/proposals/proposal-123/impact';
const ORIGIN = 'https://malikat.example';
const enabled = {
  FINANCE_CORRECTION_REVIEW_ENABLED: 'true',
  ALLOWED_ORIGINS: ORIGIN,
};
const permissions = [
  'income.view',
  'bookings.payment.manage',
  'bookings.day_audit.manage',
];

function request(path = PATH, method = 'GET', origin = ORIGIN) {
  return new Request(`https://malikat.example${path}`, {
    method,
    headers: { Origin: origin },
  });
}

function ctx(overrides = {}) {
  return {
    identity: { uid: 'admin-1' },
    user: { id: 'user-1', primary_role: 'admin' },
    role: 'admin',
    permissions,
    salonId: 'tenant-a',
    coreDb: { source: 'canonical-d1' },
    ...overrides,
  };
}

function deps(context = ctx()) {
  const calls = [];
  return {
    calls,
    authContext: async () => {
      calls.push('auth');
      return context;
    },
    previewImpact: async (db, salonId, proposalId) => {
      calls.push({ db, salonId, proposalId });
      return { proposalId, isReadOnly: true, amountDeltaHalalas: 0 };
    },
  };
}

test('correction preview route matches only the exact Core namespace', () => {
  assert.equal(isPaymentCorrectionReviewRequest(request()), true);
  assert.equal(isPaymentCorrectionReviewRequest(request('/api/core/payment-corrections')), true);
  assert.equal(isPaymentCorrectionReviewRequest(request('/api/core/payment-corrections-bypass')), false);
  assert.equal(isPaymentCorrectionReviewRequest(request('/api/core/day-audit')), false);
});

test('review API is fail-closed by default before auth or D1 access', async () => {
  for (const flag of [undefined, '', 'TRUE', '1', 'false']) {
    const fake = deps();
    const response = await handlePaymentCorrectionReviewRequest(request(), {
      ALLOWED_ORIGINS: ORIGIN,
      FINANCE_CORRECTION_REVIEW_ENABLED: flag,
    }, fake);
    assert.equal(response.status, 404);
    assert.deepEqual(fake.calls, []);
  }
});

test('only read-only GET routes are allowed, never submit or apply', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const fake = deps();
    const res = await handlePaymentCorrectionReviewRequest(request(PATH, method), enabled, fake);
    assert.equal(res.status, 405, method);
    assert.deepEqual(fake.calls, []);
  }
  const fake = deps();
  const res = await handlePaymentCorrectionReviewRequest(
    request('/api/core/payment-corrections/proposals/proposal-123/apply'), enabled, fake
  );
  assert.equal(res.status, 404);
  assert.deepEqual(fake.calls, []);
});

test('permission and administrative role checks prevent unauthorized previews', async () => {
  const deniedContexts = [
    [ctx({ user: null }), 401],
    [ctx({ identity: { uid: '' } }), 401],
    [ctx({ role: 'reception' }), 403],
    [ctx({ role: 'accountant' }), 403],
    [ctx({ role: 'admin', permissions: permissions.filter(p => p !== 'income.view') }), 403],
    [ctx({ role: 'admin', permissions: permissions.filter(p => p !== 'bookings.payment.manage') }), 403],
    [ctx({ role: 'admin', permissions: permissions.filter(p => p !== 'bookings.day_audit.manage') }), 403],
  ];
  for (const [context, expected] of deniedContexts) {
    const fake = deps(context);
    const response = await handlePaymentCorrectionReviewRequest(request(), enabled, fake);
    assert.equal(response.status, expected);
    assert.equal(fake.calls.filter(c => typeof c !== 'string').length, 0);
  }
});

test('authorized reviews are tenant-scoped to authenticated D1 context', async () => {
  const context = ctx();
  const fake = deps(context);
  const response = await handlePaymentCorrectionReviewRequest(
    request(`${PATH}?salon_id=other-tenant`), enabled, fake
  );
  assert.equal(response.status, 200);
  assert.deepEqual(fake.calls[1], {
    db: context.coreDb,
    salonId: 'tenant-a',
    proposalId: 'proposal-123',
  });
  assert.equal((await response.json()).data.isReadOnly, true);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

test('owner may review only when feature flag enabled and authenticated', async () => {
  const fake = deps(ctx({ role: 'owner', permissions: [] }));
  const res = await handlePaymentCorrectionReviewRequest(request(), enabled, fake);
  assert.equal(res.status, 200);
  assert.equal(fake.calls.length, 2);
});

test('missing proposal, malformed path and tenant-scoped not-found are handled safely', async () => {
  const fake = deps();
  const invalid = await handlePaymentCorrectionReviewRequest(
    request('/api/core/payment-corrections/proposals/a%2Fb/impact'), enabled, fake
  );
  assert.equal(invalid.status, 404);
  assert.equal(fake.calls.length, 0);

  const missing = await handlePaymentCorrectionReviewRequest(request(), enabled, {
    authContext: async () => ctx(),
    previewImpact: async () => {
      throw new AppError(404, 'core_payment_correction:not_found');
    },
  });
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error, 'core_payment_correction:not_found');
});

test('CORS only returns allow-origin for configured origins', async () => {
  const allowed = await handlePaymentCorrectionReviewRequest(
    request(PATH, 'OPTIONS'), enabled
  );
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.match(allowed.headers.get('Access-Control-Allow-Methods'), /GET/);
  assert.doesNotMatch(allowed.headers.get('Access-Control-Allow-Methods'), /POST/);

  const denied = await handlePaymentCorrectionReviewRequest(
    request(PATH, 'OPTIONS', 'https://untrusted.example'), enabled
  );
  assert.equal(denied.status, 204);
  assert.equal(denied.headers.get('Access-Control-Allow-Origin'), null);
});

test('review handler never imports the financial APPLY or proposal mutators', () => {
  const source = readFileSync(
    new URL('./core/payment-correction-review-http.js', import.meta.url), 'utf8'
  );
  assert.doesNotMatch(source, /^import[\s\S]*?applyPaymentMethodCorrection/m);
  assert.doesNotMatch(source, /^import[\s\S]*?proposePaymentCorrection/m);
  const entrypoint = readFileSync(new URL('./core/worker.js', import.meta.url), 'utf8');
  assert.match(entrypoint, /isPaymentCorrectionReviewRequest/);
  assert.match(entrypoint, /handlePaymentCorrectionReviewRequest/);
});


test('production Worker configuration does not silently enable financial review', () => {
  const config = readFileSync(new URL('../wrangler.core.jsonc', import.meta.url), 'utf8');
  assert.doesNotMatch(config, /FINANCE_CORRECTION_REVIEW_ENABLED/);
  const worker = readFileSync(new URL('./core/payment-correction-review-http.js', import.meta.url), 'utf8');
  assert.match(worker, /FINANCE_CORRECTION_REVIEW_ENABLED !== ENABLED_VALUE/);
});
