// CORE D1 ONLY — do not add Firestore fallback.
import { coreApiRequest } from "./coreApiClient";
import { buildDateKeysInRange } from "../helpers/hr/workSchedule";
import type {
  CoreAbsence,
  CoreAttendanceRecord,
  CoreAttendanceState,
  CoreHrEmployee,
  CoreHrSchedule,
  CoreResolvedShift,
  CoreScheduleException,
  CoreShiftAssignment,
  CoreShiftChangePreview,
  CoreShiftPayrollAdjustment,
  CoreShiftPayrollPeriodLock,
  CoreShiftTemplate,  CoreLeave,
  CoreLeaveBalanceEntry,
  CoreLeaveBalanceMutationResult,
  CoreLeaveBalanceState,
  CoreMyLeaveBalanceState,
  CorePayrollEntry,
  CorePayrollPeriod,
  CorePayrollCarryoverAdjustment,
  CorePayrollRecurringDeduction,
  CorePayrollObligation,
  CorePayrollObligationDeduction,
} from "../types/hrCoreApi";

function camel<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())] = value;
  }
  return out as T;
}

type CoreResolvedShiftRangeResult = {
  dateFrom: string;
  dateTo: string;
  employeesCount: number;
  daysCount: number;
  rows: CoreResolvedShift[];
};

type ResolvedShiftRangeCacheEntry = {
  employeeIds: string[];
  expiresAt: number;
  value: CoreResolvedShiftRangeResult;
};

type ResolvedShiftRangeInFlightEntry = {
  employeeIds: string[];
  epoch: number;
  promise: Promise<CoreResolvedShiftRangeResult>;
};

const RESOLVED_SHIFT_RANGE_CACHE_TTL_MS = 5_000;
const RESOLVED_SHIFT_RANGE_CACHE_MAX_ENTRIES = 32;
const resolvedShiftRangeCache = new Map<string, ResolvedShiftRangeCacheEntry>();
const resolvedShiftRangeInFlight = new Map<string, ResolvedShiftRangeInFlightEntry>();
let resolvedShiftRangeCacheEpoch = 0;

function normalizeResolvedShiftEmployeeIds(values: readonly unknown[]) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

function resolvedShiftRangeCacheKey(
  employeeIds: readonly string[],
  dateFrom: string,
  dateTo: string
) {
  return JSON.stringify([dateFrom, dateTo, employeeIds]);
}

function pruneResolvedShiftRangeCache(now = Date.now()) {
  for (const [key, entry] of resolvedShiftRangeCache) {
    if (entry.expiresAt <= now) resolvedShiftRangeCache.delete(key);
  }

  while (resolvedShiftRangeCache.size > RESOLVED_SHIFT_RANGE_CACHE_MAX_ENTRIES) {
    const oldestKey = resolvedShiftRangeCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    resolvedShiftRangeCache.delete(oldestKey);
  }
}

function invalidateResolvedShiftRangeCache(employeeId?: string) {
  resolvedShiftRangeCacheEpoch += 1;
  const targetEmployeeId = String(employeeId || "").trim();

  if (!targetEmployeeId) {
    resolvedShiftRangeCache.clear();
    resolvedShiftRangeInFlight.clear();
    return;
  }

  for (const [key, entry] of resolvedShiftRangeCache) {
    if (entry.employeeIds.includes(targetEmployeeId)) {
      resolvedShiftRangeCache.delete(key);
    }
  }

  // Epoch invalidation makes any request that started before this mutation
  // retry once. Clear all in-flight keys so that retry can never join itself.
  resolvedShiftRangeInFlight.clear();
}

export type CoreMyEmployeeProfileUpdate = {
  name?: string;
  phone?: string;
  avatarUrl?: string | null;
  bio?: string | null;
};

export const CoreHrService = {
  async listEmployees(query: { search?: string; status?: string } = {}) {
    const rows = await coreApiRequest<Record<string, unknown>[]>("/api/core/hr/employees", { query });
    return rows.map((row) => ({ ...camel<CoreHrEmployee>(row), schedules: Array.isArray(row.schedules) ? row.schedules.map((item) => camel<CoreHrSchedule>(item as Record<string, unknown>)) : [] }));
  },
  async getEmployee(id: string) {
    const row = await coreApiRequest<Record<string, unknown>>(`/api/core/hr/employees/${encodeURIComponent(id)}`);
    return { ...camel<CoreHrEmployee>(row), schedules: Array.isArray(row.schedules) ? row.schedules.map((item) => camel<CoreHrSchedule>(item as Record<string, unknown>)) : [] };
  },
  async getMyEmployeeProfile() {
    const row = await coreApiRequest<Record<string, unknown>>(
      "/api/core/hr/employee-profile/mine"
    );
    return {
      ...camel<CoreHrEmployee>(row),
      schedules: Array.isArray(row.schedules)
        ? row.schedules.map((item) => camel<CoreHrSchedule>(item as Record<string, unknown>))
        : [],
    };
  },
  async saveMyEmployeeProfile(input: CoreMyEmployeeProfileUpdate) {
    const row = await coreApiRequest<Record<string, unknown>>(
      "/api/core/hr/employee-profile/mine",
      { method: "PATCH", body: input as Record<string, unknown> }
    );
    return {
      ...camel<CoreHrEmployee>(row),
      schedules: Array.isArray(row.schedules)
        ? row.schedules.map((item) => camel<CoreHrSchedule>(item as Record<string, unknown>))
        : [],
    };
  },
  async saveEmployee(input: Record<string, unknown>) {
    const id = String(input.id || "").trim();
    const hrInput: Record<string, unknown> = { ...input };

    const row = await coreApiRequest<Record<string, unknown>>(id ? `/api/core/hr/employees/${encodeURIComponent(id)}` : "/api/core/hr/employees", { method: id ? "PATCH" : "POST", body: hrInput });
    return camel<CoreHrEmployee>(row);
  },
  async offboardEmployee(employeeId: string, input: { endDate: string; reason: string }) {
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/hr/employees/${encodeURIComponent(employeeId)}/offboard`,
      { method: "POST", body: input }
    );
    invalidateResolvedShiftRangeCache(employeeId);
    return camel<Record<string, unknown>>(row);
  },
  async replaceSchedules(employeeId: string, schedules: CoreHrSchedule[]) {
    const row = await coreApiRequest<Record<string, unknown>>(`/api/core/hr/employees/${encodeURIComponent(employeeId)}/schedules`, { method: "PUT", body: { schedules } });
    invalidateResolvedShiftRangeCache(employeeId);
    return camel<CoreHrEmployee>(row);
  },
  async listShiftTemplates(query: { active?: "all" } = {}) {
    const rows = await coreApiRequest<Record<string, unknown>[]>("/api/core/hr/shift-templates", { query });
    return rows.map((row) => camel<CoreShiftTemplate>(row));
  },
  async saveShiftTemplate(input: Partial<CoreShiftTemplate> & { name: string; reason?: string }) {
    const id = String(input.id || "").trim();
    const row = await coreApiRequest<Record<string, unknown>>(id ? `/api/core/hr/shift-templates/${encodeURIComponent(id)}` : "/api/core/hr/shift-templates", {
      method: id ? "PATCH" : "POST",
      body: input,
    });
    // A template edit can affect every employee assigned to it.
    invalidateResolvedShiftRangeCache();
    return camel<CoreShiftTemplate>(row);
  },
  async listShiftAssignments(query: { employeeId?: string } = {}) {
    const rows = await coreApiRequest<Record<string, unknown>[]>("/api/core/hr/shift-assignments", { query });
    return rows.map((row) => camel<CoreShiftAssignment>(row));
  },
  async createShiftAssignment(input: Record<string, unknown>) {
    const row = camel<CoreShiftAssignment>(await coreApiRequest<Record<string, unknown>>("/api/core/hr/shift-assignments", { method: "POST", body: input }));
    invalidateResolvedShiftRangeCache(String(row.employeeId || input.employeeId || ""));
    return row;
  },
  async updateShiftAssignment(id: string, input: Record<string, unknown>) {
    const row = camel<CoreShiftAssignment>(await coreApiRequest<Record<string, unknown>>(`/api/core/hr/shift-assignments/${encodeURIComponent(id)}`, { method: "PATCH", body: input }));
    invalidateResolvedShiftRangeCache(String(row.employeeId || input.employeeId || ""));
    return row;
  },
  async cancelShiftAssignment(id: string, reason: string, options: Record<string, unknown> = {}) {
    const row = camel<CoreShiftAssignment>(await coreApiRequest<Record<string, unknown>>(`/api/core/hr/shift-assignments/${encodeURIComponent(id)}`, { method: "DELETE", body: { reason, ...options } }));
    invalidateResolvedShiftRangeCache(String(row.employeeId || ""));
    return row;
  },
  async listScheduleExceptions(query: { employeeId?: string } = {}) {
    const rows = await coreApiRequest<Record<string, unknown>[]>("/api/core/hr/schedule-exceptions", { query });
    return rows.map((row) => camel<CoreScheduleException>(row));
  },
  async createScheduleException(input: Record<string, unknown>) {
    const row = camel<CoreScheduleException>(await coreApiRequest<Record<string, unknown>>("/api/core/hr/schedule-exceptions", { method: "POST", body: input }));
    invalidateResolvedShiftRangeCache(String(row.employeeId || input.employeeId || ""));
    return row;
  },
  async updateScheduleException(id: string, input: Record<string, unknown>) {
    const row = camel<CoreScheduleException>(await coreApiRequest<Record<string, unknown>>(`/api/core/hr/schedule-exceptions/${encodeURIComponent(id)}`, { method: "PATCH", body: input }));
    invalidateResolvedShiftRangeCache(String(row.employeeId || input.employeeId || ""));
    return row;
  },

  async syncWorkingHourScheduleExceptions(input: {
    employeeId: string;
    expectedOverrides: Array<Record<string, unknown>>;
    desiredOverrides: Array<Record<string, unknown>>;
  }) {
    const payload =
      await coreApiRequest<Record<string, unknown>>(
        "/api/core/hr/schedule-exceptions/working-hours-sync",
        {
          method: "PUT",
          body: input,
        }
      );

    invalidateResolvedShiftRangeCache(input.employeeId);

    return {
      employeeId:
        String(
          payload.employee_id ||
          payload.employeeId ||
          input.employeeId
        ),

      changed:
        payload.changed === true,

      createdCount:
        Number(
          payload.created_count ||
          payload.createdCount ||
          0
        ),

      cancelledCount:
        Number(
          payload.cancelled_count ||
          payload.cancelledCount ||
          0
        ),

      rows:
        Array.isArray(
          payload.rows
        )
          ? payload.rows.map(
              (row) =>
                camel<CoreScheduleException>(
                  row as Record<string, unknown>
                )
            )
          : [],

      overrides:
        Array.isArray(
          payload.overrides
        )
          ? payload.overrides
          : [],
    };
  },
  async resolveEmployeeShift(employeeId: string, date: string) {
    const row = await coreApiRequest<Record<string, unknown>>(`/api/core/hr/employees/${encodeURIComponent(employeeId)}/resolved-shift`, { query: { date } });
    return camel<CoreResolvedShift>(row);
  },

  async resolveMyShiftsRange(input: {
    dateFrom: string;
    dateTo: string;
  }): Promise<CoreResolvedShiftRangeResult> {
    const payload =
      await coreApiRequest<
        Record<string, unknown>
      >(
        "/api/core/hr/employee-portal/resolved-shifts",
        {
          query: {
            dateFrom:
              input.dateFrom,
            dateTo:
              input.dateTo,
          },
        }
      );

    const rows =
      Array.isArray(payload.rows)
        ? payload.rows.map(
            (row) =>
              camel<CoreResolvedShift>(
                row as Record<
                  string,
                  unknown
                >
              )
          )
        : [];

    return {
      dateFrom: String(
        payload.date_from ||
        payload.dateFrom ||
        input.dateFrom
      ),
      dateTo: String(
        payload.date_to ||
        payload.dateTo ||
        input.dateTo
      ),
      employeesCount: Number(
        payload.employees_count ||
        payload.employeesCount ||
        1
      ),
      daysCount: Number(
        payload.days_count ||
        payload.daysCount ||
        0
      ),
      rows,
    };
  },

  async resolveEmployeeShiftsBatch(input: {
    employeeIds: string[];
    dateFrom: string;
    dateTo: string;
  }) {
    const payload = await coreApiRequest<Record<string, unknown>>(
      "/api/core/hr/resolved-shifts/batch",
      {
        method: "POST",
        body: {
          employeeIds: input.employeeIds,
          dateFrom: input.dateFrom,
          dateTo: input.dateTo,
        },
      }
    );

    const rows = Array.isArray(payload.rows)
      ? payload.rows.map((row) =>
          camel<CoreResolvedShift>(row as Record<string, unknown>)
        )
      : [];

    return {
      dateFrom: String(payload.date_from || payload.dateFrom || input.dateFrom),
      dateTo: String(payload.date_to || payload.dateTo || input.dateTo),
      employeesCount: Number(
        payload.employees_count || payload.employeesCount || input.employeeIds.length
      ),
      daysCount: Number(payload.days_count || payload.daysCount || 0),
      rows,
    };
  },
  async resolveEmployeeShiftsRange(input: {
    employeeIds: string[];
    dateFrom: string;
    dateTo: string;
  }): Promise<CoreResolvedShiftRangeResult> {
    const employeeIds =
      normalizeResolvedShiftEmployeeIds(
        input.employeeIds
      );

    const dateKeys =
      buildDateKeysInRange(
        input.dateFrom,
        input.dateTo
      );

    if (!dateKeys.length) {
      throw new Error(
        "core_hr:invalid_resolved_shift_range"
      );
    }

    const dateFrom = dateKeys[0];
    const dateTo =
      dateKeys[dateKeys.length - 1];

    if (!employeeIds.length) {
      return {
        dateFrom,
        dateTo,
        employeesCount: 0,
        daysCount: dateKeys.length,
        rows: [] as CoreResolvedShift[],
      };
    }

    const cacheKey =
      resolvedShiftRangeCacheKey(
        employeeIds,
        dateFrom,
        dateTo
      );

    const now = Date.now();
    pruneResolvedShiftRangeCache(now);

    const cached =
      resolvedShiftRangeCache.get(
        cacheKey
      );

    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const existingInFlight =
      resolvedShiftRangeInFlight.get(
        cacheKey
      );

    if (existingInFlight) {
      return existingInFlight.promise;
    }

    const requestEpoch =
      resolvedShiftRangeCacheEpoch;

    let inFlightEntry:
      ResolvedShiftRangeInFlightEntry;

    const promise = (async () => {
      const rows: CoreResolvedShift[] = [];

      /*
       * Core Worker hard limits:
       * - maximum 100 employees/request
       * - maximum 62 days/request
       * - maximum 5000 employee-days/request
       *
       * Keep this orchestration here so consumers never
       * implement their own scheduling batch policy.
       */
      for (
        let dateOffset = 0;
        dateOffset < dateKeys.length;
        dateOffset += 62
      ) {
        const rangeKeys =
          dateKeys.slice(
            dateOffset,
            dateOffset + 62
          );

        const employeeChunkSize =
          Math.max(
            1,
            Math.min(
              100,
              Math.floor(
                5000 /
                  rangeKeys.length
              )
            )
          );

        const batches = [];

        for (
          let employeeOffset = 0;
          employeeOffset <
          employeeIds.length;
          employeeOffset +=
            employeeChunkSize
        ) {
          batches.push(
            CoreHrService.resolveEmployeeShiftsBatch({
              employeeIds:
                employeeIds.slice(
                  employeeOffset,
                  employeeOffset +
                    employeeChunkSize
                ),
              dateFrom:
                rangeKeys[0],
              dateTo:
                rangeKeys[
                  rangeKeys.length - 1
                ],
            })
          );
        }

        const resolved =
          await Promise.all(
            batches
          );

        rows.push(
          ...resolved.flatMap(
            (batch) =>
              batch.rows
          )
        );
      }

      const result: CoreResolvedShiftRangeResult = {
        dateFrom,
        dateTo,
        employeesCount:
          employeeIds.length,
        daysCount:
          dateKeys.length,
        rows,
      };

      // A schedule mutation may complete while this request is in flight.
      // Never cache that pre-mutation response; transparently resolve again.
      if (
        requestEpoch !==
        resolvedShiftRangeCacheEpoch
      ) {
        return CoreHrService
          .resolveEmployeeShiftsRange({
            employeeIds,
            dateFrom,
            dateTo,
          });
      }

      resolvedShiftRangeCache.set(
        cacheKey,
        {
          employeeIds,
          expiresAt:
            Date.now() +
            RESOLVED_SHIFT_RANGE_CACHE_TTL_MS,
          value: result,
        }
      );

      pruneResolvedShiftRangeCache();
      return result;
    })();

    inFlightEntry = {
      employeeIds,
      epoch: requestEpoch,
      promise,
    };

    resolvedShiftRangeInFlight.set(
      cacheKey,
      inFlightEntry
    );

    try {
      return await promise;
    } finally {
      if (
        resolvedShiftRangeInFlight.get(
          cacheKey
        ) === inFlightEntry
      ) {
        resolvedShiftRangeInFlight.delete(
          cacheKey
        );
      }
    }
  },

  invalidateResolvedShiftRangeCache(employeeId?: string) {
    invalidateResolvedShiftRangeCache(employeeId);
  },

  async previewShiftChange(input: Record<string, unknown>) {
    return camel<CoreShiftChangePreview>(await coreApiRequest<Record<string, unknown>>("/api/core/hr/shift-change-preview", { method: "POST", body: input }));
  },
  async listShiftPayrollAdjustments(query: { employeeId?: string } = {}) {
    const rows = await coreApiRequest<Record<string, unknown>[]>("/api/core/hr/shift-payroll-adjustments", { query });
    return rows.map((row) => camel<CoreShiftPayrollAdjustment>(row));
  },
  async listShiftPayrollPeriodLocks(query: { from?: string; to?: string } = {}) {
    const rows = await coreApiRequest<Record<string, unknown>[]>("/api/core/hr/shift-payroll-period-locks", { query });
    return rows.map((row) => camel<CoreShiftPayrollPeriodLock>(row));
  },
  async saveShiftPayrollPeriodLock(input: Record<string, unknown>) {
    return camel<CoreShiftPayrollPeriodLock>(await coreApiRequest<Record<string, unknown>>("/api/core/hr/shift-payroll-period-locks", { method: "POST", body: input }));
  },
  async listAttendance(query: { employeeId?: string; date?: string } = {}) {
    const rows = await coreApiRequest<Record<string, unknown>[]>("/api/core/hr/attendance", { query });
    return rows.map((row) => camel<CoreAttendanceRecord>(row));
  },
  async attendanceState(employeeId: string) {
    return camel<CoreAttendanceState>(await coreApiRequest<Record<string, unknown>>(`/api/core/hr/attendance/state/${encodeURIComponent(employeeId)}`));
  },
  async checkIn(input: Record<string, unknown>) {
    return camel<CoreAttendanceRecord>(await coreApiRequest<Record<string, unknown>>("/api/core/hr/attendance/check-in", { method: "POST", body: input }));
  },
  async checkOut(input: Record<string, unknown>) {
    return camel<CoreAttendanceRecord>(await coreApiRequest<Record<string, unknown>>("/api/core/hr/attendance/check-out", { method: "POST", body: input }));
  },
  async listMyLeaves(
    query: {
      status?: string;
    } = {}
  ) {
    const rows =
      await coreApiRequest<
        Record<string, unknown>[]
      >(
        "/api/core/hr/employee-portal/leaves",
        {
          query,
        }
      );

    return rows.map(
      (row) =>
        camel<CoreLeave>(row)
    );
  },
  async listLeaves(query: { employeeId?: string; status?: string } = {}) {
    const rows = await coreApiRequest<Record<string, unknown>[]>("/api/core/hr/leaves", { query });
    return rows.map((row) => camel<CoreLeave>(row));
  },
  async createLeave(input: Record<string, unknown>) {
    return camel<CoreLeave>(await coreApiRequest<Record<string, unknown>>("/api/core/hr/leaves", { method: "POST", body: input }));
  },
  async decideLeave(id: string, status: "approved" | "rejected", hrNote?: string) {
    const action = status === "approved" ? "approve" : "reject";
    return camel<CoreLeave>(await coreApiRequest<Record<string, unknown>>(`/api/core/hr/leaves/${encodeURIComponent(id)}/${action}`, { method: "POST", body: { hrNote } }));
  },
  async getMyLeaveBalance() {
    return coreApiRequest<CoreMyLeaveBalanceState>(
      "/api/core/hr/employee-portal/leave-balance"
    );
  },
  async getLeaveBalance(
    employeeId: string,
    query: {
      includeDeleted?: boolean | string;
      includeReversals?: boolean | string;
      limit?: number;
    } = {}
  ) {
    return coreApiRequest<CoreLeaveBalanceState>(
      `/api/core/hr/employees/${encodeURIComponent(employeeId)}/leave-balance`,
      { query }
    );
  },

  async adjustLeaveBalance(
    employeeId: string,
    input: {
      actionType: "add" | "deduct";
      operationId: string;
      days: number;
      operationDate: string;
      note?: string;
    }
  ) {
    return coreApiRequest<CoreLeaveBalanceMutationResult>(
      `/api/core/hr/employees/${encodeURIComponent(employeeId)}/leave-balance/adjustments`,
      {
        method: "POST",
        body: input,
      }
    );
  },

  async deleteLeaveBalanceEntry(
    employeeId: string,
    entryId: string
  ) {
    return coreApiRequest<CoreLeaveBalanceMutationResult>(
      `/api/core/hr/employees/${encodeURIComponent(employeeId)}/leave-balance/entries/${encodeURIComponent(entryId)}`,
      {
        method: "DELETE",
      }
    );
  },

  async setLeaveEntitlementDate(
    employeeId: string,
    leaveEntitlementDate: string
  ) {
    return coreApiRequest<CoreLeaveBalanceState>(
      `/api/core/hr/employees/${encodeURIComponent(employeeId)}/leave-balance/entitlement-date`,
      {
        method: "PATCH",
        body: {
          leaveEntitlementDate,
        },
      }
    );
  },
  async listMyAbsences() {
    const rows =
      await coreApiRequest<
        Record<string, unknown>[]
      >(
        "/api/core/hr/employee-portal/absences"
      );

    return rows.map(
      (row) =>
        camel<CoreAbsence>(row)
    );
  },
  async listAbsences(query: { employeeId?: string } = {}) {
    const rows = await coreApiRequest<Record<string, unknown>[]>("/api/core/hr/absences", { query });
    return rows.map((row) => camel<CoreAbsence>(row));
  },
  async createAbsence(input: Record<string, unknown>) {
    return camel<CoreAbsence>(await coreApiRequest<Record<string, unknown>>("/api/core/hr/absences", { method: "POST", body: input }));
  },
  async deleteAbsence(id: string) {
    return coreApiRequest<{ id: string; deleted: boolean }>(`/api/core/hr/absences/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  async listPayrollPeriods() {
    const rows = await coreApiRequest<Record<string, unknown>[]>("/api/core/hr/payroll-periods");
    return rows.map((row) => camel<CorePayrollPeriod>(row));
  },
  async savePayrollPeriod(input: Record<string, unknown>) {
    return camel<CorePayrollPeriod>(await coreApiRequest<Record<string, unknown>>("/api/core/hr/payroll-periods", { method: "POST", body: input }));
  },
  async listMyPayrollEntries() {
    const rows = await coreApiRequest<Record<string, unknown>[]>("/api/core/hr/payroll-entries/mine");
    return rows.map((row) => camel<CorePayrollEntry>(row));
  },

  async listPayrollEntries(query: { employeeId?: string; payrollMonth?: string; status?: string } = {}) {
    const rows = await coreApiRequest<Record<string, unknown>[]>("/api/core/hr/payroll-entries", { query });
    return rows.map((row) => camel<CorePayrollEntry>(row));
  },
  async listPayrollAdvanceDeductions(
    query: { employeeId?: string; payrollMonth?: string } = {}
  ) {
    const rows = await coreApiRequest<Record<string, unknown>[]>(
      "/api/core/hr/payroll-advance-deductions",
      { query }
    );
    return rows.map((row) =>
      camel<{
        employeeId: string;
        payrollMonth: string;
        amountHalalas: number;
      }>(row)
    );
  },
  async listPayrollRecurringDeductions(
    query: { employeeId?: string; status?: string } = {}
  ) {
    const rows = await coreApiRequest<Record<string, unknown>[]>(
      "/api/core/hr/payroll-recurring-deductions",
      { query }
    );
    return rows.map((row) => camel<CorePayrollRecurringDeduction>(row));
  },
  async savePayrollRecurringDeduction(input: Record<string, unknown>) {
    const id = String(input.id || "").trim();
    const row = await coreApiRequest<Record<string, unknown>>(
      id
        ? `/api/core/hr/payroll-recurring-deductions/${encodeURIComponent(id)}`
        : "/api/core/hr/payroll-recurring-deductions",
      { method: id ? "PATCH" : "POST", body: input }
    );
    return camel<CorePayrollRecurringDeduction>(row);
  },
  async listPayrollObligations(
    query: { employeeId?: string; status?: string } = {}
  ) {
    const rows = await coreApiRequest<Record<string, unknown>[]>(
      "/api/core/hr/payroll-obligations",
      { query }
    );
    return rows.map((row) => camel<CorePayrollObligation>(row));
  },
  async createPayrollObligation(input: Record<string, unknown>) {
    const row = await coreApiRequest<Record<string, unknown>>(
      "/api/core/hr/payroll-obligations",
      { method: "POST", body: input }
    );
    return camel<CorePayrollObligation>(row);
  },
  async cancelPayrollObligation(id: string, reason: string) {
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/hr/payroll-obligations/${encodeURIComponent(id)}/cancel`,
      { method: "POST", body: { reason } }
    );
    return camel<CorePayrollObligation>(row);
  },
  async deferPayrollObligationInstallment(
    id: string,
    input: { targetPayrollMonth: string; reason: string; note?: string | null }
  ) {
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/hr/payroll-obligation-installments/${encodeURIComponent(id)}/defer`,
      { method: "POST", body: input }
    );
    return camel<CorePayrollObligation>(row);
  },
  async deferSalaryAdvanceInstallment(
    id: string,
    input: {
      targetPayrollMonth: string;
      reason: string;
      note?: string | null;
      idempotencyKey: string;
    }
  ) {
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/hr/salary-advance-installments/${encodeURIComponent(id)}/defer`,
      { method: "POST", body: input }
    );
    return camel<Record<string, unknown>>(row);
  },
  async listPayrollObligationDeductions(
    query: { employeeId?: string; payrollMonth: string }
  ) {
    const rows = await coreApiRequest<Record<string, unknown>[]>(
      "/api/core/hr/payroll-obligations/deductions",
      { query }
    );
    return rows.map((row) => camel<CorePayrollObligationDeduction>(row));
  },
  async listPayrollCarryovers(
    query: {
      employeeId?: string;
      targetPayrollMonth?: string;
      sourcePayrollMonth?: string;
      status?: string;
    } = {}
  ) {
    const rows = await coreApiRequest<Record<string, unknown>[]>(
      "/api/core/hr/payroll-carryovers",
      { query }
    );
    return rows.map((row) => camel<CorePayrollCarryoverAdjustment>(row));
  },
  async reconcilePayrollCarryoversBatch(input: {
    items: Array<{
      sourcePayrollEntryId: string;
      targetPayrollMonth: string;
      recalculatedNetHalalas?: number;
      sourceDate?: string;
      reason?: string;
    }>;
  }) {
    const result = await coreApiRequest<{ results?: Array<Record<string, unknown>> }>(
      "/api/core/hr/payroll-reconciliations/batch",
      { method: "POST", body: input }
    );
    return {
      results: Array.isArray(result?.results)
        ? result.results.map((row) => camel<Record<string, unknown>>(row))
        : [],
    };
  },
  async getPayrollEntry(id: string) {
    const row = await coreApiRequest<Record<string, unknown>>(`/api/core/hr/payroll-entries/${encodeURIComponent(id)}`);
    return camel<CorePayrollEntry>(row);
  },
  async previewPayrollEntry(input: Record<string, unknown>) {
    return camel<CorePayrollEntry>(await coreApiRequest<Record<string, unknown>>("/api/core/hr/payroll-preview", { method: "POST", body: input }));
  },

  async deferAttendanceDeduction(input: {
    employeeId: string;
    originalPayrollMonth: string;
    targetPayrollMonth: string;
    reason: string;
    note?: string;
  }) {
    return coreApiRequest<Record<string, unknown>>(
      "/api/core/hr/payroll-attendance-deductions/defer",
      {
        method: "POST",
        body: input,
      }
    );
  },

  async savePayrollEntry(input: Record<string, unknown>) {
    return camel<CorePayrollEntry>(await coreApiRequest<Record<string, unknown>>("/api/core/hr/payroll-entries", { method: "POST", body: input }));
  },
  async updatePayrollEntryAdjustments(id: string, input: Record<string, unknown>) {
    const row = await coreApiRequest<Record<string, unknown>>(`/api/core/hr/payroll-entries/${encodeURIComponent(id)}/adjustments`, { method: "PATCH", body: input });
    return camel<CorePayrollEntry>(row);
  },
  async togglePayrollOvertime(id: string, input: Record<string, unknown>) {
    const row = await coreApiRequest<Record<string, unknown>>(`/api/core/hr/payroll-entries/${encodeURIComponent(id)}/overtime`, { method: "PATCH", body: input });
    return camel<CorePayrollEntry>(row);
  },
  async approvePayrollEntry(id: string) {
    const row = await coreApiRequest<Record<string, unknown>>(`/api/core/hr/payroll-entries/${encodeURIComponent(id)}/approve`, { method: "POST" });
    return camel<CorePayrollEntry>(row);
  },
  async markPayrollEntryPaid(id: string) {
    const row = await coreApiRequest<Record<string, unknown>>(`/api/core/hr/payroll-entries/${encodeURIComponent(id)}/paid`, { method: "POST" });
    return camel<CorePayrollEntry>(row);
  },
  async reopenPayrollEntry(id: string, input: { reason: string; status?: "draft" | "reviewed" }) {
    const row = await coreApiRequest<Record<string, unknown>>(`/api/core/hr/payroll-entries/${encodeURIComponent(id)}/reopen`, { method: "POST", body: input });
    return camel<CorePayrollEntry>(row);
  },
};
