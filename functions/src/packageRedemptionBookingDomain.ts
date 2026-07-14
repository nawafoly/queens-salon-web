import { createHash, randomUUID } from "node:crypto";
import { PackageDomainError } from "./packageSubscriptionDomain.js";

export type SlotSettings = {
  enabled: boolean;
  openTime: string;
  closeTime: string;
  slotStepMin: number;
  bufferMin: number;
};

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function validTime(value: unknown, fallback: string): string {
  const text = String(value || "").trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : fallback;
}

export function appointmentTimestampMs(dateISO: string, timeHHMM: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(timeHHMM)) {
    throw new PackageDomainError("INVALID_APPOINTMENT", "Appointment date and time are invalid");
  }
  const value = Date.parse(`${dateISO}T${timeHHMM}:00+03:00`);
  if (!Number.isFinite(value)) {
    throw new PackageDomainError("INVALID_APPOINTMENT", "Appointment date and time are invalid");
  }
  return value;
}

export function resolveSlotSettings(raw: Record<string, unknown>, dateISO: string): SlotSettings {
  const booking = (raw.booking && typeof raw.booking === "object" ? raw.booking : {}) as Record<string, any>;
  const date = new Date(`${dateISO}T12:00:00+03:00`);
  const weekday = WEEKDAYS[date.getUTCDay()] || "sat";
  const base = booking.businessHours?.[weekday] || {};
  let enabled = base.enabled !== false;
  let openTime = validTime(base.start, "10:00");
  let closeTime = validTime(base.end, "22:00");
  const overrides = Array.isArray(booking.bookingHourOverrides) ? booking.bookingHourOverrides : [];
  for (let index = overrides.length - 1; index >= 0; index -= 1) {
    const row = overrides[index] || {};
    const from = String(row.fromDate || "");
    const to = String(row.toDate || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) continue;
    if (dateISO < from || dateISO > to) continue;
    const included = Array.isArray(row.includeWeekdays) ? row.includeWeekdays : [];
    const blocked = Array.isArray(row.blockedWeekdays) ? row.blockedWeekdays : [];
    if (included.length && !included.includes(weekday)) continue;
    if (row.mode === "closed" || blocked.includes(weekday)) enabled = false;
    else {
      enabled = true;
      openTime = validTime(row.start, "10:00");
      closeTime = validTime(row.end, "22:00");
    }
    break;
  }
  const configuredStep = Number(booking.slotStepMin);
  const slotStepMin = [5, 10, 15, 30].includes(configuredStep) ? configuredStep : 10;
  const bufferMin = Math.max(0, Math.floor(Number(booking.bufferMin) || 0));
  return { enabled, openTime, closeTime, slotStepMin, bufferMin };
}

function minutes(value: string): number {
  const [hours, mins] = value.split(":").map(Number);
  return hours * 60 + mins;
}

function safeSegment(value: string): string {
  return String(value || "").trim().replace(/\//g, "-").replace(/\s+/g, "_");
}

export function buildBookingSlotId(salonId: string, date: string, time: string, employeeId: string) {
  return [salonId, date, time, employeeId].map(safeSegment).join("__");
}

export function buildLockedTimes(args: {
  settings: SlotSettings;
  startTime: string;
  durationMin: number;
}): string[] {
  if (!args.settings.enabled) throw new PackageDomainError("BOOKING_DAY_CLOSED", "Booking day is closed");
  const start = minutes(validTime(args.startTime, "invalid"));
  if (!Number.isFinite(start)) throw new PackageDomainError("INVALID_APPOINTMENT", "Start time is invalid");
  const open = minutes(args.settings.openTime);
  let close = minutes(args.settings.closeTime);
  if (close <= open) close += 24 * 60;
  const normalizedStart = start < open && close > 24 * 60 ? start + 24 * 60 : start;
  const total = Math.max(1, Math.floor(args.durationMin)) + args.settings.bufferMin;
  if (normalizedStart < open || normalizedStart + total > close + 15) {
    throw new PackageDomainError("BOOKING_TIME_OUT_OF_HOURS", "Appointment is outside business hours");
  }
  if ((normalizedStart - open) % args.settings.slotStepMin !== 0) {
    throw new PackageDomainError("INVALID_APPOINTMENT", "Appointment is not aligned to the slot interval");
  }
  const count = Math.max(1, Math.ceil(total / args.settings.slotStepMin));
  return Array.from({ length: count }, (_, index) => {
    const current = (normalizedStart + index * args.settings.slotStepMin) % (24 * 60);
    return `${String(Math.floor(current / 60)).padStart(2, "0")}:${String(current % 60).padStart(2, "0")}`;
  });
}

export function newStableClientId(): string {
  return randomUUID();
}

export function stableLegacyClientId(salonId: string, legacyDocId: string): string {
  const hex = createHash("sha256").update(`${salonId}:${legacyDocId}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
