export type ExportV2Value = string | number | boolean | Date | null | undefined;

export type ExportV2ValueType =
  | "text"
  | "number"
  | "currency"
  | "date"
  | "datetime"
  | "status";

export type ExportV2Tone = "default" | "gold" | "success" | "danger" | "dark" | "neutral";

export type ExportV2Column<Row extends Record<string, ExportV2Value>> = {
  key: keyof Row & string;
  header: string;
  type?: ExportV2ValueType;
  width?: number;
  align?: "right" | "center" | "left";
  hideInPdf?: boolean;
};

export type ExportV2SummaryItem = {
  label: string;
  value: ExportV2Value;
  type?: ExportV2ValueType;
  tone?: ExportV2Tone;
};

export type ExportV2MetaItem = {
  label: string;
  value: ExportV2Value;
};

export type ExportV2Branding = {
  salonName?: string;
  brandName?: string;
  logoUrl?: string;
};

export type ExportV2DateRange = {
  from?: string | null;
  to?: string | null;
};

export type ExportV2Report<Row extends Record<string, ExportV2Value>> = {
  slug: string;
  reportCode?: string;
  title: string;
  subtitle?: string;
  summarySheetName?: string;
  detailsSheetName?: string;
  period: string;
  dateRange?: ExportV2DateRange;
  generatedAt: string;
  generatedBy: string;
  branding?: ExportV2Branding;
  filters?: ExportV2MetaItem[];
  summary: ExportV2SummaryItem[];
  columns: ExportV2Column<Row>[];
  rows: Row[];
  totals?: Partial<Record<keyof Row & string, number>>;
  emptyMessage?: string;
  notes?: string[];
  pdfOrientation?: "portrait" | "landscape";
};
