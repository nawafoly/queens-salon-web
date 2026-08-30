import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("payment reversal is Core-authoritative and reverses payroll side effects", () => {
  const payroll = read("workers/core/repositories/payroll.js");
  const obligations = read("workers/core/repositories/payroll-obligations.js");
  const worker = read("workers/core/index.js");
  const coreHr = read("src/services/CoreHrService.ts");
  const payrollService = read("src/services/CorePayrollService.ts");

  assert.match(payroll, /export async function reversePayrollEntryPayment/);
  assert.match(payroll, /action: 'payment_reversed'/);
  assert.match(payroll, /status = 'approved'/);
  assert.match(payroll, /paid_at = NULL/);
  assert.match(payroll, /paid_by_uid = NULL/);
  assert.match(payroll, /status = 'scheduled'/);
  assert.match(payroll, /deducted_at = NULL/);
  assert.match(payroll, /paid_halalas = MAX\(0, paid_halalas - \?\)/);
  assert.match(payroll, /remaining_halalas =\s*MIN\(approved_halalas, remaining_halalas \+ \?\)/);

  assert.match(obligations, /export async function payrollObligationPaymentReversalStatements/);
  assert.match(obligations, /applied_payroll_entry_id = NULL/);
  assert.match(obligations, /remaining_amount_halalas =\s*MIN\(original_amount_halalas, remaining_amount_halalas \+ \?\)/);

  assert.match(worker, /payroll-entry:unpay/);
  assert.match(worker, /requirePermission\(ctx, "payroll\.manage"\)/);
  assert.match(worker, /requireRole\(ctx\.role, PAYROLL_MANAGEMENT_ROLES\)/);
  assert.match(coreHr, /reversePayrollEntryPayment/);
  assert.match(payrollService, /export async function reversePayrollEntryPayment/);
});

test("Dashboard supports batch payment and payment reversal without native dialogs", () => {
  const page = read("src/pages/DashboardPayroll.tsx");

  assert.match(page, /تسجيل دفع المسيرة/);
  assert.match(page, /إلغاء تسجيل دفع المسيرة/);
  assert.match(page, /إلغاء تسجيل الدفع/);
  assert.match(page, /سبب إلغاء تسجيل الدفع/);
  assert.match(page, /submitPaymentControl/);
  assert.doesNotMatch(page, /window\.confirm\s*\(/);
  assert.doesNotMatch(page, /window\.prompt\s*\(/);
});

test("current Riyadh workday is never finalized as missing before shift end", () => {
  const discipline = read("src/helpers/hr/attendanceDiscipline.ts");
  const payroll = read("workers/core/repositories/payroll.js");

  const inProgressIndex = discipline.indexOf("const isCurrentDayStillOpen =");
  const absentIndex = discipline.indexOf(
    "const shouldTreatMissingPunchesAsAbsent"
  );

  assert.ok(inProgressIndex >= 0, "missing current-day in-progress guard");
  assert.ok(absentIndex >= 0, "missing attendance absence branch");
  assert.ok(
    inProgressIndex < absentIndex,
    "current-day guard must run before absence/missing-hours finalization"
  );
  assert.match(discipline, /status: "in_progress"/);
  assert.match(discipline, /missingHours: 0/);

  assert.match(payroll, /const completedThrough = payrollCompletedThrough\(bounds\)/);
  assert.match(payroll, /const completedPeriodEnd =/);
  assert.match(payroll, /dateKey > completedPeriodEnd/);
  assert.match(
    payroll,
    /payrollDateKeys\(bounds\.monthStart, completedThrough\)/
  );
});
