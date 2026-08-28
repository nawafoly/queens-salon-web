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
};

const CORE_API_CODE_MESSAGES: Record<string, string> = {
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
};

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

async function requestOnce<T>(
  path: string,
  options: CoreApiRequestOptions,
  forceTokenRefresh: boolean
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
    const currentUser = auth.currentUser;
    const token = currentUser
      ? await currentUser.getIdToken(forceTokenRefresh)
      : "";
    const method = options.method ?? "GET";

    const response = await fetch(url.toString(), {
      method,
      signal: controller.signal,
      headers: {
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
      throw new CoreApiError(
        response.status,
        code,
        localizedMessage(response.status, code, String(payload.message || "")),
        payload.details
      );
    }

    return (payload.data ?? payload) as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new CoreApiError(
        408,
        "core_api:timeout",
        localizedMessage(408, "core_api:timeout", "")
      );
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export async function coreApiRequest<T>(
  path: string,
  options: CoreApiRequestOptions = {}
): Promise<T> {
  try {
    return await requestOnce<T>(path, options, false);
  } catch (error) {
    if (
      error instanceof CoreApiError &&
      error.status === 401 &&
      auth.currentUser
    ) {
      return requestOnce<T>(path, options, true);
    }
    throw error;
  }
}
