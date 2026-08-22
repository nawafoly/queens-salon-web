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
} from "../types/hrCoreApi";

function camel<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())] = value;
  }
  return out as T;
}

export const CoreHrService = {
  async listEmployees(query: { search?: string; status?: string } = {}) {
    const rows = await coreApiRequest<Record<string, unknown>[]>("/api/core/hr/employees", { query });
    return rows.map((row) => ({ ...camel<CoreHrEmployee>(row), schedules: Array.isArray(row.schedules) ? row.schedules.map((item) => camel<CoreHrSchedule>(item as Record<string, unknown>)) : [] }));
  },
  async getEmployee(id: string) {
    const row = await coreApiRequest<Record<string, unknown>>(`/api/core/hr/employees/${encodeURIComponent(id)}`);
    return { ...camel<CoreHrEmployee>(row), schedules: Array.isArray(row.schedules) ? row.schedules.map((item) => camel<CoreHrSchedule>(item as Record<string, unknown>)) : [] };
  },
  async saveEmployee(input: Record<string, unknown>) {
    const id = String(input.id || "").trim();
    const hrInput: Record<string, unknown> = { ...input };

    const row = await coreApiRequest<Record<string, unknown>>(id ? `/api/core/hr/employees/${encodeURIComponent(id)}` : "/api/core/hr/employees", { method: id ? "PATCH" : "POST", body: hrInput });
    return camel<CoreHrEmployee>(row);
  },
  async replaceSchedules(employeeId: string, schedules: CoreHrSchedule[]) {
    const row = await coreApiRequest<Record<string, unknown>>(`/api/core/hr/employees/${encodeURIComponent(employeeId)}/schedules`, { method: "PUT", body: { schedules } });
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
    return camel<CoreShiftTemplate>(row);
  },
  async listShiftAssignments(query: { employeeId?: string } = {}) {
    const rows = await coreApiRequest<Record<string, unknown>[]>("/api/core/hr/shift-assignments", { query });
    return rows.map((row) => camel<CoreShiftAssignment>(row));
  },
  async createShiftAssignment(input: Record<string, unknown>) {
    return camel<CoreShiftAssignment>(await coreApiRequest<Record<string, unknown>>("/api/core/hr/shift-assignments", { method: "POST", body: input }));
  },
  async updateShiftAssignment(id: string, input: Record<string, unknown>) {
    return camel<CoreShiftAssignment>(await coreApiRequest<Record<string, unknown>>(`/api/core/hr/shift-assignments/${encodeURIComponent(id)}`, { method: "PATCH", body: input }));
  },
  async cancelShiftAssignment(id: string, reason: string, options: Record<string, unknown> = {}) {
    return camel<CoreShiftAssignment>(await coreApiRequest<Record<string, unknown>>(`/api/core/hr/shift-assignments/${encodeURIComponent(id)}`, { method: "DELETE", body: { reason, ...options } }));
  },
  async listScheduleExceptions(query: { employeeId?: string } = {}) {
    const rows = await coreApiRequest<Record<string, unknown>[]>("/api/core/hr/schedule-exceptions", { query });
    return rows.map((row) => camel<CoreScheduleException>(row));
  },
  async createScheduleException(input: Record<string, unknown>) {
    return camel<CoreScheduleException>(await coreApiRequest<Record<string, unknown>>("/api/core/hr/schedule-exceptions", { method: "POST", body: input }));
  },
  async updateScheduleException(id: string, input: Record<string, unknown>) {
    return camel<CoreScheduleException>(await coreApiRequest<Record<string, unknown>>(`/api/core/hr/schedule-exceptions/${encodeURIComponent(id)}`, { method: "PATCH", body: input }));
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
  }) {
    const employeeIds = Array.from(
      new Set(
        input.employeeIds
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      )
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

    if (!employeeIds.length) {
      return {
        dateFrom: dateKeys[0],
        dateTo:
          dateKeys[
            dateKeys.length - 1
          ],
        employeesCount: 0,
        daysCount: dateKeys.length,
        rows: [] as CoreResolvedShift[],
      };
    }

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

    return {
      dateFrom: dateKeys[0],
      dateTo:
        dateKeys[
          dateKeys.length - 1
        ],
      employeesCount:
        employeeIds.length,
      daysCount:
        dateKeys.length,
      rows,
    };
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
  async getPayrollEntry(id: string) {
    const row = await coreApiRequest<Record<string, unknown>>(`/api/core/hr/payroll-entries/${encodeURIComponent(id)}`);
    return camel<CorePayrollEntry>(row);
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
