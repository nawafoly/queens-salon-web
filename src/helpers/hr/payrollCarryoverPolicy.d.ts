export type PayrollCarryoverDirection = "addition" | "deduction" | "none";

export type PayrollCarryoverAdjustmentLike = Record<string, unknown> & {
  id?: string;
  employeeId?: string;
  sourcePayrollMonth?: string;
  targetPayrollMonth?: string;
  direction?: "addition" | "deduction";
  amountHalalas?: number;
  reason?: string;
  status?: string;
  sourceDate?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

export const PAYROLL_CARRYOVER_SOURCE_TYPE: "payroll_carryover";
export const PAYROLL_CARRYOVER_ITEM_PREFIX: "payroll_carryover:";
export function payrollMonthShift(payrollMonth: string, delta: number): string;
export function previousPayrollMonth(payrollMonth: string): string;
export function nextPayrollMonth(payrollMonth: string): string;
export function payrollCarryoverDelta(approvedNetHalalas: unknown, recalculatedNetHalalas: unknown): {
  approvedNetHalalas: number;
  recalculatedNetHalalas: number;
  signedDeltaHalalas: number;
  direction: PayrollCarryoverDirection;
  amountHalalas: number;
};
export function isPayrollCarryoverItem(item: unknown): boolean;
export function withoutPayrollCarryoverItems<T>(items: T[]): T[];
export function payrollCarryoverItem(adjustment: PayrollCarryoverAdjustmentLike): Record<string, unknown> & {
  id: string;
  direction: "addition" | "deduction";
  kind: "manual_addition" | "manual_deduction";
  amountHalalas: number;
  reason: string;
  sourceType: "payroll_carryover";
};
export function payrollCarryoverNetHalalas(additions: unknown[], deductions: unknown[]): number;
