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
