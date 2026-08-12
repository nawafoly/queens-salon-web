import { getCoreStaffScheduleWindows } from "../helpers/coreBookingAvailability";
import type { CoreStaffAvailability } from "../types/coreApi";
import type { StaffPublicWithId } from "./firestoreStaffPublic";
import { resolveBookingDataSource } from "./bookingDataSource";

export type CoreBookableStaffRow = {
  staff: StaffPublicWithId;
  availability: CoreStaffAvailability;
};

export type CoreBookableStaffQuery = {
  serviceId: string;
  date: string;
  slotStepMin?: number;
  bufferMin?: number;
  requireShowOnBooking?: boolean;
  forceFresh?: boolean;
};

function staffIdOf(staff: StaffPublicWithId): string {
  return String(staff?.id || "").trim();
}

/**
 * Resolve the dated staff picker entirely from Core.
 *
 * Authority chain:
 * staff_services -> Core active staff -> getStaffAvailability ->
 * resolveStaffBookingDay -> resolveEmployeeShift / HR leave+absence tables.
 *
 * Full-day leave/off/rest/no-schedule never reaches the returned list. Partial
 * leave remains available for the day and is represented by takenTimes /
 * blockedRanges in the returned availability object.
 */
export async function listCoreBookableStaffForDate(
  query: CoreBookableStaffQuery
): Promise<CoreBookableStaffRow[]> {
  const dataSource = resolveBookingDataSource();
  const serviceId = String(query.serviceId || "").trim();
  const date = String(query.date || "").trim();
  if (!serviceId || !date) return [];

  // Passing serviceId is mandatory: Core D1 staff_services is the service-to-
  // staff authority. Do not replace this with specialties/profile matching.
  const staffRows = await dataSource.getActiveStaff(serviceId);

  const resolved = await Promise.all(
    staffRows.map(async (staff) => {
      const staffId = staffIdOf(staff);
      if (!staffId) return null;
      try {
        const availability = await dataSource.getStaffAvailability({
          staffId,
          date,
          slotStepMin: query.slotStepMin,
          bufferMin: query.bufferMin,
          forceFresh: query.forceFresh,
        });
        return { staff, availability } satisfies CoreBookableStaffRow;
      } catch (error) {
        console.error("[coreBookableStaff] Core availability failed", {
          serviceId,
          staffId,
          date,
          error,
        });
        // Fail closed: a staff member whose authoritative availability cannot
        // be resolved must not appear as bookable.
        return null;
      }
    })
  );

  return resolved.filter((row): row is CoreBookableStaffRow => {
    if (!row) return false;
    const { staff, availability } = row;
    if (!availability.active || !availability.availableForDate) return false;
    if (query.requireShowOnBooking !== false) {
      if (staff.showOnBooking === false || availability.showOnBooking === false) return false;
    }
    return getCoreStaffScheduleWindows(availability).length > 0;
  });
}

export function indexCoreAvailabilityByStaffId(
  rows: CoreBookableStaffRow[]
): Record<string, CoreStaffAvailability> {
  const out: Record<string, CoreStaffAvailability> = {};
  for (const row of rows) {
    const id = staffIdOf(row.staff);
    if (id) out[id] = row.availability;
  }
  return out;
}
