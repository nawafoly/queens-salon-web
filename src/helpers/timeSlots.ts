export function safeTimeHHMM(v: any, fallback: string) {
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

export function minutesToTime24(totalMin: number) {
  const normalized = ((Math.floor(Number(totalMin) || 0) % 1440) + 1440) % 1440;
  const hh = String(Math.floor(normalized / 60)).padStart(2, "0");
  const mm = String(normalized % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Expand one booking interval into the slot-start keys it occupies.
 *
 * This is pure time arithmetic. It deliberately does not read salon hours or
 * employee schedule data, so local cart-overlap checks cannot be truncated by
 * an unrelated business-hour grid. Schedule authority remains Core HR.
 */
export function expandBookingOccupiedTimes(
  startTimeHHMM: string,
  durationMin: number,
  bufferMin: number,
  slotStepMin: number
): string[] {
  const start = safeTimeHHMM(startTimeHHMM, "");
  if (!start) return [];
  const step = Math.max(1, Number(slotStepMin || 1));
  const need = Math.max(0, Number(durationMin || 0)) + Math.max(0, Number(bufferMin || 0));
  if (!need) return [];
  const count = Math.max(1, Math.ceil(need / step));
  const startMin = toMinutes(start);
  return Array.from({ length: count }, (_, index) => minutesToTime24(startMin + index * step));
}

function toArabic12hLabel(totalMin: number) {
  const norm = ((Math.floor(totalMin) % 1440) + 1440) % 1440;
  const h24 = Math.floor(norm / 60);
  const m = norm % 60;

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

  if (startMin === endMin) {
    return [
      {
        value24: open,
        label12: toArabic12hLabel(startMin),
        minutes: startMin,
      },
    ];
  }

  const slots: TimeSlot[] = [];
  const isOvernight = startMin > endMin;
  const endCursor = isOvernight ? endMin + 1440 : endMin;

  for (let t = startMin; t < endCursor; t += step) {
    const normalized = ((Math.floor(t) % 1440) + 1440) % 1440;
    const hh = String(Math.floor(normalized / 60)).padStart(2, "0");
    const mm = String(normalized % 60).padStart(2, "0");
    slots.push({
      value24: `${hh}:${mm}`,
      label12: toArabic12hLabel(normalized),
      minutes: normalized,
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
  if (!Array.isArray(slots) || slots.length === 0) return [];

  const closeMin = toMinutes(closeTimeHHMM);
  const maxEndMin = closeMin + Math.max(0, Number(allowOvertimeMin || 0));
  const need = Math.max(0, Number(durationMin || 0)) + Math.max(0, Number(bufferMin || 0));

  if (!need) return slots;

  // If slot list wraps around midnight (e.g. 20:00 -> 02:00), compare on a shifted timeline.
  const hasBeforeClose = slots.some((s) => Number(s.minutes) < closeMin);
  const hasAfterClose = slots.some((s) => Number(s.minutes) > closeMin);
  const isOvernight = hasBeforeClose && hasAfterClose;

  if (isOvernight) {
    const closeNorm = closeMin + 1440;
    const maxEndNorm = closeNorm + Math.max(0, Number(allowOvertimeMin || 0));
    return slots.filter((slot) => {
      const raw = Number(slot.minutes);
      if (!Number.isFinite(raw)) return false;
      const startNorm = raw < closeMin ? raw + 1440 : raw;
      if (startNorm >= closeNorm) return false;
      return startNorm + need <= maxEndNorm;
    });
  }

  return slots.filter((slot) => {
    const startMin = Number(slot.minutes);
    if (!Number.isFinite(startMin)) return false;
    if (startMin >= closeMin) return false;
    return startMin + need <= maxEndMin;
  });
}