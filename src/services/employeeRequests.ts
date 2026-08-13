import { CoreApiError, coreApiRequest } from "./coreApiClient";

export type EmployeeRequestType =
  | "attendance_correction"
  | "permission"
  | "overtime"
  | "salary_advance"
  | "exceptional_financial_payment"
  | "leave"
  | "exit_return"
  | "resignation";

export type EmployeeRequestStatus =
  | "submitted"
  | "received"
  | "under_review"
  | "needs_info"
  | "approved"
  | "rejected"
  | "executing"
  | "completed"
  | "cancelled";

export type EmployeeRequestEvent = {
  id: string;
  event_type: string;
  before_json?: string | null;
  after_json?: string | null;
  from_status?: string | null;
  to_status?: string | null;
  actor_name?: string | null;
  actor_role?: string | null;
  note?: string | null;
  payload_json?: string | null;
  created_at: string;
};

export type EmployeeRequestComment = {
  id: string;
  author_name?: string | null;
  author_role?: string | null;
  visibility: "employee" | "internal";
  body: string;
  created_at: string;
};

export type EmployeeRequest = {
  id: string;
  request_number: string;
  employee_id: string;
  employee_uid?: string | null;
  employee_name_snapshot?: string | null;
  request_type: EmployeeRequestType;
  status: EmployeeRequestStatus;
  priority: "low" | "normal" | "high" | "urgent";
  title: string;
  payload_json?: string;
  payload: Record<string, unknown>;
  decision_note?: string | null;
  rejection_reason?: string | null;
  assigned_to_uid?: string | null;
  assigned_to_name?: string | null;
  source_reference_type?: string | null;
  source_reference_id?: string | null;
  execution_status: string;
  execution_error?: string | null;
  external_reference?: string | null;
  version: number;
  submitted_at: string;
  updated_at: string;
  received_at?: string | null;
  approved_at?: string | null;
  rejected_at?: string | null;
  executing_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  actual_exit_at?: string | null;
  actual_return_at?: string | null;
  expected_return_at?: string | null;
  final_working_day?: string | null;
  events?: EmployeeRequestEvent[];
  comments?: EmployeeRequestComment[];
  attachments?: Array<{
    id: string;
    file_name: string;
    file_type?: string | null;
    file_size?: number | null;
    file_metadata_id?: string | null;
    storage_key: string;
    created_at: string;
  }>;
};

export type EmployeeRequestAssignee = {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  role: "owner" | "admin" | "hr" | "accountant";
};

const EMPLOYEE_REQUEST_ERROR_LABELS: Record<string, string> = {
  "core_employee_request:attendance_record_not_found":
    "لم يتم العثور على بصمة حضور أو انصراف مطابقة للموظفة في التاريخ والوقت المحددين. تأكد من التاريخ والوقت الحالي، أو اختر «إضافة بصمة» بدل «تعديل بصمة» إذا لم يوجد سجل سابق.",
  "core_employee_request:invalid_transition": "لا يمكن تنفيذ هذا الإجراء في الحالة الحالية للطلب.",
  "core_employee_request:cannot_cancel_executed":
    "لا يمكن إلغاء الطلب لأن الإدارة بدأت تنفيذه بالفعل. أُغلقت نافذة الإلغاء وتم تحديث حالة الطلب الحالية.",
  "core_employee_request:version_conflict":
    "تم تحديث الطلب أثناء فتحه. تم رفض العملية لحماية البيانات من التعارض. حدّث تفاصيل الطلب ثم أعد الإجراء.",
  "core_employee_request:execute_requires_approval":
    "لا يمكن بدء تنفيذ الطلب قبل اعتماده. حدّث الطلب وتأكد أن حالته «تمت الموافقة» ثم أعد المحاولة.",
  "core_employee_request:leave_overlap":
    "تعذر تنفيذ الإجازة لأن هناك إجازة معتمدة أخرى تتداخل مع نفس الفترة.",
  "core_employee_request:insufficient_leave_balance":
    "تعذر تنفيذ الإجازة السنوية لأن رصيد الإجازات المتاح لا يغطي عدد الأيام المطلوبة.",
  "core_employee_request:execution_not_ready":
    "الطلب غير جاهز للإكمال لأن أثر التنفيذ لم يُسجل بعد.",
  "core_employee_request:permission_overlap":
    "يوجد استئذان معتمد آخر يتداخل مع نفس الفترة.",
  "core_employee_request:overtime_overlap":
    "يوجد أوفرتايم مسجل للموظفة يتداخل مع نفس الفترة.",
  "core_employee_request:invalid_leave_range":
    "تاريخ نهاية الإجازة يجب ألا يسبق تاريخ البداية.",
  "core_employee_request:employee_link_required": "الحساب غير مربوط بملف موظفة.",
  "core_employee_request:not_found": "الطلب غير موجود أو لا تملك صلاحية عرضه.",
  "core_employee_request:attendance_target_required":
    "حدد البصمة المطلوب تعديلها بإدخال الوقت الحالي الصحيح أو استخدم نوع إضافة بصمة.",
  "core_employee_request:invalid_requested_days": "عدد الأيام المرجعية يجب أن يكون بين نصف يوم و60 يومًا وبزيادات نصف يوم.",
  "core_employee_request:employee_salary_required": "لا يمكن حساب الصرف لأن الراتب الأساسي غير مسجل في ملف الموظفة داخل Core.",
  "core_employee_request:payroll_entry_required": "لا يوجد مسير راتب مفتوح وقابل للتعديل للشهر المحدد. أنشئ أو افتح المسير أولًا ثم أعد التنفيذ.",
  "core_employee_request:financial_payment_acknowledgement_required": "يجب الموافقة على الإقرار قبل إرسال طلب الصرف المالي.",
  "core_employee_request:financial_payment_signature_required": "يجب توقيع طلب الصرف المالي بخط اليد قبل الإرسال.",
};

export function employeeRequestErrorMessage(cause: unknown, fallback = "تعذر تنفيذ العملية.") {
  const code = cause instanceof CoreApiError
    ? cause.code
    : String((cause as { code?: unknown })?.code || (cause as Error)?.message || "");
  return EMPLOYEE_REQUEST_ERROR_LABELS[code] ||
    (code.startsWith("core_employee_request:") ? fallback : String((cause as Error)?.message || fallback));
}

export function employeeRequestExecutionErrorLabel(code: unknown) {
  const normalized = String(code || "").trim();
  return EMPLOYEE_REQUEST_ERROR_LABELS[normalized] || normalized || "تعذر تنفيذ الطلب.";
}

export type EmployeeRequestStats = {
  counts: Partial<Record<EmployeeRequestStatus, number>>;
  overdue: number;
};

export const EMPLOYEE_REQUEST_TYPE_LABELS: Record<EmployeeRequestType, string> = {
  attendance_correction: "طلب تصحيح حضور",
  permission: "طلب استئذان",
  overtime: "طلب أوفرتايم",
  salary_advance: "صرف معجل للراتب",
  exceptional_financial_payment: "طلب صرف مالي استثنائي",
  leave: "طلب إجازة",
  exit_return: "طلب خروج وعودة",
  resignation: "طلب استقالة",
};

export const EMPLOYEE_REQUEST_STATUS_LABELS: Record<EmployeeRequestStatus, string> = {
  submitted: "تم الإرسال",
  received: "تم الاستلام",
  under_review: "قيد المراجعة",
  needs_info: "مطلوب معلومات",
  approved: "تمت الموافقة",
  rejected: "مرفوض",
  executing: "جارٍ التنفيذ",
  completed: "مكتمل",
  cancelled: "تم الإغلاق",
};

export const EMPLOYEE_REQUEST_PRIORITY_LABELS: Record<string, string> = {
  low: "منخفضة",
  normal: "عادية",
  high: "مرتفعة",
  urgent: "عاجلة",
};

export const EMPLOYEE_REQUEST_EXECUTION_LABELS: Record<string, string> = {
  not_started: "لم يبدأ",
  running: "جارٍ التنفيذ",
  waiting: "بانتظار الإكمال",
  completed: "مكتمل",
  failed: "تعذر التنفيذ",
  cancelled: "متوقف",
};

export const EMPLOYEE_REQUEST_EVENT_LABELS: Record<string, string> = {
  submitted: "تم إرسال الطلب",
  assigned: "تم تعيين مسؤول",
  receive: "تم استلام الطلب",
  received: "تم استلام الطلب",
  start_review: "بدأت مراجعة الطلب",
  under_review: "الطلب قيد المراجعة",
  request_info: "طُلبت معلومات إضافية",
  answer_info: "تم استلام رد الموظفة",
  approve: "تمت الموافقة",
  approved: "تمت الموافقة",
  reject: "تم رفض الطلب",
  rejected: "تم رفض الطلب",
  cancel: "تم إغلاق الطلب",
  cancelled: "تم إغلاق الطلب",
  reopen: "أُعيد فتح الطلب",
  execution_started: "بدأ تنفيذ الطلب",
  execution_retried: "أُعيدت محاولة التنفيذ",
  execution_waiting: "التنفيذ بانتظار خطوة لاحقة",
  execution_completed: "اكتمل تنفيذ الطلب",
  execution_failed: "تعذر تنفيذ الطلب",
  actual_exit_recorded: "تم تسجيل الخروج الفعلي",
  actual_return_recorded: "تم تسجيل العودة الفعلية",
  comment_added: "أضيفت رسالة",
  internal_note_added: "أضيفت ملاحظة داخلية",
};

export function employeeRequestEventLabel(eventType: unknown) {
  const key = String(eventType || "").trim().toLowerCase().replaceAll("-", "_");
  return EMPLOYEE_REQUEST_EVENT_LABELS[key] || key.replaceAll("_", " ") || "تحديث على الطلب";
}

function makeIdempotencyKey(prefix: string) {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}:${random}`;
}

function isSignatureDataUrl(value: unknown) {
  const text = String(value || "").trim();
  return text.startsWith("data:image/") && text.includes(";base64,") && text.length > 200;
}

export async function listMyEmployeeRequests(filters: {
  type?: EmployeeRequestType | "";
  status?: EmployeeRequestStatus | "";
  limit?: number;
} = {}) {
  return coreApiRequest<EmployeeRequest[]>("/api/core/hr/employee-requests/mine", {
    query: filters,
  });
}

export async function listEmployeeRequests(filters: {
  employeeId?: string;
  type?: EmployeeRequestType | "";
  status?: EmployeeRequestStatus | "";
  assignedToUid?: string;
  branch?: string;
  overdue?: boolean;
  fromDate?: string;
  toDate?: string;
  limit?: number;
} = {}) {
  return coreApiRequest<EmployeeRequest[]>("/api/core/hr/employee-requests", {
    query: filters,
  });
}

export async function getEmployeeRequest(id: string) {
  return coreApiRequest<EmployeeRequest>(`/api/core/hr/employee-requests/${encodeURIComponent(id)}`);
}

export async function createEmployeeRequest(input: {
  requestType: EmployeeRequestType;
  payload: Record<string, unknown>;
  priority?: "low" | "normal" | "high" | "urgent";
  title?: string;
}) {
  if (input.requestType === "leave" && !isSignatureDataUrl(input.payload.employeeSignatureDataUrl)) {
    throw new Error("يجب توقيع طلب الإجازة بخط اليد قبل الإرسال.");
  }
  if (input.requestType === "exceptional_financial_payment" && !isSignatureDataUrl(input.payload.employeeSignatureDataUrl)) {
    throw new Error("يجب توقيع طلب الصرف المالي بخط اليد قبل الإرسال.");
  }

  return coreApiRequest<EmployeeRequest>("/api/core/hr/employee-requests/mine", {
    method: "POST",
    body: {
      ...input,
      idempotencyKey: makeIdempotencyKey(`employee-request:${input.requestType}`),
    },
  });
}

export async function employeeRequestAction(
  id: string,
  action:
    | "receive"
    | "assign"
    | "start-review"
    | "request-info"
    | "answer-info"
    | "approve"
    | "reject"
    | "execute"
    | "complete"
    | "cancel"
    | "record-exit"
    | "record-return"
    | "reopen",
  body: Record<string, unknown> = {}
) {
  return coreApiRequest<EmployeeRequest>(
    `/api/core/hr/employee-requests/${encodeURIComponent(id)}/${action}`,
    {
      method: "POST",
      body: {
        ...body,
        idempotencyKey: makeIdempotencyKey(`employee-request-action:${id}:${action}`),
      },
    }
  );
}

export async function addEmployeeRequestComment(
  id: string,
  body: string,
  visibility: "employee" | "internal" = "employee"
) {
  return coreApiRequest<EmployeeRequestComment>(
    `/api/core/hr/employee-requests/${encodeURIComponent(id)}/comments`,
    {
      method: "POST",
      body: {
        body,
        visibility,
        idempotencyKey: makeIdempotencyKey(`employee-request-comment:${id}`),
      },
    }
  );
}

export async function addEmployeeRequestAttachment(
  id: string,
  input: {
    fileName: string;
    fileType?: string;
    fileSize?: number;
    fileMetadataId: string;
    storageKey: string;
  }
) {
  return coreApiRequest<{
    id: string;
    file_name: string;
    file_type?: string | null;
    file_size?: number | null;
    file_metadata_id?: string | null;
    storage_key: string;
    created_at: string;
  }>(`/api/core/hr/employee-requests/${encodeURIComponent(id)}/attachments`, {
    method: "POST",
    body: {
      ...input,
      idempotencyKey: makeIdempotencyKey(`employee-request-attachment:${id}`),
    },
  });
}

export async function listEmployeeRequestAssignees(search = "") {
  return coreApiRequest<EmployeeRequestAssignee[]>(
    "/api/core/hr/employee-request-assignees",
    { query: { search, limit: 100 } }
  );
}

export async function getEmployeeRequestStats() {
  return coreApiRequest<EmployeeRequestStats>("/api/core/hr/employee-requests/stats");
}

export type CoreEmployeeRequestNotification = {
  id: string;
  target_uid: string;
  title: string;
  body?: string | null;
  related_id?: string | null;
  is_read: number;
  read_at?: string | null;
  created_at: string;
  updated_at: string;
};

export async function listEmployeeRequestNotifications(limit = 100) {
  return coreApiRequest<CoreEmployeeRequestNotification[]>(
    "/api/core/hr/employee-request-notifications",
    { query: { limit } }
  );
}

export async function markEmployeeRequestNotificationRead(id: string) {
  return coreApiRequest<{ id: string; isRead: boolean; readAt: string }>(
    `/api/core/hr/employee-request-notifications/${encodeURIComponent(id)}/read`,
    { method: "POST", body: {} }
  );
}

export async function markAllEmployeeRequestNotificationsRead() {
  return coreApiRequest<{ updated: number }>(
    "/api/core/hr/employee-request-notifications/read-all",
    { method: "POST", body: {} }
  );
}

export type EmployeeRequestPayrollImpact = {
  overtime: Array<{
    id: string;
    request_id: string;
    date_key: string;
    requested_minutes: number;
    approved_minutes: number;
    payroll_month?: string | null;
    payout_status: string;
    reason?: string | null;
    task_summary?: string | null;
  }>;
  advances: Array<{
    id: string;
    request_id: string;
    requested_halalas: number;
    approved_halalas: number;
    remaining_halalas: number;
    paid_halalas: number;
    installment_count: number;
    first_deduction_month?: string | null;
    payment_status: string;
    financial_reference?: string | null;
    created_at: string;
  }>;
  installments: Array<{
    id: string;
    advance_id: string;
    installment_number: number;
    payroll_month: string;
    amount_halalas: number;
    status: string;
  }>;
  financialPayments: Array<{
    id: string;
    request_id: string;
    request_number: string;
    requested_days: number;
    amount_halalas: number;
    payroll_month: string;
    payroll_entry_id: string;
    financial_reference: string;
    payment_status: string;
    leave_balance_deducted: number;
    executed_at: string;
  }>;
};

export async function getMyEmployeeRequestPayrollImpact() {
  return coreApiRequest<EmployeeRequestPayrollImpact>(
    "/api/core/hr/employee-request-payroll-impact/mine"
  );
}
