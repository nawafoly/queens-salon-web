import { HR_COLLECTIONS } from "../../services/hrCollections";
import {
  EMPLOYEE_DEFAULT_FILE_TYPE,
  EMPLOYEE_FILE_CATEGORY,
  EMPLOYEE_FILE_STATUS_ACTIVE,
  EMPLOYEE_FILE_STATUS_REPLACED,
  type EmployeeFileDoc,
  type EmployeeFileStatus,
  type EmployeeFileType,
} from "../../types/hrEmployee";

export const EMPLOYEE_FILES_COLLECTION = HR_COLLECTIONS.employeeFiles[2];

function toDateSafe(value: unknown) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "object" && value !== null) {
    const maybeTimestamp = value as { toDate?: () => Date; seconds?: number; nanoseconds?: number };
    if (typeof maybeTimestamp.toDate === "function") {
      const date = maybeTimestamp.toDate();
      return Number.isNaN(date.getTime()) ? null : date;
    }
    if (typeof maybeTimestamp.seconds === "number") {
      const date = new Date(maybeTimestamp.seconds * 1000 + Math.floor((maybeTimestamp.nanoseconds || 0) / 1000000));
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDateEN(date: Date, options?: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", options).format(date);
}

function formatNumberEN(value: number, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat("en-US", options).format(value);
}
function buildR2DownloadUrl(filePath: string, download = false) {
  const normalized = String(filePath || "").trim();
  if (!normalized) return "";
  if (/^https?:\/\//i.test(normalized)) return normalized;
  // TODO: Wire this to MALIKAT src/services/r2Upload.ts or a signed-download service when HR files need private downloads.
  return download ? normalized : normalized;
}
function resolveEmployeeAvatarUrl(
  explicitAvatarUrl?: unknown,
  fallbackInput?: Record<string, unknown>
) {
  const explicit = String(explicitAvatarUrl || "").trim();
  if (explicit) return explicit;
  return String(fallbackInput?.avatarUrl || "").trim();
}
export {
  EMPLOYEE_DEFAULT_FILE_TYPE,
  EMPLOYEE_FILE_CATEGORY,
  EMPLOYEE_FILE_STATUS_ACTIVE,
  EMPLOYEE_FILE_STATUS_REPLACED,
};

export const EMPLOYEE_FILE_TYPE_OPTIONS: Array<{
  value: EmployeeFileType;
  label: string;
}> = [
  { value: "general", label: "عام" },
  { value: "contract", label: "عقد" },
  { value: "warning", label: "إنذار" },
  { value: "letter", label: "خطاب" },
  { value: "cv", label: "السيرة الذاتية" },
  { value: "education_certificate", label: "الشهادات" },
];

export type EmployeeFileDirection = "incoming" | "outgoing";

export type EmployeeFileRecord = EmployeeFileDoc & {
  id: string;
  viewUrl: string;
  downloadUrl: string;
  createdAtDate: Date | null;
  uploadedAtDate: Date | null;
  readAtDate: Date | null;
  replacedAtDate: Date | null;
  fileTypeLabel: string;
  status: EmployeeFileStatus;
  active: boolean;
  statusLabel: string;
  statusTone: "default" | "warning" | "success";
  readStatusLabel: string;
  readStatusTone: "success" | "warning";
  direction: EmployeeFileDirection;
  isInternalTransfer: boolean;
  officialDocument: boolean;
};

function pickText(...values: unknown[]) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text && text !== "undefined" && text !== "null") return text;
  }
  return "";
}

function toNullableNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toNullableBoolean(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

export function isEmployeeFileActive(
  raw: Pick<EmployeeFileDoc, "status" | "active"> | null | undefined
) {
  const normalizedStatus = String(raw?.status || "").trim().toLowerCase();
  const normalizedActive = toNullableBoolean(raw?.active);

  if (normalizedStatus === EMPLOYEE_FILE_STATUS_REPLACED) return false;
  if (normalizedActive !== null) return normalizedActive;
  return true;
}

function normalizeEmployeeFileStatus(value: unknown, active: boolean) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return active ? EMPLOYEE_FILE_STATUS_ACTIVE : EMPLOYEE_FILE_STATUS_REPLACED;
  }
  return normalized as EmployeeFileStatus;
}

export function getEmployeeFileStatusLabel(value: unknown, active: boolean) {
  const normalized = normalizeEmployeeFileStatus(value, active);
  if (normalized === EMPLOYEE_FILE_STATUS_REPLACED) {
    return "مستبدل";
  }
  return "النسخة الحالية";
}

export function getEmployeeFileTypeLabel(value: unknown) {
  const normalized = String(value || EMPLOYEE_DEFAULT_FILE_TYPE)
    .trim()
    .toLowerCase();

  if (normalized === "approval") return "اعتماد";

  return (
    EMPLOYEE_FILE_TYPE_OPTIONS.find(option => option.value === normalized)?.label ||
    normalized ||
    "عام"
  );
}

function normalizeEmployeeFileType(value: unknown) {
  return String(value || EMPLOYEE_DEFAULT_FILE_TYPE)
    .trim()
    .toLowerCase();
}

export function isOfficialEmployeeFile(
  raw:
    | Pick<EmployeeFileDoc, "fileType" | "officialDocument">
    | null
    | undefined
) {
  if (raw?.officialDocument === true) return true;
  const normalizedFileType = normalizeEmployeeFileType(raw?.fileType);
  return ["cv", "education_certificate"].includes(normalizedFileType);
}

export function buildEmployeeFileParticipants(...values: Array<unknown>) {
  return Array.from(
    new Set(
      values
        .map(value => String(value ?? "").trim())
        .filter(value => value && value !== "undefined" && value !== "null")
    )
  );
}

export function normalizeEmployeeFileRecord(
  id: string,
  raw: Record<string, unknown> | null | undefined,
  viewerUid?: string | null
): EmployeeFileRecord {
  const filePath = pickText(raw?.filePath);
  const fileUrl = pickText(
    raw?.fileUrl,
    filePath ? buildR2DownloadUrl(filePath, false) : ""
  );
  const viewUrl =
    fileUrl || (filePath ? buildR2DownloadUrl(filePath, false) : "");
  const downloadUrl = pickText(
    filePath ? buildR2DownloadUrl(filePath, true) : "",
    fileUrl,
    viewUrl
  );
  const createdAtDate = toDateSafe(raw?.createdAt);
  const uploadedAtDate = toDateSafe(raw?.uploadedAt ?? raw?.createdAt);
  const isRead = Boolean(raw?.isRead);
  const readAtDate = toDateSafe(raw?.readAt);
  const active = isEmployeeFileActive(raw as EmployeeFileDoc);
  const status = normalizeEmployeeFileStatus(raw?.status, active);
  const replacedAtDate = toDateSafe(raw?.replacedAt);
  const senderUid = pickText(raw?.senderUid);
  const receiverUid = pickText(raw?.receiverUid, raw?.employeeUid, raw?.userId);
  const participantUids = Array.isArray(raw?.participantUids)
    ? raw.participantUids
        .map((value: unknown) => String(value ?? "").trim())
        .filter(Boolean)
    : [];
  const isInternalTransfer =
    Boolean(senderUid && receiverUid) || participantUids.length >= 2;
  const direction: EmployeeFileDirection =
    viewerUid && senderUid && viewerUid === senderUid ? "outgoing" : "incoming";
  const officialDocument = isOfficialEmployeeFile(raw as EmployeeFileDoc);

  return {
    id,
    employeeId: pickText(raw?.employeeId),
    employeeUid: pickText(raw?.employeeUid, raw?.userId),
    userId: pickText(raw?.userId) || null,
    employeeName: pickText(raw?.employeeName) || null,
    senderUid: senderUid || null,
    senderName: pickText(raw?.senderName, raw?.uploadedByName) || null,
    senderEmail: pickText(raw?.senderEmail) || null,
    senderPhoto: resolveEmployeeAvatarUrl(pickText(raw?.senderPhoto), {
      uid: senderUid,
      name: pickText(raw?.senderName, raw?.uploadedByName),
      email: raw?.senderEmail,
    }),
    receiverUid: receiverUid || null,
    receiverName: pickText(raw?.receiverName, raw?.employeeName) || null,
    receiverEmail: pickText(raw?.receiverEmail) || null,
    receiverPhoto: resolveEmployeeAvatarUrl(pickText(raw?.receiverPhoto), {
      uid: receiverUid,
      name: pickText(raw?.receiverName, raw?.employeeName),
      email: raw?.receiverEmail,
    }),
    participantUids,
    title: pickText(raw?.title) || "ملف داخلي",
    description: pickText(raw?.description) || null,
    fileType: pickText(raw?.fileType) || EMPLOYEE_DEFAULT_FILE_TYPE,
    fileId: pickText(raw?.fileId) || null,
    fileName: pickText(raw?.fileName) || "attachment",
    filePath: filePath || null,
    fileUrl: fileUrl || viewUrl,
    storageKey: pickText(raw?.storageKey, raw?.filePath) || null,
    contentType: pickText(raw?.contentType, raw?.mimeType) || null,
    mimeType: pickText(raw?.mimeType, raw?.contentType) || null,
    fileSize: toNullableNumber(raw?.fileSize),
    category:
      pickText(raw?.category, EMPLOYEE_FILE_CATEGORY) || EMPLOYEE_FILE_CATEGORY,
    uploadedBy: pickText(raw?.uploadedBy) || null,
    uploadedByName: pickText(raw?.uploadedByName) || null,
    createdAt: raw?.createdAt ?? raw?.uploadedAt ?? null,
    uploadedAt: raw?.uploadedAt ?? raw?.createdAt ?? null,
    status,
    active,
    replacedAt: raw?.replacedAt ?? null,
    replacedBy: pickText(raw?.replacedBy) || null,
    replacedByName: pickText(raw?.replacedByName) || null,
    replacedByFileId: pickText(raw?.replacedByFileId) || null,
    replacesFileId: pickText(raw?.replacesFileId) || null,
    isRead,
    readAt: raw?.readAt ?? null,
    updatedAt: raw?.updatedAt ?? null,
    viewUrl,
    downloadUrl,
    createdAtDate,
    uploadedAtDate,
    readAtDate,
    replacedAtDate,
    fileTypeLabel: getEmployeeFileTypeLabel(raw?.fileType),
    statusLabel: getEmployeeFileStatusLabel(raw?.status, active),
    statusTone: active ? "success" : "default",
    readStatusLabel: isRead ? "مقروء" : "جديد",
    readStatusTone: isRead ? "success" : "warning",
    direction,
    isInternalTransfer,
    officialDocument,
  };
}

export function sortEmployeeFiles(records: EmployeeFileRecord[]) {
  return [...records].sort((left, right) => {
    if (left.active !== right.active) {
      return left.active ? -1 : 1;
    }
    const leftTime =
      left.createdAtDate?.getTime() ?? left.uploadedAtDate?.getTime() ?? 0;
    const rightTime =
      right.createdAtDate?.getTime() ?? right.uploadedAtDate?.getTime() ?? 0;
    if (leftTime !== rightTime) return rightTime - leftTime;
    return left.title.localeCompare(right.title, "ar");
  });
}

export function filterActiveEmployeeFiles(records: EmployeeFileRecord[]) {
  return records.filter(record => record.active);
}

export function filterIncomingEmployeeFiles(
  records: EmployeeFileRecord[],
  viewerUid?: string | null
) {
  return records.filter(record => {
    if (!record.active) return false;
    if (record.direction === "outgoing") return false;
    if (!record.isInternalTransfer) {
      return !viewerUid || record.employeeUid === viewerUid;
    }
    return !viewerUid || record.receiverUid === viewerUid;
  });
}

export function filterSentEmployeeFiles(
  records: EmployeeFileRecord[],
  viewerUid?: string | null
) {
  return records.filter(
    record =>
      record.active &&
      record.isInternalTransfer &&
      Boolean(viewerUid) &&
      record.senderUid === viewerUid
  );
}
