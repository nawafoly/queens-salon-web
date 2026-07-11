import { auth } from "./firebase";
import {
  getBrowserPosition,
  type AttendanceLocation,
  type WorkZone,
} from "./attendanceSettingsService";
import type {
  AttendanceRawRecord,
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

type AttendanceWorkerZoneResponse = {
  ok?: boolean;
  zone?: unknown;
  id?: string;
  message?: string;
};

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function isAttendanceDebugEnabled() {
  return Boolean((import.meta as any).env?.DEV);
}

function attendanceDebug(...args: unknown[]) {
  if (!isAttendanceDebugEnabled()) return;
  console.info("[attendance-debug]", ...args);
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

export async function upsertWorkZoneInAttendanceWorker(zone: WorkZone) {
  const id = cleanText(zone.id);

  if (!id) {
    throw new Error("معرف نطاق الحضور مطلوب لمزامنة خادم الحضور.");
  }

  return requestAttendanceWorker<AttendanceWorkerZoneResponse>(
    "/attendance/work-zones",
    {
      method: "POST",
      body: JSON.stringify({
        id,
        name: cleanText(zone.name) || id,
        type: "radius",
        center: {
          lat: Number(zone.lat),
          lng: Number(zone.lng),
        },
        radiusMeters: Number(zone.radiusMeters),
        active: zone.active !== false,
      }),
    }
  );
}

export async function deleteWorkZoneFromAttendanceWorker(id: string) {
  const cleanId = cleanText(id);

  if (!cleanId) {
    return { ok: true, id: "" };
  }

  try {
    return await requestAttendanceWorker<AttendanceWorkerZoneResponse>(
      `/attendance/work-zones/${encodeURIComponent(cleanId)}`,
      { method: "DELETE" }
    );
  } catch (error) {
    const status = Number((error as { status?: number })?.status);
    const message = cleanText((error as { message?: string })?.message);

    if (status === 404 || message === "work_zone_not_found") {
      return { ok: true, id: cleanId };
    }

    throw error;
  }
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

type WorkerPayload = T & {
    message?: string;
    detail?: string;
    requiredPermission?: string;
  };

  const executeRequest = async (
    forceRefreshToken: boolean
  ): Promise<{
    response: Response;
    payload: WorkerPayload | null;
  }> => {
    const idToken = await currentUser.getIdToken(
      forceRefreshToken
    );

    const response = await fetch(
      buildWorkerUrl(pathname, params),
      {
        ...init,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${idToken}`,
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
      .catch(() => null)) as WorkerPayload | null;

    return { response, payload };
  };

  let result: {
    response: Response;
    payload: WorkerPayload | null;
  };

  try {
    result = await executeRequest(false);

    const authFailureMessage = cleanText(
      result.payload?.message || result.payload?.detail
    );
    const shouldRefreshToken =
      result.response.status === 401 ||
      (result.response.status === 403 &&
        [
          "attendance_records_forbidden",
          "attendance_management_forbidden",
          "attendance_permission_forbidden",
          "invalid_firebase_id_token",
        ].includes(authFailureMessage));

    // Firebase caches ID tokens. When an account role/custom claim changes,
    // refresh once and retry before surfacing a permission error.
    if (shouldRefreshToken) {
      result = await executeRequest(true);
    }
  } catch (cause) {
    const error = new Error(
      "تم التقاط الموقع، لكن تعذر الاتصال بخادم الحضور. تحقق من اتصال الإنترنت وإعدادات CORS الخاصة بـ Cloudflare Worker."
    ) as Error & {
      cause?: unknown;
    };

    error.cause = cause;
    throw error;
  }

  const { response, payload } = result;

  if (!response.ok || !payload) {
    const rawMessage = cleanText(
      payload?.message ||
        payload?.detail ||
        `attendance_worker_request_failed_${response.status}`
    );
    const requiredPermission = cleanText(
      payload?.requiredPermission
    );
    const displayMessage =
      rawMessage === "attendance_permission_forbidden"
        ? requiredPermission
          ? `لا تملك صلاحية الحضور المطلوبة: ${requiredPermission}`
          : "لا تملك صلاحية تنفيذ هذا الإجراء في نظام الحضور."
        : rawMessage;

    const error = new Error(displayMessage) as Error & {
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
  employeeUid?: string;
  employeeId: string;
  attendanceZoneId?: string;
  type: AttendanceWorkerType;
  location?: AttendanceLocation;
}) {
  const requestId = createRequestId();

  const location = normalizeLocation(
    input.location ||
      (await getBrowserPosition({
        enableHighAccuracy: true,
        maximumAge: 10000,
        timeout: 12000,
        targetAccuracyMeters: 50,
        acceptableAccuracyMeters: 150,
        acceptableReadingDelayMs: 400,
        acceptFirstUsableReading: true,
      }))
  );

  return requestAttendanceWorker<AttendanceWorkerResponse>(
    "/attendance/record",
    {
      method: "POST",
      body: JSON.stringify({
        employeeUid: cleanText(input.employeeUid),
        employeeId: cleanText(input.employeeId),
        attendanceZoneId: cleanText(input.attendanceZoneId),
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
    employeeDocId?: string;
    fromDate?: string;
    toDate?: string;
    result?: AttendanceWorkerResult;
    type?: AttendanceWorkerType;
    limit?: number;
    cursor?: string;
  }
) {
  attendanceDebug(
    `worker-request employeeUid=${cleanText(input.employeeUid) || "(empty)"}`,
    `employeeDocId=${cleanText(input.employeeDocId) || "(empty)"}`,
    `from=${cleanText(input.fromDate) || "(none)"}`,
    `to=${cleanText(input.toDate) || "(none)"}`,
    `result=${input.result || "(any)"}`
  );

  const payload =
    await requestAttendanceWorker<AttendanceRecordsResponse>(
      "/attendance/records",
      { method: "GET" },
      {
        employeeUid: cleanText(input.employeeUid),
        employeeDocId: cleanText(input.employeeDocId),
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

  const records = payload.records;
  attendanceDebug(
    `records=${records.length}`,
    `dates=${JSON.stringify(
      Array.from(
        new Set(
          records
            .map((record) => toRiyadhDateKey(record.serverTime))
            .filter(Boolean)
        )
      ).sort()
    )}`
  );

  return {
    records,
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

function recordMatchesEmployee(
  record: AttendanceWorkerRecord,
  employeeUid: string,
  employeeId: string
) {
  const recordUid = cleanText(record.employeeUid);
  const recordDocId = cleanText(record.employeeDocId);

  return (
    (!!employeeUid && (recordUid === employeeUid || recordDocId === employeeUid)) ||
    (!!employeeId && (recordDocId === employeeId || recordUid === employeeId))
  );
}

function toAttendanceRawRecord(record: AttendanceWorkerRecord): AttendanceRawRecord {
  return {
    id: record.id,
    type: record.type,
    result: record.result,
    serverTime: record.serverTime,
    clientTime: record.clientTime || null,
    location: record.location,
    zoneId: record.zoneId || null,
    zoneName: record.zoneName || null,
    distanceMeters:
      record.distanceMeters == null
        ? null
        : Number(record.distanceMeters),
  };
}

function getRecordDateKeysInRange(
  records: AttendanceWorkerRecord[],
  fromDate: string,
  toDate: string
) {
  const dates = new Set<string>();

  for (const record of records) {
    const date = toRiyadhDateKey(record.serverTime);

    if (date && date >= fromDate && date <= toDate) {
      dates.add(date);
    }
  }

  return Array.from(dates).sort();
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
    records: allowed.map(toAttendanceRawRecord),
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
      employeeDocId: input.employeeId,
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
      employeeDocId: input.employeeId,
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

  // Load the entire team's records for the selected day in one paginated request
  // instead of issuing one HTTP request per employee.
  const allRecords: AttendanceWorkerRecord[] = [];
  const seenCursors = new Set<string>();
  let cursor = "";

  do {
    const page = await fetchAttendanceRecordsFromWorker({
      employeeUid: "",
      employeeDocId: "",
      fromDate: date,
      toDate: date,
      result: "allowed",
      limit: 200,
      cursor,
    });

    allRecords.push(...page.records);

    const nextCursor = cleanText(page.nextCursor);
    if (!nextCursor || seenCursors.has(nextCursor)) {
      cursor = "";
      break;
    }

    seenCursors.add(nextCursor);
    cursor = nextCursor;
  } while (cursor);

  attendanceDebug(
    `team-batch date=${date}`,
    `employees=${employees.length}`,
    `records=${allRecords.length}`
  );

  return employees.map((employee) => {
    const employeeRecords = allRecords.filter((record) =>
      recordMatchesEmployee(
        record,
        employee.employeeUid,
        employee.employeeId
      )
    );

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

  const requestEmployeeUid = employeeUid || employeeId;

  if (!requestEmployeeUid || !employeeId || !fromDate || !toDate) {
    return [];
  }

  attendanceDebug(
    `employeeUid=${requestEmployeeUid}`,
    `employeeId=${employeeId}`,
    `range=${fromDate}..${toDate}`
  );

  const result = await fetchAttendanceRecordsFromWorker({
    employeeUid: requestEmployeeUid,
    employeeDocId: employeeId,
    fromDate,
    toDate,
    result: "allowed",
    limit: 200,
  });

  const employeeRecords = result.records.filter((record) =>
    recordMatchesEmployee(record, employeeUid, employeeId)
  );

  const dates = getRecordDateKeysInRange(employeeRecords, fromDate, toDate);

  attendanceDebug(
    `matched-records=${employeeRecords.length}`,
    `dates=${JSON.stringify(dates)}`
  );

  return dates.map((date) =>
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

  if (response.rejectionReason === "outside_zone") {
    return [
      "أنت خارج نطاق العمل",
      response.distanceMeters != null
        ? `المسافة الفعلية ${Math.round(response.distanceMeters)} م`
        : "",
      response.allowedRadiusMeters != null
        ? `نصف القطر المسموح ${Math.round(response.allowedRadiusMeters)} م`
        : "",
    ].filter(Boolean).join(" · ");
  }

  if (response.rejectionReason === "zone_not_assigned") {
    return "نطاق الحضور غير معيّن لهذه الموظفة. يرجى تحديد نطاق الحضور من ملف الموظفة.";
  }

  if (response.rejectionReason === "attendance_zone_mismatch") {
    return "نطاق الحضور المرسل لا يطابق النطاق المعيّن للموظفة.";
  }

  if (response.rejectionReason === "zone_not_found") {
    return "النطاق المعيّن للموظفة غير موجود أو لم تتم مزامنته مع خادم الحضور.";
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
