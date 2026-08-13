import malikatLogo from "../../assets/images/ssunnamed.png";
import type { EmployeeRequest, EmployeeRequestEvent } from "../../services/employeeRequests";
import { EMPLOYEE_REQUEST_STATUS_LABELS } from "../../services/employeeRequests";
import { DocumentField, DocumentFieldGrid, DocumentLongText, DocumentPage, DocumentSection } from "../../documents/core/DocumentPage";
import SignatureCaptureField from "./SignatureCaptureField";
import "../../styles/LeaveRequestDocument.css";

export type ExceptionalFinancialPaymentFormState = Record<string, string | boolean>;

type FormProps = {
  employeeName: string;
  form: ExceptionalFinancialPaymentFormState;
  update: (name: string, value: string | boolean) => void;
};

function formatMoneyHalalas(value: unknown) {
  const amount = Number(value || 0) / 100;
  return `${amount.toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ريال`;
}

function formatDateTime(value: unknown) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) return "—";
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
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

export function ExceptionalFinancialPaymentRequestFormFields({ employeeName, form, update }: FormProps) {
  return (
    <DocumentPage className="leave-doc leave-doc--editable" labelledBy="financial-payment-request-draft-title">
      <img className="leave-doc-watermark" src={malikatLogo} alt="" aria-hidden="true" />
      <header className="leave-doc-header">
        <div className="leave-doc-brand" aria-label="شعار ملكات"><img src={malikatLogo} alt="شعار ملكات" /></div>
        <h2 id="financial-payment-request-draft-title">طلب صرف مالي استثنائي</h2>
      </header>

      <div className="employee-request-decision">
        <strong>تنبيه مهم</strong>
        <p>هذا الطلب مالي مستقل. عدد الأيام هنا مرجع للحساب فقط، ولا يخصم النظام أي يوم من رصيد الإجازة السنوية.</p>
      </div>

      <DocumentFieldGrid>
        <label className="employee-request-field">
          <span>عدد الأيام المرجعية *</span>
          <input type="number" min="0.5" max="60" step="0.5" required value={String(form.requestedDays || "")} onChange={(event) => update("requestedDays", event.target.value)} />
        </label>
        <DocumentField label="أساس الحساب" value="الراتب الأساسي ÷ 30 × عدد الأيام" />
      </DocumentFieldGrid>

      <label className="leave-doc-wide-field">
        <span>سبب الطلب</span>
        <textarea required value={String(form.reason || "")} onChange={(event) => update("reason", event.target.value)} />
      </label>
      <label className="leave-doc-wide-field">
        <span>ملاحظات إضافية</span>
        <textarea value={String(form.notes || "")} onChange={(event) => update("notes", event.target.value)} />
      </label>

      <label className="employee-request-check employee-request-check--ack">
        <input type="checkbox" required checked={Boolean(form.acknowledgement)} onChange={(event) => update("acknowledgement", event.target.checked)} />
        <span>أقر بصحة البيانات وأفهم أن هذا الطلب صرف مالي مستقل ولا يخصم رصيدي السنوي.</span>
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
      <small>تُحسب القيمة النهائية من الراتب الأساسي المسجل في Core عند إرسال الطلب، وتُحفظ كـSnapshot داخل الطلب.</small>
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
  const beforeBalance = Number(payload.annualLeaveBalanceSnapshot || 0);
  const afterBalance = beforeBalance;
  const managerSignature = String(decisionPayload.reviewerSignatureDataUrl || "");
  const employeeSignature = String(payload.employeeSignatureDataUrl || "");
  const amount = formatMoneyHalalas(payload.calculatedAmountHalalas);

  return (
    <DocumentPage className="leave-doc financial-payment-request-print-root" labelledBy="financial-payment-request-document-title">
      <img className="leave-doc-watermark" src={malikatLogo} alt="" aria-hidden="true" />
      <header className="leave-doc-header">
        <div className="leave-doc-brand" aria-label="شعار ملكات"><img src={malikatLogo} alt="شعار ملكات" /></div>
        <h2 id="financial-payment-request-document-title">طلب صرف مالي استثنائي</h2>
      </header>
      <div className="leave-doc-number">رقم الطلب: <strong>{request.request_number}</strong></div>

      <DocumentFieldGrid>
        <DocumentField label="الموظفة" value={employeeName} />
        <DocumentField label="رقم الموظفة" value={request.employee_id} />
        <DocumentField label="عدد الأيام المرجعية" value={String(payload.requestedDays || "—")} />
        <DocumentField label="تاريخ الطلب" value={formatDateTime(request.submitted_at)} />
        <DocumentField label="الراتب الأساسي وقت الطلب" value={formatMoneyHalalas(payload.baseSalaryHalalas)} />
        <DocumentField label="قيمة اليوم" value={formatMoneyHalalas(payload.dayRateHalalas)} />
        <DocumentField label="إجمالي الصرف" value={amount} />
        <DocumentField label="حالة الطلب" value={EMPLOYEE_REQUEST_STATUS_LABELS[request.status] || request.status} />
      </DocumentFieldGrid>

      <DocumentLongText label="سبب الطلب" value={String(payload.reason || "—")} />
      {payload.notes ? <DocumentLongText label="ملاحظات" value={String(payload.notes)} /> : null}

      <DocumentSection title="أثر الرصيد">
        <DocumentFieldGrid>
          <DocumentField label="الرصيد السنوي قبل العملية" value={`${beforeBalance} يوم`} />
          <DocumentField label="الأيام المخصومة" value="0 يوم" />
          <DocumentField label="الرصيد السنوي بعد العملية" value={`${afterBalance} يوم`} />
          <DocumentField label="المعالجة" value="صرف مالي مستقل — لا خصم من الإجازة السنوية" />
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
          <DocumentField label="حالة الصرف" value={request.status === "completed" ? "تم إدراجه في المسير" : "لم يكتمل"} />
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

      <footer className="leave-doc-copy-note">نسخة محفوظة إلكترونيًا ضمن نظام طلبات الموظفات — الأثر المالي مرتبط بالـPayroll ولا يغيّر رصيد الإجازة السنوية.</footer>
    </DocumentPage>
  );
}
