import type { EmployeeRequest } from "../../services/employeeRequests";
import { printSalaryCertificateDocument } from "../../services/salaryCertificateExport";
import { DOCUMENT_BRANDING } from "../../documents/core/documentBranding";
import {
  DocumentField,
  DocumentFieldGrid,
  DocumentLongText,
  DocumentPage,
  DocumentSection,
  DocumentWatermark,
} from "../../documents/core/DocumentPage";
import "../../styles/LeaveRequestDocument.css";

function money(value: unknown) {
  return `${(Number(value || 0) / 100).toLocaleString("ar-SA-u-nu-latn", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ريال`;
}

function formatDate(value: unknown) {
  const text = String(value || "").trim();
  if (!text) return "—";
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return text;
  return new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(parsed));
}

function approvalPayload(request: EmployeeRequest) {
  const event = [...(request.events || [])]
    .reverse()
    .find((item) => ["approve", "approved"].includes(String(item.event_type || "").toLowerCase()));
  if (!event?.payload_json) return {} as Record<string, unknown>;
  try {
    const parsed = JSON.parse(event.payload_json);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {} as Record<string, unknown>;
  }
}

function SignatureBlock({ signature }: { signature: string }) {
  if (!signature.startsWith("data:image/")) {
    return <div className="leave-doc-signature-cell"><span>التوقيع</span><strong>بانتظار التوقيع اليدوي</strong></div>;
  }
  return (
    <div className="leave-doc-signature-cell">
      <span>التوقيع</span>
      <img src={signature} alt="توقيع المعتمد" style={{ maxWidth: 180, maxHeight: 72, objectFit: "contain" }} />
    </div>
  );
}

export default function SalaryCertificateDocument({ request }: { request: EmployeeRequest }) {
  const payload = request.payload || {};
  const approval = approvalPayload(request);
  const signerName = String(approval.reviewerName || approval.certificateSignerName || "").trim();
  const signature = String(approval.reviewerSignatureDataUrl || "").trim();
  const approved = ["approved", "executing", "completed"].includes(request.status);

  return (
    <>
      <div className="leave-request-export-toolbar salary-certificate-export-toolbar">
        <button type="button" className="is-primary" onClick={() => void printSalaryCertificateDocument()}>
          طباعة / حفظ PDF
        </button>
      </div>
      <DocumentPage className="leave-doc salary-certificate-print-root" labelledBy="salary-certificate-document-title">
        <DocumentWatermark src={DOCUMENT_BRANDING.watermarkSource} />
        <header className="leave-doc-header">
          <img src={DOCUMENT_BRANDING.logoSource} alt={DOCUMENT_BRANDING.companyName} className="leave-doc-logo" />
          <h2 id="salary-certificate-document-title">تعريف بالراتب</h2>
        </header>

        <div className="leave-doc-number">رقم الخطاب: <strong>{request.request_number}</strong></div>

        <div className="leave-doc-letter">
          <p className="leave-doc-addressee">إلى: {String(payload.addressee || "—")}</p>
          <p>الموقرين</p>
          <p className="leave-doc-greeting">السلام عليكم ورحمة الله وبركاته،،</p>
          <p>
            تشهد {DOCUMENT_BRANDING.companyName} بأن الموظفة
            <strong className="leave-doc-inline-value"> {request.employee_name_snapshot || String(payload.employeeNameSnapshot || "—")} </strong>
            تعمل لدينا بمسمى
            <strong className="leave-doc-inline-value"> {String(payload.jobTitleSnapshot || "—")} </strong>
            {payload.employmentStartDateSnapshot ? <> منذ تاريخ <strong className="leave-doc-inline-value">{formatDate(payload.employmentStartDateSnapshot)}</strong></> : null}.
            وقد صدر لها هذا التعريف بناءً على طلبها لتقديمه إلى
            <strong className="leave-doc-inline-value"> {String(payload.addressee || "—")} </strong>
            دون أدنى مسؤولية على المنشأة تجاه الغير.
          </p>
        </div>

        <DocumentFieldGrid>
          <DocumentField label="اسم الموظفة" value={request.employee_name_snapshot || String(payload.employeeNameSnapshot || "—")} />
          <DocumentField label="المسمى الوظيفي" value={String(payload.jobTitleSnapshot || "—")} />
          <DocumentField label="تاريخ الالتحاق" value={formatDate(payload.employmentStartDateSnapshot)} />
          <DocumentField label="تاريخ الإصدار" value={formatDate(request.approved_at || request.submitted_at)} />
        </DocumentFieldGrid>

        <DocumentSection title="بيانات الراتب">
          <DocumentFieldGrid>
            <DocumentField label="الراتب الأساسي" value={money(payload.baseSalaryHalalas)} />
            <DocumentField label="بدل السكن" value={money(payload.housingAllowanceHalalas)} />
            <DocumentField label="بدل النقل" value={money(payload.transportationAllowanceHalalas)} />
            <DocumentField label="بدلات أخرى" value={money(payload.otherAllowancesHalalas)} />
            <DocumentField label="إجمالي البدلات" value={money(payload.allowancesHalalas)} />
            <DocumentField label="إجمالي الراتب الشهري" value={money(payload.totalSalaryHalalas)} />
          </DocumentFieldGrid>
        </DocumentSection>

        {payload.reason ? <DocumentLongText label="غرض الطلب" value={String(payload.reason)} /> : null}

        <DocumentSection title="الاعتماد" className="leave-doc-manager-opinion">
          <div className="leave-doc-signature-row">
            <div className="leave-doc-signature-cell">
              <span>اسم المعتمد</span>
              <strong>{approved ? signerName || "—" : "بانتظار الاعتماد"}</strong>
            </div>
            <SignatureBlock signature={approved ? signature : ""} />
          </div>
        </DocumentSection>

        <DocumentSection title="ختم المنشأة" className="leave-doc-admin-block">
          <div style={{ minHeight: 130, border: "1px dashed currentColor", borderRadius: 12, display: "grid", placeItems: "center" }}>
            <strong>مكان الختم</strong>
          </div>
        </DocumentSection>

        <footer className="leave-doc-copy-note">نسخة محفوظة إلكترونيًا ضمن نظام طلبات الموظفات • {request.request_number}</footer>
      </DocumentPage>
    </>
  );
}
