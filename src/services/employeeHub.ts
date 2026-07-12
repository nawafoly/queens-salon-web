import {
  addDoc,
  arrayUnion,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

import { db } from "./firebase";
import { normalizeEmployeeFileRecord } from "../helpers/hr/employeeFiles";
import {
  buildEmployeeAbsencePayload,
  normalizeEmployeeAbsence,
  sortEmployeeAbsences,
} from "../helpers/hr/employeeAbsence";
import { normalizeEmployeeLeaveRequest } from "../helpers/hr/employeeLeave";
import { normalizeEmployeePayrollRecord } from "../helpers/hr/employeePayroll";
import {
  HR_COLLECTIONS,
  SALON_ID,
  hrCollection,
  hrDoc,
} from "./hrCollections";

export { HR_COLLECTIONS, SALON_ID };

export type EmployeeRole =
  | "owner"
  | "admin"
  | "hr"
  | "reception"
  | "staff"
  | "client"
  | "pending"
  | "guest";

export type EmployeeDirectoryEntry = {
  employeeId: string;
  employeeKey?: string;
  employeeUid?: string;
  employeeDocId?: string;
  linkedEmployeeDocId?: string;
  authUid?: string;
  userId?: string;
  name: string;
  email?: string;
  phone?: string;
  role?: EmployeeRole | string;
  active?: boolean;
  linkedUid?: string;
  employeeProfileEnabled?: boolean;
  department?: string;
  title?: string;
  avatarUrl?: string;
  employmentSource?: "salon" | "partner" | string;
  partnerId?: string;
  partnerMemberId?: string;
  partnerName?: string;
  contractId?: string;
  resourceIds?: string[];
  source?: "api" | "firestore";
};

export type RecruitmentApplication = {
  id: string;
  fullName: string;
  email: string;
  phone?: string;
  roleApplied?: string;
  status?: "new" | "reviewing" | "interview" | "accepted" | "rejected" | "hired";
  notes?: string;
  message?: string;
  createdAt?: any;
  updatedAt?: any;
  reviewedAt?: any;
  reviewedByUid?: string;
  hiredAt?: any;
  hiredByUid?: string;
  hiredUid?: string;
  hiredEmployeeId?: string;
  source?: string;
};

export type EmployeeMessage = {
  id: string;
  conversationId: string;
  threadId?: string;
  senderUid: string;
  senderName?: string;
  recipientUid: string;
  recipientName?: string;
  body: string;
  kind?: "hr_to_employee" | "employee_to_employee" | "system";
  readBy?: string[];
  createdAt?: any;
  updatedAt?: any;
};

export type EmployeeFile = {
  id: string;
  employeeUid: string;
  employeeId?: string;
  direction?: "inbound" | "outbound";
  title: string;
  fileType?: string;
  fileName?: string;
  mimeType?: string;
  storageKey?: string;
  storageUrl?: string;
  notes?: string;
  status?: "active" | "replaced" | "read" | "archived";
  createdByUid?: string;
  createdByName?: string;
  createdAt?: any;
  updatedAt?: any;
  readBy?: string[];
};

export type EmployeeLeaveRequest = {
  id: string;
  employeeUid: string;
  employeeId?: string;
  employeeName?: string;
  type?: "annual" | "sick" | "emergency" | "unpaid" | "other";
  fromDate: string;
  toDate: string;
  days?: number;
  note?: string;
  status?: "pending" | "approved" | "rejected" | "cancelled";
  reviewerUid?: string;
  reviewerName?: string;
  createdByUid?: string;
  createdByName?: string;
  createdAt?: any;
  updatedAt?: any;
  reviewedAt?: any;
};

export type EmployeeAbsence = {
  id: string;
  employeeUid: string;
  employeeId: string;
  employeeName?: string;
  date: string;
  type: "full_day" | "half_day";
  note?: string | null;
  createdByUid: string;
  createdByName?: string;
  createdAt?: any;
  updatedAt?: any;
};

export type EmployeePayrollRecord = {
  id: string;
  employeeUid: string;
  employeeId?: string;
  monthKey: string;
  baseSalary?: number;
  overtime?: number;
  delay?: number;
  insurance?: number;
  deductions?: number;
  absencePenalties?: number;
  total?: number;
  salary?: number;
  attachedDocumentUrl?: string;
  attachedDocumentName?: string;
  createdAt?: any;
  updatedAt?: any;
  createdByUid?: string;
  createdByName?: string;
};

export type EmployeeNotification = {
  id: string;
  targetUid?: string;
  targetEmployeeId?: string;
  type?: "leave" | "file" | "message" | "system" | "payroll";
  title: string;
  body?: string;
  route?: string;
  isRead?: boolean;
  createdAt?: any;
  updatedAt?: any;
  readAt?: any;
  readBy?: string[];
};

export type WeeklyReportRecord = {
  id: string;
  recipientUid?: string;
  recipientEmail?: string;
  title: string;
  periodFrom?: string;
  periodTo?: string;
  wordFileUrl?: string;
  excelFileUrl?: string;
  createdAt?: any;
  updatedAt?: any;
  createdByUid?: string;
};

type EmployeeRoleInput = EmployeeRole | string | null | undefined;

function cleanText(value: unknown) {
  return String(value || "").trim();
}

function cleanEmail(value: unknown) {
  return cleanText(value).toLowerCase();
}

function normalizeRole(role: EmployeeRoleInput): EmployeeRole {
  const raw = cleanText(role).toLowerCase();
  if (raw === "owner") return "owner";
  if (raw === "admin") return "admin";
  if (raw === "hr") return "hr";
  if (raw === "reception") return "reception";
  if (raw === "staff") return "staff";
  if (raw === "client") return "client";
  if (raw === "pending") return "pending";
  return "guest";
}

function normalizedBool(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  return fallback;
}

function normalizeReadBy(value: unknown) {
  return Array.from(
    new Set(
      (Array.isArray(value) ? value : [])
        .map((x) => cleanText(x))
        .filter(Boolean)
    )
  );
}

function toMillis(value: unknown) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof value === "object") {
    const maybe = value as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
    if (typeof maybe.toMillis === "function") {
      const ms = maybe.toMillis();
      return Number.isFinite(ms) ? ms : 0;
    }
    if (typeof maybe.seconds === "number") {
      return maybe.seconds * 1000 + Math.floor((maybe.nanoseconds || 0) / 1_000_000);
    }
  }
  return 0;
}

function normalizeDirectoryEntry(data: any, id: string, source: "api" | "firestore"): EmployeeDirectoryEntry {
  return {
    employeeId: cleanText(data?.employeeId || id),
    employeeKey: cleanText(data?.employeeKey || data?.linkedUid || data?.uid || id) || undefined,
    name: cleanText(data?.name || data?.displayName || ""),
    email: cleanEmail(data?.email || data?.userEmail || ""),
    phone: cleanText(data?.phone || ""),
    role: normalizeRole(data?.role),
    active: data?.active !== false,
    linkedUid: cleanText(data?.linkedUid || data?.uid || data?.linkedUserId || "") || undefined,
    employeeProfileEnabled: data?.employeeProfileEnabled !== false,
    department: cleanText(data?.department || "") || undefined,
    title: cleanText(data?.title || "") || undefined,
    avatarUrl: cleanText(data?.avatarUrl || data?.photoURL || data?.photoUrl || "") || undefined,
    source,
  };
}

export function usersCol() {
  return hrCollection("users");
}

export function employeesCol() {
  return hrCollection("employees");
}

export function adminUsersCol() {
  return hrCollection("adminUsers");
}

export function employeeMessagesCol() {
  return hrCollection("employeeMessages");
}

export function employeeFilesCol() {
  return hrCollection("employeeFiles");
}

export function employeeLeaveRequestsCol() {
  return hrCollection("employeeLeaveRequests");
}

export function employeeAbsencesCol() {
  return hrCollection("employeeAbsences");
}

export function employeePayrollRecordsCol() {
  return hrCollection("employeePayrollRecords");
}

export function notificationsCol() {
  return hrCollection("notifications");
}

export function weeklyReportsCol() {
  return hrCollection("weeklyReports");
}

export function jobApplicationsCol() {
  return hrCollection("jobApplications");
}

export function employeeDoc(id: string) {
  return hrDoc("employees", cleanText(id));
}

export function userDoc(id: string) {
  return hrDoc("users", cleanText(id));
}

export function adminUserDoc(id: string) {
  return hrDoc("adminUsers", cleanText(id));
}

export async function listEmployeeDirectory(limitCount = 300): Promise<EmployeeDirectoryEntry[]> {
  const snap = await getDocs(query(employeesCol(), orderBy("name", "asc"), limit(limitCount)));
  return snap.docs
    .map((d) => normalizeDirectoryEntry(d.data(), d.id, "firestore"))
    .filter((x) => !!x.employeeId);
}

export async function listRecruitmentApplications(limitCount = 100): Promise<RecruitmentApplication[]> {
  const snap = await getDocs(query(jobApplicationsCol(), orderBy("createdAt", "desc"), limit(limitCount)));
  return snap.docs.map((d) => {
    const data = d.data() as any;
    return {
      id: d.id,
      fullName: cleanText(data?.fullName || data?.name || ""),
      email: cleanEmail(data?.email || ""),
      phone: cleanText(data?.phone || ""),
      roleApplied: cleanText(data?.roleApplied || data?.role || "") || undefined,
      status: (cleanText(data?.status || "new").toLowerCase() as RecruitmentApplication["status"]) || "new",
      notes: cleanText(data?.notes || "") || undefined,
      message: cleanText(data?.message || "") || undefined,
      createdAt: data?.createdAt,
      updatedAt: data?.updatedAt,
      reviewedAt: data?.reviewedAt,
      reviewedByUid: cleanText(data?.reviewedByUid || "") || undefined,
      hiredAt: data?.hiredAt,
      hiredByUid: cleanText(data?.hiredByUid || "") || undefined,
      hiredUid: cleanText(data?.hiredUid || "") || undefined,
      hiredEmployeeId: cleanText(data?.hiredEmployeeId || "") || undefined,
      source: cleanText(data?.source || "") || undefined,
    };
  });
}

export async function createRecruitmentApplication(
  input: Omit<RecruitmentApplication, "id" | "createdAt" | "updatedAt" | "reviewedAt" | "reviewedByUid">
) {
  return addDoc(jobApplicationsCol(), {
    fullName: cleanText(input.fullName),
    email: cleanEmail(input.email),
    phone: cleanText(input.phone || ""),
    roleApplied: cleanText(input.roleApplied || ""),
    status: input.status || "new",
    notes: cleanText(input.notes || ""),
    message: cleanText(input.message || ""),
    source: cleanText(input.source || "manual"),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateRecruitmentApplication(
  id: string,
  patch: Partial<RecruitmentApplication> & { reviewedByUid?: string }
) {
  const ref = hrDoc("jobApplications", cleanText(id));
  await updateDoc(ref, {
    ...patch,
    updatedAt: serverTimestamp(),
  } as any);
}

export async function syncEmployeeRecordFromUser(args: {
  uid: string;
  email: string;
  displayName: string;
  phone?: string;
  role: EmployeeRoleInput;
  active?: boolean;
  employeeId?: string;
  linkedEmployeeDocId?: string;
  specialties?: string[];
  bio?: string;
  department?: string;
  title?: string;
  avatarUrl?: string;
  showOnAbout?: boolean;
  showOnBooking?: boolean;
  employeeProfileEnabled?: boolean;
  employmentSource?: "salon" | "partner";
  partnerId?: string;
  partnerMemberId?: string;
  partnerName?: string;
  contractId?: string;
  resourceIds?: string[];
}) {
  const uid = cleanText(args.uid);
  const employeeId = cleanText(args.employeeId || args.linkedEmployeeDocId || uid);
  const email = cleanEmail(args.email);
  const displayName = cleanText(args.displayName);
  const phone = cleanText(args.phone || "");
  const role = normalizeRole(args.role);
  const active = args.active !== false;
  const isStaffLike = ["owner", "admin", "hr", "reception", "staff"].includes(role);
  const isPublicStaff = role === "staff";

  const employeeProfileEnabled = args.employeeProfileEnabled ?? isStaffLike;
  const showOnAbout = args.showOnAbout ?? isPublicStaff;
  const showOnBooking = args.showOnBooking ?? isPublicStaff;
  const specialties = Array.isArray(args.specialties)
    ? args.specialties.map((x) => cleanText(x)).filter(Boolean)
    : [];
  const userRef = hrDoc("users", uid);
  let shouldSetUserCreatedAt = true;

  try {
    const existingUser = await getDoc(userRef);
    shouldSetUserCreatedAt = !existingUser.exists() || !(existingUser.data() as any)?.createdAt;
  } catch {
    shouldSetUserCreatedAt = true;
  }

  const employeeDocData = {
    uid,
    linkedUid: uid,
    linkedUserId: uid,
    employeeId,
    linkedEmployeeDocId: employeeId,
    email,
    userEmail: email,
    name: displayName,
    displayName,
    phone,
    role,
    active,
    isActive: active,
    employeeProfileEnabled,
    showOnAbout,
    showOnBooking,
    removedFromStaff: false,
    employmentStatus: active ? "active" : "inactive",
    department: cleanText(args.department || "") || "",
    title: cleanText(args.title || "") || "",
    avatarUrl: cleanText(args.avatarUrl || "") || "",
    specialties,
    bio: cleanText(args.bio || "") || "",
    employmentSource: args.employmentSource || "salon",
    partnerId: cleanText(args.partnerId || "") || null,
    partnerMemberId: cleanText(args.partnerMemberId || "") || null,
    partnerName: cleanText(args.partnerName || "") || null,
    contractId: cleanText(args.contractId || "") || null,
    resourceIds: Array.isArray(args.resourceIds) ? args.resourceIds.map(cleanText).filter(Boolean) : [],
    updatedAt: serverTimestamp(),
  };

  const userDocData = {
    uid,
    email,
    displayName,
    name: displayName,
    phone,
    role,
    active,
    employeeId,
    linkedEmployeeDocId: employeeId,
    employeeProfileEnabled,
    employmentSource: args.employmentSource || "salon",
    partnerId: cleanText(args.partnerId || "") || null,
    partnerMemberId: cleanText(args.partnerMemberId || "") || null,
    ...(shouldSetUserCreatedAt ? { createdAt: serverTimestamp() } : {}),
    updatedAt: serverTimestamp(),
  };

  const staffPublicData = {
    uid,
    linkedUid: uid,
    linkedUserId: uid,
    email,
    userEmail: email,
    name: displayName,
    displayName,
    phone,
    role,
    active,
    isActive: active,
    showOnAbout,
    showOnBooking,
    employeeProfileEnabled,
    removedFromStaff: false,
    employmentStatus: active ? "active" : "inactive",
    specialties,
    bio: cleanText(args.bio || "") || "",
    avatarUrl: cleanText(args.avatarUrl || "") || "",
    employeeId,
    employmentSource: args.employmentSource || "salon",
    partnerId: cleanText(args.partnerId || "") || null,
    partnerMemberId: cleanText(args.partnerMemberId || "") || null,
    partnerName: cleanText(args.partnerName || "") || null,
    contractId: cleanText(args.contractId || "") || null,
    resourceIds: Array.isArray(args.resourceIds) ? args.resourceIds.map(cleanText).filter(Boolean) : [],
    updatedAt: serverTimestamp(),
  };

  await Promise.all([
    setDoc(userRef, userDocData, { merge: true }),
    setDoc(hrDoc("employees", employeeId), employeeDocData, { merge: true }),
    isStaffLike
      ? setDoc(
          hrDoc("adminUsers", uid),
          {
            uid,
            email,
            displayName,
            phone,
            role,
            active,
            employeeId,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        )
      : Promise.resolve(),
    setDoc(hrDoc("staffPublic", employeeId), staffPublicData, {
      merge: true,
    }),
  ]);

  return { uid, employeeId, role, active };
}

export async function syncPartnerEmployeeRecord(args: {
  partnerId: string;
  partnerMemberId: string;
  partnerName?: string;
  displayName: string;
  email?: string;
  phone?: string;
  userUid?: string;
  active?: boolean;
  contractId?: string;
  resourceIds?: string[];
}) {
  const partnerId = cleanText(args.partnerId);
  const partnerMemberId = cleanText(args.partnerMemberId);
  if (!partnerId || !partnerMemberId) throw new Error("partner_employee:invalid_link");

  const employeeId = `partner-${partnerMemberId}`;
  const uid = cleanText(args.userUid || "");
  const active = args.active !== false;
  const shared = {
    employeeId,
    employeeDocId: employeeId,
    linkedEmployeeDocId: employeeId,
    ...(uid ? { uid, linkedUid: uid, linkedUserId: uid, employeeUid: uid } : {}),
    name: cleanText(args.displayName),
    displayName: cleanText(args.displayName),
    email: cleanEmail(args.email || ""),
    userEmail: cleanEmail(args.email || ""),
    phone: cleanText(args.phone || ""),
    role: "staff",
    active,
    isActive: active,
    employmentStatus: active ? "active" : "inactive",
    employeeProfileEnabled: true,
    showOnAbout: false,
    showOnBooking: true,
    removedFromStaff: false,
    employmentSource: "partner",
    partnerId,
    partnerMemberId,
    partnerName: cleanText(args.partnerName || "") || null,
    contractId: cleanText(args.contractId || "") || null,
    resourceIds: Array.isArray(args.resourceIds) ? args.resourceIds.map(cleanText).filter(Boolean) : [],
    department: "فريق شريك",
    title: "موظف شريك",
    updatedAt: serverTimestamp(),
  };

  await Promise.all([
    setDoc(hrDoc("employees", employeeId), shared, { merge: true }),
    setDoc(hrDoc("staffPublic", employeeId), shared, { merge: true }),
    uid
      ? Promise.all([
          setDoc(hrDoc("users", uid), { ...shared, createdAt: serverTimestamp() }, { merge: true }),
          setDoc(hrDoc("adminUsers", uid), shared, { merge: true }),
        ])
      : Promise.resolve(),
  ]);

  return { employeeId, uid: uid || undefined };
}

export async function linkExistingEmployeeRecordToPartner(args: {
  employeeId: string;
  employeeUid?: string;
  partnerId: string;
  partnerMemberId: string;
  partnerName?: string;
  contractId?: string;
  resourceIds?: string[];
}) {
  const employeeId = cleanText(args.employeeId);
  const employeeUid = cleanText(args.employeeUid || "");
  const partnerId = cleanText(args.partnerId);
  const partnerMemberId = cleanText(args.partnerMemberId);
  if (!employeeId || !partnerId || !partnerMemberId) {
    throw new Error("partner_employee:invalid_existing_link");
  }

  const patch = {
    employmentSource: "partner",
    partnerId,
    partnerMemberId,
    partnerName: cleanText(args.partnerName || "") || null,
    contractId: cleanText(args.contractId || "") || null,
    resourceIds: Array.isArray(args.resourceIds) ? args.resourceIds.map(cleanText).filter(Boolean) : [],
    updatedAt: serverTimestamp(),
  };

  await Promise.all([
    setDoc(hrDoc("employees", employeeId), patch, { merge: true }),
    setDoc(hrDoc("staffPublic", employeeId), patch, { merge: true }),
    employeeUid ? setDoc(hrDoc("users", employeeUid), { ...patch, employeeId }, { merge: true }) : Promise.resolve(),
  ]);

  return { employeeId, employeeUid: employeeUid || undefined };
}

export async function createEmployeeMessage(input: {
  conversationId: string;
  threadId?: string;
  senderUid: string;
  senderName?: string;
  recipientUid: string;
  recipientName?: string;
  body: string;
  kind?: EmployeeMessage["kind"];
}) {
  return addDoc(employeeMessagesCol(), {
    conversationId: cleanText(input.conversationId),
    threadId: cleanText(input.threadId || input.conversationId),
    senderUid: cleanText(input.senderUid),
    senderName: cleanText(input.senderName || ""),
    recipientUid: cleanText(input.recipientUid),
    recipientName: cleanText(input.recipientName || ""),
    body: cleanText(input.body),
    kind: input.kind || "hr_to_employee",
    readBy: [cleanText(input.senderUid)],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function markEmployeeThreadRead(args: { conversationId: string; readerUid: string }) {
  const conversationId = cleanText(args.conversationId);
  const readerUid = cleanText(args.readerUid);
  if (!conversationId || !readerUid) return;

  const snap = await getDocs(query(employeeMessagesCol(), where("conversationId", "==", conversationId)));
  if (!snap.size) return;

  const batch = writeBatch(db);
  snap.docs.forEach((d) => {
    const data = d.data() as any;
    const readBy = normalizeReadBy(data?.readBy);
    if (readBy.includes(readerUid)) return;
    batch.update(d.ref, {
      readBy: Array.from(new Set([...readBy, readerUid])),
      updatedAt: serverTimestamp(),
    });
  });
  await batch.commit();
}

function normalizeEmployeeFileDirection(value: unknown): EmployeeFile["direction"] {
  const normalized = cleanText(value).toLowerCase();
  if (normalized === "incoming" || normalized === "inbound") return "inbound";
  if (normalized === "outgoing" || normalized === "outbound") return "outbound";
  return "outbound";
}

function mapEmployeeFileDoc(d: any, viewerUid?: string | null): EmployeeFile {
  const data = d.data() as any;
  const normalized = normalizeEmployeeFileRecord(
    d.id,
    {
      ...data,
      fileUrl: data?.storageUrl || data?.fileUrl,
      filePath: data?.storageKey || data?.filePath,
      contentType: data?.mimeType || data?.contentType,
    },
    viewerUid
  );

  return {
    id: normalized.id,
    employeeUid: cleanText(normalized.employeeUid || data?.employeeUid || ""),
    employeeId: cleanText(normalized.employeeId || data?.employeeId || "") || undefined,
    direction: normalizeEmployeeFileDirection(data?.direction || normalized.direction),
    title: cleanText(normalized.title || data?.title || "Untitled"),
    fileType: cleanText(normalized.fileType || data?.fileType || "") || undefined,
    fileName: cleanText(normalized.fileName || data?.fileName || "") || undefined,
    mimeType: cleanText(normalized.mimeType || data?.mimeType || "") || undefined,
    storageKey: cleanText(data?.storageKey || normalized.filePath || "") || undefined,
    storageUrl: cleanText(data?.storageUrl || normalized.fileUrl || normalized.viewUrl || "") || undefined,
    notes: cleanText(data?.notes || normalized.description || "") || undefined,
    status: cleanText(normalized.status || data?.status || "active") as EmployeeFile["status"],
    createdByUid: cleanText(data?.createdByUid || normalized.uploadedBy || "") || undefined,
    createdByName: cleanText(data?.createdByName || normalized.uploadedByName || "") || undefined,
    createdAt: normalized.createdAt ?? data?.createdAt,
    updatedAt: normalized.updatedAt ?? data?.updatedAt,
    readBy: normalizeReadBy(data?.readBy),
  };
}

export async function listEmployeeFiles(limitCount = 120): Promise<EmployeeFile[]> {
  const snap = await getDocs(query(employeeFilesCol(), orderBy("createdAt", "desc"), limit(limitCount)));
  return snap.docs.map((d) => mapEmployeeFileDoc(d));
}

export async function listEmployeeFilesByEmployee(args: {
  employeeUid?: string;
  employeeId?: string;
  limitCount?: number;
}): Promise<EmployeeFile[]> {
  const employeeUid = cleanText(args.employeeUid || "");
  const employeeId = cleanText(args.employeeId || "");
  const limitCount = Math.max(1, Number(args.limitCount || 80));
  if (!employeeUid && !employeeId) return [];

  const [uidSnap, employeeIdSnap] = await Promise.all([
    employeeUid ? getDocs(query(employeeFilesCol(), where("employeeUid", "==", employeeUid), limit(limitCount))) : Promise.resolve(null),
    employeeId ? getDocs(query(employeeFilesCol(), where("employeeId", "==", employeeId), limit(limitCount))) : Promise.resolve(null),
  ]);

  const docsById = new Map<string, any>();
  uidSnap?.docs.forEach((d) => docsById.set(d.id, d));
  employeeIdSnap?.docs.forEach((d) => docsById.set(d.id, d));

  return Array.from(docsById.values())
    .map((d) => mapEmployeeFileDoc(d, employeeUid || null))
    .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
    .slice(0, limitCount);
}

export async function createEmployeeFileRecord(input: {
  employeeUid: string;
  employeeId?: string;
  direction?: EmployeeFile["direction"];
  title: string;
  fileName?: string;
  mimeType?: string;
  storageKey?: string;
  storageUrl?: string;
  notes?: string;
  status?: EmployeeFile["status"];
  createdByUid?: string;
  createdByName?: string;
}) {
  return addDoc(employeeFilesCol(), {
    employeeUid: cleanText(input.employeeUid),
    employeeId: cleanText(input.employeeId || "") || undefined,
    direction: input.direction || "outbound",
    title: cleanText(input.title),
    fileType: "general",
    fileName: cleanText(input.fileName || "") || undefined,
    mimeType: cleanText(input.mimeType || "") || undefined,
    contentType: cleanText(input.mimeType || "") || undefined,
    storageKey: cleanText(input.storageKey || "") || undefined,
    storageUrl: cleanText(input.storageUrl || "") || undefined,
    filePath: cleanText(input.storageKey || "") || undefined,
    fileUrl: cleanText(input.storageUrl || "") || undefined,
    notes: cleanText(input.notes || "") || undefined,
    description: cleanText(input.notes || "") || undefined,
    status: input.status || "active",
    createdByUid: cleanText(input.createdByUid || "") || undefined,
    createdByName: cleanText(input.createdByName || "") || undefined,
    uploadedBy: cleanText(input.createdByUid || "") || undefined,
    uploadedByName: cleanText(input.createdByName || "") || undefined,
    readBy: [],
    createdAt: serverTimestamp(),
    uploadedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

function mapEmployeeAbsenceDoc(d: any): EmployeeAbsence {
  const data = d.data() as any;
  const normalized = normalizeEmployeeAbsence(d.id, data);
  return {
    id: normalized.id,
    employeeUid: cleanText(normalized.employeeUid || data?.employeeUid || ""),
    employeeId: cleanText(normalized.employeeId || data?.employeeId || ""),
    employeeName: cleanText(data?.employeeName || data?.displayName || "") || undefined,
    date: cleanText(normalized.date || data?.date || ""),
    type: cleanText(normalized.type || data?.type || "full_day") as EmployeeAbsence["type"],
    note: cleanText(normalized.note || data?.note || "") || null,
    createdByUid: cleanText(normalized.createdByUid || data?.createdByUid || ""),
    createdByName: cleanText(data?.createdByName || data?.createdByDisplayName || "") || undefined,
    createdAt: normalized.createdAt ?? data?.createdAt,
    updatedAt: data?.updatedAt,
  };
}

export async function listEmployeeAbsences(limitCount = 80): Promise<EmployeeAbsence[]> {
  const snap = await getDocs(query(employeeAbsencesCol(), orderBy("createdAt", "desc"), limit(limitCount)));
  return sortEmployeeAbsences(snap.docs.map(mapEmployeeAbsenceDoc)).slice(0, limitCount);
}

export async function listEmployeeAbsencesByEmployee(args: {
  employeeUid?: string;
  employeeId?: string;
  fromDate?: string;
  toDate?: string;
  limitCount?: number;
}): Promise<EmployeeAbsence[]> {
  const employeeUid = cleanText(args.employeeUid || "");
  const employeeId = cleanText(args.employeeId || "");
  const fromDate = cleanText(args.fromDate || "");
  const toDate = cleanText(args.toDate || "");
  const limitCount = Math.max(1, Number(args.limitCount || 120));
  if (!employeeUid && !employeeId) return [];

  const [uidSnap, employeeIdSnap] = await Promise.all([
    employeeUid ? getDocs(query(employeeAbsencesCol(), where("employeeUid", "==", employeeUid), limit(limitCount))) : Promise.resolve(null),
    employeeId ? getDocs(query(employeeAbsencesCol(), where("employeeId", "==", employeeId), limit(limitCount))) : Promise.resolve(null),
  ]);

  const docsById = new Map<string, any>();
  uidSnap?.docs.forEach((d) => docsById.set(d.id, d));
  employeeIdSnap?.docs.forEach((d) => docsById.set(d.id, d));

  return sortEmployeeAbsences(Array.from(docsById.values()).map(mapEmployeeAbsenceDoc))
    .filter((item) => {
      if (fromDate && item.date < fromDate) return false;
      if (toDate && item.date > toDate) return false;
      return true;
    })
    .slice(0, limitCount);
}

export async function createEmployeeAbsenceRecord(input: {
  employeeUid: string;
  employeeId?: string;
  employeeName?: string;
  date: string;
  type?: EmployeeAbsence["type"];
  note?: string;
  createdByUid: string;
  createdByName?: string;
}) {
  const payload = buildEmployeeAbsencePayload({
    employeeId: cleanText(input.employeeId || input.employeeUid),
    employeeUid: cleanText(input.employeeUid),
    date: cleanText(input.date),
    type: input.type || "full_day",
    note: input.note,
    createdByUid: cleanText(input.createdByUid),
  });

  return addDoc(employeeAbsencesCol(), {
    ...payload,
    employeeName: cleanText(input.employeeName || "") || undefined,
    createdByName: cleanText(input.createdByName || "") || undefined,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function createLeaveRequest(input: {
  employeeUid: string;
  employeeId?: string;
  employeeName?: string;
  type?: EmployeeLeaveRequest["type"];
  fromDate: string;
  toDate: string;
  note?: string;
  days?: number;
  createdByUid?: string;
  createdByName?: string;
}) {
  return addDoc(employeeLeaveRequestsCol(), {
    employeeUid: cleanText(input.employeeUid),
    employeeId: cleanText(input.employeeId || "") || undefined,
    employeeName: cleanText(input.employeeName || "") || undefined,
    type: input.type || "annual",
    fromDate: cleanText(input.fromDate),
    toDate: cleanText(input.toDate),
    days: Number.isFinite(Number(input.days)) ? Number(input.days) : undefined,
    note: cleanText(input.note || "") || undefined,
    status: "pending",
    createdByUid: cleanText(input.createdByUid || "") || undefined,
    createdByName: cleanText(input.createdByName || "") || undefined,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function reviewLeaveRequest(args: {
  requestId: string;
  status: "approved" | "rejected" | "cancelled";
  reviewerUid: string;
  reviewerName?: string;
}) {
  const ref = hrDoc("employeeLeaveRequests", cleanText(args.requestId));
  const snap = await getDoc(ref);
  const data = snap.exists() ? (snap.data() as any) : null;
  await updateDoc(ref, {
    status: args.status,
    reviewerUid: cleanText(args.reviewerUid),
    reviewerName: cleanText(args.reviewerName || "") || undefined,
    reviewedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  } as any);

  const targetUid = cleanText(data?.employeeUid || "") || undefined;
  const targetEmployeeId = cleanText(data?.employeeId || "") || undefined;
  if (targetUid || targetEmployeeId) {
    await createEmployeeNotification({
      targetUid,
      targetEmployeeId,
      type: "leave",
      title:
        args.status === "approved"
          ? "تمت الموافقة على الإجازة"
          : args.status === "rejected"
            ? "تم رفض الإجازة"
            : "تم تحديث الإجازة",
      body: `${cleanText(data?.fromDate || "")} → ${cleanText(data?.toDate || "")}`,
      route: "/employee/leave",
    }).catch(() => {});
  }
}

export async function createPayrollRecord(input: {
  employeeUid: string;
  employeeId?: string;
  monthKey: string;
  baseSalary?: number;
  overtime?: number;
  delay?: number;
  insurance?: number;
  deductions?: number;
  absencePenalties?: number;
  total?: number;
  salary?: number;
  attachedDocumentUrl?: string;
  attachedDocumentName?: string;
  createdByUid?: string;
  createdByName?: string;
}) {
  const id = `${cleanText(input.employeeUid)}__${cleanText(input.monthKey)}`;
  await setDoc(
    hrDoc("employeePayrollRecords", id),
    {
      employeeUid: cleanText(input.employeeUid),
      employeeId: cleanText(input.employeeId || "") || undefined,
      monthKey: cleanText(input.monthKey),
      baseSalary: Number(input.baseSalary || 0),
      overtime: Number(input.overtime || 0),
      delay: Number(input.delay || 0),
      insurance: Number(input.insurance || 0),
      deductions: Number(input.deductions || 0),
      absencePenalties: Number(input.absencePenalties || 0),
      total: Number(input.total || 0),
      salary: Number(input.salary || 0),
      attachedDocumentUrl: cleanText(input.attachedDocumentUrl || "") || undefined,
      attachedDocumentName: cleanText(input.attachedDocumentName || "") || undefined,
      createdByUid: cleanText(input.createdByUid || "") || undefined,
      createdByName: cleanText(input.createdByName || "") || undefined,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  if (cleanText(input.employeeUid)) {
    await createEmployeeNotification({
      targetUid: cleanText(input.employeeUid),
      targetEmployeeId: cleanText(input.employeeId || "") || undefined,
      type: "payroll",
      title: `تم تحديث مسير الرواتب ${cleanText(input.monthKey)}`,
      body: cleanText(
        input.total != null
          ? `تم حفظ تفاصيل الرواتب لهذا الشهر بقيمة ${Number(input.total || 0).toLocaleString("ar-SA")}.`
          : "تمت إضافة أو تحديث مسير الرواتب."
      ),
      route: "/employee/payroll",
    }).catch(() => {});
  }
}

export async function listEmployeeNotifications(args: {
  targetUid?: string;
  targetEmployeeId?: string;
  limitCount?: number;
}) {
  const targetUid = cleanText(args.targetUid || "");
  const targetEmployeeId = cleanText(args.targetEmployeeId || "");
  const limitCount = Math.max(1, Number(args.limitCount || 50));

  const mapDoc = (d: any): EmployeeNotification => {
    const data = d.data() as any;
    return {
      id: d.id,
      targetUid: cleanText(data?.targetUid || "") || undefined,
      targetEmployeeId: cleanText(data?.targetEmployeeId || "") || undefined,
      type: cleanText(data?.type || "system") as EmployeeNotification["type"],
      title: cleanText(data?.title || ""),
      body: cleanText(data?.body || "") || undefined,
      route: cleanText(data?.route || "") || undefined,
      isRead: normalizedBool(data?.isRead, false),
      createdAt: data?.createdAt,
      updatedAt: data?.updatedAt,
      readAt: data?.readAt,
      readBy: normalizeReadBy(data?.readBy),
    } as EmployeeNotification;
  };

  if (targetUid || targetEmployeeId) {
    const [uidSnap, employeeIdSnap] = await Promise.all([
      targetUid ? getDocs(query(notificationsCol(), where("targetUid", "==", targetUid))) : Promise.resolve(null),
      targetEmployeeId
        ? getDocs(query(notificationsCol(), where("targetEmployeeId", "==", targetEmployeeId)))
        : Promise.resolve(null),
    ]);

    const deduped = new Map<string, EmployeeNotification>();
    uidSnap?.docs.forEach((d) => deduped.set(d.id, mapDoc(d)));
    employeeIdSnap?.docs.forEach((d) => deduped.set(d.id, mapDoc(d)));

    return Array.from(deduped.values())
      .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
      .slice(0, limitCount);
  }

  const snap = await getDocs(query(notificationsCol(), orderBy("createdAt", "desc"), limit(limitCount)));
  return snap.docs.map(mapDoc);
}

export async function createEmployeeNotification(input: {
  targetUid?: string;
  targetEmployeeId?: string;
  type?: EmployeeNotification["type"];
  title: string;
  body?: string;
  route?: string;
}) {
  return addDoc(notificationsCol(), {
    targetUid: cleanText(input.targetUid || "") || undefined,
    targetEmployeeId: cleanText(input.targetEmployeeId || "") || undefined,
    type: input.type || "system",
    title: cleanText(input.title),
    body: cleanText(input.body || "") || undefined,
    route: cleanText(input.route || "") || undefined,
    isRead: false,
    readBy: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function markEmployeeNotificationRead(args: { notificationId: string; readerUid: string }) {
  const notificationId = cleanText(args.notificationId);
  const readerUid = cleanText(args.readerUid);
  if (!notificationId || !readerUid) return;

  await updateDoc(hrDoc("notifications", notificationId), {
    isRead: true,
    readAt: serverTimestamp(),
    readBy: arrayUnion(readerUid),
    updatedAt: serverTimestamp(),
  } as any);
}

export async function markEmployeeNotificationsRead(args: { notificationIds: string[]; readerUid: string }) {
  const readerUid = cleanText(args.readerUid);
  const ids = Array.from(
    new Set(
      (Array.isArray(args.notificationIds) ? args.notificationIds : [])
        .map((id) => cleanText(id))
        .filter(Boolean)
    )
  );
  if (!readerUid || !ids.length) return;

  const batch = writeBatch(db);
  ids.forEach((notificationId) => {
    batch.update(hrDoc("notifications", notificationId), {
      isRead: true,
      readAt: serverTimestamp(),
      readBy: arrayUnion(readerUid),
      updatedAt: serverTimestamp(),
    } as any);
  });
  await batch.commit();
}

export async function markEmployeeFileRead(args: { fileId: string; readerUid: string }) {
  const fileId = cleanText(args.fileId);
  const readerUid = cleanText(args.readerUid);
  if (!fileId || !readerUid) return;

  await updateDoc(hrDoc("employeeFiles", fileId), {
    readBy: arrayUnion(readerUid),
    updatedAt: serverTimestamp(),
  } as any);
}

export async function markEmployeeFilesRead(args: {
  employeeUid?: string;
  employeeId?: string;
  readerUid: string;
}) {
  const employeeUid = cleanText(args.employeeUid || "");
  const employeeId = cleanText(args.employeeId || "");
  const readerUid = cleanText(args.readerUid);
  if (!readerUid || (!employeeUid && !employeeId)) return;

  const [uidSnap, employeeIdSnap] = await Promise.all([
    employeeUid ? getDocs(query(employeeFilesCol(), where("employeeUid", "==", employeeUid))) : Promise.resolve(null),
    employeeId ? getDocs(query(employeeFilesCol(), where("employeeId", "==", employeeId))) : Promise.resolve(null),
  ]);

  const docsById = new Map<string, any>();
  uidSnap?.docs.forEach((d) => docsById.set(d.id, d));
  employeeIdSnap?.docs.forEach((d) => docsById.set(d.id, d));

  if (!docsById.size) return;

  const batch = writeBatch(db);
  let touched = 0;
  docsById.forEach((d) => {
    const data = d.data() as any;
    const readBy = normalizeReadBy(data?.readBy);
    if (readBy.includes(readerUid)) return;
    batch.update(d.ref, {
      readBy: arrayUnion(readerUid),
      updatedAt: serverTimestamp(),
    } as any);
    touched += 1;
  });

  if (touched) {
    await batch.commit();
  }
}

export async function createWeeklyReport(input: {
  recipientUid?: string;
  recipientEmail?: string;
  title: string;
  periodFrom?: string;
  periodTo?: string;
  wordFileUrl?: string;
  excelFileUrl?: string;
  createdByUid?: string;
}) {
  return addDoc(weeklyReportsCol(), {
    recipientUid: cleanText(input.recipientUid || "") || undefined,
    recipientEmail: cleanEmail(input.recipientEmail || "") || undefined,
    title: cleanText(input.title),
    periodFrom: cleanText(input.periodFrom || "") || undefined,
    periodTo: cleanText(input.periodTo || "") || undefined,
    wordFileUrl: cleanText(input.wordFileUrl || "") || undefined,
    excelFileUrl: cleanText(input.excelFileUrl || "") || undefined,
    createdByUid: cleanText(input.createdByUid || "") || undefined,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function listPayrollRecordsByEmployee(employeeUid: string, limitCount = 24) {
  const snap = await getDocs(query(employeePayrollRecordsCol(), where("employeeUid", "==", cleanText(employeeUid))));

  return snap.docs
    .map((d) => {
      const data = d.data() as any;
      const normalized = normalizeEmployeePayrollRecord(d.id, {
        ...data,
        payrollMonth: data?.payrollMonth || data?.monthKey,
        finalSalary: data?.finalSalary ?? data?.total ?? data?.salary,
      });
      return {
        id: normalized.id,
        employeeUid: cleanText(normalized.employeeUid || data?.employeeUid || ""),
        employeeId: cleanText(normalized.employeeId || data?.employeeId || "") || undefined,
        monthKey: cleanText(data?.monthKey || normalized.payrollMonth || ""),
        baseSalary: Number(normalized.baseSalary || 0),
        overtime: Number(data?.overtime ?? normalized.overtimeBonus ?? 0),
        delay: Number(data?.delay ?? normalized.delayDeduction ?? 0),
        insurance: Number(data?.insurance ?? normalized.insuranceDeduction ?? 0),
        deductions: Number(data?.deductions ?? normalized.totalSalaryDeductions ?? 0),
        absencePenalties: Number(data?.absencePenalties ?? normalized.absenceDeduction ?? 0),
        total: Number(data?.total ?? normalized.finalSalary ?? 0),
        salary: Number(data?.salary ?? normalized.finalSalary ?? 0),
        attachedDocumentUrl: cleanText(data?.attachedDocumentUrl || normalized.mudadDocumentViewUrl || "") || undefined,
        attachedDocumentName: cleanText(data?.attachedDocumentName || normalized.mudadDocument?.fileName || "") || undefined,
        createdAt: normalized.createdAt ?? data?.createdAt,
        updatedAt: data?.updatedAt,
        createdByUid: cleanText(data?.createdByUid || "") || undefined,
        createdByName: cleanText(data?.createdByName || "") || undefined,
      } as EmployeePayrollRecord;
    })
    .sort((a, b) => cleanText(b.monthKey).localeCompare(cleanText(a.monthKey)) || toMillis(b.createdAt) - toMillis(a.createdAt))
    .slice(0, limitCount);
}

function mapEmployeeLeaveRequestDoc(d: any): EmployeeLeaveRequest {
  const data = d.data() as any;
  const normalized = normalizeEmployeeLeaveRequest(d.id, {
    ...data,
    leaveType: data?.leaveType || data?.type,
    startDate: data?.startDate || data?.fromDate,
    endDate: data?.endDate || data?.toDate,
    daysCount: data?.daysCount ?? data?.days,
    employeeNote: data?.employeeNote || data?.note,
    reviewedBy: data?.reviewedBy || data?.reviewerUid,
    reviewedByName: data?.reviewedByName || data?.reviewerName,
  });
  return {
    id: normalized.id,
    employeeUid: cleanText(normalized.employeeUid || data?.employeeUid || ""),
    employeeId: cleanText(normalized.employeeId || normalized.employeeDocId || data?.employeeId || "") || undefined,
    employeeName: cleanText(normalized.employeeName || data?.employeeName || "") || undefined,
    type: cleanText(normalized.leaveType || data?.type || "annual") as EmployeeLeaveRequest["type"],
    fromDate: cleanText(data?.fromDate || normalized.startDate || ""),
    toDate: cleanText(data?.toDate || normalized.endDate || ""),
    days: Number.isFinite(Number(normalized.daysCount)) ? Number(normalized.daysCount) : undefined,
    note: cleanText(normalized.employeeNote || data?.note || "") || undefined,
    status: cleanText(normalized.status || data?.status || "pending") as EmployeeLeaveRequest["status"],
    reviewerUid: cleanText(normalized.reviewedBy || data?.reviewerUid || "") || undefined,
    reviewerName: cleanText(normalized.reviewedByName || data?.reviewerName || "") || undefined,
    createdByUid: cleanText(data?.createdByUid || "") || undefined,
    createdByName: cleanText(data?.createdByName || "") || undefined,
    createdAt: normalized.createdAt ?? data?.createdAt,
    updatedAt: normalized.updatedAt ?? data?.updatedAt,
    reviewedAt: normalized.reviewedAt ?? data?.reviewedAt,
  };
}

export async function listLeaveRequestsByEmployee(employeeUid: string, limitCount = 24) {
  const snap = await getDocs(query(employeeLeaveRequestsCol(), where("employeeUid", "==", cleanText(employeeUid))));

  return snap.docs
    .map(mapEmployeeLeaveRequestDoc)
    .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt) || cleanText(b.fromDate).localeCompare(cleanText(a.fromDate)))
    .slice(0, limitCount);
}

export async function listEmployeeLeaveRequests(limitCount = 80): Promise<EmployeeLeaveRequest[]> {
  const snap = await getDocs(query(employeeLeaveRequestsCol(), orderBy("createdAt", "desc"), limit(limitCount)));

  return snap.docs
    .map(mapEmployeeLeaveRequestDoc)
    .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt) || cleanText(b.fromDate).localeCompare(cleanText(a.fromDate)))
    .slice(0, limitCount);
}

export async function approveEmployeeLeaveRequest(args: {
  requestId: string;
  reviewerUid: string;
  reviewerName?: string;
  adjustLeaveBalance?: boolean;
}) {
  const requestId = cleanText(args.requestId);
  const reviewerUid = cleanText(args.reviewerUid);
  if (!requestId || !reviewerUid) return;

  let leaveNotification: {
    targetUid?: string;
    targetEmployeeId?: string;
    title: string;
    body?: string;
    route: string;
  } | null = null;

  await runTransaction(db, async (tx) => {
    const reqRef = hrDoc("employeeLeaveRequests", requestId);
    const reqSnap = await tx.get(reqRef);
    if (!reqSnap.exists()) return;
    const data = reqSnap.data() as any;

    tx.update(reqRef, {
      status: "approved",
      reviewerUid,
      reviewerName: cleanText(args.reviewerName || "") || undefined,
      reviewedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    leaveNotification = {
      targetUid: cleanText(data?.employeeUid || "") || undefined,
      targetEmployeeId: cleanText(data?.employeeId || "") || undefined,
      title: "تمت الموافقة على طلب الإجازة",
      body: `${cleanText(data?.fromDate || "")} → ${cleanText(data?.toDate || "")}`,
      route: "/employee/leave",
    };
  });

  const notificationData = leaveNotification as
    | {
        targetUid?: string;
        targetEmployeeId?: string;
        title: string;
        body?: string;
        route: string;
      }
    | null;
  if (notificationData) {
    await createEmployeeNotification({
      targetUid: notificationData.targetUid,
      targetEmployeeId: notificationData.targetEmployeeId,
      type: "leave",
      title: notificationData.title,
      body: notificationData.body,
      route: notificationData.route,
    }).catch(() => {});
  }
}
