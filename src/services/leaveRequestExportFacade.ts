import type { EmployeeRequest } from "./employeeRequests";
import { downloadExportV2Blob } from "./exports-v2/download";
import { exportReportToExcelV2 } from "./exports-v2/excel";
import type { ExportV2Report, ExportV2Value } from "./exports-v2/types";
import { DOCUMENT_BRANDING } from "../documents/core/documentBranding";
import { buildLeaveRequestDocumentData, formatDocumentDateTime } from "../documents/leave/leaveRequestModel";
import { leaveRequestStructuredRows } from "../documents/leave/leaveRequestDocumentSpec";
import { printLeaveRequestDocument } from "../documents/leave/leaveRequestPrint";
import { buildLeaveRequestPdfBytes } from "../documents/leave/leaveRequestPdf";
import { buildLeaveRequestDocxBytes } from "../documents/leave/leaveRequestDocxPackage";

export { printLeaveRequestDocument };

type LeaveExcelRow = Record<string, ExportV2Value> & {
  section: string;
  field: string;
  value: string | number;
};

function sanitizeFilePart(value: unknown) {
  return String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80) || "leave-request";
}

function leaveExcelReport(request: EmployeeRequest): ExportV2Report<LeaveExcelRow> {
  const data = buildLeaveRequestDocumentData(request);
  const rows = leaveRequestStructuredRows(data).map(([section, field, value]) => ({
    section,
    field,
    value,
  }));
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
      { label: "القرار", value: data.managerDecisionLabel },
      { label: "الحالة التشغيلية", value: data.statusLabel },
    ],
    summary: [
      { label: "رقم الطلب", value: data.requestNumber, tone: "gold" },
      { label: "الموظفة", value: data.employeeName, tone: "dark" },
      { label: "نوع الإجازة", value: data.leaveTypeLabel, tone: "neutral" },
      { label: "عدد الأيام", value: data.leaveDays, type: "number", tone: "gold" },
      {
        label: "القرار",
        value: data.managerDecisionLabel,
        tone: data.managerDecisionLabel === "مع الموافقة" ? "success" : "neutral",
      },
      { label: "الحالة التشغيلية", value: data.statusLabel, tone: "neutral" },
    ],
    columns: [
      { key: "section", header: "القسم", width: 22 },
      { key: "field", header: "البيان", width: 26 },
      { key: "value", header: "التفاصيل", width: 42 },
    ],
    rows,
    notes: [
      "تم إنشاء Excel من نفس LeaveRequestDocumentData المستخدم في بقية الصيغ.",
      "Excel تمثيل بنيوي منظم للبيانات وليس صورة من تصميم A4.",
      "إعداد الطباعة A4 عمودي وFit-to-page مضبوط عبر Export V2.",
    ],
    pdfOrientation: "portrait",
  };
}

export function exportLeaveRequestToExcel(request: EmployeeRequest) {
  exportReportToExcelV2(leaveExcelReport(request));
}

export async function exportLeaveRequestToPdf(request: EmployeeRequest) {
  const data = buildLeaveRequestDocumentData(request);
  const bytes = await buildLeaveRequestPdfBytes(request);
  downloadExportV2Blob(
    new Blob([bytes], { type: "application/pdf" }),
    `malikat-leave-request-${sanitizeFilePart(data.employeeName)}-${sanitizeFilePart(data.requestNumber)}.pdf`
  );
}

export async function exportLeaveRequestToWord(request: EmployeeRequest) {
  const data = buildLeaveRequestDocumentData(request);
  const bytes = await buildLeaveRequestDocxBytes(request);
  downloadExportV2Blob(
    new Blob([bytes], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
    `malikat-leave-request-${sanitizeFilePart(data.employeeName)}-${sanitizeFilePart(data.requestNumber)}.docx`
  );
}

export function auditLeaveRequestExportSurface(request: EmployeeRequest) {
  const data = buildLeaveRequestDocumentData(request);
  return {
    route: ["/dashboard/requests", "/employee/requests/:requestId"],
    page: ["src/pages/hr/AdminEmployeeRequests.tsx", "src/pages/hr/EmployeeRequests.tsx"],
    component: "src/components/hr/LeaveRequestDocument.tsx",
    css: ["src/documents/core/documentPrint.css", "src/styles/LeaveRequestDocument.css"],
    dataSource: "EmployeeRequest payload/events from src/services/employeeRequests.ts",
    viewModel: "src/documents/leave/leaveRequestModel.ts",
    structure: "src/documents/leave/leaveRequestDocumentSpec.ts",
    branding: "src/documents/core/documentBranding.ts",
    assets: "src/documents/core/documentExportAssets.ts",
    printPath: "leaveRequestPrint -> isolated iframe -> canonical A4 DOM",
    pdfPath: "leaveRequestPdf -> preloaded black logo + watermark -> one A4 PDF page",
    docxPath: "leaveRequestDocxPackage -> real OOXML + black logo + watermark + signatures",
    xlsxPath: "canonical structured rows -> Export V2 XLSX",
    data,
    generatedAt: formatDocumentDateTime(new Date().toISOString()),
  };
}
