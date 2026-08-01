import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRight,
  faBolt,
  faCheck,
  faClock,
  faCommentDots,
  faFilter,
  faInbox,
  faListCheck,
  faLock,
  faMagnifyingGlass,
  faPaperPlane,
  faRotate,
  faTriangleExclamation,
  faUserCheck,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import type { HrSession } from "./shared";
import { CoreFilesService } from "../../services/CoreFilesService";
import { usePermissions } from "../../security/PermissionContext";
import {
  addEmployeeRequestComment,
  employeeRequestAction,
  employeeRequestEventLabel,
  employeeRequestErrorMessage,
  employeeRequestExecutionErrorLabel,
  EMPLOYEE_REQUEST_EXECUTION_LABELS,
  EMPLOYEE_REQUEST_PRIORITY_LABELS,
  EMPLOYEE_REQUEST_STATUS_LABELS,
  EMPLOYEE_REQUEST_TYPE_LABELS,
  getEmployeeRequest,
  getEmployeeRequestStats,
  listEmployeeRequestAssignees,
  listEmployeeRequests,
  type EmployeeRequest,
  type EmployeeRequestAssignee,
  type EmployeeRequestStatus,
  type EmployeeRequestType,
} from "../../services/employeeRequests";
import "../../styles/EmployeeRequests.css";

type Props = { session: HrSession };
type ActionDialogKind =
  | "assign"
  | "request-info"
  | "approve"
  | "reject"
  | "execute"
  | "cancel"
  | "reopen";

type DialogState = {
  kind: ActionDialogKind;
  note: string;
  assigneeUid: string;
  search: string;
  approvedAmount: string;
  financialReference: string;
  firstDeductionMonth: string;
  approvedMinutes: string;
  finalWorkingDay: string;
  confirmClearance: boolean;
};

const TYPES = Object.keys(EMPLOYEE_REQUEST_TYPE_LABELS) as EmployeeRequestType[];
const STATUSES = Object.keys(EMPLOYEE_REQUEST_STATUS_LABELS) as EmployeeRequestStatus[];
const HIDDEN_TIMELINE_EVENTS = new Set(["comment_added", "internal_note_added"]);
const MESSAGE_EVENT_TYPES = new Set(["request_info", "request-info"]);

const FIELD_LABELS: Record<string, string> = {
  reason: "السبب",
  notes: "ملاحظات إضافية",
  date: "التاريخ",
  correctionType: "نوع التصحيح",
  currentTime: "الوقت الحالي",
  requestedTime: "الوقت المطلوب",
  recordId: "معرف السجل",
  startTime: "وقت البداية",
  endTime: "وقت النهاية",
  expectedReturnTime: "وقت العودة المتوقع",
  requestedMinutes: "الدقائق المطلوبة",
  taskSummary: "المهمة",
  location: "الموقع",
  managerName: "المدير",
  amountHalalas: "المبلغ",
  repaymentMethod: "طريقة الاستقطاع",
  installmentCount: "عدد الأقساط",
  neededByDate: "تاريخ الحاجة",
  leaveType: "نوع الإجازة",
  startDate: "تاريخ البداية",
  endDate: "تاريخ النهاية",
  dayPart: "مدة الإجازة",
  expectedExitAt: "الخروج المتوقع",
  expectedReturnAt: "العودة المتوقعة",
  destination: "الوجهة",
  contactMethod: "وسيلة التواصل",
  proposedLastWorkingDay: "آخر يوم مقترح",
  noticeDays: "مدة الإشعار",
  hasAssets: "توجد عهدة",
  acknowledgement: "الإقرار",
};

const ACTION_DIALOG_COPY: Record<ActionDialogKind, { title: string; description: string; confirm: string; tone: string }> = {
  assign: {
    title: "تعيين مسؤول للطلب",
    description: "اختر حسابًا إداريًا نشطًا ليتولى متابعة الطلب واستكمال إجراءاته.",
    confirm: "تأكيد التعيين",
    tone: "primary",
  },
  "request-info": {
    title: "طلب معلومات إضافية",
    description: "اكتب بوضوح ما المطلوب من الموظفة. ستظهر الرسالة داخل محادثة الطلب وتصلها كتنبّه.",
    confirm: "إرسال الطلب",
    tone: "primary",
  },
  approve: {
    title: "اعتماد الطلب",
    description: "راجع البيانات قبل الاعتماد. الملاحظة اختيارية وستظهر ضمن سجل القرار.",
    confirm: "تأكيد الموافقة",
    tone: "success",
  },
  reject: {
    title: "رفض الطلب",
    description: "اكتب سببًا واضحًا للرفض؛ سيظهر للموظفة داخل تفاصيل الطلب.",
    confirm: "تأكيد الرفض",
    tone: "danger",
  },
  execute: {
    title: "بدء تنفيذ الطلب",
    description: "سيتم تنفيذ الأثر التشغيلي الفعلي للطلب بعد التأكيد.",
    confirm: "بدء التنفيذ",
    tone: "primary",
  },
  cancel: {
    title: "إلغاء الطلب إداريًا",
    description: "اكتب سبب الإلغاء. لا يمكن إلغاء طلب اكتمل تنفيذه.",
    confirm: "تأكيد الإلغاء",
    tone: "danger",
  },
  reopen: {
    title: "إعادة فتح الطلب",
    description: "اكتب سبب إعادة الفتح ليعود الطلب إلى المراجعة.",
    confirm: "إعادة فتح الطلب",
    tone: "primary",
  },
};

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

function roleLabel(role: EmployeeRequestAssignee["role"]) {
  if (role === "owner") return "المالك";
  if (role === "admin") return "الإدارة";
  if (role === "hr") return "الموارد البشرية";
  return "المحاسبة";
}

function formatPayloadValue(key: string, value: unknown) {
  if (typeof value === "boolean") return value ? "نعم" : "لا";
  if (key === "amountHalalas") return `${(Number(value || 0) / 100).toLocaleString("ar-SA")} ريال`;
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function payloadEntries(payload: Record<string, unknown>) {
  return Object.entries(payload || {}).filter(([, value]) => value !== "" && value !== null && value !== undefined);
}

function emptyDialog(kind: ActionDialogKind): DialogState {
  return {
    kind,
    note: "",
    assigneeUid: "",
    search: "",
    approvedAmount: "",
    financialReference: "",
    firstDeductionMonth: new Date().toISOString().slice(0, 7),
    approvedMinutes: "",
    finalWorkingDay: "",
    confirmClearance: false,
  };
}

export default function AdminEmployeeRequestsPage(_props: Props) {
  const { hasPermission } = usePermissions();
  const [rows, setRows] = useState<EmployeeRequest[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selected, setSelected] = useState<EmployeeRequest | null>(null);
  const [stats, setStats] = useState<Partial<Record<EmployeeRequestStatus, number>>>({});
  const [overdue, setOverdue] = useState(0);
  const [type, setType] = useState<EmployeeRequestType | "">("");
  const [status, setStatus] = useState<EmployeeRequestStatus | "">("");
  const [employeeId, setEmployeeId] = useState("");
  const [assignedToUid, setAssignedToUid] = useState("");
  const [branch, setBranch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [comment, setComment] = useState("");
  const [internal, setInternal] = useState(false);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [dialogError, setDialogError] = useState("");
  const [assignees, setAssignees] = useState<EmployeeRequestAssignee[]>([]);
  const [assigneesLoading, setAssigneesLoading] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [requestRows, statRows] = await Promise.all([
        listEmployeeRequests({
          type,
          status,
          employeeId: employeeId.trim() || undefined,
          assignedToUid: assignedToUid.trim() || undefined,
          branch: branch.trim() || undefined,
          fromDate: fromDate || undefined,
          toDate: toDate || undefined,
          overdue: overdueOnly || undefined,
          limit: 300,
        }),
        getEmployeeRequestStats(),
      ]);
      setRows(requestRows);
      setStats(statRows.counts || {});
      setOverdue(statRows.overdue || 0);
    } catch (cause) {
      setError(String((cause as Error)?.message || "تعذر تحميل الطلبات."));
    } finally {
      setLoading(false);
    }
  }, [assignedToUid, branch, employeeId, fromDate, overdueOnly, status, toDate, type]);

  const loadSelected = useCallback(async () => {
    if (!selectedId) {
      setSelected(null);
      return;
    }
    try {
      setSelected(await getEmployeeRequest(selectedId));
    } catch (cause) {
      setError(String((cause as Error)?.message || "تعذر تحميل الطلب."));
    }
  }, [selectedId]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    void loadSelected();
  }, [loadSelected]);

  const runAction = async (
    action: Parameters<typeof employeeRequestAction>[1],
    body: Record<string, unknown> = {}
  ): Promise<boolean> => {
    if (!selected || busy) return false;
    setBusy(true);
    setError("");
    setDialogError("");
    try {
      const updated = await employeeRequestAction(selected.id, action, {
        version: selected.version,
        ...body,
      });
      setSelected(await getEmployeeRequest(updated.id));
      await loadList();
      return true;
    } catch (cause) {
      const message = employeeRequestErrorMessage(cause, "تعذر تنفيذ الإجراء.");
      setError(message);
      setDialogError(message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const openDialog = async (kind: ActionDialogKind) => {
    setDialog(emptyDialog(kind));
    setDialogError("");
    if (kind === "assign" && assignees.length === 0) {
      setAssigneesLoading(true);
      try {
        setAssignees(await listEmployeeRequestAssignees());
      } catch (cause) {
        setDialogError(String((cause as Error)?.message || "تعذر تحميل حسابات الإدارة."));
      } finally {
        setAssigneesLoading(false);
      }
    }
  };

  const closeDialog = () => {
    if (busy) return;
    setDialog(null);
    setDialogError("");
  };

  const submitDialog = async () => {
    if (!dialog || !selected || busy) return;
    let action: Parameters<typeof employeeRequestAction>[1];
    const body: Record<string, unknown> = {};

    if (dialog.kind === "assign") {
      const assignee = assignees.find((item) => item.uid === dialog.assigneeUid);
      if (!assignee) {
        setDialogError("اختر المسؤول الذي سيتولى متابعة الطلب.");
        return;
      }
      action = "assign";
      Object.assign(body, {
        assignedToUid: assignee.uid,
        assignedToName: assignee.displayName,
        note: dialog.note.trim() || undefined,
      });
    } else if (dialog.kind === "request-info") {
      if (!dialog.note.trim()) {
        setDialogError("اكتب المعلومات المطلوبة من الموظفة.");
        return;
      }
      action = "request-info";
      body.note = dialog.note.trim();
    } else if (dialog.kind === "approve") {
      action = "approve";
      body.note = dialog.note.trim();
    } else if (dialog.kind === "reject") {
      if (!dialog.note.trim()) {
        setDialogError("سبب الرفض مطلوب.");
        return;
      }
      action = "reject";
      body.reason = dialog.note.trim();
    } else if (dialog.kind === "cancel") {
      if (!dialog.note.trim()) {
        setDialogError("سبب الإلغاء الإداري مطلوب.");
        return;
      }
      action = "cancel";
      body.note = dialog.note.trim();
    } else if (dialog.kind === "reopen") {
      if (!dialog.note.trim()) {
        setDialogError("سبب إعادة فتح الطلب مطلوب.");
        return;
      }
      action = "reopen";
      body.note = dialog.note.trim();
    } else {
      action = "execute";
      body.note = dialog.note.trim();
      if (selected.request_type === "salary_advance") {
        const amount = Number(dialog.approvedAmount);
        if (!Number.isFinite(amount) || amount <= 0) {
          setDialogError("أدخل المبلغ الموافق عليه بشكل صحيح.");
          return;
        }
        if (!dialog.financialReference.trim()) {
          setDialogError("مرجع عملية الصرف مطلوب.");
          return;
        }
        Object.assign(body, {
          approvedAmount: amount,
          financialReference: dialog.financialReference.trim(),
          firstDeductionMonth: dialog.firstDeductionMonth,
        });
      }
      if (selected.request_type === "overtime") {
        const minutes = Number(dialog.approvedMinutes);
        if (!Number.isInteger(minutes) || minutes <= 0) {
          setDialogError("أدخل عدد الدقائق المعتمدة بشكل صحيح.");
          return;
        }
        body.approvedMinutes = minutes;
      }
      if (selected.request_type === "resignation") {
        if (!dialog.finalWorkingDay) {
          setDialogError("حدد آخر يوم عمل الفعلي.");
          return;
        }
        if (!dialog.confirmClearance) {
          setDialogError("يجب تأكيد إخلاء الطرف وتسليم العهد قبل إنهاء الحساب.");
          return;
        }
        Object.assign(body, {
          finalWorkingDay: dialog.finalWorkingDay,
          confirmClearance: true,
          confirmTerminate: true,
        });
      }
    }

    if (await runAction(action, body)) closeDialog();
  };

  const addComment = async () => {
    if (!selected || !comment.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      await addEmployeeRequestComment(
        selected.id,
        comment.trim(),
        internal ? "internal" : "employee"
      );
      setComment("");
      setSelected(await getEmployeeRequest(selected.id));
    } catch (cause) {
      setError(String((cause as Error)?.message || "تعذر إضافة التعليق."));
    } finally {
      setBusy(false);
    }
  };

  const downloadAttachment = async (fileMetadataId: string, fileName: string) => {
    if (!fileMetadataId || busy) return;
    setBusy(true);
    setError("");
    try {
      const blob = await CoreFilesService.download(fileMetadataId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName || "attachment";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(String((cause as Error)?.message || "تعذر تنزيل المرفق."));
    } finally {
      setBusy(false);
    }
  };

  const counts = useMemo(
    () => ({
      submitted: Number(stats.submitted || 0),
      received: Number(stats.received || 0),
      under_review: Number(stats.under_review || 0),
      needs_info: Number(stats.needs_info || 0),
      approved: Number(stats.approved || 0),
      executing: Number(stats.executing || 0),
      completed: Number(stats.completed || 0),
      rejected: Number(stats.rejected || 0),
    }),
    [stats]
  );

  const filteredAssignees = useMemo(() => {
    const search = dialog?.kind === "assign" ? dialog.search.trim().toLowerCase() : "";
    if (!search) return assignees;
    return assignees.filter((item) =>
      [item.displayName, item.email, roleLabel(item.role)]
        .join(" ")
        .toLowerCase()
        .includes(search)
    );
  }, [assignees, dialog]);

  const renderDialog = () => {
    if (!dialog || !selected) return null;
    const copy = ACTION_DIALOG_COPY[dialog.kind];
    return createPortal(
      <div className="employee-request-action-modal" role="dialog" aria-modal="true" aria-labelledby="employee-request-action-title">
        <button type="button" className="employee-request-action-modal__backdrop" aria-label="إغلاق" onClick={closeDialog} />
        <section className="employee-request-action-modal__panel">
          <header>
            <div>
              <small>{selected.request_number}</small>
              <h2 id="employee-request-action-title">{copy.title}</h2>
              <p>{copy.description}</p>
            </div>
            <button type="button" onClick={closeDialog} disabled={busy} aria-label="إغلاق">
              <FontAwesomeIcon icon={faXmark} />
            </button>
          </header>

          <div className="employee-request-action-modal__body">
            {dialog.kind === "assign" ? (
              <>
                <label className="employee-request-action-search">
                  <FontAwesomeIcon icon={faMagnifyingGlass} />
                  <input
                    value={dialog.search}
                    onChange={(event) => setDialog({ ...dialog, search: event.target.value })}
                    placeholder="ابحث بالاسم أو البريد أو الدور"
                  />
                </label>
                <div className="employee-request-assignee-list" role="radiogroup" aria-label="حسابات الإدارة">
                  {assigneesLoading ? (
                    <p>جاري تحميل الحسابات...</p>
                  ) : filteredAssignees.length ? (
                    filteredAssignees.map((item) => {
                      const selectedAssignee = dialog.assigneeUid === item.uid;
                      return (
                        <button
                          type="button"
                          key={item.uid}
                          className={selectedAssignee ? "is-selected" : ""}
                          onClick={() => setDialog({ ...dialog, assigneeUid: item.uid })}
                          role="radio"
                          aria-checked={selectedAssignee}
                        >
                          <span className="employee-request-assignee-avatar">
                            {(item.displayName || item.email || "؟").trim().charAt(0).toUpperCase()}
                          </span>
                          <span className="employee-request-assignee-copy">
                            <strong>{item.displayName || item.email}</strong>
                            <small>{item.email}</small>
                          </span>
                          <em>{roleLabel(item.role)}</em>
                          <span className="employee-request-assignee-check">
                            {selectedAssignee ? <FontAwesomeIcon icon={faCheck} /> : null}
                          </span>
                        </button>
                      );
                    })
                  ) : (
                    <p>لا توجد حسابات مطابقة.</p>
                  )}
                </div>
                <label className="employee-request-action-field">
                  <span>ملاحظة للمسؤول <small>اختياري</small></span>
                  <textarea
                    value={dialog.note}
                    onChange={(event) => setDialog({ ...dialog, note: event.target.value })}
                    placeholder="مثال: راجع سجل الحضور قبل الاعتماد"
                  />
                </label>
              </>
            ) : null}

            {dialog.kind !== "assign" && dialog.kind !== "execute" ? (
              <label className="employee-request-action-field">
                <span>
                  {dialog.kind === "request-info"
                    ? "المعلومات المطلوبة"
                    : dialog.kind === "reject"
                      ? "سبب الرفض"
                      : dialog.kind === "cancel"
                        ? "سبب الإلغاء"
                        : dialog.kind === "reopen"
                          ? "سبب إعادة الفتح"
                          : "ملاحظة الموافقة"}
                  {dialog.kind === "approve" ? <small>اختياري</small> : null}
                </span>
                <textarea
                  autoFocus
                  value={dialog.note}
                  onChange={(event) => setDialog({ ...dialog, note: event.target.value })}
                  placeholder={dialog.kind === "request-info" ? "اكتب المطلوب بالتفصيل..." : "اكتب الملاحظة هنا..."}
                />
              </label>
            ) : null}

            {dialog.kind === "execute" ? (
              <div className="employee-request-execution-form">
                {selected.request_type === "salary_advance" ? (
                  <>
                    <label className="employee-request-action-field">
                      <span>المبلغ الموافق عليه بالريال</span>
                      <input type="number" min="1" step="0.01" value={dialog.approvedAmount} onChange={(event) => setDialog({ ...dialog, approvedAmount: event.target.value })} />
                    </label>
                    <label className="employee-request-action-field">
                      <span>مرجع عملية الصرف</span>
                      <input value={dialog.financialReference} onChange={(event) => setDialog({ ...dialog, financialReference: event.target.value })} />
                    </label>
                    <label className="employee-request-action-field">
                      <span>أول شهر استقطاع</span>
                      <input type="month" value={dialog.firstDeductionMonth} onChange={(event) => setDialog({ ...dialog, firstDeductionMonth: event.target.value })} />
                    </label>
                  </>
                ) : null}
                {selected.request_type === "overtime" ? (
                  <label className="employee-request-action-field">
                    <span>عدد الدقائق المعتمدة</span>
                    <input type="number" min="1" step="1" value={dialog.approvedMinutes} onChange={(event) => setDialog({ ...dialog, approvedMinutes: event.target.value })} />
                  </label>
                ) : null}
                {selected.request_type === "resignation" ? (
                  <>
                    <label className="employee-request-action-field">
                      <span>آخر يوم عمل الفعلي</span>
                      <input type="date" value={dialog.finalWorkingDay} onChange={(event) => setDialog({ ...dialog, finalWorkingDay: event.target.value })} />
                    </label>
                    <label className="employee-request-action-confirmation">
                      <input type="checkbox" checked={dialog.confirmClearance} onChange={(event) => setDialog({ ...dialog, confirmClearance: event.target.checked })} />
                      <span><FontAwesomeIcon icon={faLock} /> تم إخلاء الطرف وتسليم العهد، وأؤكد إنهاء صلاحيات الحساب عند التنفيذ.</span>
                    </label>
                  </>
                ) : null}
                <label className="employee-request-action-field">
                  <span>ملاحظة التنفيذ <small>اختياري</small></span>
                  <textarea value={dialog.note} onChange={(event) => setDialog({ ...dialog, note: event.target.value })} />
                </label>
              </div>
            ) : null}

            {dialogError ? (
              <div className="employee-request-action-modal__error">
                <FontAwesomeIcon icon={faTriangleExclamation} /> {dialogError}
              </div>
            ) : null}
          </div>

          <footer>
            <button type="button" className="is-secondary" onClick={closeDialog} disabled={busy}>إلغاء</button>
            <button type="button" className={`is-${copy.tone}`} onClick={() => void submitDialog()} disabled={busy || assigneesLoading}>
              {busy ? "جارٍ التنفيذ..." : copy.confirm}
            </button>
          </footer>
        </section>
      </div>,
      document.body
    );
  };

  if (selected) {
    const can = (permission: Parameters<typeof hasPermission>[0]) => hasPermission(permission);
    const timelineEvents = (selected.events || []).filter(
      (event) => !HIDDEN_TIMELINE_EVENTS.has(event.event_type)
    );
    const existingComments = selected.comments || [];
    const requestInfoMessages = (selected.events || [])
      .filter((event) => MESSAGE_EVENT_TYPES.has(event.event_type) && event.note)
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
    const closureEvent = [...(selected.events || [])]
      .reverse()
      .find((event) =>
        ["cancel", "cancelled"].includes(String(event.event_type || "").toLowerCase()) ||
        event.to_status === "cancelled"
      );

    return (
      <section className="admin-employee-request-detail">
        <header>
          <button type="button" onClick={() => setSelectedId("")}>
            <FontAwesomeIcon icon={faArrowRight} /> العودة للمركز
          </button>
          <div>
            <small>{selected.request_number}</small>
            <h1>{selected.title}</h1>
            <span className={`employee-request-status is-${statusTone(selected.status)}`}>
              {EMPLOYEE_REQUEST_STATUS_LABELS[selected.status]}
            </span>
          </div>
        </header>

        {error ? <div className="employee-request-error">{error}</div> : null}
        {selected.execution_error ? (
          <div className="employee-request-decision is-danger">
            <strong>تعذر تنفيذ الطلب</strong>
            <p>{employeeRequestExecutionErrorLabel(selected.execution_error)}</p>
          </div>
        ) : null}
        {selected.status === "cancelled" ? (
          <div className="employee-request-decision is-closed">
            <strong>تم إغلاق الطلب</strong>
            <p>{closureEvent?.note || "أُغلق الطلب إداريًا وتوقفت إجراءاته الحالية."}</p>
            <div className="employee-request-closed-meta">
              <span>وقت الإغلاق</span>
              <time>{formatDateTime(selected.cancelled_at || closureEvent?.created_at || selected.updated_at)}</time>
            </div>
          </div>
        ) : null}

        <div className="admin-employee-request-detail__layout">
          <article className="admin-employee-request-panel">
            <h2>بيانات الطلب</h2>
            <dl>
              <div><dt>الموظفة</dt><dd>{selected.employee_name_snapshot || selected.employee_id}</dd></div>
              <div><dt>النوع</dt><dd>{EMPLOYEE_REQUEST_TYPE_LABELS[selected.request_type]}</dd></div>
              <div><dt>الأولوية</dt><dd>{EMPLOYEE_REQUEST_PRIORITY_LABELS[selected.priority] || selected.priority}</dd></div>
              <div><dt>المسؤول</dt><dd>{selected.assigned_to_name || "غير معيّن"}</dd></div>
              <div><dt>التنفيذ</dt><dd>{EMPLOYEE_REQUEST_EXECUTION_LABELS[selected.execution_status] || selected.execution_status}</dd></div>
              <div><dt>آخر تحديث</dt><dd>{formatDateTime(selected.updated_at)}</dd></div>
              {selected.status === "cancelled" ? <div><dt>وقت الإغلاق</dt><dd>{formatDateTime(selected.cancelled_at || closureEvent?.created_at || selected.updated_at)}</dd></div> : null}
            </dl>
            <div className="employee-request-payload-list">
              {payloadEntries(selected.payload).map(([key, value]) => (
                <div key={key}>
                  <span>{FIELD_LABELS[key] || key}</span>
                  <strong>{formatPayloadValue(key, value)}</strong>
                </div>
              ))}
            </div>
          </article>

          <article className="admin-employee-request-panel">
            <h2>الإجراءات</h2>
            <div className="admin-request-actions">
              {can("employee_requests.assign") && !["completed", "rejected", "cancelled"].includes(selected.status) ? (
                <button disabled={busy} onClick={() => void openDialog("assign")}>
                  <FontAwesomeIcon icon={faUserCheck} /> تعيين مسؤول
                </button>
              ) : null}
              {selected.status === "submitted" && can("employee_requests.receive") ? (
                <button disabled={busy} onClick={() => void runAction("receive")}>
                  <FontAwesomeIcon icon={faInbox} /> استلام
                </button>
              ) : null}
              {selected.status === "received" && can("employee_requests.manage") ? (
                <button disabled={busy} onClick={() => void runAction("start-review")}>
                  <FontAwesomeIcon icon={faListCheck} /> بدء المراجعة
                </button>
              ) : null}
              {["received", "under_review"].includes(selected.status) && can("employee_requests.request_info") ? (
                <button disabled={busy} onClick={() => void openDialog("request-info")}>
                  <FontAwesomeIcon icon={faCommentDots} /> طلب معلومات
                </button>
              ) : null}
              {selected.status === "under_review" && can("employee_requests.approve") ? (
                <button className="is-success" disabled={busy} onClick={() => void openDialog("approve")}>
                  <FontAwesomeIcon icon={faCheck} /> موافقة
                </button>
              ) : null}
              {["received", "under_review", "needs_info"].includes(selected.status) && can("employee_requests.reject") ? (
                <button className="is-danger" disabled={busy} onClick={() => void openDialog("reject")}>
                  <FontAwesomeIcon icon={faXmark} /> رفض
                </button>
              ) : null}
              {selected.status === "executing" && selected.execution_status === "failed" && can("employee_requests.execute") ? (
                <button className="is-primary" disabled={busy} onClick={() => void openDialog("execute")}>
                  <FontAwesomeIcon icon={faBolt} /> إعادة محاولة التنفيذ
                </button>
              ) : null}
              {selected.status === "approved" && can("employee_requests.execute") ? (
                <button className="is-primary" disabled={busy} onClick={() => void openDialog("execute")}>
                  <FontAwesomeIcon icon={faBolt} /> بدء التنفيذ
                </button>
              ) : null}
              {["submitted", "received", "under_review", "needs_info", "approved"].includes(selected.status) && can("employee_requests.manage") ? (
                <button className="is-danger" disabled={busy} onClick={() => void openDialog("cancel")}>
                  <FontAwesomeIcon icon={faXmark} /> إلغاء إداري
                </button>
              ) : null}
              {["rejected", "cancelled"].includes(selected.status) && can("employee_requests.reopen") ? (
                <button disabled={busy} onClick={() => void openDialog("reopen")}>
                  <FontAwesomeIcon icon={faRotate} /> إعادة فتح
                </button>
              ) : null}
              {selected.request_type === "exit_return" && selected.status === "executing" && !selected.actual_exit_at && can("employee_requests.execute") ? (
                <button disabled={busy} onClick={() => void runAction("record-exit")}>
                  <FontAwesomeIcon icon={faClock} /> تسجيل الخروج
                </button>
              ) : null}
              {selected.request_type === "exit_return" && selected.status === "executing" && selected.actual_exit_at && !selected.actual_return_at && can("employee_requests.complete") ? (
                <button className="is-success" disabled={busy} onClick={() => void runAction("record-return")}>
                  <FontAwesomeIcon icon={faUserCheck} /> تسجيل العودة
                </button>
              ) : null}
            </div>
          </article>
        </div>

        <article className="employee-request-attachments">
          <h3>المرفقات</h3>
          {(selected.attachments || []).length ? (
            <div className="employee-request-attachments__list">
              {(selected.attachments || []).map((attachment) => (
                <button
                  type="button"
                  key={attachment.id}
                  disabled={busy || !attachment.file_metadata_id}
                  onClick={() => void downloadAttachment(attachment.file_metadata_id || "", attachment.file_name)}
                >
                  <FontAwesomeIcon icon={faCommentDots} />
                  <span><strong>{attachment.file_name}</strong><small>{attachment.file_type || "ملف"}</small></span>
                </button>
              ))}
            </div>
          ) : (
            <p className="employee-requests-empty-text">لا توجد مرفقات.</p>
          )}
        </article>

        <div className="employee-request-communication-grid">
          <article className="employee-request-conversation">
            <header>
              <div>
                <h3><FontAwesomeIcon icon={faCommentDots} /> محادثة الطلب</h3>
                <p>الرسائل الظاهرة للموظفة منفصلة عن سجل الإجراءات.</p>
              </div>
              <span>{conversation.length}</span>
            </header>
            <div className="employee-request-conversation__messages">
              {conversation.length ? conversation.map((item) => {
                const isInternal = item.visibility === "internal";
                const isEmployee = ["staff", "employee"].includes(String(item.author_role || "").toLowerCase());
                return (
                  <div
                    key={item.id}
                    className={`employee-request-message ${isInternal ? "is-internal" : isEmployee ? "is-employee" : "is-admin"}`}
                  >
                    <div>
                      <strong>{item.author_name || (isEmployee ? "الموظفة" : "الإدارة")}</strong>
                      {isInternal ? <em><FontAwesomeIcon icon={faLock} /> داخلي</em> : null}
                    </div>
                    <p>{item.body}</p>
                    <time>{formatDateTime(item.created_at)}</time>
                  </div>
                );
              }) : <p className="employee-request-conversation__empty">لا توجد رسائل حتى الآن.</p>}
            </div>
            <div className="employee-request-composer">
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder={internal ? "أضف ملاحظة إدارية لا تظهر للموظفة..." : "اكتب رسالة للموظفة..."}
              />
              <div>
                {hasPermission("employee_requests.internal_notes") ? (
                  <label className="employee-request-internal-toggle">
                    <input type="checkbox" checked={internal} onChange={(event) => setInternal(event.target.checked)} />
                    <span><FontAwesomeIcon icon={faLock} /> ملاحظة داخلية</span>
                  </label>
                ) : <span />}
                <button type="button" disabled={busy || !comment.trim()} onClick={() => void addComment()}>
                  <FontAwesomeIcon icon={faPaperPlane} /> إرسال
                </button>
              </div>
            </div>
          </article>

          <article className="employee-request-timeline employee-request-timeline--operations">
            <header>
              <h3><FontAwesomeIcon icon={faListCheck} /> سجل الإجراءات</h3>
              <p>انتقالات الحالة والقرارات والتنفيذ فقط.</p>
            </header>
            <div className="employee-request-timeline__list">
              {timelineEvents.map((event) => (
                <div className="employee-request-timeline__item" key={event.id}>
                  <span />
                  <div>
                    <strong>{employeeRequestEventLabel(event.event_type)}</strong>
                    <small>{formatDateTime(event.created_at)} {event.actor_name ? `• ${event.actor_name}` : ""}</small>
                    {event.note && !MESSAGE_EVENT_TYPES.has(event.event_type) ? <p>{event.note}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          </article>
        </div>
        {renderDialog()}
      </section>
    );
  }

  return (
    <div className="admin-employee-requests-page">
      <header className="admin-employee-requests-hero">
        <div><small>الموارد البشرية</small><h1>مركز طلبات الموظفات</h1><p>الاستلام والمراجعة والقرار والتنفيذ مع سجل تدقيق كامل.</p></div>
        <button type="button" onClick={() => void loadList()} disabled={loading}><FontAwesomeIcon icon={faRotate} spin={loading} /> تحديث</button>
      </header>
      <div className="admin-request-stats">
        {Object.entries(counts).map(([key, value]) => (
          <button type="button" key={key} className={status === key ? "is-selected" : ""} onClick={() => setStatus(key as EmployeeRequestStatus)}>
            <span>{EMPLOYEE_REQUEST_STATUS_LABELS[key as EmployeeRequestStatus]}</span><strong>{value}</strong>
          </button>
        ))}
        <button type="button" className={`is-overdue ${overdueOnly ? "is-selected" : ""}`} onClick={() => setOverdueOnly((value) => !value)}>
          <span>متأخر</span><strong>{overdue}</strong>
        </button>
      </div>
      <div className="employee-requests-filters admin-employee-requests-filters">
        <span><FontAwesomeIcon icon={faFilter} /> الفلاتر</span>
        <select value={type} onChange={(event) => setType(event.target.value as EmployeeRequestType | "")}><option value="">كل الأنواع</option>{TYPES.map((item) => <option key={item} value={item}>{EMPLOYEE_REQUEST_TYPE_LABELS[item]}</option>)}</select>
        <select value={status} onChange={(event) => setStatus(event.target.value as EmployeeRequestStatus | "")}><option value="">كل الحالات</option>{STATUSES.map((item) => <option key={item} value={item}>{EMPLOYEE_REQUEST_STATUS_LABELS[item]}</option>)}</select>
        <input value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} placeholder="معرف الموظفة" />
        <input value={assignedToUid} onChange={(event) => setAssignedToUid(event.target.value)} placeholder="UID المسؤول" />
        <input value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="الفرع أو الموقع" />
        <input type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} aria-label="من تاريخ" />
        <input type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} aria-label="إلى تاريخ" />
        <label className="employee-request-check"><input type="checkbox" checked={overdueOnly} onChange={(event) => setOverdueOnly(event.target.checked)} /><span>المتأخرة فقط</span></label>
      </div>
      {error ? <div className="employee-request-error"><FontAwesomeIcon icon={faTriangleExclamation} /> {error}</div> : null}
      <div className="admin-request-table">
        <div className="admin-request-table__head"><span>رقم الطلب</span><span>الموظفة</span><span>النوع</span><span>الحالة</span><span>الأولوية</span><span>المسؤول</span><span>العمر</span><span>آخر تحديث</span></div>
        {loading ? <div className="employee-requests-loading">جاري التحميل...</div> : rows.map((row) => {
          const ageDays = Math.max(0, Math.floor((Date.now() - Date.parse(row.submitted_at)) / 86400000));
          return (
            <button type="button" key={row.id} onClick={() => setSelectedId(row.id)}>
              <span>{row.request_number}</span>
              <span>{row.employee_name_snapshot || row.employee_id}</span>
              <span>{EMPLOYEE_REQUEST_TYPE_LABELS[row.request_type]}</span>
              <span className={`employee-request-status is-${statusTone(row.status)}`}>{EMPLOYEE_REQUEST_STATUS_LABELS[row.status]}</span>
              <span>{EMPLOYEE_REQUEST_PRIORITY_LABELS[row.priority] || row.priority}</span>
              <span>{row.assigned_to_name || "غير معيّن"}</span>
              <span>{ageDays} يوم</span>
              <span>{formatDateTime(row.updated_at)}</span>
            </button>
          );
        })}
      </div>
      {renderDialog()}
    </div>
  );
}
