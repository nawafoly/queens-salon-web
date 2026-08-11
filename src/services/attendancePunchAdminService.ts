import { auth } from "./firebase";

const DEFAULT_ATTENDANCE_WORKER_URL =
  "https://malikat-attendance.maedin.workers.dev";

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function getWorkerBaseUrl() {
  const configured = cleanText(
    (import.meta as any).env?.VITE_ATTENDANCE_WORKER_URL
  );
  return (configured || DEFAULT_ATTENDANCE_WORKER_URL).replace(/\/+$/g, "");
}

type SelectiveClearResponse = {
  ok?: boolean;
  action?: string;
  date?: string;
  clearedRecords?: number;
  message?: string;
  detail?: string;
};

async function postSelectiveClear(body: Record<string, unknown>) {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error("يجب تسجيل الدخول قبل تعديل سجل الحضور.");
  }

  const execute = async (forceRefreshToken: boolean) => {
    const idToken = await currentUser.getIdToken(forceRefreshToken);
    const response = await fetch(
      `${getWorkerBaseUrl()}/attendance/admin-adjustment`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify(body),
      }
    );
    const payload = (await response.json().catch(() => null)) as SelectiveClearResponse | null;
    return { response, payload };
  };

  let result = await execute(false);
  if (result.response.status === 401 || result.response.status === 403) {
    result = await execute(true);
  }

  const { response, payload } = result;
  if (!response.ok || payload?.ok !== true) {
    throw new Error(
      cleanText(payload?.message || payload?.detail) ||
        `attendance_worker_request_failed_${response.status}`
    );
  }

  return payload;
}

export async function clearAttendancePunchTimeFromWorker(input: {
  employeeUid: string;
  employeeId: string;
  date: string;
  recordIds?: string[];
  serverTimes?: string[];
  note?: string;
}) {
  const recordIds = Array.from(
    new Set((input.recordIds || []).map(cleanText).filter(Boolean))
  );
  const serverTimes = Array.from(
    new Set((input.serverTimes || []).map(cleanText).filter(Boolean))
  );

  if (!cleanText(input.employeeUid) || !cleanText(input.employeeId) || !cleanText(input.date)) {
    throw new Error("تعذر تحديد الموظفة أو تاريخ البصمة.");
  }
  if (!recordIds.length && !serverTimes.length) {
    throw new Error("تعذر تحديد سجل الوقت المطلوب مسحه.");
  }

  return postSelectiveClear({
    employeeUid: cleanText(input.employeeUid),
    employeeDocId: cleanText(input.employeeId),
    date: cleanText(input.date),
    action: "clear",
    clear: true,
    recordIds,
    serverTimes,
    note: cleanText(input.note),
  });
}
