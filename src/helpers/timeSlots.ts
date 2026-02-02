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

export function toMinutes(hhmm: string) {
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

/**
 * ✅ NEW: تحويل "HH:MM ص/م" إلى دقائق (0..1439)
 * مثال: "04:15 م" -> 16*60+15
 */
export function slotLabelToMinutes(label: string): number | null {
  const s = String(label || "").trim();

  // ✅ التعديل: نقبل الوقت بوجود مسافة أو بدون مسافة قبل "ص/م"
  const m = s.match(/^(\d{1,2}):(\d{2})\s*(ص|م)$/);
  if (!m) return null;

  let hh = Number(m[1]);
  const mm = Number(m[2]);
  const ap = m[3]; // ص / م

  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 1 || hh > 12) return null;
  if (mm < 0 || mm > 59) return null;

  // تحويل 12h -> 24h
  // 12 ص = 00
  // 12 م = 12
  if (ap === "ص") {
    if (hh === 12) hh = 0;
  } else {
    if (hh !== 12) hh = hh + 12;
  }

  return hh * 60 + mm;
}

// ✅ توليد الأوقات حسب إعدادات الصالون
export function generateSalonTimeSlots(
  openTime?: string,
  closeTime?: string,
  stepMinutes?: number
) {
  const open = safeTimeHHMM(openTime, "09:00");
  const close = safeTimeHHMM(closeTime, "22:00");

  // ✅ الاتفاق: الافتراضي = 5
  const step = Math.max(1, Number(stepMinutes || 5));

  const startMin = toMinutes(open);
  const endMin = toMinutes(close);

  // حماية: إذا صار شيء غلط
  if (startMin >= endMin) return [toArabic12hLabel(startMin)];

  const slots: string[] = [];

  // ✅ مهم: لا نضيف slot عند نهاية الدوام نفسها
  // لأن النهاية "وقت إغلاق" وليست بداية حجز
  for (let t = startMin; t < endMin; t += step) {
    slots.push(toArabic12hLabel(t));
  }

  return slots;
}
