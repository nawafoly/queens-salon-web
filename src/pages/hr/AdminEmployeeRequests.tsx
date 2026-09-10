import DashboardNumberInputV2 from "../../components/dashboard-v2/DashboardNumberInputV2";
import { DashboardMonthInputV2 } from "../../components/dashboard-v2/DashboardNativeControlBridgeV2";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faArrowRight,
  faBolt,
  faCheck,
  faClock,
  faCommentDots,
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
import LeaveRequestDocument from "../../components/hr/LeaveRequestDocument";
import ExceptionalFinancialPaymentRequestDocument from "../../components/hr/ExceptionalFinancialPaymentRequestDocument";
import { printExceptionalFinancialPaymentRequestDocument } from "../../services/exceptionalFinancialPaymentRequestExport";
import SignatureCaptureField from "../../components/hr/SignatureCaptureField";
import { CoreFilesService } from "../../services/CoreFilesService";
import {
  exportLeaveRequestToExcel,
  exportLeaveRequestToPdf,
  exportLeaveRequestToWord,
  printLeaveRequestDocument,
} from "../../services/leaveRequestExport";
import { usePermissions } from "../../security/PermissionContext";
import {
  DashboardDatePickerV2,
  DashboardEmptyStateV2,
  DashboardFieldV2,
  DashboardSelectV2,
  DashboardSkeletonV2,
} from "../../components/dashboard-v2";
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

type Props = { session: HrSession; initialType?: EmployeeRequestType | "" };
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
  payrollMonth: string;
  approvedMinutes: string;
  finalWorkingDay: string;
  confirmClearance: boolean;
  documentationVerified: boolean;
  signatureDataUrl: string;
};

const TYPES = Object.keys(EMPLOYEE_REQUEST_TYPE_LABELS) as EmployeeRequestType[];
const STATUSES = Object.keys(EMPLOYEE_REQUEST_STATUS_LABELS) as EmployeeRequestStatus[];
const TYPE_OPTIONS = [
  { value: "", label: "كل الأنواع" },
  ...TYPES.map((item) => ({ value: item, label: EMPLOYEE_REQUEST_TYPE_LABELS[item] })),
];
const STATUS_OPTIONS = [
  { value: "", label: "كل الحالات" },
  ...STATUSES.map((item) => ({ value: item, label: EMPLOYEE_REQUEST_STATUS_LABELS[item] })),
];
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
  requestedDays: "عدد أيام الإجازة المطلوب تعويضها",
  baseSalaryHalalas: "الراتب الأساسي وقت الطلب",
  dayRateHalalas: "قيمة اليوم",
  calculatedAmountHalalas: "إجمالي الصرف",
  annualLeaveBalanceSnapshot: "الرصيد السنوي وقت الطلب",
  balanceDeductionDays: "الأيام المخصومة",
  calculationBasis: "أساس الحساب",
  payrollTreatment: "معالجة الرواتب",
  leaveBalanceTreatment: "معالجة رصيد الإجازة",
  legalTreatment: "نوع المعالجة",
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
    description: "راجع البيانات قبل الاعتماد. طلب الإجازة لا يعتمد بدون توقيع المراجع أو المسؤول.",
    confirm: "تأكيد الموافقة",
    tone: "success",
  },
  reject: {
    title: "رفض الطلب",
    description: "اكتب سببًا واضحًا للرفض؛ وفي طلب الإجازة يجب توقيع القرار قبل اعتماده.",
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
  return new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
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
  if (key.endsWith("Halalas")) return `${(Number(value || 0) / 100).toLocaleString("ar-SA-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ريال`;
  if (key === "leaveBalanceTreatment" && value === "deduct_on_execution") return "يُخصم من رصيد الإجازة عند التنفيذ";
  if (key === "leaveBalanceTreatment" && value === "not_deducted") return "لا يتم الخصم";
  if (key === "payrollTreatment" && value === "manual_addition") return "إضافة مالية في مسير الراتب";
  if (key === "calculationBasis" && value === "base_salary_divided_by_30") return "الراتب الأساسي ÷ 30 × عدد الأيام";
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function payloadEntries(payload: Record<string, unknown>) {
  const hidden = new Set(["employeeSignatureDataUrl"]);
  return Object.entries(payload || {}).filter(([key, value]) => !hidden.has(key) && value !== "" && value !== null && value !== undefined);
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
    payrollMonth: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7),
    approvedMinutes: "",
    finalWorkingDay: "",
    confirmClearance: false,
    documentationVerified: false,
    signatureDataUrl: "",
  };
}

export default function AdminEmployeeRequestsPage({ session, initialType = "" }: Props) {
  const { hasPermission } = usePermissions();
  const [rows, setRows] = useState<EmployeeRequest[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selected, setSelected] = useState<EmployeeRequest | null>(null);
  const [stats, setStats] = useState<Partial<Record<EmployeeRequestStatus, number>>>({});
  const [overdue, setOverdue] = useState(0);
  const [type, setType] = useState<EmployeeRequestType | "">(initialType);
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

  useEffect(() => {
    setType(initialType);
  }, [initialType]);

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
    const decisionNeedsSignature = ["leave", "exceptional_financial_payment"].includes(selected.request_type) && ["approve", "reject"].includes(dialog.kind);

    if (decisionNeedsSignature && !dialog.signatureDataUrl.startsWith("data:image/")) {
      setDialogError("يجب توقيع القرار بخط اليد قبل اعتماده.");
      return;
    }

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
      const sickLeave = selected.request_type === "leave" && String(selected.payload.leaveType || "").toLowerCase() === "sick";
      if (sickLeave && !dialog.documentationVerified) {
        setDialogError("يجب التحقق من المستند الطبي قبل اعتماد الإجازة المرضية.");
        return;
      }
      if (["leave", "exceptional_financial_payment"].includes(selected.request_type)) {
        body.payload = {
          reviewerSignatureDataUrl: dialog.signatureDataUrl,
          reviewerSignatureCapturedAt: new Date().toISOString(),
          ...(sickLeave ? { documentationVerified: true } : {}),
        };
      }
    } else if (dialog.kind === "reject") {
      if (!dialog.note.trim()) {
        setDialogError("سبب الرفض مطلوب.");
        return;
      }
      action = "reject";
      body.reason = dialog.note.trim();
      if (["leave", "exceptional_financial_payment"].includes(selected.request_type)) {
        body.payload = {
          reviewerSignatureDataUrl: dialog.signatureDataUrl,
          reviewerSignatureCapturedAt: new Date().toISOString(),
        };
      }
    } else if (dialog.kind === "cancel") {
      if (!dialog.note.trim()) {
        setDialogError("سبب الإلغاء الإداري مطلوب.");
        return;
      }
      action = "cancel";
      body.note = dialog.note.trim();
    } else if (dialog.kind === "reopen") {
      if (!dialog.note.trim()) {
        setDialogError("سبب إعادة الفتح مطلوب.");
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
      if (selected.request_type === "exceptional_financial_payment") {
        if (!/^\d{4}-\d{2}$/.test(dialog.payrollMonth)) {
          setDialogError("حدد شهر المسير الذي سيضاف إليه المبلغ.");
          return;
        }
        Object.assign(body, {
          payrollMonth: dialog.payrollMonth,
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
    const decisionNeedsSignature = ["leave", "exceptional_financial_payment"].includes(selected.request_type) && ["approve", "reject"].includes(dialog.kind);
    return createPortal(
      <div className="employee-request-action-modal dashboard-v2" role="dialog" aria-modal="true" aria-labelledby="employee-request-action-title">
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

            {dialog.kind === "approve" && selected.request_type === "leave" && String(selected.payload.leaveType || "").toLowerCase() === "sick" ? (
              <label className="employee-request-action-confirmation">
                <input type="checkbox" checked={dialog.documentationVerified} onChange={(event) => setDialog({ ...dialog, documentationVerified: event.target.checked })} />
                <span><FontAwesomeIcon icon={faLock} /> تم التحقق من المستند الطبي المرفق وصلاحيته للاعتماد.</span>
              </label>
            ) : null}

            {decisionNeedsSignature ? (
              <SignatureCaptureField
                required
                label="توقيع المراجع / المسؤول"
                signerName={String(session.displayName || session.email || "المراجع")}
                value={dialog.signatureDataUrl}
                onChange={(signatureDataUrl) => setDialog({ ...dialog, signatureDataUrl })}
              />
            ) : null}

            {dialog.kind === "execute" ? (
              <div className="employee-request-execution-form">
                {selected.request_type === "salary_advance" ? (
                  <>
                    <label className="employee-request-action-field">
                      <span>المبلغ الموافق عليه بالريال</span>
                      <DashboardNumberInputV2 min="1" step="0.01" value={dialog.approvedAmount} onChange={(event) => setDialog({ ...dialog, approvedAmount: event.target.value })} />
                    </label>
                    <label className="employee-request-action-field">
                      <span>مرجع عملية الصرف</span>
                      <input value={dialog.financialReference} onChange={(event) => setDialog({ ...dialog, financialReference: event.target.value })} />
                    </label>
                    <label className="employee-request-action-field">
                      <span>أول شهر استقطاع</span>
                      <DashboardMonthInputV2 value={dialog.firstDeductionMonth} onChange={(event) => setDialog({ ...dialog, firstDeductionMonth: event.target.value })} />
                    </label>
                  </>
                ) : null}
                {selected.request_type === "exceptional_financial_payment" ? (
                  <>
                    <label className="employee-request-action-field">
                      <span>المبلغ المستحق</span>
                      <input
                        readOnly
                        dir="ltr"
                        value={`${(Number(selected.payload.calculatedAmountHalalas || 0) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ر.س`}
                      />
                    </label>
                    <label className="employee-request-action-field">
                      <span>شهر المسير</span>
                      <DashboardMonthInputV2 value={dialog.payrollMonth} onChange={(event) => setDialog({ ...dialog, payrollMonth: event.target.value, }) } />
                    </label>
                    <div className="employee-request-action-confirmation">
                      <span>
                        <FontAwesomeIcon icon={faLock} /> سيتم إضافة مبلغ{" "}
                        {(Number(selected.payload.calculatedAmountHalalas || 0) / 100).toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}{" "}
                        ر.س إلى شهر المسير المحدد، وخصم{" "}
                        {Number(selected.payload.requestedDays || 0).toLocaleString("en-US", {
                          maximumFractionDigits: 1,
                        })}{" "}
                        يوم من رصيد الإجازة السنوية للموظفة.
                      </span>
                    </div>
                  </>
                ) : null}
                {selected.request_type === "overtime" ? (
                  <label className="employee-request-action-field">
                    <span>عدد الدقائق المعتمدة</span>
                    <DashboardNumberInputV2 min="1" step="1" value={dialog.approvedMinutes} onChange={(event) => setDialog({ ...dialog, approvedMinutes: event.target.value })} />
                  </label>
                ) : null}
                {selected.request_type === "resignation" ? (
                  <>
                    <label className="employee-request-action-field">
                      <span>آخر يوم عمل الفعلي</span>
                      <DashboardDatePickerV2
                        value={dialog.finalWorkingDay}
                        onChange={(value) => setDialog({ ...dialog, finalWorkingDay: value })}
                        clearable={false}
                      />
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
            <button type="button" className={`is-${copy.tone}`} onClick={() => void submitDialog()} disabled={busy || assigneesLoading || (decisionNeedsSignature && !dialog.signatureDataUrl)}>
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
      <section className="dsv2-page admin-employee-request-detail admin-employee-request-detail-v2">
        <header className="admin-request-detail-hero-v2">
          <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={() => setSelectedId("")}>
            <FontAwesomeIcon icon={faArrowRight} /> العودة للمركز
          </button>
          <div className="admin-request-detail-hero-v2__copy">
            <small>{selected.request_number}</small>
            <h1>{selected.title}</h1>
            <span className={`employee-request-status is-${statusTone(selected.status)}`}>
              {EMPLOYEE_REQUEST_STATUS_LABELS[selected.status]}
            </span>
          </div>
        </header>

        {error ? <div className="admin-request-error-v2"><FontAwesomeIcon icon={faTriangleExclamation} /> {error}</div> : null}
        {selected.execution_error ? (
          <div className="admin-request-decision-v2">
            <strong>تعذر تنفيذ الطلب</strong>
            <p>{employeeRequestExecutionErrorLabel(selected.execution_error)}</p>
          </div>
        ) : null}
        {selected.status === "cancelled" ? (
          <div className="admin-request-decision-v2 is-closed">
            <strong>تم إغلاق الطلب</strong>
            <p>{closureEvent?.note || "أُغلق الطلب إداريًا وتوقفت إجراءاته الحالية."}</p>
            <div className="employee-request-closed-meta">
              <span>وقت الإغلاق</span>
              <time>{formatDateTime(selected.cancelled_at || closureEvent?.created_at || selected.updated_at)}</time>
            </div>
          </div>
        ) : null}

        {selected.request_type === "exceptional_financial_payment" ? (
          <section className="admin-leave-request-document-shell">
            <div className="leave-request-export-toolbar">
              <button type="button" className="is-primary" onClick={() => void printExceptionalFinancialPaymentRequestDocument()}>طباعة / حفظ PDF</button>
            </div>
            <ExceptionalFinancialPaymentRequestDocument request={selected} />
          </section>
        ) : null}

        {selected.request_type === "leave" ? (
          <section className="admin-leave-request-document-shell">
            <div className="leave-request-export-toolbar">
              <button type="button" className="is-primary" onClick={printLeaveRequestDocument}>طباعة</button>
              <button type="button" onClick={() => void exportLeaveRequestToPdf(selected)}>تصدير PDF</button>
              <button type="button" onClick={() => void exportLeaveRequestToWord(selected)}>تصدير Word</button>
              <button type="button" onClick={() => exportLeaveRequestToExcel(selected)}>تصدير Excel</button>
            </div>
            <LeaveRequestDocument request={selected} />
          </section>
        ) : null}

        <div className="admin-employee-request-detail__layout">
          <article className="dsv2-card admin-employee-request-panel">
            <h2>بيانات الطلب</h2>
            <dl>
              <div><dt>الموظفة</dt><dd>{selected.employee_name_snapshot || selected.employee_id}</dd></div>
              <div><dt>النوع</dt><dd>{EMPLOYEE_REQUEST_TYPE_LABELS[selected.request_type]}</dd></div>
              <div><dt>الأولوية</dt><dd>{EMPLOYEE_REQUEST_PRIORITY_LABELS[selected.priority] || selected.priority}</dd></div>
              <div><dt>المسؤول</dt><dd>{selected.assigned_to_name || "غير معيّن"}</dd></div>
              <div><dt>التنفيذ</dt><dd>{EMPLOYEE_REQUEST_EXECUTION_LABELS[selected.execution_status] || selected.execution_status}</dd></div>{selected.execution_status === "failed" && selected.execution_error ? <div><dt>سبب تعثر التنفيذ</dt><dd>{employeeRequestExecutionErrorLabel(selected.execution_error)}</dd></div> : null}{selected.source_reference_id ? <div><dt>المرجع التشغيلي</dt><dd>{selected.source_reference_type ? `${selected.source_reference_type} • ` : ""}{selected.source_reference_id}</dd></div> : null}
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

          <article className="dsv2-card admin-employee-request-panel">
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
              {selected.status === "needs_info" && can("employee_requests.manage") ? (
                <button className="is-primary" disabled={busy} onClick={() => void runAction("start-review")}>
                  <FontAwesomeIcon icon={faRotate} /> استئناف المراجعة
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

        <article className="dsv2-card employee-request-attachments">
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
            <DashboardEmptyStateV2 compact title="لا توجد مرفقات" description="لا توجد ملفات مرتبطة بهذا الطلب حاليًا." />
          )}
        </article>

        <div className="employee-request-communication-grid">
          <article className="dsv2-card employee-request-conversation">
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
                  <label className="employee-request-internal-toggle admin-request-internal-toggle">
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

          <article className="dsv2-card employee-request-timeline employee-request-timeline--operations">
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
    <div className="dsv2-page admin-employee-requests-page admin-employee-requests-v2-page">
      <section className="dsv2-card admin-employee-requests-hero">
        <div className="admin-employee-requests-hero__copy">
          <span className="dsv2-badge dsv2-badge--gold">الموارد البشرية</span>
          <h1>مركز طلبات الموظفات</h1>
          <p>الاستلام والمراجعة والقرار والتنفيذ مع سجل تدقيق كامل من مساحة إدارية موحدة.</p>
        </div>
        <button className="dsv2-btn dsv2-btn--secondary" type="button" onClick={() => void loadList()} disabled={loading}>
          <FontAwesomeIcon icon={faRotate} spin={loading} /> تحديث
        </button>
      </section>

      <section className="admin-request-stats-v2" aria-label="ملخص حالات الطلبات">
        {Object.entries(counts).map(([key, value]) => (
          <button
            type="button"
            key={key}
            className={`admin-request-stat-v2 ${status === key ? "is-selected" : ""}`}
            onClick={() => setStatus(key as EmployeeRequestStatus)}
          >
            <span>{EMPLOYEE_REQUEST_STATUS_LABELS[key as EmployeeRequestStatus]}</span>
            <strong>{value}</strong>
          </button>
        ))}
        <button
          type="button"
          className={`admin-request-stat-v2 is-overdue ${overdueOnly ? "is-selected" : ""}`}
          onClick={() => setOverdueOnly((value) => !value)}
        >
          <span>متأخر</span>
          <strong>{overdue}</strong>
        </button>
      </section>

      <section className="dsv2-card admin-employee-requests-filter-card">
        <header className="admin-employee-requests-filter-head">
          <div>
            <span className="dsv2-badge dsv2-badge--neutral">الفلاتر</span>
            <h2>تصفية الطلبات</h2>
            <p>حدّد النوع والحالة والموظفة والمسؤول والفترة للوصول للطلب المطلوب بسرعة.</p>
          </div>
          <span className="dsv2-badge dsv2-badge--gold">{rows.length} طلب</span>
        </header>

        <div className="admin-employee-requests-filter-grid">
          <DashboardFieldV2 id="admin-requests-type" label="نوع الطلب">
            <DashboardSelectV2
              id="admin-requests-type"
              options={TYPE_OPTIONS}
              value={type}
              onChange={(value) => setType(value as EmployeeRequestType | "")}
            />
          </DashboardFieldV2>
          <DashboardFieldV2 id="admin-requests-status" label="الحالة">
            <DashboardSelectV2
              id="admin-requests-status"
              options={STATUS_OPTIONS}
              value={status}
              onChange={(value) => setStatus(value as EmployeeRequestStatus | "")}
            />
          </DashboardFieldV2>
          <DashboardFieldV2 id="admin-requests-employee" label="معرف الموظفة">
            <input id="admin-requests-employee" className="dsv2-input" value={employeeId} onChange={(event) => setEmployeeId(event.target.value)} placeholder="معرف الموظفة" />
          </DashboardFieldV2>
          <DashboardFieldV2 id="admin-requests-assignee" label="UID المسؤول">
            <input id="admin-requests-assignee" className="dsv2-input" value={assignedToUid} onChange={(event) => setAssignedToUid(event.target.value)} placeholder="UID المسؤول" />
          </DashboardFieldV2>
          <DashboardFieldV2 id="admin-requests-branch" label="الفرع أو الموقع" className="admin-request-filter-search">
            <input id="admin-requests-branch" className="dsv2-input" value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="الفرع أو الموقع" />
          </DashboardFieldV2>
          <DashboardFieldV2 id="admin-requests-from" label="من تاريخ">
            <DashboardDatePickerV2 id="admin-requests-from" value={fromDate} onChange={setFromDate} />
          </DashboardFieldV2>
          <DashboardFieldV2 id="admin-requests-to" label="إلى تاريخ">
            <DashboardDatePickerV2 id="admin-requests-to" value={toDate} onChange={setToDate} />
          </DashboardFieldV2>
          <label className="admin-request-overdue-toggle">
            <input type="checkbox" checked={overdueOnly} onChange={(event) => setOverdueOnly(event.target.checked)} />
            <span>المتأخرة فقط</span>
          </label>
        </div>
      </section>

      {error ? <div className="admin-request-error-v2"><FontAwesomeIcon icon={faTriangleExclamation} /> {error}</div> : null}

      <section className="admin-request-table-v2">
        {loading ? (
          <div className="admin-request-table-state-v2">
            <DashboardSkeletonV2 variant="title" width="34%" />
            <DashboardSkeletonV2 lines={7} />
          </div>
        ) : !rows.length ? (
          <div className="admin-request-table-state-v2">
            <DashboardEmptyStateV2
              title="لا توجد طلبات مطابقة"
              description="غيّر الفلاتر أو الفترة، وستظهر الطلبات المطابقة هنا."
              tone="gold"
            />
          </div>
        ) : (
          <div className="admin-request-table-v2__scroll">
            <div className="admin-request-table__head">
              <span>رقم الطلب</span><span>الموظفة</span><span>النوع</span><span>الحالة</span><span>الأولوية</span><span>المسؤول</span><span>العمر</span><span>آخر تحديث</span>
            </div>
            {rows.map((row) => {
              const ageDays = Math.max(0, Math.floor((Date.now() - Date.parse(row.submitted_at)) / 86400000));
              return (
                <button className="admin-request-row-v2" type="button" key={row.id} onClick={() => setSelectedId(row.id)}>
                  <span>{row.request_number}</span>
                  <span>{row.employee_name_snapshot || row.employee_id}</span>
                  <span>{EMPLOYEE_REQUEST_TYPE_LABELS[row.request_type]}</span>
                  <span className={`admin-request-status-v2 is-${statusTone(row.status)}`}>{EMPLOYEE_REQUEST_STATUS_LABELS[row.status]}</span>
                  <span>{EMPLOYEE_REQUEST_PRIORITY_LABELS[row.priority] || row.priority}</span>
                  <span>{row.assigned_to_name || "غير معيّن"}</span>
                  <span>{ageDays} يوم</span>
                  <span>{formatDateTime(row.updated_at)}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>
      {renderDialog()}
    </div>
  );
}
