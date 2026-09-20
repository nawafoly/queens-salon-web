import type { CustomerSource } from "./customerTypes";
import { clientsText, type DashboardLanguage } from "../../helpers/dashboardClientsLanguage";

export const UNNAMED_CUSTOMER_LABEL = "عميلة بدون اسم";
export const EMPTY_VALUE_LABEL = "—";

/* CUSTOMER_TEXT_ENCODING_POLICY_V1
 * Repairs high-confidence legacy Arabic text that was UTF-8 bytes decoded as
 * Windows-1256. Normal Arabic is returned unchanged.
 */
let customerCp1256Reverse: Map<string, number> | null = null;

function getCustomerCp1256Reverse(): Map<string, number> {
  if (customerCp1256Reverse) return customerCp1256Reverse;

  const map = new Map<string, number>();
  const decoder = new TextDecoder("windows-1256");

  for (let byte = 0; byte <= 255; byte += 1) {
    const char = decoder.decode(Uint8Array.of(byte));
    if (char && char !== "\uFFFD" && !map.has(char)) {
      map.set(char, byte);
    }
  }

  customerCp1256Reverse = map;
  return map;
}

function customerMojibakeScore(value: string): number {
  const denseMarkers = (value.match(/[طظ][^\s]/gu) || []).length;
  const artifacts = (
    value.match(/[€‚ƒ„…†‡ˆ‰‹Œ‘’“”•–—™›œ¢£¤¥¦§©«¬®°±²³µ¶»¼½¾]/gu) || []
  ).length;
  return denseMarkers + artifacts * 2;
}

function customerArabicLetterCount(value: string): number {
  return (value.match(/[\u0600-\u06FF]/gu) || []).length;
}

export function repairCustomerDisplayText(value: unknown): string {
  const raw = String(value ?? "");
  if (!raw || customerMojibakeScore(raw) < 2) return raw;

  const reverse = getCustomerCp1256Reverse();
  const bytes: number[] = [];

  for (const char of raw) {
    const codePoint = char.codePointAt(0);
    if (codePoint !== undefined && codePoint <= 0x7f) {
      bytes.push(codePoint);
      continue;
    }

    const byte = reverse.get(char);
    if (byte === undefined) return raw;
    bytes.push(byte);
  }

  try {
    const repaired = new TextDecoder("utf-8", { fatal: true }).decode(
      new Uint8Array(bytes)
    );

    if (
      repaired === raw ||
      customerArabicLetterCount(repaired) < 2 ||
      customerMojibakeScore(repaired) >= customerMojibakeScore(raw)
    ) {
      return raw;
    }

    return repaired;
  } catch {
    return raw;
  }
}

function cleanText(value: unknown): string {
  return repairCustomerDisplayText(value).trim();
}

function normalizedToken(value: string): string {
  return value
    .toLocaleLowerCase("ar")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه");
}

export function normalizeCustomerName(value: unknown): string {
  const raw = cleanText(value);
  if (!raw) return UNNAMED_CUSTOMER_LABEL;

  const withoutEmptyTokens = raw
    .replace(/\s*[-–—]\s*\(\s*\d+\s*\)\s*$/u, " ")
    .replace(/(^|\s)(?:undefined|null)(?=\s|$)/giu, " ")
    .replace(/(^|\s)[-–—_|]+(?=\s|$)/gu, " ")
    .replace(/^[\s–—_|،,;/-]+|[\s–—_|،,;/-]+$/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

  if (!withoutEmptyTokens || /^[\d\s()[\]#–—_-]+$/u.test(withoutEmptyTokens)) {
    return UNNAMED_CUSTOMER_LABEL;
  }

  const seen = new Set<string>();
  const uniqueWords = withoutEmptyTokens.split(" ").filter((word) => {
    const key = normalizedToken(word);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return uniqueWords.join(" ").trim() || UNNAMED_CUSTOMER_LABEL;
}

export function normalizeCustomerSearchText(value: unknown): string {
  return normalizedToken(cleanText(value).replace(/\s+/gu, " ").trim());
}

export function customerPhoneDigits(value: unknown): string {
  let digits = cleanText(value).replace(/\D/g, "");
  if (digits.startsWith("00966")) digits = `966${digits.slice(5)}`;
  if (digits.startsWith("9660")) digits = `966${digits.slice(4)}`;
  if (/^05\d{8}$/.test(digits)) return `966${digits.slice(1)}`;
  if (/^5\d{8}$/.test(digits)) return `966${digits}`;
  return digits;
}

export function normalizeSaudiCustomerPhone(value: unknown): string {
  let digits = cleanText(value).replace(/\D/g, "");
  if (digits.startsWith("00966")) digits = `966${digits.slice(5)}`;
  if (digits.startsWith("9660")) digits = `966${digits.slice(4)}`;
  if (/^9665\d{8}$/.test(digits)) return `0${digits.slice(3)}`;
  if (/^5\d{8}$/.test(digits)) return `0${digits}`;
  if (/^05\d{8}$/.test(digits)) return digits;
  return "";
}

export function formatCustomerPhone(value: unknown): string {
  const digits = customerPhoneDigits(value);
  if (!digits) return EMPTY_VALUE_LABEL;
  if (/^9665\d{8}$/.test(digits)) return `0${digits.slice(3)}`;
  return cleanText(value) || digits;
}

export function hasCustomerPhone(value: unknown): boolean {
  return customerPhoneDigits(value).length > 0;
}

export function getCustomerInitials(value: unknown): string {
  const name = normalizeCustomerName(value);
  if (name === UNNAMED_CUSTOMER_LABEL) return "ع";
  const words = name.split(" ").filter(Boolean);
  return `${words[0]?.slice(0, 1) || ""}${words.length > 1 ? words.at(-1)?.slice(0, 1) || "" : ""}`;
}

export function formatCustomerLastVisit(dateValue: unknown, timeValue?: unknown, language: DashboardLanguage = "ar"): string {
  const date = cleanText(dateValue);
  const time = cleanText(timeValue);
  if (!date) return clientsText(language, "لا توجد زيارة");

  const isoTime = /^\d{1,2}:\d{2}$/.test(time) ? `${time}:00` : "00:00:00";
  const parsed = new Date(`${date}T${isoTime}`);
  if (Number.isNaN(parsed.getTime())) return [date, time].filter(Boolean).join(" · ");

  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "ar-SA-u-ca-gregory-nu-latn", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(time ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(parsed);
}

export function formatCustomerCreatedAt(value: unknown, language: DashboardLanguage = "ar"): string {
  const raw = cleanText(value);
  if (!raw) return EMPTY_VALUE_LABEL;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return new Intl.DateTimeFormat(language === "en" ? "en-GB" : "ar-SA-u-ca-gregory-nu-latn", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

export function formatCustomerCount(value: number, fractionDigits = 0, language: DashboardLanguage = "ar"): string {
  return new Intl.NumberFormat(language === "en" ? "en-US" : "ar-SA-u-nu-latn", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(Number.isFinite(value) ? value : 0);
}

export function getCustomerStatusLabel(status: unknown, language: DashboardLanguage = "ar"): string {
  const value = cleanText(status).toLowerCase();
  if (!value || value === "active") return clientsText(language, "نشطة");
  if (["inactive", "disabled"].includes(value)) return clientsText(language, "غير نشطة");
  if (["blocked", "suspended"].includes(value)) return clientsText(language, "موقوفة");
  return cleanText(status) || clientsText(language, "غير محددة");
}

export function isCustomerActive(status: unknown): boolean {
  const value = cleanText(status).toLowerCase();
  return !value || value === "active";
}

export function getCustomerSourceLabel(source: CustomerSource, language: DashboardLanguage = "ar"): string {
  if (source === "combined") return clientsText(language, "ملف موحّد وحجوزات");
  if (source === "client-record") return clientsText(language, "ملف العميلة");
  return clientsText(language, "سجل الحجوزات");
}

export function getCustomerSourceDescription(source: CustomerSource, language: DashboardLanguage = "ar"): string {
  if (source === "combined") return clientsText(language, "بيانات العميلة موجودة في السجل الموحد ومرتبطة بحجوزات");
  if (source === "client-record") return clientsText(language, "ملف عميلة محفوظ في Core D1 ولا توجد له حجوزات حتى الآن");
  return clientsText(language, "العميلة ظاهرة من سجل الحجوزات ولم يرتبط بها ملف Core موحد بعد");
}

export function buildCustomerWhatsAppHref(nameValue: unknown, phoneValue: unknown): string {
  const digits = customerPhoneDigits(phoneValue);
  if (!digits) return "";
  const name = normalizeCustomerName(nameValue);
  const salutation = name === UNNAMED_CUSTOMER_LABEL ? "عميلتنا الكريمة" : name;
  const message = [
    `مرحبًا ${salutation}،`,
    "تأكيد الحجز يتم بعد تحويل المبلغ على البنك الأهلي السعودي برقم الآيبان التالي:",
    "SA4710000001400007036306",
    "بعد التحويل يسعدنا استلام إيصال التحويل عبر الواتساب لإكمال تأكيد الحجز.",
    "شاكرين لك ثقتك، ونسعد بخدمتك دائمًا.",
  ].join("\n");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export function customerLastVisitTimestamp(dateValue: unknown, timeValue?: unknown): number {
  const date = cleanText(dateValue);
  const time = cleanText(timeValue);
  if (!date) return 0;
  const parsed = Date.parse(`${date}T${/^\d{1,2}:\d{2}$/.test(time) ? `${time}:00` : "00:00:00"}`);
  return Number.isFinite(parsed) ? parsed : 0;
}
