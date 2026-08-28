import { coreApiRequest } from "./coreApiClient";
import type {
  CorePublicHolidayWorkAssignment,
  CorePublicHolidayWorkReconciliation,
  CoreSaudiEidHolidayPeriod,
  CoreSaudiPublicHolidayCalendarEntry,
  CoreWeeklyRestReconciliation,
} from "../types/holidayComplianceCoreApi";

function camel<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())] = value;
  }
  return out as T;
}

export const CoreHolidayComplianceService = {
  async ensureFixedSaudiPublicHolidays(year: number) {
    const rows = await coreApiRequest<Record<string, unknown>[]>(
      `/api/core/hr/public-holidays/fixed/${encodeURIComponent(String(year))}/ensure`,
      { method: "POST", body: {} }
    );
    return rows.map((row) => camel<CoreSaudiPublicHolidayCalendarEntry>(row));
  },

  async verifySaudiEidHolidayPeriod(input: {
    holidayCode: "eid_al_fitr" | "eid_al_adha";
    holidayStartDate: string;
    sourceType: string;
    sourceReference: string;
  }) {
    const result = await coreApiRequest<{
      holidayCode: string;
      startDate: string;
      dayCount: 4;
      entries: Record<string, unknown>[];
    }>("/api/core/hr/public-holidays/eid-periods", {
      method: "POST",
      body: input,
    });
    return {
      ...result,
      entries: Array.isArray(result.entries)
        ? result.entries.map((row) => camel<CoreSaudiPublicHolidayCalendarEntry>(row))
        : [],
    } as CoreSaudiEidHolidayPeriod;
  },

  async createPublicHolidayWorkAssignment(input: {
    employeeId: string;
    holidayDate: string;
    reason: string;
    note?: string | null;
  }) {
    const row = await coreApiRequest<Record<string, unknown>>(
      "/api/core/hr/public-holiday-work-assignments",
      { method: "POST", body: input }
    );
    return camel<CorePublicHolidayWorkAssignment>(row);
  },

  async reconcilePublicHolidayWork(input: {
    employeeId: string;
    holidayDate: string;
  }) {
    const row = await coreApiRequest<Record<string, unknown>>(
      "/api/core/hr/public-holiday-work/reconcile",
      { method: "POST", body: input }
    );
    return camel<CorePublicHolidayWorkReconciliation>(row);
  },

  async reconcileWeeklyRest(input: {
    employeeId: string;
    restDate: string;
  }) {
    const row = await coreApiRequest<Record<string, unknown>>(
      "/api/core/hr/weekly-rest/reconcile",
      { method: "POST", body: input }
    );
    return camel<CoreWeeklyRestReconciliation>(row);
  },
};
