import type { EmployeeRequest, EmployeeRequestEvent } from "../../services/employeeRequests";
import { EMPLOYEE_REQUEST_STATUS_LABELS } from "../../services/employeeRequests";

export type LeaveRequestDocumentOption = {
  value: string;
  label: string;
  checked: boolean;
};

export type LeaveRequestDocumentField = {
  label: string;
  value: string | number;
};

export type LeaveRequestDocumentSignature = {
  label: string;
  signerName: string;
  role?: string;
  imageDataUrl?: string;
  signedAt?: string;
  fallback: string;
};

export type LeaveRequestDocumentData = {
  title: string;
  requestNumber: string;
  addressee: string;
  employeeName: string;
  employeeId: string;
  leaveTypeLabel: string;
  leaveTypeOptions: LeaveRequestDocumentOption[];
  leaveDays: number;
  fields: LeaveRequestDocumentField[];
  reason: string;
  notes: string;
  submittedAtLabel: string;
  employeeSignature: LeaveRequestDocumentSignature;
  managerName: string;
  managerRole: string;
  managerDecisionLabel: string;
  managerDecisionOptions: LeaveRequestDocumentOption[];
  managerDecisionNote: string;
  managerDecidedAtLabel: string;
  managerSignature: LeaveRequestDocumentSignature;
  statusLabel: string;
  periodLabel: string;
};

export const LEAVE_REQUEST_ADDRESSEE = "السادة / مؤسسة صالون أحمد العليان (ملكات)";

export const LEAVE_TYPE_OPTIONS = [
  { value: "annual", label: "إجازة اعتيادية" },
  { value: "emergency", label: "إجازة اضطرارية" },
  { value: "unpaid", label: "إجازة استثنائية بدون مرتب" },
  { value: "sick", label: "إجازة مرضية" },
] as const;

const DASH = "—";

export function safeDocumentText(value: unknown, fallback = DASH) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

export function leaveTypeLabel(value: unknown) {
  const normalized = String(value || "");
  return LEAVE_TYPE_OPTIONS.find((item) => item.value === normalized)?.label || safeDocumentText(normalized);
}

export function leaveDays(start: unknown, end: unknown) {
  const from = String(start || "");
  const to = String(end || "");
  const fromMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(from);
  const toMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(to);
  if (!fromMatch || !toMatch) return 0;

  const startUtc = Date.UTC(Number(fromMatch[1]), Number(fromMatch[2]) - 1, Number(fromMatch[3]));
  const endUtc = Date.UTC(Number(toMatch[1]), Number(toMatch[2]) - 1, Number(toMatch[3]));
  const diff = Math.floor((endUtc - startUtc) / 86400000);
  return diff >= 0 ? diff + 1 : 0;
}

export function formatDocumentDate(value: unknown, language: "ar" | "en" = "ar") {
  const text = String(value || "");
  if (!text) return DASH;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00`) : new Date(text);
  if (!Number.isFinite(date.getTime())) return text;
  return new Intl.DateTimeFormat(language === "en" ? "en-SA-u-ca-gregory" : "ar-SA-u-ca-gregory-nu-latn", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatDocumentDateTime(value: unknown, language: "ar" | "en" = "ar") {
  const text = String(value || "");
  if (!text) return DASH;
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) return text;
  return new Intl.DateTimeFormat(language === "en" ? "en-SA-u-ca-gregory" : "ar-SA-u-ca-gregory-nu-latn", {
    timeZone: "Asia/Riyadh",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function todayDocumentDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function parseEventPayload(event?: EmployeeRequestEvent | null) {
  if (!event?.payload_json) return {} as Record<string, unknown>;
  try {
    const parsed = JSON.parse(event.payload_json);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function administrativeRoleLabel(role: unknown) {
  const normalized = String(role || "").toLowerCase();
  if (normalized === "owner") return "مالك الصالون";
  if (normalized === "admin") return "الإدارة";
  if (normalized === "hr") return "الموارد البشرية";
  if (normalized === "accountant") return "المحاسبة";
  return safeDocumentText(normalized, "المراجع");
}

function decisionInfo(request: EmployeeRequest) {
  const decisionEvent = [...(request.events || [])]
    .reverse()
    .find((event) => ["approve", "approved", "reject", "rejected"].includes(String(event.event_type || "").toLowerCase()));
  const approved = ["approved", "executing", "completed"].includes(request.status) ||
    ["approve", "approved"].includes(String(decisionEvent?.event_type || "").toLowerCase());
  const rejected = request.status === "rejected" ||
    ["reject", "rejected"].includes(String(decisionEvent?.event_type || "").toLowerCase());
  const payload = parseEventPayload(decisionEvent);
  const decidedAt = decisionEvent?.created_at || request.approved_at || request.rejected_at || "";
  return {
    approved,
    rejected,
    actorName: safeDocumentText(decisionEvent?.actor_name || request.assigned_to_name, "لم يحدد بعد"),
    actorRole: administrativeRoleLabel(decisionEvent?.actor_role),
    note: safeDocumentText(request.rejection_reason || request.decision_note || decisionEvent?.note),
    decidedAt,
    signatureDataUrl: String(payload.reviewerSignatureDataUrl || ""),
  };
}

export function buildLeaveRequestDocumentData(request: EmployeeRequest, language: "ar" | "en" = "ar"): LeaveRequestDocumentData {
  const payload = request.payload || {};
  const startDate = payload.startDate;
  const endDate = payload.endDate;
  const days = leaveDays(startDate, endDate);
  const decision = decisionInfo(request);
  const employeeName = safeDocumentText(request.employee_name_snapshot || request.employee_id, "الموظفة");
  const statusLabel = EMPLOYEE_REQUEST_STATUS_LABELS[request.status] || request.status;
  const selectedLeaveType = String(payload.leaveType || "");
  const submittedAtLabel = formatDocumentDateTime(request.submitted_at, language);
  const managerDecidedAtLabel = decision.decidedAt ? formatDocumentDateTime(decision.decidedAt, language) : DASH;

  return {
    title: "طلب إجازة",
    requestNumber: safeDocumentText(request.request_number),
    addressee: LEAVE_REQUEST_ADDRESSEE,
    employeeName,
    employeeId: safeDocumentText(request.employee_id),
    leaveTypeLabel: leaveTypeLabel(selectedLeaveType),
    leaveTypeOptions: LEAVE_TYPE_OPTIONS.map((item) => ({
      ...item,
      checked: item.value === selectedLeaveType,
    })),
    leaveDays: days,
    fields: [
      { label: "من تاريخ", value: formatDocumentDate(startDate, language) },
      { label: "إلى تاريخ", value: formatDocumentDate(endDate, language) },
      { label: "عدد الأيام", value: days || DASH },
      { label: "تاريخ الطلب", value: formatDocumentDate(request.submitted_at, language) },
    ],
    reason: safeDocumentText(payload.reason),
    notes: safeDocumentText(payload.notes),
    submittedAtLabel,
    employeeSignature: {
      label: "توقيع الموظفة",
      signerName: employeeName,
      imageDataUrl: String(payload.employeeSignatureDataUrl || ""),
      signedAt: submittedAtLabel,
      fallback: "غير موقع",
    },
    managerName: decision.actorName,
    managerRole: decision.actorRole,
    managerDecisionLabel: decision.approved ? "مع الموافقة" : decision.rejected ? "أخرى / مرفوض" : "قيد المراجعة",
    managerDecisionOptions: [
      { value: "approved", label: "مع الموافقة", checked: decision.approved },
      { value: "other", label: "أخرى", checked: decision.rejected },
    ],
    managerDecisionNote: decision.note,
    managerDecidedAtLabel,
    managerSignature: {
      label: "توقيع المراجع / المسؤول",
      signerName: decision.actorName,
      role: decision.actorRole,
      imageDataUrl: decision.signatureDataUrl,
      signedAt: decision.decidedAt ? managerDecidedAtLabel : "",
      fallback: decision.decidedAt ? "التوقيع غير محفوظ" : DASH,
    },
    statusLabel,
    periodLabel: `${formatDocumentDate(startDate, language)} - ${formatDocumentDate(endDate, language)}`,
  };
}
