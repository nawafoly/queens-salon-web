import {
  HOME_SERVICE_SECTION_KEYWORDS,
  MANI_PEDI_SECTION_KEYWORDS,
} from "./bookingSharedConstants";
import {
  pickPriceLookupIcon as pickPriceLookupIconShared,
  type PriceLookupIcon,
} from "./serviceIcons";

const ARABIC_DIGIT_MAP: Record<string, string> = {
  "٠": "0",
  "١": "1",
  "٢": "2",
  "٣": "3",
  "٤": "4",
  "٥": "5",
  "٦": "6",
  "٧": "7",
  "٨": "8",
  "٩": "9",
  "۰": "0",
  "۱": "1",
  "۲": "2",
  "۳": "3",
  "۴": "4",
  "۵": "5",
  "۶": "6",
  "۷": "7",
  "۸": "8",
  "۹": "9",
};

export function normalizeDigits(raw: string) {
  return String(raw || "").replace(/[٠-٩۰-۹]/g, (d) => ARABIC_DIGIT_MAP[d] || d);
}

export function normalizeSearchText(raw: string) {
  const text = normalizeDigits(String(raw || "").trim().toLowerCase())
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ؤئ]/g, "ء");

  return text
    .replace(/[^a-z0-9\u0600-\u06ff\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isManiPediSectionByInfo(sectionId: string, sectionTitle?: string) {
  const hay = normalizeSearchText(`${sectionId || ""} ${sectionTitle || ""}`);
  if (!hay) return false;
  return MANI_PEDI_SECTION_KEYWORDS.some((k) => hay.includes(normalizeSearchText(k)));
}

export function isHomeServiceSectionByInfo(sectionId: string, sectionTitle?: string) {
  const hay = normalizeSearchText(`${sectionId || ""} ${sectionTitle || ""}`);
  if (!hay) return false;
  return HOME_SERVICE_SECTION_KEYWORDS.some((k) => hay.includes(normalizeSearchText(k)));
}

export function toArabicCatalogLabel(raw: string) {
  const original = String(raw || "").trim();
  if (!original) return "";
  if (/[\u0600-\u06FF]/.test(original)) return original;

  const normalized = normalizeSearchText(original).replace(/[_-]+/g, " ");
  const aliases: Array<{ re: RegExp; ar: string }> = [
    { re: /\bhair\b|blow\s*dry|color|styling|treatment/, ar: "الشعر" },
    { re: /\bnail|manicure|pedicure\b/, ar: "الأظافر" },
    { re: /\bmakeup|bridal\b/, ar: "المكياج" },
    { re: /\bskin|facial\b/, ar: "العناية بالبشرة" },
    { re: /\bbody|spa|massage\b/, ar: "العناية بالجسم" },
    { re: /\bwax|thread|laser|hair\s*removal\b/, ar: "إزالة الشعر" },
    { re: /\beyelash|brow|eyebrow|lash\b/, ar: "الرموش والحواجب" },
    { re: /\bpackage|packages|bundle\b/, ar: "البكيجات" },
    { re: /\boffers?|discounts?\b/, ar: "العروض" },
  ];

  for (const a of aliases) {
    if (a.re.test(normalized)) return a.ar;
  }

  return original;
}

export function pickPriceLookupIcon(serviceName: string): PriceLookupIcon {
  return pickPriceLookupIconShared(serviceName, normalizeSearchText);
}

function normalizeKsaPhone(raw: string) {
  const digits = normalizeDigits(String(raw || "")).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("9665") && digits.length === 12) return "0" + digits.slice(3);
  if (digits.startsWith("5") && digits.length === 9) return "0" + digits;
  if (digits.startsWith("05") && digits.length === 10) return digits;
  return digits;
}

export function phone10Digits(raw: string) {
  return normalizeKsaPhone(raw).replace(/\D/g, "").slice(0, 10);
}
