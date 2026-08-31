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
import "../../styles/LeaveRequestDocument.css";

export type ExceptionalFinancialPaymentFormState = Record<string, string | boolean>;

type FormProps = {
  employeeName: string;
  form: ExceptionalFinancialPaymentFormState;
  update: (name: string, value: string | boolean) => void;
  preview: ExceptionalFinancialPaymentPreview | null;
  previewLoading: boolean;
};

function formatMoneyHalalas(value: unknown) {
  const amount = Number(value || 0) / 100;
  return `${amount.toLocaleString("ar-SA-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ريال`;
}

function formatNumber(value: unknown) {
  const number = Number(value || 0);
  return number.toLocaleString("ar-SA-u-nu-latn", { maximumFractionDigits: 2 });
}

function formatDateTime(value: unknown) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) return "—";
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
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
}: FormProps) {
  return (
    <DocumentPage className="leave-doc leave-doc--editable" labelledBy="financial-payment-request-draft-title">
      <header className="leave-doc-header">
        <div className="leave-doc-brand" aria-label="شعار ملكات">
          <img src={DOCUMENT_BRANDING.logoSource} alt="شعار ملكات" />
        </div>
        <h2 id="financial-payment-request-draft-title">طلب تعويض مالي بدل إجازة</h2>
      </header>

      <div className="employee-request-decision">
        <strong>طريقة الاحتساب</strong>
        <p>يتم تعويض قيمة الأيام المطلوبة ماليًا، ويُخصم نفس عدد الأيام من رصيد الإجازة السنوية عند تنفيذ الطلب.</p>
      </div>

      <DocumentFieldGrid>
        <label className="employee-request-field">
          <span>عدد أيام الإجازة المطلوب تعويضها *</span>
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
          label="قيمة التعويض"
          value={
            previewLoading
              ? "جاري الحساب..."
              : preview
                ? formatMoneyHalalas(preview.calculatedAmountHalalas)
                : "أدخل عدد الأيام"
          }
        />
      </DocumentFieldGrid>

      {preview ? (
        <small>
          قيمة اليوم: {formatMoneyHalalas(preview.dayRateHalalas)}
          {" • "}
          رصيد الإجازة: {formatNumber(preview.annualLeaveBalance)} يوم
          {" • "}
          {preview.enoughLeaveBalance
            ? `الرصيد بعد التعويض: ${formatNumber(
                preview.annualLeaveBalance - preview.requestedDays
              )} يوم`
            : "الرصيد الحالي لا يكفي لهذا العدد من الأيام"}
        </small>
      ) : null}

      <label className="leave-doc-wide-field">
        <span>سبب الطلب</span>
        <textarea required value={String(form.reason || "")} onChange={(event) => update("reason", event.target.value)} />
      </label>
      <label className="leave-doc-wide-field">
        <span>ملاحظات إضافية</span>
        <textarea value={String(form.notes || "")} onChange={(event) => update("notes", event.target.value)} />
      </label>

      <label className="employee-request-check employee-request-check--ack">
        <input
          type="checkbox"
          required
          checked={Boolean(form.acknowledgement)}
          onChange={(event) => update("acknowledgement", event.target.checked)}
        />
        <span>أوافق على خصم عدد الأيام المعتمدة من رصيد إجازتي السنوية مقابل صرف قيمتها المالية.</span>
      </label>

      <div className="leave-doc-signature-row">
        <div className="leave-doc-signature-cell"><span>الاسم</span><strong>{employeeName || "الموظفة"}</strong></div>
        <SignatureCaptureField
          compact
          required
          label="توقيع الموظفة"
          signerName={employeeName || "الموظفة"}
          value={String(form.employeeSignatureDataUrl || "")}
          onChange={(signature) => update("employeeSignatureDataUrl", signature)}
        />
      </div>
      <small>تُثبت قيمة اليوم من الراتب الأساسي المسجل في Core عند إرسال الطلب، ويعاد التحقق من رصيد الإجازة قبل التنفيذ.</small>
    </DocumentPage>
  );
}

export default function ExceptionalFinancialPaymentRequestDocument({ request }: { request: EmployeeRequest }) {
  const payload = request.payload || {};
  const decision = decisionEvent(request);
  const decisionPayload = parseEventPayload(decision);
  const execution = executionEvent(request);
  const effect = parseAfter(execution);
  const approved = ["approved", "executing", "completed"].includes(request.status) || ["approve", "approved"].includes(String(decision?.event_type || ""));
  const rejected = request.status === "rejected" || ["reject", "rejected"].includes(String(decision?.event_type || ""));
  const employeeName = request.employee_name_snapshot || request.employee_id || "الموظفة";
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
  const amount = formatMoneyHalalas(payload.calculatedAmountHalalas);

  return (
    <DocumentPage className="leave-doc financial-payment-request-print-root" labelledBy="financial-payment-request-document-title">
      <header className="leave-doc-header">
        <div className="leave-doc-brand" aria-label="شعار ملكات">
          <img src={DOCUMENT_BRANDING.printLogoSource} alt="شعار ملكات" />
        </div>
        <h2 id="financial-payment-request-document-title">طلب تعويض مالي بدل إجازة</h2>
      </header>
      <div className="leave-doc-number">رقم الطلب: <strong>{request.request_number}</strong></div>

      <DocumentFieldGrid>
        <DocumentField label="الموظفة" value={employeeName} />
        <DocumentField label="رقم الموظفة" value={request.employee_id} />
        <DocumentField label="عدد أيام الإجازة المطلوب تعويضها" value={`${formatNumber(requestedDays)} يوم`} />
        <DocumentField label="تاريخ الطلب" value={formatDateTime(request.submitted_at)} />
        <DocumentField label="الراتب الأساسي وقت الطلب" value={formatMoneyHalalas(payload.baseSalaryHalalas)} />
        <DocumentField label="قيمة اليوم" value={formatMoneyHalalas(payload.dayRateHalalas)} />
        <DocumentField label="إجمالي التعويض" value={amount} />
        <DocumentField label="حالة الطلب" value={EMPLOYEE_REQUEST_STATUS_LABELS[request.status] || request.status} />
      </DocumentFieldGrid>

      <DocumentLongText label="سبب الطلب" value={String(payload.reason || "—")} />
      {payload.notes ? <DocumentLongText label="ملاحظات" value={String(payload.notes)} /> : null}

      <DocumentSection title="أثر رصيد الإجازة">
        <DocumentFieldGrid>
          <DocumentField label="رصيد الإجازة قبل الخصم" value={`${formatNumber(beforeBalance)} يوم`} />
          <DocumentField label="الأيام المخصومة" value={`${formatNumber(deductedDays)} يوم`} />
          <DocumentField label={execution ? "رصيد الإجازة بعد الخصم" : "الرصيد المتوقع بعد التنفيذ"} value={`${formatNumber(afterBalance)} يوم`} />
          <DocumentField label="المعالجة" value="تعويض مالي مقابل خصم رصيد إجازة سنوية" />
        </DocumentFieldGrid>
      </DocumentSection>

      <div className="leave-doc-signature-row">
        <div className="leave-doc-signature-cell"><span>اسم الموظفة</span><strong>{employeeName}</strong></div>
        <div className="leave-doc-signature-cell">
          <span>توقيع الموظفة</span>
          {employeeSignature ? <img className="leave-doc-signature-image" src={employeeSignature} alt={`توقيع ${employeeName}`} /> : <strong>غير موقع</strong>}
          <small>{formatDateTime(request.submitted_at)}</small>
        </div>
      </div>

      <DocumentSection title="اعتماد الإدارة" className="leave-doc-manager-opinion">
        <DocumentFieldGrid>
          <DocumentField label="القرار" value={approved ? "مع الموافقة" : rejected ? "مرفوض" : "قيد المراجعة"} />
          <DocumentField label="المسؤول" value={decision?.actor_name || request.assigned_to_name || "—"} />
          <DocumentField label="تاريخ القرار" value={decision ? formatDateTime(decision.created_at) : "—"} />
          <DocumentField label="حالة الصرف" value={request.status === "completed" ? "تم إدراجه في المسير وخصم الرصيد" : "لم يكتمل"} />
        </DocumentFieldGrid>
        <DocumentLongText label="ملاحظات / القرار" value={request.rejection_reason || request.decision_note || decision?.note || "—"} />
        <div className="leave-doc-signature-row">
          <div className="leave-doc-signature-cell"><span>مرجع الصرف</span><strong>{request.external_reference || String(effect.financial_reference || effect.financialReference || "—")}</strong></div>
          <div className="leave-doc-signature-cell">
            <span>توقيع المراجع / المسؤول</span>
            {managerSignature ? <img className="leave-doc-signature-image" src={managerSignature} alt="توقيع المراجع" /> : <strong>—</strong>}
          </div>
        </div>
      </DocumentSection>

      <footer className="leave-doc-copy-note">نسخة محفوظة إلكترونيًا ضمن نظام طلبات الموظفات — قيمة التعويض مرتبطة بالـPayroll، ويُخصم مقابلها نفس عدد الأيام من رصيد الإجازة السنوية عند التنفيذ.</footer>
    </DocumentPage>
  );
}
