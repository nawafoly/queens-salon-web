export type CoreHrEmployee = {
  id: string;
  salonId: string;
  firebaseUid?: string | null;
  name: string;
  email?: string | null;
  phoneNormalized?: string | null;
  avatarFileId?: string | null;
  status: string;
  employment?: Record<string, unknown> | null;
  schedules?: CoreHrSchedule[];
  createdAt: string;
  updatedAt: string;
};

export type CoreHrSchedule = {
  id: string;
  salonId: string;
  employeeId: string;
  weekday: number;
  startTime?: string | null;
  endTime?: string | null;
  active: boolean;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
};

export type CoreAttendanceRecord = {
  id: string;
  salonId: string;
  employeeId: string;
  employeeUid?: string | null;
  dateKey: string;
  recordType: "check_in" | "check_out";
  recordedAt: string;
  latitude?: number | null;
  longitude?: number | null;
  accuracyMeters?: number | null;
  zoneId?: string | null;
  deviceId?: string | null;
  source?: string | null;
  note?: string | null;
  idempotencyKey?: string | null;
};

export type CoreAttendanceState = {
  salonId: string;
  employeeId: string;
  lastType?: "check_in" | "check_out" | null;
  lastRecordId?: string | null;
  lastTime?: string | null;
};

export type CoreLeave = {
  id: string;
  salonId: string;
  employeeId: string;
  employeeUid?: string | null;
  status: "pending" | "approved" | "rejected" | string;
  leaveType: string;
  startDate: string;
  endDate: string;
  daysCount: number;
  employeeNote?: string | null;
  hrNote?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CoreAbsence = {
  id: string;
  salonId: string;
  employeeId: string;
  employeeUid?: string | null;
  dateKey: string;
  absenceType: "full_day" | "half_day" | string;
  note?: string | null;
  createdByUid?: string | null;
  createdAt: string;
};

export type CorePayrollPeriod = {
  id: string;
  salonId: string;
  payrollMonth: string;
  monthStart: string;
  monthEnd: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type CorePayrollEntry = Record<string, unknown> & {
  id: string;
  salonId: string;
  employeeId: string;
  payrollMonth: string;
  finalSalaryHalalas: number;
};

export type CoreFileMetadata = {
  id: string;
  salonId: string;
  employeeId?: string | null;
  category: string;
  title?: string | null;
  description?: string | null;
  fileName: string;
  storageKey: string;
  contentType?: string | null;
  sizeBytes?: number | null;
  status: string;
  visibility: string;
  createdAt: string;
  updatedAt: string;
};
