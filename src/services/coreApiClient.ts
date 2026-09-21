import { auth } from "./firebase";
import { requireCoreWorkerUrl } from "../config/dataSourceFlags";

export class CoreApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown
  ) {
    super(message);
    this.name = "CoreApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

type CoreApiRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: Record<string, unknown>;
  query?: Record<string, string | number | boolean | null | undefined>;
  timeoutMs?: number;
  operationId?: string;
  reconciliation?: {
    employeeId?: string;
  };
};

const CORE_API_CODE_MESSAGES: Record<string, string> = {
  "core_api:idempotency_key_reused": "تعذر إعادة تنفيذ العملية لأن معرّفها استُخدم لطلب مختلف. حدّث البيانات وحاول من جديد.",
  "core_api:idempotency_in_progress": "العملية نفسها ما زالت قيد التنفيذ. انتظر لحظة ثم حدّث البيانات قبل إعادة المحاولة.",
  "core_api:invalid_idempotency_key": "معرّف العملية غير صالح. أعد المحاولة.",
  "core_auth:tenant_mismatch": "الطلب يحاول الوصول إلى مساحة مؤسسة مختلفة. تم رفض العملية.",
  "core_auth:tenant_context_required": "الطلب يحاول الوصول إلى مساحة مؤسسة مختلفة. تم رفض العملية.",
  "core_hr:employee_changed": "تغيرت بيانات الموظفة من جهاز أو جلسة أخرى. تم إيقاف الحفظ لمنع الكتابة فوق التعديل الأحدث. أعد تحميل البيانات ثم راجع تعديلك.",
  "core_hr:employee_write_precondition_required": "تعذر الحفظ لأن نسخة الموظفة التي تعدلها غير مؤكدة. أعد فتح ملف الموظفة قبل الحفظ.",
  "core_api:offline": "غير متصل بالإنترنت. تم إيقاف الحفظ حتى عودة الاتصال.",
  "core_api:network_unavailable": "تعذر الاتصال بالخدمة الأساسية. تحقق من الشبكة وحاول مرة أخرى.",
  "core_api:write_outcome_unknown": "انقطع الاتصال أثناء الحفظ. نتيجة آخر عملية غير مؤكدة؛ لا تعد الحفظ قبل إعادة مزامنة البيانات.",
  "core_payroll:deduction_reason_required": "اكتب سبب الخصم أو قرار التأجيل قبل المتابعة.",
  "core_payroll:deduction_amount_required": "اكتب مبلغًا أكبر من صفر.",
  "core_payroll:attendance_deferral_snapshot_stale": "تغيّر خصم الحضور بعد إنشاء التأجيل السابق. ألغِ التأجيل القديم ثم أعد إنشاءه بالمبلغ الحالي.",
  "core_payroll:obligation_snapshot_stale": "تغيّر جدول الخصومات والالتزامات بعد حساب المسودة. أعد حساب المسيرة.",
  "core_payroll:attendance_deferral_target_must_be_future": "شهر تحصيل خصم الحضور يجب أن يكون بعد شهر الخصم الأصلي.",
  "core_payroll:attendance_deferral_source_payroll_locked": "لا يمكن تأجيل خصم حضور من مسير معتمد أو مدفوع.",
  "core_payroll:attendance_deferral_target_payroll_locked": "شهر التحصيل المختار يحتوي مسيرًا معتمدًا أو مدفوعًا. اختر شهرًا آخر.",
  "core_payroll:attendance_deferral_period_locked": "فترة المصدر أو شهر التحصيل مقفلة ولا تقبل التأجيل.",
  "core_payroll:attendance_deduction_not_present": "لا يوجد خصم حضور حالي قابل للتأجيل لهذه الموظفة.",
  "core_payroll:attendance_deferral_idempotency_conflict": "يوجد تأجيل حضور سابق يتعارض مع الطلب الحالي. حدّث البيانات وراجع سجل الالتزامات.",
  "core_payroll:obligation_target_payroll_locked": "لا يمكن تعديل تحصيل شهر له مسير معتمد أو مدفوع.",
  "core_payroll:attendance_obligation_requires_canonical_path": "خصم الحضور التلقائي يجب إدارته من مسار تأجيل خصم الحضور في الرواتب.",
  "core_employee_request:version_conflict": "تم تحديث الطلب أثناء فتحه. أعد تحميل الطلب ثم نفّذ الإجراء مرة أخرى.",
  "core_employee_request:invalid_transition": "حالة الطلب الحالية لا تسمح بهذا الإجراء. أعد تحميل الطلب وراجع حالته.",
  "core_employee_request:insufficient_leave_balance": "رصيد الإجازة المتاح لا يكفي لتنفيذ هذه الإجازة.",
  "core_employee_request:insufficient_annual_leave_balance": "رصيد الإجازة السنوية لا يكفي لتنفيذ هذه الإجازة.",
  "core_client_connect:conversation_restricted": "تم إيقاف الإرسال مؤقتًا حتى تنتهي مراجعة الإدارة.",
  "core_client_connect:conversation_closed": "هذه المحادثة مغلقة.",
  "core_client_connect:disabled_for_client": "خدمة محادثات ملكات غير مفعلة لهذا الحساب.",
  "core_client_connect:conversation_forbidden": "لا تملك صلاحية الوصول إلى هذه المحادثة.",
  "core_cashback:insufficient_balance": "رصيد الكاش باك المتاح لا يكفي لهذه العملية.",
  "core_cashback:disabled": "الكاش باك غير مفعل حاليًا.",
  "core_leave:insufficient_balance": "رصيد الإجازة المتاح لا يكفي لتنفيذ هذه الإجازة.",
  "core_employee_request:leave_overlap": "توجد إجازة معتمدة أخرى تتداخل مع الفترة المحددة.",
  "core_leave:hr_review_resolution_required": "نوع الإجازة يحتاج قرار موارد بشرية إضافيًا قبل الاعتماد.",
  "core_leave:statutory_validation_required": "نوع الإجازة يحتاج تحققًا نظاميًا إضافيًا قبل الاعتماد.",
  "core_leave:entitlement_consumption_runtime_required": "هذه الإجازة تعتمد على رصيد استحقاق زمني ولم يكتمل مسار خصم الاستحقاق.",
};

const CORE_WRITE_OUTCOME_UNKNOWN_EVENT = "queens:core-write-outcome-unknown";
const inFlightGetRequests = new Map<string, Promise<unknown>>();

function isMutatingCoreMethod(method: CoreApiRequestOptions["method"]) {
  return method !== "GET";
}

function browserDefinitelyOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function isTransportFailure(error: unknown) {
  return (
    error instanceof TypeError ||
    (error instanceof Error &&
      /network|fetch|connection|load failed|failed to fetch/i.test(error.message))
  );
}

function emitUnknownWriteOutcome(
  path: string,
  method: string,
  operationId: string,
  options: CoreApiRequestOptions
) {
  if (typeof window === "undefined") return;

  const employeeId = String(
    options.reconciliation?.employeeId ||
    options.body?.employeeId ||
    ""
  ).trim();

  window.dispatchEvent(
    new CustomEvent(CORE_WRITE_OUTCOME_UNKNOWN_EVENT, {
      detail: {
        path,
        method,
        operationId,
        ...(employeeId ? { employeeId } : {}),
      },
    })
  );
}

function localizedMessage(status: number, code: string, fallback: string): string {
  const specific = CORE_API_CODE_MESSAGES[code];
  if (specific) return specific;
  if (status === 401) return "انتهت جلسة الدخول. سجّل الدخول مرة أخرى.";
  if (status === 403) return "ليست لديك صلاحية لتنفيذ هذه العملية.";
  if (status === 409) {
    return code.includes("slot")
      ? "الموعد محجوز بالفعل. اختاري وقتًا آخر."
      : "يوجد تعارض في البيانات. حدّث الصفحة وحاول مرة أخرى.";
  }
  if (status === 400 || status === 422) return "بعض البيانات غير صحيحة. راجع الحقول المطلوبة.";
  if (status === 408) return "انتهت مهلة الاتصال بالخدمة الأساسية.";
  if (status >= 500) return "الخدمة الأساسية غير متاحة مؤقتًا.";
  const safeFallback = String(fallback || "").trim();
  return safeFallback && !safeFallback.startsWith("core_")
    ? safeFallback
    : "تعذر تنفيذ الطلب.";
}

// CORE_REQUEST_TRACE_V1
function createCoreRequestId(): string {
  return crypto.randomUUID();
}

function createCoreOperationId(): string {
  return crypto.randomUUID();
}

function coreGetRequestKey(path: string, options: CoreApiRequestOptions) {
  const query = Object.entries(options.query ?? {})
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
  const uid = String(auth.currentUser?.uid || "anonymous");
  const timeoutMs = options.timeoutMs ?? 15_000;
  return `${uid}:${timeoutMs}:${path}${query ? `?${query}` : ""}`;
}

async function requestOnce<T>(
  path: string,
  options: CoreApiRequestOptions,
  forceTokenRefresh: boolean,
  operationId: string
): Promise<T> {
  const baseUrl = requireCoreWorkerUrl();
  const url = new URL(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`);

  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 15_000
  );

  try {
    const method = options.method ?? "GET";
    const requestId = createCoreRequestId();

    // CORE_NETWORK_SAFETY_V1
    // A request that is definitely offline must never pretend to be a normal
    // validation/server failure. Writes are stopped before they leave the client.
    if (browserDefinitelyOffline()) {
      throw new CoreApiError(
        0,
        "core_api:offline",
        localizedMessage(0, "core_api:offline", "")
      );
    }

    const currentUser = auth.currentUser;
    const token = currentUser
      ? await currentUser.getIdToken(forceTokenRefresh)
      : "";

    const response = await fetch(url.toString(), {
      method,
      signal: controller.signal,
      headers: {
        "X-Request-Id": requestId,
        ...(operationId ? { "Idempotency-Key": operationId } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(method !== "GET" && method !== "DELETE" ? { "Content-Type": "application/json" } : {}),
      },
      ...(method !== "GET" && method !== "DELETE"
        ? { body: JSON.stringify(options.body ?? {}) }
        : {}),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      data?: T;
      error?: string;
      message?: string;
      details?: unknown;
    };

    if (!response.ok || payload.ok === false) {
      const code = String(payload.error || `core_api:http_${response.status}`);
      console.warn("[core-api-error]", {
        requestId,
        method,
        path: url.pathname,
        status: response.status,
        code,
      });
      throw new CoreApiError(
        response.status,
        code,
        localizedMessage(response.status, code, String(payload.message || "")),
        payload.details
      );
    }

    return (payload.data ?? payload) as T;
  } catch (error) {
    if (error instanceof CoreApiError) {
      throw error;
    }

    const method = options.method ?? "GET";
    const mutating = isMutatingCoreMethod(method);

    if (error instanceof DOMException && error.name === "AbortError") {
      if (mutating) {
        emitUnknownWriteOutcome(path, method, operationId, options);
        throw new CoreApiError(
          0,
          "core_api:write_outcome_unknown",
          localizedMessage(0, "core_api:write_outcome_unknown", "")
        );
      }

      throw new CoreApiError(
        408,
        "core_api:timeout",
        localizedMessage(408, "core_api:timeout", "")
      );
    }

    if (isTransportFailure(error)) {
      if (mutating) {
        emitUnknownWriteOutcome(path, method, operationId, options);
        throw new CoreApiError(
          0,
          "core_api:write_outcome_unknown",
          localizedMessage(0, "core_api:write_outcome_unknown", "")
        );
      }

      throw new CoreApiError(
        0,
        "core_api:network_unavailable",
        localizedMessage(0, "core_api:network_unavailable", "")
      );
    }

    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function executeCoreRequest<T>(
  path: string,
  options: CoreApiRequestOptions,
  operationId: string
): Promise<T> {
  try {
    return await requestOnce<T>(
      path,
      options,
      false,
      operationId
    );
  } catch (error) {
    if (
      error instanceof CoreApiError &&
      error.status === 401 &&
      auth.currentUser
    ) {
      return requestOnce<T>(
        path,
        options,
        true,
        operationId
      );
    }
    throw error;
  }
}

export async function coreApiRequest<T>(
  path: string,
  options: CoreApiRequestOptions = {}
): Promise<T> {
  const logicalMethod = options.method ?? "GET";
  const operationId =
    logicalMethod === "GET"
      ? ""
      : (
          options.operationId ||
          createCoreOperationId()
        );

  if (logicalMethod !== "GET") {
    return executeCoreRequest<T>(path, options, operationId);
  }

  const requestKey = coreGetRequestKey(path, options);
  const existing = inFlightGetRequests.get(requestKey);
  if (existing) return existing as Promise<T>;

  const request = executeCoreRequest<T>(path, options, operationId)
    .finally(() => {
      inFlightGetRequests.delete(requestKey);
    });
  inFlightGetRequests.set(requestKey, request as Promise<unknown>);
  return request;
}
