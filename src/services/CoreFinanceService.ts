import { coreApiRequest } from "./coreApiClient";
import {
  mapCoreExpense,
  mapCoreIncome,
} from "./coreBookingMappers";
import type {
  CoreExpenseEntry,
  CoreIncomeEntry,
} from "../types/coreApi";

export const CoreFinanceService = {
  async listIncome(): Promise<CoreIncomeEntry[]> {
    const rows = await coreApiRequest<Record<string, unknown>[]>(
      "/api/core/income"
    );
    return rows.map(mapCoreIncome);
  },

  async createIncome(
    input: Record<string, unknown>
  ): Promise<CoreIncomeEntry> {
    const row = await coreApiRequest<Record<string, unknown>>(
      "/api/core/income",
      { method: "POST", body: input }
    );
    return mapCoreIncome(row);
  },

  async listExpenses(): Promise<CoreExpenseEntry[]> {
    const rows = await coreApiRequest<Record<string, unknown>[]>(
      "/api/core/expenses"
    );
    return rows.map(mapCoreExpense);
  },

  async createExpense(
    input: Record<string, unknown>
  ): Promise<CoreExpenseEntry> {
    const row = await coreApiRequest<Record<string, unknown>>(
      "/api/core/expenses",
      { method: "POST", body: input }
    );
    return mapCoreExpense(row);
  },

  async patchExpense(
    id: string,
    input: Record<string, unknown>
  ): Promise<CoreExpenseEntry> {
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/expenses/${encodeURIComponent(id)}`,
      { method: "PATCH", body: input }
    );
    return mapCoreExpense(row);
  },
};
