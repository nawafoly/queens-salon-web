#!/usr/bin/env node
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const path = 'workers/core/repositories/payroll.js';
const rawSource = readFileSync(path, 'utf8');
const originalEol = rawSource.includes('\r\n') ? '\r\n' : '\n';
let source = rawSource.replace(/\r\n/g, '\n');

function replaceExact(label, before, after) {
  const normalizedBefore = before.replace(/\r\n/g, '\n');
  const normalizedAfter = after.replace(/\r\n/g, '\n');
  const first = source.indexOf(normalizedBefore);
  if (first < 0) throw new Error(`${label}: anchor_not_found`);
  if (source.indexOf(normalizedBefore, first + normalizedBefore.length) >= 0) {
    throw new Error(`${label}: anchor_not_unique`);
  }
  source = source.slice(0, first) + normalizedAfter + source.slice(first + normalizedBefore.length);
}

if (!source.includes("from './overtime-reconciliation.js'")) {
  replaceExact(
    'overtime import',
    "import { resolveEmployeeShiftsBatch } from './shift-control.js';\n",
    "import { resolveEmployeeShiftsBatch } from './shift-control.js';\nimport { listReconciledCashOvertimeForPayroll } from './overtime-reconciliation.js';\n"
  );
}

replaceExact(
  'canonical overtime authority',
`  const overtimeEnabled = activeFlag(employment.overtime_enabled);
  const overtimeMultiplier = Math.max(
    1.5,
    Number(employment.overtime_multiplier || 1.5) || 1.5
  );
  const detectedExtraHours = Math.max(
    0,
    Number(summary.totalExtraHours || 0) || 0
  );
  const financialOvertimeHours =
    overtimeEnabled && payrollSetupComplete
      ? detectedExtraHours
      : 0;
`,
`  const overtimeEnabled = activeFlag(employment.overtime_enabled);
  const overtimeMultiplier = Math.max(
    1.5,
    Number(employment.overtime_multiplier || 1.5) || 1.5
  );
  const detectedExtraHours = Math.max(
    0,
    Number(summary.totalExtraHours || 0) || 0
  );
  const reconciledCashOvertimeRows =
    await listReconciledCashOvertimeForPayroll(
      db,
      salonId,
      employeeId,
      payrollMonth
    );
  const reconciledOvertimeMinutes =
    reconciledCashOvertimeRows.reduce(
      (total, row) =>
        total + Math.max(0, Number(row.actual_worked_minutes || 0) || 0),
      0
    );

  if (!overtimeEnabled && reconciledOvertimeMinutes > 0) {
    throw new AppError(
      409,
      'core_payroll:reconciled_overtime_policy_disabled'
    );
  }

  const financialOvertimeHours =
    payrollRoundHours(reconciledOvertimeMinutes / 60);

  summary.rawDetectedExtraHours = detectedExtraHours;
  summary.reconciledCashOvertimeMinutes = reconciledOvertimeMinutes;
  summary.reconciledCashOvertimeHours = financialOvertimeHours;
  summary.overtimeFinancialAuthority = 'reconciled_cash_overtime_only';
  summary.overtimeSourceSnapshot = reconciledCashOvertimeRows.map((row) => ({
    id: cleanText(row.id),
    requestId: cleanText(row.request_id) || null,
    date: cleanText(row.date_key),
    minutes: Math.max(0, Number(row.actual_worked_minutes || 0) || 0),
    financialStatus: cleanText(row.financial_status),
    attendanceReconciledAt: cleanText(row.attendance_reconciled_at) || null,
    policyVersion: cleanText(row.policy_version) || null,
  }));
`
);

replaceExact(
  'canonical overtime minutes',
  '          overtimeMinutes: financialOvertimeHours * 60,\n',
  '          overtimeMinutes: reconciledOvertimeMinutes,\n'
);

replaceExact(
  'authority return evidence',
`    attendanceDeductionDeferral,
    detectedExtraHours,
    overtimeEnabled,
`,
`    attendanceDeductionDeferral,
    detectedExtraHours,
    reconciledOvertimeMinutes,
    overtimeSourceSnapshot: summary.overtimeSourceSnapshot,
    overtimeEnabled,
`
);

replaceExact(
  'schedule snapshot evidence',
`      overtimeCalculationBasis:
        'actual_hourly_plus_50pct_basic_hourly',
`,
`      overtimeCalculationBasis:
        'actual_hourly_plus_50pct_basic_hourly',
      overtimeFinancialAuthority:
        'reconciled_cash_overtime_only',
      reconciledOvertimeMinutes:
        authority.reconciledOvertimeMinutes,
      overtimeSourceSnapshot:
        authority.overtimeSourceSnapshot,
`
);

const output = originalEol === '\r\n'
  ? source.replace(/\n/g, '\r\n')
  : source;
writeFileSync(path, output, 'utf8');

// One-shot migration helper: remove itself so it cannot become a second runtime.
unlinkSync(new URL(import.meta.url));
console.log('payroll reconciled overtime cutover applied');
