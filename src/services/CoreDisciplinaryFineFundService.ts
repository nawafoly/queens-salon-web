import { coreApiRequest } from "./coreApiClient";
import type {
  CoreDisciplinaryFineFundBalance,
  CoreDisciplinaryFineFundDisbursementInput,
  CoreDisciplinaryFineFundDisbursementResult,
  CoreDisciplinaryFineFundLedgerEntry,
} from "../types/disciplinaryFineFundCoreApi";

function camel<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())] = value;
  }
  return out as T;
}

export const CoreDisciplinaryFineFundService = {
  async getBalance() {
    return coreApiRequest<CoreDisciplinaryFineFundBalance>(
      "/api/core/hr/disciplinary-fine-fund/balance"
    );
  },

  async listLedger(
    query: { entryKind?: "collection" | "disbursement"; disciplinaryCaseId?: string } = {}
  ) {
    const rows = await coreApiRequest<Record<string, unknown>[]>(
      "/api/core/hr/disciplinary-fine-fund/ledger",
      { query }
    );
    return rows.map((row) => camel<CoreDisciplinaryFineFundLedgerEntry>(row));
  },

  async createDisbursement(input: CoreDisciplinaryFineFundDisbursementInput) {
    const result = await coreApiRequest<{
      entry: Record<string, unknown>;
      state: CoreDisciplinaryFineFundBalance;
      idempotent: boolean;
    }>(
      "/api/core/hr/disciplinary-fine-fund/disbursements",
      { method: "POST", body: input }
    );
    return {
      ...result,
      entry: camel<CoreDisciplinaryFineFundLedgerEntry>(result.entry),
    } as CoreDisciplinaryFineFundDisbursementResult;
  },
};
