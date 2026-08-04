import type { ExportV2Value, ExportV2ValueType } from "./types";

const ARABIC_LOCALE = "ar-SA-u-ca-gregory-nu-latn";

function finiteNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function exportV2SafeText(value: unknown, fallback = "غير متوفر") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

export function exportV2FormatCurrency(value: unknown) {
  return new Intl.NumberFormat(ARABIC_LOCALE, {
    style: "currency",
    currency: "SAR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(finiteNumber(value));
}

export function exportV2FormatNumber(value: unknown) {
  return new Intl.NumberFormat(ARABIC_LOCALE, {
    maximumFractionDigits: 2,
  }).format(finiteNumber(value));
}

export function exportV2FormatDate(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "غير متوفر";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text)
    ? new Date(`${text}T00:00:00+03:00`)
    : new Date(text);
  if (!Number.isFinite(date.getTime())) return text;
  return new Intl.DateTimeFormat(ARABIC_LOCALE, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function exportV2FormatDateTime(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "غير متوفر";
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) return text;
  return new Intl.DateTimeFormat(ARABIC_LOCALE, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function exportV2FormatPeriod(from?: string | null, to?: string | null) {
  const normalizedFrom = String(from || "").trim();
  const normalizedTo = String(to || "").trim();
  if (normalizedFrom && normalizedTo) {
    return `${exportV2FormatDate(normalizedFrom)} — ${exportV2FormatDate(normalizedTo)}`;
  }
  if (normalizedFrom) return `من ${exportV2FormatDate(normalizedFrom)}`;
  if (normalizedTo) return `إلى ${exportV2FormatDate(normalizedTo)}`;
  return "كل الفترات";
}

export function exportV2FormatValue(value: ExportV2Value, type: ExportV2ValueType = "text") {
  if (value == null || value === "") return "—";
  if (type === "currency") return exportV2FormatCurrency(value);
  if (type === "number") return exportV2FormatNumber(value);
  if (type === "date") return exportV2FormatDate(value);
  if (type === "datetime") return exportV2FormatDateTime(value);
  if (value instanceof Date) return exportV2FormatDateTime(value.toISOString());
  if (typeof value === "boolean") return value ? "نعم" : "لا";
  return String(value);
}

export function exportV2NumericValue(value: ExportV2Value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
