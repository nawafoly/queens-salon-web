// src/services/firestoreStaffPublic.ts
import { db } from "./firebase";
import { collection, getDocs } from "firebase/firestore";

export type StaffPublicDoc = {
  name: string;
  specialties: string[];
  active?: boolean;
  employmentEndDate?: string;
  linkedUid?: string;
  showOnBooking?: boolean;
  onLeave?: boolean;
  leaveUntil?: string;
  leaveNote?: string;
  exceptionalLeaveDates?: string[];
  exceptionalLeaveWeekdays?: string[];
  useCustomWorkingHours?: boolean;
  customWorkingHours?: Partial<
    Record<
      "sat" | "sun" | "mon" | "tue" | "wed" | "thu" | "fri",
      { enabled?: boolean; start?: string; end?: string }
    >
  >;
  customWorkingHourOverrides?: Array<{
    date?: string;
    enabled?: boolean;
    start?: string;
    end?: string;
  }>;
};

export type StaffPublicWithId = StaffPublicDoc & { id: string };

function norm(v: any) {
  return String(v ?? "").trim().toLowerCase();
}

function normalizeArray(v: any): string[] {
  if (Array.isArray(v)) {
    return v
      .map((x) => {
        if (x && typeof x === "object") {
          const obj = x as any;
          return String(obj.serviceId || obj.id || obj.name || obj.value || "").trim();
        }
        return String(x || "").trim();
      })
      .filter(Boolean);
  }
  if (typeof v === "string" && v.trim()) {
    const s = v.trim();
    // Handle CSV-like payloads stored as a single string.
    if (/[,\u060C;|]/.test(s)) {
      return s
        .split(/[,\u060C;|]/g)
        .map((x) => String(x || "").trim())
        .filter(Boolean);
    }
    // Handle serialized JSON array payloads.
    if (s.startsWith("[") && s.endsWith("]")) {
      try {
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) {
          return parsed.map((x) => String(x || "").trim()).filter(Boolean);
        }
      } catch {
        // ignore and return raw string fallback
      }
    }
    return [s];
  }
  return [];
}

function extractSpecialties(raw: any): string[] {
  const data = raw && typeof raw === "object" ? raw : {};
  const direct = normalizeArray(data?.specialties);
  const serviceIds = normalizeArray(data?.serviceIds);
  const servicesIds = normalizeArray(data?.servicesIds);
  const providedServices = normalizeArray(data?.providedServices);
  const nestedServiceIds = Array.isArray(data?.services)
    ? data.services
        .map((x: any) => String(x?.serviceId || x?.id || x?.name || "").trim())
        .filter(Boolean)
    : [];
  return Array.from(
    new Set([
      ...direct,
      ...serviceIds,
      ...servicesIds,
      ...providedServices,
      ...nestedServiceIds,
    ])
  );
}

function normalizeIsoDates(v: any): string[] {
  const rows = Array.isArray(v) ? v : [];
  return rows
    .map((x) => String(x || "").trim())
    .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));
}

function todayISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function resolveEmploymentEndDate(raw: any): string {
  const candidates = [
    raw?.employmentEndDate,
    raw?.lastWorkingDate,
    raw?.resignationDate,
  ];
  for (const c of candidates) {
    const s = String(c || "").trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  }
  return "";
}

function normalizeWeekdays(v: any): string[] {
  const rows = Array.isArray(v) ? v : [];
  const allowed = new Set(["sat", "sun", "mon", "tue", "wed", "thu", "fri"]);
  return Array.from(
    new Set(
      rows
        .map((x) => String(x || "").trim().toLowerCase())
        .filter((x) => allowed.has(x))
    )
  );
}

function normalizeTimeHHMM(v: any): string {
  const s = String(v || "").trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "";
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return "";
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return "";
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function normalizeWorkingHours(v: any) {
  const out: Record<string, { enabled: boolean; start: string; end: string }> = {};
  const src = v && typeof v === "object" ? v : {};
  const keys = ["sat", "sun", "mon", "tue", "wed", "thu", "fri"];
  keys.forEach((k) => {
    const row = (src as any)?.[k];
    if (!row || typeof row !== "object") return;
    out[k] = {
      enabled: row.enabled !== false,
      start: normalizeTimeHHMM(row.start) || "10:00",
      end: normalizeTimeHHMM(row.end) || "22:00",
    };
  });
  return out;
}

function normalizeWorkingHourOverrides(v: any) {
  const rows = Array.isArray(v) ? v : [];
  return rows
    .map((row: any) => ({
      date: String(row?.date || "").trim(),
      enabled: row?.enabled !== false,
      start: normalizeTimeHHMM(row?.start) || "10:00",
      end: normalizeTimeHHMM(row?.end) || "22:00",
    }))
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date));
}

export async function listActiveStaffAll(salonId: string): Promise<StaffPublicWithId[]> {
  const sid = String(salonId || "").trim();
  if (!sid) return [];

  try {
    const colRef = collection(db, "salons", sid, "staff_public");
    const snaps = await getDocs(colRef);

    const all = snaps.docs.map((d) => {
      const data = d.data() as any;
      return {
        id: d.id,
        name: String(data?.name ?? "").trim(),
        specialties: extractSpecialties(data),
        active: data?.active !== false,
        employmentEndDate: resolveEmploymentEndDate(data) || undefined,
        linkedUid: String(data?.linkedUid ?? "").trim() || undefined,
        showOnBooking: data?.showOnBooking !== false,
        onLeave: !!data?.onLeave,
        leaveUntil: String(data?.leaveUntil ?? "").trim(),
        leaveNote: String(data?.leaveNote ?? "").trim(),
        exceptionalLeaveDates: normalizeIsoDates(data?.exceptionalLeaveDates),
        exceptionalLeaveWeekdays: normalizeWeekdays(data?.exceptionalLeaveWeekdays),
        useCustomWorkingHours: !!data?.useCustomWorkingHours,
        customWorkingHours: normalizeWorkingHours(data?.customWorkingHours),
        customWorkingHourOverrides: normalizeWorkingHourOverrides(data?.customWorkingHourOverrides),
      } as StaffPublicWithId;
    });

    const today = todayISO();
    const activeOnly = all.filter((x) => {
      if (!x.active) return false;
      const endDate = String((x as any)?.employmentEndDate || "").trim();
      if (endDate && today > endDate) return false;
      return true;
    });
    console.log("[staff_public] listActiveStaffAll active =", activeOnly.length);
    return activeOnly;
  } catch (e: any) {
    console.error("[staff_public] listActiveStaffAll ERROR:", e?.code, e?.message, e);
    return [];
  }
}

export async function listActiveStaffBySpecialty(args: {
  salonId: string;
  specialty: string;
}): Promise<StaffPublicWithId[]> {
  const salonId = String(args?.salonId || "").trim();
  const wantedRaw = String(args?.specialty || "").trim();
  if (!salonId || !wantedRaw) return [];

  const wanted = norm(wantedRaw);

  try {
    const colRef = collection(db, "salons", salonId, "staff_public");
    const snaps = await getDocs(colRef);

    const all = snaps.docs.map((d) => {
      const data = d.data() as any;
      return {
        id: d.id,
        name: String(data?.name ?? "").trim(),
        specialties: extractSpecialties(data),
        active: data?.active !== false,
        employmentEndDate: resolveEmploymentEndDate(data) || undefined,
        linkedUid: String(data?.linkedUid ?? "").trim() || undefined,
        showOnBooking: data?.showOnBooking !== false,
        onLeave: !!data?.onLeave,
        leaveUntil: String(data?.leaveUntil ?? "").trim(),
        leaveNote: String(data?.leaveNote ?? "").trim(),
        exceptionalLeaveDates: normalizeIsoDates(data?.exceptionalLeaveDates),
        exceptionalLeaveWeekdays: normalizeWeekdays(data?.exceptionalLeaveWeekdays),
        useCustomWorkingHours: !!data?.useCustomWorkingHours,
        customWorkingHours: normalizeWorkingHours(data?.customWorkingHours),
        customWorkingHourOverrides: normalizeWorkingHourOverrides(data?.customWorkingHourOverrides),
      } as StaffPublicWithId;
    });

    const today = todayISO();
    const filtered = all.filter((staff) => {
      if (!staff.active) return false;
      const endDate = String((staff as any)?.employmentEndDate || "").trim();
      if (endDate && today > endDate) return false;
      const specs = normalizeArray(staff.specialties);
      return specs.some((sp) => norm(sp) === wanted);
    });

    console.log(
      "[staff_public] wanted =",
      wantedRaw,
      "active =",
      all.length,
      "matched =",
      filtered.length
    );

    return filtered;
  } catch (e: any) {
    console.error("[staff_public] listActiveStaffBySpecialty ERROR:", e?.code, e?.message, e);
    return [];
  }
}
