import { normalizeTimeToHHMM } from "./timeContract";

export function formatTime12(value: any, fallback = ""): string {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;

  const hhmm = normalizeTimeToHHMM(raw);
  if (!hhmm) return raw;

  const [hh, mm] = hhmm.split(":");
  const h24 = Number(hh);
  if (!Number.isFinite(h24)) return raw;

  const h12 = h24 % 12 || 12;
  const suffix = h24 >= 12 ? "م" : "ص";
  return `${String(h12).padStart(2, "0")}:${mm} ${suffix}`;
}
