import { collection, doc } from "firebase/firestore";

import { db } from "./firebase";

export const SALON_ID = "main" as const;

type HrCollectionPath = readonly ["salons", typeof SALON_ID, string];

export const HR_COLLECTIONS = {
  users: ["salons", SALON_ID, "users"],
  employees: ["salons", SALON_ID, "employees"],
  staff: ["salons", SALON_ID, "staff"],
  staffPublic: ["salons", SALON_ID, "staff_public"],
  adminUsers: ["salons", SALON_ID, "admin_users"],
  adminUsernames: ["salons", SALON_ID, "admin_usernames"],
  attendance: ["salons", SALON_ID, "attendance"],
  attendanceRecords: ["salons", SALON_ID, "attendance_records"],
  employeeMessages: ["salons", SALON_ID, "employee_messages"],
  employeeFiles: ["salons", SALON_ID, "employee_files"],
  employeeLeaveRequests: ["salons", SALON_ID, "employee_leave_requests"],
  employeeAbsences: ["salons", SALON_ID, "employee_absences"],
  notifications: ["salons", SALON_ID, "notifications"],
  weeklyReports: ["salons", SALON_ID, "weekly_reports"],
  jobApplications: ["salons", SALON_ID, "job_applications"],
  workSchedules: ["salons", SALON_ID, "work_schedules"],
  workZones: ["salons", SALON_ID, "work_zones"],
} as const satisfies Record<string, HrCollectionPath>;

export type HrCollectionKey = keyof typeof HR_COLLECTIONS;
export type { HrCollectionPath };

export function hrCollection<K extends HrCollectionKey>(key: K) {
  const [root, salonId, collectionName] = HR_COLLECTIONS[key];
  return collection(db, root, salonId, collectionName);
}

export function hrDoc<K extends HrCollectionKey>(key: K, id: string) {
  const [root, salonId, collectionName] = HR_COLLECTIONS[key];
  return doc(db, root, salonId, collectionName, String(id || "").trim());
}

export function hrCollectionPath<K extends HrCollectionKey>(key: K) {
  return HR_COLLECTIONS[key];
}

export function staffAttendanceCollection(
  employeeId: string,
  salonId: string = SALON_ID
) {
  return collection(
    db,
    "salons",
    String(salonId || SALON_ID).trim() || SALON_ID,
    "staff",
    String(employeeId || "").trim(),
    "attendance"
  );
}

export function staffAttendanceDoc(
  employeeId: string,
  date: string,
  salonId: string = SALON_ID
) {
  return doc(
    db,
    "salons",
    String(salonId || SALON_ID).trim() || SALON_ID,
    "staff",
    String(employeeId || "").trim(),
    "attendance",
    String(date || "").trim()
  );
}
