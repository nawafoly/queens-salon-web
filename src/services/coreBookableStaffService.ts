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

export function isCoreAssignedStaffPubliclyVisible(
  staff: StaffPublicWithId | null | undefined
): boolean {
  return Boolean(
    staff &&
      staffIdOf(staff) &&
      String(staff.name || "").trim() &&
      staff.showOnBooking !== false
  );
}

/**
 * Return the active staff assigned to exactly one service by Core D1
 * staff_services. This is deliberately NOT a dated availability decision.
 */
export async function listCoreAssignedStaffForService(
  serviceId: string,
  options: { requireShowOnBooking?: boolean } = {}
): Promise<StaffPublicWithId[]> {
  const sid = String(serviceId || "").trim();
  if (!sid) return [];
  const rows = await resolveBookingDataSource().getActiveStaff(sid);
  return rows.filter((staff) =>
    options.requireShowOnBooking === false
      ? Boolean(staffIdOf(staff) && String(staff.name || "").trim())
      : isCoreAssignedStaffPubliclyVisible(staff)
  );
}

/**
 * Package/common-staff helper. Every returned employee must have an active
 * staff_services assignment for every service ID. No specialties fallback.
 */
export async function listCoreAssignedStaffForServices(
  serviceIds: string[],
  options: { requireShowOnBooking?: boolean } = {}
): Promise<StaffPublicWithId[]> {
  const ids = [...new Set(
    (Array.isArray(serviceIds) ? serviceIds : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )];
  if (!ids.length) return [];

  const perService = await Promise.all(
    ids.map((serviceId) => listCoreAssignedStaffForService(serviceId, options))
  );
  const first = perService[0] || [];
  if (perService.length === 1) return first;

  const allowed = new Set(first.map(staffIdOf).filter(Boolean));
  for (const rows of perService.slice(1)) {
    const idsForService = new Set(rows.map(staffIdOf).filter(Boolean));
    for (const id of [...allowed]) {
      if (!idsForService.has(id)) allowed.delete(id);
    }
  }
  return first.filter((staff) => allowed.has(staffIdOf(staff)));
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
  const staffRows = await listCoreAssignedStaffForService(serviceId, {
    requireShowOnBooking: query.requireShowOnBooking,
  });

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
