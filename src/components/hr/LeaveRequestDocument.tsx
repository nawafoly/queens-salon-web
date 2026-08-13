import malikatLogo from "../../assets/images/ssunnamed.png";
import type { EmployeeRequest } from "../../services/employeeRequests";
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
} from "../../documents/core/DocumentPage";
import DashboardDatePickerV2 from "../dashboard-v2/DashboardDatePickerV2";
import SignatureCaptureField from "./SignatureCaptureField";
import "../../styles/LeaveRequestDocument.css";
import "../../styles/LeaveRequestDatePicker.css";

export type LeaveRequestFormState = Record<string, string | boolean>;

type FormProps = {
  employeeName: string;
  form: LeaveRequestFormState;
  update: (name: string, value: string | boolean) => void;
};

type DocumentProps = {
  request: EmployeeRequest;
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

function MalikatDocumentLogo() {
  return (
    <div className="leave-doc-brand" aria-label="شعار ملكات">
      <img src={malikatLogo} alt="شعار ملكات" />
    </div>
  );
}

function LeaveTypeRow({ options }: { options: LeaveRequestDocumentOption[] }) {
  return (
    <div className="leave-doc-type-row" role="group" aria-label="نوع الإجازة">
      {options.map((item) => (
        <CheckBox key={item.value} checked={item.checked} label={item.label} />
      ))}
    </div>
  );
}

function SignatureBlock({ signature }: { signature: LeaveRequestDocumentData["employeeSignature"] }) {
  return (
    <div className="leave-doc-signature-cell">
      <span>{signature.label}</span>
      {signature.imageDataUrl ? (
        <img className="leave-doc-signature-image" src={signature.imageDataUrl} alt={`توقيع ${signature.signerName}`} />
      ) : (
        <strong>{signature.fallback}</strong>
      )}
      {signature.signedAt ? <small>{signature.signedAt}</small> : null}
    </div>
  );
}

export function LeaveRequestFormFields({ employeeName, form, update }: FormProps) {
  const startDate = String(form.startDate || "");
  const endDate = String(form.endDate || "");
  const days = leaveDays(startDate, endDate);
  const requestDate = todayDocumentDateKey();
  const employeeSignature = String(form.employeeSignatureDataUrl || "");

  const updateStartDate = (value: string) => {
    update("startDate", value);
    if (value && endDate && endDate <= value) update("endDate", "");
  };

  return (
    <DocumentPage className="leave-doc leave-doc--editable" labelledBy="leave-request-draft-title">
      <img className="leave-doc-watermark" src={malikatLogo} alt="" aria-hidden="true" />
      <header className="leave-doc-header">
        <MalikatDocumentLogo />
        <h2 id="leave-request-draft-title">طلب إجازة</h2>
      </header>

      <LeaveTypeRow
        options={LEAVE_TYPE_OPTIONS.slice(0, 3).map((item) => ({
          ...item,
          checked: String(form.leaveType || "") === item.value,
        }))}
      />

      <div className="leave-doc-letter">
        <p className="leave-doc-addressee">{LEAVE_REQUEST_ADDRESSEE}</p>
        <p>الموقرين</p>
        <p className="leave-doc-greeting">السلام عليكم ورحمة الله وبركاته،،</p>
        <p>
          أتقدم لكم بطلبي هذا راجية الموافقة على منحي إجازة لمدة
          <strong className="leave-doc-inline-value"> {days || "___"} </strong>
          {days === 1 ? "يوم" : "أيام"}، اعتبارًا من التاريخ الموضح أدناه.
        </p>
      </div>

      <DocumentFieldGrid>
        <div className="leave-doc-date-field dashboard-v2">
          <span>من تاريخ</span>
          <DashboardDatePickerV2
            value={startDate}
            required
            clearable
            placeholder="اختر تاريخ البداية"
            onChange={updateStartDate}
          />
        </div>
        <div className="leave-doc-date-field dashboard-v2">
          <span>إلى تاريخ</span>
          <DashboardDatePickerV2
            value={endDate}
            min={startDate || undefined}
            required
            clearable
            placeholder="اختر تاريخ النهاية"
            onChange={(value) => update("endDate", value)}
          />
        </div>
        <DocumentField label="عدد الأيام" value={days || "—"} />
        <DocumentField label="تاريخ الطلب" value={formatDocumentDate(requestDate)} />
      </DocumentFieldGrid>

      <label className="leave-doc-wide-field">
        <span>سبب الإجازة</span>
        <textarea required value={String(form.reason || "")} onChange={(event) => update("reason", event.target.value)} />
      </label>
      <label className="leave-doc-wide-field">
        <span>ملاحظات إضافية</span>
        <textarea value={String(form.notes || "")} onChange={(event) => update("notes", event.target.value)} />
      </label>

      <div className="leave-doc-signature-row">
        <div className="leave-doc-signature-cell">
          <span>الاسم</span>
          <strong>{employeeName || "الموظفة"}</strong>
        </div>
        <SignatureCaptureField
          compact
          required
          label="توقيع الموظفة"
          signerName={employeeName || "الموظفة"}
          value={employeeSignature}
          onChange={(signature) => update("employeeSignatureDataUrl", signature)}
        />
      </div>

      <DocumentSection title="رأي المدير الإداري" className="leave-doc-admin-block is-preview">
        <p>يُستكمل هذا القسم من الإدارة بعد وصول الطلب، ولا يعتمد القرار بدون توقيع المراجع أو المسؤول.</p>
        <div className="leave-doc-admin-options">
          <CheckBox checked={false} label="مع الموافقة" />
          <CheckBox checked={false} label="أخرى" />
        </div>
      </DocumentSection>
    </DocumentPage>
  );
}

function LeaveRequestDocumentView({ data }: { data: LeaveRequestDocumentData }) {
  return (
    <DocumentPage className="leave-doc leave-request-print-root" labelledBy="leave-request-document-title">
      <img className="leave-doc-watermark" src={malikatLogo} alt="" aria-hidden="true" />
      <header className="leave-doc-header">
        <MalikatDocumentLogo />
        <h2 id="leave-request-document-title">{data.title}</h2>
      </header>

      <div className="leave-doc-number">رقم الطلب: <strong>{data.requestNumber}</strong></div>
      <LeaveTypeRow options={data.leaveTypeOptions} />

      <div className="leave-doc-letter">
        <p className="leave-doc-addressee">{data.addressee}</p>
        <p>الموقرين</p>
        <p className="leave-doc-greeting">السلام عليكم ورحمة الله وبركاته،،</p>
        <p>
          أتقدم لكم بطلبي هذا راجية الموافقة على منحي إجازة لمدة
          <strong className="leave-doc-inline-value"> {data.leaveDays || "___"} </strong>
          {data.leaveDays === 1 ? "يوم" : "أيام"}، اعتبارًا من يوم
          <strong className="leave-doc-inline-value"> {data.fields[0]?.value} </strong>
          وحتى يوم
          <strong className="leave-doc-inline-value"> {data.fields[1]?.value} </strong>.
        </p>
      </div>

      <DocumentFieldGrid>
        {data.fields.map((field) => <DocumentField key={field.label} label={field.label} value={field.value} />)}
      </DocumentFieldGrid>

      <DocumentLongText label="سبب الإجازة" value={data.reason} />
      {data.notes !== "—" ? <DocumentLongText label="ملاحظات" value={data.notes} /> : null}

      <div className="leave-doc-signature-row">
        <div className="leave-doc-signature-cell">
          <span>الاسم</span>
          <strong>{data.employeeName}</strong>
        </div>
        <SignatureBlock signature={data.employeeSignature} />
      </div>

      <DocumentSection title="رأي المدير الإداري" className="leave-doc-manager-opinion">
        <p>مع التحية والتقدير لإدارة مؤسسة صالون أحمد العليان (ملكات)</p>
        <p>تمت مراجعة الطلب واتخاذ القرار الموضح أدناه وفق ظروف العمل والأنظمة المعتمدة.</p>
        <div className="leave-doc-signature-row">
          <div className="leave-doc-signature-cell">
            <span>الاسم</span>
            <strong>{data.managerName}</strong>
            {data.managerRole ? <small>{data.managerRole}</small> : null}
          </div>
          <SignatureBlock signature={data.managerSignature} />
        </div>
      </DocumentSection>

      <DocumentSection title="مرئيات الإدارة" className="leave-doc-admin-block">
        <div className="leave-doc-admin-options">
          {data.managerDecisionOptions.map((option) => <CheckBox key={option.value} checked={option.checked} label={option.label} />)}
        </div>
        <DocumentLongText label="الملاحظات / القرار" value={data.managerDecisionNote} />
        <div className="leave-doc-admin-footer">
          <span>التوقيع أعلاه معتمد إلكترونيًا</span>
          <span>الختم</span>
        </div>
      </DocumentSection>

      <footer className="leave-doc-copy-note">نسخة محفوظة إلكترونيًا ضمن نظام طلبات الموظفات</footer>
    </DocumentPage>
  );
}

export default function LeaveRequestDocument({ request }: DocumentProps) {
  return <LeaveRequestDocumentView data={buildLeaveRequestDocumentData(request)} />;
}
