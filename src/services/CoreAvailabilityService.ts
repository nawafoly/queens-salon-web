import { coreApiRequest } from "./coreApiClient";
import type { CoreStaffAvailability } from "../types/coreApi";

const CACHE_TTL_MS = 12_000;
const cache = new Map<
  string,
  { expiresAt: number; value?: CoreStaffAvailability; pending?: Promise<CoreStaffAvailability> }
>();

function cacheKey(input: {
  staffId: string;
  date: string;
  slotStepMin?: number;
  bufferMin?: number;
}) {
  return [
    input.staffId,
    input.date,
    Number(input.slotStepMin || 10),
    Number(input.bufferMin || 0),
  ].join("|");
}

export const CoreAvailabilityService = {
  async getStaffDay(input: {
    staffId: string;
    date: string;
    slotStepMin?: number;
    bufferMin?: number;
    forceFresh?: boolean;
  }): Promise<CoreStaffAvailability> {
    const key = cacheKey(input);
    const now = Date.now();
    const existing = cache.get(key);
    if (!input.forceFresh && existing) {
      if (existing.value && existing.expiresAt > now) return existing.value;
      if (existing.pending) return existing.pending;
    }

    const pending = coreApiRequest<CoreStaffAvailability>(
      "/api/core/availability",
      {
        query: {
          staffId: input.staffId,
          date: input.date,
          slotStepMin: input.slotStepMin,
          bufferMin: input.bufferMin,
        },
      }
    );
    cache.set(key, { expiresAt: now + CACHE_TTL_MS, pending });
    try {
      const value = await pending;
      cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
      return value;
    } catch (error) {
      cache.delete(key);
      throw error;
    }
  },

  invalidate(staffId?: string, date?: string) {
    if (!staffId && !date) {
      cache.clear();
      return;
    }
    for (const key of cache.keys()) {
      const [keyStaffId, keyDate] = key.split("|");
      if ((!staffId || keyStaffId === staffId) && (!date || keyDate === date)) {
        cache.delete(key);
      }
    }
  },
};
