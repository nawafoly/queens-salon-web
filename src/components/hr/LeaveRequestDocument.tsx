import type { EmployeeRequest } from "../../services/employeeRequests";
import { DOCUMENT_BRANDING } from "../../documents/core/documentBranding";
import {
  buildLeaveRequestDocumentData,
  formatDocumentDate,
  leaveDays,
  LEAVE_REQUEST_ADDRESSEE,
  LEAVE_TYPE_OPTIONS,
  todayDocumentDateKey,
} from "../../documents/leave/leaveRequestModel";
import type { LeaveRequestDocumentData, LeaveRequestDocumentOption } from "../../documents/leave/leaveRequestModel";
import {
  DocumentField,
  DocumentFieldGrid,
  DocumentLongText,
  DocumentPage,
  DocumentSection,
  DocumentWatermark,
} from "../../documents/core/DocumentPage";
import DashboardDatePickerV2 from "../dashboard-v2/DashboardDatePickerV2";
import SignatureCaptureField from "./SignatureCaptureField";
import "../../styles/LeaveRequestDocument.css";
import "../../styles/LeaveRequestDatePicker.css";
import type { EmployeePortalLanguage } from "../../features/employee-portal/EmployeePortalLanguage";

export type LeaveRequestFormState = Record<string, string | boolean>;

type FormProps = {
  employeeName: string;
  form: LeaveRequestFormState;
  update: (name: string, value: string | boolean) => void;
  language?: EmployeePortalLanguage;
};

type DocumentProps = {
  request: EmployeeRequest;
  language?: EmployeePortalLanguage;
};

const choose = (language: EmployeePortalLanguage, ar: string, en: string) => language === "ar" ? ar : en;

const LEAVE_TYPE_EN: Record<string, string> = {
  annual: "Annual leave", sick: "Sick leave", unpaid: "Unpaid leave", emergency: "Emergency leave", other: "Other",
};

function CheckBox({ checked, label, onClick }: { checked: boolean; label: string; onClick?: () => void }) {
  const interactive = typeof onClick === "function";
  return (
    <button
      className={`leave-doc-checkbox ${checked ? "is-checked" : ""}`}
      type="button"
      onClick={onClick}
      disabled={!interactive}
      aria-pressed={checked}
    >
      <span aria-hidden="true">{checked ? "✓" : ""}</span>
      <strong>{label}</strong>
    </button>
  );
}

function MalikatDocumentLogo({ language = "ar" }: { language?: EmployeePortalLanguage }) {
  return (
    <div className="leave-doc-brand" aria-label={choose(language, "شعار ملكات", "MALIKAT logo")}>
      <img src={DOCUMENT_BRANDING.printLogoSource} alt={choose(language, "شعار ملكات", "MALIKAT logo")} />
    </div>
  );
}

function LeaveTypeRow({ options, language = "ar" }: { options: LeaveRequestDocumentOption[]; language?: EmployeePortalLanguage }) {
  return (
    <div className="leave-doc-type-row" role="group" aria-label={choose(language, "نوع الإجازة", "Leave type")}>
      {options.map((item) => (
        <CheckBox key={item.value} checked={item.checked} label={language === "ar" ? item.label : LEAVE_TYPE_EN[item.value] || item.label} />
      ))}
    </div>
  );
}

function SignatureBlock({ signature, language = "ar" }: { signature: LeaveRequestDocumentData["employeeSignature"]; language?: EmployeePortalLanguage }) {
  return (
    <div className="leave-doc-signature-cell">
      <span>{language === "ar" ? signature.label : "Signature"}</span>
      {signature.imageDataUrl ? (
        <img className="leave-doc-signature-image" src={signature.imageDataUrl} alt={`${language === "ar" ? "توقيع" : "Signature of"} ${signature.signerName}`} />
      ) : (
        <strong>{language === "ar" ? signature.fallback : "Not signed"}</strong>
      )}
      {signature.signedAt ? <small>{signature.signedAt}</small> : null}
    </div>
  );
}

export function LeaveRequestFormFields({ employeeName, form, update, language = "ar" }: FormProps) {
  const startDate = String(form.startDate || "");
  const endDate = String(form.endDate || "");
  const days = leaveDays(startDate, endDate);
  const requestDate = todayDocumentDateKey();
  const employeeSignature = String(form.employeeSignatureDataUrl || "");

  const updateStartDate = (value: string) => {
    update("startDate", value);
    if (value && endDate && endDate < value) update("endDate", "");
  };

  return (
    <DocumentPage className="leave-doc leave-doc--editable" labelledBy="leave-request-draft-title" dir={language === "ar" ? "rtl" : "ltr"}>
      <DocumentWatermark src={DOCUMENT_BRANDING.watermarkSource} />
      <header className="leave-doc-header">
        <MalikatDocumentLogo language={language} />
        <h2 id="leave-request-draft-title">{choose(language, "طلب إجازة", "Leave Request")}</h2>
      </header>

      <LeaveTypeRow
        language={language}
        options={LEAVE_TYPE_OPTIONS.map((item) => ({
          ...item,
          checked: String(form.leaveType || "") === item.value,
        }))}
      />

      <div className="leave-doc-letter">
        <p className="leave-doc-addressee">{language === "ar" ? LEAVE_REQUEST_ADDRESSEE : "To MALIKAT Salon Management"}</p>
        <p>{choose(language, "الموقرين", "Dear Management,")}</p>
        {language === "ar" ? <p className="leave-doc-greeting">السلام عليكم ورحمة الله وبركاته،،</p> : null}
        <p>
          {choose(language, "أتقدم لكم بطلبي هذا راجية الموافقة على منحي إجازة لمدة", "I kindly request approval for leave lasting")}
          <strong className="leave-doc-inline-value"> {days || "___"} </strong>
          {days === 1 ? choose(language, "يوم", "day") : choose(language, "أيام", "days")}{choose(language, "، اعتبارًا من التاريخ الموضح أدناه.", ", starting on the date shown below.")}
        </p>
      </div>

      <DocumentFieldGrid>
        <div className="leave-doc-date-field dashboard-v2">
          <span>{choose(language, "من تاريخ", "From")}</span>
          <DashboardDatePickerV2
            value={startDate}
            required
            clearable
            placeholder={choose(language, "اختر تاريخ البداية", "Select start date")}
            onChange={updateStartDate}
          />
        </div>
        <div className="leave-doc-date-field dashboard-v2">
          <span>{choose(language, "إلى تاريخ", "To")}</span>
          <DashboardDatePickerV2
            value={endDate}
            min={startDate || undefined}
            required
            clearable
            placeholder={choose(language, "اختر تاريخ النهاية", "Select end date")}
            onChange={(value) => update("endDate", value)}
          />
        </div>
        <DocumentField label={choose(language, "عدد الأيام", "Number of days")} value={days || "—"} />
        <DocumentField label={choose(language, "تاريخ الطلب", "Request date")} value={formatDocumentDate(requestDate)} />
      </DocumentFieldGrid>

      <label className="leave-doc-wide-field">
        <span>{choose(language, "سبب الإجازة", "Reason for leave")}</span>
        <textarea required value={String(form.reason || "")} onChange={(event) => update("reason", event.target.value)} />
      </label>
      <label className="leave-doc-wide-field">
        <span>{choose(language, "ملاحظات إضافية", "Additional notes")}</span>
        <textarea value={String(form.notes || "")} onChange={(event) => update("notes", event.target.value)} />
      </label>

      <div className="leave-doc-signature-row">
        <div className="leave-doc-signature-cell">
          <span>{choose(language, "الاسم", "Name")}</span>
          <strong>{employeeName || choose(language, "الموظفة", "Employee")}</strong>
        </div>
        <SignatureCaptureField
          compact
          required
          label={choose(language, "توقيع الموظفة", "Employee signature")}
          signerName={employeeName || choose(language, "الموظفة", "Employee")}
          value={employeeSignature}
          onChange={(signature) => update("employeeSignatureDataUrl", signature)}
        />
      </div>

      <DocumentSection title={choose(language, "رأي المدير الإداري", "Management review")} className="leave-doc-admin-block is-preview">
        <p>{choose(language, "يُستكمل هذا القسم من الإدارة بعد وصول الطلب، ولا يعتمد القرار بدون توقيع المراجع أو المسؤول.", "Management completes this section after receiving the request. The decision is not final without the reviewer’s signature.")}</p>
        <div className="leave-doc-admin-options">
          <CheckBox checked={false} label={choose(language, "مع الموافقة", "Approved")} />
          <CheckBox checked={false} label={choose(language, "أخرى", "Other")} />
        </div>
      </DocumentSection>
    </DocumentPage>
  );
}

function LeaveRequestDocumentView({ data, language = "ar" }: { data: LeaveRequestDocumentData; language?: EmployeePortalLanguage }) {
  const fieldLabelsEn = ["From", "To", "Number of days", "Request date"];
  return (
    <DocumentPage className="leave-doc leave-request-print-root" labelledBy="leave-request-document-title" dir={language === "ar" ? "rtl" : "ltr"}>
      <DocumentWatermark src={DOCUMENT_BRANDING.watermarkSource} />
      <header className="leave-doc-header">
        <MalikatDocumentLogo language={language} />
        <h2 id="leave-request-document-title">{language === "ar" ? data.title : "Leave Request"}</h2>
      </header>

      <div className="leave-doc-number">{choose(language, "رقم الطلب", "Request number")}: <strong>{data.requestNumber}</strong></div>
      <LeaveTypeRow options={data.leaveTypeOptions} language={language} />

      <div className="leave-doc-letter">
        <p className="leave-doc-addressee">{language === "ar" ? data.addressee : "To MALIKAT Salon Management"}</p>
        <p>{choose(language, "الموقرين", "Dear Management,")}</p>
        {language === "ar" ? <p className="leave-doc-greeting">السلام عليكم ورحمة الله وبركاته،،</p> : null}
        <p>
          {choose(language, "أتقدم لكم بطلبي هذا راجية الموافقة على منحي إجازة لمدة", "I kindly request approval for leave lasting")}
          <strong className="leave-doc-inline-value"> {data.leaveDays || "___"} </strong>
          {data.leaveDays === 1 ? choose(language, "يوم", "day") : choose(language, "أيام", "days")}{choose(language, "، اعتبارًا من يوم", ", from")}
          <strong className="leave-doc-inline-value"> {data.fields[0]?.value} </strong>
          {choose(language, "وحتى يوم", "through")}
          <strong className="leave-doc-inline-value"> {data.fields[1]?.value} </strong>.
        </p>
      </div>

      <DocumentFieldGrid>
        {data.fields.map((field, index) => <DocumentField key={field.label} label={language === "ar" ? field.label : fieldLabelsEn[index] || field.label} value={field.value} />)}
      </DocumentFieldGrid>

      <DocumentLongText label={choose(language, "سبب الإجازة", "Reason for leave")} value={data.reason} />
      {data.notes !== "—" ? <DocumentLongText label={choose(language, "ملاحظات", "Notes")} value={data.notes} /> : null}

      <div className="leave-doc-signature-row">
        <div className="leave-doc-signature-cell">
          <span>{choose(language, "الاسم", "Name")}</span>
          <strong>{data.employeeName}</strong>
        </div>
        <SignatureBlock signature={data.employeeSignature} language={language} />
      </div>

      <DocumentSection title={choose(language, "رأي المدير الإداري", "Management review")} className="leave-doc-manager-opinion">
        <p>{choose(language, "مع التحية والتقدير لإدارة مؤسسة صالون أحمد العليان (ملكات)", "With appreciation to MALIKAT Salon Management")}</p>
        <p>{choose(language, "تمت مراجعة الطلب واتخاذ القرار الموضح أدناه وفق ظروف العمل والأنظمة المعتمدة.", "The request was reviewed and the decision below was made according to approved policies and operational needs.")}</p>
        <div className="leave-doc-signature-row">
          <div className="leave-doc-signature-cell">
            <span>{choose(language, "الاسم", "Name")}</span>
            <strong>{data.managerName}</strong>
            {data.managerRole ? <small>{data.managerRole}</small> : null}
          </div>
          <SignatureBlock signature={data.managerSignature} language={language} />
        </div>
      </DocumentSection>

      <DocumentSection title={choose(language, "مرئيات الإدارة", "Management decision")} className="leave-doc-admin-block">
        <div className="leave-doc-admin-options">
          {data.managerDecisionOptions.map((option) => <CheckBox key={option.value} checked={option.checked} label={language === "ar" ? option.label : option.value === "approved" ? "Approved" : option.value === "rejected" ? "Rejected" : "Other"} />)}
        </div>
        <DocumentLongText label={choose(language, "الملاحظات / القرار", "Notes / decision")} value={data.managerDecisionNote} />
        <div className="leave-doc-admin-footer">
          <span>{choose(language, "التوقيع أعلاه معتمد إلكترونيًا", "The signature above is electronically approved")}</span>
          <span>{choose(language, "الختم", "Stamp")}</span>
        </div>
      </DocumentSection>

      <footer className="leave-doc-copy-note">{choose(language, "نسخة محفوظة إلكترونيًا ضمن نظام طلبات الموظفات", "An electronic copy is stored in the employee request system")}</footer>
    </DocumentPage>
  );
}

export default function LeaveRequestDocument({ request, language = "ar" }: DocumentProps) {
  return <LeaveRequestDocumentView data={buildLeaveRequestDocumentData(request)} language={language} />;
}
