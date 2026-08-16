// CORE D1 ONLY — do not add Firestore fallback.
import { coreApiRequest } from "./coreApiClient";
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

const CORE_STAFF_LEAVE_FIELDS = ["leaveStartDate", "leaveEndDate", "leaveNote"] as const;

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

    if (id) {
      const staffLeavePatch: Record<string, unknown> = {};
      for (const key of CORE_STAFF_LEAVE_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(input, key)) continue;
        staffLeavePatch[key] = input[key];
        delete hrInput[key];
      }

      if (Object.keys(staffLeavePatch).length > 0) {
        const staffRow = await coreApiRequest<Record<string, unknown>>(
          `/api/core/staff/${encodeURIComponent(id)}`,
          { method: "PATCH", body: staffLeavePatch }
        );
        const hasHrFields = Object.entries(hrInput).some(
          ([key, value]) => key !== "id" && value !== undefined
        );
        if (!hasHrFields) {
          return camel<CoreHrEmployee>({
            id,
            name: staffRow.name || id,
          });
        }
      }
    }

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
  async listPayrollEntries(query: { employeeId?: string; payrollMonth?: string; status?: string } = {}) {
    const rows = await coreApiRequest<Record<string, unknown>[]>("/api/core/hr/payroll-entries", { query });
    return rows.map((row) => camel<CorePayrollEntry>(row));
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
