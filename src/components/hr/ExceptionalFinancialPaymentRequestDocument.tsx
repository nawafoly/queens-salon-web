import DashboardNumberInputV2 from "../dashboard-v2/DashboardNumberInputV2";
import type {
  EmployeeRequest,
  EmployeeRequestEvent,
  ExceptionalFinancialPaymentPreview,
} from "../../services/employeeRequests";
import { EMPLOYEE_REQUEST_STATUS_LABELS } from "../../services/employeeRequests";
import { DOCUMENT_BRANDING } from "../../documents/core/documentBranding";
import { DocumentField, DocumentFieldGrid, DocumentLongText, DocumentPage, DocumentSection } from "../../documents/core/DocumentPage";
import SignatureCaptureField from "./SignatureCaptureField";
import type { EmployeePortalLanguage } from "../../features/employee-portal/EmployeePortalLanguage";
import "../../styles/LeaveRequestDocument.css";

export type ExceptionalFinancialPaymentFormState = Record<string, string | boolean>;

type FormProps = {
  employeeName: string;
  form: ExceptionalFinancialPaymentFormState;
  update: (name: string, value: string | boolean) => void;
  preview: ExceptionalFinancialPaymentPreview | null;
  previewLoading: boolean;
  language?: EmployeePortalLanguage;
};

const choose = (language: EmployeePortalLanguage, ar: string, en: string) => language === "en" ? en : ar;

function formatDateTime(value: unknown, language: EmployeePortalLanguage) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) return "—";
  return new Intl.DateTimeFormat(language === "en" ? "en-SA-u-ca-gregory" : "ar-SA-u-ca-gregory-nu-latn", {
    timeZone: "Asia/Riyadh",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(parsed));
}

function parseEventPayload(event?: EmployeeRequestEvent | null) {
  if (!event?.payload_json) return {} as Record<string, unknown>;
  try {
    const parsed = JSON.parse(event.payload_json);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {} as Record<string, unknown>;
  }
}

function parseAfter(event?: EmployeeRequestEvent | null) {
  if (!event?.after_json) return {} as Record<string, unknown>;
  try {
    const parsed = JSON.parse(event.after_json);
    const after = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>).after : null;
    return after && typeof after === "object" ? after as Record<string, unknown> : {};
  } catch {
    return {} as Record<string, unknown>;
  }
}

function decisionEvent(request: EmployeeRequest) {
  return [...(request.events || [])].reverse().find((event) =>
    ["approve", "approved", "reject", "rejected"].includes(String(event.event_type || "").toLowerCase())
  );
}

function executionEvent(request: EmployeeRequest) {
  return [...(request.events || [])].reverse().find((event) => event.event_type === "execution_completed");
}

export function ExceptionalFinancialPaymentRequestFormFields({
  employeeName,
  form,
  update,
  preview,
  previewLoading,
  language = "ar",
}: FormProps) {
  const isEnglish = language === "en";
  const moneyLabel = (value: unknown) => `${(Number(value || 0) / 100).toLocaleString(isEnglish ? "en-SA" : "ar-SA-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${isEnglish ? "SAR" : "ريال"}`;
  const numberLabel = (value: unknown) => Number(value || 0).toLocaleString(isEnglish ? "en-SA" : "ar-SA-u-nu-latn", { maximumFractionDigits: 2 });
  return (
    <DocumentPage dir={isEnglish ? "ltr" : "rtl"} className="leave-doc leave-doc--editable" labelledBy="financial-payment-request-draft-title">
      <header className="leave-doc-header">
        <div className="leave-doc-brand" aria-label={choose(language, "شعار ملكات", "Malikat logo")}>
          <img src={DOCUMENT_BRANDING.logoSource} alt={choose(language, "شعار ملكات", "Malikat logo")} />
        </div>
        <h2 id="financial-payment-request-draft-title">{choose(language, "طلب تعويض مالي بدل إجازة", "Leave cash compensation request")}</h2>
      </header>

      <div className="employee-request-decision">
        <strong>{choose(language, "طريقة الاحتساب", "Calculation method")}</strong>
        <p>{choose(language, "يتم تعويض قيمة الأيام المطلوبة ماليًا، ويُخصم نفس عدد الأيام من رصيد الإجازة السنوية عند تنفيذ الطلب.", "The requested days are paid in cash, and the same number of days is deducted from the annual leave balance when the request is executed.")}</p>
      </div>

      <DocumentFieldGrid>
        <label className="employee-request-field">
          <span>{choose(language, "عدد أيام الإجازة المطلوب تعويضها *", "Leave days to compensate *")}</span>
          <DashboardNumberInputV2
            min="0.5"
            max="60"
            step="0.5"
            required
            value={String(form.requestedDays || "")}
            onChange={(event) => update("requestedDays", event.target.value)}
          />
        </label>
        <DocumentField
          label={choose(language, "قيمة التعويض", "Compensation amount")}
          value={
            previewLoading
              ? choose(language, "جاري الحساب...", "Calculating...")
              : preview
                ? moneyLabel(preview.calculatedAmountHalalas)
                : choose(language, "أدخل عدد الأيام", "Enter the number of days")
          }
        />
      </DocumentFieldGrid>

      {preview ? (
        <small>
          {choose(language, "قيمة اليوم", "Daily rate")}: {moneyLabel(preview.dayRateHalalas)}
          {" • "}
          {choose(language, "رصيد الإجازة", "Leave balance")}: {numberLabel(preview.annualLeaveBalance)} {choose(language, "يوم", "days")}
          {" • "}
          {preview.enoughLeaveBalance
            ? `${choose(language, "الرصيد بعد التعويض", "Balance after compensation")}: ${numberLabel(preview.annualLeaveBalance - preview.requestedDays)} ${choose(language, "يوم", "days")}`
            : choose(language, "الرصيد الحالي لا يكفي لهذا العدد من الأيام", "The current balance is not enough for this number of days")}
        </small>
      ) : null}

      <label className="leave-doc-wide-field">
        <span>{choose(language, "سبب الطلب", "Reason")}</span>
        <textarea required value={String(form.reason || "")} onChange={(event) => update("reason", event.target.value)} />
      </label>
      <label className="leave-doc-wide-field">
        <span>{choose(language, "ملاحظات إضافية", "Additional notes")}</span>
        <textarea value={String(form.notes || "")} onChange={(event) => update("notes", event.target.value)} />
      </label>

      <label className="employee-request-check employee-request-check--ack">
        <input
          type="checkbox"
          required
          checked={Boolean(form.acknowledgement)}
          onChange={(event) => update("acknowledgement", event.target.checked)}
        />
        <span>{choose(language, "أوافق على خصم عدد الأيام المعتمدة من رصيد إجازتي السنوية مقابل صرف قيمتها المالية.", "I agree that the approved days will be deducted from my annual leave balance in exchange for their cash payment.")}</span>
      </label>

      <div className="leave-doc-signature-row">
        <div className="leave-doc-signature-cell"><span>{choose(language, "الاسم", "Name")}</span><strong>{employeeName || choose(language, "الموظفة", "Employee")}</strong></div>
        <SignatureCaptureField
          compact
          required
          language={language}
          label={choose(language, "توقيع الموظفة", "Employee signature")}
          signerName={employeeName || choose(language, "الموظفة", "Employee")}
          value={String(form.employeeSignatureDataUrl || "")}
          onChange={(signature) => update("employeeSignatureDataUrl", signature)}
        />
      </div>
      <small>{choose(language, "تُثبت قيمة اليوم من الراتب الأساسي المسجل في Core عند إرسال الطلب، ويعاد التحقق من رصيد الإجازة قبل التنفيذ.", "The daily rate is captured from the base salary recorded in Core when submitted, and the leave balance is checked again before execution.")}</small>
    </DocumentPage>
  );
}

export default function ExceptionalFinancialPaymentRequestDocument({ request, language = "ar" }: { request: EmployeeRequest; language?: EmployeePortalLanguage }) {
  const isEnglish = language === "en";
  const text = (ar: string, en: string) => choose(language, ar, en);
  const moneyValue = (value: unknown) => `${(Number(value || 0) / 100).toLocaleString(isEnglish ? "en-SA" : "ar-SA-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${isEnglish ? "SAR" : "ريال"}`;
  const numberValue = (value: unknown) => Number(value || 0).toLocaleString(isEnglish ? "en-SA" : "ar-SA-u-nu-latn", { maximumFractionDigits: 2 });
  const payload = request.payload || {};
  const decision = decisionEvent(request);
  const decisionPayload = parseEventPayload(decision);
  const execution = executionEvent(request);
  const effect = parseAfter(execution);
  const approved = ["approved", "executing", "completed"].includes(request.status) || ["approve", "approved"].includes(String(decision?.event_type || ""));
  const rejected = request.status === "rejected" || ["reject", "rejected"].includes(String(decision?.event_type || ""));
  const employeeName = request.employee_name_snapshot || request.employee_id || text("الموظفة", "Employee");
  const requestedDays = Number(payload.requestedDays || 0);
  const snapshotBalance = Number(payload.annualLeaveBalanceSnapshot || 0);
  const actualBefore = Number(effect.leaveBalanceBefore ?? effect.leave_balance_before);
  const actualAfter = Number(effect.leaveBalanceAfter ?? effect.leave_balance_after);
  const actualDeducted = Number(effect.leaveBalanceDeducted ?? effect.leave_balance_deducted);
  const beforeBalance = Number.isFinite(actualBefore) && execution ? actualBefore : snapshotBalance;
  const deductedDays = Number.isFinite(actualDeducted) && execution ? actualDeducted : requestedDays;
  const plannedAfter = Math.max(0, beforeBalance - deductedDays);
  const afterBalance = Number.isFinite(actualAfter) && execution ? actualAfter : plannedAfter;
  const managerSignature = String(decisionPayload.reviewerSignatureDataUrl || "");
  const employeeSignature = String(payload.employeeSignatureDataUrl || "");

  return (
    <DocumentPage dir={isEnglish ? "ltr" : "rtl"} className="leave-doc financial-payment-request-print-root" labelledBy="financial-payment-request-document-title">
      <header className="leave-doc-header">
        <div className="leave-doc-brand" aria-label={text("شعار ملكات", "Malikat logo")}>
          <img src={DOCUMENT_BRANDING.printLogoSource} alt={text("شعار ملكات", "Malikat logo")} />
        </div>
        <h2 id="financial-payment-request-document-title">{text("طلب تعويض مالي بدل إجازة", "Leave cash compensation request")}</h2>
      </header>
      <div className="leave-doc-number">{text("رقم الطلب", "Request number")}: <strong>{request.request_number}</strong></div>

      <DocumentFieldGrid>
        <DocumentField label={text("الموظفة", "Employee")} value={employeeName} />
        <DocumentField label={text("رقم الموظفة", "Employee ID")} value={request.employee_id} />
        <DocumentField label={text("عدد أيام الإجازة المطلوب تعويضها", "Leave days to compensate")} value={`${numberValue(requestedDays)} ${text("يوم", "days")}`} />
        <DocumentField label={text("تاريخ الطلب", "Request date")} value={formatDateTime(request.submitted_at, language)} />
        <DocumentField label={text("الراتب الأساسي وقت الطلب", "Base salary at request time")} value={moneyValue(payload.baseSalaryHalalas)} />
        <DocumentField label={text("قيمة اليوم", "Daily rate")} value={moneyValue(payload.dayRateHalalas)} />
        <DocumentField label={text("إجمالي التعويض", "Total compensation")} value={moneyValue(payload.calculatedAmountHalalas)} />
        <DocumentField label={text("حالة الطلب", "Request status")} value={isEnglish ? ({ pending: "Pending", approved: "Approved", rejected: "Rejected", executing: "In progress", completed: "Completed", cancelled: "Cancelled" } as Record<string,string>)[request.status] || request.status : EMPLOYEE_REQUEST_STATUS_LABELS[request.status] || request.status} />
      </DocumentFieldGrid>

      <DocumentLongText label={text("سبب الطلب", "Reason")} value={String(payload.reason || "—")} />
      {payload.notes ? <DocumentLongText label={text("ملاحظات", "Notes")} value={String(payload.notes)} /> : null}

      <DocumentSection title={text("أثر رصيد الإجازة", "Leave balance impact")}>
        <DocumentFieldGrid>
          <DocumentField label={text("رصيد الإجازة قبل الخصم", "Leave balance before deduction")} value={`${numberValue(beforeBalance)} ${text("يوم", "days")}`} />
          <DocumentField label={text("الأيام المخصومة", "Days deducted")} value={`${numberValue(deductedDays)} ${text("يوم", "days")}`} />
          <DocumentField label={execution ? text("رصيد الإجازة بعد الخصم", "Leave balance after deduction") : text("الرصيد المتوقع بعد التنفيذ", "Expected balance after execution")} value={`${numberValue(afterBalance)} ${text("يوم", "days")}`} />
          <DocumentField label={text("المعالجة", "Processing")} value={text("تعويض مالي مقابل خصم رصيد إجازة سنوية", "Cash compensation in exchange for annual leave deduction")} />
        </DocumentFieldGrid>
      </DocumentSection>

      <div className="leave-doc-signature-row">
          <div className="leave-doc-signature-cell"><span>{text("اسم الموظفة", "Employee name")}</span><strong>{employeeName}</strong></div>
        <div className="leave-doc-signature-cell">
          <span>{text("توقيع الموظفة", "Employee signature")}</span>
          {employeeSignature ? <img className="leave-doc-signature-image" src={employeeSignature} alt={`${text("توقيع", "Signature of")} ${employeeName}`} /> : <strong>{text("غير موقع", "Not signed")}</strong>}
          <small>{formatDateTime(request.submitted_at, language)}</small>
        </div>
      </div>

      <DocumentSection title={text("اعتماد الإدارة", "Management approval")} className="leave-doc-manager-opinion">
        <DocumentFieldGrid>
          <DocumentField label={text("القرار", "Decision")} value={approved ? text("مع الموافقة", "Approved") : rejected ? text("مرفوض", "Rejected") : text("قيد المراجعة", "Under review")} />
          <DocumentField label={text("المسؤول", "Reviewer")} value={decision?.actor_name || request.assigned_to_name || "—"} />
          <DocumentField label={text("تاريخ القرار", "Decision date")} value={decision ? formatDateTime(decision.created_at, language) : "—"} />
          <DocumentField label={text("حالة الصرف", "Payment status")} value={request.status === "completed" ? text("تم إدراجه في المسير وخصم الرصيد", "Included in payroll and balance deducted") : text("لم يكتمل", "Not completed")} />
        </DocumentFieldGrid>
        <DocumentLongText label={text("ملاحظات / القرار", "Notes / decision")} value={request.rejection_reason || request.decision_note || decision?.note || "—"} />
        <div className="leave-doc-signature-row">
          <div className="leave-doc-signature-cell"><span>{text("مرجع الصرف", "Payment reference")}</span><strong>{request.external_reference || String(effect.financial_reference || effect.financialReference || "—")}</strong></div>
          <div className="leave-doc-signature-cell">
            <span>{text("توقيع المراجع / المسؤول", "Reviewer signature")}</span>
            {managerSignature ? <img className="leave-doc-signature-image" src={managerSignature} alt={text("توقيع المراجع", "Reviewer signature")} /> : <strong>—</strong>}
          </div>
        </div>
      </DocumentSection>

      <footer className="leave-doc-copy-note">{text("نسخة محفوظة إلكترونيًا ضمن نظام طلبات الموظفات — قيمة التعويض مرتبطة بالـPayroll، ويُخصم مقابلها نفس عدد الأيام من رصيد الإجازة السنوية عند التنفيذ.", "Electronic copy stored in the employee requests system — compensation is linked to payroll and the same number of annual leave days is deducted upon execution.")}</footer>
    </DocumentPage>
  );
}
