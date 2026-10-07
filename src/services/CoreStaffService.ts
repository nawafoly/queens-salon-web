import { coreApiRequest } from "./coreApiClient";
import { mapCoreStaff } from "./coreBookingMappers";
import { normalizeEmployeeIdentityId } from "../helpers/employeeIdentityId";
import type { CoreStaff } from "../types/coreApi";

function mergeCanonicalStaffRows(rows: CoreStaff[]) {
  const byId = new Map<string, CoreStaff>();

  for (const row of rows) {
    const id = normalizeEmployeeIdentityId(row.id);
    if (!id) continue;
    const candidate = { ...row, id };
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, candidate);
      continue;
    }

    const specialties = Array.from(new Set([
      ...(existing.specialties || []),
      ...(candidate.specialties || []),
    ]));
    const schedulesById = new Map<string, any>();
    for (const schedule of [...(existing.schedules || []), ...(candidate.schedules || [])]) {
      const key = String((schedule as any)?.id || JSON.stringify(schedule));
      if (!schedulesById.has(key)) schedulesById.set(key, schedule);
    }

    byId.set(id, {
      ...existing,
      ...candidate,
      id,
      firebaseUid: candidate.firebaseUid || existing.firebaseUid,
      name: candidate.name || existing.name,
      phoneNormalized: candidate.phoneNormalized || existing.phoneNormalized,
      avatarUrl: candidate.avatarUrl || existing.avatarUrl,
      active: existing.active || candidate.active,
      showOnBooking: existing.showOnBooking || candidate.showOnBooking,
      specialties,
      schedules: Array.from(schedulesById.values()),
    });
  }

  return Array.from(byId.values());
}

export const CoreStaffService = {
  async list(
    query: { activeOnly?: boolean; serviceId?: string } = {}
  ): Promise<CoreStaff[]> {
    const rows = await coreApiRequest<Record<string, unknown>[]>(
      "/api/core/staff",
      {
        query: {
          active: query.activeOnly === false ? undefined : true,
          serviceId: query.serviceId,
        },
      }
    );
    return mergeCanonicalStaffRows(rows.map(mapCoreStaff));
  },

  async get(id: string): Promise<CoreStaff> {
    const employeeId = normalizeEmployeeIdentityId(id);
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/staff/${encodeURIComponent(employeeId)}`
    );
    return { ...mapCoreStaff(row), id: employeeId || normalizeEmployeeIdentityId(row.id) };
  },

  async update(
    id: string,
    input: Record<string, unknown>
  ): Promise<CoreStaff> {
    const employeeId = normalizeEmployeeIdentityId(id);
    const row = await coreApiRequest<Record<string, unknown>>(
      `/api/core/staff/${encodeURIComponent(employeeId)}`,
      { method: "PATCH", body: input }
    );
    return { ...mapCoreStaff(row), id: employeeId || normalizeEmployeeIdentityId(row.id) };
  },
};
