// src/services/firestoreAvailabilityDays.ts
// Aggregated availability index: one doc per employee per day.

import type { DocumentData } from "firebase/firestore";

export type AvailabilityDayEmployeeDoc = {
  date: string; // YYYY-MM-DD
  employeeId: string;
  employeeKey: string;
  bookedSlots: Record<string, true>;
  breakSlots?: Record<string, true>;
  // `complete=true` means this doc is trusted as the full source of truth for that employee/day.
  // During migration we may keep it false until backfilled from legacy `booking_slots`.
  complete?: boolean;
  updatedAt?: unknown;
};

export function normalizeBookedSlotsMap(raw: unknown): Record<string, true> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, true> = {};
  for (const [k, v] of Object.entries(raw as any)) {
    const key = String(k || "").trim();
    if (!key) continue;
    if (v === true) out[key] = true;
  }
  return out;
}

export function bookedSlotsToSet(raw: DocumentData | null | undefined): Set<string> {
  const booked = normalizeBookedSlotsMap((raw as any)?.bookedSlots);
  return new Set<string>(Object.keys(booked));
}

