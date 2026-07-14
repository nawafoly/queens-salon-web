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
  const message = error instanceof Error ? error.message : String(error || "");
  console.error("packages-worker unhandled error", { message });
  return new AppError(500, "packages_api:internal", "Internal package worker error");
}
