import type { EmployeeRequest } from "../../services/employeeRequests";
import { exportReportToExcelV2 } from "../../services/exports-v2/excel";
import type { ExportV2Report, ExportV2Value } from "../../services/exports-v2/types";
import { DOCUMENT_BRANDING } from "../core/documentBranding";
import { buildLeaveRequestDocumentData } from "./leaveRequestModel";
import { leaveRequestStructuredRows } from "./leaveRequestDocumentSpec";

type LeaveExcelRow = Record<string, ExportV2Value> & {
  section: string;
  field: string;
  value: string | number;
};
