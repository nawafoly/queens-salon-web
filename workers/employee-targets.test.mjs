import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  calculateTierBonus,
  canonicalizeTargetLedgerRows,
  createTargetIdentityIndex,
  distributeAmountByWeights,
  eligibleServiceAmount,
  stripTargetBonusItems,
  targetDashboardInvariant,
  TARGET_BONUS_SOURCE,
  UNASSIGNED_TARGET_EMPLOYEE_ID,
} from './core/repositories/employee-targets.js';

const tiers = [
  { id: 'tier_1', tier_name: 'Tier 1', target_amount: 1_000_000, bonus_amount: 30_000, status: 'active' },
  { id: 'tier_2', tier_name: 'Tier 2', target_amount: 1_500_000, bonus_amount: 60_000, status: 'active' },
  { id: 'tier_3', tier_name: 'Tier 3', target_amount: 2_000_000, bonus_amount: 100_000, status: 'active' },
];

describe('employee target bonus math', () => {
  it('does not award a bonus below the first target tier', () => {
    const result = calculateTierBonus(999_999, { bonus_type: 'fixed' }, tiers);
    assert.equal(result.bonusAmount, 0);
    assert.equal(result.achievedTier, null);
    assert.equal(result.nextTier.id, 'tier_1');
  });

  it('awards the highest achieved fixed tier without cumulative mode', () => {
    const result = calculateTierBonus(1_500_000, { bonus_type: 'fixed', cumulative_tiers: 0 }, tiers);
    assert.equal(result.bonusAmount, 60_000);
    assert.equal(result.achievedTier.id, 'tier_2');
    assert.equal(result.nextTier.id, 'tier_3');
  });

  it('adds fixed tier bonuses in cumulative mode', () => {
    const result = calculateTierBonus(2_000_000, { bonus_type: 'fixed', cumulative_tiers: 1 }, tiers);
    assert.equal(result.bonusAmount, 190_000);
    assert.equal(result.achievedTier.id, 'tier_3');
  });

  it('calculates percentage tier bonus from eligible net target amount', () => {
    const result = calculateTierBonus(
      1_500_000,
      { bonus_type: 'percentage', cumulative_tiers: 0 },
      [{ id: 'tier_pct', target_amount: 1_000_000, bonus_percent_bps: 250, status: 'active' }]
    );
    assert.equal(result.bonusAmount, 37_500);
  });

  it('applies item discount and collection ratio to service eligibility', () => {
    const result = eligibleServiceAmount(
      { total_halalas: 20_000, discount_halalas: 4_000 },
      0,
      8_000,
      16_000
    );
    assert.equal(result.gross, 20_000);
    assert.equal(result.discount, 4_000);
    assert.equal(result.netBeforeCollection, 16_000);
    assert.equal(result.eligible, 8_000);
  });

  it('distributes booking-level discounts and refunds by item weight', () => {
    assert.deepEqual(distributeAmountByWeights(3_000, [10_000, 20_000]), [1_000, 2_000]);
    assert.deepEqual(distributeAmountByWeights(1_001, [1, 1, 1]), [334, 334, 333]);
  });

  it('removes only target bonus payroll additions before reinserting the current one', () => {
    const items = [
      { id: 'manual', source: 'manual', amountHalalas: 5_000 },
      { id: 'target_old', source: TARGET_BONUS_SOURCE, amountHalalas: 30_000 },
      { id: 'target_legacy', source_type: TARGET_BONUS_SOURCE, amount_halalas: 20_000 },
    ];
    assert.deepEqual(stripTargetBonusItems(items), [{ id: 'manual', source: 'manual', amountHalalas: 5_000 }]);
  });

  it('canonicalizes duplicate employee identities and preserves unassigned sales invariant', () => {
    const index = createTargetIdentityIndex({
      employeeProfiles: [{ id: 'emp-1', firebase_uid: 'firebase-1', name: 'Employee One' }],
      staffRows: [{ id: 'staff-legacy-1', firebase_uid: 'firebase-1', name: 'Employee One' }],
      appUsers: [{ id: 'account-1', firebase_uid: 'firebase-1', display_name: 'Employee One' }],
      links: [{ user_id: 'account-1', employee_id: 'emp-1', link_status: 'active' }],
    });
    const ledgerRows = canonicalizeTargetLedgerRows([
      { id: 'a', employee_id: 'staff-legacy-1', eligible_amount: 100_00, booking_id: 'booking-a' },
      { id: 'b', employee_id: 'account-1', eligible_amount: 200_00, booking_id: 'booking-b' },
      { id: 'c', employee_id: 'unknown-staff', eligible_amount: 50_00, booking_id: 'booking-c' },
    ], index);

    const assignedTotal = ledgerRows
      .filter((row) => row.employee_id === 'emp-1')
      .reduce((sum, row) => sum + row.eligible_amount, 0);
    const unassignedSales = ledgerRows
      .filter((row) => row.employee_id === UNASSIGNED_TARGET_EMPLOYEE_ID)
      .reduce((sum, row) => sum + row.eligible_amount, 0);

    assert.equal(assignedTotal, 300_00);
    assert.equal(unassignedSales, 50_00);
    assert.equal(
      targetDashboardInvariant([{ employee_id: 'emp-1', net_target_amount: assignedTotal }], unassignedSales, 350_00),
      true
    );
  });
});
