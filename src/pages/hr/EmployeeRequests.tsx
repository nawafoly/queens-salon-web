import { DashboardSelectBridgeV2 } from "../../components/dashboard-v2/DashboardNativeControlBridgeV2";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRight,
  faCalendarDays,
  faCheckCircle,
  faClockRotateLeft,
  faCommentDots,
  faFileCircleCheck,
  faFilter,
  faPaperPlane,
  faPlus,
  faRotate,
  faTriangleExclamation,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { HrSession } from "./shared";
import LeaveRequestDocument, { LeaveRequestFormFields } from "../../components/hr/LeaveRequestDocument";
import ExceptionalFinancialPaymentRequestDocument, { ExceptionalFinancialPaymentRequestFormFields } from "../../components/hr/ExceptionalFinancialPaymentRequestDocument";
import SalaryCertificateDocument from "../../components/hr/SalaryCertificateDocument";
import {
  addEmployeeRequestAttachment,
  addEmployeeRequestComment,
  createEmployeeRequest,
  employeeRequestAction,
  employeeRequestEventLabel,
  employeeRequestErrorMessage,
  employeeRequestExecutionErrorLabel,
  EMPLOYEE_REQUEST_EXECUTION_LABELS,
  EMPLOYEE_REQUEST_STATUS_LABELS,
  EMPLOYEE_REQUEST_TYPE_LABELS,
  getEmployeeRequest,
  getExceptionalFinancialPaymentPreview,
  listMyEmployeeRequests,
  type ExceptionalFinancialPaymentPreview,
  type EmployeeRequest,
  type EmployeeRequestStatus,
  type EmployeeRequestType,
} from "../../services/employeeRequests";
import { CoreFilesService } from "../../services/CoreFilesService";
import { useEmployeePortalLanguage, type EmployeePortalLanguage } from "../../features/employee-portal/EmployeePortalLanguage";
import "../../styles/EmployeeRequests.css";

type Props = { session: HrSession; onPortalChange?: () => void | Promise<void> };
type FormState = Record<string, string | boolean>;

const REQUEST_TYPES: EmployeeRequestType[] = (Object.keys(EMPLOYEE_REQUEST_TYPE_LABELS) as EmployeeRequestType[])
  .filter((type) => type !== "exceptional_financial_payment");
const STATUS_OPTIONS = Object.keys(EMPLOYEE_REQUEST_STATUS_LABELS) as EmployeeRequestStatus[];

const REQUEST_TYPE_LABELS_EN: Record<EmployeeRequestType, string> = {
  attendance_correction: "Attendance correction",
  permission: "Permission request",
  overtime: "Overtime request",
  salary_advance: "Salary advance",
  salary_certificate: "Salary certificate",
  exceptional_financial_payment: "Leave cash compensation",
  leave: "Leave request",
  exit_return: "Exit and return request",
  resignation: "Resignation request",
};

const REQUEST_STATUS_LABELS_EN: Record<EmployeeRequestStatus, string> = {
  submitted: "Submitted", received: "Received", under_review: "Under review", needs_info: "Information required",
  approved: "Approved", rejected: "Rejected", executing: "In progress", completed: "Completed", cancelled: "Closed",
};

const EXECUTION_LABELS_EN: Record<string, string> = {
  not_started: "Not started", running: "In progress", waiting: "Awaiting completion", completed: "Completed", failed: "Failed", cancelled: "Stopped",
};

const EVENT_LABELS_EN: Record<string, string> = {
  submitted: "Request submitted", assigned: "Owner assigned", receive: "Request received", received: "Request received",
  start_review: "Review started", under_review: "Request under review", request_info: "Additional information requested",
  answer_info: "Employee response received", approve: "Approved", approved: "Approved", reject: "Rejected", rejected: "Rejected",
  cancel: "Request closed", cancelled: "Request closed", reopen: "Request reopened", execution_started: "Execution started",
  execution_retried: "Execution retried", execution_waiting: "Execution awaiting a later step", execution_completed: "Execution completed",
  execution_failed: "Execution failed", execution_reversed: "Execution reversed", actual_exit_recorded: "Actual exit recorded",
  actual_return_recorded: "Actual return recorded", comment_added: "Message added", internal_note_added: "Internal note added",
};

function pick(language: EmployeePortalLanguage, ar: string, en: string) {
  return language === "ar" ? ar : en;
}

function requestTypeLabel(type: EmployeeRequestType, language: EmployeePortalLanguage) {
  return language === "ar" ? EMPLOYEE_REQUEST_TYPE_LABELS[type] : REQUEST_TYPE_LABELS_EN[type];
}

function requestStatusLabel(status: EmployeeRequestStatus, language: EmployeePortalLanguage) {
  return language === "ar" ? EMPLOYEE_REQUEST_STATUS_LABELS[status] : REQUEST_STATUS_LABELS_EN[status];
}

function requestEventLabel(eventType: unknown, language: EmployeePortalLanguage) {
  if (language === "ar") return employeeRequestEventLabel(eventType);
  const key = String(eventType || "").trim().toLowerCase().replaceAll("-", "_");
  return EVENT_LABELS_EN[key] || key.replaceAll("_", " ") || "Request updated";
}

function todayDateKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function localDateTimeValue(offsetHours = 0) {
  const date = new Date(Date.now() + offsetHours * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
}

function initialForm(type: EmployeeRequestType): FormState {
  const today = todayDateKey();
  const common = { reason: "", notes: "" };
  if (type === "attendance_correction") return { ...common, date: today, correctionType: "add_check_in", currentTime: "", requestedTime: "09:00", recordId: "" };
  if (type === "permission") return { ...common, date: today, startTime: "12:00", endTime: "13:00" };
  if (type === "overtime") return { ...common, date: today, startTime: "", endTime: "", taskSummary: "", location: "", requestedByManager: "" };
  if (type === "salary_advance") return { ...common, amount: "", neededDate: today, repaymentMethod: "single", installmentCount: "1", acknowledgement: false };
  if (type === "salary_certificate") return { ...common, addressee: "" };
  if (type === "exceptional_financial_payment") return { ...common, requestedDays: "", acknowledgement: false, employeeSignatureDataUrl: "" };
  if (type === "leave") return { ...common, leaveType: "annual", startDate: "", endDate: "", durationKind: "full_day", partialStartTime: "09:00", partialEndTime: "13:00", contactDuringLeave: "", employeeSignatureDataUrl: "" };
  if (type === "exit_return") return { ...common, expectedExitAt: localDateTimeValue(1), expectedReturnAt: localDateTimeValue(3), destination: "", contactMethod: "" };
  return { ...common, submissionDate: today, proposedLastWorkingDay: today, noticeDays: "30", hasAssetsToReturn: false, acknowledgement: false };
}

function formatDateTime(value: string | null | undefined, language: EmployeePortalLanguage) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) return String(value || "—");
  return new Intl.DateTimeFormat(language === "ar" ? "ar-SA-u-nu-latn" : "en-SA", {
    timeZone: "Asia/Riyadh",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(parsed));
}

function statusTone(status: EmployeeRequestStatus) {
  if (status === "completed" || status === "approved") return "success";
  if (status === "rejected" || status === "cancelled") return "danger";
  if (status === "needs_info") return "warning";
  if (status === "executing" || status === "under_review") return "active";
  return "neutral";
}

function readablePayload(payload: Record<string, unknown>) {
  const hidden = new Set(["acknowledgement", "employeeSignatureDataUrl", "salarySnapshotCapturedAt"]);
  return Object.entries(payload || {}).filter(([key, value]) => !hidden.has(key) && value !== "" && value !== null && value !== undefined);
}

function formatPayloadValue(key: string, value: unknown, language: EmployeePortalLanguage) {
  if (key.endsWith("Halalas")) return `${(Number(value || 0) / 100).toLocaleString(language === "ar" ? "ar-SA-u-nu-latn" : "en-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${pick(language, "ريال", "SAR")}`;
  if (typeof value === "boolean") return value ? pick(language, "نعم", "Yes") : pick(language, "لا", "No");
  if (key === "leaveBalanceTreatment") return value === "not_deducted" ? pick(language, "لا يتم الخصم", "Not deducted") : String(value);
  if (key === "payrollTreatment") return value === "manual_addition" ? pick(language, "إضافة مالية في مسير الراتب", "Manual payroll addition") : String(value);
  if (key === "calculationBasis") return value === "base_salary_divided_by_30" ? pick(language, "الراتب الأساسي ÷ 30 × عدد الأيام", "Base salary ÷ 30 × number of days") : String(value);
  return String(value);
}

const FIELD_LABELS: Record<string, string> = {
  date: "التاريخ",
  correctionType: "نوع التصحيح",
  currentTime: "الوقت الحالي",
  requestedTime: "الوقت المطلوب",
  recordId: "معرف السجل",
  startTime: "وقت البداية/الخروج",
  endTime: "وقت النهاية/العودة",
  taskSummary: "المهمة المنفذة",
  location: "الفرع أو الموقع",
  requestedByManager: "المدير الذي طلب العمل",
  amount: "المبلغ المطلوب",
  amountHalalas: "المبلغ بالهللات",
  requestedDays: "عدد الأيام المرجعية",
  addressee: "الجهة الموجه إليها التعريف",
  employeeNameSnapshot: "اسم الموظفة وقت الطلب",
  jobTitleSnapshot: "المسمى الوظيفي وقت الطلب",
  departmentSnapshot: "القسم وقت الطلب",
  employmentStartDateSnapshot: "تاريخ الالتحاق",
  baseSalaryHalalas: "الراتب الأساسي وقت الطلب",
  housingAllowanceHalalas: "بدل السكن",
  transportationAllowanceHalalas: "بدل النقل",
  otherAllowancesHalalas: "بدلات أخرى",
  allowancesHalalas: "إجمالي البدلات",
  totalSalaryHalalas: "إجمالي الراتب الشهري",
  dayRateHalalas: "قيمة اليوم",
  calculatedAmountHalalas: "إجمالي الصرف",
  annualLeaveBalanceSnapshot: "الرصيد السنوي وقت الطلب",
  balanceDeductionDays: "الأيام المخصومة من الرصيد",
  calculationBasis: "أساس الحساب",
  payrollTreatment: "المعالجة في الرواتب",
  leaveBalanceTreatment: "معالجة رصيد الإجازة",
  legalTreatment: "نوع المعالجة",
  neededDate: "تاريخ الحاجة",
  repaymentMethod: "طريقة الاستقطاع",
  installmentCount: "عدد الأقساط",
  leaveType: "نوع الإجازة",
  startDate: "بداية الإجازة",
  endDate: "نهاية الإجازة",
  durationKind: "مدة الإجازة",
  partialStartTime: "بداية الاستئذان",
  partialEndTime: "نهاية الاستئذان",
  contactDuringLeave: "التواصل أثناء الإجازة",
  expectedExitAt: "الخروج المتوقع",
  expectedReturnAt: "العودة المتوقعة",
  destination: "الوجهة",
  contactMethod: "وسيلة التواصل",
  submissionDate: "تاريخ تقديم الاستقالة",
  proposedLastWorkingDay: "آخر يوم عمل مقترح",
  noticeDays: "مدة الإشعار",
  hasAssetsToReturn: "يوجد عهد للتسليم",
  reason: "السبب",
  notes: "ملاحظات",
};

const FIELD_LABELS_EN: Record<string, string> = {
  date: "Date", correctionType: "Correction type", currentTime: "Current time", requestedTime: "Requested time", recordId: "Record ID",
  startTime: "Start/exit time", endTime: "End/return time", taskSummary: "Completed task", location: "Branch or location",
  requestedByManager: "Requesting manager", amount: "Requested amount", amountHalalas: "Amount in halalas", requestedDays: "Reference days",
  addressee: "Certificate addressee", employeeNameSnapshot: "Employee name at submission", jobTitleSnapshot: "Job title at submission",
  departmentSnapshot: "Department at submission", employmentStartDateSnapshot: "Employment start date", baseSalaryHalalas: "Base salary at submission",
  housingAllowanceHalalas: "Housing allowance", transportationAllowanceHalalas: "Transportation allowance", otherAllowancesHalalas: "Other allowances",
  allowancesHalalas: "Total allowances", totalSalaryHalalas: "Total monthly salary", dayRateHalalas: "Daily rate", calculatedAmountHalalas: "Total payment",
  annualLeaveBalanceSnapshot: "Annual leave balance at submission", balanceDeductionDays: "Days deducted from balance", calculationBasis: "Calculation basis",
  payrollTreatment: "Payroll treatment", leaveBalanceTreatment: "Leave balance treatment", legalTreatment: "Treatment type", neededDate: "Needed date",
  repaymentMethod: "Repayment method", installmentCount: "Installments", leaveType: "Leave type", startDate: "Leave start", endDate: "Leave end",
  durationKind: "Leave duration", partialStartTime: "Permission start", partialEndTime: "Permission end", contactDuringLeave: "Contact during leave",
  expectedExitAt: "Expected exit", expectedReturnAt: "Expected return", destination: "Destination", contactMethod: "Contact method",
  submissionDate: "Resignation submission date", proposedLastWorkingDay: "Proposed last working day", noticeDays: "Notice period",
  hasAssetsToReturn: "Assets to return", reason: "Reason", notes: "Notes",
};

function TextField({ label, name, value, onChange, type = "text", required = false, min, max }: {
  label: string; name: string; value: string; onChange: (name: string, value: string) => void;
  type?: string; required?: boolean; min?: string; max?: string;
}) {
  return (
    <label className="employee-request-field">
      <span>{label}{required ? " *" : ""}</span>
      <input name={name} type={type} value={value} required={required} min={min} max={max} onChange={(event) => onChange(name, event.target.value)} />
    </label>
  );
}

function SelectField({ label, name, value, onChange, options }: {
  label: string; name: string; value: string; onChange: (name: string, value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="employee-request-field">
      <span>{label}</span>
      <DashboardSelectBridgeV2 name={name} value={value} onChange={(event) => onChange(name, event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </DashboardSelectBridgeV2>
    </label>
  );
}

function RequestForm({ type, employeeId, employeeName, language, onCreated, onClose }: {
  type: EmployeeRequestType;
  employeeId: string;
  employeeName: string;
  language: EmployeePortalLanguage;
  onCreated: (request: EmployeeRequest) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => initialForm(type));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);
  const [financialPreview, setFinancialPreview] =
    useState<ExceptionalFinancialPaymentPreview | null>(null);
  const [financialPreviewLoading, setFinancialPreviewLoading] =
    useState(false);

  useEffect(() => { setForm(initialForm(type)); setAttachment(null); }, [type]);

  useEffect(() => {
    if (type !== "exceptional_financial_payment") {
      setFinancialPreview(null);
      setFinancialPreviewLoading(false);
      return;
    }

    const days = Number(form.requestedDays || 0);

    if (
      !Number.isFinite(days) ||
      days < 0.5 ||
      days > 60 ||
      Math.round(days * 2) !== days * 2
    ) {
      setFinancialPreview(null);
      setFinancialPreviewLoading(false);
      return;
    }

    let cancelled = false;

    setFinancialPreviewLoading(true);

    const timer = window.setTimeout(() => {
      getExceptionalFinancialPaymentPreview(days)
        .then((preview) => {
          if (!cancelled) {
            setFinancialPreview(preview);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setFinancialPreview(null);
          }
        })
        .finally(() => {
          if (!cancelled) {
            setFinancialPreviewLoading(false);
          }
        });
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [type, form.requestedDays]);
  const update = (name: string, value: string | boolean) => setForm((current) => ({ ...current, [name]: value }));
  const leaveSignatureMissing = type === "leave" && !String(form.employeeSignatureDataUrl || "").startsWith("data:image/");
  const financialSignatureMissing = type === "exceptional_financial_payment" && !String(form.employeeSignatureDataUrl || "").startsWith("data:image/");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (type === "leave") {
        const startDate = String(form.startDate || "");
        const endDate = String(form.endDate || "");
        if (!startDate || !endDate) throw new Error(pick(language, "حدد تاريخ بداية الإجازة وآخر يوم إجازة قبل الإرسال.", "Select the first and last day of leave before submitting."));
        if (endDate < startDate) throw new Error(pick(language, "آخر يوم إجازة لا يمكن أن يسبق تاريخ بداية الإجازة.", "The leave end date cannot be before the start date."));
        if (leaveSignatureMissing) throw new Error(pick(language, "يجب توقيع طلب الإجازة بخط اليد قبل الإرسال.", "A handwritten signature is required before submitting the leave request."));
      }
      if (type === "salary_certificate" && !String(form.addressee || "").trim()) {
        throw new Error(pick(language, "اكتب الجهة الموجه إليها تعريف الراتب.", "Enter the addressee for the salary certificate."));
      }
      if (type === "exceptional_financial_payment") {
        const days = Number(form.requestedDays);
        if (!Number.isFinite(days) || days < 0.5 || days > 60 || Math.round(days * 2) !== days * 2) throw new Error(pick(language, "حدد عدد أيام الإجازة المطلوب تعويضها من 0.5 إلى 60 وبزيادات نصف يوم.", "Enter 0.5 to 60 leave days in half-day increments."));
        if (!form.acknowledgement) throw new Error(pick(language, "يجب الموافقة على الإقرار قبل إرسال الطلب.", "You must accept the acknowledgement before submitting."));
        if (financialSignatureMissing) throw new Error(pick(language, "يجب توقيع طلب الصرف المالي بخط اليد قبل الإرسال.", "A handwritten signature is required before submitting the payment request."));
      }
      if (attachment && attachment.size > 10 * 1024 * 1024) throw new Error(pick(language, "حجم المرفق يتجاوز 10 ميجابايت.", "The attachment exceeds 10 MB."));
      const request = await createEmployeeRequest({ requestType: type, payload: form });
      if (attachment) {
        try {
          const safeName = attachment.name.replace(/[^A-Za-z0-9._-]+/g, "-") || "attachment";
          const metadata = await CoreFilesService.createMetadata({
            employeeId,
            category: "employee_request",
            title: request.request_number,
            description: request.title,
            fileName: attachment.name,
            contentType: attachment.type || "application/octet-stream",
            sizeBytes: attachment.size,
            status: "active",
            visibility: "private",
            storageKey: `employee-requests/${request.id}/${Date.now()}-${safeName}`,
          });
          await CoreFilesService.upload(metadata.id, attachment);
          await addEmployeeRequestAttachment(request.id, {
            fileName: attachment.name,
            fileType: attachment.type || "application/octet-stream",
            fileSize: attachment.size,
            fileMetadataId: metadata.id,
            storageKey: metadata.storageKey,
          });
        } catch (uploadError) {
          window.alert(`${pick(language, "تم إنشاء الطلب", "Request created")} ${request.request_number}, ${pick(language, "لكن تعذر رفع المرفق", "but the attachment could not be uploaded")}: ${language === "ar" ? String((uploadError as Error)?.message || "خطأ غير معروف") : "Unknown error"}`);
        }
      }
      onCreated(request);
    } catch (cause) {
      setError(language === "ar" ? employeeRequestErrorMessage(cause, String((cause as Error)?.message || "تعذر إرسال الطلب.")) : "Could not submit the request.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="employee-request-modal" role="dialog" aria-modal="true">
      <div className="employee-request-modal__panel">
        <header>
          <div>
            <small>{pick(language, "إنشاء طلب جديد", "Create a new request")}</small>
            <h2>{requestTypeLabel(type, language)}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={pick(language, "إغلاق", "Close")}><FontAwesomeIcon icon={faXmark} /></button>
        </header>
        <form onSubmit={submit}>
          {type === "leave" ? (
            <div className="leave-request-form-shell">
              <LeaveRequestFormFields employeeName={employeeName} form={form} update={update} language={language} />
            </div>
          ) : type === "exceptional_financial_payment" ? (
            <div className="leave-request-form-shell">
              <ExceptionalFinancialPaymentRequestFormFields
                employeeName={employeeName}
                form={form}
                update={update}
                preview={financialPreview}
                previewLoading={financialPreviewLoading}
                language={language}
              />
            </div>
          ) : (
            <>
              <div className="employee-request-form-grid">
                {type === "attendance_correction" ? <>
                  <TextField label={pick(language, "التاريخ", "Date")} name="date" type="date" required value={String(form.date)} onChange={update} />
                  <SelectField label={pick(language, "نوع التصحيح", "Correction type")} name="correctionType" value={String(form.correctionType)} onChange={update} options={[
                    { value: "add_check_in", label: pick(language, "إضافة حضور", "Add clock-in") }, { value: "add_check_out", label: pick(language, "إضافة انصراف", "Add clock-out") },
                    { value: "update_check_in", label: pick(language, "تعديل حضور", "Edit clock-in") }, { value: "update_check_out", label: pick(language, "تعديل انصراف", "Edit clock-out") },
                    { value: "delete_record", label: pick(language, "إلغاء بصمة خاطئة مع حفظ السجل", "Cancel an incorrect record while retaining its history") },
                  ]} />
                  <TextField label={form.correctionType === "delete_record" || String(form.correctionType).startsWith("update_") ? pick(language, "وقت البصمة الحالية (أو استخدم معرف السجل)", "Current attendance time (or use record ID)") : pick(language, "الوقت الحالي إن وجد", "Current time, if available")} name="currentTime" type="time" value={String(form.currentTime)} onChange={update} />
                  {form.correctionType !== "delete_record" ? <TextField label={pick(language, "الوقت المطلوب", "Requested time")} name="requestedTime" type="time" required value={String(form.requestedTime)} onChange={update} /> : null}
                  <TextField label={form.correctionType === "delete_record" || String(form.correctionType).startsWith("update_") ? pick(language, "معرف السجل (بديل عن وقت البصمة الحالية)", "Record ID (instead of current time)") : pick(language, "معرف السجل إن وجد", "Record ID, if available")} name="recordId" value={String(form.recordId)} onChange={update} />
                </> : null}
                {type === "permission" ? <>
                  <TextField label={pick(language, "تاريخ الاستئذان", "Permission date")} name="date" type="date" required value={String(form.date)} onChange={update} />
                  <TextField label={pick(language, "وقت الخروج", "Exit time")} name="startTime" type="time" required value={String(form.startTime)} onChange={update} />
                  <TextField label={pick(language, "وقت العودة", "Return time")} name="endTime" type="time" required value={String(form.endTime)} onChange={update} />
                </> : null}
                {type === "overtime" ? <>
                  <TextField label={pick(language, "التاريخ", "Date")} name="date" type="date" required value={String(form.date)} onChange={update} />
                  <TextField label={pick(language, "وقت البداية", "Start time")} name="startTime" type="time" required value={String(form.startTime)} onChange={update} />
                  <TextField label={pick(language, "وقت النهاية", "End time")} name="endTime" type="time" required value={String(form.endTime)} onChange={update} />
                  <TextField label={pick(language, "المهمة المنفذة", "Completed task")} name="taskSummary" required value={String(form.taskSummary)} onChange={update} />
                  <TextField label={pick(language, "الفرع أو الموقع", "Branch or location")} name="location" value={String(form.location)} onChange={update} />
                  <TextField label={pick(language, "المدير الذي طلب العمل", "Requesting manager")} name="requestedByManager" value={String(form.requestedByManager)} onChange={update} />
                </> : null}
                {type === "salary_advance" ? <>
                  <TextField label={pick(language, "المبلغ المطلوب بالريال", "Requested amount (SAR)")} name="amount" type="number" min="1" required value={String(form.amount)} onChange={update} />
                  <TextField label={pick(language, "تاريخ الحاجة", "Needed date")} name="neededDate" type="date" required value={String(form.neededDate)} onChange={update} />
                  <SelectField label={pick(language, "طريقة الاستقطاع", "Repayment method")} name="repaymentMethod" value={String(form.repaymentMethod)} onChange={update} options={[{ value: "single", label: pick(language, "دفعة واحدة", "Single payment") }, { value: "installments", label: pick(language, "أقساط", "Installments") }]} />
                  {form.repaymentMethod === "installments" ? <TextField label={pick(language, "عدد الأقساط", "Number of installments")} name="installmentCount" type="number" min="2" max="24" required value={String(form.installmentCount)} onChange={update} /> : null}
                </> : null}
                {type === "salary_certificate" ? <>
                  <TextField label={pick(language, "الجهة الموجه إليها التعريف", "Certificate addressee")} name="addressee" required value={String(form.addressee)} onChange={update} />
                </> : null}
                {type === "exit_return" ? <>
                  <TextField label={pick(language, "الخروج المتوقع", "Expected exit")} name="expectedExitAt" type="datetime-local" required value={String(form.expectedExitAt)} onChange={update} />
                  <TextField label={pick(language, "العودة المتوقعة", "Expected return")} name="expectedReturnAt" type="datetime-local" required value={String(form.expectedReturnAt)} onChange={update} />
                  <TextField label={pick(language, "الوجهة أو الجهة", "Destination")} name="destination" required value={String(form.destination)} onChange={update} />
                  <TextField label={pick(language, "وسيلة التواصل", "Contact method")} name="contactMethod" required value={String(form.contactMethod)} onChange={update} />
                </> : null}
                {type === "resignation" ? <>
                  <TextField label={pick(language, "تاريخ تقديم الاستقالة", "Resignation submission date")} name="submissionDate" type="date" required value={String(form.submissionDate)} onChange={update} />
                  <TextField label={pick(language, "آخر يوم عمل مقترح", "Proposed last working day")} name="proposedLastWorkingDay" type="date" required min={String(form.submissionDate)} value={String(form.proposedLastWorkingDay)} onChange={update} />
                  <TextField label={pick(language, "مدة الإشعار بالأيام", "Notice period in days")} name="noticeDays" type="number" min="0" max="365" value={String(form.noticeDays)} onChange={update} />
                  <label className="employee-request-check"><input type="checkbox" checked={Boolean(form.hasAssetsToReturn)} onChange={(event) => update("hasAssetsToReturn", event.target.checked)} /><span>{pick(language, "يوجد عهد أو ممتلكات للتسليم", "I have assets or property to return")}</span></label>
                </> : null}
              </div>
              <label className="employee-request-field employee-request-field--wide"><span>{type === "salary_certificate" ? pick(language, "سبب / غرض الطلب *", "Request purpose *") : pick(language, "السبب *", "Reason *")}</span><textarea required value={String(form.reason)} onChange={(event) => update("reason", event.target.value)} /></label>
              <label className="employee-request-field employee-request-field--wide"><span>{pick(language, "ملاحظات إضافية", "Additional notes")}</span><textarea value={String(form.notes)} onChange={(event) => update("notes", event.target.value)} /></label>
            </>
          )}
          <label className="employee-request-field employee-request-field--wide"><span>{pick(language, "مرفق اختياري", "Optional attachment")}</span><input type="file" accept="image/*,.pdf,.doc,.docx" onChange={(event) => setAttachment(event.target.files?.[0] || null)} /><small>{pick(language, "يُحفظ الملف بشكل خاص وآمن، وبحد أقصى 10 ميجابايت.", "The file is stored privately and securely, up to 10 MB.")}</small></label>
          {type === "salary_advance" || type === "resignation" ? <label className="employee-request-check employee-request-check--ack"><input type="checkbox" required checked={Boolean(form.acknowledgement)} onChange={(event) => update("acknowledgement", event.target.checked)} /><span>{pick(language, "أقر بصحة البيانات وأفهم أن الطلب يخضع للمراجعة والاعتماد.", "I confirm the information is correct and understand that the request is subject to review and approval.")}</span></label> : null}
          {type === "leave" && leaveSignatureMissing ? <div className="employee-request-error"><FontAwesomeIcon icon={faTriangleExclamation} /> {pick(language, "التوقيع بخط اليد مطلوب قبل إرسال طلب الإجازة.", "A handwritten signature is required before submitting the leave request.")}</div> : null}
          {type === "exceptional_financial_payment" && financialSignatureMissing ? <div className="employee-request-error"><FontAwesomeIcon icon={faTriangleExclamation} /> {pick(language, "التوقيع بخط اليد مطلوب قبل إرسال طلب الصرف المالي.", "A handwritten signature is required before submitting the payment request.")}</div> : null}
          {error ? <div className="employee-request-error"><FontAwesomeIcon icon={faTriangleExclamation} /> {error}</div> : null}
          <footer><button type="button" className="is-secondary" onClick={onClose}>{pick(language, "إلغاء", "Cancel")}</button><button type="submit" disabled={busy || leaveSignatureMissing || financialSignatureMissing}><FontAwesomeIcon icon={faPaperPlane} /> {busy ? pick(language, "جارٍ الإرسال...", "Submitting...") : pick(language, "إرسال الطلب", "Submit request")}</button></footer>
        </form>
      </div>
    </div>
  );
}

function RequestDetail({ requestId, language, onBack, onChanged }: { requestId: string; language: EmployeePortalLanguage; onBack: () => void; onChanged: () => void }) {
  const [request, setRequest] = useState<EmployeeRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setRequest(await getEmployeeRequest(requestId)); }
    catch (cause) { setError(language === "ar" ? String((cause as Error)?.message || "تعذر تحميل الطلب.") : "Could not load the request."); }
    finally { setLoading(false); }
  }, [language, requestId]);
  useEffect(() => { void load(); }, [load]);

  const submitComment = async () => {
    if (!request || !comment.trim() || busy) return;
    setBusy(true); setError("");
    try {
      await addEmployeeRequestComment(request.id, comment.trim());
      if (request.status === "needs_info") await employeeRequestAction(request.id, "answer-info", { version: request.version, note: comment.trim() });
      setComment(""); await load(); onChanged();
    } catch (cause) { setError(language === "ar" ? String((cause as Error)?.message || "تعذر إرسال الرد.") : "Could not send the reply."); }
    finally { setBusy(false); }
  };

  const downloadAttachment = async (fileMetadataId: string, fileName: string) => {
    if (!fileMetadataId || busy) return;
    setBusy(true); setError("");
    try {
      const blob = await CoreFilesService.download(fileMetadataId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = fileName || "attachment";
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      URL.revokeObjectURL(url);
    } catch (cause) { setError(language === "ar" ? String((cause as Error)?.message || "تعذر تنزيل المرفق.") : "Could not download the attachment."); }
    finally { setBusy(false); }
  };

  const cancel = async () => {
    if (!request || busy) return;
    setBusy(true); setError("");
    try {
      await employeeRequestAction(request.id, "cancel", {
        version: request.version,
        note: cancelReason.trim() || pick(language, "ألغته الموظفة", "Cancelled by the employee"),
      });
      setCancelDialogOpen(false);
      setCancelReason("");
      await load();
      onChanged();
    } catch (cause) {
      const message = language === "ar" ? employeeRequestErrorMessage(cause, "تعذر إلغاء الطلب.") : "Could not cancel the request.";
      setCancelDialogOpen(false);
      setCancelReason("");
      await load();
      onChanged();
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!request) return;
    const cancellable = ["submitted", "received", "under_review", "needs_info", "approved"].includes(request.status);
    if (!cancellable) {
      setCancelDialogOpen(false);
      setCancelReason("");
    }
  }, [request?.status]);

  if (loading) return <div className="employee-requests-loading">{pick(language, "جاري تحميل تفاصيل الطلب...", "Loading request details...")}</div>;
  if (!request) return <div className="employee-request-error">{error || pick(language, "الطلب غير موجود.", "Request not found.")}</div>;
  const canCancel = ["submitted", "received", "under_review", "needs_info", "approved"].includes(request.status);
  const timelineEvents = (request.events || []).filter((event) => !["comment_added", "internal_note_added"].includes(event.event_type));
  const existingComments = request.comments || [];
  const requestInfoMessages = (request.events || [])
    .filter((event) => ["request_info", "request-info"].includes(event.event_type) && event.note)
    .filter((event) => !existingComments.some((commentItem) => commentItem.body.trim() === String(event.note || "").trim()))
    .map((event) => ({
      id: `event-message-${event.id}`,
      author_name: event.actor_name || pick(language, "الإدارة", "Management"),
      author_role: event.actor_role || "hr",
      visibility: "employee" as const,
      body: event.note || "",
      created_at: event.created_at,
    }));
  const conversation = [...existingComments, ...requestInfoMessages].sort(
    (a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)
  );
  const closureEvent = [...(request.events || [])]
    .reverse()
    .find((event) =>
      ["cancel", "cancelled"].includes(String(event.event_type || "").toLowerCase()) ||
      event.to_status === "cancelled"
    );
  return (
    <section className="employee-request-detail">
      <header className={`employee-request-detail__head ${request.status === "cancelled" ? "is-closed" : ""}`}>
        <button type="button" onClick={onBack}><FontAwesomeIcon icon={faArrowRight} /> {pick(language, "العودة", "Back")}</button>
        <div><small>{request.request_number}</small><h2>{requestTypeLabel(request.request_type, language)}</h2><span className={`employee-request-status is-${statusTone(request.status)}`}>{requestStatusLabel(request.status, language)}</span></div>
      </header>
      {request.rejection_reason ? <div className="employee-request-decision is-danger"><strong>{pick(language, "سبب الرفض", "Rejection reason")}</strong><p>{request.rejection_reason}</p></div> : null}
      {request.execution_error ? <div className="employee-request-decision is-danger"><strong>{pick(language, "تعذر تنفيذ الطلب", "Request execution failed")}</strong><p>{language === "ar" ? employeeRequestExecutionErrorLabel(request.execution_error) : "The request could not be executed. Contact management for details."}</p></div> : null}
      {request.status === "cancelled" ? (
        <div className="employee-request-decision is-closed">
          <strong>{pick(language, "تم إغلاق الطلب", "Request closed")}</strong>
          <p>{closureEvent?.note || pick(language, "أُغلق هذا الطلب ولن تُنفذ عليه إجراءات إضافية ما لم تعِد الإدارة فتحه.", "This request is closed. No further actions will be taken unless management reopens it.")}</p>
          <div className="employee-request-closed-meta">
            <span>{pick(language, "وقت الإغلاق", "Closed at")}</span>
            <time>{formatDateTime(request.cancelled_at || closureEvent?.created_at || request.updated_at, language)}</time>
          </div>
        </div>
      ) : null}
      {request.request_type === "leave" ? <LeaveRequestDocument request={request} language={language} /> : null}
      {request.request_type === "exceptional_financial_payment" ? <ExceptionalFinancialPaymentRequestDocument request={request} language={language} /> : null}
      {request.request_type === "salary_certificate" && ["approved", "executing", "completed"].includes(request.status) ? <SalaryCertificateDocument request={request} language={language} /> : null}
      <div className="employee-request-detail__grid">
        <article><h3>{pick(language, "بيانات الطلب", "Request information")}</h3><dl>{readablePayload(request.payload).map(([key, value]) => <div key={key}><dt>{(language === "ar" ? FIELD_LABELS : FIELD_LABELS_EN)[key] || key}</dt><dd>{formatPayloadValue(key, value, language)}</dd></div>)}</dl></article>
        <article><h3>{pick(language, "متابعة الطلب", "Request tracking")}</h3><dl><div><dt>{pick(language, "الحالة", "Status")}</dt><dd>{requestStatusLabel(request.status, language)}</dd></div><div><dt>{pick(language, "تاريخ الإرسال", "Submitted at")}</dt><dd>{formatDateTime(request.submitted_at, language)}</dd></div><div><dt>{pick(language, "آخر تحديث", "Last updated")}</dt><dd>{formatDateTime(request.updated_at, language)}</dd></div>{request.status === "cancelled" ? <div><dt>{pick(language, "وقت الإغلاق", "Closed at")}</dt><dd>{formatDateTime(request.cancelled_at || closureEvent?.created_at || request.updated_at, language)}</dd></div> : null}<div><dt>{pick(language, "المسؤول", "Assignee")}</dt><dd>{request.assigned_to_name || pick(language, "لم يعيّن بعد", "Not assigned yet")}</dd></div><div><dt>{pick(language, "التنفيذ", "Execution")}</dt><dd>{language === "ar" ? EMPLOYEE_REQUEST_EXECUTION_LABELS[request.execution_status] || request.execution_status : EXECUTION_LABELS_EN[request.execution_status] || request.execution_status}</dd></div></dl></article>
      </div>
      <article className="employee-request-attachments"><h3>{pick(language, "المرفقات", "Attachments")}</h3>{(request.attachments || []).length ? <div className="employee-request-attachments__list">{(request.attachments || []).map((item) => <button type="button" key={item.id} disabled={busy || !item.file_metadata_id} onClick={() => void downloadAttachment(item.file_metadata_id || "", item.file_name)}><FontAwesomeIcon icon={faFileCircleCheck} /><span><strong>{item.file_name}</strong><small>{item.file_type || pick(language, "ملف", "File")}</small></span></button>)}</div> : <p className="employee-requests-empty-text">{pick(language, "لا توجد مرفقات.", "No attachments.")}</p>}</article>
      <div className="employee-request-communication-grid">
        <article className="employee-request-conversation">
          <header><div><h3><FontAwesomeIcon icon={faCommentDots} /> {pick(language, "محادثة الطلب", "Request conversation")}</h3><p>{pick(language, "تواصل مباشر مع الإدارة بعيدًا عن سجل الإجراءات.", "Direct communication with management, separate from the activity log.")}</p></div><span>{conversation.length}</span></header>
          <div className="employee-request-conversation__messages">
            {conversation.length ? conversation.map((item) => {
              const isEmployee = ["staff", "employee"].includes(String(item.author_role || "").toLowerCase());
              return <div key={item.id} className={`employee-request-message ${isEmployee ? "is-employee" : "is-admin"}`}><div><strong>{item.author_name || (isEmployee ? pick(language, "الموظفة", "Employee") : pick(language, "الإدارة", "Management"))}</strong></div><p>{item.body}</p><time>{formatDateTime(item.created_at, language)}</time></div>;
            }) : <p className="employee-request-conversation__empty">{pick(language, "لا توجد رسائل حتى الآن.", "No messages yet.")}</p>}
          </div>
          <div className="employee-request-composer">
            <textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder={request.status === "needs_info" ? pick(language, "اكتب المعلومات المطلوبة...", "Enter the requested information...") : pick(language, "اكتب ردًا أو استفسارًا...", "Write a reply or question...")} />
            <div><span /><button type="button" disabled={busy || !comment.trim()} onClick={() => void submitComment()}><FontAwesomeIcon icon={faPaperPlane} /> {pick(language, "إرسال", "Send")}</button></div>
          </div>
        </article>
        <article className="employee-request-timeline employee-request-timeline--operations">
          <header><h3><FontAwesomeIcon icon={faClockRotateLeft} /> {pick(language, "سجل الإجراءات", "Activity log")}</h3><p>{pick(language, "الحالات والقرارات والتنفيذ فقط.", "Status changes, decisions and execution only.")}</p></header>
          <div className="employee-request-timeline__list">{timelineEvents.map((event) => <div className="employee-request-timeline__item" key={event.id}><span /><div><strong>{requestEventLabel(event.event_type, language)}</strong><small>{formatDateTime(event.created_at, language)} {event.actor_name ? `• ${event.actor_name}` : ""}</small>{event.note && !["request_info", "request-info"].includes(event.event_type) ? <p>{event.note}</p> : null}</div></div>)}</div>
        </article>
      </div>
      {error ? <div className="employee-request-error">{error}</div> : null}
      {canCancel ? <button type="button" className="employee-request-cancel" disabled={busy} onClick={() => setCancelDialogOpen(true)}>{pick(language, "إلغاء الطلب", "Cancel request")}</button> : null}
      {cancelDialogOpen ? createPortal(
        <div className="employee-request-action-modal" role="dialog" aria-modal="true" aria-labelledby="employee-cancel-request-title">
          <button type="button" className="employee-request-action-modal__backdrop" aria-label={pick(language, "إغلاق", "Close")} onClick={() => !busy && setCancelDialogOpen(false)} />
          <section className="employee-request-action-modal__panel">
            <header><div><small>{request.request_number}</small><h2 id="employee-cancel-request-title">{pick(language, "إلغاء الطلب", "Cancel request")}</h2><p>{pick(language, "لن يمكن إلغاء الطلب بعد بدء تنفيذه. اكتب السبب عند الحاجة ثم أكد الإلغاء.", "The request cannot be cancelled after execution begins. Add a reason if needed, then confirm.")}</p></div><button type="button" onClick={() => setCancelDialogOpen(false)} disabled={busy}><FontAwesomeIcon icon={faXmark} /></button></header>
            <div className="employee-request-action-modal__body"><label className="employee-request-action-field"><span>{pick(language, "سبب الإلغاء", "Cancellation reason")} <small>{pick(language, "اختياري", "Optional")}</small></span><textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder={pick(language, "اكتب سبب الإلغاء...", "Enter a cancellation reason...")} /></label></div>
            <footer><button type="button" className="is-secondary" onClick={() => setCancelDialogOpen(false)} disabled={busy}>{pick(language, "تراجع", "Back")}</button><button type="button" className="is-danger" onClick={() => void cancel()} disabled={busy}>{busy ? pick(language, "جارٍ الإلغاء...", "Cancelling...") : pick(language, "تأكيد الإلغاء", "Confirm cancellation")}</button></footer>
          </section>
        </div>, document.body
      ) : null}
    </section>
  );
}

export default function EmployeeRequestsPage({ session, onPortalChange }: Props) {
  const navigate = useNavigate();
  const { language } = useEmployeePortalLanguage();
  const { requestId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedType = searchParams.get("new") as EmployeeRequestType | null;
  const [rows, setRows] = useState<EmployeeRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [typeFilter, setTypeFilter] = useState<EmployeeRequestType | "">("");
  const [statusFilter, setStatusFilter] = useState<EmployeeRequestStatus | "">("");
  const [success, setSuccess] = useState<EmployeeRequest | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setRows(await listMyEmployeeRequests({ type: typeFilter, status: statusFilter, limit: 200 })); }
    catch (cause) { setError(language === "ar" ? String((cause as Error)?.message || "تعذر تحميل الطلبات.") : "Could not load requests."); }
    finally { setLoading(false); }
  }, [language, statusFilter, typeFilter]);
  useEffect(() => { if (!requestId) void load(); }, [load, requestId]);

  const newType = REQUEST_TYPES.includes(requestedType as EmployeeRequestType) ? requestedType as EmployeeRequestType : null;
  const closeForm = () => { searchParams.delete("new"); setSearchParams(searchParams, { replace: true }); };

  if (requestId) return <RequestDetail requestId={requestId} language={language} onBack={() => navigate("/employee/requests")} onChanged={() => { void onPortalChange?.(); }} />;

  return (
    <div className="employee-requests-page" dir={language === "ar" ? "rtl" : "ltr"} lang={language}>
      <header className="employee-requests-hero"><div><small>{pick(language, "الخدمة الذاتية", "Self-service")}</small><h1>{pick(language, "طلباتي", "My Requests")}</h1><p>{pick(language, "أنشئ الطلب وتابع الاستلام والمراجعة والقرار والتنفيذ من مكان واحد.", "Create requests and track receipt, review, decisions and execution in one place.")}</p></div><button type="button" onClick={() => setSearchParams({ new: "attendance_correction" })}><FontAwesomeIcon icon={faPlus} /> {pick(language, "طلب جديد", "New request")}</button></header>
      <div className="employee-requests-filters"><span><FontAwesomeIcon icon={faFilter} /> {pick(language, "تصفية", "Filter")}</span><DashboardSelectBridgeV2 value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as EmployeeRequestType | "")}><option value="">{pick(language, "كل الأنواع", "All types")}</option>{REQUEST_TYPES.map((type) => <option value={type} key={type}>{requestTypeLabel(type, language)}</option>)}</DashboardSelectBridgeV2><DashboardSelectBridgeV2 value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as EmployeeRequestStatus | "")}><option value="">{pick(language, "كل الحالات", "All statuses")}</option>{STATUS_OPTIONS.map((status) => <option value={status} key={status}>{requestStatusLabel(status, language)}</option>)}</DashboardSelectBridgeV2><button type="button" onClick={() => void load()} aria-label={pick(language, "تحديث", "Refresh")}><FontAwesomeIcon icon={faRotate} /></button></div>
      {error ? <div className="employee-request-error">{error}</div> : null}
      {loading ? <div className="employee-requests-loading">{pick(language, "جاري تحميل الطلبات...", "Loading requests...")}</div> : rows.length ? <div className="employee-requests-list">{rows.map((request) => <button type="button" className={`employee-request-card ${request.status === "cancelled" ? "is-closed" : ""}`} key={request.id} onClick={() => navigate(`/employee/requests/${request.id}`)}><span className="employee-request-card__icon"><FontAwesomeIcon icon={request.status === "completed" ? faCheckCircle : request.status === "cancelled" ? faXmark : faFileCircleCheck} /></span><div><small>{request.request_number}</small><strong>{requestTypeLabel(request.request_type, language)}</strong><p>{request.status === "cancelled" ? `${pick(language, "تم إغلاق الطلب", "Request closed")} • ${formatDateTime(request.cancelled_at || request.updated_at, language)}` : `${formatDateTime(request.submitted_at, language)} • ${pick(language, "آخر تحديث", "Last updated")} ${formatDateTime(request.updated_at, language)}`}</p></div><span className={`employee-request-status is-${statusTone(request.status)}`}>{requestStatusLabel(request.status, language)}</span></button>)}</div> : <div className="employee-requests-empty"><FontAwesomeIcon icon={faCalendarDays} /><h2>{pick(language, "لا توجد طلبات", "No requests")}</h2><p>{pick(language, "أنشئ أول طلب ليصل مباشرة إلى إدارة الموارد البشرية.", "Create your first request and send it directly to HR.")}</p></div>}
      {newType ? <RequestForm type={newType} employeeId={String(session.employeeId || session.uid)} employeeName={String(session.displayName || session.email || pick(language, "الموظفة", "Employee"))} language={language} onClose={closeForm} onCreated={(request) => { setSuccess(request); closeForm(); void load(); void onPortalChange?.(); }} /> : null}
      {success ? <div className="employee-request-modal" role="dialog" aria-modal="true"><div className="employee-request-success"><FontAwesomeIcon icon={faCheckCircle} /><small>{pick(language, "تم استلام الطلب", "Request received")}</small><h2>{success.request_number}</h2><p>{requestTypeLabel(success.request_type, language)}</p><span>{requestStatusLabel(success.status, language)} • {formatDateTime(success.submitted_at, language)}</span><div><button type="button" onClick={() => setSuccess(null)}>{pick(language, "إغلاق", "Close")}</button><button type="button" onClick={() => navigate(`/employee/requests/${success.id}`)}>{pick(language, "عرض التفاصيل", "View details")}</button></div></div></div> : null}
    </div>
  );
}
