import * as XLSX from "xlsx";
import type { EmployeeRequest } from "./employeeRequests";
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
    decision: approved ? "موافقة" : rejected ? "رفض / أخرى" : "قيد المراجعة",
    actor: event?.actor_name || request.assigned_to_name || "",
    note: request.rejection_reason || request.decision_note || event?.note || "",
    date: event?.created_at || request.approved_at || request.rejected_at || "",
  };
}

export function printLeaveRequestDocument() {
  window.print();
}

export function exportLeaveRequestToExcel(request: EmployeeRequest) {
  const payload = request.payload || {};
  const decision = decisionData(request);
  const employeeName = request.employee_name_snapshot || request.employee_id || "الموظفة";
  const days = leaveDays(payload.startDate, payload.endDate);

  const rows: Array<[string, string | number]> = [
    ["طلب إجازة", ""],
    ["الجهة", LEAVE_REQUEST_ADDRESSEE],
    ["رقم الطلب", request.request_number],
    ["اسم الموظفة", employeeName],
    ["رقم الموظفة", request.employee_id],
    ["نوع الإجازة", leaveTypeLabel(payload.leaveType)],
    ["من تاريخ", formatDate(payload.startDate)],
    ["إلى تاريخ", formatDate(payload.endDate)],
    ["عدد الأيام", days],
    ["سبب الإجازة", String(payload.reason || "")],
    ["ملاحظات الموظفة", String(payload.notes || "")],
    ["تاريخ تقديم الطلب", formatDateTime(request.submitted_at)],
    ["توقيع الموظفة", `توقيع إلكتروني - ${formatDateTime(request.submitted_at)}`],
    ["", ""],
    ["رأي المدير الإداري", ""],
    ["اسم المسؤول", decision.actor],
    ["القرار", decision.decision],
    ["ملاحظات القرار", decision.note],
    ["تاريخ القرار", formatDateTime(decision.date)],
    ["التوقيع الإداري", decision.date ? `توقيع إلكتروني - ${formatDateTime(decision.date)}` : ""],
    ["حالة الطلب", request.status],
  ];

  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet["!cols"] = [{ wch: 24 }, { wch: 62 }];
  worksheet["!merges"] = [
    XLSX.utils.decode_range("A1:B1"),
    XLSX.utils.decode_range("A15:B15"),
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "طلب إجازة");

  const requestDate = String(payload.startDate || request.submitted_at || "").slice(0, 10);
  const fileName = `طلب-اجازة-${sanitizeFilePart(employeeName)}-${sanitizeFilePart(requestDate)}.xlsx`;
  XLSX.writeFile(workbook, fileName, { compression: true });
}
