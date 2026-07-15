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
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: Record<string, unknown>;
  query?: Record<string, string | number | boolean | null | undefined>;
  timeoutMs?: number;
};

function localizedMessage(status: number, code: string, fallback: string): string {
  if (status === 401) return "انتهت جلسة الدخول. سجّل الدخول مرة أخرى.";
  if (status === 403) return "ليست لديك صلاحية لتنفيذ هذه العملية.";
  if (status === 409) {
    return code.includes("slot")
      ? "الموعد محجوز بالفعل. اختاري وقتًا آخر."
      : "يوجد تعارض في البيانات.";
  }
  if (status === 400 || status === 422) return "بعض البيانات غير صحيحة.";
  if (status === 408) return "انتهت مهلة الاتصال بخدمة الحجز.";
  if (status >= 500) return "خدمة الحجز غير متاحة مؤقتًا.";
  return fallback || "تعذر تنفيذ الطلب.";
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
    };

    if (!response.ok || payload.ok === false) {
      const code = String(payload.error || `core_api:http_${response.status}`);
      throw new CoreApiError(
        response.status,
        code,
        localizedMessage(response.status, code, String(payload.message || "")),
        payload
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
