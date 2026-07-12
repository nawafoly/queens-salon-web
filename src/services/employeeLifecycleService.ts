import { doc, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "./firebase";

const SALON_ID = "main";

export type ArchiveEmployeeInput = {
  employeeId: string;
  linkedUids?: Array<string | null | undefined>;
  deletedBy?: string | null;
};

function clean(value: unknown) {
  return String(value || "").trim();
}

export async function archiveEmployee(input: ArchiveEmployeeInput) {
  const employeeId = clean(input.employeeId);
  if (!employeeId) throw new Error("معرّف الموظفة مفقود؛ لم تتم الأرشفة.");

  const uids = Array.from(new Set((input.linkedUids || []).map(clean).filter(Boolean)));
  const archivedPatch = {
    active: false,
    isActive: false,
    showOnBooking: false,
    showOnAbout: false,
    archived: true,
    deleted: true,
    removedFromStaff: true,
    employmentStatus: "deleted",
    deletedAt: serverTimestamp(),
    deletedBy: clean(input.deletedBy) || null,
    updatedAt: serverTimestamp(),
  };

  const batch = writeBatch(db);
  batch.set(doc(db, "salons", SALON_ID, "staff_public", employeeId), archivedPatch, { merge: true });
  batch.set(doc(db, "salons", SALON_ID, "employees", employeeId), archivedPatch, { merge: true });
  for (const uid of uids) {
    batch.set(doc(db, "salons", SALON_ID, "users", uid), archivedPatch, { merge: true });
    batch.set(doc(db, "salons", SALON_ID, "admin_users", uid), archivedPatch, { merge: true });
  }
  await batch.commit();
}
