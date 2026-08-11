import type { EmployeeRequest } from "./employeeRequests";
import {
  EMPLOYEE_REQUEST_STATUS_LABELS,
} from "./employeeRequests";
import { exportReportToExcelV2 } from "./exports-v2/excel";
import type { ExportV2Report } from "./exports-v2/types";
import { LEAVE_REQUEST_ADDRESSEE, leaveDays, leaveTypeLabel } from "../components/hr/LeaveRequestDocument";

function sanitizeFilePart(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80) || "طلب-اجازة";
}

function formatDate(value: unknown) {
  const text = String(value || "");
  if (!text) return "";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00`) : new Date(text);
  if (!Number.isFinite(date.getTime())) return text;
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatDateTime(value: unknown) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
    timeZone: "Asia/Riyadh",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function decisionData(request: EmployeeRequest) {
  const event = [...(request.events || [])]
    .reverse()
    .find((item) => ["approve", "approved", "reject", "rejected"].includes(String(item.event_type || "").toLowerCase()));
  const approved = ["approved", "executing", "completed"].includes(request.status) ||
    ["approve", "approved"].includes(String(event?.event_type || "").toLowerCase());
  const rejected = request.status === "rejected" ||
    ["reject", "rejected"].includes(String(event?.event_type || "").toLowerCase());
  return {
    decision: approved ? "مع الموافقة" : rejected ? "أخرى / مرفوض" : "قيد المراجعة",
    actor: event?.actor_name || request.assigned_to_name || "لم يحدد بعد",
    note: request.rejection_reason || request.decision_note || event?.note || "—",
    date: event?.created_at || request.approved_at || request.rejected_at || "",
  };
}

type LeaveExcelRow = {
  section: string;
  field: string;
  value: string | number;
};

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

const ISOLATED_PRINT_CSS = `
@page { size: A4 portrait; margin: 5mm; }
html, body {
  margin: 0 !important;
  padding: 0 !important;
  width: 100% !important;
  min-height: 0 !important;
  background: #fff !important;
  overflow: visible !important;
}
body {
  direction: rtl !important;
  display: block !important;
}
.leave-request-print-root {
  position: static !important;
  display: block !important;
  width: 198mm !important;
  min-height: 0 !important;
  height: auto !important;
  margin: 0 auto !important;
  padding: 6mm 8mm 5mm !important;
  border: 1px solid #111 !important;
  box-shadow: none !important;
  background: #fff !important;
  color: #000 !important;
  overflow: visible !important;
  page-break-inside: avoid !important;
  break-inside: avoid-page !important;
  font-size: 9.5px !important;
  line-height: 1.35 !important;
}
.leave-request-print-root .leave-doc-word-export { display: none !important; }
.leave-request-print-root .leave-doc-header { min-height: 18mm !important; margin-bottom: 2.5mm !important; padding-bottom: 1.5mm !important; }
.leave-request-print-root .leave-doc-header h2 { margin-top: 1mm !important; font-size: 16px !important; }
.leave-request-print-root .leave-doc-brand { min-width: 31mm !important; padding-top: 0 !important; }
.leave-request-print-root .leave-doc-brand img { width: 31mm !important; max-height: 15mm !important; }
.leave-request-print-root .leave-doc-number { margin: -1mm 0 1.5mm !important; font-size: 8.5px !important; }
.leave-request-print-root .leave-doc-type-row { gap: 2px !important; margin-bottom: 2mm !important; }
.leave-request-print-root .leave-doc-checkbox { padding: 1px !important; gap: 4px !important; }
.leave-request-print-root .leave-doc-checkbox > span { width: 14px !important; height: 14px !important; flex-basis: 14px !important; border-width: 1.2px !important; font-size: 9px !important; }
.leave-request-print-root .leave-doc-checkbox strong { font-size: 9.5px !important; }
.leave-request-print-root .leave-doc-letter { margin-bottom: 1.5mm !important; font-size: 9.5px !important; }
.leave-request-print-root .leave-doc-letter p { margin: 0 !important; }
.leave-request-print-root .leave-doc-greeting { margin-top: 1.2mm !important; margin-bottom: 1mm !important; }
.leave-request-print-root .leave-doc-inline-value { min-width: 16mm !important; }
.leave-request-print-root .leave-doc-fields-grid { gap: 3px 8px !important; margin: 2mm 0 !important; }
.leave-request-print-root .leave-doc-static-field { min-height: 8mm !important; padding: 0 1px 2px !important; }
.leave-request-print-root .leave-doc-static-field > span,
.leave-request-print-root .leave-doc-print-text > span,
.leave-request-print-root .leave-doc-signature-row span { font-size: 7.5px !important; }
.leave-request-print-root .leave-doc-static-field strong,
.leave-request-print-root .leave-doc-signature-row strong { font-size: 9.5px !important; }
.leave-request-print-root .leave-doc-print-text { margin: 1.5mm 0 !important; }
.leave-request-print-root .leave-doc-print-text p { min-height: 5mm !important; padding: 1px !important; font-size: 9px !important; }
.leave-request-print-root .leave-doc-signature-row { gap: 7mm !important; margin-top: 2mm !important; }
.leave-request-print-root .leave-doc-signature-row > div,
.leave-request-print-root .signature-capture-field { min-height: 8mm !important; gap: 0 !important; }
.leave-request-print-root .leave-doc-signature-image { max-width: 48mm !important; max-height: 13mm !important; object-fit: contain !important; }
.leave-request-print-root .leave-doc-signature-row small { font-size: 7px !important; }
.leave-request-print-root .leave-doc-manager-opinion { margin-top: 2.5mm !important; padding-top: 2mm !important; }
.leave-request-print-root .leave-doc-manager-opinion h3,
.leave-request-print-root .leave-doc-admin-block h3 { margin-bottom: 1mm !important; font-size: 10.5px !important; }
.leave-request-print-root .leave-doc-manager-opinion p { margin: 0 !important; font-size: 8.5px !important; }
.leave-request-print-root .leave-doc-admin-block { margin-top: 2mm !important; padding-top: 1.5mm !important; }
.leave-request-print-root .leave-doc-admin-options { gap: 4px !important; margin: .5mm 0 1mm !important; }
.leave-request-print-root .leave-doc-admin-footer { gap: 8mm !important; margin-top: 2mm !important; font-size: 8px !important; }
.leave-request-print-root .leave-doc-admin-footer span { min-height: 5mm !important; padding-top: 1px !important; }
.leave-request-print-root .leave-doc-copy-note { margin-top: 2mm !important; font-size: 6.5px !important; }
`;

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
  clone.querySelectorAll(".leave-doc-word-export").forEach((node) => node.remove());
  printDoc.open();
  printDoc.write(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><base href="${document.baseURI}">${currentStyleNodes()}<style>${ISOLATED_PRINT_CSS}</style></head><body>${clone.outerHTML}</body></html>`);
  printDoc.close();

  await waitForImages(printDoc);
  if ("fonts" in printDoc) {
    try { await printDoc.fonts.ready; } catch { /* continue with available fonts */ }
  }

  const printable = printDoc.querySelector<HTMLElement>(".leave-request-print-root");
  if (printable) {
    const a4ContentHeightPx = (287 / 25.4) * 96;
    const renderedHeight = printable.scrollHeight;
    if (renderedHeight > a4ContentHeightPx) {
      const scale = Math.max(0.72, Math.min(1, a4ContentHeightPx / renderedHeight));
      printable.style.setProperty("zoom", String(scale));
    }
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

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("تعذر قراءة الصورة."));
    reader.readAsDataURL(blob);
  });
}

async function inlineImages(root: HTMLElement) {
  const images = Array.from(root.querySelectorAll<HTMLImageElement>("img"));
  await Promise.all(images.map(async (image) => {
    const src = image.src || image.getAttribute("src") || "";
    if (!src || src.startsWith("data:")) return;
    try {
      const response = await fetch(src);
      if (!response.ok) return;
      image.src = await blobToDataUrl(await response.blob());
    } catch {
      try { image.src = new URL(src, document.baseURI).href; } catch { /* keep original */ }
    }
  }));
}

const WORD_DOCUMENT_CSS = `
@page Section1 { size: 595.3pt 841.9pt; margin: 22pt 26pt 22pt 26pt; }
div.Section1 { page: Section1; }
body { direction: rtl; font-family: Tahoma, Arial, sans-serif; color: #111; font-size: 9pt; line-height: 1.35; }
.leave-request-print-root { width: 100%; border: 1pt solid #111; padding: 14pt 18pt; box-sizing: border-box; }
.leave-doc-word-export { display: none; }
.leave-doc-header { width: 100%; border-bottom: 1pt solid #222; padding-bottom: 7pt; margin-bottom: 8pt; }
.leave-doc-header h2 { text-align: center; margin: 0; font-size: 16pt; }
.leave-doc-brand img { width: 95pt; height: auto; filter: grayscale(100%); }
.leave-doc-number { margin: 4pt 0; font-size: 8pt; }
.leave-doc-type-row { width: 100%; margin: 5pt 0 8pt; text-align: center; }
.leave-doc-checkbox { display: inline-block; width: 31%; text-align: center; border: 0; background: transparent; }
.leave-doc-checkbox > span { display: inline-block; width: 12pt; height: 12pt; border: 1pt solid #222; text-align: center; line-height: 11pt; margin-left: 4pt; }
.leave-doc-letter { margin: 6pt 0; }
.leave-doc-letter p { margin: 2pt 0; }
.leave-doc-addressee { font-weight: 700; }
.leave-doc-fields-grid, .leave-doc-signature-row { width: 100%; }
.leave-doc-static-field, .leave-doc-signature-row > div { display: inline-block; vertical-align: top; width: 47%; margin: 3pt 1%; padding-bottom: 3pt; border-bottom: 1pt solid #222; }
.leave-doc-static-field span, .leave-doc-print-text span, .leave-doc-signature-row span { display: block; font-size: 7pt; color: #444; font-weight: 700; }
.leave-doc-print-text { margin: 5pt 0; }
.leave-doc-print-text p { margin: 1pt 0; padding: 3pt 0; border-bottom: 1pt solid #222; min-height: 14pt; white-space: pre-wrap; }
.leave-doc-signature-image { display: block; max-width: 120pt; max-height: 38pt; object-fit: contain; }
.leave-doc-manager-opinion, .leave-doc-admin-block { margin-top: 8pt; padding-top: 6pt; border-top: 1pt solid #222; }
.leave-doc-manager-opinion h3, .leave-doc-admin-block h3 { margin: 0 0 4pt; font-size: 10pt; text-decoration: underline; }
.leave-doc-manager-opinion p { margin: 1pt 0; font-size: 8pt; }
.leave-doc-admin-options { margin: 4pt 0; }
.leave-doc-admin-footer { width: 100%; margin-top: 8pt; text-align: center; }
.leave-doc-admin-footer span { display: inline-block; width: 45%; border-top: 1pt solid #222; padding-top: 3pt; }
.leave-doc-copy-note { margin-top: 7pt; font-size: 6.5pt; color: #666; }
`;

export async function exportLeaveRequestToWord(request: EmployeeRequest) {
  const source = leaveDocumentRoot();
  if (!source) throw new Error("لم يتم العثور على نموذج الإجازة للتصدير.");
  const clone = source.cloneNode(true) as HTMLElement;
  clone.querySelectorAll(".leave-doc-word-export").forEach((node) => node.remove());
  clone.querySelectorAll<HTMLButtonElement>("button.leave-doc-checkbox").forEach((button) => {
    const replacement = document.createElement("span");
    replacement.className = button.className;
    replacement.innerHTML = button.innerHTML;
    button.replaceWith(replacement);
  });
  await inlineImages(clone);

  const employeeName = request.employee_name_snapshot || request.employee_id || "الموظفة";
  const html = `<!doctype html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40" dir="rtl">
<head><meta charset="utf-8"><title>طلب إجازة ${request.request_number}</title><style>${WORD_DOCUMENT_CSS}</style></head>
<body><div class="Section1">${clone.outerHTML}</div></body></html>`;
  const blob = new Blob(["\ufeff", html], { type: "application/msword;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `طلب-اجازة-${sanitizeFilePart(employeeName)}-${sanitizeFilePart(request.request_number)}.doc`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportLeaveRequestToExcel(request: EmployeeRequest) {
  const payload = request.payload || {};
  const decision = decisionData(request);
  const employeeName = request.employee_name_snapshot || request.employee_id || "الموظفة";
  const days = leaveDays(payload.startDate, payload.endDate);
  const statusLabel = EMPLOYEE_REQUEST_STATUS_LABELS[request.status] || request.status;

  const rows: LeaveExcelRow[] = [
    { section: "بيانات الخطاب", field: "الجهة", value: LEAVE_REQUEST_ADDRESSEE },
    { section: "بيانات الخطاب", field: "رقم الطلب", value: request.request_number },
    { section: "بيانات الموظفة", field: "اسم الموظفة", value: employeeName },
    { section: "بيانات الموظفة", field: "رقم الموظفة", value: request.employee_id },
    { section: "بيانات الإجازة", field: "نوع الإجازة", value: leaveTypeLabel(payload.leaveType) },
    { section: "بيانات الإجازة", field: "من تاريخ", value: formatDate(payload.startDate) },
    { section: "بيانات الإجازة", field: "إلى تاريخ", value: formatDate(payload.endDate) },
    { section: "بيانات الإجازة", field: "عدد الأيام", value: days },
    { section: "بيانات الإجازة", field: "سبب الإجازة", value: String(payload.reason || "—") },
    { section: "بيانات الإجازة", field: "ملاحظات الموظفة", value: String(payload.notes || "—") },
    { section: "التوقيع الإلكتروني", field: "تاريخ تقديم الطلب", value: formatDateTime(request.submitted_at) },
    { section: "التوقيع الإلكتروني", field: "توقيع الموظفة", value: `توقيع بخط اليد محفوظ إلكترونيًا - ${formatDateTime(request.submitted_at)}` },
    { section: "رأي المدير الإداري", field: "اسم المسؤول", value: decision.actor },
    { section: "رأي المدير الإداري", field: "القرار", value: decision.decision },
    { section: "رأي المدير الإداري", field: "ملاحظات / القرار", value: decision.note },
    { section: "رأي المدير الإداري", field: "تاريخ القرار", value: decision.date ? formatDateTime(decision.date) : "—" },
    { section: "رأي المدير الإداري", field: "التوقيع الإداري", value: decision.date ? `توقيع بخط اليد محفوظ إلكترونيًا - ${formatDateTime(decision.date)}` : "—" },
    { section: "حالة الطلب", field: "الحالة", value: statusLabel },
  ];

  const report: ExportV2Report<LeaveExcelRow> = {
    slug: `طلب-اجازة-${sanitizeFilePart(employeeName)}`,
    reportCode: request.request_number,
    title: "طلب إجازة",
    subtitle: LEAVE_REQUEST_ADDRESSEE,
    summarySheetName: "نموذج الإجازة",
    detailsSheetName: "بيانات الطلب",
    period: `${formatDate(payload.startDate)} - ${formatDate(payload.endDate)}`,
    generatedAt: new Date().toISOString(),
    generatedBy: employeeName,
    branding: {
      salonName: "ملكات",
      brandName: "Malikat",
    },
    filters: [
      { label: "رقم الطلب", value: request.request_number },
      { label: "الموظفة", value: employeeName },
      { label: "الحالة", value: statusLabel },
    ],
    summary: [
      { label: "رقم الطلب", value: request.request_number, tone: "gold" },
      { label: "الموظفة", value: employeeName, tone: "dark" },
      { label: "نوع الإجازة", value: leaveTypeLabel(payload.leaveType), tone: "neutral" },
      { label: "عدد الأيام", value: days, type: "number", tone: "gold" },
      { label: "القرار", value: decision.decision, tone: decision.decision === "مع الموافقة" ? "success" : decision.decision.includes("مرفوض") ? "danger" : "neutral" },
      { label: "الحالة", value: statusLabel, tone: "neutral" },
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
    ],
    pdfOrientation: "portrait",
  };

  exportReportToExcelV2(report);
}