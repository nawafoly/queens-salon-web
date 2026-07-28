// CORE D1 ONLY — do not add Firestore fallback.
import { coreApiRequest } from "./coreApiClient";
import type {
  CoreAbsence,
  CoreAttendanceRecord,
  CoreAttendanceState,
  CoreHrEmployee,
  CoreHrSchedule,
  CoreScheduleException,
  CoreShiftAssignment,
  CoreShiftTemplate,
  CoreLeave,
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
    const row = await coreApiRequest<Record<string, unknown>>(id ? `/api/core/hr/employees/${encodeURIComponent(id)}` : "/api/core/hr/employees", { method: id ? "PATCH" : "POST", body: input });
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
  async saveShiftTemplate(input: Partial<CoreShiftTemplate> & { name: string }) {
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
  async listScheduleExceptions(query: { employeeId?: string } = {}) {
    const rows = await coreApiRequest<Record<string, unknown>[]>("/api/core/hr/schedule-exceptions", { query });
    return rows.map((row) => camel<CoreScheduleException>(row));
  },
  async createScheduleException(input: Record<string, unknown>) {
    return camel<CoreScheduleException>(await coreApiRequest<Record<string, unknown>>("/api/core/hr/schedule-exceptions", { method: "POST", body: input }));
  },
  async resolveEmployeeShift(employeeId: string, date: string) {
    const row = await coreApiRequest<Record<string, unknown>>(`/api/core/hr/employees/${encodeURIComponent(employeeId)}/resolved-shift`, { query: { date } });
    return camel<Record<string, unknown>>(row);
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
