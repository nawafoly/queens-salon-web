import { CoreFilesService } from "./CoreFilesService";
import type { CoreFileMetadata } from "../types/hrCoreApi";


export type CoreEmployeeFile = {
  id: string;
  employeeUid: string;
  employeeId?: string;
  direction?: "inbound" | "outbound";
  title: string;
  fileType?: string;
  documentType?: "identity" | "contract" | "certificate" | "other";
  fileName?: string;
  mimeType?: string;
  storageKey?: string;
  sizeBytes?: number | null;
  notes?: string;
  status?: "active" | "replaced" | "read" | "archived";
  createdByUid?: string;
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
  readBy?: string[];
};

export const CORE_EMPLOYEE_FILE_OUTBOUND_CATEGORY = "employee_internal_outbound";
export const CORE_EMPLOYEE_FILE_INBOUND_CATEGORY = "employee_internal_inbound";

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function isEmployeeInternalCategory(value: unknown) {
  const category = cleanText(value);
  return category === CORE_EMPLOYEE_FILE_OUTBOUND_CATEGORY || category === CORE_EMPLOYEE_FILE_INBOUND_CATEGORY;
}

function mapCoreEmployeeFile(metadata: CoreFileMetadata): CoreEmployeeFile {
  const direction = metadata.category === CORE_EMPLOYEE_FILE_INBOUND_CATEGORY ? "inbound" : "outbound";
  const employeeId = cleanText(metadata.employeeId);
  const status = cleanText(metadata.status || "active") as CoreEmployeeFile["status"];
  return {
    id: metadata.id,
    employeeUid: employeeId,
    employeeId,
    direction,
    title: cleanText(metadata.title) || metadata.fileName || "ملف داخلي",
    fileType: "general",
    documentType: cleanText(metadata.documentType) as CoreEmployeeFile["documentType"] || undefined,
    fileName: metadata.fileName,
    mimeType: cleanText(metadata.contentType) || undefined,
    storageKey: metadata.storageKey,
    sizeBytes: metadata.sizeBytes ?? null,
    notes: cleanText(metadata.description) || undefined,
    status,
    createdByUid: cleanText(metadata.uploadedByUid) || undefined,
    createdAt: metadata.createdAt,
    updatedAt: metadata.updatedAt,
    readBy: status === "read" && employeeId ? [employeeId] : [],
  };
}

export async function listCoreEmployeeFiles(
  limitCount = 240,
  employeeId = "",
  includeHistory = false,
): Promise<CoreEmployeeFile[]> {
  const targetEmployeeId = cleanText(employeeId);
  const rows = await CoreFilesService.list(targetEmployeeId ? { employeeId: targetEmployeeId } : {});

  return rows
    .filter((row) => isEmployeeInternalCategory(row.category))
    .map(mapCoreEmployeeFile)
    .filter((row) => includeHistory || (row.status !== "archived" && row.status !== "replaced"))
    .sort((a, b) => Date.parse(String(b.createdAt || "")) - Date.parse(String(a.createdAt || "")))
    .slice(0, Math.max(1, limitCount));
}

export async function listMyCoreEmployeeFiles(limitCount = 120): Promise<CoreEmployeeFile[]> {
  // The Core worker automatically scopes non-manager file listing to ctx.employeeId.
  const rows = await CoreFilesService.list();
  return rows
    .filter((row) => row.category === CORE_EMPLOYEE_FILE_OUTBOUND_CATEGORY)
    .map(mapCoreEmployeeFile)
    .filter((row) => row.status !== "archived" && row.status !== "replaced")
    .sort((a, b) => Date.parse(String(b.createdAt || "")) - Date.parse(String(a.createdAt || "")))
    .slice(0, Math.max(1, limitCount));
}

export async function createCoreEmployeeFile(input: {
  employeeId: string;
  direction?: CoreEmployeeFile["direction"];
  title: string;
  notes?: string;
  documentType?: CoreEmployeeFile["documentType"];
  status?: CoreEmployeeFile["status"];
  file: File;
  replacesFileId?: string;
}) {
  const employeeId = cleanText(input.employeeId);
  const title = cleanText(input.title);
  if (!employeeId) throw new Error("معرف الموظفة مطلوب.");
  if (!title) throw new Error("عنوان الملف مطلوب.");
  if (!input.file) throw new Error("اختر ملفًا أولًا.");

  const direction = input.direction === "inbound" ? "inbound" : "outbound";
  const requestedStatus = cleanText(input.status || "active").toLowerCase();
  const status = ["active", "archived", "replaced"].includes(requestedStatus)
    ? requestedStatus
    : "active";

  const metadata = await CoreFilesService.createMetadata({
    employeeId,
    category: direction === "inbound"
      ? CORE_EMPLOYEE_FILE_INBOUND_CATEGORY
      : CORE_EMPLOYEE_FILE_OUTBOUND_CATEGORY,
    title,
    documentType: cleanText(input.documentType) || null,
    description: cleanText(input.notes) || null,
    fileName: input.file.name || "attachment",
    contentType: input.file.type || "application/octet-stream",
    status,
    visibility: "private",
    ...(cleanText(input.replacesFileId) ? { replacesFileId: cleanText(input.replacesFileId) } : {}),
  });

  try {
    const uploaded = await CoreFilesService.upload(metadata.id, input.file);
    const replacementId = cleanText(input.replacesFileId);
    if (replacementId) {
      await CoreFilesService.updateMetadata(replacementId, {
        status: "replaced",
        replacedByFileId: uploaded.id,
      });
    }
    return mapCoreEmployeeFile(uploaded);
  } catch (error) {
    // Keep failed metadata out of the active internal-file view without hiding
    // the failed write from Core auditability.
    await CoreFilesService.updateMetadata(metadata.id, { status: "archived" }).catch(() => {});
    throw error;
  }
}

export async function markCoreEmployeeFileRead(fileId: string) {
  const id = cleanText(fileId);
  if (!id) return null;
  return mapCoreEmployeeFile(await CoreFilesService.updateMetadata(id, { status: "read" }));
}

export async function updateCoreEmployeeFileStatus(fileId: string, status: "active" | "archived" | "replaced") {
  const id = cleanText(fileId);
  if (!id) throw new Error("معرف الملف مطلوب.");
  return mapCoreEmployeeFile(await CoreFilesService.updateMetadata(id, { status }));
}

async function consumeFileBlob(fileId: string, fileName: string, download: boolean) {
  const blob = await CoreFilesService.download(fileId);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noreferrer";
  if (download) {
    anchor.download = cleanText(fileName) || "attachment";
  } else {
    anchor.target = "_blank";
  }
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function openCoreEmployeeFile(fileId: string, fileName: string) {
  await consumeFileBlob(fileId, fileName, false);
}

export async function downloadCoreEmployeeFile(fileId: string, fileName: string) {
  await consumeFileBlob(fileId, fileName, true);
}
