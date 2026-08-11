import type { EmployeeRequest } from "../../services/employeeRequests";
import "../../styles/LeaveRequestDocument.css";

export type LeaveRequestFormState = Record<string, string | boolean>;

type FormProps = {
  employeeName: string;
  form: LeaveRequestFormState;
  update: (name: string, value: string | boolean) => void;
};

type DocumentProps = {
  request: EmployeeRequest;
};

export const LEAVE_REQUEST_ADDRESSEE = "السادة / مؤسسة صالون أحمد العليان (ملكات)";

const LEAVE_TYPES = [
  { value: "annual", label: "إجازة اعتيادية" },
  { value: "emergency", label: "إجازة اضطرارية" },
  { value: "unpaid", label: "إجازة استثنائية بدون مرتب" },
] as const;

export function leaveTypeLabel(value: unknown) {
  const normalized = String(value || "");
  return LEAVE_TYPES.find((item) => item.value === normalized)?.label ||
    (normalized === "sick" ? "إجازة مرضية" : normalized || "—");
}

export function leaveDays(start: unknown, end: unknown) {
  const from = String(start || "");
  const to = String(end || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return 0;
  const startDate = new Date(`${from}T00:00:00`);
  const endDate = new Date(`${to}T00:00:00`);
  const diff = Math.floor((endDate.getTime() - startDate.getTime()) / 86400000);
  return diff >= 0 ? diff + 1 : 0;
}

function formatDate(value: unknown) {
  const text = String(value || "");
  if (!text) return "—";
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00`) : new Date(text);
  if (!Number.isFinite(date.getTime())) return text;
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatDateTime(value: unknown) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
    timeZone: "Asia/Riyadh",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

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

export function LeaveRequestFormFields({ employeeName, form, update }: FormProps) {
  const startDate = String(form.startDate || "");
  const endDate = String(form.endDate || "");
  const days = leaveDays(startDate, endDate);
  const requestDate = todayKey();

  return (
    <section className="leave-doc leave-doc--editable" dir="rtl">
      <header className="leave-doc-header">
        <div className="leave-doc-brand" aria-label="ملكات">
          <strong>مَلِكات</strong>
          <small>Malikat</small>
        </div>
        <h2>طلب إجازة</h2>
      </header>

      <div className="leave-doc-type-row" role="group" aria-label="نوع الإجازة">
        {LEAVE_TYPES.map((item) => (
          <CheckBox
            key={item.value}
            checked={String(form.leaveType || "") === item.value}
            label={item.label}
            onClick={() => update("leaveType", item.value)}
          />
        ))}
      </div>

      <div className="leave-doc-letter">
        <p className="leave-doc-addressee">{LEAVE_REQUEST_ADDRESSEE}</p>
        <p>الموقرين</p>
        <p className="leave-doc-greeting">السلام عليكم ورحمة الله وبركاته،،</p>
        <p>
          أتقدم لكم بطلبي هذا راجيةً الموافقة على منحي إجازة لمدة
          <strong className="leave-doc-inline-value"> {days || "___"} </strong>
          {days === 1 ? "يوم" : "أيام"}، اعتبارًا من التاريخ الموضح أدناه.
        </p>
      </div>

      <div className="leave-doc-fields-grid">
        <label>
          <span>من تاريخ</span>
          <input type="date" required value={startDate} onChange={(event) => update("startDate", event.target.value)} />
        </label>
        <label>
          <span>إلى تاريخ</span>
          <input type="date" required min={startDate} value={endDate} onChange={(event) => update("endDate", event.target.value)} />
        </label>
        <div className="leave-doc-static-field">
          <span>عدد الأيام</span>
          <strong>{days || "—"}</strong>
        </div>
        <div className="leave-doc-static-field">
          <span>تاريخ الطلب</span>
          <strong>{formatDate(requestDate)}</strong>
        </div>
      </div>

      <label className="leave-doc-wide-field">
        <span>سبب الإجازة</span>
        <textarea required value={String(form.reason || "")} onChange={(event) => update("reason", event.target.value)} />
      </label>
      <label className="leave-doc-wide-field">
        <span>ملاحظات إضافية</span>
        <textarea value={String(form.notes || "")} onChange={(event) => update("notes", event.target.value)} />
      </label>

      <div className="leave-doc-signature-row">
        <div><span>الاسم</span><strong>{employeeName || "الموظفة"}</strong></div>
        <div><span>التوقيع</span><strong>توقيع إلكتروني عند إرسال الطلب</strong></div>
      </div>

      <section className="leave-doc-admin-block is-preview">
        <h3>رأي المدير الإداري</h3>
        <p>يُستكمل هذا القسم من الإدارة بعد وصول الطلب.</p>
        <div className="leave-doc-admin-options">
          <CheckBox checked={false} label="مع الموافقة" />
          <CheckBox checked={false} label="أخرى" />
        </div>
      </section>
    </section>
  );
}

function decisionInfo(request: EmployeeRequest) {
  const events = request.events || [];
  const decisionEvent = [...events]
    .reverse()
    .find((event) => ["approve", "approved", "reject", "rejected"].includes(String(event.event_type || "").toLowerCase()));
  const approved = ["approved", "executing", "completed"].includes(request.status) ||
    ["approve", "approved"].includes(String(decisionEvent?.event_type || "").toLowerCase());
  const rejected = request.status === "rejected" ||
    ["reject", "rejected"].includes(String(decisionEvent?.event_type || "").toLowerCase());
  return {
    approved,
    rejected,
    actorName: decisionEvent?.actor_name || request.assigned_to_name || "—",
    note: request.rejection_reason || request.decision_note || decisionEvent?.note || "—",
    decidedAt: decisionEvent?.created_at || request.approved_at || request.rejected_at || "",
  };
}

export default function LeaveRequestDocument({ request }: DocumentProps) {
  const payload = request.payload || {};
  const startDate = payload.startDate;
  const endDate = payload.endDate;
  const days = leaveDays(startDate, endDate);
  const decision = decisionInfo(request);
  const employeeName = request.employee_name_snapshot || request.employee_id || "الموظفة";

  return (
    <section className="leave-doc leave-request-print-root" dir="rtl" data-request-number={request.request_number}>
      <header className="leave-doc-header">
        <div className="leave-doc-brand" aria-label="ملكات">
          <strong>مَلِكات</strong>
          <small>Malikat</small>
        </div>
        <h2>طلب إجازة</h2>
      </header>

      <div className="leave-doc-number">رقم الطلب: <strong>{request.request_number}</strong></div>

      <div className="leave-doc-type-row">
        {LEAVE_TYPES.map((item) => (
          <CheckBox key={item.value} checked={String(payload.leaveType || "") === item.value} label={item.label} />
        ))}
      </div>

      <div className="leave-doc-letter">
        <p className="leave-doc-addressee">{LEAVE_REQUEST_ADDRESSEE}</p>
        <p>الموقرين</p>
        <p className="leave-doc-greeting">السلام عليكم ورحمة الله وبركاته،،</p>
        <p>
          أتقدم لكم بطلبي هذا راجيةً الموافقة على منحي إجازة لمدة
          <strong className="leave-doc-inline-value"> {days || "___"} </strong>
          {days === 1 ? "يوم" : "أيام"}، اعتبارًا من يوم
          <strong className="leave-doc-inline-value"> {formatDate(startDate)} </strong>
          وحتى يوم
          <strong className="leave-doc-inline-value"> {formatDate(endDate)} </strong>.
        </p>
      </div>

      <div className="leave-doc-fields-grid leave-doc-fields-grid--print">
        <div className="leave-doc-static-field"><span>من تاريخ</span><strong>{formatDate(startDate)}</strong></div>
        <div className="leave-doc-static-field"><span>إلى تاريخ</span><strong>{formatDate(endDate)}</strong></div>
        <div className="leave-doc-static-field"><span>عدد الأيام</span><strong>{days || "—"}</strong></div>
        <div className="leave-doc-static-field"><span>تاريخ الطلب</span><strong>{formatDate(request.submitted_at)}</strong></div>
      </div>

      <div className="leave-doc-print-text"><span>سبب الإجازة</span><p>{String(payload.reason || "—")}</p></div>
      {payload.notes ? <div className="leave-doc-print-text"><span>ملاحظات</span><p>{String(payload.notes)}</p></div> : null}

      <div className="leave-doc-signature-row">
        <div><span>الاسم</span><strong>{employeeName}</strong></div>
        <div><span>التوقيع</span><strong>توقيع إلكتروني</strong><small>{formatDateTime(request.submitted_at)}</small></div>
      </div>

      <section className="leave-doc-manager-opinion">
        <h3>رأي المدير الإداري</h3>
        <p>مع التحية والتقدير لإدارة مؤسسة صالون أحمد العليان (ملكات)</p>
        <p>تمت مراجعة الطلب واتخاذ القرار الموضح أدناه وفق ظروف العمل والأنظمة المعتمدة.</p>
        <div className="leave-doc-signature-row">
          <div><span>الاسم</span><strong>{decision.actorName}</strong></div>
          <div><span>التوقيع</span><strong>{decision.decidedAt ? "توقيع إلكتروني" : "—"}</strong><small>{decision.decidedAt ? formatDateTime(decision.decidedAt) : ""}</small></div>
        </div>
      </section>

      <section className="leave-doc-admin-block">
        <h3>مرئيات الإدارة</h3>
        <div className="leave-doc-admin-options">
          <CheckBox checked={decision.approved} label="مع الموافقة" />
          <CheckBox checked={decision.rejected} label="أخرى" />
        </div>
        <div className="leave-doc-print-text"><span>الملاحظات / القرار</span><p>{decision.note}</p></div>
        <div className="leave-doc-admin-footer"><span>التوقيع الإلكتروني</span><span>الختم</span></div>
      </section>

      <footer className="leave-doc-copy-note">نسخة محفوظة إلكترونيًا ضمن نظام طلبات الموظفات</footer>
    </section>
  );
}
