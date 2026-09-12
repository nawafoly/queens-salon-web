import { CoreFilesService } from "./CoreFilesService";

export const EMPLOYEE_PROFILE_AVATAR_CATEGORY = "employee_profile_avatar";

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

export type CoreEmployeeProfilePhoto = {
  id: string;
  employeeId: string;
  fileName: string;
  contentType?: string | null;
  sizeBytes?: number | null;
  status: string;
  replacedByFileId?: string | null;
  replacesFileId?: string | null;
  createdAt: string;
  updatedAt: string;
};

function mapPhoto(row: Awaited<ReturnType<typeof CoreFilesService.get>>): CoreEmployeeProfilePhoto {
  return {
    id: cleanText(row.id),
    employeeId: cleanText(row.employeeId),
    fileName: cleanText(row.fileName),
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    status: cleanText(row.status || "active"),
    replacedByFileId: row.replacedByFileId,
    replacesFileId: row.replacesFileId,
    createdAt: cleanText(row.createdAt),
    updatedAt: cleanText(row.updatedAt),
  };
}

export async function listCoreEmployeeProfilePhotos(
  employeeId: string,
): Promise<CoreEmployeeProfilePhoto[]> {
  const targetEmployeeId = cleanText(employeeId);
  if (!targetEmployeeId) return [];

  const rows = await CoreFilesService.list({
    employeeId: targetEmployeeId,
    category: EMPLOYEE_PROFILE_AVATAR_CATEGORY,
  });

  return rows
    .map(mapPhoto)
    .sort(
      (a, b) =>
        Date.parse(b.createdAt || "") - Date.parse(a.createdAt || ""),
    );
}

export async function uploadCoreEmployeeProfilePhoto(input: {
  employeeId: string;
  file: File;
  replacesFileId?: string | null;
}): Promise<CoreEmployeeProfilePhoto> {
  const employeeId = cleanText(input.employeeId);
  if (!employeeId) {
    throw new Error("EMPLOYEE_PROFILE_PHOTO_EMPLOYEE_REQUIRED");
  }

  if (!input.file.type.toLowerCase().startsWith("image/")) {
    throw new Error("EMPLOYEE_PROFILE_PHOTO_IMAGE_REQUIRED");
  }

  const replacesFileId = cleanText(input.replacesFileId);

  const metadata = await CoreFilesService.createMetadata({
    employeeId,
    category: EMPLOYEE_PROFILE_AVATAR_CATEGORY,
    title: "Employee profile photo",
    fileName: input.file.name || "profile-photo",
    contentType: input.file.type || "application/octet-stream",
    visibility: "private",
    status: "active",
    ...(replacesFileId ? { replacesFileId } : {}),
  });

  try {
    const uploaded = await CoreFilesService.upload(metadata.id, input.file);
    return mapPhoto(uploaded);
  } catch (error) {
    await CoreFilesService.updateMetadata(metadata.id, {
      status: "archived",
    }).catch(() => {});
    throw error;
  }
}

export async function markCoreEmployeeProfilePhotoReplaced(
  previousFileId: string,
  replacementFileId: string,
): Promise<void> {
  const previousId = cleanText(previousFileId);
  const replacementId = cleanText(replacementFileId);

  if (!previousId || !replacementId || previousId === replacementId) return;

  await CoreFilesService.updateMetadata(previousId, {
    status: "replaced",
    replacedByFileId: replacementId,
  });
}

export async function archiveCoreEmployeeProfilePhoto(
  fileId: string,
): Promise<void> {
  const id = cleanText(fileId);
  if (!id) return;

  await CoreFilesService.updateMetadata(id, {
    status: "archived",
  });
}

export function coreEmployeeAvatarUrl(employeeId: string): string {
  const id = cleanText(employeeId);
  if (!id) return "";

  const base = String(
    import.meta.env.VITE_CORE_WORKER_URL || "",
  ).replace(/\/$/, "");

  if (!base) return "";

  return `${base}/api/core/public/employee-avatars/${encodeURIComponent(id)}`;
}
