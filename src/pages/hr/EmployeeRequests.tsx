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
  listMyEmployeeRequests,
  type EmployeeRequest,
  type EmployeeRequestStatus,
  type EmployeeRequestType,
} from "../../services/employeeRequests";
import { CoreFilesService } from "../../services/CoreFilesService";
import "../../styles/EmployeeRequests.css";

type Props = { session: HrSession; onPortalChange?: () => void | Promise<void> };
type FormState = Record<string, string | boolean>;

const REQUEST_TYPES = Object.keys(EMPLOYEE_REQUEST_TYPE_LABELS) as EmployeeRequestType[];
const STATUS_OPTIONS = Object.keys(EMPLOYEE_REQUEST_STATUS_LABELS) as EmployeeRequestStatus[];

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
  if (type === "overtime") return { ...common, date: today, startTime: "23:00", endTime: "00:00", taskSummary: "", location: "", requestedByManager: "" };
  if (type === "salary_advance") return { ...common, amount: "", neededDate: today, repaymentMethod: "single", installmentCount: "1", acknowledgement: false };
  if (type === "leave") return { ...common, leaveType: "annual", startDate: "", endDate: "", durationKind: "full_day", partialStartTime: "09:00", partialEndTime: "13:00", contactDuringLeave: "", employeeSignatureDataUrl: "" };
  if (type === "exit_return") return { ...common, expectedExitAt: localDateTimeValue(1), expectedReturnAt: localDateTimeValue(3), destination: "", contactMethod: "" };
  return { ...common, submissionDate: today, proposedLastWorkingDay: today, noticeDays: "30", hasAssetsToReturn: false, acknowledgement: false };
}

function formatDateTime(value: string | null | undefined) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) return String(value || "—");
  return new Intl.DateTimeFormat("ar-SA", {
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
  const hidden = new Set(["acknowledgement", "employeeSignatureDataUrl"]);
  return Object.entries(payload || {}).filter(([key, value]) => !hidden.has(key) && value !== "" && value !== null && value !== undefined);
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
  neededDate: "تاريخ الحاجة",
  repaymentMethod: "طريقة الاستقطاع",
  installmentCount: "عدد الأقساط",
  leaveType: "نوع الإجازة",
  startDate: "بداية الإجازة",
  endDate: "نهاية الإجازة",
  durationKind: "مدة الإجازة",
  partialStartTime: "بداية الإجازة الجزئية",
  partialEndTime: "نهاية الإجازة الجزئية",
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
      <select name={name} value={value} onChange={(event) => onChange(name, event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function RequestForm({ type, employeeId, employeeName, onCreated, onClose }: {
  type: EmployeeRequestType;
  employeeId: string;
  employeeName: string;
  onCreated: (request: EmployeeRequest) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => initialForm(type));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attachment, setAttachment] = useState<File | null>(null);

  useEffect(() => { setForm(initialForm(type)); setAttachment(null); }, [type]);
  const update = (name: string, value: string | boolean) => setForm((current) => ({ ...current, [name]: value }));
  const leaveSignatureMissing = type === "leave" && !String(form.employeeSignatureDataUrl || "").startsWith("data:image/");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (type === "leave") {
        const startDate = String(form.startDate || "");
        const endDate = String(form.endDate || "");
        if (!startDate || !endDate) throw new Error("حدد تاريخ بداية الإجازة وتاريخ العودة قبل الإرسال.");
        if (endDate <= startDate) throw new Error("يجب أن يكون تاريخ العودة بعد تاريخ بداية الإجازة.");
        if (leaveSignatureMissing) throw new Error("يجب توقيع طلب الإجازة بخط اليد قبل الإرسال.");
      }
      if (attachment && attachment.size > 10 * 1024 * 1024) throw new Error("حجم المرفق يتجاوز 10 ميجابايت.");
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
          window.alert(`تم إنشاء الطلب ${request.request_number}، لكن تعذر رفع المرفق: ${String((uploadError as Error)?.message || "خطأ غير معروف")}`);
        }
      }
      onCreated(request);
    } catch (cause) {
      setError(employeeRequestErrorMessage(cause, String((cause as Error)?.message || "تعذر إرسال الطلب.")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="employee-request-modal" role="dialog" aria-modal="true">
      <div className="employee-request-modal__panel">
        <header>
          <div>
            <small>إنشاء طلب جديد</small>
            <h2>{EMPLOYEE_REQUEST_TYPE_LABELS[type]}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="إغلاق"><FontAwesomeIcon icon={faXmark} /></button>
        </header>
        <form onSubmit={submit}>
          {type === "leave" ? (
            <div className="leave-request-form-shell">
              <LeaveRequestFormFields employeeName={employeeName} form={form} update={update} />
            </div>
          ) : (
            <>
              <div className="employee-request-form-grid">
                {type === "attendance_correction" ? <>
                  <TextField label="التاريخ" name="date" type="date" required value={String(form.date)} onChange={update} />
                  <SelectField label="نوع التصحيح" name="correctionType" value={String(form.correctionType)} onChange={update} options={[
                    { value: "add_check_in", label: "إضافة حضور" }, { value: "add_check_out", label: "إضافة انصراف" },
                    { value: "update_check_in", label: "تعديل حضور" }, { value: "update_check_out", label: "تعديل انصراف" },
                    { value: "delete_record", label: "حذف بصمة خاطئة" },
                  ]} />
                  <TextField label="الوقت الحالي إن وجد" name="currentTime" type="time" value={String(form.currentTime)} onChange={update} />
                  {form.correctionType !== "delete_record" ? <TextField label="الوقت المطلوب" name="requestedTime" type="time" required value={String(form.requestedTime)} onChange={update} /> : null}
                  <TextField label="معرف السجل إن وجد" name="recordId" value={String(form.recordId)} onChange={update} />
                </> : null}
                {type === "permission" ? <>
                  <TextField label="تاريخ الاستئذان" name="date" type="date" required value={String(form.date)} onChange={update} />
                  <TextField label="وقت الخروج" name="startTime" type="time" required value={String(form.startTime)} onChange={update} />
                  <TextField label="وقت العودة" name="endTime" type="time" required value={String(form.endTime)} onChange={update} />
                </> : null}
                {type === "overtime" ? <>
                  <TextField label="التاريخ" name="date" type="date" required value={String(form.date)} onChange={update} />
                  <TextField label="وقت البداية" name="startTime" type="time" required value={String(form.startTime)} onChange={update} />
                  <TextField label="وقت النهاية" name="endTime" type="time" required value={String(form.endTime)} onChange={update} />
                  <TextField label="المهمة المنفذة" name="taskSummary" required value={String(form.taskSummary)} onChange={update} />
                  <TextField label="الفرع أو الموقع" name="location" value={String(form.location)} onChange={update} />
                  <TextField label="المدير الذي طلب العمل" name="requestedByManager" value={String(form.requestedByManager)} onChange={update} />
                </> : null}
                {type === "salary_advance" ? <>
                  <TextField label="المبلغ المطلوب بالريال" name="amount" type="number" min="1" required value={String(form.amount)} onChange={update} />
                  <TextField label="تاريخ الحاجة" name="neededDate" type="date" required value={String(form.neededDate)} onChange={update} />
                  <SelectField label="طريقة الاستقطاع" name="repaymentMethod" value={String(form.repaymentMethod)} onChange={update} options={[{ value: "single", label: "دفعة واحدة" }, { value: "installments", label: "أقساط" }]} />
                  {form.repaymentMethod === "installments" ? <TextField label="عدد الأقساط" name="installmentCount" type="number" min="2" max="24" required value={String(form.installmentCount)} onChange={update} /> : null}
                </> : null}
                {type === "exit_return" ? <>
                  <TextField label="الخروج المتوقع" name="expectedExitAt" type="datetime-local" required value={String(form.expectedExitAt)} onChange={update} />
                  <TextField label="العودة المتوقعة" name="expectedReturnAt" type="datetime-local" required value={String(form.expectedReturnAt)} onChange={update} />
                  <TextField label="الوجهة أو الجهة" name="destination" required value={String(form.destination)} onChange={update} />
                  <TextField label="وسيلة التواصل" name="contactMethod" required value={String(form.contactMethod)} onChange={update} />
                </> : null}
                {type === "resignation" ? <>
                  <TextField label="تاريخ تقديم الاستقالة" name="submissionDate" type="date" required value={String(form.submissionDate)} onChange={update} />
                  <TextField label="آخر يوم عمل مقترح" name="proposedLastWorkingDay" type="date" required min={String(form.submissionDate)} value={String(form.proposedLastWorkingDay)} onChange={update} />
                  <TextField label="مدة الإشعار بالأيام" name="noticeDays" type="number" min="0" max="365" value={String(form.noticeDays)} onChange={update} />
                  <label className="employee-request-check"><input type="checkbox" checked={Boolean(form.hasAssetsToReturn)} onChange={(event) => update("hasAssetsToReturn", event.target.checked)} /><span>يوجد عهد أو ممتلكات للتسليم</span></label>
                </> : null}
              </div>
              <label className="employee-request-field employee-request-field--wide"><span>السبب *</span><textarea required value={String(form.reason)} onChange={(event) => update("reason", event.target.value)} /></label>
              <label className="employee-request-field employee-request-field--wide"><span>ملاحظات إضافية</span><textarea value={String(form.notes)} onChange={(event) => update("notes", event.target.value)} /></label>
            </>
          )}
          <label className="employee-request-field employee-request-field--wide"><span>مرفق اختياري</span><input type="file" accept="image/*,.pdf,.doc,.docx" onChange={(event) => setAttachment(event.target.files?.[0] || null)} /><small>يُحفظ الملف بشكل خاص وآمن، وبحد أقصى 10 ميجابايت.</small></label>
          {type === "salary_advance" || type === "resignation" ? <label className="employee-request-check employee-request-check--ack"><input type="checkbox" required checked={Boolean(form.acknowledgement)} onChange={(event) => update("acknowledgement", event.target.checked)} /><span>أقر بصحة البيانات وأفهم أن الطلب يخضع للمراجعة والاعتماد.</span></label> : null}
          {type === "leave" && leaveSignatureMissing ? <div className="employee-request-error"><FontAwesomeIcon icon={faTriangleExclamation} /> التوقيع بخط اليد مطلوب قبل إرسال طلب الإجازة.</div> : null}
          {error ? <div className="employee-request-error"><FontAwesomeIcon icon={faTriangleExclamation} /> {error}</div> : null}
          <footer><button type="button" className="is-secondary" onClick={onClose}>إلغاء</button><button type="submit" disabled={busy || leaveSignatureMissing}><FontAwesomeIcon icon={faPaperPlane} /> {busy ? "جارٍ الإرسال..." : "إرسال الطلب"}</button></footer>
        </form>
      </div>
    </div>
  );
}

function RequestDetail({ requestId, onBack, onChanged }: { requestId: string; onBack: () => void; onChanged: () => void }) {
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
    catch (cause) { setError(String((cause as Error)?.message || "تعذر تحميل الطلب.")); }
    finally { setLoading(false); }
  }, [requestId]);
  useEffect(() => { void load(); }, [load]);

  const submitComment = async () => {
    if (!request || !comment.trim() || busy) return;
    setBusy(true); setError("");
    try {
      await addEmployeeRequestComment(request.id, comment.trim());
      if (request.status === "needs_info") await employeeRequestAction(request.id, "answer-info", { version: request.version, note: comment.trim() });
      setComment(""); await load(); onChanged();
    } catch (cause) { setError(String((cause as Error)?.message || "تعذر إرسال الرد.")); }
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
    } catch (cause) { setError(String((cause as Error)?.message || "تعذر تنزيل المرفق.")); }
    finally { setBusy(false); }
  };

  const cancel = async () => {
    if (!request || busy) return;
    setBusy(true); setError("");
    try {
      await employeeRequestAction(request.id, "cancel", {
        version: request.version,
        note: cancelReason.trim() || "ألغته الموظفة",
      });
      setCancelDialogOpen(false);
      setCancelReason("");
      await load();
      onChanged();
    } catch (cause) {
      const message = employeeRequestErrorMessage(cause, "تعذر إلغاء الطلب.");
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

  if (loading) return <div className="employee-requests-loading">جاري تحميل تفاصيل الطلب...</div>;
  if (!request) return <div className="employee-request-error">{error || "الطلب غير موجود."}</div>;
  const canCancel = ["submitted", "received", "under_review", "needs_info", "approved"].includes(request.status);
  const timelineEvents = (request.events || []).filter((event) => !["comment_added", "internal_note_added"].includes(event.event_type));
  const existingComments = request.comments || [];
  const requestInfoMessages = (request.events || [])
    .filter((event) => ["request_info", "request-info"].includes(event.event_type) && event.note)
    .filter((event) => !existingComments.some((commentItem) => commentItem.body.trim() === String(event.note || "").trim()))
    .map((event) => ({
      id: `event-message-${event.id}`,
      author_name: event.actor_name || "الإدارة",
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
        <button type="button" onClick={onBack}><FontAwesomeIcon icon={faArrowRight} /> العودة</button>
        <div><small>{request.request_number}</small><h2>{request.title}</h2><span className={`employee-request-status is-${statusTone(request.status)}`}>{EMPLOYEE_REQUEST_STATUS_LABELS[request.status]}</span></div>
      </header>
      {request.rejection_reason ? <div className="employee-request-decision is-danger"><strong>سبب الرفض</strong><p>{request.rejection_reason}</p></div> : null}
      {request.execution_error ? <div className="employee-request-decision is-danger"><strong>تعذر تنفيذ الطلب</strong><p>{employeeRequestExecutionErrorLabel(request.execution_error)}</p></div> : null}
      {request.status === "cancelled" ? (
        <div className="employee-request-decision is-closed">
          <strong>تم إغلاق الطلب</strong>
          <p>{closureEvent?.note || "أُغلق هذا الطلب ولن تُنفذ عليه إجراءات إضافية ما لم تعِد الإدارة فتحه."}</p>
          <div className="employee-request-closed-meta">
            <span>وقت الإغلاق</span>
            <time>{formatDateTime(request.cancelled_at || closureEvent?.created_at || request.updated_at)}</time>
          </div>
        </div>
      ) : null}
      {request.request_type === "leave" ? <LeaveRequestDocument request={request} /> : null}
      <div className="employee-request-detail__grid">
        <article><h3>بيانات الطلب</h3><dl>{readablePayload(request.payload).map(([key, value]) => <div key={key}><dt>{FIELD_LABELS[key] || key}</dt><dd>{typeof value === "boolean" ? (value ? "نعم" : "لا") : String(value)}</dd></div>)}</dl></article>
        <article><h3>متابعة الطلب</h3><dl><div><dt>الحالة</dt><dd>{EMPLOYEE_REQUEST_STATUS_LABELS[request.status]}</dd></div><div><dt>تاريخ الإرسال</dt><dd>{formatDateTime(request.submitted_at)}</dd></div><div><dt>آخر تحديث</dt><dd>{formatDateTime(request.updated_at)}</dd></div>{request.status === "cancelled" ? <div><dt>وقت الإغلاق</dt><dd>{formatDateTime(request.cancelled_at || closureEvent?.created_at || request.updated_at)}</dd></div> : null}<div><dt>المسؤول</dt><dd>{request.assigned_to_name || "لم يعيّن بعد"}</dd></div><div><dt>التنفيذ</dt><dd>{EMPLOYEE_REQUEST_EXECUTION_LABELS[request.execution_status] || request.execution_status}</dd></div></dl></article>
      </div>
      <article className="employee-request-attachments"><h3>المرفقات</h3>{(request.attachments || []).length ? <div className="employee-request-attachments__list">{(request.attachments || []).map((item) => <button type="button" key={item.id} disabled={busy || !item.file_metadata_id} onClick={() => void downloadAttachment(item.file_metadata_id || "", item.file_name)}><FontAwesomeIcon icon={faFileCircleCheck} /><span><strong>{item.file_name}</strong><small>{item.file_type || "ملف"}</small></span></button>)}</div> : <p className="employee-requests-empty-text">لا توجد مرفقات.</p>}</article>
      <div className="employee-request-communication-grid">
        <article className="employee-request-conversation">
          <header><div><h3><FontAwesomeIcon icon={faCommentDots} /> محادثة الطلب</h3><p>تواصل مباشر مع الإدارة بعيدًا عن سجل الإجراءات.</p></div><span>{conversation.length}</span></header>
          <div className="employee-request-conversation__messages">
            {conversation.length ? conversation.map((item) => {
              const isEmployee = ["staff", "employee"].includes(String(item.author_role || "").toLowerCase());
              return <div key={item.id} className={`employee-request-message ${isEmployee ? "is-employee" : "is-admin"}`}><div><strong>{item.author_name || (isEmployee ? "الموظفة" : "الإدارة")}</strong></div><p>{item.body}</p><time>{formatDateTime(item.created_at)}</time></div>;
            }) : <p className="employee-request-conversation__empty">لا توجد رسائل حتى الآن.</p>}
          </div>
          <div className="employee-request-composer">
            <textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder={request.status === "needs_info" ? "اكتب المعلومات المطلوبة..." : "اكتب ردًا أو استفسارًا..."} />
            <div><span /><button type="button" disabled={busy || !comment.trim()} onClick={() => void submitComment()}><FontAwesomeIcon icon={faPaperPlane} /> إرسال</button></div>
          </div>
        </article>
        <article className="employee-request-timeline employee-request-timeline--operations">
          <header><h3><FontAwesomeIcon icon={faClockRotateLeft} /> سجل الإجراءات</h3><p>الحالات والقرارات والتنفيذ فقط.</p></header>
          <div className="employee-request-timeline__list">{timelineEvents.map((event) => <div className="employee-request-timeline__item" key={event.id}><span /><div><strong>{employeeRequestEventLabel(event.event_type)}</strong><small>{formatDateTime(event.created_at)} {event.actor_name ? `• ${event.actor_name}` : ""}</small>{event.note && !["request_info", "request-info"].includes(event.event_type) ? <p>{event.note}</p> : null}</div></div>)}</div>
        </article>
      </div>
      {error ? <div className="employee-request-error">{error}</div> : null}
      {canCancel ? <button type="button" className="employee-request-cancel" disabled={busy} onClick={() => setCancelDialogOpen(true)}>إلغاء الطلب</button> : null}
      {cancelDialogOpen ? createPortal(
        <div className="employee-request-action-modal" role="dialog" aria-modal="true" aria-labelledby="employee-cancel-request-title">
          <button type="button" className="employee-request-action-modal__backdrop" aria-label="إغلاق" onClick={() => !busy && setCancelDialogOpen(false)} />
          <section className="employee-request-action-modal__panel">
            <header><div><small>{request.request_number}</small><h2 id="employee-cancel-request-title">إلغاء الطلب</h2><p>لن يمكن إلغاء الطلب بعد بدء تنفيذه. اكتب السبب عند الحاجة ثم أكد الإلغاء.</p></div><button type="button" onClick={() => setCancelDialogOpen(false)} disabled={busy}><FontAwesomeIcon icon={faXmark} /></button></header>
            <div className="employee-request-action-modal__body"><label className="employee-request-action-field"><span>سبب الإلغاء <small>اختياري</small></span><textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="اكتب سبب الإلغاء..." /></label></div>
            <footer><button type="button" className="is-secondary" onClick={() => setCancelDialogOpen(false)} disabled={busy}>تراجع</button><button type="button" className="is-danger" onClick={() => void cancel()} disabled={busy}>{busy ? "جارٍ الإلغاء..." : "تأكيد الإلغاء"}</button></footer>
          </section>
        </div>, document.body
      ) : null}
    </section>
  );
}

export default function EmployeeRequestsPage({ session, onPortalChange }: Props) {
  const navigate = useNavigate();
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
    catch (cause) { setError(String((cause as Error)?.message || "تعذر تحميل الطلبات.")); }
    finally { setLoading(false); }
  }, [statusFilter, typeFilter]);
  useEffect(() => { if (!requestId) void load(); }, [load, requestId]);

  const newType = REQUEST_TYPES.includes(requestedType as EmployeeRequestType) ? requestedType as EmployeeRequestType : null;
  const closeForm = () => { searchParams.delete("new"); setSearchParams(searchParams, { replace: true }); };

  if (requestId) return <RequestDetail requestId={requestId} onBack={() => navigate("/employee/requests")} onChanged={() => { void onPortalChange?.(); }} />;

  return (
    <div className="employee-requests-page">
      <header className="employee-requests-hero"><div><small>الخدمة الذاتية</small><h1>طلباتي</h1><p>أنشئ الطلب وتابع الاستلام والمراجعة والقرار والتنفيذ من مكان واحد.</p></div><button type="button" onClick={() => setSearchParams({ new: "attendance_correction" })}><FontAwesomeIcon icon={faPlus} /> طلب جديد</button></header>
      <div className="employee-requests-filters"><span><FontAwesomeIcon icon={faFilter} /> تصفية</span><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as EmployeeRequestType | "")}><option value="">كل الأنواع</option>{REQUEST_TYPES.map((type) => <option value={type} key={type}>{EMPLOYEE_REQUEST_TYPE_LABELS[type]}</option>)}</select><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as EmployeeRequestStatus | "")}><option value="">كل الحالات</option>{STATUS_OPTIONS.map((status) => <option value={status} key={status}>{EMPLOYEE_REQUEST_STATUS_LABELS[status]}</option>)}</select><button type="button" onClick={() => void load()}><FontAwesomeIcon icon={faRotate} /></button></div>
      {error ? <div className="employee-request-error">{error}</div> : null}
      {loading ? <div className="employee-requests-loading">جاري تحميل الطلبات...</div> : rows.length ? <div className="employee-requests-list">{rows.map((request) => <button type="button" className={`employee-request-card ${request.status === "cancelled" ? "is-closed" : ""}`} key={request.id} onClick={() => navigate(`/employee/requests/${request.id}`)}><span className="employee-request-card__icon"><FontAwesomeIcon icon={request.status === "completed" ? faCheckCircle : request.status === "cancelled" ? faXmark : faFileCircleCheck} /></span><div><small>{request.request_number}</small><strong>{request.title}</strong><p>{request.status === "cancelled" ? `تم إغلاق الطلب • ${formatDateTime(request.cancelled_at || request.updated_at)}` : `${formatDateTime(request.submitted_at)} • آخر تحديث ${formatDateTime(request.updated_at)}`}</p></div><span className={`employee-request-status is-${statusTone(request.status)}`}>{EMPLOYEE_REQUEST_STATUS_LABELS[request.status]}</span></button>)}</div> : <div className="employee-requests-empty"><FontAwesomeIcon icon={faCalendarDays} /><h2>لا توجد طلبات</h2><p>أنشئ أول طلب ليصل مباشرة إلى إدارة الموارد البشرية.</p></div>}
      {newType ? <RequestForm type={newType} employeeId={String(session.employeeId || session.uid)} employeeName={String(session.displayName || session.email || "الموظفة")} onClose={closeForm} onCreated={(request) => { setSuccess(request); closeForm(); void load(); void onPortalChange?.(); }} /> : null}
      {success ? <div className="employee-request-modal" role="dialog" aria-modal="true"><div className="employee-request-success"><FontAwesomeIcon icon={faCheckCircle} /><small>تم استلام الطلب</small><h2>{success.request_number}</h2><p>{EMPLOYEE_REQUEST_TYPE_LABELS[success.request_type]}</p><span>{EMPLOYEE_REQUEST_STATUS_LABELS[success.status]} • {formatDateTime(success.submitted_at)}</span><div><button type="button" onClick={() => setSuccess(null)}>إغلاق</button><button type="button" onClick={() => navigate(`/employee/requests/${success.id}`)}>عرض التفاصيل</button></div></div></div> : null}
    </div>
  );
}
