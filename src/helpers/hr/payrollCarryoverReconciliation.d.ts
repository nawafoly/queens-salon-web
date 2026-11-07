export interface PayrollDisplayedLines {
  base?: number;
  allowances?: number;
  additions?: number;
  overtime?: number;
  leaveCompensation?: number;
  signedCarryover?: number;
  carryoverDeductions?: number;
  totalDeductions?: number;
}

export function expectedPayrollNetFromDisplayedLines(
  values: PayrollDisplayedLines
): number;
