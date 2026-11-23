import type {
  AttendanceLocation,
  WorkZoneMatch,
} from "./attendanceSettingsService";
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

export function getTodayAttendanceDateKey() {
  return getRiyadhDateKey();
}
