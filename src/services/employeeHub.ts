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
import { CoreHrService } from "./CoreHrService";
import { CoreWorkforceService } from "./CoreWorkforceService";
import {
  createManagedEmployeeRequest,
  listEmployeeRequests as listCoreEmployeeRequests,
  listMyEmployeeRequests,
  type EmployeeRequest as CoreEmployeeRequest,
} from "./employeeRequests";
import { listEmployeeDirectory as listCoreEmployeeDirectory } from "./employeeDirectory";

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
  specialties?: string[];
  specialtyLabels?: string[];
  bio?: string;
  showOnBooking?: boolean;
  onLeave?: boolean;
  leaveUntil?: string;
  employmentEndDate?: string;
  rating?: number;
  reviewsCount?: number;
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
  type?: "annual" | "sick" | "emergency" | "unpaid" | "rest" | "other";
  fromDate: string;
  toDate: string;
  days?: number;
  durationKind?: "full_day" | "partial";
  partialStartTime?: string;
  partialEndTime?: string;
  note?: string;
  status?: "pending" | "approved" | "rejected" | "cancelled";
  reviewerUid?: string;
  reviewerName?: string;
  createdByUid?: string;
  createdByName?: string;
  createdAt?: any;
  updatedAt?: any;
  reviewedAt?: any;
  requestNumber?: string;
  coreStatus?: string;
  coreVersion?: number;
  coreLeaveId?: string;
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

export type EmployeeNotification = {
  id: string;
  targetUid?: string;
  targetEmployeeId?: string;
  type?: "leave" | "file" | "message" | "system" | "payroll" | "employee_request";
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

export async function listEmployeeDirectory(_limitCount = 300): Promise<EmployeeDirectoryEntry[]> {
  return listCoreEmployeeDirectory();
}

export async function listRecruitmentApplications(limitCount = 100): Promise<RecruitmentApplication[]> {
  const rows = await CoreWorkforceService.listRecruitment(limitCount);
  return rows.map((row) => ({
    id: row.id,
    fullName: cleanText(row.full_name),
    email: cleanEmail(row.email),
    phone: cleanText(row.phone || "") || undefined,
    roleApplied: cleanText(row.role_applied || "") || undefined,
    status: row.status,
    notes: cleanText(row.notes || "") || undefined,
    message: cleanText(row.message || "") || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    reviewedAt: row.reviewed_at || undefined,
    reviewedByUid: cleanText(row.reviewed_by_uid || "") || undefined,
    hiredAt: row.hired_at || undefined,
    hiredByUid: cleanText(row.hired_by_uid || "") || undefined,
    hiredUid: cleanText(row.hired_uid || "") || undefined,
    hiredEmployeeId: cleanText(row.hired_employee_id || "") || undefined,
    source: cleanText(row.source || "") || undefined,
  }));
}

export async function createRecruitmentApplication(
  input: Omit<RecruitmentApplication, "id" | "createdAt" | "updatedAt" | "reviewedAt" | "reviewedByUid">
) {
  const row = await CoreWorkforceService.createRecruitment({
    fullName: input.fullName,
    email: input.email,
    phone: input.phone,
    roleApplied: input.roleApplied,
    status: input.status || "new",
    notes: input.notes,
    message: input.message,
    source: input.source || "manual",
  });
  return { id: row.id };
}

export async function updateRecruitmentApplication(
  id: string,
  patch: Partial<RecruitmentApplication> & { reviewedByUid?: string }
) {
  await CoreWorkforceService.updateRecruitment(id, {
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.fullName !== undefined ? { fullName: patch.fullName } : {}),
    ...(patch.email !== undefined ? { email: patch.email } : {}),
    ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
    ...(patch.roleApplied !== undefined ? { roleApplied: patch.roleApplied } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    ...(patch.message !== undefined ? { message: patch.message } : {}),
    ...(patch.source !== undefined ? { source: patch.source } : {}),
    ...(patch.reviewedAt !== undefined ? { reviewedAt: patch.reviewedAt } : {}),
    ...(patch.reviewedByUid !== undefined ? { reviewedByUid: patch.reviewedByUid } : {}),
    ...(patch.hiredAt !== undefined ? { hiredAt: patch.hiredAt } : {}),
    ...(patch.hiredByUid !== undefined ? { hiredByUid: patch.hiredByUid } : {}),
    ...(patch.hiredUid !== undefined ? { hiredUid: patch.hiredUid } : {}),
    ...(patch.hiredEmployeeId !== undefined ? { hiredEmployeeId: patch.hiredEmployeeId } : {}),
  });
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

export async function listEmployeeMessages(limitCount = 500): Promise<EmployeeMessage[]> {
  const rows = await CoreWorkforceService.listMessages(limitCount);
  return rows.map((row) => ({
    id: row.id,
    conversationId: cleanText(row.conversation_id),
    threadId: cleanText(row.thread_id || "") || undefined,
    senderUid: cleanText(row.sender_uid),
    senderName: cleanText(row.sender_name || "") || undefined,
    recipientUid: cleanText(row.recipient_uid),
    recipientName: cleanText(row.recipient_name || "") || undefined,
    body: cleanText(row.body),
    kind: row.kind,
    readBy: normalizeReadBy(row.read_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
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
  const row = await CoreWorkforceService.createMessage({
    conversationId: cleanText(input.conversationId),
    threadId: cleanText(input.threadId || input.conversationId),
    recipientUid: cleanText(input.recipientUid),
    recipientName: cleanText(input.recipientName || ""),
    body: cleanText(input.body),
    kind: input.kind || "hr_to_employee",
  });
  return { id: row.id };
}

export async function markEmployeeThreadRead(args: { conversationId: string; readerUid: string }) {
  const conversationId = cleanText(args.conversationId);
  if (!conversationId) return;
  await CoreWorkforceService.markThreadRead(conversationId);
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

function mapCoreAbsence(row: Awaited<ReturnType<typeof CoreHrService.listAbsences>>[number]): EmployeeAbsence {
  const rawType = cleanText(row.absenceType || "full_day").toLowerCase();
  const automaticLockAbsence = rawType === "automatic_check_in_lock";
  return {
    id: cleanText(row.id),
    employeeUid: cleanText(row.employeeUid || ""),
    employeeId: cleanText(row.employeeId || ""),
    date: cleanText(row.dateKey || ""),
    type: (automaticLockAbsence ? "full_day" : rawType) as EmployeeAbsence["type"],
    note:
      cleanText(row.note || "") ||
      (automaticLockAbsence ? "غياب تلقائي بعد انتهاء مهلة بصمة الحضور" : null),
    createdByUid: cleanText(row.createdByUid || ""),
    createdAt: row.createdAt,
    updatedAt: (row as any).updatedAt,
  };
}

export async function listEmployeeAbsences(limitCount = 80): Promise<EmployeeAbsence[]> {
  const rows = await CoreHrService.listAbsences();
  return sortEmployeeAbsences(rows.map(mapCoreAbsence)).slice(0, limitCount);
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

  const rows = await CoreHrService.listAbsences({ employeeId: employeeId || employeeUid });
  return sortEmployeeAbsences(rows.map(mapCoreAbsence))
    .filter((item) => {
      if (employeeId && item.employeeId !== employeeId && item.employeeUid !== employeeId) return false;
      if (employeeUid && item.employeeUid !== employeeUid && item.employeeId !== employeeUid) return false;
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

  return CoreHrService.createAbsence({
    employeeId: payload.employeeId,
    employeeUid: payload.employeeUid,
    date: payload.date,
    type: payload.type,
    note: payload.note || undefined,
    createdByName: cleanText(input.createdByName || "") || undefined,
    createdByUid: payload.createdByUid,
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
  durationKind?: "full_day" | "partial";
  partialStartTime?: string;
  partialEndTime?: string;
  createdByUid?: string;
  createdByName?: string;
}) {
  const employeeUid = cleanText(input.employeeUid);
  const employeeId = cleanText(input.employeeId || "");
  const employeeName = cleanText(input.employeeName || "");
  const fromDate = cleanText(input.fromDate);
  const toDate = cleanText(input.toDate);
  const note = cleanText(input.note || "");
  const createdByUid = cleanText(input.createdByUid || "");
  const createdByName = cleanText(input.createdByName || "");

  const durationKind =
    cleanText(input.durationKind).toLowerCase() === "partial"
      ? "partial"
      : "full_day";

  const partialStartTime =
    durationKind === "partial"
      ? cleanText(input.partialStartTime || "")
      : "";

  const partialEndTime =
    durationKind === "partial"
      ? cleanText(input.partialEndTime || "")
      : "";

  const days = Number(input.days);
  const hasDays =
    Number.isFinite(days) &&
    days > 0;

  const payload = {
    employeeUid,

    ...(employeeId
      ? { employeeId }
      : {}),

    ...(employeeName
      ? { employeeName }
      : {}),

    type:
      input.type ||
      "annual",

    fromDate,
    toDate,

    ...(hasDays
      ? { days }
      : {}),

    durationKind,

    ...(partialStartTime
      ? { partialStartTime }
      : {}),

    ...(partialEndTime
      ? { partialEndTime }
      : {}),

    ...(note
      ? { note }
      : {}),

    status: "pending",

    ...(createdByUid
      ? { createdByUid }
      : {}),

    ...(createdByName
      ? { createdByName }
      : {}),

    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  return addDoc(
    employeeLeaveRequestsCol(),
    payload
  );
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

export async function listEmployeeNotifications(args: {
  targetUid?: string;
  targetEmployeeId?: string;
  limitCount?: number;
}) {
  const rows = await CoreWorkforceService.listNotifications(Math.max(1, Number(args.limitCount || 50)));
  return rows.map((row): EmployeeNotification => ({
    id: row.id,
    targetUid: cleanText(row.target_uid || "") || undefined,
    targetEmployeeId: cleanText(row.target_employee_id || "") || undefined,
    type: row.type,
    title: cleanText(row.title),
    body: cleanText(row.body || "") || undefined,
    route: cleanText(row.route || "") || undefined,
    isRead: Boolean(row.read_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    readAt: row.read_at || undefined,
    readBy: row.read_by_uid ? [row.read_by_uid] : [],
  }));
}

export async function createEmployeeNotification(input: {
  targetUid?: string;
  targetEmployeeId?: string;
  type?: EmployeeNotification["type"];
  title: string;
  body?: string;
  route?: string;
}) {
  const row = await CoreWorkforceService.createNotification({
    targetUid: cleanText(input.targetUid || "") || undefined,
    targetEmployeeId: cleanText(input.targetEmployeeId || "") || undefined,
    type: input.type || "system",
    title: cleanText(input.title),
    body: cleanText(input.body || "") || undefined,
    route: cleanText(input.route || "") || undefined,
  });
  return { id: row.id };
}

export async function markEmployeeNotificationRead(args: { notificationId: string; readerUid: string }) {
  const notificationId = cleanText(args.notificationId);
  if (!notificationId) return;
  await CoreWorkforceService.markNotificationRead(notificationId);
}

export async function markEmployeeNotificationsRead(args: { notificationIds: string[]; readerUid: string }) {
  const ids = Array.from(new Set((Array.isArray(args.notificationIds) ? args.notificationIds : []).map(cleanText).filter(Boolean)));
  if (!ids.length) return;
  await Promise.all(ids.map((id) => CoreWorkforceService.markNotificationRead(id)));
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

function coreLeaveRequestStatus(status: unknown): EmployeeLeaveRequest["status"] {
  const normalized = cleanText(status).toLowerCase();
  if (normalized === "rejected") return "rejected";
  if (normalized === "cancelled") return "cancelled";
  if (["approved", "executing", "completed"].includes(normalized)) return "approved";
  return "pending";
}

function mapCoreLeaveRequest(row: CoreEmployeeRequest): EmployeeLeaveRequest {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : {};
  const fromDate = cleanText(payload.startDate || payload.fromDate);
  const toDate = cleanText(payload.endDate || payload.toDate) || fromDate;
  const explicitDays = Number(payload.days || payload.daysCount);
  let days = Number.isFinite(explicitDays) && explicitDays > 0 ? explicitDays : undefined;
  if (!days && fromDate && toDate) {
    const start = Date.parse(`${fromDate}T12:00:00Z`);
    const end = Date.parse(`${toDate}T12:00:00Z`);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      days = Math.floor((end - start) / 86400000) + 1;
    }
  }
  return {
    id: cleanText(row.id),
    employeeUid: cleanText(row.employee_uid || ""),
    employeeId: cleanText(row.employee_id || "") || undefined,
    employeeName: cleanText(row.employee_name_snapshot || "") || undefined,
    type: (cleanText(payload.leaveType || payload.type || "annual") || "annual") as EmployeeLeaveRequest["type"],
    fromDate,
    toDate,
    days,
    durationKind: cleanText(payload.durationKind).toLowerCase() === "partial" ? "partial" : "full_day",
    partialStartTime: cleanText(payload.partialStartTime || "") || undefined,
    partialEndTime: cleanText(payload.partialEndTime || "") || undefined,
    note: cleanText(payload.reason || payload.note || "") || undefined,
    status: coreLeaveRequestStatus(row.status),
    createdAt: row.submitted_at,
    updatedAt: row.updated_at,
    reviewedAt: row.approved_at || row.rejected_at || undefined,
    requestNumber: cleanText(row.request_number || "") || undefined,
    coreStatus: cleanText(row.status || "") || undefined,
    coreVersion: Number.isInteger(Number(row.version)) ? Number(row.version) : undefined,
    coreLeaveId:
      cleanText(row.source_reference_type || "") === "employee_leave"
        ? cleanText(row.source_reference_id || "") || undefined
        : undefined,
  };
}

export async function createManagedLeaveRequest(input: {
  employeeUid?: string;
  employeeId: string;
  employeeName?: string;
  type?: EmployeeLeaveRequest["type"];
  fromDate: string;
  toDate: string;
  note?: string;
  days?: number;
  durationKind?: "full_day" | "partial";
  partialStartTime?: string;
  partialEndTime?: string;
}) {
  const durationKind = cleanText(input.durationKind).toLowerCase() === "partial" ? "partial" : "full_day";
  const row = await createManagedEmployeeRequest({
    employeeId: cleanText(input.employeeId),
    employeeUid: cleanText(input.employeeUid || "") || undefined,
    employeeName: cleanText(input.employeeName || "") || undefined,
    requestType: "leave",
    title: "طلب إجازة",
    payload: {
      leaveType: cleanText(input.type || "annual") || "annual",
      startDate: cleanText(input.fromDate),
      endDate: cleanText(input.toDate),
      durationKind,
      ...(durationKind === "partial"
        ? {
            partialStartTime: cleanText(input.partialStartTime || ""),
            partialEndTime: cleanText(input.partialEndTime || ""),
          }
        : {}),
      reason: cleanText(input.note || "") || "تسجيل إجازة معتمدة من إدارة الموظفات",
      ...(Number.isFinite(Number(input.days)) && Number(input.days) > 0 ? { days: Number(input.days) } : {}),
    },
  });
  return mapCoreLeaveRequest(row);
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
    durationKind: cleanText(data?.durationKind || data?.duration_kind).toLowerCase() === "partial" ? "partial" : "full_day",
    partialStartTime: cleanText(data?.partialStartTime || data?.partial_start_time) || undefined,
    partialEndTime: cleanText(data?.partialEndTime || data?.partial_end_time) || undefined,
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

export async function listLeaveRequestsByEmployee(_employeeUid: string, limitCount = 24) {
  const rows = await listMyEmployeeRequests({ type: "leave", limit: Math.max(1, Number(limitCount || 24)) });
  return rows.map(mapCoreLeaveRequest);
}

export async function listEmployeeLeaveRequests(limitCount = 80): Promise<EmployeeLeaveRequest[]> {
  const rows = await listCoreEmployeeRequests({ type: "leave", limit: Math.max(1, Number(limitCount || 80)) });
  return rows.map(mapCoreLeaveRequest);
}

export async function approveEmployeeLeaveRequest(args: {
  requestId: string;
  reviewerUid: string;
  reviewerName?: string;
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

  // We'll capture minimal request data inside the transaction to optionally
  // apply a balance adjustment after the request is approved. We avoid
  // performing ledger operations inside the same transaction because
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
