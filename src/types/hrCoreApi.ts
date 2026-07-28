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
  shiftAssignments?: CoreShiftAssignment[];
  scheduleExceptions?: CoreScheduleException[];
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
  employeeName?: string | null;
  jobTitle?: string | null;
  payrollMonth: string;
  baseSalaryHalalas?: number;
  allowancesHalalas?: number;
  workDays?: number | null;
  monthlyHours?: number | null;
  dailyRateHalalas?: number;
  hourlyRateHalalas?: number;
  expectedWorkHours?: number | null;
  actualWorkedHours?: number | null;
  missingHours?: number | null;
  detectedExtraHours?: number;
  overtimeEnabled?: number | boolean;
  financialOvertimeHours?: number;
  overtimeMultiplier?: number;
  overtimeValueHalalas?: number;
  overtimeBonusHalalas?: number;
  additionsJson?: string | null;
  deductionsJson?: string | null;
  manualAdditionsHalalas?: number;
  manualDeductionsHalalas?: number;
  advancesHalalas?: number;
  missingHoursDeductionHalalas?: number;
  grossSalaryHalalas?: number;
  totalDeductionsHalalas?: number;
  netSalaryHalalas?: number;
  finalSalaryHalalas: number;
  status?: "draft" | "reviewed" | "approved" | "paid" | string;
  attendanceSummaryJson?: string | null;
  scheduleSnapshotJson?: string | null;
  auditLogJson?: string | null;
  approvedAt?: string | null;
  approvedByUid?: string | null;
  paidAt?: string | null;
  paidByUid?: string | null;
  notes?: string | null;
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

export type CoreShiftTemplate = {
  id: string;
  salonId: string;
  name: string;
  code?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  crossesMidnight: boolean | number;
  breakMinutes: number;
  breakPaid: boolean | number;
  lateGraceMinutes: number;
  earlyLeaveGraceMinutes: number;
  overtimeAfterMinutes: number;
  active: boolean | number;
};

export type CoreShiftAssignment = {
  id: string;
  salonId: string;
  employeeId: string;
  shiftTemplateId?: string | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
  assignmentType: "permanent" | "temporary" | string;
  status: "draft" | "published" | "cancelled" | string;
  reason?: string | null;
  snapshotJson: string;
  shiftName?: string | null;
  shiftCode?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  crossesMidnight?: boolean | number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};


export type CoreScheduleException = {
  id: string;
  salonId: string;
  employeeId: string;
  dateFrom: string;
  dateTo: string;
  exceptionType: "shift" | "off" | "custom" | string;
  shiftTemplateId?: string | null;
  enabled: boolean | number;
  startTime?: string | null;
  endTime?: string | null;
  note?: string | null;
  status: string;
  shiftName?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type CoreResolvedShift = Record<string, unknown> & {
  source: "exception" | "assignment" | "none" | string;
  date: string;
  employeeId?: string | null;
  employee_id?: string | null;
  exceptionType?: "shift" | "off" | "custom" | string | null;
  exception_type?: "shift" | "off" | "custom" | string | null;
  shiftTemplateId?: string | null;
  shift_template_id?: string | null;
  startTime?: string | null;
  start_time?: string | null;
  endTime?: string | null;
  end_time?: string | null;
  templateStartTime?: string | null;
  template_start_time?: string | null;
  templateEndTime?: string | null;
  template_end_time?: string | null;
  shiftName?: string | null;
  shift_name?: string | null;
  snapshotJson?: string | null;
  snapshot_json?: string | null;
  crossesMidnight?: boolean | number | null;
  crosses_midnight?: boolean | number | null;
  breakMinutes?: number | null;
  break_minutes?: number | null;
  lateGraceMinutes?: number | null;
  late_grace_minutes?: number | null;
  earlyLeaveGraceMinutes?: number | null;
  early_leave_grace_minutes?: number | null;
};
