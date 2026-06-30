export const EMPLOYEE_AVATAR_CATEGORY = "employee_avatar" as const;
export const EMPLOYEE_FILES_COLLECTION = "employee_files" as const;
export const EMPLOYEE_FILE_CATEGORY = "employee_file" as const;
export const EMPLOYEE_MESSAGES_COLLECTION = "employee_messages" as const;
export const EMPLOYEE_NOTIFICATIONS_COLLECTION = "notifications" as const;
export const EMPLOYEE_ABSENCES_COLLECTION = "employee_absences" as const;
export const EMPLOYEE_PAYROLL_RECORDS_COLLECTION =
  "employee_payroll_records" as const;
export const EMPLOYEE_DEFAULT_FILE_TYPE = "general" as const;
export const EMPLOYEE_FILE_STATUS_ACTIVE = "active" as const;
export const EMPLOYEE_FILE_STATUS_REPLACED = "replaced" as const;
export const EMPLOYEE_CONVERSATION_TYPES = [
  "hr_to_employee",
  "employee_to_employee",
] as const;
export const EMPLOYEE_MESSAGE_TYPES = ["message", "notice", "system"] as const;
export const EMPLOYEE_NOTIFICATION_TYPES = [
  "leave",
  "file",
  "message",
  "system",
] as const;
export const EMPLOYEE_FILE_TYPES = [
  EMPLOYEE_DEFAULT_FILE_TYPE,
  "contract",
  "warning",
  "letter",
  "cv",
  "education_certificate",
] as const;
export const EMPLOYEE_FILE_STATUSES = [
  EMPLOYEE_FILE_STATUS_ACTIVE,
  EMPLOYEE_FILE_STATUS_REPLACED,
] as const;
export const EMPLOYEE_ABSENCE_TYPES = ["full_day", "half_day"] as const;

export type EmployeeAvatarDoc = {
  id?: string | null;
  fileName?: string | null;
  filePath?: string | null;
  fileUrl?: string | null;
  contentType?: string | null;
  fileSize?: number | null;
  uploadedAt?: unknown;
};

export type EmployeePersonalDoc = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  avatar?: EmployeeAvatarDoc | null;
};

export type EmployeeEmploymentStatus =
  | "active"
  | "probation"
  | "on_leave"
  | "inactive"
  | "suspended"
  | "terminated"
  | string;

export type EmployeeWorkScheduleDoc = {
  startTime?: string | null;
  endTime?: string | null;
  weeklyOffDays?: string[] | null;
};

export type EmployeeEmploymentDoc = {
  title?: string | null;
  jobTitle?: string | null;
  department?: string | null;
  startDate?: unknown;
  leaveBalance?: number | null;

  baseSalary?: number | null;
  housingAllowance?: number | null;
  transportationAllowance?: number | null;
  otherAllowances?: number | null;
  allowances?: number | null;
  expectedWorkDays?: number | null;
  expectedWorkHours?: number | null;
  actualWorkedHours?: number | null;
  workSchedule?: EmployeeWorkScheduleDoc | null;
  shiftStartTime?: string | null;
  shiftEndTime?: string | null;

  calculatedDailyRate?: number | null;

  hoursDifference?: number | null;
  overtimeHours?: number | null;
  missingHours?: number | null;

  overtimeHourlyRate?: number | null;
  calculatedHourlyRate?: number | null;
  calculatedOvertimeAmount?: number | null;
  calculatedMissingDeduction?: number | null;

  insuranceDeduction?: number | null;
  totalSalaryDeductions?: number | null;
  calculatedGrossSalary?: number | null;
  calculatedNetSalary?: number | null;

  salaryDeductions?: Array<{
    id?: string;
    title?: string;
    amount?: number;
  }> | null;

  status?: EmployeeEmploymentStatus | null;
  employmentStatus?: EmployeeEmploymentStatus | null;
  employeeCode?: string | null;
  fingerprintNumber?: string | null;
  allowedZoneIds?: string[] | null;
  adminNotes?: string | null;
  updatedAt?: unknown;
  updatedByUid?: string | null;
  updatedByEmail?: string | null;
};

export type EmployeeProfileDoc = {
  personal?: EmployeePersonalDoc | null;
  employment?: EmployeeEmploymentDoc | null;
};

export type EmployeeFileType = (typeof EMPLOYEE_FILE_TYPES)[number] | string;
export type EmployeeFileStatus =
  | (typeof EMPLOYEE_FILE_STATUSES)[number]
  | string;
export type EmployeeConversationType =
  | (typeof EMPLOYEE_CONVERSATION_TYPES)[number]
  | string;
export type EmployeeMessageType =
  | (typeof EMPLOYEE_MESSAGE_TYPES)[number]
  | string;
export type EmployeeMessageRole = "employee" | "hr" | "system" | string;
export type EmployeeMessageStatus = "sent" | "read" | string;
export type EmployeeNotificationType =
  | (typeof EMPLOYEE_NOTIFICATION_TYPES)[number]
  | string;
export type EmployeeAbsenceType =
  | (typeof EMPLOYEE_ABSENCE_TYPES)[number]
  | string;

export type EmployeeFileDoc = {
  employeeId: string;
  employeeUid: string;
  userId?: string | null;
  employeeName?: string | null;
  senderUid?: string | null;
  senderName?: string | null;
  senderEmail?: string | null;
  senderPhoto?: string | null;
  receiverUid?: string | null;
  receiverName?: string | null;
  receiverEmail?: string | null;
  receiverPhoto?: string | null;
  participantUids?: string[] | null;
  title: string;
  description?: string | null;
  fileType?: EmployeeFileType | null;
  fileId?: string | null;
  fileName: string;
  filePath?: string | null;
  fileUrl: string;
  storageKey?: string | null;
  contentType?: string | null;
  mimeType?: string | null;
  fileSize?: number | null;
  category?: string | null;
  officialDocument?: boolean | null;
  uploadedBy?: string | null;
  uploadedByName?: string | null;
  createdAt?: unknown;
  uploadedAt?: unknown;
  status?: EmployeeFileStatus | null;
  active?: boolean | null;
  replacedAt?: unknown | null;
  replacedBy?: string | null;
  replacedByName?: string | null;
  replacedByFileId?: string | null;
  replacesFileId?: string | null;
  isRead: boolean;
  readAt?: unknown | null;
  updatedAt?: unknown;
};

export type EmployeeMessageDoc = {
  employeeId?: string | null;
  employeeUid?: string | null;
  conversationId?: string | null;
  threadId?: string | null;
  conversationType?: EmployeeConversationType | null;
  participantUids?: string[] | null;
  senderUid?: string | null;
  senderRole?: EmployeeMessageRole | null;
  recipientUid?: string | null;
  messageType?: EmployeeMessageType | null;
  body?: string | null;
  status?: EmployeeMessageStatus | null;
  fromUserId: string;
  fromUserName?: string | null;
  fromUserEmail?: string | null;
  fromUserPhoto?: string | null;
  toUserId: string;
  toUserName?: string | null;
  toUserEmail?: string | null;
  toUserPhoto?: string | null;
  message: string;
  type?: EmployeeMessageType | null;
  relatedTo?: string | null;
  relatedId?: string | null;
  createdAt?: unknown;
  isRead: boolean;
  readAt?: unknown | null;
  updatedAt?: unknown;
};

export type EmployeeNotificationDoc = {
  userId: string;
  uid?: string | null;
  targetUid?: string | null;
  title: string;
  body?: string | null;
  message?: string | null;
  type?: EmployeeNotificationType | null;
  relatedTo?: string | null;
  relatedId?: string | null;
  relatedPath?: string | null;
  createdAt?: unknown;
  isRead: boolean;
  readAt?: unknown | null;
  updatedAt?: unknown;
};

export type EmployeeAbsenceDoc = {
  employeeId: string;
  employeeUid: string;
  date: string;
  type: EmployeeAbsenceType;
  note?: string | null;
  createdAt?: unknown;
  createdByUid: string;
};

export type EmployeePayrollRecordDoc = {
  employeeId: string;
  employeeUid: string;
  payrollMonth: string;
  monthStart: string;
  monthEnd: string;
  calculationStartDate?: string | null;
  calculationEndDate?: string | null;
  baseSalary: number;
  housingAllowance?: number | null;
  transportationAllowance?: number | null;
  otherAllowances?: number | null;
  allowances?: number | null;
  absenceDays: number;
  absenceDeduction: number;
  expectedWorkHours?: number | null;
  actualWorkedHours?: number | null;
  attendanceLateHours?: number | null;
  attendanceMissingHours?: number | null;
  attendanceOvertimeHours?: number | null;
  attendanceCompleteDays?: number | null;
  attendanceIncompleteDays?: number | null;
  attendanceAbsentDays?: number | null;
  attendanceAbsenceDeduction?: number | null;
  scheduleSnapshot?: EmployeeWorkScheduleDoc | null;
  delayDeduction?: number | null;
  overtimeBonus?: number | null;
  insuranceDeduction?: number | null;
  salaryDeductions?: Array<{
    id?: string;
    title?: string;
    amount?: number;
  }> | null;
  totalSalaryDeductions?: number | null;
  absenceEntries?: Array<{
    date: string;
    type: EmployeeAbsenceType;
    note?: string | null;
  }> | null;
  finalSalary: number;
  mudadDocument?: {
    id?: string | null;
    fileName?: string | null;
    filePath?: string | null;
    fileUrl?: string | null;
    contentType?: string | null;
    fileSize?: number | null;
    uploadedAt?: unknown;
    uploadedBy?: string | null;
  } | null;
  createdAt?: unknown;
  createdByUid?: string | null;
  createdByEmail?: string | null;
};

export type EmployeeLeaveRequestStatus = "pending" | "approved" | "rejected";

export type EmployeeLeaveType =
  | "annual"
  | "sick"
  | "emergency"
  | "unpaid"
  | "other"
  | string;

export type EmployeeLeaveRequestDoc = {
  employeeId?: string | null;
  employeeDocId?: string | null;
  employeeUid: string;
  userId?: string | null;
  employeeName?: string | null;
  employeeEmail?: string | null;
  status: EmployeeLeaveRequestStatus;
  leaveType: EmployeeLeaveType;
  startDate: unknown;
  endDate: unknown;
  daysCount: number | null;
  employeeNote?: string | null;
  hrNote?: string | null;
  createdAt?: unknown;
  decidedAt?: unknown;
  decidedBy?: string | null;
  decidedByEmail?: string | null;
  decidedByName?: string | null;
  reviewedAt?: unknown;
  reviewedBy?: string | null;
  reviewedByEmail?: string | null;
  reviewedByName?: string | null;
  updatedAt?: unknown;
};

export type EmployeeServiceRequestStatus = "pending" | "approved" | "rejected";

export type EmployeeServiceRequestType =
  | "attendance_correction"
  | "permission"
  | "overtime"
  | "salary_advance"
  | "resignation"
  | "exit_reentry"
  | "letter"
  | string;

export type EmployeeServiceRequestDoc = {
  employeeId?: string | null;
  employeeDocId?: string | null;
  employeeUid: string;
  userId?: string | null;
  employeeName?: string | null;
  employeeEmail?: string | null;
  status: EmployeeServiceRequestStatus;
  requestType: EmployeeServiceRequestType;
  title?: string | null;
  requestDate?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  amount?: number | null;
  letterType?: string | null;
  employeeNote?: string | null;
  hrNote?: string | null;
  createdAt?: unknown;
  decidedAt?: unknown;
  decidedBy?: string | null;
  decidedByEmail?: string | null;
  decidedByName?: string | null;
  reviewedAt?: unknown;
  reviewedBy?: string | null;
  reviewedByEmail?: string | null;
  reviewedByName?: string | null;
  updatedAt?: unknown;
};
