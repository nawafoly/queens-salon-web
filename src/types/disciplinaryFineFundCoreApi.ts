export type CoreDisciplinaryFineFundApprovalAuthority = "labor_committee" | "ministry";

export type CoreDisciplinaryFineFundBalance = {
  salonId: string;
  balanceHalalas: number;
  lastEntryId?: string | null;
  version: number;
  updatedAt: string;
};

export type CoreDisciplinaryFineFundLedgerEntry = Record<string, unknown> & {
  id: string;
  salonId: string;
  entryKind: "collection" | "disbursement" | string;
  amountHalalas: number;
  balanceBeforeHalalas: number;
  balanceAfterHalalas: number;
  sourceType: string;
  sourceId: string;
  disciplinaryCaseId?: string | null;
  payrollObligationId?: string | null;
  payrollInstallmentId?: string | null;
  payrollEntryId?: string | null;
  benefitPurpose?: string | null;
  beneficiaryDescription?: string | null;
  approvalAuthority?: CoreDisciplinaryFineFundApprovalAuthority | null;
  approvalReference?: string | null;
  createdAt: string;
};

export type CoreDisciplinaryFineFundDisbursementInput = {
  operationId: string;
  amountHalalas: number;
  benefitPurpose: string;
  beneficiaryDescription: string;
  approvalAuthority: CoreDisciplinaryFineFundApprovalAuthority;
  approvalReference: string;
};

export type CoreDisciplinaryFineFundDisbursementResult = {
  entry: CoreDisciplinaryFineFundLedgerEntry;
  state: CoreDisciplinaryFineFundBalance;
  idempotent: boolean;
};
