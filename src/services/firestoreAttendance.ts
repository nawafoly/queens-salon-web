import {
  deleteField,
  deleteDoc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "./firebase";
import {
  SALON_ID,
  staffAttendanceCollection,
  staffAttendanceDoc,
} from "./hrCollections";
import type { AttendanceLocation, WorkZoneMatch } from "./attendanceSettingsService";

export type AttendanceViolationType = "absent" | "late" | "leave";
export type AttendancePunchStatus = "not_started" | "checked_in" | "checked_out" | "incomplete";

export type AttendanceVerification = {
  biometricVerified?: boolean;
  biometricMethod?: string;
  biometricVerifiedAtClient?: string;
  biometricCredentialId?: string;
  location?: AttendanceLocation;
  workZoneId?: string;
  workZoneName?: string;
  distanceMeters?: number;
  radiusMeters?: number;
};

export type AttendanceRawRecord = {
  id?: string;
  type?: string;
  result?: string;
  serverTime?: string | null;
  clientTime?: string | null;
  location?: AttendanceLocation;
  zoneId?: string | null;
  zoneName?: string | null;
  distanceMeters?: number | null;
};

export type StaffAttendanceDoc = {
  date: string; // YYYY-MM-DD
  type?: AttendanceViolationType;
  minutes?: number;
  absentFullDay?: boolean;
  checkInAt?: any;
  checkOutAt?: any;
  checkInAtClient?: string;
  checkOutAtClient?: string;
  status?: AttendancePunchStatus;
  notes?: string;
  createdAt?: any;
  updatedAt?: any;
  createdBy?: {
    uid?: string;
    name?: string;
  };
  updatedBy?: {
    uid?: string;
    name?: string;
  };
  checkInVerification?: AttendanceVerification;
  checkOutVerification?: AttendanceVerification;
  records?: AttendanceRawRecord[];
  adminCorrection?: boolean;
};

export type StaffAttendanceWithId = StaffAttendanceDoc & { id: string };
export type StaffAttendanceToday = StaffAttendanceWithId & {
  employeeId: string;
  status: AttendancePunchStatus;
};

const DEFAULT_SALON_ID: string = SALON_ID;

function normalizeIsoDate(v: any): string {
  const s = String(v || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function attendanceCol(employeeId: string, salonId = DEFAULT_SALON_ID) {
  return staffAttendanceCollection(employeeId, salonId);
}

function attendanceDoc(employeeId: string, date: string, salonId = DEFAULT_SALON_ID) {
  return staffAttendanceDoc(employeeId, date, salonId);
}

function normalizeType(v: any): AttendanceViolationType {
  const s = String(v || "").trim();
  if (s === "absent" || s === "late" || s === "leave") return s;
  return "late";
}

function getRiyadhDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function normalizePunchStatus(data: any): AttendancePunchStatus {
  const raw = String(data?.status || "").trim();
  if (raw === "incomplete") return "incomplete";
  if (raw === "checked_out" || data?.checkOutAt || data?.checkOutAtClient) return "checked_out";
  if (raw === "checked_in" || data?.checkInAt || data?.checkInAtClient) return "checked_in";
  return "not_started";
}

function attendanceActor(uid?: string, name?: string) {
  const fallbackUid = auth.currentUser?.uid || "";
  return {
    uid: String(uid || fallbackUid || "").trim() || undefined,
    name: String(name || "").trim() || undefined,
  };
}

function sanitizeVerification(input?: AttendanceVerification): AttendanceVerification | undefined {
  if (!input) return undefined;
  const location = input.location
    ? {
        lat: Number(input.location.lat),
        lng: Number(input.location.lng),
        accuracy: Number.isFinite(Number(input.location.accuracy))
          ? Math.max(0, Math.round(Number(input.location.accuracy)))
          : undefined,
      }
    : undefined;

  const clean: AttendanceVerification = {
    biometricVerified: input.biometricVerified === true,
    biometricMethod: String(input.biometricMethod || "").trim() || undefined,
    biometricVerifiedAtClient: String(input.biometricVerifiedAtClient || "").trim() || undefined,
    biometricCredentialId: String(input.biometricCredentialId || "").trim() || undefined,
    location:
      location && Number.isFinite(location.lat) && Number.isFinite(location.lng)
        ? location
        : undefined,
    workZoneId: String(input.workZoneId || "").trim() || undefined,
    workZoneName: String(input.workZoneName || "").trim() || undefined,
    distanceMeters: Number.isFinite(Number(input.distanceMeters))
      ? Math.max(0, Math.round(Number(input.distanceMeters)))
      : undefined,
    radiusMeters: Number.isFinite(Number(input.radiusMeters))
      ? Math.max(0, Math.round(Number(input.radiusMeters)))
      : undefined,
  };

  return Object.fromEntries(
    Object.entries(clean).filter(([, value]) => value !== undefined && value !== "")
  ) as AttendanceVerification;
}

export function buildAttendanceVerification(args: {
  biometric?: {
    verified?: boolean;
    method?: string;
    verifiedAtClient?: string;
    credentialId?: string;
  };
  location?: AttendanceLocation;
  workZoneMatch?: WorkZoneMatch | null;
}): AttendanceVerification {
  return sanitizeVerification({
    biometricVerified: args.biometric?.verified === true,
    biometricMethod: args.biometric?.method,
    biometricVerifiedAtClient: args.biometric?.verifiedAtClient,
    biometricCredentialId: args.biometric?.credentialId,
    location: args.location,
    workZoneId: args.workZoneMatch?.zone.id,
    workZoneName: args.workZoneMatch?.zone.name,
    distanceMeters: args.workZoneMatch?.distanceMeters,
    radiusMeters: args.workZoneMatch?.zone.radiusMeters,
  }) || {};
}

function mapAttendanceDoc(employeeId: string, date: string, id: string, data: any): StaffAttendanceToday {
  return {
    id,
    employeeId,
    date: normalizeIsoDate(data?.date) || date,
    type: data?.type ? normalizeType(data?.type) : undefined,
    minutes: Math.max(0, Number(data?.minutes || 0)),
    absentFullDay: data?.absentFullDay === true,
    checkInAt: data?.checkInAt,
    checkOutAt: data?.checkOutAt,
    checkInAtClient: String(data?.checkInAtClient || "").trim() || undefined,
    checkOutAtClient: String(data?.checkOutAtClient || "").trim() || undefined,
    status: normalizePunchStatus(data),
    notes: String(data?.notes || "").trim(),
    createdAt: data?.createdAt,
    updatedAt: data?.updatedAt,
    createdBy:
      data?.createdBy && typeof data.createdBy === "object"
        ? {
            uid: String(data.createdBy.uid || "").trim() || undefined,
            name: String(data.createdBy.name || "").trim() || undefined,
          }
        : undefined,
    updatedBy:
      data?.updatedBy && typeof data.updatedBy === "object"
        ? {
            uid: String(data.updatedBy.uid || "").trim() || undefined,
            name: String(data.updatedBy.name || "").trim() || undefined,
          }
        : undefined,
    checkInVerification: sanitizeVerification(data?.checkInVerification),
    checkOutVerification: sanitizeVerification(data?.checkOutVerification),
  };
}

export function getTodayAttendanceDateKey() {
  return getRiyadhDateKey();
}

export async function getStaffAttendanceForDate(args: {
  employeeId: string;
  date?: string;
  salonId?: string;
}): Promise<StaffAttendanceToday> {
  const employeeId = String(args.employeeId || "").trim();
  const date = normalizeIsoDate(args.date) || getTodayAttendanceDateKey();
  const salonId = String(args.salonId || DEFAULT_SALON_ID).trim() || DEFAULT_SALON_ID;
  if (!employeeId || !date) {
    return mapAttendanceDoc(employeeId, date, date, {});
  }

  const snap = await getDoc(attendanceDoc(employeeId, date, salonId));
  return mapAttendanceDoc(employeeId, date, snap.id || date, snap.exists() ? snap.data() : {});
}

export async function listStaffAttendanceForDate(args: {
  employeeIds: string[];
  date?: string;
  salonId?: string;
}): Promise<StaffAttendanceToday[]> {
  const date = normalizeIsoDate(args.date) || getTodayAttendanceDateKey();
  const employeeIds = Array.from(
    new Set((Array.isArray(args.employeeIds) ? args.employeeIds : []).map(id => String(id || "").trim()).filter(Boolean))
  );
  if (!employeeIds.length) return [];

  return Promise.all(
    employeeIds.map(employeeId =>
      getStaffAttendanceForDate({
        employeeId,
        date,
        salonId: args.salonId,
      })
    )
  );
}

export async function checkInStaffAttendance(args: {
  employeeId: string;
  date?: string;
  createdByUid?: string;
  createdByName?: string;
  salonId?: string;
  verification?: AttendanceVerification;
}) {
  const employeeId = String(args.employeeId || "").trim();
  const date = normalizeIsoDate(args.date) || getTodayAttendanceDateKey();
  const salonId = String(args.salonId || DEFAULT_SALON_ID).trim() || DEFAULT_SALON_ID;
  if (!employeeId || !date) throw new Error("attendance: invalid employee/date");
  const ref = attendanceDoc(employeeId, date, salonId);
  const clientTime = new Date().toISOString();

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists() ? normalizePunchStatus(snap.data()) : "not_started";
    if (current === "checked_in" || current === "checked_out") {
      throw new Error("تم تسجيل الحضور لهذا اليوم بالفعل.");
    }

    tx.set(ref, {
      date,
      employeeId,
      salonId,
      status: "checked_in" as AttendancePunchStatus,
      checkInAt: serverTimestamp(),
      checkInAtClient: clientTime,
      createdBy: attendanceActor(args.createdByUid, args.createdByName),
      checkInVerification: sanitizeVerification(args.verification),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  });
}

export async function checkOutStaffAttendance(args: {
  employeeId: string;
  date?: string;
  createdByUid?: string;
  createdByName?: string;
  salonId?: string;
  verification?: AttendanceVerification;
}) {
  const employeeId = String(args.employeeId || "").trim();
  const date = normalizeIsoDate(args.date) || getTodayAttendanceDateKey();
  const salonId = String(args.salonId || DEFAULT_SALON_ID).trim() || DEFAULT_SALON_ID;
  if (!employeeId || !date) throw new Error("attendance: invalid employee/date");
  const ref = attendanceDoc(employeeId, date, salonId);
  const clientTime = new Date().toISOString();

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists() ? normalizePunchStatus(snap.data()) : "not_started";
    if (current === "not_started") {
      throw new Error("يجب تسجيل الحضور قبل تسجيل الانصراف.");
    }
    if (current === "checked_out") {
      throw new Error("تم تسجيل الانصراف لهذا اليوم بالفعل.");
    }

    tx.set(ref, {
      date,
      employeeId,
      salonId,
      status: "checked_out" as AttendancePunchStatus,
      checkOutAt: serverTimestamp(),
      checkOutAtClient: clientTime,
      updatedBy: attendanceActor(args.createdByUid, args.createdByName),
      checkOutVerification: sanitizeVerification(args.verification),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  });
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
      checkInAt: x?.checkInAt,
      checkOutAt: x?.checkOutAt,
      checkInAtClient: String(x?.checkInAtClient || "").trim() || undefined,
      checkOutAtClient: String(x?.checkOutAtClient || "").trim() || undefined,
      status: normalizePunchStatus(x),
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
      updatedBy:
        x?.updatedBy && typeof x.updatedBy === "object"
          ? {
              uid: String(x.updatedBy.uid || "").trim() || undefined,
              name: String(x.updatedBy.name || "").trim() || undefined,
            }
          : undefined,
      checkInVerification: sanitizeVerification(x?.checkInVerification),
      checkOutVerification: sanitizeVerification(x?.checkOutVerification),
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

export async function setStaffAttendancePunchOverride(args: {
  employeeId: string;
  date: string;
  checkInAtClient: string;
  checkOutAtClient?: string;
  notes?: string;
  createdByUid?: string;
  createdByName?: string;
  salonId?: string;
}) {
  const employeeId = String(args.employeeId || "").trim();
  const date = normalizeIsoDate(args.date);
  const salonId = String(args.salonId || DEFAULT_SALON_ID).trim() || DEFAULT_SALON_ID;
  const checkInAtClient = String(args.checkInAtClient || "").trim();
  const checkOutAtClient = String(args.checkOutAtClient || "").trim();
  if (!employeeId || !date) throw new Error("attendance: invalid employee/date");
  if (!checkInAtClient) throw new Error("يجب إدخال وقت الحضور قبل حفظ تعديل البصمة.");

  const payload: any = {
    date,
    employeeId,
    salonId,
    status: checkOutAtClient ? "checked_out" : "checked_in",
    checkInAtClient,
    checkOutAtClient: checkOutAtClient || deleteField(),
    checkOutAt: checkOutAtClient ? undefined : deleteField(),
    notes: String(args.notes || "").trim() || undefined,
    adminCorrection: true,
    updatedBy: attendanceActor(args.createdByUid, args.createdByName),
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  };

  Object.keys(payload).forEach((key) => {
    if (payload[key] === undefined) delete payload[key];
  });

  await setDoc(attendanceDoc(employeeId, date, salonId), payload, { merge: true });
}
