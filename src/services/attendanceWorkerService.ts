import { auth } from "./firebase";
import {
  getBrowserPosition,
  type AttendanceLocation,
} from "./attendanceSettingsService";
import type {
  AttendanceVerification,
  StaffAttendanceToday,
  StaffAttendanceWithId,
} from "./firestoreAttendance";

const DEFAULT_ATTENDANCE_WORKER_URL =
  "https://malikat-attendance.maedin.workers.dev";

const ATTENDANCE_DEVICE_ID_STORAGE_KEY =
  "malikat_attendance_device_id";

const ATTENDANCE_DEVICE_ID_PREFIX =
  "malikat-web-v2-";

export type AttendanceWorkerType =
  | "check_in"
  | "check_out";

export type AttendanceWorkerResult =
  | "allowed"
  | "rejected";

export type AttendanceWorkerResponse = {
  ok: boolean;
  id: string;
  result: AttendanceWorkerResult;
  type: AttendanceWorkerType;
  rejectionReason?: string | null;
  accuracy?: number | null;
  zoneId?: string | null;
  distanceMeters?: number | null;
  allowedRadiusMeters?: number | null;
  previousStatus?: string | null;
  currentStatus?: string | null;
  debug?: Record<string, unknown> | null;
};

export type AttendanceWorkerRecord = {
  id: string;
  employeeUid: string;
  employeeDocId: string;
  employeeName?: string | null;
  type: AttendanceWorkerType;
  result: AttendanceWorkerResult;
  serverTime: string;
  clientTime?: string | null;
  location: {
    lat: number;
    lng: number;
    accuracy: number;
  };
  zoneId?: string | null;
  zoneName?: string | null;
  zoneType?: string | null;
  distanceMeters?: number | null;
  rejectionReason?: string | null;
  accuracyAccepted?: boolean;
  deviceInfo?: Record<string, unknown>;
  createdByEmail?: string | null;
  createdByRole?: string | null;
};

type AttendanceRecordsResponse = {
  ok?: boolean;
  records?: AttendanceWorkerRecord[];
  total?: number;
  page?: number;
  limit?: number;
  nextCursor?: string | null;
  message?: string;
  detail?: string;
};

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function getWorkerBaseUrl() {
  const configured = cleanText(
    (import.meta as any).env
      ?.VITE_ATTENDANCE_WORKER_URL
  );

  return (
    configured || DEFAULT_ATTENDANCE_WORKER_URL
  ).replace(/\/+$/g, "");
}

function buildWorkerUrl(
  pathname: string,
  params?: Record<string, string | undefined>
) {
  const baseUrl = getWorkerBaseUrl();
  const cleanPath = pathname.startsWith("/")
    ? pathname
    : `/${pathname}`;

  const url = new URL(`${baseUrl}${cleanPath}`);

  for (const [key, value] of Object.entries(
    params || {}
  )) {
    if (cleanText(value)) {
      url.searchParams.set(key, cleanText(value));
    }
  }

  return url.toString();
}

function createRequestId() {
  const randomPart =
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);

  return `malikat-attendance-${Date.now().toString(
    36
  )}-${randomPart}`;
}

function createDeviceId() {
  const randomPart =
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(
          36
        )}-${Math.random()
          .toString(36)
          .slice(2)}`;

  return `${ATTENDANCE_DEVICE_ID_PREFIX}${randomPart}`;
}

export function getAttendanceDeviceId() {
  if (typeof window === "undefined") {
    return "";
  }

  try {
    const existing = cleanText(
      window.localStorage.getItem(
        ATTENDANCE_DEVICE_ID_STORAGE_KEY
      )
    );

    if (
      existing &&
      existing.startsWith(
        ATTENDANCE_DEVICE_ID_PREFIX
      )
    ) {
      return existing;
    }
  } catch {
    // التخزين قد يكون معطلاً في وضع الخصوصية.
  }

  const deviceId = createDeviceId();

  try {
    window.localStorage.setItem(
      ATTENDANCE_DEVICE_ID_STORAGE_KEY,
      deviceId
    );
  } catch {
    // نستخدم المعرف في الطلب الحالي حتى لو تعذر حفظه.
  }

  return deviceId;
}

function getDeviceInfo() {
  return {
    deviceId: getAttendanceDeviceId(),
    userAgent:
      typeof navigator !== "undefined"
        ? navigator.userAgent || ""
        : "",
    platform:
      typeof navigator !== "undefined"
        ? navigator.platform || ""
        : "",
    language:
      typeof navigator !== "undefined"
        ? navigator.language || ""
        : "",
    timeZone:
      typeof Intl !== "undefined"
        ? Intl.DateTimeFormat().resolvedOptions()
            .timeZone || ""
        : "",
  };
}

async function requestAttendanceWorker<T>(
  pathname: string,
  init: RequestInit = {},
  params?: Record<string, string | undefined>
): Promise<T> {
  const currentUser = auth.currentUser;

  if (!currentUser) {
    throw new Error(
      "يجب تسجيل الدخول قبل استخدام نظام الحضور."
    );
  }

  const response = await fetch(
    buildWorkerUrl(pathname, params),
    {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${await currentUser.getIdToken()}`,
        ...(init.body
          ? { "Content-Type": "application/json" }
          : {}),
        ...(init.headers || {}),
      },
      cache: "no-store",
    }
  );

  const payload = (await response
    .json()
    .catch(() => null)) as
    | (T & {
        message?: string;
        detail?: string;
      })
    | null;

  if (!response.ok || !payload) {
    const error = new Error(
      cleanText(
        payload?.message ||
          payload?.detail ||
          `attendance_worker_request_failed_${response.status}`
      )
    ) as Error & {
      status?: number;
      payload?: unknown;
    };

    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

function normalizeLocation(
  location: AttendanceLocation
) {
  const lat = Number(location?.lat);
  const lng = Number(location?.lng);
  const accuracy = Math.max(
    0,
    Math.round(Number(location?.accuracy || 0))
  );

  if (
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    !Number.isFinite(lng) ||
    lng < -180 ||
    lng > 180
  ) {
    throw new Error(
      "تعذر الحصول على إحداثيات موقع صحيحة."
    );
  }

  return {
    lat,
    lng,
    accuracy,
  };
}

export async function submitAttendanceToWorker(input: {
  employeeId: string;
  type: AttendanceWorkerType;
  location?: AttendanceLocation;
}) {
  const requestId = createRequestId();

  const location = normalizeLocation(
    input.location ||
      (await getBrowserPosition({
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 20000,
      }))
  );

  return requestAttendanceWorker<AttendanceWorkerResponse>(
    "/attendance/record",
    {
      method: "POST",
      body: JSON.stringify({
        employeeId: cleanText(input.employeeId),
        type: input.type,
        clientTime: new Date().toISOString(),
        location,
        deviceInfo: getDeviceInfo(),
        debug: {
          enabled: true,
          requestId,
          startedAt: new Date().toISOString(),
          pageUrl:
            typeof window !== "undefined"
              ? window.location.href
              : null,
        },
      }),
    }
  );
}

export async function fetchAttendanceRecordsFromWorker(
  input: {
    employeeUid: string;
    fromDate?: string;
    toDate?: string;
    result?: AttendanceWorkerResult;
    type?: AttendanceWorkerType;
    limit?: number;
    cursor?: string;
  }
) {
  const payload =
    await requestAttendanceWorker<AttendanceRecordsResponse>(
      "/attendance/records",
      { method: "GET" },
      {
        employeeUid: cleanText(input.employeeUid),
        fromDate: cleanText(input.fromDate),
        toDate: cleanText(input.toDate),
        result: input.result,
        type: input.type,
        limit: String(
          Math.min(
            200,
            Math.max(1, Number(input.limit || 200))
          )
        ),
        cursor: cleanText(input.cursor),
      }
    );

  if (
    payload.ok !== true ||
    !Array.isArray(payload.records)
  ) {
    throw new Error(
      cleanText(
        payload.message ||
          payload.detail ||
          "تعذر تحميل سجلات الحضور."
      )
    );
  }

  return {
    records: payload.records,
    total: Number(payload.total || 0),
    nextCursor: cleanText(payload.nextCursor) || null,
  };
}

function toRiyadhDateKey(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const values = Object.fromEntries(
    parts.map((part) => [
      part.type,
      part.value,
    ])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function recordVerification(
  record?: AttendanceWorkerRecord
): AttendanceVerification | undefined {
  if (!record) return undefined;

  return {
    location: record.location,
    workZoneId:
      cleanText(record.zoneId) || undefined,
    workZoneName:
      cleanText(record.zoneName) || undefined,
    distanceMeters:
      record.distanceMeters == null
        ? undefined
        : Math.max(
            0,
            Math.round(
              Number(record.distanceMeters)
            )
          ),
  };
}

function buildAttendanceDay(
  records: AttendanceWorkerRecord[],
  employeeId: string,
  date: string
): StaffAttendanceToday {
  const allowed = records
    .filter(
      (record) =>
        record.result === "allowed" &&
        toRiyadhDateKey(record.serverTime) === date
    )
    .sort(
      (left, right) =>
        Date.parse(left.serverTime) -
        Date.parse(right.serverTime)
    );

  const checkIn = allowed.find(
    (record) => record.type === "check_in"
  );

  const checkOut = [...allowed]
    .reverse()
    .find(
      (record) => record.type === "check_out"
    );

  const status =
    checkOut
      ? "checked_out"
      : checkIn
        ? "checked_in"
        : "not_started";

  return {
    id: date,
    employeeId,
    date,
    status,
    checkInAtClient:
      checkIn?.serverTime || undefined,
    checkOutAtClient:
      checkOut?.serverTime || undefined,
    checkInVerification:
      recordVerification(checkIn),
    checkOutVerification:
      recordVerification(checkOut),
  };
}

export async function getAttendanceForDateFromWorker(
  input: {
    employeeUid: string;
    employeeId: string;
    date: string;
  }
) {
  const result =
    await fetchAttendanceRecordsFromWorker({
      employeeUid: input.employeeUid,
      fromDate: input.date,
      toDate: input.date,
      result: "allowed",
      limit: 20,
    });

  return buildAttendanceDay(
    result.records,
    input.employeeId,
    input.date
  );
}

export async function listAttendanceByDateRangeFromWorker(
  input: {
    employeeUid: string;
    employeeId: string;
    fromDate: string;
    toDate: string;
  }
): Promise<StaffAttendanceWithId[]> {
  const result =
    await fetchAttendanceRecordsFromWorker({
      employeeUid: input.employeeUid,
      fromDate: input.fromDate,
      toDate: input.toDate,
      result: "allowed",
      limit: 200,
    });

  const dates = new Set<string>();

  for (const record of result.records) {
    const date = toRiyadhDateKey(
      record.serverTime
    );

    if (
      date &&
      date >= input.fromDate &&
      date <= input.toDate
    ) {
      dates.add(date);
    }
  }

  return Array.from(dates)
    .sort()
    .map((date) =>
      buildAttendanceDay(
        result.records,
        input.employeeId,
        date
      )
    );
}

export type AttendanceWorkerEmployeeRef = {
  employeeUid: string;
  employeeId: string;
};

export async function listAttendanceForEmployeesDateFromWorker(
  input: {
    employees: AttendanceWorkerEmployeeRef[];
    date: string;
  }
): Promise<StaffAttendanceToday[]> {
  const date = cleanText(input.date);
  const employees: AttendanceWorkerEmployeeRef[] = [];
  const seenEmployeeIds = new Set<string>();

  for (
    const rawEmployee of Array.isArray(input.employees)
      ? input.employees
      : []
  ) {
    const employeeUid = cleanText(rawEmployee?.employeeUid);
    const employeeId = cleanText(rawEmployee?.employeeId);

    if (!employeeId || seenEmployeeIds.has(employeeId)) {
      continue;
    }

    seenEmployeeIds.add(employeeId);
    employees.push({
      employeeUid,
      employeeId,
    });
  }

  if (!date || !employees.length) {
    return [];
  }

  const result = await fetchAttendanceRecordsFromWorker({
    employeeUid: "",
    fromDate: date,
    toDate: date,
    result: "allowed",
    limit: 200,
  });

  return employees.map((employee) => {
    const employeeRecords = result.records.filter((record) => {
      const uidMatches =
        Boolean(employee.employeeUid) &&
        record.employeeUid === employee.employeeUid;

      const documentMatches =
        record.employeeDocId === employee.employeeId;

      return uidMatches || documentMatches;
    });

    return buildAttendanceDay(
      employeeRecords,
      employee.employeeId,
      date
    );
  });
}

export async function listAttendanceByDateRangeForEmployeeFromWorker(
  input: {
    employeeUid?: string;
    employeeId: string;
    fromDate: string;
    toDate: string;
  }
): Promise<StaffAttendanceWithId[]> {
  const employeeUid = cleanText(input.employeeUid);
  const employeeId = cleanText(input.employeeId);
  const fromDate = cleanText(input.fromDate);
  const toDate = cleanText(input.toDate);

  if (!employeeId || !fromDate || !toDate) {
    return [];
  }

  const result = await fetchAttendanceRecordsFromWorker({
    employeeUid: "",
    fromDate,
    toDate,
    result: "allowed",
    limit: 200,
  });

  const employeeRecords = result.records.filter((record) => {
    const uidMatches =
      Boolean(employeeUid) &&
      record.employeeUid === employeeUid;

    const documentMatches =
      record.employeeDocId === employeeId;

    return uidMatches || documentMatches;
  });

  const dates = new Set<string>();

  for (const record of employeeRecords) {
    const date = toRiyadhDateKey(record.serverTime);

    if (date && date >= fromDate && date <= toDate) {
      dates.add(date);
    }
  }

  return Array.from(dates)
    .sort()
    .map((date) =>
      buildAttendanceDay(
        employeeRecords,
        employeeId,
        date
      )
    );
}


export type AttendanceAdminAdjustmentResponse = {
  ok: boolean;
  action?: string;
  date?: string;
  clearedRecords?: number;
  records?: Array<{
    id: string;
    type: AttendanceWorkerType;
    action: "created" | "updated";
    serverTime: string;
  }>;
  message?: string;
  detail?: string;
};

export async function adjustAttendanceDayFromWorker(
  input: {
    employeeUid: string;
    employeeId: string;
    date: string;
    checkInTime: string;
    checkOutTime?: string;
    note?: string;
  }
) {
  const payload =
    await requestAttendanceWorker<AttendanceAdminAdjustmentResponse>(
      "/attendance/admin-adjustment",
      {
        method: "POST",
        body: JSON.stringify({
          employeeUid: cleanText(input.employeeUid),
          employeeDocId: cleanText(input.employeeId),
          date: cleanText(input.date),
          checkInTime: cleanText(input.checkInTime),
          checkOutTime: cleanText(input.checkOutTime),
          note: cleanText(input.note),
        }),
      }
    );

  if (payload.ok !== true) {
    throw new Error(
      cleanText(
        payload.message ||
          payload.detail ||
          "تعذر تعديل بصمة الموظفة."
      )
    );
  }

  return payload;
}

export async function clearAttendanceDayFromWorker(
  input: {
    employeeUid: string;
    employeeId: string;
    date: string;
    note?: string;
  }
) {
  const payload =
    await requestAttendanceWorker<AttendanceAdminAdjustmentResponse>(
      "/attendance/admin-adjustment",
      {
        method: "POST",
        body: JSON.stringify({
          employeeUid: cleanText(input.employeeUid),
          employeeDocId: cleanText(input.employeeId),
          date: cleanText(input.date),
          action: "clear",
          clear: true,
          note: cleanText(input.note),
        }),
      }
    );

  if (payload.ok !== true) {
    throw new Error(
      cleanText(
        payload.message ||
          payload.detail ||
          "تعذر مسح بصمة الموظفة."
      )
    );
  }

  return payload;
}

export function getAttendanceWorkerMessage(
  response: AttendanceWorkerResponse
) {
  if (response.result === "allowed") {
    return response.type === "check_in"
      ? "تم تسجيل الحضور بنجاح"
      : "تم تسجيل الانصراف بنجاح";
  }

  switch (response.rejectionReason) {
    case "poor_accuracy":
      return `دقة الموقع ضعيفة${
        response.accuracy != null
          ? ` (${Math.round(
              response.accuracy
            )} م)`
          : ""
      }. فعّل الموقع الدقيق وWi-Fi ثم حاول مرة أخرى.`;

    case "outside_zone":
      return `أنت خارج نطاق العمل${
        response.distanceMeters != null
          ? ` · المسافة ${Math.round(
              response.distanceMeters
            )} م`
          : ""
      }.`;

    case "office_ip_mismatch":
      return "يجب الاتصال بشبكة الإنترنت الخاصة بالفرع.";

    case "office_ip_unavailable":
      return "تعذر التحقق من شبكة الفرع.";

    case "duplicate_check_in":
      return "تم تسجيل الحضور لهذا اليوم بالفعل.";

    case "not_checked_in":
      return "يجب تسجيل الحضور قبل تسجيل الانصراف.";

    case "zone_not_found":
      return "لم يتم العثور على نطاق حضور مرتبط بالموظفة.";

    case "zone_invalid":
      return "إعدادات نطاق الحضور غير مكتملة.";

    default:
      return "تعذر قبول عملية الحضور الآن.";
  }
}
