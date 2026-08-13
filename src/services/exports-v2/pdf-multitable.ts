import { DOCUMENT_BRANDING } from "../../documents/core/documentBranding";
import { downloadExportV2Blob } from "./download";
import { buildExportV2FileName } from "./file-name";
import { exportV2FormatValue } from "./formatters";
import { buildPdfFromJpegPages } from "./pdf";
import type { ExportV2Column, ExportV2ExtraTable, ExportV2Report, ExportV2Value } from "./types";

type PdfPage = { bytes: Uint8Array; width: number; height: number };

type Layout = {
  canvasWidth: number;
  canvasHeight: number;
  pageWidthPoints: number;
  pageHeightPoints: number;
  margin: number;
  footerY: number;
};

const FONT_FAMILY = 'Tahoma, Arial, "Segoe UI", sans-serif';
const COLORS = {
  ink: "#111827",
  muted: "#667085",
  border: "#d0d5dd",
  soft: "#f8fafc",
  dark: "#101828",
  gold: "#b4883f",
  white: "#ffffff",
};

function createLayout(orientation: "portrait" | "landscape"): Layout {
  if (orientation === "portrait") {
    return {
      canvasWidth: 1131,
      canvasHeight: 1600,
      pageWidthPoints: 595.28,
      pageHeightPoints: 841.89,
      margin: 64,
      footerY: 1530,
    };
  }
  return {
    canvasWidth: 1600,
    canvasHeight: 1131,
    pageWidthPoints: 841.89,
    pageHeightPoints: 595.28,
    margin: 64,
    footerY: 1060,
  };
}

function createCanvas(layout: Layout) {
  const canvas = document.createElement("canvas");
  canvas.width = layout.canvasWidth;
  canvas.height = layout.canvasHeight;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("تعذر إنشاء لوحة PDF متعددة الجداول.");
  context.fillStyle = COLORS.white;
  context.fillRect(0, 0, canvas.width, canvas.height);
  return { canvas, context };
}

function loadImage(src?: string) {
  const source = String(src || "").trim();
  if (!source) return Promise.resolve<HTMLImageElement | null>(null);
  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    const timer = window.setTimeout(() => resolve(null), 5000);
    image.onload = () => {
      window.clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      resolve(null);
    };
    image.src = source;
  });
}

function blackLogoCanvas(image: HTMLImageElement) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, image.naturalWidth || image.width);
  canvas.height = Math.max(1, image.naturalHeight || image.height);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = "source-in";
  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = "source-over";
  return canvas;
}

function setFont(context: CanvasRenderingContext2D, size: number, weight = 500) {
  context.font = `${weight} ${size}px ${FONT_FAMILY}`;
}

function drawText(
  context: CanvasRenderingContext2D,
  value: unknown,
  x: number,
  y: number,
  maxWidth: number,
  options: { size?: number; weight?: number; color?: string; align?: CanvasTextAlign } = {}
) {
  context.save();
  context.direction = "rtl";
  context.textAlign = options.align || "right";
  context.textBaseline = "top";
  context.fillStyle = options.color || COLORS.ink;
  setFont(context, options.size || 18, options.weight || 500);
  context.fillText(String(value ?? "—"), x, y, maxWidth);
  context.restore();
}

function wrapLines(context: CanvasRenderingContext2D, value: unknown, maxWidth: number, maxLines = 2) {
  const words = String(value ?? "—").replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || context.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
    if (lines.length >= maxLines - 1) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

function drawWrappedText(
  context: CanvasRenderingContext2D,
  value: unknown,
  x: number,
  y: number,
  maxWidth: number,
  options: { size?: number; weight?: number; color?: string; maxLines?: number; lineHeight?: number } = {}
) {
  const size = options.size || 15;
  context.save();
  context.direction = "rtl";
  context.textAlign = "right";
  context.textBaseline = "top";
  context.fillStyle = options.color || COLORS.ink;
  setFont(context, size, options.weight || 500);
  wrapLines(context, value, maxWidth, options.maxLines || 2).forEach((line, index) => {
    context.fillText(line, x, y + index * (options.lineHeight || Math.round(size * 1.4)), maxWidth);
  });
  context.restore();
}

function normalizedWidths(columns: ExportV2Column<Record<string, ExportV2Value>>[], contentWidth: number) {
  const raw = columns.map((column) => Math.max(8, Number(column.width || 16)));
  const total = raw.reduce((sum, value) => sum + value, 0) || 1;
  return raw.map((value) => (value / total) * contentWidth);
}

function drawWatermark(context: CanvasRenderingContext2D, layout: Layout, logo: HTMLCanvasElement | null) {
  if (!logo) return;
  const maxWidth = layout.canvasWidth * 0.42;
  const maxHeight = layout.canvasHeight * 0.24;
  const ratio = Math.min(maxWidth / logo.width, maxHeight / logo.height);
  const width = logo.width * ratio;
  const height = logo.height * ratio;
  context.save();
  context.globalAlpha = DOCUMENT_BRANDING.watermarkOpacity;
  context.drawImage(logo, (layout.canvasWidth - width) / 2, (layout.canvasHeight - height) / 2, width, height);
  context.restore();
}

function drawHeader<Row extends Record<string, ExportV2Value>>(
  context: CanvasRenderingContext2D,
  report: ExportV2Report<Row>,
  layout: Layout,
  logo: HTMLCanvasElement | null,
  sectionName: string,
  pageIndex: number
) {
  drawWatermark(context, layout, logo);
  const right = layout.canvasWidth - layout.margin;
  if (logo) {
    const maxWidth = 180;
    const maxHeight = 74;
    const ratio = Math.min(maxWidth / logo.width, maxHeight / logo.height);
    const width = logo.width * ratio;
    const height = logo.height * ratio;
    context.drawImage(logo, layout.margin, 44, width, height);
  }
  drawText(context, report.title, right, 42, layout.canvasWidth - layout.margin * 2 - 240, { size: 30, weight: 900 });
  drawText(context, sectionName, right, 84, layout.canvasWidth - layout.margin * 2 - 240, { size: 18, weight: 800, color: COLORS.gold });
  drawText(context, report.period, right, 116, layout.canvasWidth - layout.margin * 2 - 240, { size: 14, weight: 600, color: COLORS.muted });
  context.strokeStyle = COLORS.border;
  context.beginPath();
  context.moveTo(layout.margin, 150);
  context.lineTo(layout.canvasWidth - layout.margin, 150);
  context.stroke();
  drawText(context, `صفحة ${pageIndex + 1}`, layout.margin, layout.footerY + 8, 120, { size: 11, weight: 700, color: COLORS.muted, align: "left" });
  drawText(context, `${report.branding?.salonName || DOCUMENT_BRANDING.salonName} — Malikat Export V2`, right, layout.footerY + 8, 420, { size: 11, weight: 600, color: COLORS.muted });
}

function drawSummary<Row extends Record<string, ExportV2Value>>(context: CanvasRenderingContext2D, report: ExportV2Report<Row>, layout: Layout) {
  const right = layout.canvasWidth - layout.margin;
  const gap = 14;
  const cardsPerRow = layout.canvasWidth > 1300 ? 4 : 2;
  const cardWidth = (layout.canvasWidth - layout.margin * 2 - gap * (cardsPerRow - 1)) / cardsPerRow;
  const cardHeight = 74;
  report.summary.slice(0, 8).forEach((item, index) => {
    const row = Math.floor(index / cardsPerRow);
    const column = index % cardsPerRow;
    const x = right - cardWidth - column * (cardWidth + gap);
    const y = 174 + row * (cardHeight + gap);
    context.fillStyle = COLORS.soft;
    context.strokeStyle = COLORS.border;
    context.lineWidth = 1;
    context.fillRect(x, y, cardWidth, cardHeight);
    context.strokeRect(x, y, cardWidth, cardHeight);
    drawText(context, item.label, x + cardWidth - 12, y + 10, cardWidth - 24, { size: 12, weight: 700, color: COLORS.muted });
    drawText(context, exportV2FormatValue(item.value, item.type), x + cardWidth - 12, y + 36, cardWidth - 24, { size: 16, weight: 900 });
  });
  return 174 + Math.ceil(Math.min(8, report.summary.length) / cardsPerRow) * (cardHeight + gap) + 6;
}

function drawTableHeader(
  context: CanvasRenderingContext2D,
  columns: ExportV2Column<Record<string, ExportV2Value>>[],
  widths: number[],
  layout: Layout,
  y: number,
  height: number
) {
  let right = layout.canvasWidth - layout.margin;
  columns.forEach((column, index) => {
    const width = widths[index];
    const left = right - width;
    context.fillStyle = COLORS.dark;
    context.fillRect(left, y, width, height);
    context.strokeStyle = COLORS.white;
    context.strokeRect(left, y, width, height);
    drawWrappedText(context, column.header, right - 8, y + 10, width - 16, { size: 13, weight: 800, color: COLORS.white, maxLines: 2, lineHeight: 17 });
    right = left;
  });
}

function drawTableRow(
  context: CanvasRenderingContext2D,
  row: Record<string, ExportV2Value>,
  rowIndex: number,
  columns: ExportV2Column<Record<string, ExportV2Value>>[],
  widths: number[],
  layout: Layout,
  y: number,
  height: number
) {
  let right = layout.canvasWidth - layout.margin;
  columns.forEach((column, index) => {
    const width = widths[index];
    const left = right - width;
    context.fillStyle = rowIndex % 2 === 0 ? COLORS.white : COLORS.soft;
    context.fillRect(left, y, width, height);
    context.strokeStyle = COLORS.border;
    context.strokeRect(left, y, width, height);
    drawWrappedText(context, exportV2FormatValue(row[column.key], column.type), right - 8, y + 9, width - 16, { size: 12, weight: 600, maxLines: 2, lineHeight: 16 });
    right = left;
  });
}

async function canvasToJpeg(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error("تعذر تحويل صفحة التقرير إلى PDF.")), "image/jpeg", 0.93);
  });
  return new Uint8Array(await blob.arrayBuffer());
}

function asExtraColumns<Row extends Record<string, ExportV2Value>>(columns: ExportV2Column<Row>[]) {
  return columns as unknown as ExportV2Column<Record<string, ExportV2Value>>[];
}

export async function buildExportV2MultitablePdfBytes<Row extends Record<string, ExportV2Value>>(report: ExportV2Report<Row>) {
  if (typeof document === "undefined") throw new Error("تصدير PDF يتطلب تشغيل الصفحة داخل المتصفح.");
  if (document.fonts?.ready) await document.fonts.ready;

  const orientation = report.pdfOrientation || "landscape";
  const layout = createLayout(orientation);
  const sourceLogo = await loadImage(report.branding?.logoUrl || DOCUMENT_BRANDING.printLogoSource);
  const logo = sourceLogo ? blackLogoCanvas(sourceLogo) : null;
  const tables: ExportV2ExtraTable[] = [
    {
      name: report.detailsSheetName || "البيانات التفصيلية",
      columns: asExtraColumns(report.columns),
      rows: report.rows as unknown as Record<string, ExportV2Value>[],
      emptyMessage: report.emptyMessage,
    },
    ...(report.extraTables || []).filter((table) => !table.hideInPdf),
  ];

  const pages: PdfPage[] = [];
  let globalPageIndex = 0;
  for (let tableIndex = 0; tableIndex < tables.length; tableIndex += 1) {
    const table = tables[tableIndex];
    const columns = table.columns.filter((column) => !column.hideInPdf);
    const widths = normalizedWidths(columns, layout.canvasWidth - layout.margin * 2);
    const rowHeight = 54;
    const headerHeight = 50;
    let cursor = 0;
    let firstPageForTable = true;

    while (cursor < table.rows.length || (table.rows.length === 0 && firstPageForTable)) {
      const { canvas, context } = createCanvas(layout);
      drawHeader(context, report, layout, logo, table.name, globalPageIndex);
      let y = 174;
      if (tableIndex === 0 && firstPageForTable) y = drawSummary(context, report, layout);
      drawTableHeader(context, columns, widths, layout, y, headerHeight);
      y += headerHeight;
      const capacity = Math.max(1, Math.floor((layout.footerY - y - 18) / rowHeight));
      const pageRows = table.rows.slice(cursor, cursor + capacity);
      if (!pageRows.length) {
        context.fillStyle = COLORS.soft;
        context.fillRect(layout.margin, y, layout.canvasWidth - layout.margin * 2, rowHeight);
        drawText(context, table.emptyMessage || "لا توجد بيانات.", layout.canvasWidth - layout.margin - 12, y + 14, layout.canvasWidth - layout.margin * 2 - 24, { size: 15, weight: 700, color: COLORS.muted });
      } else {
        pageRows.forEach((row, index) => drawTableRow(context, row, cursor + index, columns, widths, layout, y + index * rowHeight, rowHeight));
      }
      cursor += pageRows.length;
      pages.push({ bytes: await canvasToJpeg(canvas), width: canvas.width, height: canvas.height });
      firstPageForTable = false;
      globalPageIndex += 1;
      if (!table.rows.length) break;
    }
  }

  return buildPdfFromJpegPages(pages, layout.pageWidthPoints, layout.pageHeightPoints);
}

export async function exportReportToMultitablePdfV2<Row extends Record<string, ExportV2Value>>(report: ExportV2Report<Row>) {
  const bytes = await buildExportV2MultitablePdfBytes(report);
  downloadExportV2Blob(new Blob([bytes], { type: "application/pdf" }), buildExportV2FileName(report, "pdf"));
}
