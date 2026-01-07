// src/helpers/labels.ts

export const SPECIALTY_LABELS: Record<string, string> = {
    hair: "الشعر",
    makeup: "المكياج",
    nails: "الأظافر",
    waxing: "إزالة الشعر",
    skincare: "العناية بالبشرة",
};

export function toArabicSpecialty(key: string) {
    return SPECIALTY_LABELS[key] ?? key; // لو ما لقاه يرجع نفس القيمة
}

export function toArabicSpecialties(value: string | string[]) {
    const arr = Array.isArray(value)
        ? value
        : String(value || "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);

    return arr.map(toArabicSpecialty);
}
