import { HttpsError } from "firebase-functions/v2/https";

export const PACKAGE_INPUT_LIMITS = {
  documentId: 128,
  externalId: 256,
  reason: 500,
  packageName: 200,
  packageDescription: 2_000,
  sessions: 1_000,
  price: 1_000_000,
  validityDays: 3_650,
  allowedServices: 100,
  serviceDurationMinutes: 12 * 60,
  adjustmentSessions: 1_000,
  cancellationWindowMinutes: 7 * 24 * 60,
} as const;

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new HttpsError("invalid-argument", `${field} must be a string`);
  }
  return value.trim();
}

export function requiredDocumentId(value: unknown, field: string): string {
  const normalized = stringValue(value, field);
  if (
    !normalized ||
    normalized.length > PACKAGE_INPUT_LIMITS.documentId ||
    normalized.includes("/") ||
    normalized === "." ||
    normalized === ".."
  ) {
    throw new HttpsError("invalid-argument", `${field} must be a valid document id`);
  }
  return normalized;
}

export function optionalDocumentId(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredDocumentId(value, field);
}

export function requiredExternalId(value: unknown, field: string): string {
  const normalized = stringValue(value, field);
  if (!normalized || normalized.length > PACKAGE_INPUT_LIMITS.externalId) {
    throw new HttpsError("invalid-argument", `${field} is invalid`);
  }
  return normalized;
}

export function optionalBoundedText(
  value: unknown,
  field: string,
  maxLength = PACKAGE_INPUT_LIMITS.reason
): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const normalized = stringValue(value, field);
  if (!normalized) return undefined;
  if (normalized.length > maxLength) {
    throw new HttpsError("invalid-argument", `${field} is too long`);
  }
  return normalized;
}

export function requiredReason(value: unknown): string {
  const reason = optionalBoundedText(value, "reason", PACKAGE_INPUT_LIMITS.reason);
  if (!reason) throw new HttpsError("invalid-argument", "reason is required");
  return reason;
}

export function boundedInteger(
  value: unknown,
  field: string,
  options: { min: number; max: number; allowZero?: boolean }
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new HttpsError("invalid-argument", `${field} must be a finite integer`);
  }
  if (value < options.min || value > options.max || (!options.allowZero && value === 0)) {
    throw new HttpsError("invalid-argument", `${field} is outside the allowed range`);
  }
  return value;
}

export function safeStoredDocumentIds(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => requiredDocumentId(item, field)))];
}
