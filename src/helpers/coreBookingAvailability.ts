import type { CoreStaffAvailability } from "../types/coreApi";
import {
  filterSlotsByServiceEnd,
  generateSalonTimeSlots,
  type TimeSlot,
} from "./timeSlots";

export type CoreBookingScheduleWindow = {
  id: string;
  startTime: string;
  endTime: string;
};

export type CoreBookableStartsOptions = {
  durationMin: number;
  bufferMin: number;
  slotStepMin: number;
  excludeTaken?: boolean;
};

function cleanTime(value: unknown): string {
  const text = String(value || "").trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : "";
}

export function getCoreStaffScheduleWindows(
  availability: CoreStaffAvailability | null | undefined
): CoreBookingScheduleWindow[] {
  if (!availability) return [];
  return (Array.isArray(availability.scheduleWindows) ? availability.scheduleWindows : [])
    .map((window, index) => ({
      id: String(window?.id || `core-window-${index}`),
      startTime: cleanTime(window?.startTime),
      endTime: cleanTime(window?.endTime),
    }))
    .filter((window) => Boolean(window.startTime && window.endTime && window.startTime !== window.endTime));
}

export function isCoreStaffDayBookable(
  availability: CoreStaffAvailability | null | undefined
): boolean {
  return Boolean(
    availability?.active &&
      availability?.availableForDate &&
      getCoreStaffScheduleWindows(availability).length
  );
}

function occupiedCandidateSlots(
  windowSlots: TimeSlot[],
  startIndex: number,
  durationMin: number,
  bufferMin: number,
  slotStepMin: number
): TimeSlot[] {
  const need = Math.max(0, Number(durationMin || 0)) + Math.max(0, Number(bufferMin || 0));
  if (!need) return [];
  const count = Math.max(1, Math.ceil(need / Math.max(1, Number(slotStepMin || 1))));
  return windowSlots.slice(startIndex, startIndex + count);
}

/**
 * Returns employee start times from Core HR scheduleWindows only.
 *
 * Important invariants:
 * - salon/business-hour defaults never create or extend an employee window;
 * - start + service duration + buffer must stay inside the Core HR window;
 * - full-day leave/off/rest/no-schedule returns no starts because Core returns
 *   availableForDate=false and/or an empty scheduleWindows array;
 * - partial leave and existing bookings are represented by Core takenTimes and
 *   therefore block only the overlapping candidate interval.
 */
export function getCoreStaffBookableStartSlots(
  availability: CoreStaffAvailability | null | undefined,
  options: CoreBookableStartsOptions
): TimeSlot[] {
  if (!isCoreStaffDayBookable(availability)) return [];

  const slotStepMin = Math.max(1, Number(options.slotStepMin || 1));
  const durationMin = Math.max(0, Number(options.durationMin || 0));
  const bufferMin = Math.max(0, Number(options.bufferMin || 0));
  const excludeTaken = options.excludeTaken !== false;
  const taken = new Set(
    excludeTaken && Array.isArray(availability?.takenTimes)
      ? availability.takenTimes.map((value) => String(value || "").trim()).filter(Boolean)
      : []
  );

  const output: TimeSlot[] = [];
  const seen = new Set<string>();

  for (const window of getCoreStaffScheduleWindows(availability)) {
    const windowSlots = generateSalonTimeSlots(window.startTime, window.endTime, slotStepMin);
    const validStarts = filterSlotsByServiceEnd(
      windowSlots,
      window.endTime,
      durationMin,
      bufferMin,
      0
    );
    const validValues = new Set(validStarts.map((slot) => slot.value24));

    for (let index = 0; index < windowSlots.length; index += 1) {
      const slot = windowSlots[index];
      if (!validValues.has(slot.value24) || seen.has(slot.value24)) continue;

      if (excludeTaken) {
        const occupied = occupiedCandidateSlots(
          windowSlots,
          index,
          durationMin,
          bufferMin,
          slotStepMin
        );
        if (occupied.some((candidate) => taken.has(candidate.value24))) continue;
      }

      seen.add(slot.value24);
      output.push(slot);
    }
  }

  return output;
}

export function isCoreStaffStartBookable(
  availability: CoreStaffAvailability | null | undefined,
  startTime: string,
  options: CoreBookableStartsOptions
): boolean {
  const target = cleanTime(startTime);
  if (!target) return false;
  return getCoreStaffBookableStartSlots(availability, options).some(
    (slot) => slot.value24 === target
  );
}

export function getCoreStaffLastBookableStart(
  availability: CoreStaffAvailability | null | undefined,
  options: CoreBookableStartsOptions
): string {
  const slots = getCoreStaffBookableStartSlots(availability, options);
  return slots.length ? slots[slots.length - 1].value24 : "";
}
