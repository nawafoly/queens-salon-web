import type { EmployeeRequest } from "../../services/employeeRequests";
import type { EmployeePortalLanguage } from "../../features/employee-portal/EmployeePortalLanguage";
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

function money(value: unknown, language: EmployeePortalLanguage = "ar") {
  return `${(Number(value || 0) / 100).toLocaleString(language === "en" ? "en-SA" : "ar-SA-u-nu-latn", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${language === "en" ? "SAR" : "ريال"}`;
}

function formatDate(value: unknown, language: EmployeePortalLanguage = "ar") {
  const text = String(value || "").trim();
  if (!text) return "—";
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) return text;
  return new Intl.DateTimeFormat(language === "en" ? "en-SA" : "ar-SA-u-nu-latn", {
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

function SignatureBlock({ signature, language = "ar" }: { signature: string; language?: EmployeePortalLanguage }) {
  const english = language === "en";
  if (!signature.startsWith("data:image/")) {
    return <div className="leave-doc-signature-cell"><span>{english ? "Signature" : "التوقيع"}</span><strong>{english ? "Awaiting handwritten signature" : "بانتظار التوقيع اليدوي"}</strong></div>;
  }
  return (
    <div className="leave-doc-signature-cell">
      <span>{english ? "Signature" : "التوقيع"}</span>
      <img src={signature} alt={english ? "Approver signature" : "توقيع المعتمد"} style={{ maxWidth: 180, maxHeight: 72, objectFit: "contain" }} />
    </div>
  );
}

export default function SalaryCertificateDocument({ request, language = "ar" }: { request: EmployeeRequest; language?: EmployeePortalLanguage }) {
  const english = language === "en";
  const text = (ar: string, en: string) => english ? en : ar;
  const payload = request.payload || {};
  const approval = approvalPayload(request);
  const signerName = String(approval.reviewerName || approval.certificateSignerName || "").trim();
  const signature = String(approval.reviewerSignatureDataUrl || "").trim();
  const approved = ["approved", "executing", "completed"].includes(request.status);

  return (
    <>
      <div className="leave-request-export-toolbar salary-certificate-export-toolbar">
        <button type="button" className="is-primary" onClick={() => void printSalaryCertificateDocument()}>
          {text("طباعة / حفظ PDF", "Print / save PDF")}
        </button>
      </div>
      <DocumentPage dir={english ? "ltr" : "rtl"} className="leave-doc salary-certificate-print-root" labelledBy="salary-certificate-document-title">
        <DocumentWatermark src={DOCUMENT_BRANDING.watermarkSource} />
        <header className="leave-doc-header">
          <img
            src={DOCUMENT_BRANDING.printLogoSource}
            alt={DOCUMENT_BRANDING.companyName}
            className="leave-doc-logo salary-certificate-logo"
            style={{ filter: DOCUMENT_BRANDING.lightSurfaceLogoFilter }}
          />
          <h2 id="salary-certificate-document-title">{text("تعريف بالراتب", "Salary certificate")}</h2>
        </header>

        <div className="leave-doc-number">{text("رقم الخطاب", "Letter number")}: <strong>{request.request_number}</strong></div>

        <div className="leave-doc-letter">
          <p className="leave-doc-addressee">{text("إلى", "To")}: {String(payload.addressee || "—")}</p>
          <p>{text("الموقرين", "Dear Sir/Madam")}</p>
          <p className="leave-doc-greeting">{text("السلام عليكم ورحمة الله وبركاته،،", "Greetings,")}</p>
          <p>
            {text("تشهد", "This is to certify that")} {DOCUMENT_BRANDING.companyName} {text("بأن الموظف/ة", "employs")}
            <strong className="leave-doc-inline-value"> {request.employee_name_snapshot || String(payload.employeeNameSnapshot || "—")} </strong>
            {text("يعمل/تعمل لدينا بمسمى", "as")}
            <strong className="leave-doc-inline-value"> {String(payload.jobTitleSnapshot || "—")} </strong>
            {payload.employmentStartDateSnapshot ? <> {text("منذ تاريخ", "since")} <strong className="leave-doc-inline-value">{formatDate(payload.employmentStartDateSnapshot, language)}</strong></> : null}.
            {text("وقد صدر له/لها هذا التعريف بناءً على طلبه/طلبها لتقديمه إلى", "This certificate is issued at the employee's request for submission to")}
            <strong className="leave-doc-inline-value"> {String(payload.addressee || "—")} </strong>
            {text("دون أدنى مسؤولية على المنشأة تجاه الغير.", "without any liability to the company toward third parties.")}
          </p>
        </div>

        <DocumentFieldGrid>
          <DocumentField label={text("اسم الموظف/ة", "Employee name")} value={request.employee_name_snapshot || String(payload.employeeNameSnapshot || "—")} />
          <DocumentField label={text("المسمى الوظيفي", "Job title")} value={String(payload.jobTitleSnapshot || "—")} />
          <DocumentField label={text("تاريخ الالتحاق", "Start date")} value={formatDate(payload.employmentStartDateSnapshot, language)} />
          <DocumentField label={text("تاريخ الإصدار", "Issue date")} value={formatDate(request.approved_at || request.submitted_at, language)} />
        </DocumentFieldGrid>

        <DocumentSection title={text("بيانات الراتب", "Salary details")}>
          <DocumentFieldGrid>
            <DocumentField label={text("الراتب الأساسي", "Base salary")} value={money(payload.baseSalaryHalalas, language)} />
            <DocumentField label={text("بدل السكن", "Housing allowance")} value={money(payload.housingAllowanceHalalas, language)} />
            <DocumentField label={text("بدل النقل", "Transportation allowance")} value={money(payload.transportationAllowanceHalalas, language)} />
            <DocumentField label={text("بدلات أخرى", "Other allowances")} value={money(payload.otherAllowancesHalalas, language)} />
            <DocumentField label={text("إجمالي البدلات", "Total allowances")} value={money(payload.allowancesHalalas, language)} />
            <DocumentField label={text("إجمالي الراتب الشهري", "Total monthly salary")} value={money(payload.totalSalaryHalalas, language)} />
          </DocumentFieldGrid>
        </DocumentSection>

        {payload.reason ? <DocumentLongText label={text("غرض الطلب", "Purpose")} value={String(payload.reason)} /> : null}

        <DocumentSection title={text("الاعتماد", "Approval")} className="leave-doc-manager-opinion">
          <div className="leave-doc-signature-row">
            <div className="leave-doc-signature-cell">
              <span>{text("اسم المعتمد", "Approver name")}</span>
              <strong>{approved ? signerName || "—" : text("بانتظار الاعتماد", "Awaiting approval")}</strong>
            </div>
            <SignatureBlock signature={approved ? signature : ""} language={language} />
          </div>
        </DocumentSection>

        <DocumentSection title={text("ختم المنشأة", "Company stamp")} className="leave-doc-admin-block salary-certificate-stamp-section">
          <div className="salary-certificate-stamp-space">
            <img
              src={DOCUMENT_BRANDING.stampSource}
              alt={text("ختم المنشأة", "Company stamp")}
              className="salary-certificate-stamp-image"
            />
          </div>
        </DocumentSection>

        <footer className="leave-doc-copy-note">{text("نسخة محفوظة إلكترونيًا ضمن نظام طلبات الموظفات", "Electronic copy stored in the employee requests system")} • {request.request_number}</footer>
      </DocumentPage>
    </>
  );
}
