export type CoreHrEmployee = {
  id: string;
  salonId: string;
  firebaseUid?: string | null;
  name: string;
  email?: string | null;
  phone?: string | null;
  phoneNormalized?: string | null;
  avatarFileId?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  cvUrl?: string | null;
  showOnAbout?: boolean | number | null;
  includeInEmployeeManagement?: boolean | number | null;
  rating?: number | null;
  reviewsCount?: number | null;
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
  shiftTemplateId?: string | null;
  shiftName?: string | null;
  shiftCode?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  templateStartTime?: string | null;
  templateEndTime?: string | null;
  lateGraceMinutes?: number | null;
  /** @deprecated Kept only for old schedule payloads. */
  earlyLeaveGraceMinutes?: number | null;
  attendanceLockEnabled?: boolean | number | null;
  attendanceLockAfterMinutes?: number | null;
  active: boolean | number;
  scheduleSource?: "shift_template" | "weekly_off" | "legacy" | string;
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
  durationKind?: "full_day" | "partial" | string;
  partialStartTime?: string | null;
  partialEndTime?: string | null;
  requestId?: string | null;
  deductFromBalance?: boolean | number;
  affectsPayroll?: boolean | number;
  balanceAdjustmentId?: string | null;
  employeeNote?: string | null;
  hrNote?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CoreLeaveBalanceEntry = {
  id: string;
  employeeId: string;
  actionType: "add" | "deduct" | string;
  type?: "add" | "deduct" | string;
  days: number;
  changeAmount: number;
  balanceBefore: number;
  balanceAfter: number;
  date: string;
  operationDate: string;
  note?: string;
  sourceType: string;
  sourceId?: string | null;
  createdByUid?: string | null;
  createdByEmail?: string | null;
  createdBy?: string | null;
  createdAt: string;
  deleted?: boolean;
  deletedAt?: string | null;
  deletedByUid?: string | null;
  deletedByEmail?: string | null;
  deletedByName?: string | null;
  deleteReason?: string | null;
};

export type CoreLeaveBalanceState = {
  employeeId: string;
  leaveBalance: number;
  leaveEntitlementDate?: string | null;
  entries: CoreLeaveBalanceEntry[];
};

export type CoreMyLeaveBalanceState = {
  employeeId: string;
  leaveBalance: number;
  leaveEntitlementDate?: string | null;
};
export type CoreLeaveBalanceMutationResult = {
  previousBalance: number;
  leaveBalanceDays: number;
  leaveEntries: CoreLeaveBalanceEntry[];
  createdEntry?: CoreLeaveBalanceEntry | null;
  deletedEntry?: CoreLeaveBalanceEntry | null;
  reversalEntry?: CoreLeaveBalanceEntry | null;
  reversedChangeAmount?: number;
  idempotent?: boolean;
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

export type CorePayrollRecurringDeduction = {
  id: string;
  salonId: string;
  employeeId: string;
  title: string;
  deductionKind: string;
  amountHalalas: number;
  cadence: "monthly" | string;
  startPayrollMonth: string;
  endPayrollMonth?: string | null;
  status: "active" | "paused" | "ended" | "cancelled" | string;
  reason: string;
  note?: string | null;
  sourceType: string;
  sourceRef?: string | null;
  createdByUid?: string | null;
  createdByEmail?: string | null;
  updatedByUid?: string | null;
  updatedByEmail?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CorePayrollObligationInstallment = {
  id: string;
  obligationId: string;
  sequenceNo: number;
  targetPayrollMonth: string;
  amountHalalas: number;
  status: "scheduled" | "applied" | "deferred" | "cancelled" | string;
  appliedPayrollEntryId?: string | null;
  appliedAt?: string | null;
  deferredFromInstallmentId?: string | null;
  supersededByInstallmentId?: string | null;
  decisionReason: string;
  note?: string | null;
  createdByUid?: string | null;
  createdByEmail?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CorePayrollObligation = {
  id: string;
  salonId: string;
  employeeId: string;
  recurringDeductionId?: string | null;
  obligationKind: string;
  sourceType: string;
  sourceRef?: string | null;
  originalPayrollMonth: string;
  originalAmountHalalas: number;
  remainingAmountHalalas: number;
  status: "open" | "scheduled" | "partially_settled" | "settled" | "cancelled" | string;
  reason: string;
  note?: string | null;
  cancelledByUid?: string | null;
  cancelledByEmail?: string | null;
  cancelledAt?: string | null;
  cancellationReason?: string | null;
  createdByUid?: string | null;
  createdByEmail?: string | null;
  createdAt: string;
  updatedAt: string;
  installments: CorePayrollObligationInstallment[];
};

export type CorePayrollObligationDeduction = Record<string, unknown> & {
  id: string;
  employeeId: string;
  kind: "payroll_obligation" | string;
  obligationKind: string;
  label: string;
  amountHalalas: number;
  direction: "deduction";
  sourceType: "payroll_obligation" | string;
  sourceRef: string;
  obligationId: string;
  installmentId: string;
  recurringDeductionId?: string | null;
  originalPayrollMonth: string;
  targetPayrollMonth: string;
  reason: string;
  note?: string | null;
  status?: string;
  sequenceNo?: number;
  synthetic?: boolean;
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
  insuranceDeductionHalalas?: number;
  gosiInsuranceCategory?: string | null;
  gosiPolicyVersion?: string | null;
  gosiContributoryWageHalalas?: number;
  employerGosiContributionHalalas?: number;
  gosiSnapshotJson?: string | null;
  gosiCalculatedAt?: string | null;
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
  uploadedByUid?: string | null;
  replacedByFileId?: string | null;
  replacesFileId?: string | null;
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
  /** @deprecated Kept only for old snapshots. The active policy is always zero. */
  earlyLeaveGraceMinutes: number;
  attendanceLockEnabled: boolean | number;
  attendanceLockAfterMinutes: number;
  overtimeAfterMinutes: number;
  active: boolean | number;
  createdAt?: string | null;
  updatedAt?: string | null;
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
  templateStartTime?: string | null;
  templateEndTime?: string | null;
  lateGraceMinutes?: number | null;
  /** @deprecated Kept only for old snapshots. */
  earlyLeaveGraceMinutes?: number | null;
  attendanceLockEnabled?: boolean | number | null;
  attendanceLockAfterMinutes?: number | null;
  overtimeAfterMinutes?: number | null;
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
  /** @deprecated Kept only for old snapshots. */
  earlyLeaveGraceMinutes?: number | null;
  early_leave_grace_minutes?: number | null;
  attendanceLockEnabled?: boolean | number | null;
  attendance_lock_enabled?: boolean | number | null;
  attendanceLockAfterMinutes?: number | null;
  attendance_lock_after_minutes?: number | null;
};


export type CoreShiftPayrollPeriodLock = {
  id: string;
  salonId: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  reason?: string | null;
  lockedByUid?: string | null;
  lockedAt?: string | null;
  unlockedByUid?: string | null;
  unlockedAt?: string | null;
};

export type CoreShiftPayrollAdjustment = {
  id: string;
  salonId: string;
  employeeId: string;
  changeType: string;
  sourceEntityType: string;
  sourceEntityId: string;
  dateFrom: string;
  dateTo: string;
  lockedPeriodsJson?: string | null;
  beforeJson?: string | null;
  afterJson?: string | null;
  reason?: string | null;
  status: string;
  createdAt?: string | null;
};

export type CoreShiftChangePreview = {
  employeeId?: string;
  employee_id?: string;
  changeType?: string;
  change_type?: string;
  dateFrom?: string;
  date_from?: string;
  dateTo?: string;
  date_to?: string;
  affectedDays?: number;
  affected_days?: number;
  lockedPeriodsCount?: number;
  locked_periods_count?: number;
  lockedPeriods?: unknown[];
  locked_periods?: unknown[];
  overlappingAssignmentsCount?: number;
  overlapping_assignments_count?: number;
  overlappingExceptionsCount?: number;
  overlapping_exceptions_count?: number;
  requiresAdjustment?: boolean;
  requires_adjustment?: boolean;
  payrollMonths?: string[];
  payroll_months?: string[];
};

export type CorePayrollCarryoverAdjustment = Record<string, unknown> & {
  id: string;
  salonId: string;
  employeeId: string;
  sourcePayrollMonth: string;
  targetPayrollMonth: string;
  sourcePayrollEntryId: string;
  sourceSnapshotId: string;
  direction: "addition" | "deduction";
  amountHalalas: number;
  approvedNetHalalas: number;
  recalculatedNetHalalas: number;
  reason: string;
  sourceDate?: string | null;
  status: "pending" | "applied" | "void" | string;
  targetPayrollEntryId?: string | null;
  appliedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};
