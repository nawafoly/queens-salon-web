/**
 * Canonical display locale policy.
 *
 * UI language remains Arabic/Saudi, while every user-visible number uses
 * Latin digits 0-9 and Western separators.
 */
export const DISPLAY_LOCALE = "ar-SA-u-nu-latn";
export const DISPLAY_NUMBERING_SYSTEM = "latn";

export function normalizeWesternDigits(value: string | number | null | undefined) {
  return String(value ?? "")
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)));
}
