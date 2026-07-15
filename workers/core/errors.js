// CORE D1 ONLY — do not add Firestore fallback.

export class AppError extends Error {
  constructor(status, code, message = code, details) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function normalizeError(error) {
  if (error instanceof AppError) return error;
  if (Number.isInteger(error?.status) && typeof error?.code === "string") {
    return new AppError(error.status, error.code, error.message || error.code, error.details);
  }
  if (typeof error?.code === "string" && error.code.startsWith("core_")) {
    const status = error.code.includes("conflict") ? 409 : 400;
    return new AppError(status, error.code, error.message || error.code);
  }
  const message = error instanceof Error ? error.message : String(error || "");
  console.error("core-worker unhandled error", { message });
  return new AppError(500, "core_api:internal", "Internal core worker error");
}
