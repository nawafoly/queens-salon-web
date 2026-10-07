import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getActivePayrollDeductionDeferralTotal,
} from './core/repositories/payroll-deduction-deferrals.js';

const read = (path) => readFileSync(path, 'utf8');

test('partial payroll deduction deferral is canonical, atomic, and excluded from statutory deductions', () => {
  const migration = read('migrations/core/0093_payroll_partial_deduction_deferrals.sql');
  const policy = read('src/helpers/hr/payrollObligationPolicy.js');
  const core = read('workers/core/index.js');
  const payroll = read('workers/core/repositories/payroll.js');
  const obligations = read('workers/core/repositories/payroll-obligations.js');
  const deferrals = read('workers/core/repositories/payroll-deduction-deferrals.js');
  const service = read('src/services/CoreHrService.ts');
  const dashboard = read('src/pages/DashboardPayroll.tsx');

  assert.match(migration, /CREATE TABLE IF NOT EXISTS payroll_deduction_deferrals/);
  assert.match(migration, /idx_payroll_deduction_deferrals_request/);
  assert.match(migration, /FOREIGN KEY \(obligation_id\)[\s\S]*employee_payroll_obligations/);

  assert.match(policy, /export function isDeferrableDeductionKind/);
  assert.match(policy, /NON_DEFERRABLE_KINDS/);

  assert.match(core, /\/api\/core\/hr\/payroll-deduction-deferrals\/defer/);
  assert.match(core, /payroll-deduction-deferral:defer/);
  assert.match(core, /requirePermission\(ctx, ["']payroll\.manage["']\)/);

  assert.match(obligations, /payroll_deduction_deferral/);
  assert.match(obligations, /export async function buildCanonicalPayrollObligationCreate/);

  assert.match(deferrals, /buildCanonicalPayrollObligationCreate/);
  assert.match(deferrals, /await dbBatch\(/);
  assert.match(deferrals, /partial_deduction_deferral_idempotency_conflict/);
  assert.match(deferrals, /pendingDeferralSchema/);

  assert.match(payroll, /export async function deferPayrollDeductions/);
  assert.match(payroll, /getActivePayrollDeductionDeferralTotal/);
  assert.match(payroll, /canonicalDeferrableDeductionsHalalas/);
  assert.match(payroll, /canonicalDeferredDeductionsHalalas/);
  assert.match(
    payroll,
    /canonicalAdvanceHalalas\s*-\s*canonicalDeferredDeductionsHalalas/
  );
  assert.match(payroll, /partial_deduction_deferral_exceeds_available_deductions/);

  assert.match(
    payroll,
    /Generic payroll deduction deferral owns only attendance\/manual/
  );

  assert.doesNotMatch(
    payroll,
    /deferrableManualHalalas\s*\+\s*advanceHalalas/
  );

  assert.match(
    obligations,
    /UPDATE payroll_deduction_deferrals[\s\S]*status = 'cancelled'/
  );

  assert.match(
    obligations,
    /deduction_deferral_canonical_record_missing/
  );

  assert.match(service, /async deferPayrollDeductions/);
  assert.match(
    service,
    /\/api\/core\/hr\/payroll-deduction-deferrals\/defer/
  );

  assert.match(
    dashboard,
    /CoreHrService\.deferPayrollDeductions/
  );
  assert.match(
    dashboard,
    /تأجيل جزء من الخصومات/
  );
  assert.match(
    dashboard,
    /تأكيد تأجيل المبلغ/
  );
  assert.match(
    dashboard,
    /payrollPartialDeferralRequestKey/
  );
});

test('partial deferral total is zero only while migration 0093 is not yet present', async () => {
  const missingSchemaDb = {
    prepare() {
      return {
        bind() {
          return {
            async first() {
              throw new Error(
                'D1_ERROR: no such table: payroll_deduction_deferrals: SQLITE_ERROR'
              );
            },
          };
        },
      };
    },
  };

  assert.equal(
    await getActivePayrollDeductionDeferralTotal(
      missingSchemaDb,
      'main',
      {
        employeeId: 'emp-1',
        payrollMonth: '2026-10',
      }
    ),
    0
  );

  const brokenDb = {
    prepare() {
      return {
        bind() {
          return {
            async first() {
              throw new Error('database unavailable');
            },
          };
        },
      };
    },
  };

  await assert.rejects(
    () =>
      getActivePayrollDeductionDeferralTotal(
        brokenDb,
        'main',
        {
          employeeId: 'emp-1',
          payrollMonth: '2026-10',
        }
      ),
    /database unavailable/
  );
});
