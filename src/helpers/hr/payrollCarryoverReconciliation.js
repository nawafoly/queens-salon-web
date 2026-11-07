/**
 * Display-only reconciliation: totalDeductions already includes carryover
 * deductions, while signedCarryover includes them with a negative sign.
 * Remove carryover deductions from the subtotal before applying signed amount.
 * Financial authority and saved snapshots remain in Core.
 */
export function expectedPayrollNetFromDisplayedLines(values) {
  const {
    base = 0,
    allowances = 0,
    additions = 0,
    overtime = 0,
    leaveCompensation = 0,
    signedCarryover = 0,
    carryoverDeductions = 0,
    totalDeductions = 0,
  } = values;
  return Math.max(
    0,
    base + allowances + additions + overtime + leaveCompensation +
      signedCarryover - (totalDeductions - carryoverDeductions)
  );
}
