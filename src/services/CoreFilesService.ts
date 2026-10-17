// R2 ONLY — binary files must not be stored in D1 or Firestore.
import { auth } from "./firebase";
import { requireCoreWorkerUrl } from "../config/dataSourceFlags";
import { coreApiRequest, CoreApiError } from "./coreApiClient";
import type { CoreFileMetadata } from "../types/hrCoreApi";

function mapMetadata(row: Record<string, unknown>): CoreFileMetadata {
  const value = (name: string, snake: string) => row[name] ?? row[snake];
  return {
    id: String(row.id || ""),
    salonId: String(value("salonId", "salon_id") || "main"),
    employeeId: value("employeeId", "employee_id") as string | null | undefined,
    category: String(row.category || "general"),
    documentType: value("documentType", "document_type") as string | null | undefined,
    title: row.title as string | null | undefined,
    description: row.description as string | null | undefined,
    fileName: String(value("fileName", "file_name") || "file"),
    storageKey: String(value("storageKey", "storage_key") || ""),
    contentType: value("contentType", "content_type") as string | null | undefined,
    sizeBytes: value("sizeBytes", "size_bytes") as number | null | undefined,
    status: String(row.status || "active"),
    visibility: String(row.visibility || "private"),
    uploadedByUid: value("uploadedByUid", "uploaded_by_uid") as string | null | undefined,
    replacedByFileId: value("replacedByFileId", "replaced_by_file_id") as string | null | undefined,
    replacesFileId: value("replacesFileId", "replaces_file_id") as string | null | undefined,
    createdAt: String(value("createdAt", "created_at") || ""),
    updatedAt: String(value("updatedAt", "updated_at") || ""),
  };
}

async function authorizedBinary(path: string, init: RequestInit) {
  const user = auth.currentUser;
  if (!user) throw new CoreApiError(401, "core_auth:login_required", "يجب تسجيل الدخول.");
  const token = await user.getIdToken();
  const response = await fetch(`${requireCoreWorkerUrl()}${path}`, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new CoreApiError(response.status, String(payload.error || "files_r2:request_failed"), String(payload.message || "تعذر تنفيذ طلب الملف."));
  }
  return response;
}

export const CoreFilesService = {
  async list(query: { employeeId?: string; category?: string } = {}) {
    const rows = await coreApiRequest<Record<string, unknown>[]>("/api/core/files", { query });
    return rows.map(mapMetadata);
  },
  async get(fileId: string) {
    return mapMetadata(await coreApiRequest<Record<string, unknown>>(`/api/core/files/${encodeURIComponent(fileId)}`));
  },
  async createMetadata(input: Record<string, unknown>) {
    return mapMetadata(await coreApiRequest<Record<string, unknown>>("/api/core/files", { method: "POST", body: input }));
  },
  async updateMetadata(fileId: string, input: Record<string, unknown>) {
    return mapMetadata(await coreApiRequest<Record<string, unknown>>(`/api/core/files/${encodeURIComponent(fileId)}`, { method: "PATCH", body: input }));
  },
  async upload(fileId: string, file: Blob) {
    const response = await authorizedBinary(`/api/core/files/${encodeURIComponent(fileId)}/content`, { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
    const payload = await response.json();
    return mapMetadata(payload.data ?? payload);
  },
  async download(fileId: string) {
    const response = await authorizedBinary(`/api/core/files/${encodeURIComponent(fileId)}/content`, { method: "GET" });
    return response.blob();
  },
};
