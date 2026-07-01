import { HR_COLLECTIONS } from "../../services/hrCollections";
import type { EmployeeAbsenceDoc, EmployeeAbsenceType } from "../../types/hrEmployee";

export const EMPLOYEE_ABSENCES_COLLECTION = HR_COLLECTIONS.employeeAbsences[2];

function toDateSafe(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "object" && value !== null) {
    const maybeTimestamp = value as { toDate?: () => Date; seconds?: number; nanoseconds?: number };
    if (typeof maybeTimestamp.toDate === "function") {
      const date = maybeTimestamp.toDate();
      return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof maybeTimestamp.seconds === "number") {
      const date = new Date(maybeTimestamp.seconds * 1000 + Math.floor((maybeTimestamp.nanoseconds || 0) / 1000000));
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateEN(date: Date, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", options).format(date);
}

function formatNumberEN(value: number, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat("en-US", options).format(value);
}
export const EMPLOYEE_ABSENCE_TYPE_OPTIONS: Array<{
  value: EmployeeAbsenceType;
  label: string;
}> = [
  { value: "full_day", label: "يوم كامل" },
  { value: "half_day", label: "نصف يوم" },
];

export type EmployeeAbsenceRecord = EmployeeAbsenceDoc & {
  id: string;
  createdAtDate: Date | null;
};

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

function toAbsenceDate(value: unknown) {
  if (!value) return null;

  if (typeof value === "string") {
    const normalized = String(value || "").trim();
    const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      const [, year, month, day] = match;
      return new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
        12,
        0,
        0,
        0
      );
    }
  }

  const parsed = toDateSafe(value);
  if (!parsed) return null;

  return new Date(
    parsed.getFullYear(),
    parsed.getMonth(),
    parsed.getDate(),
    12,
    0,
    0,
    0
  );
}

export function buildEmployeeAbsenceDateInput(date: Date = new Date()) {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(
    date.getDate()
  )}`;
}

export function normalizeEmployeeAbsenceDate(value: unknown) {
  const date = toAbsenceDate(value);
  if (!date) return "";

  return buildEmployeeAbsenceDateInput(date);
}

export function isValidEmployeeAbsenceDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

export function getEmployeeAbsenceTypeLabel(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase();

  return (
    EMPLOYEE_ABSENCE_TYPE_OPTIONS.find(option => option.value === normalized)
      ?.label ||
    String(value || "").trim() ||
    "غير محدد"
  );
}

export function getEmployeeAbsenceDaysValue(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase();

  if (normalized === "half_day") return 0.5;
  if (normalized === "full_day") return 1;
  return 0;
}

export function formatEmployeeAbsenceDays(value: unknown) {
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized <= 0) return "—";
  return `${formatNumberEN(normalized, {
    minimumFractionDigits: normalized % 1 === 0 ? 0 : 1,
    maximumFractionDigits: normalized % 1 === 0 ? 0 : 1,
  })} يوم`;
}

export function formatEmployeeAbsenceDate(value: unknown) {
  const date = toAbsenceDate(value);
  if (!date) return "—";
  return formatDateEN(date);
}

export function buildEmployeeAbsencePayload(input: {
  employeeId: string;
  employeeUid: string;
  date: string;
  type: EmployeeAbsenceType;
  note?: string | null;
  createdByUid: string;
}): EmployeeAbsenceDoc {
  return {
    employeeId: String(input.employeeId || "").trim(),
    employeeUid: String(input.employeeUid || "").trim(),
    date: normalizeEmployeeAbsenceDate(input.date),
    type: (String(input.type || "full_day").trim().toLowerCase() as EmployeeAbsenceType) ||
      "full_day",
    note: String(input.note || "").trim() || null,
    createdByUid: String(input.createdByUid || "").trim(),
  };
}

export function normalizeEmployeeAbsence(
  id: string,
  raw: Record<string, any>
): EmployeeAbsenceRecord {
  return {
    id,
    employeeId: String(raw.employeeId || "").trim(),
    employeeUid: String(raw.employeeUid || "").trim(),
    date: normalizeEmployeeAbsenceDate(raw.date),
    type:
      (String(raw.type || "full_day").trim().toLowerCase() as EmployeeAbsenceType) ||
      "full_day",
    note: String(raw.note || "").trim() || null,
    createdAt: raw.createdAt ?? null,
    createdByUid: String(raw.createdByUid || "").trim(),
    createdAtDate: toDateSafe(raw.createdAt),
  };
}

export function sortEmployeeAbsences<T extends EmployeeAbsenceDoc>(absences: T[]) {
  return [...absences].sort((left, right) => {
    const byDate = String(right.date || "").localeCompare(String(left.date || ""));
    if (byDate !== 0) return byDate;

    const leftTime = toDateSafe(left.createdAt)?.getTime() || 0;
    const rightTime = toDateSafe(right.createdAt)?.getTime() || 0;
    return rightTime - leftTime;
  });
}

