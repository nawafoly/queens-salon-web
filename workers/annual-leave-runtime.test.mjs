import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getAnnualLeaveState,
} from './core/repositories/annual-leave.js';

class FakeAnnualD1 {
  constructor({ employment, canonicalRows = [], legacyRows = [] }) {
    this.__fakeD1 = true;
    this.employment = employment;
    this.canonicalRows = canonicalRows;
    this.legacyRows = legacyRows;
  }

  async first(sql, params) {
    if (sql.includes('FROM employee_employment')) {
      return this.employment;
    }
    if (sql.includes('entry_code IS NULL')) {
      return this.legacyRows[0] || null;
    }
    throw new Error(`unexpected first query: ${sql}`);
  }

  async all(sql, params) {
    if (sql.includes('entry_code IS NOT NULL')) {
      const asOfDate = params[2];
      return this.canonicalRows.filter(row => {
        const effective = row.effective_date || row.operation_date;
        return !row.deleted_at && row.entry_code && effective <= asOfDate;
      });
    }
    throw new Error(`unexpected all query: ${sql}`);
  }

  async batch() {
    throw new Error('batch not expected in read-model tests');
  }
}

function employment(overrides = {}) {
  return {
    employee_id: 'emp-1',
    start_date: '2026-01-01',
    employment_status: 'active',
    annual_leave_contract_days: null,
    annual_leave_accrual_mode: 'service_anniversary',
    leave_balance: 0,
    leave_balance_last_entry_id: null,
    annual_leave_legacy_projection_updated_at: null,
    ...overrides,
  };
}

test('new employee derives annual available balance from service-date accrual without manual grants', async () => {
  const db = new FakeAnnualD1({ employment: employment() });
  const state = await getAnnualLeaveState(db, 'main', 'emp-1', {
    asOfDate: '2026-01-31',
  });

  assert.equal(state.reviewRequired, false);
  assert.equal(state.annualEntitlementDays, 21);
  assert.ok(state.availableDays > 1.7);
  assert.ok(state.availableDays < 1.9);
});

test('live annual read model accrues within the day while explicit date mode remains unchanged', async () => {
  const db = new FakeAnnualD1({ employment: employment() });

  const dateState = await getAnnualLeaveState(
    db,
    'main',
    'emp-1',
    { asOfDate: '2026-01-01' }
  );

  const liveState = await getAnnualLeaveState(
    db,
    'main',
    'emp-1',
    {
      liveAccrual: true,
      asOfDateTime: '2026-01-01T09:00:00.000Z',
    }
  );

  assert.equal(liveState.asOfDate, '2026-01-01');
  assert.ok(liveState.earnedCurrentServiceYearDays > 0);
  assert.ok(
    liveState.earnedCurrentServiceYearDays <
      dateState.earnedCurrentServiceYearDays
  );
  assert.ok(liveState.availableDays > 0);
  assert.ok(liveState.availableDays < dateState.availableDays);
});

test('live annual availability accrues after an opening anchor without double-counting ledger movements', async () => {
  const db = new FakeAnnualD1({
    employment: employment({
      leave_balance: 7,
      leave_balance_last_entry_id: 'usage-1',
    }),
    canonicalRows: [
      {
        id: 'opening-1',
        employee_id: 'emp-1',
        action_type: 'add',
        days: 8,
        change_amount: 8,
        balance_before: 0,
        balance_after: 8,
        operation_date: '2026-08-28',
        effective_date: '2026-08-28',
        entry_code: 'OPENING_BALANCE',
        source_type: 'opening_balance',
        source_id: 'op-1',
        policy_version: 'sa-labor-2025-amended-v1',
        metadata_json: '{}',
        created_at: '2026-08-28T00:00:00.000Z',
        deleted_at: null,
      },
      {
        id: 'usage-1',
        employee_id: 'emp-1',
        action_type: 'deduct',
        days: 1,
        change_amount: -1,
        balance_before: 8.0575,
        balance_after: 7.0575,
        operation_date: '2026-08-29',
        effective_date: '2026-08-29',
        entry_code: 'LEAVE_USED',
        source_type: 'leave_request',
        source_id: 'leave-1',
        policy_version: 'sa-labor-2025-amended-v1',
        metadata_json: '{}',
        created_at: '2026-08-29T00:00:00.000Z',
        deleted_at: null,
      },
    ],
  });

  const atStart = await getAnnualLeaveState(
    db,
    'main',
    'emp-1',
    {
      liveAccrual: true,
      asOfDateTime: '2026-08-28T21:00:00.000Z',
    }
  );

  const atNoon = await getAnnualLeaveState(
    db,
    'main',
    'emp-1',
    {
      liveAccrual: true,
      asOfDateTime: '2026-08-29T09:00:00.000Z',
    }
  );

  const dateState = await getAnnualLeaveState(
    db,
    'main',
    'emp-1',
    { asOfDate: '2026-08-29' }
  );

  const nextMidnight = await getAnnualLeaveState(
    db,
    'main',
    'emp-1',
    {
      liveAccrual: true,
      asOfDateTime: '2026-08-29T21:00:00.000Z',
    }
  );

  assert.equal(atStart.asOfDate, '2026-08-29');
  assert.equal(atStart.openingBalanceDays, 8);
  assert.equal(atStart.usedDays, 1);
  assert.equal(atStart.accruedSinceAnchorDays, 0);
  assert.equal(atStart.availableDays, 7);

  assert.equal(atNoon.openingBalanceDays, 8);
  assert.equal(atNoon.usedDays, 1);
  assert.ok(atNoon.accruedSinceAnchorDays > 0);
  assert.ok(atNoon.availableDays > 7);
  assert.ok(atNoon.availableDays < dateState.availableDays);

  assert.ok(
    Math.abs(
      nextMidnight.availableDays - dateState.availableDays
    ) < 0.0001
  );
});

test('legacy scalar balance fails closed until HR records an opening balance anchor', async () => {
  const db = new FakeAnnualD1({
    employment: employment({ leave_balance: 8 }),
  });
  const state = await getAnnualLeaveState(db, 'main', 'emp-1', {
    asOfDate: '2026-08-28',
  });

  assert.equal(state.reviewRequired, true);
  assert.equal(state.reviewReason, 'opening_balance_required');
  assert.equal(state.legacyBalanceDays, 8);
  assert.equal(state.availableDays, null);
});

test('opening balance is authoritative as of its effective date and prior accrual is not double-counted', async () => {
  const db = new FakeAnnualD1({
    employment: employment({
      leave_balance: 8,
      leave_balance_last_entry_id: 'opening-1',
    }),
    canonicalRows: [
      {
        id: 'opening-1',
        employee_id: 'emp-1',
        action_type: 'add',
        days: 8,
        change_amount: 8,
        balance_before: 0,
        balance_after: 8,
        operation_date: '2026-08-28',
        effective_date: '2026-08-28',
        entry_code: 'OPENING_BALANCE',
        source_type: 'opening_balance',
        source_id: 'op-1',
        policy_version: 'sa-labor-2025-amended-v1',
        metadata_json: '{}',
        created_at: '2026-08-28T00:00:00.000Z',
        deleted_at: null,
      },
    ],
  });

  const state = await getAnnualLeaveState(db, 'main', 'emp-1', {
    asOfDate: '2026-08-28',
  });

  assert.equal(state.reviewRequired, false);
  assert.equal(state.openingBalanceDays, 8);
  assert.equal(state.accruedSinceAnchorDays, 0);
  assert.equal(state.availableDays, 8);
});

test('canonical annual usage reduces only annual available entitlement after the opening anchor', async () => {
  const db = new FakeAnnualD1({
    employment: employment({
      leave_balance: 7,
      leave_balance_last_entry_id: 'usage-1',
    }),
    canonicalRows: [
      {
        id: 'opening-1',
        employee_id: 'emp-1',
        action_type: 'add',
        days: 8,
        change_amount: 8,
        balance_before: 0,
        balance_after: 8,
        operation_date: '2026-08-28',
        effective_date: '2026-08-28',
        entry_code: 'OPENING_BALANCE',
        source_type: 'opening_balance',
        source_id: 'op-1',
        policy_version: 'sa-labor-2025-amended-v1',
        metadata_json: '{}',
        created_at: '2026-08-28T00:00:00.000Z',
        deleted_at: null,
      },
      {
        id: 'usage-1',
        employee_id: 'emp-1',
        action_type: 'deduct',
        days: 1,
        change_amount: -1,
        balance_before: 8.0575,
        balance_after: 7.0575,
        operation_date: '2026-08-29',
        effective_date: '2026-08-29',
        entry_code: 'LEAVE_USED',
        source_type: 'leave_request',
        source_id: 'leave-1',
        policy_version: 'sa-labor-2025-amended-v1',
        metadata_json: '{}',
        created_at: '2026-08-29T00:00:00.000Z',
        deleted_at: null,
      },
    ],
  });

  const state = await getAnnualLeaveState(db, 'main', 'emp-1', {
    asOfDate: '2026-08-30',
  });

  assert.equal(state.reviewRequired, false);
  assert.equal(state.usedDays, 1);
  assert.ok(state.availableDays > 7.1);
  assert.ok(state.availableDays < 7.2);
});
