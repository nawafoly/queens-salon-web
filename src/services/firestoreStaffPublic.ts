// src/services/firestoreStaffPublic.ts
import { db } from "./firebase";
import { collection, getDocs, query, where } from "firebase/firestore";

export type StaffPublicDoc = {
  name: string;
  specialties: string[]; // ✅ مفاتيح واضحة (مثل hair / skin / nails ... لازم تطابق IDs الأقسام)
  active: boolean;
  linkedUid?: string;
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
    const q1 = query(colRef, where("active", "==", true));
    const snaps = await getDocs(q1);

    const all = snaps.docs.map((d) => {
      const data = d.data() as any;
      return {
        id: d.id,
        name: String(data?.name ?? "").trim(),
        specialties: normalizeArray(data?.specialties),
        active: Boolean(data?.active),
        linkedUid: String(data?.linkedUid ?? "").trim() || undefined,
      } as StaffPublicWithId;
    });

    console.log("[staff_public] listActiveStaffAll active =", all.length);
    return all;
  } catch (e: any) {
    console.error("[staff_public] listActiveStaffAll ERROR:", e?.code, e?.message, e);
    return [];
  }
}

export async function listActiveStaffBySpecialty(args: {
  salonId: string;
  specialty: string; // ✅ لازم يطابق بالضبط (مثل hair / skin / nails)
}): Promise<StaffPublicWithId[]> {
  const salonId = String(args?.salonId || "").trim();
  const wantedRaw = String(args?.specialty || "").trim();
  if (!salonId || !wantedRaw) return [];

  const wanted = norm(wantedRaw);

  try {
    // ✅ نجيب النشطات فقط (بدون array-contains عشان ما نحتاج index)
    const colRef = collection(db, "salons", salonId, "staff_public");
    const q1 = query(colRef, where("active", "==", true));
    const snaps = await getDocs(q1);

    const all = snaps.docs.map((d) => {
      const data = d.data() as any;
      return {
        id: d.id,
        name: String(data?.name ?? "").trim(),
        specialties: normalizeArray(data?.specialties),
        active: Boolean(data?.active),
        linkedUid: String(data?.linkedUid ?? "").trim() || undefined,
      } as StaffPublicWithId;
    });

    // ✅ فلترة محلية حسب specialties
    const filtered = all.filter((staff) => {
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
