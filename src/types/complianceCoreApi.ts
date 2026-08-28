export type CorePayrollDeductionClassificationInput = {
  laborDeductionClass: string;
  reason: string;
  writtenConsentReference?: string | null;
  courtOrderReference?: string | null;
  judicialMonthlyCapBps?: number | null;
  evidenceReference?: string | null;
};

export type CorePayrollDeductionClassificationEvent = Record<string, unknown> & {
  id: string;
  salonId: string;
  employeeId: string;
  entityType: "payroll_obligation" | "recurring_deduction" | string;
  entityId: string;
  previousClass?: string | null;
  nextClass: string;
  reason: string;
  actorUid?: string | null;
  actorEmail?: string | null;
  createdAt: string;
};

export type CorePayrollDeductionCourtOverride = Record<string, unknown> & {
  id: string;
  salonId: string;
  employeeId: string;
  payrollMonth: string;
  maxTotalDeductionBps: number;
  laborCourtReference: string;
  reason: string;
  status: "active" | "cancelled" | string;
  cancellationReason?: string | null;
  cancelledAt?: string | null;
  createdAt?: string | null;
};

export type CoreDisciplinaryCase = Record<string, unknown> & {
  id: string;
  salonId: string;
  employeeId: string;
  violationReference: string;
  violationCode?: string | null;
  incidentDate?: string | null;
  discoveredDate: string;
  allegationNotifiedAt: string;
  investigationCompletedAt: string;
  defenseMinutesReference: string;
  decisionAt: string;
  employeeNotificationReference: string;
  penaltyType: "warning" | "fine" | string;
  fineHalalas: number;
  dailyWageSnapshotHalalas: number;
  targetPayrollMonth?: string | null;
  payrollObligationId?: string | null;
  status: "decided" | "cancelled" | string;
  decisionReason: string;
  policyVersion: string;
  cancellationReason?: string | null;
  cancelledAt?: string | null;
  createdAt?: string | null;
};
