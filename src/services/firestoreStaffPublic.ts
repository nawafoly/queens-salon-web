// src/services/firestoreStaffPublic.ts
import { db } from "./firebase";
import { collection, getDocs } from "firebase/firestore";
import { isStaffOperationallyActiveForDate } from "../helpers/staffAvailability";
import { isRemovedFromStaffRecord } from "./staffAccountLinkService";

export type StaffPublicDoc = {
  name: string;
  specialties: string[];
  active?: boolean;
  avatarUrl?: string;
  avatarURL?: string;
  photoURL?: string;
  photoUrl?: string;
  imageUrl?: string;
  imageURL?: string;
  profileImageUrl?: string;
  profileImage?: string;
  picture?: string;
  avatar?: string;
  rating?: number;
  reviewsCount?: number;
  reviewCount?: number;
  ratingsCount?: number;
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
      {
        enabled?: boolean;
        start?: string;
        end?: string;
        shifts?: Array<{ enabled?: boolean; start?: string; end?: string }>;
        windows?: Array<{ enabled?: boolean; start?: string; end?: string }>;
        periods?: Array<{ enabled?: boolean; start?: string; end?: string }>;
      }
    >
  >;
  customWorkingHourOverrides?: Array<{
    date?: string;
    enabled?: boolean;
    start?: string;
    end?: string;
    shifts?: Array<{ enabled?: boolean; start?: string; end?: string }>;
    windows?: Array<{ enabled?: boolean; start?: string; end?: string }>;
    periods?: Array<{ enabled?: boolean; start?: string; end?: string }>;
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

function normalizeSplitWindows(v: any) {
  const rows = Array.isArray(v) ? v : [];
  return rows
    .map((row: any) => ({
      enabled: row?.enabled !== false,
      start: normalizeTimeHHMM(row?.start) || "10:00",
      end: normalizeTimeHHMM(row?.end) || "22:00",
    }))
    .filter((row) => row.start !== row.end);
}

function normalizeWorkingHours(v: any) {
  const out: Record<
    string,
    {
      enabled: boolean;
      start: string;
      end: string;
      shifts?: Array<{ enabled: boolean; start: string; end: string }>;
      windows?: Array<{ enabled: boolean; start: string; end: string }>;
      periods?: Array<{ enabled: boolean; start: string; end: string }>;
    }
  > = {};
  const src = v && typeof v === "object" ? v : {};
  const keys = ["sat", "sun", "mon", "tue", "wed", "thu", "fri"];
  keys.forEach((k) => {
    const row = (src as any)?.[k];
    if (!row || typeof row !== "object") return;
    const next: {
      enabled: boolean;
      start: string;
      end: string;
      shifts?: Array<{ enabled: boolean; start: string; end: string }>;
      windows?: Array<{ enabled: boolean; start: string; end: string }>;
      periods?: Array<{ enabled: boolean; start: string; end: string }>;
    } = {
      enabled: row.enabled !== false,
      start: normalizeTimeHHMM(row.start) || "10:00",
      end: normalizeTimeHHMM(row.end) || "22:00",
    };
    const shifts = normalizeSplitWindows((row as any)?.shifts);
    const windows = normalizeSplitWindows((row as any)?.windows);
    const periods = normalizeSplitWindows((row as any)?.periods);
    if (shifts.length) next.shifts = shifts;
    if (windows.length) next.windows = windows;
    if (periods.length) next.periods = periods;
    out[k] = next;
  });
  return out;
}

function normalizeWorkingHourOverrides(v: any) {
  const rows = Array.isArray(v) ? v : [];
  return rows
    .map((row: any) => {
      const next: {
        date: string;
        enabled: boolean;
        start: string;
        end: string;
        shifts?: Array<{ enabled: boolean; start: string; end: string }>;
        windows?: Array<{ enabled: boolean; start: string; end: string }>;
        periods?: Array<{ enabled: boolean; start: string; end: string }>;
      } = {
        date: String(row?.date || "").trim(),
        enabled: row?.enabled !== false,
        start: normalizeTimeHHMM(row?.start) || "10:00",
        end: normalizeTimeHHMM(row?.end) || "22:00",
      };
      const shifts = normalizeSplitWindows((row as any)?.shifts);
      const windows = normalizeSplitWindows((row as any)?.windows);
      const periods = normalizeSplitWindows((row as any)?.periods);
      if (shifts.length) next.shifts = shifts;
      if (windows.length) next.windows = windows;
      if (periods.length) next.periods = periods;
      return next;
    })
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date));
}

export async function listActiveStaffAll(salonId: string): Promise<StaffPublicWithId[]> {
  const sid = String(salonId || "").trim();
  if (!sid) return [];

  try {
    const colRef = collection(db, "salons", sid, "staff_public");
    const snaps = await getDocs(colRef);

    const all = snaps.docs.filter((d) => !isRemovedFromStaffRecord(d.data())).map((d) => {
      const data = d.data() as any;
      return {
        id: d.id,
        name: String(data?.name ?? "").trim(),
        specialties: extractSpecialties(data),
        active: data?.active !== false,
        avatarUrl: String(data?.avatarUrl ?? "").trim() || undefined,
        avatarURL: String(data?.avatarURL ?? "").trim() || undefined,
        photoURL: String(data?.photoURL ?? "").trim() || undefined,
        photoUrl: String(data?.photoUrl ?? "").trim() || undefined,
        imageUrl: String(data?.imageUrl ?? "").trim() || undefined,
        imageURL: String(data?.imageURL ?? "").trim() || undefined,
        profileImageUrl: String(data?.profileImageUrl ?? "").trim() || undefined,
        profileImage: String(data?.profileImage ?? "").trim() || undefined,
        picture: String(data?.picture ?? "").trim() || undefined,
        avatar: String(data?.avatar ?? "").trim() || undefined,
        rating: Number.isFinite(Number(data?.rating)) ? Number(data?.rating) : undefined,
        reviewsCount: Number.isFinite(Number(data?.reviewsCount)) ? Number(data?.reviewsCount) : undefined,
        reviewCount: Number.isFinite(Number(data?.reviewCount)) ? Number(data?.reviewCount) : undefined,
        ratingsCount: Number.isFinite(Number(data?.ratingsCount)) ? Number(data?.ratingsCount) : undefined,
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

    const activeOnly = all.filter((x) => isStaffOperationallyActiveForDate(x));
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

    const all = snaps.docs.filter((d) => !isRemovedFromStaffRecord(d.data())).map((d) => {
      const data = d.data() as any;
      return {
        id: d.id,
        name: String(data?.name ?? "").trim(),
        specialties: extractSpecialties(data),
        active: data?.active !== false,
        avatarUrl: String(data?.avatarUrl ?? "").trim() || undefined,
        avatarURL: String(data?.avatarURL ?? "").trim() || undefined,
        photoURL: String(data?.photoURL ?? "").trim() || undefined,
        photoUrl: String(data?.photoUrl ?? "").trim() || undefined,
        imageUrl: String(data?.imageUrl ?? "").trim() || undefined,
        imageURL: String(data?.imageURL ?? "").trim() || undefined,
        profileImageUrl: String(data?.profileImageUrl ?? "").trim() || undefined,
        profileImage: String(data?.profileImage ?? "").trim() || undefined,
        picture: String(data?.picture ?? "").trim() || undefined,
        avatar: String(data?.avatar ?? "").trim() || undefined,
        rating: Number.isFinite(Number(data?.rating)) ? Number(data?.rating) : undefined,
        reviewsCount: Number.isFinite(Number(data?.reviewsCount)) ? Number(data?.reviewsCount) : undefined,
        reviewCount: Number.isFinite(Number(data?.reviewCount)) ? Number(data?.reviewCount) : undefined,
        ratingsCount: Number.isFinite(Number(data?.ratingsCount)) ? Number(data?.ratingsCount) : undefined,
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

    const filtered = all.filter((staff) => {
      if (!isStaffOperationallyActiveForDate(staff)) return false;
      const specs = normalizeArray(staff.specialties);
      return specs.some((sp) => norm(sp) === wanted);
    });

    return filtered;
  } catch (e: any) {
    console.error("[staff_public] listActiveStaffBySpecialty ERROR:", e?.code, e?.message, e);
    return [];
  }
}
