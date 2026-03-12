export function extractMinPrice(priceText: string): number {
  const cleaned = String(priceText || "").replace(/[^\d\-]/g, "");
  if (!cleaned) return 0;

  const parts = cleaned
    .split("-")
    .filter(Boolean)
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n));

  if (!parts.length) return 0;
  return Math.min(...parts);
}

export function extractMinPriceInternal(priceText: string): number {
  const cleaned = priceText.replace(/[^\d\-]/g, "");
  if (!cleaned) return 0;

  const parts = cleaned
    .split("-")
    .filter(Boolean)
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n));

  if (!parts.length) return 0;
  return Math.min(...parts);
}

export function readDisplayLabel(raw: any, fallback = ""): string {
  const obj = raw && typeof raw === "object" ? raw : {};
  const directKeys = [
    "nameAr",
    "titleAr",
    "labelAr",
    "displayNameAr",
    "الاسم",
    "العنوان",
    "name",
    "title",
    "displayName",
    "label",
    "categoryName",
    "category",
  ];
  for (const k of directKeys) {
    const v = String((obj as any)?.[k] ?? "").trim();
    if (v) return v;
  }
  const entries = Object.entries(obj as Record<string, any>);
  for (const [k, v] of entries) {
    const key = String(k || "").toLowerCase();
    if (/(name|title|اسم|عنوان)/i.test(key)) {
      const txt = String(v ?? "").trim();
      if (txt) return txt;
    }
  }
  const fb = String(fallback || "").trim();
  if (!fb) return "";
  // avoid showing internal slugs/ids like "advanced/catalog" to clients
  const looksLikeInternalId = /^[a-z0-9/_-]+$/i.test(fb) && /[/_-]/.test(fb);
  if (looksLikeInternalId) return "";
  return fb;
}

export function readDisplayLabelInternal(raw: any, fallback = ""): string {
  const obj = raw && typeof raw === "object" ? raw : {};
  const directKeys = ["name", "title", "category", "categoryName", "الاسم", "العنوان"];
  for (const k of directKeys) {
    const v = String((obj as any)?.[k] ?? "").trim();
    if (v) return v;
  }
  const entries = Object.entries(obj as Record<string, any>);
  for (const [k, v] of entries) {
    const key = String(k || "").toLowerCase();
    if (/(name|title|اسم|عنوان)/i.test(key)) {
      const txt = String(v ?? "").trim();
      if (txt) return txt;
    }
  }
  return String(fallback || "").trim();
}

export function formatTime12(time24: string) {
  const m = String(time24 || "").trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return String(time24 || "-");
  const h24 = Number(m[1]);
  const mm = m[2];
  const h12 = h24 % 12 || 12;
  return `${String(h12).padStart(2, "0")}:${mm} ${h24 >= 12 ? "م" : "ص"}`;
}

export function round2(v: number): number {
  return Math.round((Number(v) || 0) * 100) / 100;
}

export function toMillisSafeDashboard(v: any): number {
  if (!v) return 0;
  if (typeof v === "number") return v;
  if (typeof v?.toMillis === "function") return v.toMillis();
  if (typeof v?.seconds === "number") return v.seconds * 1000;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function toMillisSafeDashboardBookings(v: any) {
  if (!v) return 0;
  if (typeof v?.toMillis === "function") return Number(v.toMillis()) || 0;
  if (typeof v?.seconds === "number") {
    const sec = Number(v.seconds || 0);
    const ns = Number(v.nanoseconds || 0);
    return sec * 1000 + Math.floor(ns / 1_000_000);
  }
  if (typeof v === "number") return Number(v) || 0;
  const parsed = Date.parse(String(v));
  return Number.isFinite(parsed) ? parsed : 0;
}
