import { coreApiRequest } from "./coreApiClient";
import type {
  CorePayrollObligation,
  CorePayrollRecurringDeduction,
} from "../types/hrCoreApi";
import type {
  CoreDisciplinaryCase,
  CorePayrollDeductionClassificationEvent,
  CorePayrollDeductionClassificationInput,
  CorePayrollDeductionCourtOverride,
} from "../types/complianceCoreApi";

function camel<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())] = value;
  }
  return out as T;
}

export const CoreComplianceService = {
  async classifyPayrollObligation(
    obligationId: string,
    input: CorePayrollDeductionClassificationInput
  ) {
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/hr/payroll-obligations/${encodeURIComponent(obligationId)}/classification`,
      { method: "POST", body: input }
    );
    return camel<CorePayrollObligation>(row);
  },

  async classifyRecurringPayrollDeduction(
    recurringDeductionId: string,
    input: CorePayrollDeductionClassificationInput
  ) {
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/hr/payroll-recurring-deductions/${encodeURIComponent(recurringDeductionId)}/classification`,
      { method: "POST", body: input }
    );
    return camel<CorePayrollRecurringDeduction>(row);
  },

  async listPayrollDeductionClassificationEvents(
    query: { employeeId?: string; entityId?: string } = {}
  ) {
    const rows = await coreApiRequest<Record<string, unknown>[]>(
      "/api/core/hr/payroll-deduction-classification-events",
      { query }
    );
    return rows.map((row) => camel<CorePayrollDeductionClassificationEvent>(row));
  },

  async listPayrollDeductionCourtOverrides(
    query: { employeeId?: string; payrollMonth?: string; status?: string } = {}
  ) {
    const rows = await coreApiRequest<Record<string, unknown>[]>(
      "/api/core/hr/payroll-deduction-overrides",
      { query }
    );
    return rows.map((row) => camel<CorePayrollDeductionCourtOverride>(row));
  },

  async createPayrollDeductionCourtOverride(input: {
    employeeId: string;
    payrollMonth: string;
    maxTotalDeductionBps: number;
    laborCourtReference: string;
    reason: string;
  }) {
    const row = await coreApiRequest<Record<string, unknown>>(
      "/api/core/hr/payroll-deduction-overrides",
      { method: "POST", body: input }
    );
    return camel<CorePayrollDeductionCourtOverride>(row);
  },

  async cancelPayrollDeductionCourtOverride(id: string, reason: string) {
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/hr/payroll-deduction-overrides/${encodeURIComponent(id)}/cancel`,
      { method: "POST", body: { reason } }
    );
    return camel<CorePayrollDeductionCourtOverride>(row);
  },

  async listDisciplinaryCases(
    query: { employeeId?: string; status?: string; payrollMonth?: string } = {}
  ) {
    const rows = await coreApiRequest<Record<string, unknown>[]>(
      "/api/core/hr/disciplinary-cases",
      { query }
    );
    return rows.map((row) => camel<CoreDisciplinaryCase>(row));
  },

  async createDisciplinaryCase(input: Record<string, unknown>) {
    const row = await coreApiRequest<Record<string, unknown>>(
      "/api/core/hr/disciplinary-cases",
      { method: "POST", body: input }
    );
    return camel<CoreDisciplinaryCase>(row);
  },

  async cancelDisciplinaryCase(id: string, reason: string) {
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/hr/disciplinary-cases/${encodeURIComponent(id)}/cancel`,
      { method: "POST", body: { reason } }
    );
    return camel<CoreDisciplinaryCase>(row);
  },
};
