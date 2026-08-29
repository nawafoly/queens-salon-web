export type PayrollObligationStatus = "open" | "scheduled" | "partially_settled" | "settled" | "cancelled";
export type PayrollInstallmentStatus = "scheduled" | "applied" | "deferred" | "cancelled";

export const PAYROLL_OBLIGATION_STATUSES: Readonly<Record<string, PayrollObligationStatus>>;
export const PAYROLL_INSTALLMENT_STATUSES: Readonly<Record<string, PayrollInstallmentStatus>>;

export function normalizePayrollMonth(value: unknown): string;
export function assertDeferrableDeductionKind(kind: unknown): string;

export function buildDeferredDeduction(input: {
  kind: string;
  originalPayrollMonth: string;
  targetPayrollMonth: string;
  amountHalalas: number;
  reason: string;
  note?: string | null;
  sourceType?: string | null;
  sourceRef?: string | null;
  createdByUid?: string | null;
  createdByEmail?: string | null;
  createdAt?: string | null;
}): Record<string, unknown>;

export function buildInstallmentPlan(input: {
  kind: string;
  originalPayrollMonth: string;
  amountHalalas: number;
  reason: string;
  note?: string | null;
  sourceType?: string | null;
  sourceRef?: string | null;
  createdByUid?: string | null;
  createdByEmail?: string | null;
  createdAt?: string | null;
  installments: Array<{ targetPayrollMonth: string; amountHalalas: number }>;
}): Record<string, unknown>;

export const PAYROLL_OBLIGATION_SOURCE_TYPE: "payroll_obligation";
export function isPayrollObligationDeductionItem(item: unknown): boolean;
export function isAttendancePayrollObligationDeductionItem(item: unknown): boolean;
export function payrollAttendanceObligationDeductionTotal(items: readonly unknown[] | null | undefined): number;
export function payrollOtherObligationDeductionTotal(items: readonly unknown[] | null | undefined): number;
export function payrollObligationDeductionItem(input: {
  obligationId: string;
  installmentId: string;
  recurringDeductionId?: string | null;
  obligationKind: string;
  title?: string | null;
  amountHalalas: number;
  originalPayrollMonth: string;
  targetPayrollMonth: string;
  reason: string;
  note?: string | null;
  sourceType?: string | null;
  sourceRef?: string | null;
}): Record<string, unknown>;
export function withoutPayrollObligationDeductionItems<T = Record<string, unknown>>(items: readonly T[] | null | undefined): T[];
export function payrollObligationDeductionTotal(items: readonly unknown[] | null | undefined): number;
