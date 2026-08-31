import { cleanText } from "./shared";

export function toMillis(value: unknown) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === "object") {
    const maybe = value as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
    if (typeof maybe.toMillis === "function") {
      const ms = maybe.toMillis();
      return Number.isFinite(ms) ? ms : 0;
    }
    if (typeof maybe.seconds === "number") {
      return maybe.seconds * 1000 + Math.floor((maybe.nanoseconds || 0) / 1_000_000);
    }
  }
  return 0;
}

export function formatNotificationTime(value: unknown) {
  const ms = toMillis(value);
  if (!ms) return "الآن";
  const diff = Date.now() - ms;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("ar", { numeric: "auto" });

  if (abs < 60_000) return "الآن";
  if (abs < 3_600_000) return rtf.format(-Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(-Math.round(diff / 3_600_000), "hour");
  if (abs < 7 * 86_400_000) return rtf.format(-Math.round(diff / 86_400_000), "day");

  return new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(ms));
}

export function notificationTypeLabel(type?: string) {
  const normalized = cleanText(type).toLowerCase();
  if (normalized === "message") return "رسالة";
  if (normalized === "file") return "ملف";
  if (normalized === "leave") return "إجازة";
  if (normalized === "payroll") return "رواتب";
  if (normalized === "employee_request") return "طلب موظفة";
  if (normalized === "system") return "تنبيه";
  return "تنبيه";
}

export function notificationTone(type?: string) {
  const normalized = cleanText(type).toLowerCase();
  if (normalized === "message") return "message";
  if (normalized === "file") return "file";
  if (normalized === "leave") return "leave";
  if (normalized === "payroll") return "payroll";
  if (normalized === "employee_request") return "system";
  return "system";
}
