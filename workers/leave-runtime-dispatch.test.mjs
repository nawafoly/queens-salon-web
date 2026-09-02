import assert from 'node:assert/strict';
import test from 'node:test';

import { AppError } from './core/errors.js';
import {
  leaveDecisionRuntime,
  requireExplicitSaLeaveType,
} from './core/repositories/leaves.js';

test('leave request requires an explicit type and never defaults to annual', () => {
  assert.throws(
    () => requireExplicitSaLeaveType({}),
    (error) =>
      error instanceof AppError &&
      error.code === 'core_leave:leave_type_required'
  );

  assert.equal(
    requireExplicitSaLeaveType({ leaveType: 'annual' }).leaveType,
    'annual'
  );
});

test('emergency is canonical company policy while unknown types route to HR review', () => {
  assert.equal(
    requireExplicitSaLeaveType({ leaveType: 'emergency' }).leaveType,
    'emergency'
  );
  assert.equal(
    leaveDecisionRuntime(
      { leave_type: 'emergency', status: 'pending' },
      'approved'
    ),
    'annual_approve'
  );
  assert.equal(
    leaveDecisionRuntime(
      { leave_type: 'emergency', status: 'approved' },
      'rejected'
    ),
    'annual_cancel'
  );
  assert.equal(
    requireExplicitSaLeaveType({ leaveType: 'made_up_type' }).leaveType,
    'other_hr_review'
  );
});

test('annual and sick approval dispatch to canonical statutory runtimes', () => {
  assert.equal(
    leaveDecisionRuntime(
      { leave_type: 'annual', status: 'pending' },
      'approved'
    ),
    'annual_approve'
  );
  assert.equal(
    leaveDecisionRuntime(
      { leave_type: 'sick', status: 'pending' },
      'approved'
    ),
    'sick_approve'
  );
});

test('approved annual and sick cancellation dispatch to canonical reversal runtimes', () => {
  assert.equal(
    leaveDecisionRuntime(
      { leave_type: 'annual', status: 'approved' },
      'rejected'
    ),
    'annual_cancel'
  );
  assert.equal(
    leaveDecisionRuntime(
      { leave_type: 'sick', status: 'approved' },
      'rejected'
    ),
    'sick_cancel'
  );
});

test('comp-time and weekly-rest substitute use dispatch through their entitlement ledgers', () => {
  for (const leaveType of [
    'overtime_comp_time_use',
    'weekly_rest_substitute_use',
  ]) {
    assert.equal(
      leaveDecisionRuntime(
        { leave_type: leaveType, status: 'pending' },
        'approved'
      ),
      'time_entitlement_approve'
    );
    assert.equal(
      leaveDecisionRuntime(
        { leave_type: leaveType, status: 'approved' },
        'rejected'
      ),
      'time_entitlement_cancel'
    );
  }
});

test('deterministic statutory leave dispatches to canonical validation runtime', () => {
  for (const leaveType of [
    'marriage',
    'bereavement_spouse_ascendant_descendant',
    'bereavement_sibling',
    'newborn',
    'hajj',
    'exam',
  ]) {
    assert.equal(
      leaveDecisionRuntime(
        { leave_type: leaveType, status: 'pending' },
        'approved'
      ),
      'special_statutory_approve'
    );
    assert.equal(
      leaveDecisionRuntime(
        { leave_type: leaveType, status: 'approved' },
        'rejected'
      ),
      'special_statutory_cancel'
    );
  }
});

test('sensitive and complex family leave dispatches to specialized family runtime', () => {
  for (const leaveType of [
    'maternity',
    'child_medical_care',
    'widow_muslim',
    'widow_non_muslim',
  ]) {
    assert.equal(
      leaveDecisionRuntime(
        { leave_type: leaveType, status: 'pending' },
        'approved'
      ),
      'sensitive_family_approve'
    );
    assert.equal(
      leaveDecisionRuntime(
        { leave_type: leaveType, status: 'approved' },
        'rejected'
      ),
      'sensitive_family_cancel'
    );
  }
});

test('unpaid leave keeps the legacy no-entitlement approval lifecycle', () => {
  assert.equal(
    leaveDecisionRuntime(
      { leave_type: 'unpaid', status: 'pending' },
      'approved'
    ),
    'legacy_safe'
  );
});
