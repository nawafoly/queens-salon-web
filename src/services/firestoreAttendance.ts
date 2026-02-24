import { db } from "./firebase";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";

export type AttendanceViolationType = "absent" | "late" | "leave";

export type StaffAttendanceDoc = {
  date: string; // YYYY-MM-DD
  type: AttendanceViolationType;
  minutes?: number;
  absentFullDay?: boolean;
  notes?: string;
  createdAt?: any;
  updatedAt?: any;
  createdBy?: {
    uid?: string;
    name?: string;
  };
};

export type StaffAttendanceWithId = StaffAttendanceDoc & { id: string };

const DEFAULT_SALON_ID = "main";

function normalizeIsoDate(v: any): string {
  const s = String(v || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function attendanceCol(employeeId: string, salonId = DEFAULT_SALON_ID) {
  return collection(db, "salons", salonId, "staff", employeeId, "attendance");
}

function attendanceDoc(employeeId: string, date: string, salonId = DEFAULT_SALON_ID) {
  return doc(db, "salons", salonId, "staff", employeeId, "attendance", date);
}

function normalizeType(v: any): AttendanceViolationType {
  const s = String(v || "").trim();
  if (s === "absent" || s === "late" || s === "leave") return s;
  return "late";
}

export async function listStaffAttendanceByDateRange(args: {
  employeeId: string;
  fromDate: string;
  toDate: string;
  salonId?: string;
}): Promise<StaffAttendanceWithId[]> {
  const employeeId = String(args.employeeId || "").trim();
  const fromDate = normalizeIsoDate(args.fromDate);
  const toDate = normalizeIsoDate(args.toDate);
  const salonId = String(args.salonId || DEFAULT_SALON_ID).trim() || DEFAULT_SALON_ID;
  if (!employeeId || !fromDate || !toDate) return [];
  const from = fromDate <= toDate ? fromDate : toDate;
  const to = fromDate <= toDate ? toDate : fromDate;
  const qRef = query(
    attendanceCol(employeeId, salonId),
    where("date", ">=", from),
    where("date", "<=", to),
    orderBy("date", "asc")
  );
  const snap = await getDocs(qRef);
  return snap.docs.map((d) => {
    const x = d.data() as any;
    return {
      id: d.id,
      date: normalizeIsoDate(x?.date) || d.id,
      type: normalizeType(x?.type),
      minutes: Math.max(0, Number(x?.minutes || 0)),
      absentFullDay: x?.absentFullDay === true,
      notes: String(x?.notes || "").trim(),
      createdAt: x?.createdAt,
      updatedAt: x?.updatedAt,
      createdBy:
        x?.createdBy && typeof x.createdBy === "object"
          ? {
              uid: String(x.createdBy.uid || "").trim() || undefined,
              name: String(x.createdBy.name || "").trim() || undefined,
            }
          : undefined,
    };
  });
}

export async function upsertStaffAttendance(args: {
  employeeId: string;
  date: string;
  type: AttendanceViolationType;
  minutes?: number;
  absentFullDay?: boolean;
  notes?: string;
  createdByUid?: string;
  createdByName?: string;
  salonId?: string;
}) {
  const employeeId = String(args.employeeId || "").trim();
  const date = normalizeIsoDate(args.date);
  const salonId = String(args.salonId || DEFAULT_SALON_ID).trim() || DEFAULT_SALON_ID;
  if (!employeeId || !date) throw new Error("attendance: invalid employee/date");
  const type = normalizeType(args.type);
  const payload: StaffAttendanceDoc & { employeeId: string; salonId: string } = {
    date,
    type,
    minutes: Math.max(0, Number(args.minutes || 0)),
    absentFullDay: type === "absent" ? args.absentFullDay === true : false,
    notes: String(args.notes || "").trim() || undefined,
    createdBy: {
      uid: String(args.createdByUid || "").trim() || undefined,
      name: String(args.createdByName || "").trim() || undefined,
    },
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    employeeId,
    salonId,
  };
  await setDoc(attendanceDoc(employeeId, date, salonId), payload as any, { merge: true });
}

export async function removeStaffAttendance(args: {
  employeeId: string;
  date: string;
  salonId?: string;
}) {
  const employeeId = String(args.employeeId || "").trim();
  const date = normalizeIsoDate(args.date);
  const salonId = String(args.salonId || DEFAULT_SALON_ID).trim() || DEFAULT_SALON_ID;
  if (!employeeId || !date) return;
  await deleteDoc(attendanceDoc(employeeId, date, salonId));
}
