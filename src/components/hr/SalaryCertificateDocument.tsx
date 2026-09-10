import type { EmployeeRequest } from "../../services/employeeRequests";
import { DOCUMENT_BRANDING } from "./documentBranding";
import "../../styles/LeaveRequestDocument.css";

function money(value: unknown) {
  return `${(Number(value || 0) / 100).toLocaleString("ar-SA-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ريال`;
}

function formatDate(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return "—";
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return text;
  return new Intl.DateTimeFormat("ar-SA-u-nu-latn", { timeZone: "Asia/Riyadh", year: "numeric", month: "long", day: "numeric" }).format(new Date(parsed));
}

function approvalPayload(request: EmployeeRequest) {
  const event = [...(request.events || [])].reverse().find((item) => ["approve", "approved"].includes(String(item.event_type || "").toLowerCase()));
  if (!event?.payload_json) return {} as Record<string, unknown>;
  try {
    const parsed = JSON.parse(event.payload_json);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {} as Record<string, unknown>;
  }
}

export default function SalaryCertificateDocument({ request }: { request: EmployeeRequest }) {
  const payload = request.payload || {};
  const approval = approvalPayload(request);
  const signerName = String(approval.reviewerName || approval.certificateSignerName || "").trim();
  const signature = String(approval.reviewerSignatureDataUrl || "").trim();
  const approved = ["approved", "executing", "completed"].includes(request.status);

  return (
    <section className="leave-doc" dir="rtl" data-salary-certificate-document>
      <div className="leave-doc__watermark" aria-hidden="true"><img src={DOCUMENT_BRANDING.logoUrl} alt="" /></div>
      <header className="leave-doc__header">
        <div className="leave-doc__brand">
          <img src={DOCUMENT_BRANDING.logoUrl} alt={DOCUMENT_BRANDING.companyName} />
          <div><strong>{DOCUMENT_BRANDING.companyName}</strong><span>{DOCUMENT_BRANDING.companyNameEn}</span></div>
        </div>
        <div className="leave-doc__request-meta"><span>رقم الخطاب</span><strong>{request.request_number}</strong><small>{formatDate(request.approved_at || request.submitted_at)}</small></div>
      </header>

      <div className="leave-doc__title"><h2>تعريف بالراتب</h2><p>Salary Certificate</p></div>

      <div className="leave-doc__section">
        <h3>إلى: {String(payload.addressee || "—")}</h3>
        <p style={{ lineHeight: 2, margin: 0 }}>
          تشهد {DOCUMENT_BRANDING.companyName} بأن الموظفة <strong>{request.employee_name_snapshot || String(payload.employeeNameSnapshot || "—")}</strong>{" "}
          تعمل لدينا بمسمى <strong>{String(payload.jobTitleSnapshot || "—")}</strong>
          {payload.employmentStartDateSnapshot ? <> منذ تاريخ <strong>{formatDate(payload.employmentStartDateSnapshot)}</strong></> : null}، وقد صدر لها هذا التعريف بناءً على طلبها لتقديمه إلى <strong>{String(payload.addressee || "—")}</strong>، دون أدنى مسؤولية على المنشأة تجاه الغير.
        </p>
      </div>

      <div className="leave-doc__section">
        <h3>بيانات الراتب</h3>
        <div className="leave-doc__grid">
          <div className="leave-doc__field"><span>الراتب الأساسي</span><strong>{money(payload.baseSalaryHalalas)}</strong></div>
          <div className="leave-doc__field"><span>بدل السكن</span><strong>{money(payload.housingAllowanceHalalas)}</strong></div>
          <div className="leave-doc__field"><span>بدل النقل</span><strong>{money(payload.transportationAllowanceHalalas)}</strong></div>
          <div className="leave-doc__field"><span>بدلات أخرى</span><strong>{money(payload.otherAllowancesHalalas)}</strong></div>
          <div className="leave-doc__field leave-doc__field--wide"><span>إجمالي الراتب الشهري</span><strong>{money(payload.totalSalaryHalalas)}</strong></div>
        </div>
      </div>

      {payload.reason ? <div className="leave-doc__section"><h3>غرض الطلب</h3><p>{String(payload.reason)}</p></div> : null}

      <div className="leave-doc__section">
        <h3>الاعتماد</h3>
        <div className="leave-doc__approval-grid">
          <div className="leave-doc__approval-card">
            <span>اسم المعتمد</span><strong>{approved ? signerName || "—" : "بانتظار الاعتماد"}</strong>
            <span>التوقيع</span>
            {approved && signature.startsWith("data:image/") ? <img src={signature} alt="توقيع المعتمد" className="leave-doc__signature-image" /> : <div className="leave-doc__signature-placeholder">بانتظار التوقيع اليدوي</div>}
          </div>
          <div className="leave-doc__approval-card">
            <span>ختم المنشأة</span>
            <div style={{ minHeight: 120, border: "1px dashed currentColor", borderRadius: 12, display: "grid", placeItems: "center", opacity: 0.75 }}>مكان الختم</div>
          </div>
        </div>
      </div>

      <footer className="leave-doc__footer"><span>{DOCUMENT_BRANDING.companyName}</span><span>{request.request_number}</span></footer>
    </section>
  );
}
