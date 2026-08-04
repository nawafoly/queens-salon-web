import type { ExportV2Report, ExportV2Value } from "./types";

function safeSegment(value: unknown, fallback: string) {
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return text || fallback;
}

function dateSegment(value?: string | null) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

export function buildExportV2FileName<Row extends Record<string, ExportV2Value>>(
  report: ExportV2Report<Row>,
  extension: "pdf" | "xlsx"
) {
  const slug = safeSegment(report.slug, "report");
  const from = dateSegment(report.dateRange?.from);
  const to = dateSegment(report.dateRange?.to);
  const generatedDate = String(report.generatedAt || new Date().toISOString()).slice(0, 10);

  let period = generatedDate;
  if (from && to) period = `${from}-to-${to}`;
  else if (from) period = `from-${from}`;
  else if (to) period = `to-${to}`;

  return `malikat-${slug}-${period}.${extension}`;
}
