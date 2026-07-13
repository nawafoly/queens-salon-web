// src/pages/settings/SettingsUsers.tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  getIdTokenResult,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  getAuth,
  signOut,
  updateProfile,
} from "firebase/auth";
import { initializeApp, getApps } from "firebase/app";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

import { auth, db } from "../../services/firebase";
import { writeAuditLog } from "../../services/logService";
import {
  APP_PERMISSION_CATALOG,
  APP_PERMISSION_GROUPS,
  PERMISSION_SCHEMA_VERSION,
  VISIBLE_APP_PERMISSION_CATALOG,
  buildPermissionOverrides,
  getEffectiveAppPermissions,
  getRoleAppPermissions,
  normalizePermissionOverrides,
  type AppPermission,
  type PermissionOverrides,
} from "../../helpers/permissions";
import {
  findStaffMatchesForUser,
  listStaffLinkRows,
  repairLegacyStaffUserLinks,
  type AccountUserLinkRow,
} from "../../services/staffAccountLinkService";
import { SettingsPageHeader, SettingsState } from "./SettingsFrame";
import EmployeeAvatar from "../../components/EmployeeAvatar";

/* =========================
   Roles helpers
========================= */
type UiRole =
  | "owner"
  | "admin"
  | "hr"
  | "reception"
  | "staff"
  | "pending"
  | "client"
  | "guest";

function mapFirestoreRoleToUi(roleRaw: string): UiRole {
  const role = String(roleRaw || "").toLowerCase().trim();
  if (role === "owner") return "owner";
  if (role === "admin") return "admin";
  if (role === "hr") return "hr";
  if (role === "reception") return "reception";
  if (role === "staff") return "staff";
  if (role === "pending") return "pending";
  if (role === "client") return "client";
  return "guest";
}

function toFirestoreRole(role: UiRole) {
  const r = String(role || "guest").toLowerCase().trim();
  if (r === "owner") return "owner";
  if (r === "admin") return "admin";
  if (r === "hr") return "hr";
  if (r === "reception") return "reception";
  if (r === "staff") return "staff";
  if (r === "pending") return "pending";
  if (r === "client") return "client";
  return "guest";
}

/* =========================
   Secondary Auth (create user)
========================= */
function getSecondaryAuth() {
  const options = (auth as any)?.app?.options;
  if (!options) throw new Error("Missing Firebase app options from auth.app.options");

  const name = "secondary-auth-app";
  const app = getApps().find((a) => a.name === name) || initializeApp(options, name);
  return getAuth(app);
}

/* =========================
   Collections
========================= */
const SALON_ID = "main";
const USERS_COLLECTION = ["salons", SALON_ID, "users"] as const;
const STAFF_PUBLIC_COLLECTION = ["salons", SALON_ID, "staff_public"] as const;
const EMPLOYEES_COLLECTION = ["salons", SALON_ID, "employees"] as const;

/* =========================
   Types
========================= */
type UserRow = {
  uid: string;
  email: string;
  phone?: string;
  displayName: string;
  role: UiRole;
  active: boolean;
  isActive?: boolean;
  archived?: boolean;
  deleted?: boolean;
  removedFromStaff?: boolean;
  employmentStatus?: string;
  employeeName?: string;
  department?: string;
  jobTitle?: string;
  startDate?: string;
  fingerprintNo?: string;
  employeeNo?: string;
  avatarUrl?: string;
  cvUrl?: string;
  baseSalary?: number;
  housingAllowance?: number;
  transportAllowance?: number;
  otherAllowances?: number;
  insuranceDeduction?: number;
  monthlySalary?: number;
  workDaysPerMonth?: number;
  monthlyHours?: number;
  staffSource?: Record<string, unknown>;
  employeeSource?: Record<string, unknown>;
  notes?: string;
  linkedEmployeeDocId?: string;
  employeeId?: string;
  permissions?: AppPermission[];
  permissionOverrides?: PermissionOverrides;
  permissionVersion?: number;
  deletedAt?: any;
  deletedBy?: any;
  createdAt?: any;
  updatedAt?: any;
};

type AccountState = "active" | "inactive" | "pending" | "archived" | "deleted";
type AccountStatusFilter = "all" | AccountState;
type AccountLinkFilter = "all" | "linked" | "unlinked" | "incomplete";

type EditUserDraft = {
  uid: string;
  displayName: string;
  email: string;
  phone: string;
  role: UiRole;
  active: boolean;
  notes: string;
  permissions: AppPermission[];
};

type InviteRow = {
  id: string;
  email: string;
  role: UiRole;
  active: boolean;
  notes?: string;
  createdAt?: any;
  used?: boolean;
  usedAt?: any;
  usedByUid?: string;
  createdByUid?: string;
  createdByEmail?: string;
};

type InviteDraft = {
  email: string;
  role: UiRole;
  notes: string;
};

const PERMISSION_META = VISIBLE_APP_PERMISSION_CATALOG;
const ALL_PERMISSION_META = APP_PERMISSION_CATALOG;

const ROLE_LABELS: Record<UiRole, string> = {
  owner: "المالك",
  admin: "الإدارة",
  hr: "الموارد البشرية",
  reception: "الاستقبال",
  staff: "الموظفات",
  pending: "قيد المراجعة",
  client: "عميلة",
  guest: "ضيف",
};

const ROLE_TONES: Record<UiRole, string> = {
  owner: "gold",
  admin: "amber",
  hr: "mint",
  reception: "blue",
  staff: "slate",
  pending: "gray",
  client: "gray",
  guest: "gray",
};

type SettingsUsersProps = {
  initialRole?: UiRole | string;
  authReady?: boolean;
  allowAdminManageUsers?: boolean;
};

export default function SettingsUsers({
  initialRole,
  authReady,
  allowAdminManageUsers: allowAdminManageUsersOverride,
}: SettingsUsersProps = {}) {
  const location = useLocation();
  const navigate = useNavigate();
  const isAdminShell = location.pathname.startsWith("/admin");
  const pageTitle = isAdminShell ? "إدارة الحسابات الإدارية" : "إدارة الحسابات";
  const pageHint = isAdminShell
    ? "مراجعة الحسابات الإدارية وصلاحياتها من لوحة الموارد البشرية."
    : "إنشاء حسابات الموظفات ومراجعة الصلاحيات من تبويب الإعدادات.";

  const [uiRole, setUiRole] = useState<UiRole>(mapFirestoreRoleToUi(initialRole ?? "guest"));
  const [authLoading, setAuthLoading] = useState(() => (typeof authReady === "boolean" ? !authReady : true));
  const authRequestIdRef = useRef(0);
  const authResolvedRef = useRef(false);

  useEffect(() => {
    if (typeof initialRole === "string") {
      setUiRole(mapFirestoreRoleToUi(initialRole));
    }
  }, [initialRole]);

  useEffect(() => {
    if (typeof authReady === "boolean") {
      setAuthLoading(!authReady);
    }
  }, [authReady]);

  const isOwner = uiRole === "owner";
  const isAdmin = uiRole === "admin";
  const isHr = uiRole === "hr";

  // ✅ نقرأ allowAdminManageUsers من localStorage لكن “يتحدّث” مع settingsChanged
  const [allowAdminManageUsersState, setAllowAdminManageUsersState] = useState(false);

  const readAllowAdminManageUsers = () => {
    try {
      const raw = localStorage.getItem("dashboard_settings_v1");
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      return Boolean(parsed?.policies?.allowAdminManageUsers);
    } catch {
      return false;
    }
  };

  useEffect(() => {
    if (typeof allowAdminManageUsersOverride === "boolean") {
      setAllowAdminManageUsersState(allowAdminManageUsersOverride);
      return;
    }

    // init
    setAllowAdminManageUsersState(readAllowAdminManageUsers());

    // live updates (Dashboard يرسل settingsChanged)
    const onSettingsChanged = () => {
      setAllowAdminManageUsersState(readAllowAdminManageUsers());
    };
    window.addEventListener("settingsChanged", onSettingsChanged);
    return () => window.removeEventListener("settingsChanged", onSettingsChanged);
  }, [allowAdminManageUsersOverride]);

  const allowAdminManageUsers =
    typeof allowAdminManageUsersOverride === "boolean"
      ? allowAdminManageUsersOverride
      : allowAdminManageUsersState;

  const [actorPermissions, setActorPermissions] = useState<AppPermission[]>(() =>
    getRoleAppPermissions(mapFirestoreRoleToUi(initialRole ?? "guest") as any)
  );

  const canManageUsers = useMemo(() => {
    return isOwner || actorPermissions.includes("admin_accounts.manage") || (isAdmin && allowAdminManageUsers);
  }, [isOwner, isAdmin, allowAdminManageUsers, actorPermissions]);

  const canManagePermissions = useMemo(() => {
    return isOwner || actorPermissions.includes("permissions.manage");
  }, [isOwner, actorPermissions]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<UiRole | "all">("all");
  const [statusFilter, setStatusFilter] = useState<AccountStatusFilter>("all");
  const [linkFilter, setLinkFilter] = useState<AccountLinkFilter>("all");
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editDraft, setEditDraft] = useState<EditUserDraft | null>(null);
  const [permissionSearch, setPermissionSearch] = useState("");
  const [permissionGroupFilter, setPermissionGroupFilter] = useState<"all" | (typeof APP_PERMISSION_GROUPS)[number]["key"]>("all");

  const [createForm, setCreateForm] = useState({
    displayName: "",
    email: "",
    password: "",
    phone: "",
    notes: "",
    role: "staff" as UiRole,
  });

  const [createLoading, setCreateLoading] = useState(false);
  const [createMsg, setCreateMsg] = useState<string>("");
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [inviteSaving, setInviteSaving] = useState(false);
  const [inviteDraft, setInviteDraft] = useState<InviteDraft>({
    email: "",
    role: "staff",
    notes: "",
  });

  /* =========================
     Helpers
  ========================= */
  function cleanEmail(v: string) {
    return String(v || "").trim().toLowerCase();
  }

  function cleanText(v: unknown) {
    return String(v || "").trim();
  }

  function firstText(...values: unknown[]) {
    for (const value of values) {
      const text = cleanText(value);
      if (text && text !== "undefined" && text !== "null") return text;
    }
    return "";
  }

  function firstNumber(...values: unknown[]) {
    for (const value of values) {
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    }
    return 0;
  }

  function nestedRecord(source: Record<string, unknown> | undefined, key: string) {
    const value = source?.[key];
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  }

  function shortUid(uid: string) {
    const normalized = cleanText(uid);
    if (normalized.length <= 12) return normalized || "—";
    return `${normalized.slice(0, 6)}…${normalized.slice(-4)}`;
  }

  function isMalikatEmail(email: string) {
    return cleanEmail(email).endsWith("@malikat.com");
  }

  function isBootstrapAccountEmail(email: string) {
    return ["nawafaaa0@gmail.com", "nawafaaa6@gmail.com", "alolayan3@gmail.com"].includes(cleanEmail(email));
  }

  function isEmployeeRole(role: UiRole) {
    return ["owner", "admin", "hr", "reception", "staff"].includes(role);
  }

  function isManagedAccountRole(role: UiRole) {
    return ["owner", "admin", "hr", "reception", "staff", "pending"].includes(role);
  }

  function shouldShowManagedAccount(row: UserRow) {
    return isManagedAccountRole(row.role) || isMalikatEmail(row.email) || isBootstrapAccountEmail(row.email);
  }

  function hasLinkedEmployee(row: Pick<UserRow, "linkedEmployeeDocId" | "employeeId" | "employeeSource" | "staffSource">) {
    return Boolean(
      cleanText(row.linkedEmployeeDocId) ||
        cleanText(row.employeeId) ||
        row.employeeSource ||
        row.staffSource
    );
  }

  function isIncompleteAccount(row: UserRow) {
    return !cleanText(row.displayName) || !cleanText(row.email) || !hasLinkedEmployee(row);
  }

  function matchesLinkFilter(row: UserRow, filter: AccountLinkFilter) {
    if (filter === "all") return true;
    if (filter === "linked") return hasLinkedEmployee(row);
    if (filter === "unlinked") return !hasLinkedEmployee(row);
    return isIncompleteAccount(row);
  }

  const toastMsg = (msg: string, ms = 2200) => {
    setCreateMsg(msg);
    if (ms > 0) setTimeout(() => setCreateMsg(""), ms);
  };

  function isAccountDeleted(row: Pick<UserRow, "deleted" | "deletedAt" | "employmentStatus">) {
    const employmentStatus = cleanText(row.employmentStatus).toLowerCase();
    return row.deleted === true || Boolean(row.deletedAt) || employmentStatus === "deleted";
  }

  function isAccountArchived(row: Pick<UserRow, "archived" | "removedFromStaff" | "employmentStatus">) {
    const employmentStatus = cleanText(row.employmentStatus).toLowerCase();
    return row.archived === true || row.removedFromStaff === true || employmentStatus === "archived";
  }

  function getUserState(row: UserRow): AccountState {
    if (isAccountDeleted(row)) return "deleted";
    if (isAccountArchived(row)) return "archived";
    if (row.role === "pending") return "pending";
    if (row.active === false || row.isActive === false) return "inactive";
    return "active";
  }

  function matchesStatusFilter(row: UserRow, filter: AccountStatusFilter) {
    if (filter === "all") return true;
    const state = getUserState(row);
    if (filter === "inactive") {
      return state === "inactive" || state === "archived" || state === "deleted";
    }
    if (filter === "archived") {
      return state === "archived" || state === "deleted";
    }
    return state === filter;
  }

  function getUserStateLabel(state: AccountState) {
    if (state === "active") return "نشطة";
    if (state === "pending") return "قيد المراجعة";
    if (state === "archived") return "مؤرشف";
    if (state === "deleted") return "محذوف منطقيًا";
    return "غير نشطة";
  }

  function getUserStateSummary(state: AccountState) {
    if (state === "active") return "مفعلة";
    if (state === "pending") return "مراجعة";
    if (state === "archived") return "مؤرشفة";
    if (state === "deleted") return "محذوفة";
    return "معطلة";
  }

  function canRestoreUserAccount(row: UserRow) {
    if (isAccountDeleted(row) || isAccountArchived(row)) return true;
    if (row.role === "pending") return false;
    return (
      row.active === false ||
      row.isActive === false
    );
  }

  function getRoleLabel(role: UiRole) {
    return ROLE_LABELS[role] || ROLE_LABELS.guest;
  }

  function getRoleTone(role: UiRole) {
    return ROLE_TONES[role] || ROLE_TONES.guest;
  }

  function getUserPermissions(row: Pick<UserRow, "role" | "permissions" | "permissionOverrides" | "permissionVersion">) {
    return getEffectiveAppPermissions({
      role: row.role as any,
      permissions: row.permissions,
      permissionOverrides: row.permissionOverrides,
      permissionVersion: row.permissionVersion,
    });
  }

  function formatDate(value: any) {
    if (!value) return "-";
    try {
      const date =
        typeof value?.toDate === "function"
          ? value.toDate()
          : value?.seconds
            ? new Date(value.seconds * 1000)
            : new Date(value);
      if (Number.isNaN(date.getTime())) return "-";
      return new Intl.DateTimeFormat("ar-SA", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
    } catch {
      return "-";
    }
  }

  function toMillis(value: any) {
    if (!value) return 0;
    try {
      const date =
        typeof value?.toDate === "function"
          ? value.toDate()
          : value?.seconds
            ? new Date(value.seconds * 1000)
            : new Date(value);
      const time = date.getTime();
      return Number.isNaN(time) ? 0 : time;
    } catch {
      return 0;
    }
  }

  function roleRank(role: UiRole) {
    const ranks: Record<UiRole, number> = {
      owner: 60,
      admin: 50,
      hr: 40,
      reception: 30,
      staff: 20,
      pending: 10,
      client: 0,
      guest: 0,
    };
    return ranks[role] ?? 0;
  }

  function canAssignRole(role: UiRole) {
    if (!canManageUsers) return false;
    if (isOwner) return role !== "client" && role !== "guest";
    if (uiRole === "admin") return ["hr", "reception", "staff", "pending"].includes(role);
    if (uiRole === "hr") return ["staff", "pending"].includes(role);
    return false;
  }

  function canEditTargetUser(row?: UserRow | null) {
    if (!row) return false;
    if (isOwner) return true;
    if (!canManageUsers) return false;
    return roleRank(row.role) < roleRank(uiRole);
  }

  function toAccountUserLinkRow(row: Partial<UserRow> & { uid: string }): AccountUserLinkRow {
    return {
      uid: cleanText(row.uid),
      email: cleanEmail(row.email || ""),
      phone: cleanText(row.phone || ""),
      displayName: cleanText(row.displayName || ""),
      role: cleanText(row.role || ""),
      active: row.active !== false,
      linkedEmployeeDocId: cleanText(row.linkedEmployeeDocId || ""),
      employeeId: cleanText(row.employeeId || ""),
      deletedAt: row.deletedAt,
    };
  }

  const syncLinkedStaffFromUser = async (args: {
    user: Partial<UserRow> & { uid: string };
    role: UiRole;
    active: boolean;
    displayName: string;
    permissions?: AppPermission[];
    permissionOverrides?: PermissionOverrides;
    createIfMissing?: boolean;
    writeStaff?: boolean;
  }) => {
    const userRow = toAccountUserLinkRow(args.user);
    if (args.writeStaff === false) {
      return cleanText(userRow.linkedEmployeeDocId) || cleanText(userRow.employeeId) || null;
    }

    const staffRows = await listStaffLinkRows();
    const matches = findStaffMatchesForUser(userRow, staffRows);
    const existing = matches[0] as any;
    const fallbackDocId =
      cleanText(userRow.linkedEmployeeDocId) || cleanText(userRow.employeeId) || cleanText(userRow.uid);
    const staffId = cleanText(existing?.id || (args.createIfMissing ? fallbackDocId : ""));
    if (!staffId) return null;

    const email = cleanEmail(userRow.email || "");
    const displayName = cleanText(args.displayName) || cleanText(existing?.name) || "موظفة";
    const nextRole = toFirestoreRole(args.role);
    const isEmployeeRole = ["owner", "admin", "hr", "reception", "staff"].includes(args.role);
    const isPublicStaffRole = args.role === "staff";
    const effectivePermissions = getEffectiveAppPermissions({
      role: args.role as any,
      permissions: args.permissions,
      permissionOverrides: args.permissionOverrides,
    });
    const permissionPayload = {
      permissions: effectivePermissions,
      permissionOverrides: args.permissionOverrides || buildPermissionOverrides(args.role, effectivePermissions),
      permissionVersion: PERMISSION_SCHEMA_VERSION,
    };

    await setDoc(
      doc(db, ...STAFF_PUBLIC_COLLECTION, staffId),
      {
        uid: userRow.uid,
        linkedUid: userRow.uid,
        linkedUserId: userRow.uid,
        ...(email ? { userEmail: email } : {}),
        ...(!cleanText(existing?.email) && email ? { email } : {}),
        name: displayName,
        role: nextRole,
        active: isEmployeeRole ? args.active : false,
        showOnAbout: isPublicStaffRole ? existing?.showOnAbout !== false : false,
        showOnBooking: isPublicStaffRole ? existing?.showOnBooking === true : false,
        removedFromStaff: false,
        archived: false,
        deleted: false,
        employmentStatus: isEmployeeRole ? (args.active ? "active" : "inactive") : "inactive",
        deletedAt: null,
        deletedBy: null,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    await setDoc(
      doc(db, ...EMPLOYEES_COLLECTION, staffId),
      {
        uid: userRow.uid,
        linkedUid: userRow.uid,
        linkedUserId: userRow.uid,
        ...(email ? { userEmail: email, email } : {}),
        name: displayName,
        role: nextRole,
        ...permissionPayload,
        isActive: isEmployeeRole ? args.active : false,
        active: isEmployeeRole ? args.active : false,
        showOnAbout: isPublicStaffRole ? existing?.showOnAbout !== false : false,
        removedFromStaff: false,
        archived: false,
        deleted: false,
        employmentStatus: isEmployeeRole ? (args.active ? "active" : "inactive") : "inactive",
        deletedAt: null,
        deletedBy: null,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    if (isEmployeeRole) {
      await setDoc(
        doc(db, "salons", SALON_ID, "admin_users", userRow.uid),
        {
          uid: userRow.uid,
          email,
          displayName,
          phone: cleanText(userRow.phone || ""),
          role: nextRole,
          ...permissionPayload,
          active: args.active,
          employeeId: staffId,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }

    await setDoc(
      doc(db, ...USERS_COLLECTION, userRow.uid),
      {
        linkedEmployeeDocId: staffId,
        employeeId: staffId,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    return staffId;
  };

  const loadUsers = async (options?: { runRepair?: boolean }) => {
    if (!canManageUsers) return;

    setUsersLoading(true);
    try {
      let repairResult:
        | {
            linkedPairs: number;
            patchedUsers: number;
            patchedStaff: number;
          }
        | null = null;

      if (options?.runRepair) {
        repairResult = await repairLegacyStaffUserLinks();
      }

      const [snap, staffRows, employeeSnap] = await Promise.all([
        getDocs(collection(db, ...USERS_COLLECTION)),
        listStaffLinkRows(),
        getDocs(collection(db, ...EMPLOYEES_COLLECTION)).catch(() => null),
      ]);

      const employeeRows: Array<Record<string, unknown> & { id: string }> = (employeeSnap?.docs || []).map((employeeDoc) => ({
        id: employeeDoc.id,
        ...(employeeDoc.data() as Record<string, unknown>),
      }));
      const employeesById = new Map(employeeRows.map((row) => [cleanText(row.id), row]));
      const employeesByUid = new Map(
        employeeRows
          .map((row) => [
            firstText(row["uid"], row["linkedUid"], row["linkedUserId"], row["authUid"], row["userId"]),
            row,
          ] as const)
          .filter(([key]) => Boolean(key))
      );
      const employeesByEmail = new Map(
        employeeRows
          .map((row) => [
            cleanEmail(firstText(row["email"], row["userEmail"])),
            row,
          ] as const)
          .filter(([key]) => Boolean(key))
      );

      const listAll: UserRow[] = snap.docs.map((d) => {
        const x = d.data() as any;
        const role = mapFirestoreRoleToUi(x?.role);
        const permissionOverrides = normalizePermissionOverrides(x?.permissionOverrides);
        const permissions = getEffectiveAppPermissions({
          role: role as any,
          permissions: x?.permissions,
          permissionOverrides,
          permissionVersion: x?.permissionVersion,
        });
        const baseRow: UserRow = {
          uid: d.id,
          email: String(x?.email || ""),
          phone: String(x?.phone || ""),
          displayName: String(x?.displayName || x?.name || ""),
          role,
          active: x?.active !== false,
          isActive: x?.isActive !== false,
          archived: x?.archived === true,
          deleted: x?.deleted === true,
          removedFromStaff: x?.removedFromStaff === true,
          employmentStatus: String(x?.employmentStatus || ""),
          notes: String(x?.notes || x?.memo || ""),
          linkedEmployeeDocId: String(x?.linkedEmployeeDocId || ""),
          employeeId: String(x?.employeeId || ""),
          permissions,
          permissionOverrides,
          permissionVersion: Number(x?.permissionVersion || 0) || undefined,
          deletedAt: x?.deletedAt,
          deletedBy: x?.deletedBy,
          createdAt: x?.createdAt,
          updatedAt: x?.updatedAt,
        };
        const linkedStaff = findStaffMatchesForUser(toAccountUserLinkRow(baseRow), staffRows)[0] as Record<string, unknown> | undefined;
        const linkedEmployeeId =
          cleanText(baseRow.linkedEmployeeDocId) ||
          cleanText(baseRow.employeeId) ||
          cleanText(linkedStaff?.id);
        const linkedEmployee =
          employeesById.get(linkedEmployeeId) ||
          employeesByUid.get(baseRow.uid) ||
          employeesByEmail.get(cleanEmail(baseRow.email));
        const employeeProfile = nestedRecord(linkedEmployee, "employeeProfile");
        const employeeEmployment = nestedRecord(linkedEmployee, "employment");
        const staffEmployment = nestedRecord(linkedStaff, "employment");
        const payrollConfig = {
          ...nestedRecord(linkedStaff, "payroll"),
          ...nestedRecord(linkedStaff, "payrollConfig"),
          ...nestedRecord(linkedEmployee, "payroll"),
          ...nestedRecord(linkedEmployee, "payrollConfig"),
        };
        const salaryBase = firstNumber(
          linkedEmployee?.["monthlySalary"],
          linkedEmployee?.["baseSalary"],
          payrollConfig["monthlySalary"],
          payrollConfig["baseSalary"],
          linkedStaff?.["monthlySalary"],
          linkedStaff?.["baseSalary"]
        );
        const housingAllowance = firstNumber(linkedEmployee?.["housingAllowance"], payrollConfig["housingAllowance"]);
        const transportAllowance = firstNumber(linkedEmployee?.["transportAllowance"], payrollConfig["transportAllowance"]);
        const otherAllowances = firstNumber(
          linkedEmployee?.["otherAllowances"],
          linkedEmployee?.["allowances"],
          payrollConfig["otherAllowances"],
          payrollConfig["allowances"]
        );
        return {
          ...baseRow,
          linkedEmployeeDocId: linkedEmployeeId,
          employeeId: cleanText(baseRow.employeeId) || linkedEmployeeId,
          employeeName: firstText(linkedEmployee?.["name"], linkedStaff?.["name"], linkedEmployee?.["displayName"]),
          department: firstText(
            linkedEmployee?.["department"],
            employeeEmployment["department"],
            employeeProfile["department"],
            linkedStaff?.["department"],
            staffEmployment["department"]
          ),
          jobTitle: firstText(
            linkedEmployee?.["jobTitle"],
            linkedEmployee?.["title"],
            employeeEmployment["jobTitle"],
            employeeProfile["jobTitle"],
            linkedStaff?.["jobTitle"],
            linkedStaff?.["title"]
          ),
          startDate: firstText(linkedEmployee?.["startDate"], linkedEmployee?.["hireDate"], employeeEmployment["startDate"]),
          fingerprintNo: firstText(
            linkedEmployee?.["fingerprintNo"],
            linkedEmployee?.["fingerprint"],
            linkedEmployee?.["badgeNo"],
            linkedEmployee?.["employeeNo"]
          ),
          employeeNo: firstText(linkedEmployee?.["employeeNo"], linkedEmployee?.["employeeNumber"], linkedEmployeeId),
          avatarUrl: firstText(linkedEmployee?.["avatarUrl"], linkedStaff?.["avatarUrl"], linkedEmployee?.["photoURL"], linkedEmployee?.["photoUrl"]),
          cvUrl: firstText(linkedEmployee?.["cvUrl"], linkedStaff?.["cvUrl"]),
          baseSalary: salaryBase,
          monthlySalary: salaryBase,
          housingAllowance,
          transportAllowance,
          otherAllowances,
          insuranceDeduction: firstNumber(linkedEmployee?.["insuranceDeduction"], payrollConfig["insuranceDeduction"]),
          workDaysPerMonth: firstNumber(linkedEmployee?.["workDaysPerMonth"], payrollConfig["workDaysPerMonth"], 30),
          monthlyHours: firstNumber(linkedEmployee?.["monthlyHours"], payrollConfig["monthlyHours"], 240),
          staffSource: linkedStaff,
          employeeSource: linkedEmployee,
        };
      });

      // ✅ عرض الحسابات الداخلية + bootstrap حتى لو createdAt ناقص أو البريد ليس malikat.com
      const listFiltered = listAll
        .filter((u) => shouldShowManagedAccount(u))
        .map((u) => {
          // أي حساب malikat.com لو كان client/guest نخليه pending (عرض + إدارة)
          const fixedRole: UiRole =
            u.role === "client" || u.role === "guest" ? "pending" : u.role;
          return {
            ...u,
            role: fixedRole,
            permissions:
              fixedRole === u.role
                ? u.permissions
                : getEffectiveAppPermissions({
                    role: fixedRole as any,
                    permissions: u.permissions,
                    permissionOverrides: u.permissionOverrides,
                    permissionVersion: u.permissionVersion,
                }),
          };
        })
        .sort((a, b) => {
          const aTime = toMillis(a.createdAt) || toMillis(a.updatedAt);
          const bTime = toMillis(b.createdAt) || toMillis(b.updatedAt);
          return bTime - aTime || cleanText(a.displayName || a.email).localeCompare(cleanText(b.displayName || b.email), "ar");
        });

      setUsers(listFiltered);
      if (repairResult) {
        toastMsg(
          `✅ تم فحص الربط: ${repairResult.linkedPairs} ربط، ${repairResult.patchedStaff} موظفة، ${repairResult.patchedUsers} حساب`,
          3200
        );
      }
    } catch (e) {
      console.error("loadUsers error:", e);
      setUsers([]);
      toastMsg("❌ تعذر تحميل الحسابات (Rules?)", 2600);
    } finally {
      setUsersLoading(false);
    }
  };

  const loadInvites = async () => {
    if (!canManageUsers) return;

    setInvitesLoading(true);
    try {
      const snap = await getDocs(collection(db, "salons", SALON_ID, "user_invites"));

      const list: InviteRow[] = snap.docs
        .map((d) => {
          const x = d.data() as any;
          return {
            id: d.id,
            email: String(x?.email || ""),
            role: mapFirestoreRoleToUi(x?.role),
            active: x?.active !== false,
            notes: String(x?.notes || x?.memo || ""),
            createdAt: x?.createdAt,
            used: x?.used === true,
            usedAt: x?.usedAt,
            usedByUid: String(x?.usedByUid || ""),
            createdByUid: String(x?.createdByUid || ""),
            createdByEmail: String(x?.createdByEmail || ""),
          };
        })
        .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

      setInvites(list);
    } catch (e) {
      console.error("loadInvites error:", e);
      setInvites([]);
      toastMsg("تعذر تحميل الدعوات", 2400);
    } finally {
      setInvitesLoading(false);
    }
  };

  const handleCreateUser = async () => {
    if (!canManageUsers) return;

    const displayName = createForm.displayName.trim();
    const email = createForm.email.trim().toLowerCase();
    const password = createForm.password.trim();
    const phone = createForm.phone.trim();
    const notes = createForm.notes.trim();
    const role = createForm.role;

    setCreateMsg("");

    if (!displayName || !email || !password) {
      toastMsg("❌ أكمل البيانات (الاسم/الإيميل/كلمة المرور)");
      return;
    }

    // ✅ منع إنشاء أي إيميل غير malikat.com
    if (!isMalikatEmail(email)) {
      toastMsg("❌ مسموح فقط بإيميلات @malikat.com لإنشاء حسابات الموظفات");
      return;
    }

    if (!isOwner && role === "owner") {
      toastMsg("❌ فقط Owner يقدر ينشئ Owner");
      return;
    }

    try {
      setCreateLoading(true);
      const secondary = getSecondaryAuth();
      const permissions = getRoleAppPermissions(role as any);
      const permissionOverrides = buildPermissionOverrides(role as any, permissions);

      const cred = await createUserWithEmailAndPassword(secondary, email, password);
      await updateProfile(cred.user, { displayName }).catch(() => {});

      const uid = cred.user.uid;

      // ✅ users/{uid} هو Source of Truth
      await setDoc(
        doc(db, ...USERS_COLLECTION, uid),
        {
          email,
          displayName,
          phone,
          notes,
          role: toFirestoreRole(role),
          permissions,
          permissionOverrides,
          permissionVersion: PERMISSION_SCHEMA_VERSION,
          active: true,
          createdAt: serverTimestamp(),
          createdByUid: (auth as any)?.currentUser?.uid || "",
          createdByEmail: (auth as any)?.currentUser?.email || "",
        },
        { merge: true }
      );

      // ✅ لو Staff: جهّز staff_public + employees
      if (isEmployeeRole(role)) {
        await syncLinkedStaffFromUser({
          user: {
            uid,
            email,
            displayName,
            phone,
            role,
            active: true,
            permissions,
            permissionOverrides,
            linkedEmployeeDocId: uid,
            employeeId: uid,
          },
          role,
          active: true,
          displayName,
          permissions,
          permissionOverrides,
          createIfMissing: true,
        });
      }

      await signOut(secondary).catch(() => {});

      void writeAuditLog({
        salonId: SALON_ID,
        action: "user_created",
        entityType: "user",
        entityId: uid,
        description: "تم إنشاء حساب مستخدم جديد",
        source: "dashboard",
        after: {
          uid,
          email,
          displayName,
          role: toFirestoreRole(role),
          permissions,
          active: true,
        },
        meta: {
          role: toFirestoreRole(role),
          createdFrom: "settings_users",
        },
      });

      toastMsg("✅ تم إنشاء الحساب بنجاح", 1800);
      setCreateForm({ displayName: "", email: "", password: "", phone: "", notes: "", role: "staff" });
      setCreateOpen(false);
      setSelectedUserId(uid);

      await loadUsers();
    } catch (e: any) {
      console.error("create user error:", e);
      const m = String(e?.message || "");
      if (m.includes("email-already-in-use")) toastMsg("❌ هذا الإيميل مستخدم مسبقًا");
      else if (m.includes("weak-password")) toastMsg("❌ كلمة المرور ضعيفة (جرّب 6 أحرف أو أكثر)");
      else toastMsg("❌ تعذر إنشاء الحساب. تأكد من الصلاحيات/Rules");
    } finally {
      setCreateLoading(false);
    }
  };

  const handleCreateInvite = async () => {
    if (!canManageUsers) return;

    const email = cleanEmail(inviteDraft.email);
    const role = inviteDraft.role;
    const notes = inviteDraft.notes.trim();

    setCreateMsg("");

    if (!email) {
      toastMsg("❌ أدخل البريد الإلكتروني أولًا");
      return;
    }

    if (!isMalikatEmail(email)) {
      toastMsg("❌ الدعوات هنا مخصصة فقط لبريد @malikat.com");
      return;
    }

    if (!role || role === "guest" || role === "client") {
      toastMsg("❌ اختر دورًا إداريًا مناسبًا للدعوة");
      return;
    }

    if (!isOwner && role === "owner") {
      toastMsg("❌ فقط المالك يستطيع إرسال دعوة Owner");
      return;
    }

    const duplicateInvite = invites.find(
      (invite) => cleanEmail(invite.email) === email && invite.used !== true
    );
    if (duplicateInvite) {
      toastMsg("❌ توجد دعوة نشطة لهذا البريد بالفعل");
      return;
    }

    try {
      setInviteSaving(true);
      const permissions = getRoleAppPermissions(role as any);
      const permissionOverrides = buildPermissionOverrides(role as any, permissions);

      const inviteRef = doc(collection(db, "salons", SALON_ID, "user_invites"));
      await setDoc(
        inviteRef,
        {
          email,
          role: toFirestoreRole(role),
          permissions,
          permissionOverrides,
          permissionVersion: PERMISSION_SCHEMA_VERSION,
          active: true,
          notes,
          createdAt: serverTimestamp(),
          createdByUid: (auth as any)?.currentUser?.uid || "",
          createdByEmail: (auth as any)?.currentUser?.email || "",
        },
        { merge: true }
      );

      void writeAuditLog({
        salonId: SALON_ID,
        action: "invite_created",
        entityType: "invite",
        entityId: inviteRef.id,
        description: "تم إنشاء دعوة وصول إدارية",
        source: "dashboard",
        after: {
          email,
          role: toFirestoreRole(role),
          permissions,
          active: true,
        },
        meta: {
          section: "settings_users",
        },
      });

      toastMsg("✅ تم حفظ الدعوة بنجاح", 1800);
      setInviteDraft({ email: "", role: "staff", notes: "" });
      await loadInvites();
    } catch (e) {
      console.error("handleCreateInvite error:", e);
      toastMsg("❌ تعذر حفظ الدعوة. تأكد من الصلاحيات والقواعد", 2600);
    } finally {
      setInviteSaving(false);
    }
  };

  const updateUserRole = async (uid: string, newRole: UiRole) => {
    if (!canManageUsers) return;
    if (!isOwner && newRole === "owner") return;

    if ((auth as any)?.currentUser?.uid === uid) {
      toastMsg("❌ لا يمكن تعديل دور حسابك من هنا", 2400);
      return;
    }

    const row = users.find((x) => x.uid === uid);
    if (!canEditTargetUser(row)) {
      toastMsg("❌ تعديل حسابات المالك محجوز للمالك نفسه", 2400);
      return;
    }

    // ✅ pending => active false / غير pending => active true
    const nextActive = newRole !== "pending";

    try {
      const oldRole = String(row?.role || "").trim();
      const oldActive = row?.active !== false;
      const permissions = getRoleAppPermissions(newRole as any);
      const permissionOverrides = buildPermissionOverrides(newRole as any, permissions);

      await setDoc(
        doc(db, ...USERS_COLLECTION, uid),
        {
          role: toFirestoreRole(newRole),
          permissions,
          permissionOverrides,
          permissionVersion: PERMISSION_SCHEMA_VERSION,
          active: nextActive,
          isActive: nextActive,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );


      const name = row?.displayName || "موظفة";
      await syncLinkedStaffFromUser({
        user: {
          uid,
          email: row?.email || "",
          displayName: name,
          role: newRole,
          active: nextActive,
          permissions,
          permissionOverrides,
          linkedEmployeeDocId: row?.linkedEmployeeDocId || row?.employeeId || "",
          employeeId: row?.employeeId || row?.linkedEmployeeDocId || "",
        },
        role: newRole,
        active: nextActive,
        displayName: name,
        permissions,
        permissionOverrides,
        createIfMissing: isEmployeeRole(newRole),
        writeStaff: false,
      });

      await setDoc(
        doc(db, "salons", SALON_ID, "admin_users", uid),
        {
          uid,
          email: row?.email || "",
          displayName: row?.displayName || "",
          phone: row?.phone || "",
          role: toFirestoreRole(newRole),
          permissions,
          permissionOverrides,
          permissionVersion: PERMISSION_SCHEMA_VERSION,
          active: nextActive,
          isActive: nextActive,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setUsers((prev) =>
        prev.map((u) =>
          u.uid === uid
            ? { ...u, role: newRole, active: nextActive, isActive: nextActive, permissions, permissionOverrides }
            : u
        )
      );

      void writeAuditLog({
        salonId: SALON_ID,
        action: "role_changed",
        entityType: "user",
        entityId: uid,
        description: "تم تعديل صلاحية المستخدم",
        source: "dashboard",
        before: {
          role: oldRole || null,
          active: oldActive,
        },
        after: {
          role: newRole,
          active: nextActive,
          permissions,
        },
        meta: {
          oldRole: oldRole || null,
          newRole,
        },
      });

      toastMsg("✅ تم تحديث الدور", 1400);
    } catch (e) {
      console.error("updateUserRole error:", e);
      toastMsg("❌ تعذر تحديث الدور (Rules?)", 2600);
    }
  };

  const toggleUserActive = async (uid: string, active: boolean) => {
    if (!canManageUsers) return;

    if ((auth as any)?.currentUser?.uid === uid) {
      toastMsg("❌ لا يمكن إيقاف حسابك من هنا", 2400);
      return;
    }

    const row = users.find((x) => x.uid === uid);
    if (!canEditTargetUser(row)) {
      toastMsg("❌ تعديل حسابات المالك محجوز للمالك نفسه", 2400);
      return;
    }

    try {
      const oldActive = row?.active !== false;

      await setDoc(
        doc(db, ...USERS_COLLECTION, uid),
        { active, isActive: active, updatedAt: serverTimestamp() },
        { merge: true }
      );

      // Preserve the current employee link only; do not mutate staff_public/employees here.
      if (row?.role && isEmployeeRole(row.role as UiRole)) {
        await syncLinkedStaffFromUser({
          user: {
            uid,
            email: row?.email || "",
            displayName: row?.displayName || "",
            role: row?.role || "staff",
            active,
            permissions: row.permissions,
            permissionOverrides: row.permissionOverrides,
            linkedEmployeeDocId: row?.linkedEmployeeDocId || row?.employeeId || "",
            employeeId: row?.employeeId || row?.linkedEmployeeDocId || "",
          },
          role: row?.role || "staff",
          active,
          displayName: row?.displayName || "",
          permissions: row.permissions,
          permissionOverrides: row.permissionOverrides,
          createIfMissing: false,
          writeStaff: false,
        });
      }

      await setDoc(
        doc(db, "salons", SALON_ID, "admin_users", uid),
        { active, isActive: active, updatedAt: serverTimestamp() },
        { merge: true }
      );

      setUsers((prev) => prev.map((u) => (u.uid === uid ? { ...u, active, isActive: active } : u)));

      void writeAuditLog({
        salonId: SALON_ID,
        action: "user_updated",
        entityType: "user",
        entityId: uid,
        description: active ? "تم تفعيل الحساب" : "تم تعطيل الحساب",
        source: "dashboard",
        before: { active: oldActive },
        after: { active },
        meta: { field: "active" },
      });

      toastMsg("✅ تم تحديث حالة الحساب", 1200);
    } catch (e) {
      console.error("toggleUserActive error:", e);
      toastMsg("❌ تعذر تحديث حالة الحساب (Rules?)", 2600);
    }
  };

  const updateUserDisplayName = async (uid: string, newName: string) => {
    if (!canManageUsers) return;

    const name = String(newName || "").trim();
    if (!name) {
      toastMsg("❌ الاسم لا يمكن أن يكون فارغ", 2000);
      return;
    }

    if ((auth as any)?.currentUser?.uid === uid) {
      toastMsg("❌ لا يمكن تعديل اسم حسابك من هنا", 2400);
      return;
    }

    const row = users.find((x) => x.uid === uid);
    if (!canEditTargetUser(row)) {
      toastMsg("❌ تعديل حسابات المالك محجوز للمالك نفسه", 2400);
      return;
    }

    try {
      const oldName = String(row?.displayName || "").trim();

      await setDoc(
        doc(db, ...USERS_COLLECTION, uid),
        { displayName: name, updatedAt: serverTimestamp() },
        { merge: true }
      );

      const roleNow = row?.role;

      if (roleNow && isEmployeeRole(roleNow as UiRole)) {
        await syncLinkedStaffFromUser({
          user: {
            uid,
            email: row?.email || "",
            displayName: name,
            role: roleNow,
            active: row?.active !== false,
            permissions: row.permissions,
            permissionOverrides: row.permissionOverrides,
            linkedEmployeeDocId: row?.linkedEmployeeDocId || row?.employeeId || "",
            employeeId: row?.employeeId || row?.linkedEmployeeDocId || "",
          },
          role: roleNow,
          active: row?.active !== false,
          displayName: name,
          permissions: row.permissions,
          permissionOverrides: row.permissionOverrides,
          createIfMissing: false,
          writeStaff: false,
        });
      }

      await setDoc(
        doc(db, "salons", SALON_ID, "admin_users", uid),
        { displayName: name, updatedAt: serverTimestamp() },
        { merge: true }
      );

      setUsers((prev) => prev.map((u) => (u.uid === uid ? { ...u, displayName: name } : u)));

      void writeAuditLog({
        salonId: SALON_ID,
        action: "user_updated",
        entityType: "user",
        entityId: uid,
        description: "تم تعديل اسم المستخدم",
        source: "dashboard",
        before: { displayName: oldName || null },
        after: { displayName: name },
        meta: { field: "displayName" },
      });

      toastMsg("✅ تم تحديث الاسم", 1200);
    } catch (e) {
      console.error("updateUserDisplayName error:", e);
      toastMsg("❌ تعذر تحديث الاسم (Rules?)", 2600);
    }
  };

  const saveEditedUser = async () => {
    if (!canManageUsers || !editDraft) return;

    const row = users.find((x) => x.uid === editDraft.uid);
    if (!row) return;

    if (!canEditTargetUser(row)) {
      toastMsg("❌ تعديل حسابات المالك محجوز للمالك نفسه", 2400);
      return;
    }

    if ((auth as any)?.currentUser?.uid === editDraft.uid) {
      toastMsg("❌ لا يمكن تعديل حسابك من هنا", 2400);
      return;
    }

    const displayName = editDraft.displayName.trim();
    const phone = editDraft.phone.trim();
    const notes = editDraft.notes.trim();
    const role = editDraft.role;
    const active = role === "pending" ? false : editDraft.active !== false;

    if (role !== row.role && !canAssignRole(role)) {
      toastMsg("❌ لا يمكنك تعيين هذا الدور", 2200);
      return;
    }

    const requestedPermissions = ALL_PERMISSION_META
      .map((item) => item.key)
      .filter((permission) => editDraft.permissions.includes(permission));
    const permissions = canManagePermissions
      ? requestedPermissions
      : role === row.role
        ? getUserPermissions(row)
        : getRoleAppPermissions(role as any);
    const permissionOverrides = buildPermissionOverrides(role as any, permissions);

    if (!displayName) {
      toastMsg("❌ الاسم لا يمكن أن يكون فارغًا", 2000);
      return;
    }

    if (role === "owner" && !isOwner) {
      toastMsg("❌ فقط المالك يقدر يمنح Owner", 2200);
      return;
    }

    try {
      setUsersLoading(true);

      const nextRole = toFirestoreRole(role);
      const staffId = await syncLinkedStaffFromUser({
        user: {
          uid: row.uid,
          email: row.email || editDraft.email,
          phone,
          displayName,
          role,
          active,
          permissions,
          permissionOverrides,
          linkedEmployeeDocId: row.linkedEmployeeDocId || row.employeeId || "",
          employeeId: row.employeeId || row.linkedEmployeeDocId || "",
        },
        role,
        active,
        displayName,
        permissions,
        permissionOverrides,
        createIfMissing: isEmployeeRole(role),
        writeStaff: false,
      });

      await setDoc(
        doc(db, ...USERS_COLLECTION, row.uid),
        {
          displayName,
          phone,
          notes,
          role: nextRole,
          permissions,
          permissionOverrides,
          permissionVersion: PERMISSION_SCHEMA_VERSION,
          active,
          isActive: active,
          linkedEmployeeDocId: staffId || row.linkedEmployeeDocId || row.employeeId || "",
          employeeId: staffId || row.employeeId || row.linkedEmployeeDocId || "",
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      await setDoc(
        doc(db, "salons", SALON_ID, "admin_users", row.uid),
        {
          uid: row.uid,
          email: row.email || editDraft.email,
          displayName,
          phone,
          role: nextRole,
          permissions,
          permissionOverrides,
          permissionVersion: PERMISSION_SCHEMA_VERSION,
          active,
          isActive: active,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setUsers((prev) =>
        prev.map((u) =>
          u.uid === row.uid
            ? {
                ...u,
                displayName,
                phone,
                notes,
                role,
                permissions,
                permissionOverrides,
                active,
                isActive: active,
                linkedEmployeeDocId: staffId || u.linkedEmployeeDocId,
                employeeId: staffId || u.employeeId,
              }
            : u
        )
      );

      void writeAuditLog({
        salonId: SALON_ID,
        action: "user_updated",
        entityType: "user",
        entityId: row.uid,
        description: "تم حفظ تعديلات الحساب",
        source: "dashboard",
        before: {
          displayName: row.displayName || null,
          phone: row.phone || null,
          role: row.role,
          active: row.active,
          notes: row.notes || null,
          permissions: row.permissions || [],
        },
        after: {
          displayName,
          phone,
          role,
          active,
          notes: notes || null,
          permissions,
        },
        meta: {
          field: "profile",
        },
      });

      toastMsg("✅ تم حفظ التعديلات", 1600);
      setEditDraft(null);
    } catch (e) {
      console.error("saveEditedUser error:", e);
      toastMsg("❌ تعذر حفظ التعديلات (Rules?)", 2600);
    } finally {
      setUsersLoading(false);
    }
  };

  const openEditUser = (row: UserRow) => {
    setCreateMsg("");
    setPermissionSearch("");
    setPermissionGroupFilter("all");
    setEditDraft({
      uid: row.uid,
      displayName: row.displayName || "",
      email: row.email || "",
      phone: row.phone || "",
      role: row.role,
      active: row.active !== false,
      notes: row.notes || "",
      permissions: getEffectiveAppPermissions({
        role: row.role as any,
        permissions: row.permissions,
        permissionOverrides: row.permissionOverrides,
        permissionVersion: row.permissionVersion,
      }),
    });
  };

  /* =========================
     Auth + Role
  ========================= */
  useEffect(() => {
    if (typeof initialRole === "string" && typeof authReady === "boolean") {
      authResolvedRef.current = true;
      return;
    }

    const unsub = onAuthStateChanged(auth, async (user) => {
      const requestId = ++authRequestIdRef.current;
      if (!authResolvedRef.current) setAuthLoading(true);
      try {
        if (!user) {
          setUiRole("guest");
          return;
        }

        const [tokenResult, userSnap, adminSnap] = await Promise.all([
          getIdTokenResult(user).catch((error) => {
            console.error("SettingsUsers token load error:", error);
            return null;
          }),
          getDoc(doc(db, ...USERS_COLLECTION, user.uid)).catch((error) => {
            console.error("SettingsUsers user load error:", error);
            return null;
          }),
          getDoc(doc(db, "salons", SALON_ID, "admin_users", user.uid)).catch((error) => {
            console.error("SettingsUsers admin load error:", error);
            return null;
          }),
        ]);

        const tokenRole = mapFirestoreRoleToUi((tokenResult as any)?.claims?.role || "");
        const userRole =
          userSnap && "exists" in userSnap && userSnap.exists()
            ? mapFirestoreRoleToUi((userSnap.data() as any)?.role)
            : "guest";
        const adminRole =
          adminSnap && "exists" in adminSnap && adminSnap.exists()
            ? mapFirestoreRoleToUi((adminSnap.data() as any)?.role)
            : "guest";

        const roleCandidates = [userRole, adminRole, tokenRole].filter(
          (role): role is UiRole => role !== "guest"
        );
        const roleWeight: Record<UiRole, number> = {
          owner: 700,
          admin: 600,
          hr: 500,
          reception: 400,
          staff: 300,
          pending: 200,
          client: 150,
          guest: 100,
        };
        const resolvedRole =
          roleCandidates.sort(
            (left, right) => roleWeight[right] - roleWeight[left]
          )[0] || "guest";

        setUiRole(resolvedRole);

        const userData =
          userSnap && "exists" in userSnap && userSnap.exists()
            ? (userSnap.data() as any)
            : adminSnap && "exists" in adminSnap && adminSnap.exists()
              ? (adminSnap.data() as any)
              : null;
        setActorPermissions(
          getEffectiveAppPermissions({
            role: resolvedRole as any,
            permissions: userData?.permissions,
            permissionOverrides: userData?.permissionOverrides,
            permissionVersion: userData?.permissionVersion,
          })
        );
      } catch (e) {
        console.error("SettingsUsers role load error:", e);
        setUiRole("guest");
      } finally {
        if (authRequestIdRef.current === requestId) {
          authResolvedRef.current = true;
          setAuthLoading(false);
        }
      }
    });

    return () => unsub();
  }, [initialRole, authReady]);

  useEffect(() => {
    if (!canManageUsers) return;
    loadUsers();
    loadInvites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canManageUsers]);

  const deleteUserAccount = async (uid: string) => {
    if (!canManageUsers) return;

    const row = users.find((x) => x.uid === uid);
    if (!row) return;

    if (!canEditTargetUser(row)) {
      toastMsg("❌ حذف حسابات المالك محجوز للمالك نفسه", 2400);
      return;
    }

    if ((auth as any)?.currentUser?.uid === uid) {
      toastMsg("❌ لا يمكن حذف حسابك من هنا", 2400);
      return;
    }

    const ok = confirm(
      `سيتم تعطيل حساب الدخول فقط دون تعديل ملف الموظفة أو إخفائها من الحجز.\n\nالحساب: ${row.email || uid}\n\nمتابعة؟`
    );
    if (!ok) return;

    try {
      setUsersLoading(true);
      const actorUid = String((auth as any)?.currentUser?.uid || "").trim();

      await setDoc(
        doc(db, ...USERS_COLLECTION, uid),
        {
          active: false,
          isActive: false,
          deleted: true,
          deletedAt: serverTimestamp(),
          deletedBy: actorUid || "",
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      await setDoc(
        doc(db, "salons", SALON_ID, "admin_users", uid),
        {
          active: false,
          isActive: false,
          deleted: true,
          deletedAt: serverTimestamp(),
          deletedBy: actorUid || "",
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setUsers((prev) =>
        prev.map((u) =>
          u.uid === uid
            ? {
                ...u,
                active: false,
                isActive: false,
                deleted: true,
                deletedAt: true,
                deletedBy: actorUid || "",
              }
            : u
        )
      );

      void writeAuditLog({
        salonId: SALON_ID,
        action: "user_deleted",
        entityType: "user",
        entityId: uid,
        description: "تم حذف الحساب منطقيًا دون تعديل ملف الموظفة",
        source: "dashboard",
        before: {
          role: row.role,
          active: row.active,
          linkedEmployeeDocId: row.linkedEmployeeDocId || row.employeeId || null,
        },
        after: {
          role: row.role,
          active: false,
          deletedAt: true,
          staffFileChanged: false,
        },
      });

      toastMsg("✅ تم حذف الحساب منطقيًا دون تعديل ملف الموظفة", 2400);
    } catch (e) {
      console.error("deleteUserAccount error:", e);
      toastMsg("❌ تعذر حذف الحساب", 2800);
    } finally {
      setUsersLoading(false);
    }
  };

  const restoreUserAccount = async (uid: string) => {
    if (!canManageUsers) return;

    const row = users.find((x) => x.uid === uid);
    if (!row) return;

    if (!canEditTargetUser(row)) {
      toastMsg("❌ لا تملك صلاحية استعادة هذا الحساب", 2400);
      return;
    }

    if ((auth as any)?.currentUser?.uid === uid) {
      toastMsg("❌ لا يمكن تعديل حسابك من هنا", 2400);
      return;
    }

    const ok = confirm(
      `سيتم استعادة حساب الدخول فقط مع الحفاظ على الدور والصلاحيات الحالية.\n\nالحساب: ${row.email || uid}\n\nمتابعة؟`
    );
    if (!ok) return;

    try {
      setUsersLoading(true);
      const restorePatch = {
        active: true,
        isActive: true,
        archived: false,
        deleted: false,
        removedFromStaff: false,
        employmentStatus: "active",
        deletedAt: null,
        deletedBy: null,
        updatedAt: serverTimestamp(),
      };

      await Promise.all([
        setDoc(doc(db, ...USERS_COLLECTION, uid), restorePatch, { merge: true }),
        setDoc(doc(db, "salons", SALON_ID, "admin_users", uid), restorePatch, { merge: true }),
      ]);

      const restoredStaffId = await syncLinkedStaffFromUser({
        user: {
          uid: row.uid,
          email: row.email,
          phone: row.phone || "",
          displayName: row.displayName || row.employeeName || "",
          role: row.role,
          active: true,
          permissions: row.permissions,
          permissionOverrides: row.permissionOverrides,
          linkedEmployeeDocId: row.linkedEmployeeDocId || row.employeeId || "",
          employeeId: row.employeeId || row.linkedEmployeeDocId || "",
        },
        role: row.role,
        active: true,
        displayName: row.displayName || row.employeeName || "موظفة",
        permissions: row.permissions,
        permissionOverrides: row.permissionOverrides,
        createIfMissing: false,
        writeStaff: true,
      });

      setUsers((prev) =>
        prev.map((u) =>
          u.uid === uid
            ? {
                ...u,
                active: true,
                isActive: true,
                archived: false,
                deleted: false,
                removedFromStaff: false,
                employmentStatus: "active",
                deletedAt: null,
                deletedBy: null,
              }
            : u
        )
      );

      void writeAuditLog({
        salonId: SALON_ID,
        action: "user_restored",
        entityType: "user",
        entityId: uid,
        description: restoredStaffId
          ? "تمت استعادة حساب الدخول وملف الموظفة المرتبط"
          : "تمت استعادة حساب الدخول ولم يُعثر على ملف موظفة مرتبط",
        source: "dashboard",
        before: {
          role: row.role,
          active: row.active,
          archived: row.archived === true,
          deleted: row.deleted === true || Boolean(row.deletedAt),
          employmentStatus: row.employmentStatus || null,
        },
        after: {
          role: row.role,
          active: true,
          staffFileChanged: Boolean(restoredStaffId),
          restoredStaffId: restoredStaffId || null,
        },
      });

      toastMsg(
        restoredStaffId
          ? "✅ تمت استعادة الحساب وملف الموظفة"
          : "⚠️ تمت استعادة الحساب ولم يُعثر على ملف الموظفة المرتبط",
        2400
      );
    } catch (e) {
      console.error("restoreUserAccount error:", e);
      toastMsg("❌ تعذر استعادة الحساب", 2600);
    } finally {
      setUsersLoading(false);
    }
  };

  const visibleUsers = useMemo(() => {
    const search = searchQuery.trim().toLowerCase();

    return [...users]
      .filter((user) => {
        if (roleFilter !== "all" && user.role !== roleFilter) return false;

        if (!matchesStatusFilter(user, statusFilter)) return false;
        if (!matchesLinkFilter(user, linkFilter)) return false;

        if (!search) return true;

        const haystack = [
          user.displayName,
          user.employeeName,
          user.email,
          user.phone,
          user.uid,
          user.notes,
          user.role,
          user.linkedEmployeeDocId,
          user.employeeId,
          user.department,
          user.jobTitle,
          user.employeeNo,
          user.fingerprintNo,
        ]
          .map((part) => cleanText(part).toLowerCase())
          .join(" | ");

        return haystack.includes(search);
      })
      ;
  }, [users, roleFilter, searchQuery, statusFilter, linkFilter]);

  const selectedUser = useMemo(() => {
    if (!selectedUserId) return visibleUsers[0] || null;
    return visibleUsers.find((user) => user.uid === selectedUserId) || visibleUsers[0] || null;
  }, [selectedUserId, visibleUsers]);

  const stats = useMemo(() => {
    const total = users.length;
    const active = users.filter((user) => getUserState(user) === "active").length;
    const inactive = users.filter((user) => matchesStatusFilter(user, "inactive")).length;
    const pending = users.filter((user) => getUserState(user) === "pending").length;
    const incomplete = users.filter((user) => isIncompleteAccount(user)).length;
    const unlinked = users.filter((user) => !hasLinkedEmployee(user)).length;
    const editors = users.filter((user) => ["owner", "hr", "admin"].includes(user.role)).length;

    return { total, active, inactive, pending, incomplete, unlinked, editors };
  }, [users]);

  const inviteStats = useMemo(() => {
    const total = invites.length;
    const active = invites.filter((invite) => invite.active !== false && invite.used !== true).length;
    const used = invites.filter((invite) => invite.used === true).length;
    const pending = invites.filter((invite) => invite.active === false && invite.used !== true).length;

    return { total, active, used, pending };
  }, [invites]);

  const averagePermissions = useMemo(() => {
    if (!users.length) return 0;
    const totalPermissions = users.reduce(
      (sum, user) => sum + getUserPermissions(user).length,
      0
    );
    return Math.round((totalPermissions / users.length) * 10) / 10;
  }, [users]);

  const exceptionCount = useMemo(() => {
    return users.filter(
      (user) =>
        getUserState(user) !== "active" ||
        user.active === false ||
        user.isActive === false ||
        Boolean(cleanText(user.notes))
    ).length;
  }, [users]);

  useEffect(() => {
    if (!visibleUsers.length) {
      if (selectedUserId) setSelectedUserId("");
      return;
    }

    const hasSelection = visibleUsers.some((user) => user.uid === selectedUserId);
    if (!selectedUserId || !hasSelection) {
      setSelectedUserId(visibleUsers[0].uid);
    }
  }, [selectedUserId, visibleUsers]);

  useEffect(() => {
    if (!editDraft) return;
    if (!users.some((user) => user.uid === editDraft.uid)) {
      setEditDraft(null);
    }
  }, [editDraft, users]);

  const selectedState = selectedUser ? getUserState(selectedUser) : "inactive";
  const selectedStateLabel = getUserStateLabel(selectedState);
  const selectedRoleLabel = selectedUser ? getRoleLabel(selectedUser.role) : "-";
  const selectedRoleTone = selectedUser ? getRoleTone(selectedUser.role) : "gray";
  const createPermissionCount = getRoleAppPermissions(createForm.role as any).length;
  const invitePreviewPermissions = PERMISSION_META.filter((item) =>
    getRoleAppPermissions(inviteDraft.role as any).includes(item.key)
  );
  const currentUid = String((auth as any)?.currentUser?.uid || "");
  const selectedIsSelf = Boolean(selectedUser && selectedUser.uid === currentUid);
  const selectedCanMutate = Boolean(selectedUser && !selectedIsSelf && canEditTargetUser(selectedUser));
  const usersBasePath = "/dashboard/settings/users";
  const profileUid = useMemo(() => {
    const marker = `${usersBasePath}/`;
    if (!location.pathname.startsWith(marker)) return "";
    return decodeURIComponent(location.pathname.slice(marker.length).split("/")[0] || "");
  }, [location.pathname]);
  const profileUser = useMemo(
    () => (profileUid ? users.find((user) => user.uid === profileUid) || null : null),
    [profileUid, users]
  );
  const profileEmployeeId = cleanText(profileUser?.employeeId || profileUser?.linkedEmployeeDocId || "");
  const profileCanMutate = Boolean(profileUser && profileUser.uid !== currentUid && canEditTargetUser(profileUser));
  const editRoleDefaultPermissions = editDraft ? getRoleAppPermissions(editDraft.role as any) : [];
  const editPermissionSet = new Set<AppPermission>(editDraft?.permissions || []);
  const editAddedPermissions = editDraft
    ? editDraft.permissions.filter((permission) => !editRoleDefaultPermissions.includes(permission)).length
    : 0;
  const editDisabledDefaults = editDraft
    ? editRoleDefaultPermissions.filter((permission) => !editPermissionSet.has(permission)).length
    : 0;
  const normalizedPermissionSearch = permissionSearch.trim().toLowerCase();
  const visiblePermissionGroups = APP_PERMISSION_GROUPS
    .map((group) => ({
      ...group,
      permissions: PERMISSION_META.filter((permission) => {
        if (permission.group !== group.key) return false;
        if (permissionGroupFilter !== "all" && permission.group !== permissionGroupFilter) return false;
        if (!normalizedPermissionSearch) return true;
        return [permission.label, permission.hint, permission.key]
          .join(" ")
          .toLowerCase()
          .includes(normalizedPermissionSearch);
      }),
    }))
    .filter((group) => group.permissions.length > 0);
  const canEditSelectedPermissions = Boolean(
    editDraft &&
      selectedUser &&
      canEditTargetUser(selectedUser) &&
      selectedUser.role !== "owner" &&
      editDraft.role !== "owner" &&
      canManagePermissions
  );
  const bannerTone = createMsg.startsWith("❌")
    ? "danger"
    : createMsg.startsWith("✅")
      ? "success"
      : "info";
  const heroHighlights = [
    {
      label: "الحسابات المباشرة",
      value: stats.total,
      hint: "حسابات الإدارة الظاهرة حاليًا.",
    },
    {
      label: "الحسابات النشطة",
      value: stats.active,
      hint: "حسابات قيد التشغيل الآن.",
    },
    {
      label: "الدعوات الفعالة",
      value: inviteStats.active,
      hint: "دعوات لم تُستخدم بعد.",
    },
  ];
  const overviewMetrics = [
    {
      label: "الإجمالي",
      value: stats.total,
      hint: "كل الحسابات الإدارية.",
    },
    {
      label: "النشطة",
      value: stats.active,
      hint: "الحسابات المفعلة.",
    },
    {
      label: "متوسط الصلاحيات",
      value: averagePermissions,
      hint: "مستوى التغطية الفعلية.",
    },
    {
      label: "الاستثناءات",
      value: exceptionCount,
      hint: "حسابات تحتاج مراجعة.",
    },
  ];
  const listStats = [
    {
      label: "إجمالي الحسابات",
      value: stats.total,
      hint: "كل حسابات الطاقم الظاهرة من مصدر الحسابات.",
    },
    {
      label: "الحسابات النشطة",
      value: stats.active,
      hint: "حسابات فعالة وعلى رأس العمل أو قابلة للدخول.",
    },
    {
      label: "متابعة الحالات",
      value: stats.inactive,
      hint: `المعطلون ${stats.inactive} · قيد المراجعة ${stats.pending} · غير مكتمل ${stats.incomplete}`,
    },
  ];

  const getDisplayName = (row: UserRow) =>
    firstText(row.displayName, row.employeeName, row.email) || "حساب غير مرتبط بموظفة";
  const getDisplayTitle = (row: UserRow) => firstText(row.jobTitle, getRoleLabel(row.role));
  const getDepartmentLabel = (row: UserRow) => firstText(row.department, "غير محدد");
  const renderListPage = () => (
    <>
      <header className="employee-accounts-v2__header">
        <div>
          <span className="employee-accounts-v2__eyebrow">إدارة الحسابات</span>
          <h1>إدارة حسابات الدخول</h1>
          <p>إدارة حسابات الدخول، الأدوار، والصلاحيات فقط. ملفات الموظفات الإدارية تبقى في إدارة الموظفين.</p>
        </div>

        <div className="employee-accounts-v2__actions">
          <button
            type="button"
            className="employee-accounts-v2__button employee-accounts-v2__button--primary"
            onClick={() => {
              setCreateMsg("");
              setCreateOpen(true);
            }}
          >
            حساب جديد
          </button>
          <button
            type="button"
            className="employee-accounts-v2__button"
            disabled={usersLoading}
            onClick={() => void loadUsers({ runRepair: true })}
          >
            {usersLoading ? "جار التحديث..." : "تحديث"}
          </button>
        </div>
      </header>

      <section className="employee-accounts-v2__stats" aria-label="إحصائيات الحسابات">
        {listStats.map((item) => (
          <article key={item.label} className="employee-accounts-v2__stat">
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.hint}</small>
          </article>
        ))}
      </section>

      {createMsg ? <div className={`accounts-banner accounts-banner--${bannerTone}`}>{createMsg}</div> : null}

      <section className="employee-directory-v2">
        <div className="employee-directory-v2__head">
          <div>
            <h2>قائمة حسابات الدخول</h2>
            <p>ابحث وفلتر حسب الحالة أو الدور أو الارتباط بسجل موظفة.</p>
          </div>
          <span>{visibleUsers.length} نتيجة</span>
        </div>

        <div className="employee-directory-v2__filters">
          <label className="employee-directory-v2__search">
            <span>بحث</span>
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="الاسم، البريد، الجوال، القسم، أو المسمى الوظيفي"
            />
          </label>

          <div className="employee-directory-v2__filterRow">
            <label>
              <span>الحالة</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as AccountStatusFilter)}>
                <option value="all">كل الحالات</option>
                <option value="active">نشطة</option>
                <option value="inactive">غير نشطة</option>
                <option value="pending">قيد المراجعة</option>
                <option value="archived">مؤرشفة</option>
                <option value="deleted">محذوفة منطقيًا</option>
              </select>
            </label>

            <label>
              <span>الدور</span>
              <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as UiRole | "all")}>
                <option value="all">كل الأدوار</option>
                <option value="owner">Owner</option>
                <option value="admin">Admin</option>
                <option value="hr">HR</option>
                <option value="reception">Reception</option>
                <option value="staff">Staff</option>
                <option value="pending">Pending</option>
              </select>
            </label>

            <label>
              <span>الارتباط</span>
              <select value={linkFilter} onChange={(event) => setLinkFilter(event.target.value as AccountLinkFilter)}>
                <option value="all">الكل</option>
                <option value="linked">مرتبط بسجل موظفة</option>
                <option value="unlinked">غير مرتبط</option>
                <option value="incomplete">غير مكتمل</option>
              </select>
            </label>

            <button
              type="button"
              className="employee-accounts-v2__button employee-accounts-v2__button--ghost"
              onClick={() => {
                setSearchQuery("");
                setRoleFilter("all");
                setStatusFilter("all");
                setLinkFilter("all");
              }}
            >
              إعادة ضبط
            </button>
          </div>
        </div>

        {usersLoading ? (
          <div className="employee-directory-v2__skeletonGrid" aria-live="polite">
            {Array.from({ length: 8 }).map((_, index) => (
              <span key={index} className="employee-directory-v2__skeleton" />
            ))}
          </div>
        ) : null}

        {!usersLoading && !users.length ? (
          <div className="employee-directory-v2__empty">
            <strong>لا توجد حسابات موظفين</strong>
            <p>لم يتم العثور على أي حساب إداري يمكن عرضه من مصدر البيانات الحالي.</p>
          </div>
        ) : null}

        {!usersLoading && users.length > 0 && !visibleUsers.length ? (
          <div className="employee-directory-v2__empty">
            <strong>لا توجد نتائج مطابقة</strong>
            <p>جرّب تغيير البحث أو الفلاتر الحالية.</p>
          </div>
        ) : null}

        {!usersLoading && visibleUsers.length ? (
          <div className="employee-directory-v2__grid">
            {visibleUsers.map((row) => {
              const state = getUserState(row);
              const linked = hasLinkedEmployee(row);
              const incomplete = isIncompleteAccount(row);
              const displayName = getDisplayName(row);
              return (
                <article
                  key={row.uid}
                  className={`employee-mini-card ${linked ? "" : "is-unlinked"}`}
                  tabIndex={0}
                  role="button"
                  onClick={() => navigate(`${usersBasePath}/${encodeURIComponent(row.uid)}`)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      navigate(`${usersBasePath}/${encodeURIComponent(row.uid)}`);
                    }
                  }}
                >
                  <div className="employee-mini-card__media">
                    <EmployeeAvatar src={row.avatarUrl} name={displayName} alt={displayName} loading="lazy" />
                  </div>

                  <div className="employee-mini-card__body">
                    <div className="employee-mini-card__top">
                      <div>
                        <h3>{displayName}</h3>
                        <p>{getDisplayTitle(row)}</p>
                      </div>
                      <span className="employee-mini-card__arrow" aria-hidden="true">‹</span>
                    </div>

                    <div className="employee-mini-card__meta">
                      <span className={`employee-status-dot is-${state}`}>{getUserStateLabel(state)}</span>
                      <span>{getDepartmentLabel(row)}</span>
                    </div>

                    {!linked || incomplete ? (
                      <div className="employee-mini-card__warning">
                        <strong>حساب غير مرتبط بموظفة</strong>
                        <small>{row.email || "لا يوجد بريد"} · {getRoleLabel(row.role)}</small>
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </section>
    </>
  );

  const renderProfilePage = () => {
    if (usersLoading && !profileUser) {
      return (
        <section className="employee-profile-v2 employee-profile-v2--loading">
          <div className="employee-directory-v2__empty">جاري تحميل حساب الدخول...</div>
        </section>
      );
    }

    if (!profileUser) {
      return (
        <section className="employee-profile-v2">
          <button type="button" className="employee-accounts-v2__button" onClick={() => navigate(usersBasePath)}>
            العودة إلى القائمة
          </button>
          <div className="employee-directory-v2__empty">
            <strong>تعذر العثور على الحساب</strong>
            <p>قد يكون الحساب خارج الفلاتر أو لا تملك صلاحية عرضه.</p>
          </div>
        </section>
      );
    }

    const state = getUserState(profileUser);
    const linked = hasLinkedEmployee(profileUser);
    const displayName = getDisplayName(profileUser);
    const linkedEmployeePath = profileEmployeeId
      ? `/admin/employees/${encodeURIComponent(profileEmployeeId)}/basic`
      : "";
    const accountSections = [
      { label: "ملخص الحساب", href: "#account-summary" },
      { label: "إعدادات الدخول", href: "#account-settings" },
      { label: "الربط الوظيفي", href: "#employee-link" },
      { label: "البيانات التقنية", href: "#account-technical" },
    ];
    const rowCanRestore = canRestoreUserAccount(profileUser);

    return (
      <section className="employee-profile-v2">
        <button type="button" className="employee-profile-v2__back" onClick={() => navigate(usersBasePath)}>
          العودة إلى حسابات الدخول
        </button>

        <header className="employee-profile-v2__hero">
          <div className="employee-profile-v2__identity">
            <span className="employee-profile-v2__avatar">
              <EmployeeAvatar src={profileUser.avatarUrl} name={displayName} alt={displayName} loading="eager" />
            </span>
            <div>
              <span className="employee-accounts-v2__eyebrow">حساب الدخول</span>
              <h1>{displayName}</h1>
              <p>{getDisplayTitle(profileUser)} · {getDepartmentLabel(profileUser)}</p>
              <div className="employee-profile-v2__chips">
                <span className={`employee-status-dot is-${state}`}>{getUserStateLabel(state)}</span>
                <span>{linked ? "مرتبط بسجل موظفة" : "حساب غير مرتبط بموظفة"}</span>
                <span>رقم الموظف: {profileUser.employeeNo || shortUid(profileUser.uid)}</span>
              </div>
            </div>
          </div>

          <div className="employee-profile-v2__heroActions">
            <button
              type="button"
              className="employee-accounts-v2__button employee-accounts-v2__button--primary"
              disabled={!profileCanMutate}
              onClick={() => {
                setSelectedUserId(profileUser.uid);
                openEditUser(profileUser);
              }}
            >
              تعديل الحساب
            </button>
            {linkedEmployeePath ? (
              <button type="button" className="employee-accounts-v2__button" onClick={() => navigate(linkedEmployeePath)}>
                فتح ملف الموظفة الإداري
              </button>
            ) : (
              <button type="button" className="employee-accounts-v2__button" disabled>
                حساب غير مرتبط بسجل موظفة
              </button>
            )}
          </div>
        </header>

        <nav className="employee-profile-v2__tabs" aria-label="أقسام حساب الدخول">
          {accountSections.map((tab) => (
            <button
              key={tab.label}
              type="button"
              onClick={() => {
                document.querySelector(tab.href)?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="employee-profile-v2__grid" id="account-summary">
          <article className="employee-profile-v2__panel employee-profile-v2__panel--summary">
            <div className="employee-profile-v2__panelHead">
              <div>
                <h2>ملخص الحساب</h2>
                <p>بيانات حساب الدخول وحالة الربط بسجل الموظفة كما هي مخزنة حاليًا.</p>
              </div>
            </div>

            <div className="employee-profile-v2__facts">
              {[
                ["الاسم", displayName],
                ["البريد", profileUser.email || "—"],
                ["الجوال", profileUser.phone || "—"],
                ["تاريخ بداية العمل", profileUser.startDate || "—"],
                ["رقم البصمة", profileUser.fingerprintNo || "—"],
                ["القسم", getDepartmentLabel(profileUser)],
                ["المسمى الوظيفي", getDisplayTitle(profileUser)],
                ["الحالة الوظيفية", profileUser.employmentStatus || getUserStateSummary(state)],
                ["حالة حساب الدخول", getUserStateLabel(state)],
              ].map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </article>

          <article className="employee-profile-v2__panel" id="account-settings">
            <div className="employee-profile-v2__panelHead">
              <div>
                <h2>إعدادات الحساب</h2>
                <p>إجراءات الدخول والصلاحيات بدون تعديل ملف الموظفة الإداري.</p>
              </div>
            </div>

            <div className="employee-profile-v2__accountActions">
              <button
                type="button"
                className="employee-accounts-v2__button"
                disabled={!profileCanMutate}
                onClick={() => {
                  if (rowCanRestore) {
                    restoreUserAccount(profileUser.uid);
                    return;
                  }
                  toggleUserActive(profileUser.uid, !(profileUser.active !== false));
                }}
              >
                {rowCanRestore ? "استعادة الحساب" : profileUser.active !== false ? "تعطيل الحساب" : "تفعيل الحساب"}
              </button>
              <button
                type="button"
                className="employee-accounts-v2__button"
                disabled={profileUser.uid !== currentUid}
                title={profileUser.uid !== currentUid ? "فتح بوابة موظفة أخرى غير مدعوم من إدارة الحسابات." : undefined}
                onClick={() => navigate("/employee/overview")}
              >
                فتح بوابتي
              </button>
              <button
                type="button"
                className="employee-accounts-v2__button"
                onClick={() => navigate("/admin/messages")}
              >
                عرض الرسائل
              </button>
              <button
                type="button"
                className="employee-accounts-v2__button employee-accounts-v2__button--danger"
                disabled={!profileCanMutate || usersLoading}
                onClick={() => deleteUserAccount(profileUser.uid)}
              >
                حذف الحساب
              </button>
            </div>

            {!linked ? (
              <details className="employee-profile-v2__technical" id="account-technical" open>
                <summary>الحساب غير مرتبط بموظفة</summary>
                <p>راجع الحساب واربطه من ملف الموظفة في الموارد البشرية.</p>
                <dl>
                  <div><dt>الدور</dt><dd>{getRoleLabel(profileUser.role)}</dd></div>
                  <div><dt>البريد</dt><dd>{profileUser.email || "—"}</dd></div>
                  <div><dt>UID</dt><dd>{shortUid(profileUser.uid)}</dd></div>
                </dl>
              </details>
            ) : (
              <details className="employee-profile-v2__technical" id="account-technical">
                <summary>بيانات تقنية</summary>
                <dl>
                  <div><dt>UID</dt><dd>{shortUid(profileUser.uid)}</dd></div>
                  <div><dt>Employee ID</dt><dd>{profileEmployeeId || "—"}</dd></div>
                </dl>
              </details>
            )}
          </article>
        </div>

        <section className="employee-profile-v2__panel" id="employee-link">
          <div className="employee-profile-v2__panelHead">
            <div>
              <h2>الربط مع ملف الموظفة</h2>
              <p>هذه قراءة فقط من سجل الموظفة المرتبط. تعديل الراتب والحضور والإجازات والبيانات الإدارية يتم من إدارة الموظفين.</p>
            </div>
            {linkedEmployeePath ? (
              <button type="button" className="employee-accounts-v2__button" onClick={() => navigate(linkedEmployeePath)}>
                فتح ملف الموظفة في إدارة الموظفين
              </button>
            ) : null}
          </div>

          <div className="employee-profile-v2__formPreview">
            {[
              ["اسم الموظف", displayName],
              ["البريد", profileUser.email || "—"],
              ["رقم الجوال", profileUser.phone || "—"],
              ["المسمى الوظيفي", getDisplayTitle(profileUser)],
              ["القسم", getDepartmentLabel(profileUser)],
              ["تاريخ بداية العمل", profileUser.startDate || "—"],
              ["الحالة الوظيفية", profileUser.employmentStatus || getUserStateSummary(state)],
              ["رقم البصمة", profileUser.fingerprintNo || "—"],
              ["الدور والصلاحيات", `${getRoleLabel(profileUser.role)} · ${getUserPermissions(profileUser).length} صلاحية`],
              ["حالة الحساب", getUserStateLabel(state)],
              ["الملاحظات الإدارية", profileUser.notes || "—"],
            ].map(([label, value]) => (
              <label key={label}>
                <span>{label}</span>
                <input value={value} readOnly />
              </label>
            ))}
          </div>
        </section>

      </section>
    );
  };

  /* =========================
     Render
  ========================= */
  if (authLoading) {
    return (
      <div className="accounts-page accounts-page--settings" dir="rtl">
        <div className="accounts-shell accounts-shell--loading">
          <SettingsState
            title="جاري تحميل الحسابات…"
            hint="نقرأ الجلسة والصلاحيات ثم نحمّل القائمة المرتبطة بالحساب الحالي."
            loading
          />
        </div>
      </div>
    );
  }

  if (!canManageUsers) {
    return (
      <div className="accounts-page accounts-page--settings" dir="rtl">
        <div className="accounts-shell">
          <SettingsState
            title="غير مصرح"
            hint={
              <>
                هذه الصفحة مخصصة للمالك وHR، أو للأدمن إذا كان خيار إدارة الحسابات مفعّلًا من إعدادات
                النظام.
                <br />
                تأكد من دور الحساب داخل <code>salons/main/users/{`{uid}`}</code> أو انتقل من لوحة الموارد
                البشرية إذا كنت HR.
              </>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="accounts-page accounts-page--settings" dir="rtl">
      <div className="accounts-shell">
        <div className="employee-accounts-v2">
          {profileUid ? renderProfilePage() : renderListPage()}
        </div>
      {createOpen ? (
        <div className="accounts-modal" role="dialog" aria-modal="true">
          <button
            type="button"
            className="accounts-modal__backdrop"
            aria-label="إغلاق"
            onClick={() => setCreateOpen(false)}
          />

          <div className="accounts-modal__card accounts-modal__card--split">
            <div className="accounts-modal__head">
              <div>
                <span className="accounts-eyebrow">حساب جديد</span>
                <h2>إنشاء حساب إداري جديد</h2>
                <p>أضف حسابًا إداريًا جديدًا وحدد الدور والبيانات الأساسية من شاشة منظمة وواسعة.</p>
              </div>

              <button type="button" className="accounts-modal__close" onClick={() => setCreateOpen(false)}>
                ×
              </button>
            </div>

            <div className="accounts-modal__body">
              <aside className="accounts-modal__sidebar">
                <article className="accounts-modal__sidebar-card accounts-modal__sidebar-card--dark">
                  <span className="accounts-kicker">ملخص الإنشاء</span>
                  <h3>حساب إداري جديد</h3>
                  <p>سيُنشأ حساب Firebase Auth أولًا ثم يُحفظ الملف داخل `salons/main/users`، مع ربط الموظف تلقائيًا إذا كان الدور ضمن الطاقم.</p>
                  <div className="accounts-modal__summary-list">
                    <div className="accounts-modal__summary-item">
                      <span>الدور الحالي</span>
                      <strong>{createForm.role.toUpperCase()}</strong>
                    </div>
                    <div className="accounts-modal__summary-item">
                      <span>الصلاحيات</span>
                      <strong>{createPermissionCount}</strong>
                    </div>
                    <div className="accounts-modal__summary-item">
                      <span>المصدر</span>
                      <strong>salons/main/users</strong>
                    </div>
                  </div>
                </article>

                <article className="accounts-modal__sidebar-card">
                  <span className="accounts-kicker">ملاحظات</span>
                  <p>البريد يجب أن ينتهي بـ @malikat.com، والدور Owner يبقى متاحًا فقط للمالك.</p>
                </article>
              </aside>

              <div className="accounts-modal__main">
                <div className="accounts-form-grid">
                  <label className="accounts-field">
                    <span>الاسم</span>
                    <input
                      value={createForm.displayName}
                      onChange={(e) => setCreateForm((prev) => ({ ...prev, displayName: e.target.value }))}
                      placeholder="مثال: أ. نور"
                    />
                  </label>

                  <label className="accounts-field">
                    <span>البريد</span>
                    <input
                      value={createForm.email}
                      onChange={(e) => setCreateForm((prev) => ({ ...prev, email: e.target.value }))}
                      placeholder="name@malikat.com"
                    />
                  </label>

                  <label className="accounts-field">
                    <span>كلمة المرور</span>
                    <input
                      type="password"
                      value={createForm.password}
                      onChange={(e) => setCreateForm((prev) => ({ ...prev, password: e.target.value }))}
                      placeholder="******"
                    />
                  </label>

                  <label className="accounts-field">
                    <span>الهاتف</span>
                    <input
                      value={createForm.phone}
                      onChange={(e) => setCreateForm((prev) => ({ ...prev, phone: e.target.value }))}
                      placeholder="05xxxxxxxx"
                    />
                  </label>

                  <label className="accounts-field">
                    <span>الدور</span>
                    <select
                      value={createForm.role}
                      onChange={(e) => setCreateForm((prev) => ({ ...prev, role: e.target.value as UiRole }))}
                    >
                      {isOwner ? <option value="owner">Owner</option> : null}
                      <option value="admin">Admin</option>
                      <option value="hr">HR</option>
                      <option value="reception">Reception</option>
                      <option value="staff">Staff</option>
                    </select>
                  </label>

                  <label className="accounts-field accounts-field--wide">
                    <span>ملاحظات</span>
                    <textarea
                      value={createForm.notes}
                      onChange={(e) => setCreateForm((prev) => ({ ...prev, notes: e.target.value }))}
                      placeholder="ملاحظات تشغيلية أو تعليمات خاصة..."
                    />
                  </label>
                </div>

                <div className="accounts-permission-preview">
                  <span>الصلاحيات المتوقعة لهذا الدور</span>
                  <div className="accounts-permission-preview__chips">
                    {PERMISSION_META.filter((item) => getRoleAppPermissions(createForm.role as any).includes(item.key)).map((permission) => (
                      <span key={permission.key} className="accounts-permission-preview__chip">
                        {permission.label}
                      </span>
                    ))}
                    {!createPermissionCount ? (
                      <span className="accounts-permission-preview__empty">لا توجد صلاحيات</span>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>

            <div className="accounts-modal__footer">
              <button
                type="button"
                className="accounts-btn"
                onClick={() => {
                  setCreateOpen(false);
                  setCreateForm({ displayName: "", email: "", password: "", phone: "", notes: "", role: "staff" });
                }}
              >
                إلغاء
              </button>
              <button
                type="button"
                className="accounts-btn accounts-btn--primary"
                disabled={createLoading}
                onClick={handleCreateUser}
              >
                {createLoading ? "جاري الإنشاء..." : "حفظ الحساب"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editDraft ? (
        <div className="accounts-modal" role="dialog" aria-modal="true">
          <button
            type="button"
            className="accounts-modal__backdrop"
            aria-label="إغلاق"
            onClick={() => setEditDraft(null)}
          />

          <div className="accounts-modal__card accounts-modal__card--split accounts-modal__card--edit">
            <div className="accounts-modal__head">
              <div>
                <span className="accounts-eyebrow">تعديل حساب</span>
                <h2>تعديل {editDraft.displayName || editDraft.email || "الحساب"}</h2>
                <p>يمكن تعديل الاسم، الهاتف، الدور، الحالة، والملاحظات من شاشة مرتبة وواسعة.</p>
              </div>

              <button type="button" className="accounts-modal__close" onClick={() => setEditDraft(null)}>
                ×
              </button>
            </div>

            <div className="accounts-modal__body">
              <aside className="accounts-modal__sidebar">
                <article className="accounts-modal__sidebar-card accounts-modal__sidebar-card--dark">
                  <span className="accounts-kicker">ملخص الحساب</span>
                  <div className="accounts-profile accounts-profile--modal">
                    <div className="accounts-avatar">
                      {cleanText(selectedUser?.displayName || selectedUser?.email || selectedUser?.uid).slice(0, 1) ||
                        "?"}
                    </div>

                    <div className="accounts-profile__copy">
                      <div className="accounts-inline-tags">
                        <span className={`accounts-chip accounts-chip--${selectedRoleTone}`}>{selectedRoleLabel}</span>
                        <span className={`accounts-chip accounts-chip--state accounts-chip--${selectedState}`}>
                          {selectedStateLabel}
                        </span>
                        <span className="accounts-chip accounts-chip--soft">ID: {editDraft.uid}</span>
                      </div>

                      <div className="accounts-modal__summary-list">
                        <div className="accounts-modal__summary-item">
                          <span>البريد</span>
                          <strong>{editDraft.email || "—"}</strong>
                        </div>
                        <div className="accounts-modal__summary-item">
                          <span>الصلاحيات</span>
                          <strong>{editDraft.permissions.length}</strong>
                        </div>
                        <div className="accounts-modal__summary-item">
                          <span>الحالة</span>
                          <strong>{editDraft.active ? "نشط" : "غير نشط"}</strong>
                        </div>
                      </div>
                    </div>
                  </div>
                </article>

                <article className="accounts-modal__sidebar-card">
                  <span className="accounts-kicker">ملاحظات التعديل</span>
                  <p>البريد مرتبط بحساب Firebase Auth لذلك يظهر للقراءة فقط، بينما بقية الحقول قابلة للتعديل.</p>
                </article>
              </aside>

              <div className="accounts-modal__main">
                <div className="accounts-form-grid">
                  <label className="accounts-field">
                    <span>الاسم</span>
                    <input
                      value={editDraft.displayName}
                      onChange={(e) => setEditDraft((prev) => (prev ? { ...prev, displayName: e.target.value } : prev))}
                    />
                  </label>

                  <label className="accounts-field">
                    <span>البريد</span>
                    <input value={editDraft.email} readOnly />
                  </label>

                  <label className="accounts-field">
                    <span>الهاتف</span>
                    <input
                      value={editDraft.phone}
                      onChange={(e) => setEditDraft((prev) => (prev ? { ...prev, phone: e.target.value } : prev))}
                    />
                  </label>

                  <label className="accounts-field">
                    <span>الدور</span>
                    <select
                      value={editDraft.role}
                      onChange={(e) =>
                        setEditDraft((prev) => {
                          if (!prev) return prev;
                          const role = e.target.value as UiRole;
                          if (!canAssignRole(role) && role !== prev.role) return prev;
                          return {
                            ...prev,
                            role,
                            active: role === "pending" ? false : prev.active,
                            permissions: getRoleAppPermissions(role as any),
                          };
                        })
                      }
                      disabled={!canEditTargetUser(selectedUser)}
                    >
                      {(["owner", "admin", "hr", "reception", "staff", "pending"] as UiRole[])
                        .filter((role) => role === editDraft.role || canAssignRole(role))
                        .map((role) => (
                          <option key={role} value={role}>
                            {getRoleLabel(role)}
                          </option>
                        ))}
                    </select>
                  </label>

                  <label className="accounts-field accounts-field--switch">
                    <span>الحالة</span>
                    <div className="accounts-switch">
                      <input
                        type="checkbox"
                        checked={editDraft.active}
                        onChange={(e) =>
                          setEditDraft((prev) => (prev ? { ...prev, active: e.target.checked } : prev))
                        }
                        disabled={!canEditTargetUser(selectedUser)}
                      />
                      <span>{editDraft.active ? "نشط" : "غير نشط"}</span>
                    </div>
                  </label>

                  <label className="accounts-field accounts-field--wide">
                    <span>ملاحظات</span>
                    <textarea
                      value={editDraft.notes}
                      onChange={(e) => setEditDraft((prev) => (prev ? { ...prev, notes: e.target.value } : prev))}
                    />
                  </label>
                </div>

                <section className="accounts-permissions-editor">
                  <div className="accounts-permissions-editor__head">
                    <div>
                      <span className="accounts-kicker">الصلاحيات الفعلية</span>
                      <h3>مفاتيح الوصول الجديدة</h3>
                      <p>اضغط على أي صلاحية لإضافتها أو إيقافها كاستثناء على الدور الأساسي.</p>
                    </div>
                    <div className="accounts-permissions-editor__stats">
                      <span>الدور: {editRoleDefaultPermissions.length}</span>
                      <span>الفعلية: {editDraft.permissions.length}</span>
                      <span>الاستثناءات: {editAddedPermissions + editDisabledDefaults}</span>
                    </div>
                  </div>

                  <div className="accounts-permissions-editor__toolbar">
                    <label className="accounts-permissions-editor__search">
                      <span>بحث داخل الصلاحيات</span>
                      <input
                        value={permissionSearch}
                        onChange={(event) => setPermissionSearch(event.target.value)}
                        placeholder="اكتب اسم الصلاحية أو المفتاح..."
                      />
                    </label>

                    <label className="accounts-permissions-editor__filter">
                      <span>القسم</span>
                      <select
                        value={permissionGroupFilter}
                        onChange={(event) =>
                          setPermissionGroupFilter(event.target.value as typeof permissionGroupFilter)
                        }
                      >
                        <option value="all">كل الأقسام</option>
                        {APP_PERMISSION_GROUPS.map((group) => (
                          <option key={group.key} value={group.key}>
                            {group.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {!canManagePermissions ? (
                    <div className="accounts-permissions-editor__notice">
                      يمكنك إدارة الحساب والدور، لكن تعديل الاستثناءات التفصيلية يتطلب صلاحية
                      <code>permissions.manage</code>.
                    </div>
                  ) : null}

                  <div className="accounts-permissions-editor__groups">
                    {visiblePermissionGroups.map((group) => {
                      const groupKeys = group.permissions.map((permission) => permission.key);
                      const enabledCount = groupKeys.filter((key) => editPermissionSet.has(key)).length;
                      const canEnableWholeGroup = groupKeys.every(
                        (key) => isOwner || actorPermissions.includes(key)
                      );

                      return (
                        <section key={group.key} className="accounts-permission-group">
                          <div className="accounts-permission-group__head">
                            <div>
                              <span>{group.label}</span>
                              <p>{group.hint}</p>
                            </div>
                            <div className="accounts-permission-group__actions">
                              <strong>{enabledCount}/{groupKeys.length}</strong>
                              <button
                                type="button"
                                className="accounts-btn accounts-btn--compact"
                                disabled={!canEditSelectedPermissions || !canEnableWholeGroup}
                                onClick={() =>
                                  setEditDraft((prev) => {
                                    if (!prev) return prev;
                                    const current = new Set(prev.permissions);
                                    const shouldEnable = groupKeys.some((key) => !current.has(key));
                                    groupKeys.forEach((key) => {
                                      if (!isOwner && !actorPermissions.includes(key)) return;
                                      if (shouldEnable) current.add(key);
                                      else current.delete(key);
                                    });
                                    const permissions = ALL_PERMISSION_META
                                      .map((item) => item.key)
                                      .filter((key) => current.has(key));
                                    return { ...prev, permissions };
                                  })
                                }
                              >
                                {enabledCount === groupKeys.length ? "إلغاء القسم" : "تحديد القسم"}
                              </button>
                            </div>
                          </div>

                          <div className="accounts-permissions-editor__grid">
                            {group.permissions.map((permission) => {
                              const isEnabled = editPermissionSet.has(permission.key);
                              const isDefault = editRoleDefaultPermissions.includes(permission.key);
                              const isAdded = isEnabled && !isDefault;
                              const isDisabledDefault = !isEnabled && isDefault;
                              const actorCanGrant = isOwner || actorPermissions.includes(permission.key);

                              return (
                                <button
                                  key={permission.key}
                                  type="button"
                                  className={[
                                    "accounts-permission-toggle",
                                    isEnabled ? "is-on" : "is-off",
                                    isDefault ? "is-default" : "",
                                    isAdded ? "is-added" : "",
                                    isDisabledDefault ? "is-disabled-default" : "",
                                    permission.sensitive ? "is-sensitive" : "",
                                  ]
                                    .filter(Boolean)
                                    .join(" ")}
                                  disabled={!canEditSelectedPermissions || !actorCanGrant}
                                  onClick={() =>
                                    setEditDraft((prev) => {
                                      if (!prev) return prev;
                                      const current = new Set(prev.permissions);
                                      if (current.has(permission.key)) current.delete(permission.key);
                                      else current.add(permission.key);
                                      const permissions = ALL_PERMISSION_META
                                        .map((item) => item.key)
                                        .filter((key) => current.has(key));
                                      return { ...prev, permissions };
                                    })
                                  }
                                >
                                  <span className="accounts-permission-toggle__dot" aria-hidden="true" />
                                  <span className="accounts-permission-toggle__copy">
                                    <strong>{permission.label}</strong>
                                    <small>{permission.key}</small>
                                    <em>{permission.hint}</em>
                                  </span>
                                  <span className="accounts-permission-toggle__state">
                                    {!actorCanGrant
                                      ? "خارج صلاحياتك"
                                      : isAdded
                                        ? "استثناء مضاف"
                                        : isDisabledDefault
                                          ? "متوقف"
                                          : isDefault
                                            ? "ضمن الدور"
                                            : isEnabled
                                              ? "مفعلة"
                                              : "غير مفعلة"}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        </section>
                      );
                    })}
                  </div>

                  {!visiblePermissionGroups.length ? (
                    <div className="accounts-permissions-editor__empty">لا توجد صلاحيات تطابق البحث الحالي.</div>
                  ) : null}

                  <div className="accounts-permissions-editor__actions">
                    <button
                      type="button"
                      className="accounts-btn"
                      disabled={!canEditSelectedPermissions}
                      onClick={() =>
                        setEditDraft((prev) =>
                          prev ? { ...prev, permissions: getRoleAppPermissions(prev.role as any) } : prev
                        )
                      }
                    >
                      استعادة صلاحيات الدور
                    </button>
                  </div>
                </section>
              </div>
            </div>

            <div className="accounts-modal__footer">
              <button type="button" className="accounts-btn" onClick={() => setEditDraft(null)}>
                إلغاء
              </button>
              <button
                type="button"
                className="accounts-btn accounts-btn--primary"
                disabled={usersLoading}
                onClick={() => void saveEditedUser()}
              >
                {usersLoading ? "جاري الحفظ..." : "حفظ التعديلات"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
    </div>
  );
}
