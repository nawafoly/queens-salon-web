import type { CoreScheduleException } from "../../types/hrCoreApi";

export const SCHEDULE_EXCEPTION_CHANGED_EVENT =
  "queens:schedule-exception-updated";

export type ScheduleExceptionFilter = "current" | "cancelled" | "all";

export type ScheduleExceptionAction = {
  kind: "cancel" | "restore";
  label: "إلغاء" | "استعادة";
};

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function readField<T = unknown>(
  row: Partial<CoreScheduleException> | Record<string, unknown>,
  camelKey: string,
  snakeKey = camelKey
): T | undefined {
  const record = row as Record<string, unknown>;
  return (record[camelKey] ?? record[snakeKey]) as T | undefined;
}

export function scheduleExceptionStatus(
  exception: Partial<CoreScheduleException> | Record<string, unknown>
): string {
  return cleanText(readField(exception, "status")).toLowerCase();
}

export function isCancelledScheduleException(
  exception: Partial<CoreScheduleException> | Record<string, unknown>
): boolean {
  return scheduleExceptionStatus(exception) === "cancelled";
}

export function isOperationalScheduleException(
  exception: Partial<CoreScheduleException> | Record<string, unknown>
): boolean {
  const status = scheduleExceptionStatus(exception);
  return status === "approved" || status === "active";
}

export function getScheduleExceptionAction(
  exception: Partial<CoreScheduleException> | Record<string, unknown>
): ScheduleExceptionAction {
  return isCancelledScheduleException(exception)
    ? { kind: "restore", label: "استعادة" }
    : { kind: "cancel", label: "إلغاء" };
}

export function filterScheduleExceptionsForView<T extends Partial<CoreScheduleException> | Record<string, unknown>>(
  rows: T[],
  filter: ScheduleExceptionFilter = "current"
): T[] {
  if (filter === "cancelled") {
    return rows.filter(isCancelledScheduleException);
  }
  if (filter === "all") {
    return rows.filter((row) => isOperationalScheduleException(row) || isCancelledScheduleException(row));
  }
  return rows.filter(isOperationalScheduleException);
}

export function getScheduleExceptionRestoreConfirmationMessage(
  exception: Partial<CoreScheduleException> | Record<string, unknown>,
  todayKey: string
): string {
  const dateTo = cleanText(readField(exception, "dateTo", "date_to"));
  if (dateTo && todayKey && dateTo < todayKey) {
    return "هذا الاستثناء يخص تاريخًا سابقًا، وقد يؤثر على سجل الحضور أو احتساب الرواتب. هل تريد استعادته؟";
  }
  return "هل تريد استعادة هذا الاستثناء؟";
}

export function buildScheduleExceptionRestorePayload(
  exception: Partial<CoreScheduleException> | Record<string, unknown>
): Record<string, unknown> {
  const exceptionType = cleanText(readField(exception, "exceptionType", "exception_type"));
  const shiftTemplateId = readField(exception, "shiftTemplateId", "shift_template_id");
  const startTime = readField(exception, "startTime", "start_time");
  const endTime = readField(exception, "endTime", "end_time");
  const note = readField(exception, "note");

  return {
    employeeId: cleanText(readField(exception, "employeeId", "employee_id")),
    exceptionType,
    dateFrom: cleanText(readField(exception, "dateFrom", "date_from")),
    dateTo: cleanText(readField(exception, "dateTo", "date_to")),
    shiftTemplateId: exceptionType === "shift" ? cleanText(shiftTemplateId) || null : null,
    startTime: exceptionType === "custom" ? cleanText(startTime) || null : null,
    endTime: exceptionType === "custom" ? cleanText(endTime) || null : null,
    enabled: exceptionType === "off" ? false : true,
    note: note === undefined ? null : cleanText(note) || null,
    status: "approved",
  };
}
