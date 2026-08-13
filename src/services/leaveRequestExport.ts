import type { EmployeeRequest } from "./employeeRequests";
import { exportReportToExcelV2 } from "./exports-v2/excel";
import { buildPdfFromJpegPages } from "./exports-v2/pdf";
import type { ExportV2Report, ExportV2Value } from "./exports-v2/types";
import { downloadExportV2Blob } from "./exports-v2/download";
import { DOCUMENT_BRANDING } from "../documents/core/documentBranding";
import { zipStore, xmlEscape } from "../documents/core/officeZip";
import {
  buildLeaveRequestDocumentData,
  formatDocumentDateTime,
  safeDocumentText,
} from "../documents/leave/leaveRequestModel";
import type { LeaveRequestDocumentData, LeaveRequestDocumentSignature } from "../documents/leave/leaveRequestModel";

type LeaveExcelRow = Record<string, ExportV2Value> & {
  section: string;
  field: string;
  value: string | number;
};

type DocxImage = {
  id: "logo" | "employee" | "manager";
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
};

type DocxImageOptions = {
  align?: "left" | "center" | "right";
  widthEmu?: number;
  heightEmu?: number;
  docPrId?: number;
};

const A4_PORTRAIT_POINTS = { width: 595.28, height: 841.89 };
const PDF_CANVAS = { width: 1131, height: 1600, margin: 68 };
const FONT_FAMILY = 'Tahoma, Arial, "Segoe UI", sans-serif';

function sanitizeFilePart(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80) || "leave-request";
}

function leaveDocumentRoot() {
  return document.querySelector<HTMLElement>(".leave-request-print-root");
}

function currentStyleNodes() {
  return Array.from(document.head.querySelectorAll("link[rel='stylesheet'], style"))
    .map((node) => node.outerHTML)
    .join("\n");
}

function waitForImages(doc: Document) {
  const images = Array.from(doc.images);
  return Promise.all(images.map((image) => {
    if (image.complete) return Promise.resolve();
    return new Promise<void>((resolve) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => resolve(), { once: true });
    });
  }));
}

const PRINT_ISOLATION_CSS = `
@page { size: A4 portrait; margin: 0; }
html, body {
  margin: 0 !important;
  padding: 0 !important;
  width: 210mm !important;
  min-height: 297mm !important;
  background: #fff !important;
  overflow: visible !important;
}
body {
  direction: rtl !important;
  display: block !important;
}
.leave-request-print-root,
.document-a4-page {
  width: 210mm !important;
  min-height: 297mm !important;
  max-width: none !important;
  margin: 0 !important;
  padding: 13mm 12mm 11mm !important;
  border: 0 !important;
  box-shadow: none !important;
  background: #fff !important;
  color: #000 !important;
  overflow: visible !important;
  transform: none !important;
  page-break-inside: avoid !important;
  break-inside: avoid-page !important;
}
.document-watermark {
  filter: brightness(0) contrast(100%) !important;
  opacity: ${DOCUMENT_BRANDING.watermarkOpacity} !important;
}
.leave-doc-brand img {
  filter: brightness(0) contrast(100%) !important;
}
.leave-request-export-toolbar,
.employee-request-action-modal,
.dashboard-sidebar,
.navbar,
.bottom-nav {
  display: none !important;
}`;

export async function printLeaveRequestDocument() {
  const source = leaveDocumentRoot();
  if (!source) throw new Error("لم يتم العثور على نموذج الإجازة للطباعة.");

  const frame = document.createElement("iframe");
  frame.setAttribute("title", "طباعة طلب الإجازة");
  frame.style.position = "fixed";
  frame.style.width = "1px";
  frame.style.height = "1px";
  frame.style.right = "-10000px";
  frame.style.bottom = "0";
  frame.style.border = "0";
  document.body.appendChild(frame);

  const printDoc = frame.contentDocument;
  if (!printDoc) {
    frame.remove();
    throw new Error("تعذر تجهيز نافذة الطباعة.");
  }

  const clone = source.cloneNode(true) as HTMLElement;
  printDoc.open();
  printDoc.write(`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><base href="${document.baseURI}">${currentStyleNodes()}<style>${PRINT_ISOLATION_CSS}</style></head><body>${clone.outerHTML}</body></html>`);
  printDoc.close();

  await waitForImages(printDoc);
  if ("fonts" in printDoc) {
    try { await printDoc.fonts.ready; } catch { /* keep printing with available fonts */ }
  }

  const printWindow = frame.contentWindow;
  if (!printWindow) {
    frame.remove();
    throw new Error("تعذر فتح نافذة الطباعة.");
  }
  printWindow.focus();
  printWindow.print();
  window.setTimeout(() => frame.remove(), 1800);
}

function leaveRows(data: LeaveRequestDocumentData): LeaveExcelRow[] {
  return [
    { section: "بيانات الخطاب", field: "الجهة", value: data.addressee },
    { section: "بيانات الخطاب", field: "رقم الطلب", value: data.requestNumber },
    { section: "بيانات الموظفة", field: "اسم الموظفة", value: data.employeeName },
    { section: "بيانات الموظفة", field: "رقم الموظفة", value: data.employeeId },
    { section: "بيانات الإجازة", field: "نوع الإجازة", value: data.leaveTypeLabel },
    { section: "بيانات الإجازة", field: "من تاريخ", value: String(data.fields[0]?.value || "") },
    { section: "بيانات الإجازة", field: "إلى تاريخ", value: String(data.fields[1]?.value || "") },
    { section: "بيانات الإجازة", field: "عدد الأيام", value: data.leaveDays },
    { section: "بيانات الإجازة", field: "سبب الإجازة", value: data.reason },
    { section: "بيانات الإجازة", field: "ملاحظات الموظفة", value: data.notes },
    { section: "التوقيع الإلكتروني", field: "تاريخ تقديم الطلب", value: data.submittedAtLabel },
    { section: "التوقيع الإلكتروني", field: "توقيع الموظفة", value: data.employeeSignature.imageDataUrl ? `توقيع بخط اليد محفوظ إلكترونيًا - ${data.submittedAtLabel}` : data.employeeSignature.fallback },
    { section: "رأي المدير الإداري", field: "اسم المسؤول", value: data.managerName },
    { section: "رأي المدير الإداري", field: "الدور", value: data.managerRole },
    { section: "رأي المدير الإداري", field: "القرار", value: data.managerDecisionLabel },
    { section: "رأي المدير الإداري", field: "ملاحظات / القرار", value: data.managerDecisionNote },
    { section: "رأي المدير الإداري", field: "تاريخ القرار", value: data.managerDecidedAtLabel },
    { section: "رأي المدير الإداري", field: "التوقيع الإداري", value: data.managerSignature.imageDataUrl ? `توقيع بخط اليد محفوظ إلكترونيًا - ${data.managerDecidedAtLabel}` : data.managerSignature.fallback },
    { section: "حالة الطلب", field: "الحالة", value: data.statusLabel },
  ];
}

function buildLeaveExportReport(data: LeaveRequestDocumentData): ExportV2Report<LeaveExcelRow> {
  const rows = leaveRows(data);
  return {
    slug: `leave-request-${sanitizeFilePart(data.employeeName)}`,
    reportCode: data.requestNumber,
    title: data.title,
    subtitle: data.addressee,
    summarySheetName: "نموذج الإجازة",
    detailsSheetName: "بيانات الطلب",
    period: data.periodLabel,
    generatedAt: new Date().toISOString(),
    generatedBy: data.employeeName,
    branding: {
      salonName: DOCUMENT_BRANDING.salonName,
      brandName: DOCUMENT_BRANDING.brandName,
      logoUrl: DOCUMENT_BRANDING.printLogoSource,
    },
    filters: [
      { label: "رقم الطلب", value: data.requestNumber },
      { label: "الموظفة", value: data.employeeName },
      { label: "الحالة", value: data.statusLabel },
    ],
    summary: [
      { label: "رقم الطلب", value: data.requestNumber, tone: "gold" },
      { label: "الموظفة", value: data.employeeName, tone: "dark" },
      { label: "نوع الإجازة", value: data.leaveTypeLabel, tone: "neutral" },
      { label: "عدد الأيام", value: data.leaveDays, type: "number", tone: "gold" },
      { label: "القرار", value: data.managerDecisionLabel, tone: data.managerDecisionLabel === "مع الموافقة" ? "success" : data.managerDecisionLabel.includes("مرفوض") ? "danger" : "neutral" },
      { label: "الحالة", value: data.statusLabel, tone: "neutral" },
    ],
    columns: [
      { key: "section", header: "القسم", width: 22 },
      { key: "field", header: "البيان", width: 26 },
      { key: "value", header: "التفاصيل", width: 42 },
    ],
    rows,
    notes: [
      "نسخة إلكترونية كاملة من طلب الإجازة.",
      "التوقيعات محفوظة بخط اليد داخل سجل الطلب الإلكتروني.",
      "تم إعداد التقرير للطباعة على A4 بوضع عمودي.",
    ],
    pdfOrientation: "portrait",
  };
}

export function exportLeaveRequestToExcel(request: EmployeeRequest) {
  exportReportToExcelV2(buildLeaveExportReport(buildLeaveRequestDocumentData(request)));
}

function canvasToJpeg(canvas: HTMLCanvasElement) {
  return new Promise<Uint8Array>((resolve, reject) => {
    canvas.toBlob(async (result) => {
      if (!result) {
        reject(new Error("تعذر تحويل صفحة PDF إلى صورة داخلية."));
        return;
      }
      resolve(new Uint8Array(await result.arrayBuffer()));
    }, "image/jpeg", 0.94);
  });
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
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = "source-in";
  context.fillStyle = "#000";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.globalCompositeOperation = "source-over";
  return canvas;
}

function blackLogoPngDataUrl(image: HTMLImageElement) {
  const canvas = blackLogoCanvas(image);
  return canvas ? canvas.toDataURL("image/png") : "";
}

function setFont(context: CanvasRenderingContext2D, size: number, weight = 500) {
  context.font = `${weight} ${size}px ${FONT_FAMILY}`;
}

function drawText(context: CanvasRenderingContext2D, value: unknown, x: number, y: number, maxWidth: number, size: number, weight = 500, color = "#111", align: CanvasTextAlign = "right") {
  context.save();
  context.direction = "rtl";
  context.textAlign = align;
  context.textBaseline = "top";
  context.fillStyle = color;
  setFont(context, size, weight);
  context.fillText(String(value ?? "—"), x, y, maxWidth);
  context.restore();
}

function wrapText(context: CanvasRenderingContext2D, value: unknown, maxWidth: number, maxLines = 4) {
  const words = safeDocumentText(value).replace(/\s+/g, " ").split(" ");
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
  return lines;
}

function drawWrappedText(context: CanvasRenderingContext2D, value: unknown, x: number, y: number, maxWidth: number, size: number, weight = 500, maxLines = 4, lineHeight = Math.round(size * 1.45)) {
  context.save();
  context.direction = "rtl";
  context.textAlign = "right";
  context.textBaseline = "top";
  context.fillStyle = "#111";
  setFont(context, size, weight);
  wrapText(context, value, maxWidth, maxLines).forEach((line, index) => {
    context.fillText(line, x, y + index * lineHeight, maxWidth);
  });
  context.restore();
}

function strokeBox(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number) {
  context.strokeStyle = "#222";
  context.lineWidth = 1.5;
  context.strokeRect(x, y, width, height);
}

function drawField(context: CanvasRenderingContext2D, label: string, value: unknown, x: number, y: number, width: number) {
  drawText(context, label, x + width - 8, y + 6, width - 16, 15, 700, "#444");
  drawText(context, value, x + width - 8, y + 32, width - 16, 18, 800);
  context.beginPath();
  context.moveTo(x, y + 66);
  context.lineTo(x + width, y + 66);
  context.strokeStyle = "#222";
  context.stroke();
}

function drawSignature(context: CanvasRenderingContext2D, signature: LeaveRequestDocumentSignature, image: HTMLImageElement | null, x: number, y: number, width: number) {
  drawText(context, signature.label, x + width - 8, y, width - 16, 15, 700, "#444");
  if (image) {
    const maxWidth = Math.min(width - 16, 260);
    const maxHeight = 76;
    const ratio = Math.min(maxWidth / image.width, maxHeight / image.height);
    const drawWidth = image.width * ratio;
    const drawHeight = image.height * ratio;
    context.drawImage(image, x + width - 8 - drawWidth, y + 24, drawWidth, drawHeight);
  } else {
    drawText(context, signature.fallback, x + width - 8, y + 28, width - 16, 18, 800);
  }
  if (signature.signedAt) drawText(context, signature.signedAt, x + width - 8, y + 104, width - 16, 13, 500, "#555");
  context.beginPath();
  context.moveTo(x, y + 126);
  context.lineTo(x + width, y + 126);
  context.strokeStyle = "#222";
  context.stroke();
}

export async function buildLeaveRequestPdfBytes(request: EmployeeRequest) {
  if (typeof document === "undefined") throw new Error("تصدير PDF يتطلب تشغيل الصفحة داخل المتصفح.");
  if (document.fonts?.ready) await document.fonts.ready;

  const data = buildLeaveRequestDocumentData(request);
  const [logoSource, employeeSignature, managerSignature] = await Promise.all([
    loadImage(DOCUMENT_BRANDING.printLogoSource),
    loadImage(data.employeeSignature.imageDataUrl),
    loadImage(data.managerSignature.imageDataUrl),
  ]);
  const logo = logoSource ? blackLogoCanvas(logoSource) : null;
  const canvas = document.createElement("canvas");
  canvas.width = PDF_CANVAS.width;
  canvas.height = PDF_CANVAS.height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("تعذر إنشاء لوحة PDF في المتصفح.");

  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.direction = "rtl";
  strokeBox(context, PDF_CANVAS.margin, 48, canvas.width - PDF_CANVAS.margin * 2, canvas.height - 96);

  const right = canvas.width - PDF_CANVAS.margin - 42;
  if (logo) {
    const watermarkWidth = 620;
    const watermarkHeight = 310;
    const ratio = Math.min(watermarkWidth / logo.width, watermarkHeight / logo.height);
    const drawWidth = logo.width * ratio;
    const drawHeight = logo.height * ratio;
    context.save();
    context.globalAlpha = DOCUMENT_BRANDING.watermarkOpacity;
    context.drawImage(logo, (canvas.width - drawWidth) / 2, (canvas.height - drawHeight) / 2, drawWidth, drawHeight);
    context.restore();
  }
  if (logo) {
    const maxWidth = 220;
    const maxHeight = 120;
    const ratio = Math.min(maxWidth / logo.width, maxHeight / logo.height);
    const drawWidth = logo.width * ratio;
    const drawHeight = logo.height * ratio;
    context.drawImage(logo, PDF_CANVAS.margin + 42, 78, drawWidth, drawHeight);
  }
  drawText(context, data.title, canvas.width / 2, 94, 260, 34, 900, "#111", "center");
  context.beginPath();
  context.moveTo(PDF_CANVAS.margin + 34, 190);
  context.lineTo(canvas.width - PDF_CANVAS.margin - 34, 190);
  context.strokeStyle = "#222";
  context.stroke();
  drawText(context, `رقم الطلب: ${data.requestNumber}`, right, 212, 360, 17, 800, "#444");

  let y = 258;
  const optionWidth = 260;
  data.leaveTypeOptions.forEach((option, index) => {
    const x = right - optionWidth - index * (optionWidth + 16);
    strokeBox(context, x + optionWidth - 28, y + 4, 24, 24);
    if (option.checked) drawText(context, "✓", x + optionWidth - 12, y + 2, 20, 21, 900, "#111", "center");
    drawText(context, option.label, x + optionWidth - 40, y + 3, optionWidth - 44, 17, 800);
  });

  y += 62;
  drawText(context, data.addressee, right, y, canvas.width - PDF_CANVAS.margin * 2 - 84, 19, 900);
  y += 36;
  drawText(context, "الموقرين", right, y, 280, 18, 700);
  y += 34;
  drawText(context, "السلام عليكم ورحمة الله وبركاته،،", right, y, 420, 18, 700);
  y += 42;
  drawWrappedText(context, `أتقدم لكم بطلبي هذا راجية الموافقة على منحي إجازة لمدة ${data.leaveDays || "___"} ${data.leaveDays === 1 ? "يوم" : "أيام"}، اعتبارًا من يوم ${data.fields[0]?.value} وحتى يوم ${data.fields[1]?.value}.`, right, y, canvas.width - PDF_CANVAS.margin * 2 - 84, 19, 600, 3, 30);
  y += 112;

  const fieldWidth = 460;
  drawField(context, data.fields[0]?.label || "", data.fields[0]?.value || "", right - fieldWidth, y, fieldWidth);
  drawField(context, data.fields[1]?.label || "", data.fields[1]?.value || "", right - fieldWidth * 2 - 24, y, fieldWidth);
  y += 88;
  drawField(context, data.fields[2]?.label || "", data.fields[2]?.value || "", right - fieldWidth, y, fieldWidth);
  drawField(context, data.fields[3]?.label || "", data.fields[3]?.value || "", right - fieldWidth * 2 - 24, y, fieldWidth);
  y += 96;

  drawText(context, "سبب الإجازة", right, y, 260, 15, 700, "#444");
  context.beginPath();
  context.moveTo(PDF_CANVAS.margin + 42, y + 76);
  context.lineTo(right, y + 76);
  context.stroke();
  drawWrappedText(context, data.reason, right, y + 24, canvas.width - PDF_CANVAS.margin * 2 - 84, 17, 600, 2, 26);
  y += 104;
  if (data.notes !== "—") {
    drawText(context, "ملاحظات", right, y, 260, 15, 700, "#444");
    context.beginPath();
    context.moveTo(PDF_CANVAS.margin + 42, y + 70);
    context.lineTo(right, y + 70);
    context.stroke();
    drawWrappedText(context, data.notes, right, y + 24, canvas.width - PDF_CANVAS.margin * 2 - 84, 17, 600, 2, 25);
    y += 94;
  }

  drawField(context, "الاسم", data.employeeName, right - fieldWidth, y, fieldWidth);
  drawSignature(context, data.employeeSignature, employeeSignature, right - fieldWidth * 2 - 24, y, fieldWidth);
  y += 166;

  context.beginPath();
  context.moveTo(PDF_CANVAS.margin + 42, y);
  context.lineTo(right, y);
  context.stroke();
  y += 26;
  drawText(context, "رأي المدير الإداري", right, y, 360, 20, 900);
  y += 34;
  drawWrappedText(context, "تمت مراجعة الطلب واتخاذ القرار الموضح أدناه وفق ظروف العمل والأنظمة المعتمدة.", right, y, canvas.width - PDF_CANVAS.margin * 2 - 84, 17, 600, 2, 26);
  y += 72;
  drawField(context, "اسم المسؤول", `${data.managerName} — ${data.managerRole}`, right - fieldWidth, y, fieldWidth);
  drawSignature(context, data.managerSignature, managerSignature, right - fieldWidth * 2 - 24, y, fieldWidth);
  y += 152;
  data.managerDecisionOptions.forEach((option, index) => {
    const x = right - 300 - index * 330;
    strokeBox(context, x + 272, y + 2, 24, 24);
    if (option.checked) drawText(context, "✓", x + 284, y, 20, 21, 900, "#111", "center");
    drawText(context, option.label, x + 260, y + 2, 230, 17, 800);
  });
  y += 50;
  drawText(context, "الملاحظات / القرار", right, y, 280, 15, 700, "#444");
  drawWrappedText(context, data.managerDecisionNote, right, y + 24, canvas.width - PDF_CANVAS.margin * 2 - 84, 16, 600, 2, 24);

  drawText(context, "نسخة محفوظة إلكترونيًا ضمن نظام طلبات الموظفات", right, canvas.height - 86, 520, 12, 500, "#666");
  const bytes = await canvasToJpeg(canvas);
  return buildPdfFromJpegPages([{ bytes, width: canvas.width, height: canvas.height }], A4_PORTRAIT_POINTS.width, A4_PORTRAIT_POINTS.height);
}

export async function exportLeaveRequestToPdf(request: EmployeeRequest) {
  const data = buildLeaveRequestDocumentData(request);
  const bytes = await buildLeaveRequestPdfBytes(request);
  downloadExportV2Blob(
    new Blob([bytes], { type: "application/pdf" }),
    `malikat-leave-request-${sanitizeFilePart(data.employeeName)}-${sanitizeFilePart(data.requestNumber)}.pdf`
  );
}

function dataUrlToImage(value: string, id: DocxImage["id"]): DocxImage | null {
  const match = /^data:(image\/(?:png|jpeg|jpg));base64,(.+)$/i.exec(String(value || "").trim());
  if (!match) return null;
  const contentType = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return {
    id,
    fileName: `${id}.${contentType === "image/png" ? "png" : "jpg"}`,
    contentType,
    bytes,
  };
}

function p(text: unknown, options: { bold?: boolean; size?: number; center?: boolean } = {}) {
  const size = options.size || 22;
  return `<w:p><w:pPr><w:bidi/><w:jc w:val="${options.center ? "center" : "right"}"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma" w:cs="Tahoma"/><w:rtl/><w:lang w:val="ar-SA" w:bidi="ar-SA"/>${options.bold ? "<w:b/><w:bCs/>" : ""}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

function checkboxText(label: string, checked: boolean) {
  return `${checked ? "☑" : "☐"} ${label}`;
}

function docxImage(image: DocxImage | null, relId: string, fallback: string, options: DocxImageOptions = {}) {
  if (!image) return fallback ? p(fallback, { bold: true }) : "";
  const cx = options.widthEmu || 1428750;
  const cy = options.heightEmu || 457200;
  const align = options.align || "right";
  const docPrId = options.docPrId || 1;
  return `<w:p><w:pPr><w:bidi/><w:jc w:val="${align}"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${docPrId}" name="${xmlEscape(image.fileName)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${docPrId}" name="${xmlEscape(image.fileName)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

function table(rows: Array<[string, string | number]>) {
  return `<w:tbl><w:tblPr><w:bidiVisual/><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="6"/><w:left w:val="single" w:sz="6"/><w:bottom w:val="single" w:sz="6"/><w:right w:val="single" w:sz="6"/><w:insideH w:val="single" w:sz="6"/><w:insideV w:val="single" w:sz="6"/></w:tblBorders></w:tblPr>${rows.map(([label, value]) => `<w:tr><w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>${p(label, { bold: true })}</w:tc><w:tc><w:tcPr><w:tcW w:w="6200" w:type="dxa"/></w:tcPr>${p(value)}</w:tc></w:tr>`).join("")}</w:tbl>`;
}

function documentXml(data: LeaveRequestDocumentData, images: { logo: DocxImage | null; employee: DocxImage | null; manager: DocxImage | null }) {
  const checkboxLine = data.leaveTypeOptions.map((option) => checkboxText(option.label, option.checked)).join("    ");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${docxImage(images.logo, "rIdLogo", "", { align: "left", widthEmu: 1750000, heightEmu: 700000, docPrId: 10 })}
    ${p(data.title, { bold: true, size: 34, center: true })}
    ${p(`رقم الطلب: ${data.requestNumber}`, { bold: true })}
    ${p(checkboxLine)}
    ${p(data.addressee, { bold: true })}
    ${p("الموقرين")}
    ${p("السلام عليكم ورحمة الله وبركاته،،")}
    ${p(`أتقدم لكم بطلبي هذا راجية الموافقة على منحي إجازة لمدة ${data.leaveDays || "___"} ${data.leaveDays === 1 ? "يوم" : "أيام"}، اعتبارًا من يوم ${data.fields[0]?.value} وحتى يوم ${data.fields[1]?.value}.`)}
    ${table(data.fields.map((field) => [field.label, field.value]))}
    ${p("سبب الإجازة", { bold: true })}
    ${p(data.reason)}
    ${data.notes !== "—" ? `${p("ملاحظات", { bold: true })}${p(data.notes)}` : ""}
    ${table([["الاسم", data.employeeName], ["تاريخ التقديم", data.submittedAtLabel]])}
    ${p(data.employeeSignature.label, { bold: true })}
    ${docxImage(images.employee, "rIdEmployeeSignature", data.employeeSignature.fallback, { align: "right", docPrId: 20 })}
    ${p("رأي المدير الإداري", { bold: true })}
    ${p("تمت مراجعة الطلب واتخاذ القرار الموضح أدناه وفق ظروف العمل والأنظمة المعتمدة.")}
    ${table([["اسم المسؤول", data.managerName], ["الدور", data.managerRole], ["القرار", data.managerDecisionLabel], ["تاريخ القرار", data.managerDecidedAtLabel]])}
    ${p(data.managerSignature.label, { bold: true })}
    ${docxImage(images.manager, "rIdManagerSignature", data.managerSignature.fallback, { align: "right", docPrId: 30 })}
    ${p("الملاحظات / القرار", { bold: true })}
    ${p(data.managerDecisionNote)}
    ${p("نسخة محفوظة إلكترونيًا ضمن نظام طلبات الموظفات", { size: 18 })}
    <w:sectPr>
      ${images.logo ? '<w:headerReference w:type="default" r:id="rIdHeader1"/>' : ""}
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/>
      <w:bidi/>
    </w:sectPr>
  </w:body>
</w:document>`;
}

function docxHeaderXml(hasLogo: boolean) {
  if (!hasLogo) return "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing>
    <wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1">
      <wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:align>center</wp:align></wp:positionH><wp:positionV relativeFrom="page"><wp:align>center</wp:align></wp:positionV>
      <wp:extent cx="5200000" cy="2100000"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="99" name="Malikat Watermark"/><wp:cNvGraphicFramePr/>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="99" name="Malikat Watermark"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdWatermark"><a:alphaModFix amt="5500"/></a:blip><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="5200000" cy="2100000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>
    </wp:anchor>
  </w:drawing></w:r></w:p>
</w:hdr>`;
}

function docxStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma" w:cs="Tahoma"/><w:lang w:val="ar-SA" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:bidi/></w:pPr></w:pPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:bidi/></w:pPr><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma" w:cs="Tahoma"/><w:lang w:val="ar-SA" w:bidi="ar-SA"/></w:rPr></w:style>
</w:styles>`;
}

function docxSettingsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="720"/><w:displayBackgroundShape/><w:compat/></w:settings>`;
}

function docxContentTypes(images: DocxImage[], hasHeader: boolean) {
  const imageDefaults = Array.from(new Set(images.map((image) => image.contentType === "image/png" ? "png" : "jpg"))).map((extension) => `<Default Extension="${extension}" ContentType="${extension === "png" ? "image/png" : "image/jpeg"}"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${imageDefaults}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>${hasHeader ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : ""}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
}

function docxRelationships(images: DocxImage[], hasHeader: boolean) {
  const ids: Record<DocxImage["id"], string> = { logo: "rIdLogo", employee: "rIdEmployeeSignature", manager: "rIdManagerSignature" };
  const imageRels = images.map((image) => `<Relationship Id="${ids[image.id]}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${image.fileName}"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>${hasHeader ? '<Relationship Id="rIdHeader1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>' : ""}${imageRels}</Relationships>`;
}

function docxHeaderRelationships(logo: DocxImage | null) {
  if (!logo) return "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdWatermark" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${logo.fileName}"/></Relationships>`;
}

function rootRelationshipsXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
}

function docProps(data: LeaveRequestDocumentData) {
  const timestamp = new Date().toISOString();
  return {
    core: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(`${data.title} ${data.requestNumber}`)}</dc:title><dc:creator>Malikat Document Export</dc:creator><cp:lastModifiedBy>Malikat Document Export</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${timestamp}</dcterms:modified></cp:coreProperties>`,
    app: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Malikat Document Export</Application><Company>Malikat Salon</Company></Properties>`,
  };
}

export async function buildLeaveRequestDocxBytes(request: EmployeeRequest) {
  if (typeof document === "undefined") throw new Error("تصدير Word يتطلب تشغيل الصفحة داخل المتصفح.");
  const data = buildLeaveRequestDocumentData(request);
  const logoSource = await loadImage(DOCUMENT_BRANDING.printLogoSource);
  const logoImage = logoSource ? dataUrlToImage(blackLogoPngDataUrl(logoSource), "logo") : null;
  const employeeImage = dataUrlToImage(data.employeeSignature.imageDataUrl || "", "employee");
  const managerImage = dataUrlToImage(data.managerSignature.imageDataUrl || "", "manager");
  const images = [logoImage, employeeImage, managerImage].filter((image): image is DocxImage => Boolean(image));
  const props = docProps(data);
  const hasHeader = Boolean(logoImage);
  return zipStore([
    { name: "[Content_Types].xml", content: docxContentTypes(images, hasHeader) },
    { name: "_rels/.rels", content: rootRelationshipsXml() },
    { name: "docProps/core.xml", content: props.core },
    { name: "docProps/app.xml", content: props.app },
    { name: "word/document.xml", content: documentXml(data, { logo: logoImage, employee: employeeImage, manager: managerImage }) },
    { name: "word/styles.xml", content: docxStylesXml() },
    { name: "word/settings.xml", content: docxSettingsXml() },
    { name: "word/_rels/document.xml.rels", content: docxRelationships(images, hasHeader) },
    ...(logoImage ? [{ name: "word/header1.xml", content: docxHeaderXml(true) }, { name: "word/_rels/header1.xml.rels", content: docxHeaderRelationships(logoImage) }] : []),
    ...images.map((image) => ({ name: `word/media/${image.fileName}`, content: image.bytes })),
  ]);
}

export async function exportLeaveRequestToWord(request: EmployeeRequest) {
  const data = buildLeaveRequestDocumentData(request);
  const bytes = await buildLeaveRequestDocxBytes(request);
  downloadExportV2Blob(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), `malikat-leave-request-${sanitizeFilePart(data.employeeName)}-${sanitizeFilePart(data.requestNumber)}.docx`);
}

export function auditLeaveRequestExportSurface(request: EmployeeRequest) {
  const data = buildLeaveRequestDocumentData(request);
  return {
    route: ["/dashboard/requests", "/employee/requests/:requestId"],
    page: ["src/pages/hr/AdminEmployeeRequests.tsx", "src/pages/hr/EmployeeRequests.tsx"],
    component: "src/components/hr/LeaveRequestDocument.tsx",
    css: ["src/documents/core/documentPrint.css", "src/styles/LeaveRequestDocument.css"],
    dataSource: "EmployeeRequest payload/events from src/services/employeeRequests.ts",
    branding: "src/documents/core/documentBranding.ts",
    printPath: "printLeaveRequestDocument() -> isolated iframe -> canonical A4 document",
    pdfPath: "exportLeaveRequestToPdf() -> canonical view model -> black branded A4 PDF bytes with watermark",
    docxPath: "exportLeaveRequestToWord() -> canonical view model -> Office Open XML .docx with RTL, logo, watermark and signatures",
    xlsxPath: "exportLeaveRequestToExcel() -> canonical view model -> Export V2 XLSX",
    data,
    generatedAt: formatDocumentDateTime(new Date().toISOString()),
  };
}
