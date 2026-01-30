// ✅ src/helpers/timeSlots.ts

function safeTimeHHMM(v: any, fallback: string) {
  const s = String(v || "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;

  const hh = Number(m[1]);
  const mm = Number(m[2]);

  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return fallback;
  if (hh < 0 || hh > 23) return fallback;
  if (mm < 0 || mm > 59) return fallback;

  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(":").map((x) => Number(x));
  return (Number(h) || 0) * 60 + (Number(m) || 0);
}

function toArabic12hLabel(totalMin: number) {
  const h24 = Math.floor(totalMin / 60);
  const m = totalMin % 60;

  const isPM = h24 >= 12;
  const hour12 = h24 === 12 ? 12 : h24 % 12 || 12;
  const suffix = isPM ? "م" : "ص";

  const hh = hour12 < 10 ? `0${hour12}` : `${hour12}`;
  const mm = m < 10 ? `0${m}` : `${m}`;

  return `${hh}:${mm} ${suffix}`;
}

// ✅ توليد الأوقات حسب إعدادات الصالون
export function generateSalonTimeSlots(openTime?: string, closeTime?: string, stepMinutes?: number) {
  const open = safeTimeHHMM(openTime, "09:00");
  const close = safeTimeHHMM(closeTime, "22:00");

  const step = Math.max(1, Number(stepMinutes || 10));
  const startMin = toMinutes(open);
  const endMin = toMinutes(close);

  // حماية: إذا صار شيء غلط
  if (startMin >= endMin) return [toArabic12hLabel(startMin)];

  const slots: string[] = [];

  for (let t = startMin; t <= endMin; t += step) {
    if (t > endMin) break;
    slots.push(toArabic12hLabel(t));
  }

  return slots;
}
