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

export type TimeSlot = {
  value24: string; // HH:MM for storage and booking_slots key
  label12: string; // display only
  minutes: number; // calculations only
};

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

export function slotLabelToMinutes(label: string): number | null {
  const s = String(label || "").trim();

  const hhmm = s.match(/^(\d{1,2}):(\d{2})$/);
  if (hhmm) {
    const hh = Number(hhmm[1]);
    const mm = Number(hhmm[2]);
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    return hh * 60 + mm;
  }

  const m = s.match(/^(\d{1,2}):(\d{2})\s*(ص|م)$/);
  if (!m) return null;

  let hh = Number(m[1]);
  const mm = Number(m[2]);
  const ap = m[3];

  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 1 || hh > 12) return null;
  if (mm < 0 || mm > 59) return null;

  if (ap === "ص") {
    if (hh === 12) hh = 0;
  } else if (hh !== 12) {
    hh = hh + 12;
  }

  return hh * 60 + mm;
}

export function generateSalonTimeSlots(
  openTime?: string,
  closeTime?: string,
  stepMinutes?: number
): TimeSlot[] {
  const open = safeTimeHHMM(openTime, "09:00");
  const close = safeTimeHHMM(closeTime, "22:00");
  const step = Math.max(1, Number(stepMinutes || 5));

  const startMin = toMinutes(open);
  const endMin = toMinutes(close);

  if (startMin >= endMin) {
    return [
      {
        value24: open,
        label12: toArabic12hLabel(startMin),
        minutes: startMin,
      },
    ];
  }

  const slots: TimeSlot[] = [];
  for (let t = startMin; t < endMin; t += step) {
    const hh = String(Math.floor(t / 60)).padStart(2, "0");
    const mm = String(t % 60).padStart(2, "0");
    slots.push({
      value24: `${hh}:${mm}`,
      label12: toArabic12hLabel(t),
      minutes: t,
    });
  }

  return slots;
}

export function filterSlotsByServiceEnd(
  slots: TimeSlot[],
  closeTimeHHMM: string,
  durationMin: number,
  bufferMin: number,
  allowOvertimeMin: number
): TimeSlot[] {
  const closeMin = toMinutes(closeTimeHHMM);
  const maxEndMin = closeMin + Math.max(0, Number(allowOvertimeMin || 0));
  const need = Math.max(0, Number(durationMin || 0)) + Math.max(0, Number(bufferMin || 0));

  if (!need) return slots;

  return slots.filter((slot) => {
    const startMin = Number(slot.minutes);
    if (!Number.isFinite(startMin)) return false;
    if (startMin >= closeMin) return false;
    return startMin + need <= maxEndMin;
  });
}
