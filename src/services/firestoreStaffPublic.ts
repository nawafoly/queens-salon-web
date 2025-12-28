// src/services/firestoreStaffPublic.ts
import { db } from "./firebase";
import {
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";

export type StaffPublicDoc = {
  name: string;
  specialties: string[];
  active: boolean;
};

export type StaffPublicWithId = StaffPublicDoc & { id: string };

export async function listActiveStaffBySpecialty(args: {
  salonId: string;      // مثال: "main"
  sectionId: string;    // مثال: "hair"
}): Promise<StaffPublicWithId[]> {
  const colRef = collection(db, `salons/${args.salonId}/staff_public`);

  const q = query(
    colRef,
    where("active", "==", true),
    where("specialties", "array-contains", args.sectionId)
  );

  const snaps = await getDocs(q);

  return snaps.docs.map((d) => {
    const data = d.data() as any;
    return {
      id: d.id,
      name: String(data?.name ?? "").trim(),
      specialties: Array.isArray(data?.specialties) ? data.specialties : [],
      active: Boolean(data?.active),
    };
  });
}
