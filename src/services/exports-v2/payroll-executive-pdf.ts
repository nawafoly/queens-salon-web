import { DEFAULT_EXPORT_V2_BRANDING } from "./branding";
import { downloadExportV2Blob } from "./download";
import { buildExportV2FileName } from "./file-name";
import { exportV2FormatDateTime, exportV2FormatValue } from "./formatters";
import { buildPdfFromJpegPages } from "./pdf";
import type { ExportV2Column, ExportV2Report, ExportV2Value } from "./types";

type PageImage = { bytes: Uint8Array; width: number; height: number };
type Layout = {
  width: number;
  height: number;
  pageWidthPoints: number;
  pageHeightPoints: number;
  margin: number;
  contentWidth: number;
  footerY: number;
};

type Palette = {
  ink: string;
  muted: string;
  border: string;
  canvas: string;
  white: string;
  black: string;
  gold: string;
  paleGold: string;
  green: string;
  paleGreen: string;
  burgundy: string;
  paleBurgundy: string;
  slate: string;
};

const FONT_FAMILY = 'Tahoma, Arial, "Segoe UI", sans-serif';
const COLORS: Palette = {
  ink: "#171A20",
  muted: "#697180",
  border: "#E0E3E8",
  canvas: "#FFFFFF",
  white: "#FFFFFF",
  black: "#0B0D12",
  gold: "#C79A35",
  paleGold: "#FBF5E6",
  green: "#157A55",
  paleGreen: "#EDF7F2",
  burgundy: "#8A1735",
  paleBurgundy: "#FBEEF2",
  slate: "#F5F7FA",
};

function layout(): Layout {
  const width = 1600;
  const height = 1131;
  const margin = 52;
  return {
    width,
    height,
    pageWidthPoints: 841.89,
    pageHeightPoints: 595.28,
    margin,
    contentWidth: width - margin * 2,
    footerY: height - 34,
  };
}

function createCanvas(l: Layout) {
  const canvas = document.createElement("canvas");
  canvas.width = l.width;
  canvas.height = l.height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("تعذر إنشاء لوحة تقرير الرواتب.");
  context.fillStyle = COLORS.canvas;
  context.fillRect(0, 0, l.width, l.height);
  return { canvas, context };
}

function setFont(context: CanvasRenderingContext2D, size: number, weight = 500) {
  context.font = `${weight} ${size}px ${FONT_FAMILY}`;
}

function roundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function roundedRect(
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

function fitText(context: CanvasRenderingContext2D, value: unknown, maxWidth: number) {
  const text = String(value ?? "—");
  if (context.measureText(text).width <= maxWidth) return text;
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

function wrapText(context: CanvasRenderingContext2D, value: unknown, maxWidth: number, maxLines = 2) {
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
    current = word;
    if (lines.length >= maxLines - 1) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length && lines.join(" ") !== text) {
    lines[lines.length - 1] = fitText(context, `${lines[lines.length - 1]}…`, maxWidth);
  }
  return lines.slice(0, maxLines);
}

function drawText(
  context: CanvasRenderingContext2D,
  value: unknown,
  x: number,
  y: number,
  maxWidth: number,
  options: {
    size?: number;
    weight?: number;
    color?: string;
    align?: CanvasTextAlign;
    maxLines?: number;
    lineHeight?: number;
    direction?: CanvasDirection;
  } = {}
) {
  const size = options.size || 16;
  const align = options.align || "right";
  context.save();
  context.direction = options.direction || "rtl";
  context.textAlign = align;
  context.textBaseline = "top";
  context.fillStyle = options.color || COLORS.ink;
  setFont(context, size, options.weight || 500);
  const lines = options.maxLines && options.maxLines > 1
    ? wrapText(context, value, maxWidth, options.maxLines)
    : [fitText(context, value, maxWidth)];
  const lineHeight = options.lineHeight || Math.round(size * 1.35);
  lines.forEach((line, index) => context.fillText(line, x, y + index * lineHeight, maxWidth));
  context.restore();
}

function loadImage(url?: string) {
  const source = String(url || "").trim();
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

function drawLogo(context: CanvasRenderingContext2D, logo: HTMLImageElement | null, right: number, top: number) {
  if (!logo) {
    drawText(context, "مَلِكات", right, top + 2, 160, { size: 29, weight: 900, color: COLORS.gold });
    return;
  }
  const maxWidth = 170;
  const maxHeight = 58;
  const ratio = Math.min(maxWidth / logo.width, maxHeight / logo.height);
  const width = logo.width * ratio;
  const height = logo.height * ratio;
  context.drawImage(logo, right - width, top, width, height);
}

function drawHeader<Row extends Record<string, ExportV2Value>>(
  context: CanvasRenderingContext2D,
  report: ExportV2Report<Row>,
  l: Layout,
  logo: HTMLImageElement | null,
  compact = false
) {
  const top = compact ? 18 : 22;
  const height = compact ? 96 : 142;
  roundedRect(context, l.margin, top, l.contentWidth, height, 20, COLORS.black, COLORS.black, 1.2);
  roundedRect(context, l.margin + 2, top + 2, l.contentWidth - 4, 7, 3, COLORS.gold);

  const right = l.width - l.margin - 22;
  const logoBoxWidth = compact ? 174 : 194;
  const logoBoxHeight = compact ? 58 : 72;
  const logoBoxY = top + (height - logoBoxHeight) / 2 + 2;
  roundedRect(context, right - logoBoxWidth, logoBoxY, logoBoxWidth, logoBoxHeight, 14, COLORS.white, "#242833", 1);
  drawLogo(context, logo, right - 14, logoBoxY + (compact ? 8 : 9));

  const copyRight = right - logoBoxWidth - 30;
  drawText(context, compact ? report.title : "مسيرة الرواتب الشهرية", copyRight, top + (compact ? 19 : 27), 770, {
    size: compact ? 25 : 35,
    weight: 900,
    color: COLORS.white,
  });
  drawText(
    context,
    compact ? report.period : "تقرير تنفيذي رسمي • رواتب، تعويضات، خصومات وتسويات",
    copyRight,
    top + (compact ? 55 : 79),
    780,
    { size: compact ? 14 : 16, weight: 600, color: "#BFC5D0" }
  );

  const badgeWidth = 210;
  const badgeHeight = compact ? 54 : 70;
  const badgeX = l.margin + 22;
  const badgeY = top + (height - badgeHeight) / 2 + 3;
  roundedRect(context, badgeX, badgeY, badgeWidth, badgeHeight, 14, "#151922", COLORS.gold, 1.4);
  drawText(context, "رمز التقرير", badgeX + badgeWidth - 16, badgeY + 10, badgeWidth - 32, {
    size: 11,
    weight: 700,
    color: "#AEB4BF",
  });
  drawText(context, report.reportCode || "HR-PAYROLL", badgeX + badgeWidth - 16, badgeY + (compact ? 28 : 36), badgeWidth - 32, {
    size: compact ? 15 : 18,
    weight: 900,
    color: COLORS.gold,
  });
  return top + height;
}

function drawMeta<Row extends Record<string, ExportV2Value>>(
  context: CanvasRenderingContext2D,
  report: ExportV2Report<Row>,
  l: Layout,
  y: number
) {
  const gap = 12;
  const width = (l.contentWidth - gap * 3) / 4;
  const items = [
    { label: "الفترة", value: report.period },
    { label: "تاريخ التصدير", value: exportV2FormatDateTime(report.generatedAt) },
    { label: "نطاق التصدير", value: String(report.filters?.find((item) => item.label === "نطاق التصدير")?.value || "السجلات المكتملة فقط") },
    { label: "عدد السجلات", value: String(report.rows.length) },
  ];
  let right = l.width - l.margin;
  items.forEach((item) => {
    const x = right - width;
    roundedRect(context, x, y, width, 60, 12, COLORS.white, COLORS.border, 1);
    drawText(context, item.label, x + width - 14, y + 9, width - 28, { size: 11, weight: 700, color: COLORS.muted });
    drawText(context, item.value, x + width - 14, y + 30, width - 28, { size: 14, weight: 900, color: COLORS.ink });
    right = x - gap;
  });
  return y + 60;
}

function summaryByLabel<Row extends Record<string, ExportV2Value>>(report: ExportV2Report<Row>, includes: string[]) {
  return report.summary.find((item) => includes.some((token) => item.label.includes(token)));
}

function drawKpis<Row extends Record<string, ExportV2Value>>(
  context: CanvasRenderingContext2D,
  report: ExportV2Report<Row>,
  l: Layout,
  y: number
) {
  const selected = [
    summaryByLabel(report, ["الرواتب الأساسية"]),
    summaryByLabel(report, ["الإضافات"]),
    summaryByLabel(report, ["تعويض رصيد الإجازات"]),
    summaryByLabel(report, ["الخصومات"]),
    summaryByLabel(report, ["تسويات فترات سابقة"]),
    summaryByLabel(report, ["الصافي"]),
  ].filter(Boolean) as typeof report.summary;

  const gap = 10;
  const width = (l.contentWidth - gap * Math.max(0, selected.length - 1)) / Math.max(1, selected.length);
  const height = 84;
  let right = l.width - l.margin;
  selected.forEach((item, index) => {
    const x = right - width;
    const palette = item.tone === "danger"
      ? { bg: COLORS.paleBurgundy, accent: COLORS.burgundy }
      : item.tone === "success"
        ? { bg: COLORS.paleGreen, accent: COLORS.green }
        : item.tone === "gold"
          ? { bg: COLORS.paleGold, accent: COLORS.gold }
          : { bg: index === selected.length - 1 ? COLORS.black : COLORS.white, accent: index === selected.length - 1 ? COLORS.white : COLORS.black };
    roundedRect(context, x, y, width, height, 15, palette.bg, index === selected.length - 1 ? COLORS.black : COLORS.border, 1.1);
    context.fillStyle = item.tone === "danger" ? COLORS.burgundy : item.tone === "success" ? COLORS.green : item.tone === "gold" ? COLORS.gold : COLORS.black;
    roundedRect(context, x + width - 6, y + 8, 5, height - 16, 2, context.fillStyle as string);
    drawText(context, item.label, x + width - 18, y + 13, width - 36, {
      size: 12,
      weight: 700,
      color: index === selected.length - 1 ? "#C9CDD6" : COLORS.muted,
    });
    drawText(context, exportV2FormatValue(item.value, item.type), x + width - 18, y + 41, width - 36, {
      size: 19,
      weight: 900,
      color: index === selected.length - 1 ? COLORS.white : palette.accent,
    });
    right = x - gap;
  });
  return y + height;
}

function financialColumns<Row extends Record<string, ExportV2Value>>(report: ExportV2Report<Row>) {
  const keys = [
    "employeeName",
    "jobTitle",
    "baseSalary",
    "additions",
    "leaveCompensation",
    "deductions",
    "previousPeriodAdjustment",
    "expectedNet",
    "status",
  ];
  const byKey = new Map(report.columns.map((column) => [column.key, column]));
  return keys.map((key) => byKey.get(key)).filter(Boolean) as ExportV2Column<Row>[];
}

function normalizedWidths<Row extends Record<string, ExportV2Value>>(columns: ExportV2Column<Row>[], width: number) {
  const weights: Record<string, number> = {
    employeeName: 22,
    jobTitle: 17,
    baseSalary: 14,
    additions: 11,
    leaveCompensation: 13,
    deductions: 11,
    previousPeriodAdjustment: 15,
    expectedNet: 16,
    status: 11,
  };
  const raw = columns.map((column) => weights[column.key] || Number(column.width || 14));
  const total = raw.reduce((sum, value) => sum + value, 0) || 1;
  return raw.map((value) => (value / total) * width);
}

function drawTableHeader<Row extends Record<string, ExportV2Value>>(
  context: CanvasRenderingContext2D,
  columns: ExportV2Column<Row>[],
  widths: number[],
  l: Layout,
  y: number,
  height: number
) {
  let right = l.width - l.margin;
  columns.forEach((column, index) => {
    const width = widths[index];
    const x = right - width;
    context.fillStyle = COLORS.black;
    context.fillRect(x, y, width, height);
    context.strokeStyle = "#323640";
    context.strokeRect(x, y, width, height);
    drawText(context, column.header, x + width / 2, y + 13, width - 12, {
      size: 12,
      weight: 900,
      color: COLORS.white,
      align: "center",
      maxLines: 2,
      lineHeight: 15,
    });
    right = x;
  });
}

function statusColor(text: string) {
  if (/غير مكتمل|مراجعة|غير جاهز|ناقصة/.test(text)) return COLORS.burgundy;
  if (/مسودة/.test(text)) return "#9A6A00";
  if (/مكتمل|معفى|مؤكد|معتمد|مدفوع/.test(text)) return COLORS.green;
  return COLORS.ink;
}

function drawTableRow<Row extends Record<string, ExportV2Value>>(
  context: CanvasRenderingContext2D,
  row: Row,
  rowIndex: number,
  columns: ExportV2Column<Row>[],
  widths: number[],
  l: Layout,
  y: number,
  height: number
) {
  let right = l.width - l.margin;
  columns.forEach((column, index) => {
    const width = widths[index];
    const x = right - width;
    context.fillStyle = rowIndex % 2 === 0 ? COLORS.white : "#FBFBFC";
    context.fillRect(x, y, width, height);
    context.strokeStyle = COLORS.border;
    context.strokeRect(x, y, width, height);

    const value = exportV2FormatValue(row[column.key], column.type);
    const center = column.type === "currency" || column.type === "number" || column.type === "status" || column.align === "center";
    const textColor = column.type === "status" || column.key === "setupStatus" || column.key === "attendanceStatus"
      ? statusColor(value)
      : column.key === "deductions" && Number(row[column.key] || 0) > 0
        ? COLORS.burgundy
        : column.key === "leaveCompensation" && Number(row[column.key] || 0) > 0
          ? "#8A6600"
        : column.key === "previousPeriodAdjustment" && Number(row[column.key] || 0) < 0
          ? COLORS.burgundy
          : column.key === "expectedNet" || (column.key === "previousPeriodAdjustment" && Number(row[column.key] || 0) > 0)
            ? COLORS.green
            : COLORS.ink;
    drawText(context, value, center ? x + width / 2 : x + width - 9, y + 13, width - 18, {
      size: column.type === "currency" ? 12 : 11,
      weight: column.type === "currency" || column.key === "employeeName" ? 800 : 600,
      color: textColor,
      align: center ? "center" : "right",
      maxLines: column.key === "setupStatus" ? 2 : 1,
      lineHeight: 14,
    });
    right = x;
  });
}

function drawTotals<Row extends Record<string, ExportV2Value>>(
  context: CanvasRenderingContext2D,
  report: ExportV2Report<Row>,
  columns: ExportV2Column<Row>[],
  widths: number[],
  l: Layout,
  y: number,
  height: number
) {
  let right = l.width - l.margin;
  columns.forEach((column, index) => {
    const width = widths[index];
    const x = right - width;
    context.fillStyle = COLORS.paleGold;
    context.fillRect(x, y, width, height);
    context.strokeStyle = COLORS.gold;
    context.strokeRect(x, y, width, height);
    const total = report.totals?.[column.key];
    const label = index === 0 ? "الإجمالي" : typeof total === "number" ? exportV2FormatValue(total, column.type) : "";
    drawText(context, label, x + width / 2, y + 12, width - 12, {
      size: 12,
      weight: 900,
      color: typeof total === "number" ? "#8A6600" : COLORS.ink,
      align: "center",
    });
    right = x;
  });
}

function excludedReviewNotes<Row extends Record<string, ExportV2Value>>(report: ExportV2Report<Row>) {
  const reviewTable = (report.extraTables || []).find((table) => table.name.includes("مراجعات قبل الإقفال"));
  if (reviewTable?.rows?.length) {
    return reviewTable.rows.slice(0, 4).map((row) => {
      const employee = String(row.employeeName || "موظفة غير محددة").trim();
      const reason = String(row.reason || "يحتاج مراجعة").trim();
      return `${employee} — ${reason}`;
    });
  }
  return (report.notes || [])
    .filter((note) => note.startsWith("مستبعد من التصدير:"))
    .map((note) => note.replace(/^مستبعد من التصدير:\s*/, ""))
    .slice(0, 4);
}

function drawReviewPanel<Row extends Record<string, ExportV2Value>>(
  context: CanvasRenderingContext2D,
  report: ExportV2Report<Row>,
  l: Layout,
  y: number,
  maxHeight: number
) {
  const notes = excludedReviewNotes(report);
  if (!notes.length || maxHeight < 90) return;
  const height = Math.min(maxHeight, 94 + notes.length * 32);
  roundedRect(context, l.margin, y, l.contentWidth, height, 16, COLORS.white, COLORS.border, 1.1);
  drawText(context, "مراجعات قبل إقفال المسيرة", l.width - l.margin - 20, y + 15, l.contentWidth - 40, {
    size: 17,
    weight: 900,
    color: COLORS.black,
  });
  drawText(context, "هذه السجلات لم تدخل الصرف الرسمي وتحتاج إجراء قبل الاعتماد. أي فرق لاحق بعد الاعتماد يُرحّل كتسوية للفترة التالية.", l.width - l.margin - 20, y + 43, l.contentWidth - 40, {
    size: 12,
    weight: 600,
    color: COLORS.muted,
  });
  notes.forEach((note, index) => {
    const rowY = y + 70 + index * 31;
    context.fillStyle = index % 2 === 0 ? COLORS.paleBurgundy : COLORS.slate;
    roundedRect(context, l.margin + 16, rowY, l.contentWidth - 32, 26, 7, context.fillStyle as string);
    drawText(context, `• ${note}`, l.width - l.margin - 30, rowY + 5, l.contentWidth - 60, {
      size: 11,
      weight: 700,
      color: COLORS.ink,
    });
  });
}

function drawAccountingPolicyPanel<Row extends Record<string, ExportV2Value>>(
  context: CanvasRenderingContext2D,
  report: ExportV2Report<Row>,
  l: Layout,
  y: number,
  maxHeight: number
) {
  if (maxHeight < 82) return;
  const compensation = summaryByLabel(report, ["تعويض رصيد الإجازات"]);
  const carryover = summaryByLabel(report, ["تسويات فترات سابقة"]);
  const height = Math.min(maxHeight, 112);
  roundedRect(context, l.margin, y, l.contentWidth, height, 16, COLORS.slate, COLORS.border, 1.1);
  drawText(context, "ضوابط محاسبية للمسيرة", l.width - l.margin - 18, y + 13, l.contentWidth - 36, {
    size: 16,
    weight: 900,
    color: COLORS.black,
  });
  const half = (l.contentWidth - 50) / 2;
  const rightX = l.width - l.margin - 18;
  drawText(context, "تعويض رصيد الإجازات", rightX, y + 42, half, { size: 12, weight: 800, color: "#8A6600" });
  drawText(context, `${exportV2FormatValue(compensation?.value || 0, "currency")} • بند مستقل عن الإضافات والمكافآت ويدخل في صافي الصرف.`, rightX, y + 63, half, { size: 11, weight: 600, color: COLORS.muted, maxLines: 2, lineHeight: 15 });
  const leftX = l.margin + half;
  drawText(context, "تسويات الفترات السابقة", leftX, y + 42, half, { size: 12, weight: 800, color: COLORS.black });
  drawText(context, `${exportV2FormatValue(carryover?.value || 0, "currency")} • أي فرق يظهر بعد اعتماد الشهر يُرحّل للفترة التالية ولا يعاد فتح الشهر المصروف.`, leftX, y + 63, half, { size: 11, weight: 600, color: COLORS.muted, maxLines: 2, lineHeight: 15 });
}

function drawFooter(context: CanvasRenderingContext2D, l: Layout, pageIndex: number, pageCount: number) {
  context.strokeStyle = COLORS.border;
  context.beginPath();
  context.moveTo(l.margin, l.footerY - 18);
  context.lineTo(l.width - l.margin, l.footerY - 18);
  context.stroke();
  drawText(context, "مَلِكات — تقرير رواتب تنفيذي • للاستخدام الإداري", l.width - l.margin, l.footerY - 10, l.contentWidth / 2, {
    size: 10,
    weight: 700,
    color: COLORS.muted,
  });
  drawText(context, `${pageIndex + 1} / ${pageCount}`, l.margin, l.footerY - 10, 120, {
    size: 10,
    weight: 800,
    color: COLORS.muted,
    align: "left",
    direction: "ltr",
  });
}

async function canvasToJpeg(canvas: HTMLCanvasElement) {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((result) => result ? resolve(result) : reject(new Error("تعذر تحويل تقرير الرواتب إلى PDF.")), "image/jpeg", 0.94);
  });
  return new Uint8Array(await blob.arrayBuffer());
}

export async function buildPayrollExecutivePdfBytes<Row extends Record<string, ExportV2Value>>(
  report: ExportV2Report<Row>
) {
  if (typeof document === "undefined") throw new Error("تصدير PDF يتطلب تشغيل الصفحة داخل المتصفح.");
  if (document.fonts?.ready) await document.fonts.ready;

  const l = layout();
  const branding = { ...DEFAULT_EXPORT_V2_BRANDING, ...report.branding };
  const logo = await loadImage(branding.logoUrl);
  const columns = financialColumns(report);
  const widths = normalizedWidths(columns, l.contentWidth);
  const tableHeaderHeight = 44;
  const rowHeight = 54;
  const totalsHeight = 44;
  const firstTableY = 402;
  const otherTableY = 144;
  const firstCapacity = 8;
  const otherCapacity = 16;
  const remaining = Math.max(0, report.rows.length - firstCapacity);
  const pageCount = Math.max(1, 1 + Math.ceil(remaining / otherCapacity));
  const pages: PageImage[] = [];
  let cursor = 0;

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const { canvas, context } = createCanvas(l);
    const first = pageIndex === 0;
    const headerBottom = drawHeader(context, report, l, logo, !first);
    let tableY = first ? firstTableY : Math.max(otherTableY, headerBottom + 18);
    if (first) {
      const metaBottom = drawMeta(context, report, l, headerBottom + 12);
      const kpiBottom = drawKpis(context, report, l, metaBottom + 12);
      tableY = Math.max(tableY, kpiBottom + 16);
      drawText(context, "السجلات الداخلة في التصدير الرسمي", l.width - l.margin, tableY - 29, 500, {
        size: 16,
        weight: 900,
        color: COLORS.black,
      });
    }

    drawTableHeader(context, columns, widths, l, tableY, tableHeaderHeight);
    const capacity = first ? firstCapacity : otherCapacity;
    const pageRows = report.rows.slice(cursor, cursor + capacity);
    pageRows.forEach((row, index) => drawTableRow(
      context,
      row,
      cursor + index,
      columns,
      widths,
      l,
      tableY + tableHeaderHeight + index * rowHeight,
      rowHeight
    ));
    cursor += pageRows.length;

    const lastPage = pageIndex === pageCount - 1;
    let endY = tableY + tableHeaderHeight + pageRows.length * rowHeight;
    if (lastPage && report.rows.length && report.totals) {
      drawTotals(context, report, columns, widths, l, endY, totalsHeight);
      endY += totalsHeight;
    }
    if (first && lastPage) {
      const available = l.footerY - 34 - (endY + 18);
      const reviewNotes = excludedReviewNotes(report);
      if (reviewNotes.length && available >= 190) {
        const reviewHeight = Math.min(available - 92, 94 + reviewNotes.length * 32);
        drawReviewPanel(context, report, l, endY + 18, reviewHeight);
        drawAccountingPolicyPanel(context, report, l, endY + 28 + reviewHeight, available - reviewHeight - 10);
      } else {
        drawAccountingPolicyPanel(context, report, l, endY + 18, available);
      }
    }
    drawFooter(context, l, pageIndex, pageCount);
    pages.push({ bytes: await canvasToJpeg(canvas), width: canvas.width, height: canvas.height });
  }

  return buildPdfFromJpegPages(pages, l.pageWidthPoints, l.pageHeightPoints);
}

export async function exportPayrollExecutivePdf<Row extends Record<string, ExportV2Value>>(
  report: ExportV2Report<Row>
) {
  const bytes = await buildPayrollExecutivePdfBytes(report);
  downloadExportV2Blob(new Blob([bytes], { type: "application/pdf" }), buildExportV2FileName(report, "pdf"));
}
