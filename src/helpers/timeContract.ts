function toAsciiDigits(input: string) {
  return input
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776));
}

function formatHHMM(hours24: number, minutes: number) {
  return `${String(hours24).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function parse24h(value: string): string | null {
  const m = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;

  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;

  return formatHHMM(hh, mm);
}

function parse12h(value: string): string | null {
  const m = value.match(/^(\d{1,2}):(\d{2})\s*(am|pm|a\.m\.|p\.m\.|ص|م)$/i);
  if (!m) return null;

  let hh = Number(m[1]);
  const mm = Number(m[2]);
  const meridiem = m[3].toLowerCase().replace(/\./g, "");

  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 1 || hh > 12 || mm < 0 || mm > 59) return null;

  const isAM = meridiem === "am" || meridiem === "ص";
  if (isAM) {
    if (hh === 12) hh = 0;
  } else if (hh !== 12) {
    hh += 12;
  }

  return formatHHMM(hh, mm);
}

export function normalizeTimeToHHMM(value: any): string {
  const raw = toAsciiDigits(String(value ?? "").trim()).replace(/\s+/g, " ");
  if (!raw) return "";

  return parse24h(raw) || parse12h(raw) || "";
}

export function timeToMinutes(value: any): number | null {
  const hhmm = normalizeTimeToHHMM(value);
  if (!hhmm) return null;

  const [h, m] = hhmm.split(":").map((x) => Number(x));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}
