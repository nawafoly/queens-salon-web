import { DEFAULT_EXPORT_V2_BRANDING, EXPORT_V2_COLORS } from "./branding";
import { downloadExportV2Blob } from "./download";
import { buildExportV2FileName } from "./file-name";
import { exportV2FormatDateTime, exportV2FormatValue } from "./formatters";
import type {
  ExportV2Column,
  ExportV2Report,
  ExportV2SummaryItem,
  ExportV2Tone,
  ExportV2Value,
} from "./types";

type PdfPageImage = {
  bytes: Uint8Array;
  width: number;
  height: number;
};

type PdfCanvasLayout = {
  canvasWidth: number;
  canvasHeight: number;
  pageWidthPoints: number;
  pageHeightPoints: number;
  margin: number;
  contentWidth: number;
  footerY: number;
};

const FONT_FAMILY = 'Tahoma, Arial, "Segoe UI", sans-serif';

function color(value: string) {
  return `#${value}`;
}

function finiteNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const safeRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + safeRadius, y);
  context.lineTo(x + width - safeRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  context.lineTo(x + width, y + height - safeRadius);
  context.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  context.lineTo(x + safeRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  context.lineTo(x, y + safeRadius);
  context.quadraticCurveTo(x, y, x + safeRadius, y);
  context.closePath();
}

function fillRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fill: string,
  stroke?: string,
  lineWidth = 1
) {
  context.save();
  roundedRectPath(context, x, y, width, height, radius);
  context.fillStyle = fill;
  context.fill();
  if (stroke) {
    context.strokeStyle = stroke;
    context.lineWidth = lineWidth;
    context.stroke();
  }
  context.restore();
}

function setFont(context: CanvasRenderingContext2D, size: number, weight = 500) {
  context.font = `${weight} ${size}px ${FONT_FAMILY}`;
}

function fitText(context: CanvasRenderingContext2D, value: unknown, maxWidth: number) {
  const text = String(value ?? "—");
  if (context.measureText(text).width <= maxWidth) return text;
  if (maxWidth <= context.measureText("…").width) return "…";

  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidate = `${text.slice(0, middle)}…`;
    if (context.measureText(candidate).width <= maxWidth) low = middle;
    else high = middle - 1;
  }
  return `${text.slice(0, Math.max(0, low))}…`;
}

function wrapText(
  context: CanvasRenderingContext2D,
  value: unknown,
  maxWidth: number,
  maxLines = 2
) {
  const text = String(value ?? "—").replace(/\s+/g, " ").trim() || "—";
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }

    if (current) lines.push(current);
    current = context.measureText(word).width <= maxWidth ? word : fitText(context, word, maxWidth);
    if (lines.length >= maxLines - 1) break;
  }

  if (current && lines.length < maxLines) lines.push(current);
  if (words.join(" ") !== lines.join(" ") && lines.length) {
    lines[lines.length - 1] = fitText(context, `${lines[lines.length - 1]}…`, maxWidth);
  }
  return lines.slice(0, maxLines);
}

function drawTextBlock(
  context: CanvasRenderingContext2D,
  value: unknown,
  x: number,
  y: number,
  maxWidth: number,
  options: {
    size: number;
    weight?: number;
    color?: string;
    align?: CanvasTextAlign;
    maxLines?: number;
    lineHeight?: number;
  }
) {
  const {
    size,
    weight = 500,
    color: textColor = color(EXPORT_V2_COLORS.black),
    align = "right",
    maxLines = 1,
    lineHeight = Math.round(size * 1.35),
  } = options;

  context.save();
  context.direction = "rtl";
  context.textAlign = align;
  context.textBaseline = "top";
  context.fillStyle = textColor;
  setFont(context, size, weight);
  const lines = maxLines > 1 ? wrapText(context, value, maxWidth, maxLines) : [fitText(context, value, maxWidth)];
  lines.forEach((line, index) => context.fillText(line, x, y + index * lineHeight, maxWidth));
  context.restore();
}

function toneColors(tone: ExportV2Tone | undefined) {
  const c = EXPORT_V2_COLORS;
  if (tone === "success") return { accent: color(c.green), background: color(c.paleGreen), value: color(c.green) };
  if (tone === "danger") return { accent: color(c.burgundy), background: color(c.paleBurgundy), value: color(c.burgundy) };
  if (tone === "gold") return { accent: color(c.gold), background: color(c.paleGold), value: "#9A7200" };
  if (tone === "dark") return { accent: color(c.black), background: color(c.gray), value: color(c.black) };
  return { accent: color(c.muted), background: color(c.white), value: color(c.black) };
}

function drawCard(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  label: string,
  value: string,
  tone: ExportV2Tone | undefined
) {
  const palette = toneColors(tone);
  fillRoundedRect(context, x, y, width, height, 14, palette.background, color(EXPORT_V2_COLORS.border), 1.3);
  context.save();
  context.fillStyle = palette.accent;
  fillRoundedRect(context, x + width - 6, y + 8, 5, height - 16, 2.5, palette.accent);
  context.globalAlpha = 0.06;
  context.beginPath();
  context.arc(x + 12, y + height + 8, 58, 0, Math.PI * 2);
  context.fillStyle = color(EXPORT_V2_COLORS.black);
  context.fill();
  context.restore();
  drawTextBlock(context, label, x + width - 18, y + 13, width - 36, {
    size: 15,
    weight: 700,
    color: color(EXPORT_V2_COLORS.muted),
  });
  drawTextBlock(context, value, x + width - 18, y + 39, width - 36, {
    size: 21,
    weight: 900,
    color: palette.value,
  });
}

async function loadImage(url?: string) {
  const source = String(url || "").trim();
  if (!source) return null;
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

function createLayout(orientation: "portrait" | "landscape"): PdfCanvasLayout {
  const landscape = orientation === "landscape";
  const canvasWidth = landscape ? 1600 : 1131;
  const canvasHeight = landscape ? 1131 : 1600;
  const pageWidthPoints = landscape ? 841.89 : 595.28;
  const pageHeightPoints = landscape ? 595.28 : 841.89;
  const margin = landscape ? 42 : 46;
  return {
    canvasWidth,
    canvasHeight,
    pageWidthPoints,
    pageHeightPoints,
    margin,
    contentWidth: canvasWidth - margin * 2,
    footerY: canvasHeight - 34,
  };
}

function createCanvas(layout: PdfCanvasLayout) {
  const canvas = document.createElement("canvas");
  canvas.width = layout.canvasWidth;
  canvas.height = layout.canvasHeight;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("تعذر إنشاء لوحة PDF في المتصفح.");
  context.fillStyle = color(EXPORT_V2_COLORS.white);
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.direction = "rtl";
  return { canvas, context };
}

function drawReportHeader<Row extends Record<string, ExportV2Value>>(
  context: CanvasRenderingContext2D,
  report: ExportV2Report<Row>,
  layout: PdfCanvasLayout,
  logo: HTMLImageElement | null,
  compact: boolean
) {
  const c = EXPORT_V2_COLORS;
  const height = compact ? 84 : 136;
  const x = layout.margin;
  const y = 22;
  fillRoundedRect(context, x, y, layout.contentWidth, height, 18, color(c.white), color(c.border), 1.3);
  context.fillStyle = color(c.gold);
  fillRoundedRect(context, x + 2, y + 2, layout.contentWidth - 4, 6, 3, color(c.gold));

  const rightEdge = layout.canvasWidth - layout.margin - 24;
  const logoWidth = compact ? 112 : 150;
  const logoHeight = compact ? 50 : 72;
  if (logo) {
    const ratio = Math.min(logoWidth / logo.width, logoHeight / logo.height);
    const drawWidth = logo.width * ratio;
    const drawHeight = logo.height * ratio;
    context.drawImage(logo, rightEdge - drawWidth, y + (height - drawHeight) / 2 + 2, drawWidth, drawHeight);
  } else {
    drawTextBlock(context, report.branding?.salonName || "مَلِكات", rightEdge, y + 27, logoWidth, {
      size: compact ? 23 : 29,
      weight: 900,
    });
  }

  const copyRight = rightEdge - logoWidth - 18;
  drawTextBlock(context, report.title, copyRight, y + (compact ? 18 : 28), layout.contentWidth * 0.52, {
    size: compact ? 24 : 32,
    weight: 900,
  });
  drawTextBlock(context, compact ? report.period : report.subtitle || report.period, copyRight, y + (compact ? 51 : 74), layout.contentWidth * 0.55, {
    size: compact ? 14 : 16,
    weight: 600,
    color: color(c.muted),
  });

  const codeWidth = compact ? 190 : 225;
  const codeHeight = compact ? 48 : 72;
  const codeX = x + 20;
  const codeY = y + (height - codeHeight) / 2 + 2;
  fillRoundedRect(context, codeX, codeY, codeWidth, codeHeight, 12, color(c.black));
  drawTextBlock(context, "رمز التقرير", codeX + codeWidth - 16, codeY + 9, codeWidth - 32, {
    size: 12,
    weight: 600,
    color: "rgba(255,255,255,.7)",
  });
  drawTextBlock(context, report.reportCode || "FIN-REPORT", codeX + codeWidth - 16, codeY + (compact ? 24 : 34), codeWidth - 32, {
    size: compact ? 15 : 18,
    weight: 900,
    color: color(c.white),
  });
  return y + height;
}

function drawMetaAndSummary<Row extends Record<string, ExportV2Value>>(
  context: CanvasRenderingContext2D,
  report: ExportV2Report<Row>,
  layout: PdfCanvasLayout,
  startY: number
) {
  const c = EXPORT_V2_COLORS;
  const gap = 10;
  const metaItems = [
    { label: "الفترة", value: report.period },
    { label: "تاريخ التصدير", value: exportV2FormatDateTime(report.generatedAt) },
    { label: "أنشأه", value: report.generatedBy },
    { label: "عدد السجلات", value: report.rows.length.toLocaleString("ar-SA-u-nu-latn") },
  ];
  const metaWidth = (layout.contentWidth - gap * 3) / 4;
  let xRight = layout.canvasWidth - layout.margin;
  const metaY = startY + 12;
  metaItems.forEach((item) => {
    const x = xRight - metaWidth;
    fillRoundedRect(context, x, metaY, metaWidth, 62, 12, color(c.white), color(c.border), 1.1);
    drawTextBlock(context, item.label, x + metaWidth - 14, metaY + 10, metaWidth - 28, {
      size: 12,
      weight: 700,
      color: color(c.muted),
    });
    drawTextBlock(context, item.value, x + metaWidth - 14, metaY + 31, metaWidth - 28, {
      size: 15,
      weight: 900,
    });
    xRight = x - gap;
  });

  const filters = report.filters?.length ? report.filters.slice(0, 4) : [{ label: "الفلاتر", value: "بدون فلاتر إضافية" }];
  const filterY = metaY + 72;
  const filterWidth = (layout.contentWidth - gap * 3) / 4;
  xRight = layout.canvasWidth - layout.margin;
  for (let index = 0; index < 4; index += 1) {
    const item = filters[index];
    const x = xRight - filterWidth;
    fillRoundedRect(context, x, filterY, filterWidth, 56, 12, color(c.white), color(c.border), 1.1);
    if (item) {
      drawTextBlock(context, item.label, x + filterWidth - 14, filterY + 8, filterWidth - 28, {
        size: 12,
        weight: 700,
        color: color(c.muted),
      });
      drawTextBlock(context, exportV2FormatValue(item.value), x + filterWidth - 14, filterY + 28, filterWidth - 28, {
        size: 14,
        weight: 900,
      });
    }
    xRight = x - gap;
  }

  const summary = report.summary.slice(0, 8);
  const cardGap = 10;
  const columns = 4;
  const cardWidth = (layout.contentWidth - cardGap * (columns - 1)) / columns;
  const cardHeight = 70;
  const summaryY = filterY + 68;
  summary.forEach((item: ExportV2SummaryItem, index) => {
    const row = Math.floor(index / columns);
    const columnIndex = index % columns;
    const x = layout.canvasWidth - layout.margin - cardWidth - columnIndex * (cardWidth + cardGap);
    const y = summaryY + row * (cardHeight + cardGap);
    drawCard(
      context,
      x,
      y,
      cardWidth,
      cardHeight,
      item.label,
      exportV2FormatValue(item.value, item.type),
      item.tone
    );
  });
  return summaryY + Math.ceil(Math.max(1, summary.length) / columns) * (cardHeight + cardGap);
}

function normalizedColumnWidths<Row extends Record<string, ExportV2Value>>(
  columns: ExportV2Column<Row>[],
  contentWidth: number
) {
  const raw = columns.map((column) => Math.max(8, finiteNumber(column.width) || 14));
  const total = raw.reduce((sum, value) => sum + value, 0) || 1;
  return raw.map((value) => (value / total) * contentWidth);
}

function drawTableHeader<Row extends Record<string, ExportV2Value>>(
  context: CanvasRenderingContext2D,
  columns: ExportV2Column<Row>[],
  widths: number[],
  layout: PdfCanvasLayout,
  y: number,
  height: number
) {
  const c = EXPORT_V2_COLORS;
  let right = layout.canvasWidth - layout.margin;
  columns.forEach((column, index) => {
    const width = widths[index];
    const x = right - width;
    context.fillStyle = color(c.black);
    context.fillRect(x, y, width, height);
    context.strokeStyle = "rgba(255,255,255,.22)";
    context.lineWidth = 1;
    context.strokeRect(x, y, width, height);
    drawTextBlock(context, column.header, x + width / 2, y + 12, width - 12, {
      size: 13,
      weight: 900,
      color: color(c.white),
      align: "center",
    });
    right = x;
  });
}

function drawTableRow<Row extends Record<string, ExportV2Value>>(
  context: CanvasRenderingContext2D,
  row: Row,
  rowIndex: number,
  columns: ExportV2Column<Row>[],
  widths: number[],
  layout: PdfCanvasLayout,
  y: number,
  height: number
) {
  const c = EXPORT_V2_COLORS;
  let right = layout.canvasWidth - layout.margin;
  const background = rowIndex % 2 === 0 ? color(c.white) : "#FAFBFC";
  columns.forEach((column, index) => {
    const width = widths[index];
    const x = right - width;
    context.fillStyle = background;
    context.fillRect(x, y, width, height);
    context.strokeStyle = color(c.border);
    context.lineWidth = 1;
    context.strokeRect(x, y, width, height);

    const align: CanvasTextAlign = column.align === "left" ? "left" : column.align === "center" || column.type === "currency" || column.type === "number" || column.type === "date" ? "center" : "right";
    const textX = align === "center" ? x + width / 2 : align === "left" ? x + 8 : x + width - 8;
    const value = exportV2FormatValue(row[column.key], column.type);
    const maxLines = column.type === "text" || !column.type ? 2 : 1;
    const fontSize = column.type === "currency" || column.type === "number" ? 13 : 12;
    const lines = maxLines > 1 ? wrapText(context, value, width - 16, maxLines) : [fitText(context, value, width - 16)];
    const lineHeight = 15;
    const contentHeight = lines.length * lineHeight;
    const top = y + Math.max(6, (height - contentHeight) / 2);

    context.save();
    context.beginPath();
    context.rect(x + 3, y + 3, width - 6, height - 6);
    context.clip();
    context.direction = "rtl";
    context.textAlign = align;
    context.textBaseline = "top";
    context.fillStyle = column.type === "status" && String(row[column.key] || "").includes("استرجاع")
      ? color(c.burgundy)
      : color(c.black);
    setFont(context, fontSize, column.type === "currency" || column.type === "number" ? 700 : 500);
    lines.forEach((line, lineIndex) => context.fillText(line, textX, top + lineIndex * lineHeight, width - 16));
    context.restore();
    right = x;
  });
}

function drawTotalsRow<Row extends Record<string, ExportV2Value>>(
  context: CanvasRenderingContext2D,
  report: ExportV2Report<Row>,
  columns: ExportV2Column<Row>[],
  widths: number[],
  layout: PdfCanvasLayout,
  y: number,
  height: number
) {
  const c = EXPORT_V2_COLORS;
  let right = layout.canvasWidth - layout.margin;
  columns.forEach((column, index) => {
    const width = widths[index];
    const x = right - width;
    context.fillStyle = color(c.paleGold);
    context.fillRect(x, y, width, height);
    context.strokeStyle = color(c.gold);
    context.strokeRect(x, y, width, height);
    const total = report.totals?.[column.key];
    const label = index === 0 ? "الإجمالي" : typeof total === "number" ? exportV2FormatValue(total, column.type) : "";
    drawTextBlock(context, label, x + width / 2, y + 11, width - 12, {
      size: 13,
      weight: 900,
      align: "center",
      color: index === 0 ? color(c.black) : "#9A7200",
    });
    right = x;
  });
}

function drawFooter(
  context: CanvasRenderingContext2D,
  layout: PdfCanvasLayout,
  pageIndex: number,
  pageCount: number,
  salonName: string
) {
  const c = EXPORT_V2_COLORS;
  context.strokeStyle = color(c.border);
  context.beginPath();
  context.moveTo(layout.margin, layout.footerY - 20);
  context.lineTo(layout.canvasWidth - layout.margin, layout.footerY - 20);
  context.stroke();
  drawTextBlock(context, `${salonName} — تقرير تم إنشاؤه آليًا`, layout.canvasWidth - layout.margin, layout.footerY - 12, layout.contentWidth / 2, {
    size: 11,
    weight: 600,
    color: color(c.muted),
  });
  context.save();
  context.direction = "ltr";
  context.textAlign = "left";
  context.textBaseline = "top";
  context.fillStyle = color(c.muted);
  setFont(context, 11, 700);
  context.fillText(`${pageIndex + 1} / ${pageCount}`, layout.margin, layout.footerY - 12);
  context.restore();
}

async function canvasToJpeg(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("تعذر تحويل صفحة التقرير إلى صورة PDF."));
    }, "image/jpeg", 0.92);
  });
  return new Uint8Array(await blob.arrayBuffer());
}

function asciiBytes(value: string) {
  return new TextEncoder().encode(value);
}

function concatBytes(chunks: Uint8Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export function buildPdfFromJpegPages(
  pages: PdfPageImage[],
  pageWidthPoints: number,
  pageHeightPoints: number
) {
  if (!pages.length) throw new Error("لا توجد صفحات لإنشاء ملف PDF.");
  const objectCount = 2 + pages.length * 3;
  const chunks: Uint8Array[] = [];
  const offsets = new Array<number>(objectCount + 1).fill(0);
  let currentOffset = 0;

  const push = (chunk: Uint8Array) => {
    chunks.push(chunk);
    currentOffset += chunk.length;
  };
  const pushObject = (objectNumber: number, ...objectChunks: Uint8Array[]) => {
    offsets[objectNumber] = currentOffset;
    objectChunks.forEach(push);
  };

  push(asciiBytes("%PDF-1.4\n%Malikat\n"));
  pushObject(1, asciiBytes("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"));
  const kids = pages.map((_, index) => `${3 + index * 3} 0 R`).join(" ");
  pushObject(2, asciiBytes(`2 0 obj\n<< /Type /Pages /Count ${pages.length} /Kids [${kids}] >>\nendobj\n`));

  pages.forEach((page, index) => {
    const pageObject = 3 + index * 3;
    const imageObject = pageObject + 1;
    const contentObject = pageObject + 2;
    const imageName = `Im${index + 1}`;
    const content = `q\n${pageWidthPoints.toFixed(2)} 0 0 ${pageHeightPoints.toFixed(2)} 0 0 cm\n/${imageName} Do\nQ\n`;
    const contentBytes = asciiBytes(content);

    pushObject(
      pageObject,
      asciiBytes(
        `${pageObject} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidthPoints.toFixed(2)} ${pageHeightPoints.toFixed(2)}] /Resources << /XObject << /${imageName} ${imageObject} 0 R >> >> /Contents ${contentObject} 0 R >>\nendobj\n`
      )
    );
    pushObject(
      imageObject,
      asciiBytes(
        `${imageObject} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`
      ),
      page.bytes,
      asciiBytes("\nendstream\nendobj\n")
    );
    pushObject(
      contentObject,
      asciiBytes(`${contentObject} 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`),
      contentBytes,
      asciiBytes("endstream\nendobj\n")
    );
  });

  const xrefOffset = currentOffset;
  const xrefLines = ["xref", `0 ${objectCount + 1}`, "0000000000 65535 f "];
  for (let objectNumber = 1; objectNumber <= objectCount; objectNumber += 1) {
    xrefLines.push(`${String(offsets[objectNumber]).padStart(10, "0")} 00000 n `);
  }
  push(asciiBytes(`${xrefLines.join("\n")}\ntrailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));
  return concatBytes(chunks);
}

export async function buildExportV2PdfBytes<Row extends Record<string, ExportV2Value>>(
  report: ExportV2Report<Row>
) {
  if (typeof document === "undefined") throw new Error("تصدير PDF يتطلب تشغيل الصفحة داخل المتصفح.");
  if (document.fonts?.ready) await document.fonts.ready;

  const orientation = report.pdfOrientation || "landscape";
  const layout = createLayout(orientation);
  const branding = { ...DEFAULT_EXPORT_V2_BRANDING, ...report.branding };
  const logo = await loadImage(branding.logoUrl);
  const columns = report.columns.filter((column) => !column.hideInPdf);
  const widths = normalizedColumnWidths(columns, layout.contentWidth);
  const headerHeight = 42;
  const rowHeight = 39;
  const firstTableY = orientation === "landscape" ? 468 : 600;
  const otherTableY = 126;
  const firstCapacity = Math.max(1, Math.floor((layout.footerY - 28 - firstTableY - headerHeight - rowHeight) / rowHeight));
  const otherCapacity = Math.max(1, Math.floor((layout.footerY - 28 - otherTableY - headerHeight - rowHeight) / rowHeight));
  const remainingAfterFirst = Math.max(0, report.rows.length - firstCapacity);
  const pageCount = Math.max(1, 1 + Math.ceil(remainingAfterFirst / otherCapacity));
  const pages: PdfPageImage[] = [];
  let cursor = 0;

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const { canvas, context } = createCanvas(layout);
    const isFirst = pageIndex === 0;
    const headerBottom = drawReportHeader(context, report, layout, logo, !isFirst);
    const tableY = isFirst ? firstTableY : Math.max(otherTableY, headerBottom + 18);
    if (isFirst) drawMetaAndSummary(context, report, layout, headerBottom);
    drawTableHeader(context, columns, widths, layout, tableY, headerHeight);

    const capacity = isFirst ? firstCapacity : otherCapacity;
    const rows = report.rows.slice(cursor, cursor + capacity);
    rows.forEach((row, rowIndex) => {
      drawTableRow(context, row, cursor + rowIndex, columns, widths, layout, tableY + headerHeight + rowIndex * rowHeight, rowHeight);
    });
    cursor += rows.length;

    const isLastPage = pageIndex === pageCount - 1;
    if (isLastPage && report.rows.length && report.totals) {
      const totalsY = tableY + headerHeight + rows.length * rowHeight;
      if (totalsY + rowHeight < layout.footerY - 20) {
        drawTotalsRow(context, report, columns, widths, layout, totalsY, rowHeight);
      }
    }
    drawFooter(context, layout, pageIndex, pageCount, branding.salonName || "مَلِكات");
    pages.push({ bytes: await canvasToJpeg(canvas), width: canvas.width, height: canvas.height });
  }

  return buildPdfFromJpegPages(pages, layout.pageWidthPoints, layout.pageHeightPoints);
}

export async function exportReportToPdfV2<Row extends Record<string, ExportV2Value>>(
  report: ExportV2Report<Row>
) {
  const bytes = await buildExportV2PdfBytes(report);
  downloadExportV2Blob(
    new Blob([bytes], { type: "application/pdf" }),
    buildExportV2FileName(report, "pdf")
  );
}
