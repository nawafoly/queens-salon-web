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

export function printLeaveRequestDocument() {
  window.print();
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
    { section: "التوقيع الإلكتروني", field: "توقيع الموظفة", value: `توقيع إلكتروني - ${formatDateTime(request.submitted_at)}` },
    { section: "رأي المدير الإداري", field: "اسم المسؤول", value: decision.actor },
    { section: "رأي المدير الإداري", field: "القرار", value: decision.decision },
    { section: "رأي المدير الإداري", field: "ملاحظات / القرار", value: decision.note },
    { section: "رأي المدير الإداري", field: "تاريخ القرار", value: decision.date ? formatDateTime(decision.date) : "—" },
    { section: "رأي المدير الإداري", field: "التوقيع الإداري", value: decision.date ? `توقيع إلكتروني - ${formatDateTime(decision.date)}` : "—" },
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
      "التوقيعات المعروضة هي توقيعات إلكترونية مرتبطة بسجل الطلب داخل النظام.",
    ],
    pdfOrientation: "portrait",
  };

  exportReportToExcelV2(report);
}