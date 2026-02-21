// src/services/firestoreStaffPublic.ts
import { db } from "./firebase";
import { collection, getDocs } from "firebase/firestore";

export type StaffPublicDoc = {
  name: string;
  specialties: string[];
  active?: boolean;
  linkedUid?: string;
  showOnBooking?: boolean;
  onLeave?: boolean;
  leaveUntil?: string;
  leaveNote?: string;
};

export type StaffPublicWithId = StaffPublicDoc & { id: string };

function norm(v: any) {
  return String(v ?? "").trim().toLowerCase();
}

function normalizeArray(v: any): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
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
        specialties: normalizeArray(data?.specialties),
        active: data?.active !== false,
        linkedUid: String(data?.linkedUid ?? "").trim() || undefined,
        showOnBooking: data?.showOnBooking !== false,
        onLeave: !!data?.onLeave,
        leaveUntil: String(data?.leaveUntil ?? "").trim(),
        leaveNote: String(data?.leaveNote ?? "").trim(),
      } as StaffPublicWithId;
    });

    const activeOnly = all.filter((x) => x.active);
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
        specialties: normalizeArray(data?.specialties),
        active: data?.active !== false,
        linkedUid: String(data?.linkedUid ?? "").trim() || undefined,
        showOnBooking: data?.showOnBooking !== false,
        onLeave: !!data?.onLeave,
        leaveUntil: String(data?.leaveUntil ?? "").trim(),
        leaveNote: String(data?.leaveNote ?? "").trim(),
      } as StaffPublicWithId;
    });

    const filtered = all.filter((staff) => {
      if (!staff.active) return false;
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

