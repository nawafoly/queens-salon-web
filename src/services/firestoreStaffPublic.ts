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
  leaveStartDate?: string;
  leaveUntil?: string;
  leaveType?: string;
  leaveNote?: string;
  leaveRequestId?: string;
  coreLeaveId?: string;
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
  source?: "staff_public" | "employees" | string;
  employeeId?: string;
  employeeDocId?: string;
  employeeUid?: string;
  uid?: string;
  authUid?: string;
  userId?: string;
  email?: string;
  phone?: string;
};

export type StaffPublicWithId = StaffPublicDoc & { id: string };

function norm(v: any) {
  return String(v ?? "").trim().toLowerCase();
}

function cleanPhone(v: any) {
  return String(v ?? "").replace(/\D+/g, "");
}

function normalizeArabicName(value: any): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[أإآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\u0600-\u06FFa-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
    // Handle delimited payloads stored as a single string.
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
  const employeeProfile = data?.employeeProfile && typeof data.employeeProfile === "object" ? data.employeeProfile : {};
  const bookingProfile = data?.bookingProfile && typeof data.bookingProfile === "object" ? data.bookingProfile : {};
  const operationalProfile = data?.operationalProfile && typeof data.operationalProfile === "object" ? data.operationalProfile : {};
  const direct = normalizeArray(data?.specialties);
  const serviceIds = normalizeArray(data?.serviceIds);
  const servicesIds = normalizeArray(data?.servicesIds);
  const providedServices = normalizeArray(data?.providedServices);
  const profileSpecialties = normalizeArray((employeeProfile as any)?.specialties);
  const profileServiceIds = normalizeArray((employeeProfile as any)?.serviceIds);
  const bookingSpecialties = normalizeArray((bookingProfile as any)?.specialties);
  const bookingServiceIds = normalizeArray((bookingProfile as any)?.serviceIds);
  const operationalSpecialties = normalizeArray((operationalProfile as any)?.specialties);
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
      ...profileSpecialties,
      ...profileServiceIds,
      ...bookingSpecialties,
      ...bookingServiceIds,
      ...operationalSpecialties,
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

function resolveStaffName(data: any) {
  return String(data?.name ?? data?.displayName ?? data?.fullName ?? data?.employeeName ?? "").trim();
}

function normalizeStaffRow(
  id: string,
  data: any,
  source: "staff_public" | "employees"
): StaffPublicWithId {
  const employeeProfile = data?.employeeProfile && typeof data.employeeProfile === "object" ? data.employeeProfile : {};
  const employment = data?.employment && typeof data.employment === "object" ? data.employment : {};
  const staffId =
    source === "staff_public"
      ? id
      : String(data?.staffPublicId || data?.linkedStaffPublicId || data?.employeeId || data?.employeeDocId || id).trim() || id;
  const linkedUid = String(
    data?.linkedUid ||
      data?.employeeUid ||
      data?.authUid ||
      data?.uid ||
      data?.userId ||
      data?.linkedUserId ||
      ""
  ).trim();
  return {
    id: staffId,
    source,
    employeeId: String(data?.employeeId || data?.employeeDocId || id).trim() || id,
    employeeDocId: String(data?.employeeDocId || id).trim() || id,
    employeeUid: String(data?.employeeUid || data?.uid || data?.authUid || data?.userId || "").trim() || undefined,
    uid: String(data?.uid || data?.employeeUid || "").trim() || undefined,
    authUid: String(data?.authUid || "").trim() || undefined,
    userId: String(data?.userId || "").trim() || undefined,
    email: String(data?.email || data?.userEmail || "").trim() || undefined,
    phone: String(data?.phone || data?.mobile || data?.phoneNumber || data?.employeePhone || "").trim() || undefined,
    name: resolveStaffName(data),
    specialties: extractSpecialties(data),
    active: data?.active !== false && data?.isActive !== false,
    avatarUrl: String(data?.avatarUrl ?? data?.avatarURL ?? data?.photoURL ?? data?.photoUrl ?? data?.imageUrl ?? data?.imageURL ?? data?.profileImageUrl ?? data?.profileImage ?? data?.picture ?? data?.avatar ?? "").trim() || undefined,
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
    employmentEndDate: resolveEmploymentEndDate({ ...employment, ...employeeProfile, ...data }) || undefined,
    linkedUid: linkedUid || undefined,
    showOnBooking: data?.showOnBooking !== false && (employeeProfile as any)?.showOnBooking !== false,
    onLeave: !!data?.onLeave || (employeeProfile as any)?.onLeave === true,
    leaveStartDate: String(
      data?.leaveStartDate ??
        data?.leaveFrom ??
        data?.leaveFromDate ??
        (employeeProfile as any)?.leaveStartDate ??
        (employeeProfile as any)?.leaveFrom ??
        ""
    ).trim(),
    leaveUntil: String(data?.leaveUntil ?? (employeeProfile as any)?.leaveUntil ?? "").trim(),
    leaveType: String(data?.leaveType ?? (employeeProfile as any)?.leaveType ?? "").trim(),
    leaveNote: String(data?.leaveNote ?? (employeeProfile as any)?.leaveNote ?? "").trim(),
    leaveRequestId: String(data?.leaveRequestId ?? (employeeProfile as any)?.leaveRequestId ?? "").trim(),
    coreLeaveId: String(data?.coreLeaveId ?? (employeeProfile as any)?.coreLeaveId ?? "").trim(),
    exceptionalLeaveDates: normalizeIsoDates(data?.exceptionalLeaveDates || (employeeProfile as any)?.exceptionalLeaveDates),
    exceptionalLeaveWeekdays: normalizeWeekdays(data?.exceptionalLeaveWeekdays || data?.weeklyOffDays || data?.offWeekdays || (employeeProfile as any)?.exceptionalLeaveWeekdays),
    useCustomWorkingHours: !!data?.useCustomWorkingHours || (employeeProfile as any)?.useCustomWorkingHours === true,
    customWorkingHours: normalizeWorkingHours(data?.customWorkingHours || (employeeProfile as any)?.customWorkingHours),
    customWorkingHourOverrides: normalizeWorkingHourOverrides(data?.customWorkingHourOverrides || (employeeProfile as any)?.customWorkingHourOverrides),
  } as StaffPublicWithId;
}

function staffMergeKeys(row: StaffPublicWithId): string[] {
  const keys = new Set<string>();
  [
    row.id,
    row.employeeId,
    row.employeeDocId,
    row.employeeUid,
    row.uid,
    row.authUid,
    row.userId,
    row.linkedUid,
  ].forEach((value) => {
    const key = String(value || "").trim();
    if (key) keys.add(`id:${key}`);
  });
  const email = String(row.email || "").trim().toLowerCase();
  if (email) keys.add(`email:${email}`);
  const phone = cleanPhone(row.phone);
  if (phone) keys.add(`phone:${phone}`);
  const name = normalizeArabicName(row.name);
  if (name) keys.add(`name:${name}`);
  return Array.from(keys);
}

function mergeStaffRow(current: StaffPublicWithId | undefined, next: StaffPublicWithId): StaffPublicWithId {
  if (!current) return next;
  const keepCurrentId = current.source === "staff_public" || next.source !== "staff_public";
  const primary = keepCurrentId ? current : next;
  const secondary = keepCurrentId ? next : current;
  return {
    ...secondary,
    ...primary,
    id: primary.id || secondary.id,
    name: primary.name || secondary.name,
    specialties: Array.from(new Set([...(current.specialties || []), ...(next.specialties || [])])),
    active: current.active !== false && next.active !== false,
    linkedUid: current.linkedUid || next.linkedUid,
    employeeId: current.employeeId || next.employeeId,
    employeeDocId: current.employeeDocId || next.employeeDocId,
    employeeUid: current.employeeUid || next.employeeUid,
    uid: current.uid || next.uid,
    authUid: current.authUid || next.authUid,
    userId: current.userId || next.userId,
    email: current.email || next.email,
    showOnBooking: current.showOnBooking !== false && next.showOnBooking !== false,
    onLeave: current.onLeave === true || next.onLeave === true,
    leaveStartDate: current.leaveStartDate || next.leaveStartDate,
    leaveUntil: current.leaveUntil || next.leaveUntil,
    leaveType: current.leaveType || next.leaveType,
    leaveNote: current.leaveNote || next.leaveNote,
    leaveRequestId: current.leaveRequestId || next.leaveRequestId,
    coreLeaveId: current.coreLeaveId || next.coreLeaveId,
    employmentEndDate: current.employmentEndDate || next.employmentEndDate,
    exceptionalLeaveDates: current.exceptionalLeaveDates?.length ? current.exceptionalLeaveDates : next.exceptionalLeaveDates,
    exceptionalLeaveWeekdays: current.exceptionalLeaveWeekdays?.length ? current.exceptionalLeaveWeekdays : next.exceptionalLeaveWeekdays,
    useCustomWorkingHours: current.useCustomWorkingHours === true || next.useCustomWorkingHours === true,
    customWorkingHours: Object.keys(current.customWorkingHours || {}).length ? current.customWorkingHours : next.customWorkingHours,
    customWorkingHourOverrides: current.customWorkingHourOverrides?.length ? current.customWorkingHourOverrides : next.customWorkingHourOverrides,
    source: primary.source || secondary.source,
  };
}

function mergeStaffRows(rows: StaffPublicWithId[]): StaffPublicWithId[] {
  const byPrimaryKey = new Map<string, StaffPublicWithId>();
  const aliasToPrimaryKey = new Map<string, string>();
  rows.forEach((row) => {
    if (!String(row.name || "").trim()) return;
    const keys = staffMergeKeys(row);
    if (!keys.length) return;
    const matchedPrimary = keys.map((key) => aliasToPrimaryKey.get(key)).find(Boolean);
    const primary = matchedPrimary || keys[0];
    const merged = mergeStaffRow(byPrimaryKey.get(primary), row);
    byPrimaryKey.set(primary, merged);
    staffMergeKeys(merged).forEach((key) => aliasToPrimaryKey.set(key, primary));
    keys.forEach((key) => aliasToPrimaryKey.set(key, primary));
  });
  return Array.from(byPrimaryKey.values());
}

async function readStaffRowsFromCollection(
  salonId: string,
  collectionName: "staff_public" | "employees"
) {
  const colRef = collection(db, "salons", salonId, collectionName);
  const snaps = await getDocs(colRef);
  return snaps.docs
    .filter((d) => !isRemovedFromStaffRecord(d.data()))
    .map((d) => normalizeStaffRow(d.id, d.data() as any, collectionName));
}

export async function listActiveStaffAll(salonId: string): Promise<StaffPublicWithId[]> {
  const sid = String(salonId || "").trim();
  if (!sid) return [];

  try {
    const [staffPublicRows, employeeRows] = await Promise.all([
      readStaffRowsFromCollection(sid, "staff_public"),
      readStaffRowsFromCollection(sid, "employees"),
    ]);

    const all = mergeStaffRows([...staffPublicRows, ...employeeRows]);
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
    const all = await listActiveStaffAll(salonId);

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
