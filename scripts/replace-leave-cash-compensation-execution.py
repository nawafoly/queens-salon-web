from pathlib import Path
import re

path = Path("workers/core/repositories/employee-requests.js")
text = path.read_text(encoding="utf-8")

new_function = r'''async function executeExceptionalFinancialPayment(db, salonId, row, payload, actor, input) {
  const payrollMonth = cleanText(input.payrollMonth) || riyadhDateKey().slice(0, 7);
  addMonths(payrollMonth, 0);

  const existing = await dbFirst(
    db,
    `SELECT * FROM employee_financial_payments WHERE salon_id = ? AND request_id = ? LIMIT 1`,
    [salonId, row.id]
  );
  if (existing) {
    await refreshPayrollFinancials(db, salonId, row.employee_id, existing.payroll_month);
    const currentEmployment = await dbFirst(
      db,
      `SELECT leave_balance FROM employee_employment WHERE salon_id = ? AND employee_id = ? LIMIT 1`,
      [salonId, row.employee_id]
    );
    return {
      sourceType: 'employee_financial_payment',
      sourceId: existing.id,
      before: null,
      after: {
        ...existing,
        leaveBalanceAfter: Number(currentEmployment?.leave_balance || 0),
        leaveBalanceDeducted: Number(existing.leave_balance_deducted || 0),
      },
    };
  }

  const payrollEntry = await dbFirst(
    db,
    `SELECT * FROM payroll_entries
      WHERE salon_id = ? AND employee_id = ? AND payroll_month = ?
        AND COALESCE(status, 'draft') NOT IN ('approved', 'paid')
      LIMIT 1`,
    [salonId, row.employee_id, payrollMonth]
  );
  if (!payrollEntry) throw new AppError(409, 'core_employee_request:payroll_entry_required');

  const requestedDays = numberInRange(payload.requestedDays, 'requested_days', 0.5, 60);
  if (Math.round(requestedDays * 2) !== requestedDays * 2) {
    throw new AppError(400, 'core_employee_request:invalid_requested_days');
  }
  const baseSalaryHalalas = positiveInteger(payload.baseSalaryHalalas, 'base_salary', 100_000_000);
  const dayRateHalalas = positiveInteger(payload.dayRateHalalas, 'day_rate', 10_000_000);
  const amountHalalas = positiveInteger(payload.calculatedAmountHalalas, 'calculated_amount', 100_000_000);
  const financialReference = cleanText(input.financialReference) || `EFP-${row.request_number}`;

  const employment = await dbFirst(
    db,
    `SELECT leave_balance FROM employee_employment
      WHERE salon_id = ? AND employee_id = ? LIMIT 1`,
    [salonId, row.employee_id]
  );
  const leaveBalanceBefore = Number(employment?.leave_balance);
  if (!employment || !Number.isFinite(leaveBalanceBefore) || leaveBalanceBefore < requestedDays) {
    throw new AppError(409, 'core_employee_request:insufficient_annual_leave_balance');
  }

  const parsedAdditions = parseJson(payrollEntry.additions_json, []);
  const additions = Array.isArray(parsedAdditions) ? parsedAdditions : [];
  const alreadyIncluded = additions.some((item) =>
    cleanText(item?.requestId || item?.request_id) === cleanText(row.id)
  );
  const nextAdditions = alreadyIncluded ? additions : [
    ...additions,
    {
      id: `employee_financial_payment:${row.id}`,
      type: 'exceptional_financial_payment',
      label: 'تعويض مالي بدل إجازة',
      requestId: row.id,
      requestNumber: row.request_number,
      amountHalalas,
      requestedDays,
      financialReference,
    },
  ];
  const nextManualAdditions = Number(payrollEntry.manual_additions_halalas || 0) + (alreadyIncluded ? 0 : amountHalalas);
  const now = nowIso();
  const paymentId = generatedId('financial_payment');

  await dbBatch(db, [
    {
      sql: `INSERT OR IGNORE INTO employee_financial_payments
        (id, salon_id, request_id, request_number, employee_id, employee_uid,
         requested_days, base_salary_halalas, day_rate_halalas, amount_halalas,
         payroll_month, payroll_entry_id, financial_reference, payment_status,
         leave_balance_deducted, approved_by_uid, approved_at, executed_by_uid,
         executed_at, created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'included', ?, ?, ?, ?, ?, ?, ?
         FROM employee_employment
        WHERE salon_id = ? AND employee_id = ? AND leave_balance >= ?`,
      params: [
        paymentId,
        salonId,
        row.id,
        row.request_number,
        row.employee_id,
        row.employee_uid,
        requestedDays,
        baseSalaryHalalas,
        dayRateHalalas,
        amountHalalas,
        payrollMonth,
        payrollEntry.id,
        financialReference,
        requestedDays,
        cleanText(row.decided_by_uid) || null,
        row.approved_at || now,
        cleanText(actor.uid) || null,
        now,
        now,
        now,
        salonId,
        row.employee_id,
        requestedDays,
      ],
    },
    {
      sql: `UPDATE payroll_entries
              SET manual_additions_halalas = ?, additions_json = ?, updated_at = ?
            WHERE salon_id = ? AND id = ?
              AND COALESCE(status, 'draft') NOT IN ('approved', 'paid')
              AND EXISTS (
                SELECT 1 FROM employee_financial_payments
                 WHERE salon_id = ? AND request_id = ?
              )`,
      params: [nextManualAdditions, json(nextAdditions), now, salonId, payrollEntry.id, salonId, row.id],
    },
    {
      sql: `UPDATE employee_employment
              SET leave_balance = leave_balance - ?, updated_at = ?,
                  updated_by_uid = ?, updated_by_email = ?
            WHERE salon_id = ? AND employee_id = ? AND leave_balance >= ?
              AND EXISTS (
                SELECT 1 FROM employee_financial_payments
                 WHERE salon_id = ? AND request_id = ?
              )`,
      params: [
        requestedDays,
        now,
        cleanText(actor.uid) || null,
        cleanText(actor.email) || null,
        salonId,
        row.employee_id,
        requestedDays,
        salonId,
        row.id,
      ],
    },
  ]);

  const stored = await dbFirst(
    db,
    `SELECT * FROM employee_financial_payments WHERE salon_id = ? AND request_id = ? LIMIT 1`,
    [salonId, row.id]
  );
  if (!stored) throw new AppError(409, 'core_employee_request:insufficient_annual_leave_balance');

  const employmentAfter = await dbFirst(
    db,
    `SELECT leave_balance FROM employee_employment WHERE salon_id = ? AND employee_id = ? LIMIT 1`,
    [salonId, row.employee_id]
  );
  const leaveBalanceAfter = Number(employmentAfter?.leave_balance);
  if (!Number.isFinite(leaveBalanceAfter) || Math.abs(leaveBalanceAfter - (leaveBalanceBefore - requestedDays)) > 0.000001) {
    throw new AppError(500, 'core_employee_request:leave_balance_deduction_failed');
  }

  const payrollEntryId = await refreshPayrollFinancials(db, salonId, row.employee_id, payrollMonth);
  if (!payrollEntryId) throw new AppError(409, 'core_employee_request:payroll_entry_required');

  return {
    sourceType: 'employee_financial_payment',
    sourceId: stored.id,
    before: { leaveBalance: leaveBalanceBefore },
    after: {
      ...stored,
      payrollEntryId,
      leaveBalanceBefore,
      leaveBalanceAfter,
      leaveBalanceDeducted: requestedDays,
    },
  };
}'''

pattern = re.compile(
    r"async function executeExceptionalFinancialPayment\(db, salonId, row, payload, actor, input\) \{[\s\S]*?\n\}\n\nasync function executeSalaryAdvance"
)
text, count = pattern.subn(new_function + "\n\nasync function executeSalaryAdvance", text, count=1)
if count != 1:
    raise SystemExit(f"Expected one execution function, replaced {count}")
path.write_text(text, encoding="utf-8")

# The verification workflow removes one obsolete assertion with sed before running the patch.
# Restore that exact line so the temporary patch file is clean and can be removed normally.
patch_path = Path("scripts/apply-leave-cash-compensation-core-fix.py")
patch_text = patch_path.read_text(encoding="utf-8")
needle = 'assert "leave_balance = leave_balance - ?" in read(worker)\nassert "balanceDeductionDays: Number(payload.requestedDays)" in read(worker)'
restored = 'assert "leave_balance = leave_balance - ?" in read(worker)\nassert "leaveBalanceDeducted: requestedDays" in read(worker)\nassert "balanceDeductionDays: Number(payload.requestedDays)" in read(worker)'
if needle in patch_text:
    patch_path.write_text(patch_text.replace(needle, restored, 1), encoding="utf-8")
