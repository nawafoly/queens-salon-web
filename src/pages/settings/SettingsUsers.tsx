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
import { deleteAdminAccountPermanently } from "../../services/adminAccountDeletionService";
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
  listEmployeeLinkRows,
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
  includeInEmployeeManagement?: boolean;
  employeeProfileEnabled?: boolean;
  employmentStatus?: string;
  accountStatus?: string;
  authStatus?: string;
  disabledAt?: unknown;
  disabledBy?: unknown;
  archivedAt?: unknown;
  archivedBy?: unknown;
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
type AccountLinkFilter = "all" | "visible" | "hidden" | "incomplete";
type AccountTypeFilter = "all" | "administrative" | "operational";

type EditUserDraft = {
  uid: string;
  displayName: string;
  email: string;
  phone: string;
  role: UiRole;
  active: boolean;
  includeInEmployeeManagement: boolean;
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
  const [accountTypeFilter, setAccountTypeFilter] = useState<AccountTypeFilter>("all");
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editDraft, setEditDraft] = useState<EditUserDraft | null>(null);
  const [permissionSearch, setPermissionSearch] = useState("");
  const [permissionGroupFilter, setPermissionGroupFilter] = useState<"all" | (typeof APP_PERMISSION_GROUPS)[number]["key"]>("all");
  const [editSection, setEditSection] = useState<"profile" | "employee" | "access">("profile");
  const [visibilitySavingUid, setVisibilitySavingUid] = useState("");

  const [createForm, setCreateForm] = useState({
    displayName: "",
    email: "",
    password: "",
    phone: "",
    notes: "",
    role: "staff" as UiRole,
    includeInEmployeeManagement: true,
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

  function isAdministrativeRole(role: UiRole) {
    return ["owner", "admin", "hr", "reception"].includes(role);
  }

  function isOperationalRole(role: UiRole) {
    return role === "staff";
  }

  function defaultEmployeeManagementVisibility(role: UiRole) {
    return isOperationalRole(role);
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

  function sourceDocId(source?: Record<string, unknown>) {
    if (!source) return "";
    return firstText(
      source["id"],
      source["employeeDocId"],
      source["linkedEmployeeDocId"],
      source["employeeId"]
    );
  }

  function roleFromEmployeeSource(source?: Record<string, unknown>): UiRole | null {
    if (!source) return null;
    const role = mapFirestoreRoleToUi(cleanText(source["role"]));
    return isEmployeeRole(role) ? role : null;
  }

  function resolveRestoredEmployeeRole(row: UserRow): UiRole {
    if (isEmployeeRole(row.role)) return row.role;
    return roleFromEmployeeSource(row.staffSource) || roleFromEmployeeSource(row.employeeSource) || "staff";
  }

  function resolveLinkedEmployeeDocId(row: UserRow) {
    return firstText(
      row.linkedEmployeeDocId,
      row.employeeId,
      sourceDocId(row.staffSource),
      sourceDocId(row.employeeSource),
      row.uid
    );
  }

  function isVisibleInEmployeeManagement(row: Pick<UserRow, "includeInEmployeeManagement" | "role">) {
    if (typeof row.includeInEmployeeManagement === "boolean") {
      return row.includeInEmployeeManagement;
    }
    return defaultEmployeeManagementVisibility(row.role);
  }

  function isIncompleteAccount(row: UserRow) {
    return (
      !cleanText(row.displayName) ||
      !cleanText(row.email) ||
      (isVisibleInEmployeeManagement(row) && !hasLinkedEmployee(row))
    );
  }

  function matchesLinkFilter(row: UserRow, filter: AccountLinkFilter) {
    if (filter === "all") return true;
    if (filter === "visible") return isVisibleInEmployeeManagement(row);
    if (filter === "hidden") return !isVisibleInEmployeeManagement(row);
    return isIncompleteAccount(row);
  }

  function matchesAccountTypeFilter(row: UserRow, filter: AccountTypeFilter) {
    if (filter === "all") return true;
    if (filter === "administrative") return isAdministrativeRole(row.role);
    return isOperationalRole(row.role);
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

  function hadFirebaseAuthDisabledMarker(row: Pick<UserRow, "accountStatus" | "authStatus" | "disabledAt">) {
    const accountStatus = cleanText(row.accountStatus).toLowerCase();
    const authStatus = cleanText(row.authStatus).toLowerCase();
    return (
      Boolean(row.disabledAt) ||
      accountStatus === "disabled" ||
      accountStatus === "auth_disabled" ||
      accountStatus === "firebase_disabled" ||
      authStatus === "disabled" ||
      authStatus === "auth_disabled" ||
      authStatus === "firebase_disabled"
    );
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
    includeInEmployeeManagement?: boolean;
    createIfMissing?: boolean;
    writeStaff?: boolean;
  }) => {
    const userRow = toAccountUserLinkRow(args.user);
    if (args.writeStaff === false) {
      return cleanText(userRow.linkedEmployeeDocId) || cleanText(userRow.employeeId) || null;
    }

    const [staffRows, employeeRows] = await Promise.all([
      listStaffLinkRows(),
      listEmployeeLinkRows().catch((error) => {
        console.error("syncLinkedStaffFromUser employee rows load error:", error);
        return [];
      }),
    ]);
    const matches = findStaffMatchesForUser(userRow, [...staffRows, ...employeeRows]);
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
    const includeInEmployeeManagement =
      typeof args.includeInEmployeeManagement === "boolean"
        ? args.includeInEmployeeManagement
        : defaultEmployeeManagementVisibility(args.role);
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
    const activeStatus = isEmployeeRole && args.active ? "active" : "inactive";
    const restoredStatePatch = {
      active: isEmployeeRole ? args.active : false,
      isActive: isEmployeeRole ? args.active : false,
      archived: false,
      deleted: false,
      removedFromStaff: false,
      employmentStatus: activeStatus,
      status: activeStatus,
      accountStatus: activeStatus,
      authStatus: "active",
      employeeProfileEnabled: includeInEmployeeManagement,
      includeInEmployeeManagement,
      disabledAt: null,
      disabledBy: null,
      archivedAt: null,
      archivedBy: null,
      deletedAt: null,
      deletedBy: null,
      updatedAt: serverTimestamp(),
    };
    const identityPatch = {
      uid: userRow.uid,
      linkedUid: userRow.uid,
      linkedUserId: userRow.uid,
      authUid: userRow.uid,
      userId: userRow.uid,
      employeeUid: userRow.uid,
      employeeId: staffId,
      employeeDocId: staffId,
      linkedEmployeeDocId: staffId,
    };
    const preservedStaffFields = {
      ...(Array.isArray(existing?.specialties) ? { specialties: existing.specialties } : {}),
      ...(cleanText(existing?.bio) ? { bio: cleanText(existing?.bio) } : {}),
      ...(cleanText(existing?.avatarUrl) ? { avatarUrl: cleanText(existing?.avatarUrl) } : {}),
      ...(cleanText(existing?.cvUrl) ? { cvUrl: cleanText(existing?.cvUrl) } : {}),
      ...(cleanText(existing?.department) ? { department: cleanText(existing?.department) } : {}),
      ...(cleanText(existing?.title) ? { title: cleanText(existing?.title) } : {}),
    };

    await setDoc(
      doc(db, ...STAFF_PUBLIC_COLLECTION, staffId),
      {
        ...identityPatch,
        ...(email ? { userEmail: email } : {}),
        ...(!cleanText(existing?.email) && email ? { email } : {}),
        name: displayName,
        role: nextRole,
        showOnAbout:
          includeInEmployeeManagement && isPublicStaffRole
            ? existing?.showOnAbout !== false
            : false,
        showOnBooking:
          includeInEmployeeManagement && isPublicStaffRole
            ? existing?.showOnBooking === true
            : false,
        ...preservedStaffFields,
        ...restoredStatePatch,
      },
      { merge: true }
    );

    await setDoc(
      doc(db, ...EMPLOYEES_COLLECTION, staffId),
      {
        ...identityPatch,
        ...(email ? { userEmail: email, email } : {}),
        name: displayName,
        role: nextRole,
        ...permissionPayload,
        showOnAbout:
          includeInEmployeeManagement && isPublicStaffRole
            ? existing?.showOnAbout !== false
            : false,
        showOnBooking:
          includeInEmployeeManagement && isPublicStaffRole
            ? existing?.showOnBooking === true
            : false,
        ...preservedStaffFields,
        ...restoredStatePatch,
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
          isActive: args.active,
          accountStatus: "active",
          authStatus: "active",
          includeInEmployeeManagement,
          employeeProfileEnabled: includeInEmployeeManagement,
          employeeId: staffId,
          linkedEmployeeDocId: staffId,
          disabledAt: null,
          disabledBy: null,
          archivedAt: null,
          archivedBy: null,
          deletedAt: null,
          deletedBy: null,
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
        includeInEmployeeManagement,
        employeeProfileEnabled: includeInEmployeeManagement,
        accountStatus: "active",
        authStatus: "active",
        disabledAt: null,
        disabledBy: null,
        archivedAt: null,
        archivedBy: null,
        deletedAt: null,
        deletedBy: null,
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
          includeInEmployeeManagement:
            typeof x?.includeInEmployeeManagement === "boolean"
              ? x.includeInEmployeeManagement
              : defaultEmployeeManagementVisibility(role),
          employeeProfileEnabled:
            typeof x?.employeeProfileEnabled === "boolean"
              ? x.employeeProfileEnabled
              : defaultEmployeeManagementVisibility(role),
          employmentStatus: String(x?.employmentStatus || ""),
          accountStatus: String(x?.accountStatus || ""),
          authStatus: String(x?.authStatus || ""),
          notes: String(x?.notes || x?.memo || ""),
          linkedEmployeeDocId: String(x?.linkedEmployeeDocId || ""),
          employeeId: String(x?.employeeId || ""),
          permissions,
          permissionOverrides,
          permissionVersion: Number(x?.permissionVersion || 0) || undefined,
          disabledAt: x?.disabledAt,
          disabledBy: x?.disabledBy,
          archivedAt: x?.archivedAt,
          archivedBy: x?.archivedBy,
          deletedAt: x?.deletedAt,
          deletedBy: x?.deletedBy,
          createdAt: x?.createdAt,
          updatedAt: x?.updatedAt,
        };
        const linkedStaff = findStaffMatchesForUser(toAccountUserLinkRow(baseRow), staffRows)[0] as Record<string, unknown> | undefined;
        const directLinkedEmployee =
          employeesByUid.get(baseRow.uid) ||
          employeesByEmail.get(cleanEmail(baseRow.email));
        const linkedEmployeeId =
          cleanText(baseRow.linkedEmployeeDocId) ||
          cleanText(baseRow.employeeId) ||
          cleanText(linkedStaff?.id) ||
          sourceDocId(directLinkedEmployee);
        const linkedEmployee =
          employeesById.get(linkedEmployeeId) ||
          directLinkedEmployee;
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
    const includeInEmployeeManagement = createForm.includeInEmployeeManagement === true;

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
          isActive: true,
          includeInEmployeeManagement,
          employeeProfileEnabled: includeInEmployeeManagement,
          createdAt: serverTimestamp(),
          createdByUid: (auth as any)?.currentUser?.uid || "",
          createdByEmail: (auth as any)?.currentUser?.email || "",
        },
        { merge: true }
      );

      // ملف الموظفة التشغيلي منفصل عن حساب الدخول ولا يُنشأ إلا عند تفعيل الخيار.
      if (includeInEmployeeManagement) {
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
          includeInEmployeeManagement,
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
          includeInEmployeeManagement,
        },
        meta: {
          role: toFirestoreRole(role),
          createdFrom: "settings_users",
        },
      });

      toastMsg("✅ تم إنشاء الحساب بنجاح", 1800);
      setCreateForm({
        displayName: "",
        email: "",
        password: "",
        phone: "",
        notes: "",
        role: "staff",
        includeInEmployeeManagement: true,
      });
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


  const updateEmployeeManagementVisibility = async (
    row: UserRow,
    includeInEmployeeManagement: boolean,
    options?: { quiet?: boolean }
  ) => {
    const isSelf = cleanText((auth as any)?.currentUser?.uid) === row.uid;
    if (!canEditTargetUser(row) && !(isSelf && isOwner)) {
      if (!options?.quiet) toastMsg("❌ لا تملك صلاحية تعديل ظهور هذا الحساب", 2200);
      return null;
    }

    const previousVisibility = isVisibleInEmployeeManagement(row);
    if (previousVisibility === includeInEmployeeManagement) {
      return resolveLinkedEmployeeDocId(row) || null;
    }

    const currentLinkedEmployeeId = resolveLinkedEmployeeDocId(row);
    const nextEmployeeId = currentLinkedEmployeeId || row.uid;

    // تحديث متفائل: المفتاح يتغير فورًا ولا يبقى عالقًا على حالة "جار الحفظ".
    setUsers((previous) =>
      previous.map((user) =>
        user.uid === row.uid
          ? {
              ...user,
              includeInEmployeeManagement,
              employeeProfileEnabled: includeInEmployeeManagement,
            }
          : user
      )
    );
    setVisibilitySavingUid(row.uid);

    const withTimeout = <T,>(task: Promise<T>, timeoutMs = 15000) =>
      new Promise<T>((resolve, reject) => {
        const timeoutId = window.setTimeout(
          () => reject(new Error("EMPLOYEE_VISIBILITY_SAVE_TIMEOUT")),
          timeoutMs
        );
        task.then(
          (value) => {
            window.clearTimeout(timeoutId);
            resolve(value);
          },
          (error) => {
            window.clearTimeout(timeoutId);
            reject(error);
          }
        );
      });

    try {
      let linkedEmployeeId: string | null = currentLinkedEmployeeId || null;

      if (includeInEmployeeManagement) {
        linkedEmployeeId = await withTimeout(
          syncLinkedStaffFromUser({
            user: {
              ...row,
              linkedEmployeeDocId: nextEmployeeId,
              employeeId: nextEmployeeId,
              includeInEmployeeManagement: true,
              employeeProfileEnabled: true,
            },
            role: row.role,
            active: row.active !== false,
            displayName: getDisplayName(row),
            permissions: getUserPermissions(row),
            permissionOverrides: row.permissionOverrides,
            includeInEmployeeManagement: true,
            createIfMissing: true,
            writeStaff: true,
          })
        );
      } else {
        const visibilityPatch = {
          includeInEmployeeManagement: false,
          employeeProfileEnabled: false,
          updatedAt: serverTimestamp(),
        };
        const hiddenPatch = {
          ...visibilityPatch,
          showOnAbout: false,
          showOnBooking: false,
        };

        // تنفذ كل عمليات الإخفاء معًا بدل انتظار كل مجموعة على حدة.
        await withTimeout(
          Promise.all([
            setDoc(doc(db, ...USERS_COLLECTION, row.uid), visibilityPatch, { merge: true }),
            setDoc(
              doc(db, "salons", SALON_ID, "admin_users", row.uid),
              {
                uid: row.uid,
                email: row.email || "",
                displayName: row.displayName || "",
                role: toFirestoreRole(row.role),
                ...visibilityPatch,
              },
              { merge: true }
            ),
            setDoc(doc(db, ...STAFF_PUBLIC_COLLECTION, nextEmployeeId), hiddenPatch, { merge: true }),
            setDoc(doc(db, ...EMPLOYEES_COLLECTION, nextEmployeeId), hiddenPatch, { merge: true }),
          ])
        );
      }

      setUsers((previous) =>
        previous.map((user) =>
          user.uid === row.uid
            ? {
                ...user,
                includeInEmployeeManagement,
                employeeProfileEnabled: includeInEmployeeManagement,
                linkedEmployeeDocId: linkedEmployeeId || user.linkedEmployeeDocId,
                employeeId: linkedEmployeeId || user.employeeId,
              }
            : user
        )
      );

      void writeAuditLog({
        salonId: SALON_ID,
        action: "user_updated",
        entityType: "user",
        entityId: row.uid,
        description: includeInEmployeeManagement
          ? "تم إظهار الحساب في إدارة الموظفات"
          : "تم إخفاء الحساب من إدارة الموظفات",
        source: "dashboard",
        before: {
          includeInEmployeeManagement: previousVisibility,
        },
        after: {
          includeInEmployeeManagement,
        },
        meta: {
          field: "includeInEmployeeManagement",
        },
      });

      if (!options?.quiet) {
        toastMsg(
          includeInEmployeeManagement
            ? "✅ ظهر الحساب الآن ضمن إدارة الموظفات"
            : "✅ تم إخفاء الحساب من إدارة الموظفات",
          1800
        );
      }

      return linkedEmployeeId;
    } catch (error) {
      console.error("updateEmployeeManagementVisibility error:", error);

      // عند فشل الحفظ نعيد المفتاح إلى وضعه الحقيقي السابق بدل ترك واجهة مضللة.
      setUsers((previous) =>
        previous.map((user) =>
          user.uid === row.uid
            ? {
                ...user,
                includeInEmployeeManagement: previousVisibility,
                employeeProfileEnabled: previousVisibility,
              }
            : user
        )
      );

      if (options?.quiet) throw error;
      const timedOut = error instanceof Error && error.message === "EMPLOYEE_VISIBILITY_SAVE_TIMEOUT";
      toastMsg(
        timedOut
          ? "❌ تأخر تأكيد الحفظ. أعد المحاولة بعد تحديث الصفحة"
          : "❌ تعذر تحديث الظهور في إدارة الموظفات",
        3000
      );
      return null;
    } finally {
      setVisibilitySavingUid((current) => (current === row.uid ? "" : current));
    }
  };

  const saveEditedUser = async () => {
    if (!canManageUsers || !editDraft) return;

    const row = users.find((item) => item.uid === editDraft.uid);
    if (!row) return;

    const editingSelf = cleanText((auth as any)?.currentUser?.uid) === row.uid;
    const canEditBasics = canEditTargetUser(row) || (editingSelf && isOwner);
    if (!canEditBasics) {
      toastMsg("❌ لا تملك صلاحية تعديل هذا الحساب", 2400);
      return;
    }

    const displayName = editDraft.displayName.trim();
    const phone = editDraft.phone.trim();
    const notes = editDraft.notes.trim();
    const role = editingSelf ? row.role : editDraft.role;
    const active = editingSelf
      ? row.active !== false
      : role === "pending"
        ? false
        : editDraft.active !== false;
    const includeInEmployeeManagement = editDraft.includeInEmployeeManagement === true;

    if (!editingSelf && role !== row.role && !canAssignRole(role)) {
      toastMsg("❌ لا يمكنك تعيين هذا الدور", 2200);
      return;
    }

    const requestedPermissions = ALL_PERMISSION_META
      .map((item) => item.key)
      .filter((permission) => editDraft.permissions.includes(permission));
    const permissions = editingSelf
      ? getUserPermissions(row)
      : canManagePermissions
        ? requestedPermissions
        : role === row.role
          ? getUserPermissions(row)
          : getRoleAppPermissions(role as any);
    const permissionOverrides = editingSelf
      ? row.permissionOverrides || buildPermissionOverrides(role as any, permissions)
      : buildPermissionOverrides(role as any, permissions);

    if (!displayName) {
      toastMsg("❌ الاسم لا يمكن أن يكون فارغًا", 2000);
      return;
    }

    if (role === "owner" && !isOwner) {
      toastMsg("❌ فقط المالك يقدر يمنح دور المالك", 2200);
      return;
    }

    try {
      setUsersLoading(true);

      const nextRole = toFirestoreRole(role);
      const visibilityChanged =
        isVisibleInEmployeeManagement(row) !== includeInEmployeeManagement;
      let linkedEmployeeId = resolveLinkedEmployeeDocId(row);

      const accountPatch = {
        displayName,
        phone,
        notes,
        role: nextRole,
        permissions,
        permissionOverrides,
        permissionVersion: PERMISSION_SCHEMA_VERSION,
        active,
        isActive: active,
        includeInEmployeeManagement,
        employeeProfileEnabled: includeInEmployeeManagement,
        updatedAt: serverTimestamp(),
      };

      await Promise.all([
        setDoc(doc(db, ...USERS_COLLECTION, row.uid), accountPatch, { merge: true }),
        setDoc(
          doc(db, "salons", SALON_ID, "admin_users", row.uid),
          {
            uid: row.uid,
            email: row.email || editDraft.email,
            ...accountPatch,
          },
          { merge: true }
        ),
      ]);

      if (editingSelf && (auth as any)?.currentUser) {
        await updateProfile((auth as any).currentUser, { displayName }).catch((error) => {
          console.warn("update current auth profile displayName failed:", error);
        });
      }

      if (visibilityChanged) {
        linkedEmployeeId =
          (await updateEmployeeManagementVisibility(
            {
              ...row,
              displayName,
              phone,
              notes,
              role,
              active,
              isActive: active,
              permissions,
              permissionOverrides,
              includeInEmployeeManagement,
              employeeProfileEnabled: includeInEmployeeManagement,
            },
            includeInEmployeeManagement,
            { quiet: true }
          )) || linkedEmployeeId;
      }

      setUsers((previous) =>
        previous.map((user) =>
          user.uid === row.uid
            ? {
                ...user,
                displayName,
                phone,
                notes,
                role,
                permissions,
                permissionOverrides,
                active,
                isActive: active,
                includeInEmployeeManagement,
                employeeProfileEnabled: includeInEmployeeManagement,
                linkedEmployeeDocId: linkedEmployeeId || user.linkedEmployeeDocId,
                employeeId: linkedEmployeeId || user.employeeId,
              }
            : user
        )
      );

      void writeAuditLog({
        salonId: SALON_ID,
        action: "user_updated",
        entityType: "user",
        entityId: row.uid,
        description: editingSelf ? "تم تحديث إعدادات حساب المالك" : "تم حفظ تعديلات الحساب",
        source: "dashboard",
        before: {
          displayName: row.displayName || null,
          phone: row.phone || null,
          role: row.role,
          active: row.active,
          notes: row.notes || null,
          permissions: row.permissions || [],
          includeInEmployeeManagement: isVisibleInEmployeeManagement(row),
        },
        after: {
          displayName,
          phone,
          role,
          active,
          notes: notes || null,
          permissions,
          includeInEmployeeManagement,
        },
        meta: {
          field: "account_profile",
          editingSelf,
        },
      });

      toastMsg("✅ تم حفظ إعدادات الحساب", 1600);
      setEditDraft(null);
    } catch (error) {
      console.error("saveEditedUser error:", error);
      toastMsg("❌ تعذر حفظ التعديلات", 2600);
    } finally {
      setUsersLoading(false);
    }
  };

  const openEditUser = (row: UserRow) => {
    setCreateMsg("");
    setPermissionSearch("");
    setPermissionGroupFilter("all");
    setEditSection("profile");
    setEditDraft({
      uid: row.uid,
      displayName: row.displayName || "",
      email: row.email || "",
      phone: row.phone || "",
      role: row.role,
      active: row.active !== false,
      includeInEmployeeManagement: isVisibleInEmployeeManagement(row),
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
      `حذف نهائي لحساب الدخول من Firebase Authentication وCloudflare D1.\n\nالحساب: ${row.email || uid}\n\nلن يتم حذف ملف الموظفة أو الحجوزات أو الحضور أو الرواتب. لا يمكن استعادة الحساب بعد المتابعة.`
    );
    if (!ok) return;

    try {
      setUsersLoading(true);
      const actorUid = String((auth as any)?.currentUser?.uid || "").trim();
      await deleteAdminAccountPermanently(uid);
      setUsers((prev) => prev.filter((u) => u.uid !== uid));
      if (selectedUserId === uid) setSelectedUserId("");
      if (editDraft?.uid === uid) setEditDraft(null);

      void writeAuditLog({
        salonId: SALON_ID,
        action: "user_deleted",
        entityType: "user",
        entityId: uid,
        description: "تم حذف حساب الدخول نهائيًا من Firebase وCloudflare",
        source: "dashboard",
        before: {
          email: row.email || null,
          role: row.role,
          active: row.active,
          linkedEmployeeDocId: row.linkedEmployeeDocId || row.employeeId || null,
        },
        after: {
          accountDeletedPermanently: true,
          authDeleted: true,
          coreD1Deleted: true,
          staffFileChanged: false,
        },
        meta: { actorUid },
      });

      toastMsg("✅ تم حذف حساب الدخول نهائيًا من السيرفر", 2600);
    } catch (e: any) {
      console.error("deleteUserAccount error:", e);
      const message = String(e?.message || "");
      if (message.includes("permission") || message.includes("صلاحية")) {
        toastMsg("❌ ليست لديك صلاحية الحذف النهائي", 2800);
      } else if (message.includes("login") || message.includes("جلسة")) {
        toastMsg("❌ انتهت جلسة الدخول. سجّل الدخول ثم أعد المحاولة", 3000);
      } else {
        toastMsg("❌ تعذر إكمال الحذف النهائي. لم يتم حذف ملف الموظفة", 3000);
      }
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
      const restoredRole = resolveRestoredEmployeeRole(row);
      let restoredEmployeeId = resolveLinkedEmployeeDocId(row);
      const displayName = firstText(row.displayName, row.employeeName, row.email, "موظفة");
      const restoredPermissions =
        row.role === restoredRole
          ? getUserPermissions(row)
          : getRoleAppPermissions(restoredRole as any);
      const restoredPermissionOverrides =
        row.role === restoredRole && row.permissionOverrides
          ? row.permissionOverrides
          : buildPermissionOverrides(restoredRole as any, restoredPermissions);
      const authDisabledNeedsManualAction = hadFirebaseAuthDisabledMarker(row);
      const restoredVisibility = isVisibleInEmployeeManagement(row);

      const restorePatch = {
        uid,
        email: cleanEmail(row.email || ""),
        displayName,
        name: displayName,
        role: toFirestoreRole(restoredRole),
        permissions: restoredPermissions,
        permissionOverrides: restoredPermissionOverrides,
        permissionVersion: PERMISSION_SCHEMA_VERSION,
        active: true,
        isActive: true,
        archived: false,
        deleted: false,
        removedFromStaff: false,
        employmentStatus: "active",
        status: "active",
        accountStatus: "active",
        authStatus: "active",
        employeeProfileEnabled: restoredVisibility,
        includeInEmployeeManagement: restoredVisibility,
        linkedEmployeeDocId: restoredEmployeeId,
        employeeId: restoredEmployeeId,
        disabledAt: null,
        disabledBy: null,
        archivedAt: null,
        archivedBy: null,
        deletedAt: null,
        deletedBy: null,
        updatedAt: serverTimestamp(),
      };

      await Promise.all([
        setDoc(doc(db, ...USERS_COLLECTION, uid), restorePatch, { merge: true }),
        setDoc(doc(db, "salons", SALON_ID, "admin_users", uid), restorePatch, { merge: true }),
      ]);

      const restoredStaffId = restoredVisibility
        ? await syncLinkedStaffFromUser({
            user: {
              uid: row.uid,
              email: row.email,
              phone: row.phone || "",
              displayName,
              role: restoredRole,
              active: true,
              permissions: restoredPermissions,
              permissionOverrides: restoredPermissionOverrides,
              linkedEmployeeDocId: restoredEmployeeId,
              employeeId: restoredEmployeeId,
              includeInEmployeeManagement: restoredVisibility,
              employeeProfileEnabled: restoredVisibility,
            },
            role: restoredRole,
            active: true,
            displayName,
            permissions: restoredPermissions,
            permissionOverrides: restoredPermissionOverrides,
            includeInEmployeeManagement: restoredVisibility,
            createIfMissing: true,
            writeStaff: true,
          })
        : restoredEmployeeId;
      const finalEmployeeId = restoredStaffId || restoredEmployeeId;

      setUsers((prev) =>
        prev.map((u) =>
          u.uid === uid
            ? {
                ...u,
                role: restoredRole,
                permissions: restoredPermissions,
                permissionOverrides: restoredPermissionOverrides,
                active: true,
                isActive: true,
                archived: false,
                deleted: false,
                removedFromStaff: false,
                employmentStatus: "active",
                accountStatus: "active",
                authStatus: "active",
                employeeProfileEnabled: restoredVisibility,
                includeInEmployeeManagement: restoredVisibility,
                linkedEmployeeDocId: finalEmployeeId,
                employeeId: finalEmployeeId,
                disabledAt: null,
                disabledBy: null,
                archivedAt: null,
                archivedBy: null,
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
        description: "تمت استعادة حساب الدخول دون تعديل ملف الموظفة",
        source: "dashboard",
        before: {
          role: row.role,
          active: row.active,
          archived: row.archived === true,
          deleted: row.deleted === true || Boolean(row.deletedAt),
          employmentStatus: row.employmentStatus || null,
          linkedEmployeeDocId: row.linkedEmployeeDocId || row.employeeId || null,
        },
        after: {
          role: restoredRole,
          active: true,
          staffFileChanged: Boolean(finalEmployeeId),
          restoredStaffId: finalEmployeeId || null,
          authManualActionRequired: authDisabledNeedsManualAction || null,
        },
      });

      await loadUsers();
      window.dispatchEvent(new Event("queens:staff-updated"));

      toastMsg(
        authDisabledNeedsManualAction
          ? "تمت استعادة ملف الموظفة، لكن حساب الدخول معطل في Firebase Authentication ويحتاج تفعيله يدويًا."
          : "✅ تمت استعادة الحساب وملف الموظفة بالكامل",
        authDisabledNeedsManualAction ? 5200 : 2200
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
        if (!matchesAccountTypeFilter(user, accountTypeFilter)) return false;

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
  }, [users, roleFilter, searchQuery, statusFilter, linkFilter, accountTypeFilter]);

  const selectedUser = useMemo(() => {
    if (!selectedUserId) return visibleUsers[0] || null;
    return visibleUsers.find((user) => user.uid === selectedUserId) || visibleUsers[0] || null;
  }, [selectedUserId, visibleUsers]);

  const editTargetUser = useMemo(
    () => (editDraft ? users.find((user) => user.uid === editDraft.uid) || null : null),
    [editDraft, users]
  );

  const stats = useMemo(() => {
    const total = users.length;
    const active = users.filter((user) => getUserState(user) === "active").length;
    const inactive = users.filter((user) => matchesStatusFilter(user, "inactive")).length;
    const pending = users.filter((user) => getUserState(user) === "pending").length;
    const incomplete = users.filter((user) => isIncompleteAccount(user)).length;
    const unlinked = users.filter(
      (user) => isVisibleInEmployeeManagement(user) && !hasLinkedEmployee(user)
    ).length;
    const editors = users.filter((user) => ["owner", "hr", "admin"].includes(user.role)).length;
    const administrative = users.filter((user) => isAdministrativeRole(user.role)).length;
    const operational = users.filter((user) => isOperationalRole(user.role)).length;
    const visibleInEmployees = users.filter((user) => isVisibleInEmployeeManagement(user)).length;

    return {
      total,
      active,
      inactive,
      pending,
      incomplete,
      unlinked,
      editors,
      administrative,
      operational,
      visibleInEmployees,
    };
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

  const selectedState = editTargetUser ? getUserState(editTargetUser) : "inactive";
  const selectedStateLabel = getUserStateLabel(selectedState);
  const selectedRoleLabel = editTargetUser ? getRoleLabel(editTargetUser.role) : "-";
  const selectedRoleTone = editTargetUser ? getRoleTone(editTargetUser.role) : "gray";
  const createPermissionCount = getRoleAppPermissions(createForm.role as any).length;
  const invitePreviewPermissions = PERMISSION_META.filter((item) =>
    getRoleAppPermissions(inviteDraft.role as any).includes(item.key)
  );
  const currentUid = String((auth as any)?.currentUser?.uid || "");
  const selectedIsSelf = Boolean(editTargetUser && editTargetUser.uid === currentUid);
  const selectedCanEditBasics = Boolean(
    editTargetUser && (canEditTargetUser(editTargetUser) || (selectedIsSelf && isOwner))
  );
  const selectedCanControl = Boolean(
    editTargetUser && !selectedIsSelf && canEditTargetUser(editTargetUser)
  );
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
  const profileIsSelf = Boolean(profileUser && profileUser.uid === currentUid);
  const profileCanEditBasics = Boolean(
    profileUser && (canEditTargetUser(profileUser) || (profileIsSelf && isOwner))
  );
  const profileCanControl = Boolean(
    profileUser && !profileIsSelf && canEditTargetUser(profileUser)
  );
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
      editTargetUser &&
      selectedCanControl &&
      editTargetUser.role !== "owner" &&
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
  const getAccountTypeLabel = (row: UserRow) =>
    isAdministrativeRole(row.role) ? "حساب إداري" : "حساب موظفة تشغيلية";

  const canChangeVisibilityFor = (row: UserRow) => {
    const isSelf = row.uid === currentUid;
    return canEditTargetUser(row) || (isSelf && isOwner);
  };

  const renderListPage = () => (
    <div className="accounts-console-v3">
      <header className="accounts-console-v3__hero">
        <div className="accounts-console-v3__heroCopy">
          <span className="accounts-console-v3__eyebrow">الهوية والصلاحيات</span>
          <h1>إدارة حسابات الدخول</h1>
          <p>
            هذا القسم مخصص للحسابات فقط: الاسم، البريد، الدور، حالة الدخول والصلاحيات.
            الخدمات وأوقات العمل والحضور تبقى داخل إدارة الموظفات.
          </p>
          <div className="accounts-console-v3__separation">
            <span><b>إدارة الحسابات</b> دخول وصلاحيات</span>
            <span><b>إدارة الموظفات</b> خدمات وأوقات وتشغيل</span>
          </div>
        </div>

        <div className="accounts-console-v3__heroActions">
          <button
            type="button"
            className="accounts-console-v3__btn accounts-console-v3__btn--primary"
            onClick={() => {
              setCreateMsg("");
              setCreateOpen(true);
            }}
          >
            + إنشاء حساب
          </button>
          <button
            type="button"
            className="accounts-console-v3__btn"
            disabled={usersLoading}
            onClick={() => void loadUsers({ runRepair: true })}
          >
            {usersLoading ? "جار التحديث..." : "تحديث البيانات"}
          </button>
        </div>
      </header>

      <section className="accounts-console-v3__stats" aria-label="إحصائيات الحسابات">
        {[
          { label: "كل الحسابات", value: stats.total, hint: `${stats.active} نشطة` },
          { label: "حسابات إدارية", value: stats.administrative, hint: "مالك، إدارة، HR، استقبال" },
          { label: "حسابات تشغيلية", value: stats.operational, hint: "حسابات الموظفات العاملات" },
          { label: "ظاهرة في الموظفات", value: stats.visibleInEmployees, hint: `${stats.unlinked} تحتاج ربطًا` },
        ].map((item) => (
          <article key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.hint}</small>
          </article>
        ))}
      </section>

      {createMsg ? <div className={`accounts-banner accounts-banner--${bannerTone}`}>{createMsg}</div> : null}

      <section className="accounts-console-v3__directory">
        <div className="accounts-console-v3__directoryHead">
          <div>
            <h2>دليل الحسابات</h2>
            <p>اختر أي حساب لفتح مركز التحكم الكامل به.</p>
          </div>
          <span className="accounts-console-v3__count">{visibleUsers.length} حساب</span>
        </div>

        <div className="accounts-console-v3__filters">
          <label className="accounts-console-v3__search">
            <span>بحث سريع</span>
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="الاسم، البريد، الجوال أو UID"
            />
          </label>

          <label>
            <span>نوع الحساب</span>
            <select
              value={accountTypeFilter}
              onChange={(event) => setAccountTypeFilter(event.target.value as AccountTypeFilter)}
            >
              <option value="all">كل الحسابات</option>
              <option value="administrative">الحسابات الإدارية</option>
              <option value="operational">حسابات الموظفات</option>
            </select>
          </label>

          <label>
            <span>الدور</span>
            <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as UiRole | "all")}>
              <option value="all">كل الأدوار</option>
              <option value="owner">المالك</option>
              <option value="admin">الإدارة</option>
              <option value="hr">الموارد البشرية</option>
              <option value="reception">الاستقبال</option>
              <option value="staff">موظفة تشغيلية</option>
              <option value="pending">قيد المراجعة</option>
            </select>
          </label>

          <label>
            <span>حالة الدخول</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as AccountStatusFilter)}>
              <option value="all">كل الحالات</option>
              <option value="active">نشطة</option>
              <option value="inactive">غير نشطة</option>
              <option value="pending">قيد المراجعة</option>
              <option value="archived">مؤرشفة</option>
              <option value="deleted">محذوفة</option>
            </select>
          </label>

          <label>
            <span>إدارة الموظفات</span>
            <select value={linkFilter} onChange={(event) => setLinkFilter(event.target.value as AccountLinkFilter)}>
              <option value="all">الكل</option>
              <option value="visible">ظاهر في الموظفات</option>
              <option value="hidden">مخفي من الموظفات</option>
              <option value="incomplete">يحتاج إكمال</option>
            </select>
          </label>

          <button
            type="button"
            className="accounts-console-v3__reset"
            onClick={() => {
              setSearchQuery("");
              setRoleFilter("all");
              setStatusFilter("all");
              setLinkFilter("all");
              setAccountTypeFilter("all");
            }}
          >
            مسح الفلاتر
          </button>
        </div>

        <div className="accounts-console-v3__tableHead" aria-hidden="true">
          <span>الحساب</span>
          <span>النوع والدور</span>
          <span>حالة الدخول</span>
          <span>إدارة الموظفات</span>
          <span>الصلاحيات</span>
          <span />
        </div>

        {usersLoading ? (
          <div className="accounts-console-v3__loading" aria-live="polite">
            {Array.from({ length: 6 }).map((_, index) => <span key={index} />)}
          </div>
        ) : null}

        {!usersLoading && !users.length ? (
          <div className="accounts-console-v3__empty">
            <strong>لا توجد حسابات إدارية</strong>
            <p>أنشئ أول حساب دخول أو حدّث البيانات.</p>
          </div>
        ) : null}

        {!usersLoading && users.length > 0 && !visibleUsers.length ? (
          <div className="accounts-console-v3__empty">
            <strong>لا توجد نتائج مطابقة</strong>
            <p>غيّر البحث أو امسح الفلاتر الحالية.</p>
          </div>
        ) : null}

        {!usersLoading && visibleUsers.length ? (
          <div className="accounts-console-v3__rows">
            {visibleUsers.map((row) => {
              const state = getUserState(row);
              const displayName = getDisplayName(row);
              const visibleInEmployees = isVisibleInEmployeeManagement(row);
              const linked = hasLinkedEmployee(row);
              const canChangeVisibility = canChangeVisibilityFor(row);

              return (
                <article
                  key={row.uid}
                  className={`accounts-console-v3__row ${row.uid === currentUid ? "is-self" : ""}`}
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
                  <div className="accounts-console-v3__identity">
                    <EmployeeAvatar src={row.avatarUrl} name={displayName} alt={displayName} loading="lazy" />
                    <div>
                      <strong>{displayName}</strong>
                      <span>{row.email || "لا يوجد بريد"}</span>
                      {row.phone ? <small>{row.phone}</small> : null}
                    </div>
                  </div>

                  <div className="accounts-console-v3__role">
                    <strong>{getAccountTypeLabel(row)}</strong>
                    <span>{getRoleLabel(row.role)}</span>
                  </div>

                  <div>
                    <span className={`accounts-console-v3__status is-${state}`}>
                      {getUserStateLabel(state)}
                    </span>
                  </div>

                  <div className="accounts-console-v3__visibilityCell">
                    <button
                      type="button"
                      className={`accounts-console-v3__visibility ${visibleInEmployees ? "is-on" : "is-off"}`}
                      disabled={!canChangeVisibility || usersLoading || visibilitySavingUid === row.uid}
                      onClick={(event) => {
                        event.stopPropagation();
                        void updateEmployeeManagementVisibility(row, !visibleInEmployees);
                      }}
                    >
                      <i aria-hidden="true" />
                      <span>
                        <b>
                          {visibilitySavingUid === row.uid
                            ? "جار الحفظ..."
                            : visibleInEmployees
                              ? "ظاهر"
                              : "مخفي"}
                        </b>
                        <small>
                          {visibleInEmployees
                            ? linked
                              ? "ملف تشغيلي مرتبط"
                              : "سيتم إنشاء ملف تشغيلي"
                            : "حساب دخول فقط"}
                        </small>
                      </span>
                    </button>
                  </div>

                  <div className="accounts-console-v3__permissions">
                    <strong>{getUserPermissions(row).length}</strong>
                    <span>صلاحية</span>
                  </div>

                  <span className="accounts-console-v3__open" aria-hidden="true">←</span>
                </article>
              );
            })}
          </div>
        ) : null}
      </section>
    </div>
  );

  const renderProfilePage = () => {
    if (usersLoading && !profileUser) {
      return (
        <section className="account-console-v3 account-console-v3--loading">
          <div className="accounts-console-v3__empty">جاري تحميل الحساب...</div>
        </section>
      );
    }

    if (!profileUser) {
      return (
        <section className="account-console-v3">
          <button type="button" className="account-console-v3__back" onClick={() => navigate(usersBasePath)}>
            ← العودة إلى الحسابات
          </button>
          <div className="accounts-console-v3__empty">
            <strong>تعذر العثور على الحساب</strong>
            <p>قد يكون الحساب غير موجود أو لا تملك صلاحية عرضه.</p>
          </div>
        </section>
      );
    }

    const state = getUserState(profileUser);
    const displayName = getDisplayName(profileUser);
    const visibleInEmployees = isVisibleInEmployeeManagement(profileUser);
    const linked = hasLinkedEmployee(profileUser);
    const linkedEmployeePath =
      visibleInEmployees && profileEmployeeId
        ? `/admin/employees/${encodeURIComponent(profileEmployeeId)}/basic`
        : "";
    const rowCanRestore = canRestoreUserAccount(profileUser);
    const permissionsCount = getUserPermissions(profileUser).length;
    const accountTypeLabel = getAccountTypeLabel(profileUser);

    return (
      <section className="account-console-v3">
        <div className="account-console-v3__topbar">
          <button type="button" className="account-console-v3__back" onClick={() => navigate(usersBasePath)}>
            ← حسابات الدخول
          </button>
          <div className="account-console-v3__topbarMeta">
            {profileIsSelf ? <span className="account-console-v3__selfBadge">حسابي</span> : null}
            <span>آخر تحديث: {formatDate(profileUser.updatedAt)}</span>
          </div>
        </div>

        <header className="account-console-v3__hero">
          <div className="account-console-v3__identity">
            <span className="account-console-v3__avatar">
              <EmployeeAvatar src={profileUser.avatarUrl} name={displayName} alt={displayName} loading="eager" />
            </span>
            <div>
              <span className="account-console-v3__eyebrow">{accountTypeLabel}</span>
              <h1>{displayName}</h1>
              <p>{profileUser.email || "لا يوجد بريد مسجل"}</p>
              <div className="account-console-v3__chips">
                <span className={`account-console-v3__chip is-${state}`}>{getUserStateLabel(state)}</span>
                <span className="account-console-v3__chip">{getRoleLabel(profileUser.role)}</span>
                <span className="account-console-v3__chip">{permissionsCount} صلاحية</span>
              </div>
            </div>
          </div>

          <div className="account-console-v3__heroActions">
            <button
              type="button"
              className="account-console-v3__btn account-console-v3__btn--primary"
              disabled={!profileCanEditBasics}
              onClick={() => {
                setSelectedUserId(profileUser.uid);
                openEditUser(profileUser);
              }}
            >
              تعديل إعدادات الحساب
            </button>
            {linkedEmployeePath ? (
              <button
                type="button"
                className="account-console-v3__btn"
                onClick={() => navigate(linkedEmployeePath)}
              >
                فتح الملف التشغيلي
              </button>
            ) : null}
          </div>
        </header>

        <div className="account-console-v3__layout">
          <main className="account-console-v3__main">
            <article className="account-console-v3__panel">
              <div className="account-console-v3__panelHead">
                <div>
                  <span className="account-console-v3__sectionLabel">البيانات الأساسية</span>
                  <h2>معلومات حساب الدخول</h2>
                  <p>هذه هي البيانات الأساسية للحساب، وهي المكان الرئيسي لتعديل الاسم والجوال والملاحظات.</p>
                </div>
                <button
                  type="button"
                  className="account-console-v3__textBtn"
                  disabled={!profileCanEditBasics}
                  onClick={() => {
                    setSelectedUserId(profileUser.uid);
                    openEditUser(profileUser);
                  }}
                >
                  تعديل المعلومات
                </button>
              </div>

              <div className="account-console-v3__facts">
                <div>
                  <span>الاسم المعروض</span>
                  <strong>{displayName}</strong>
                </div>
                <div>
                  <span>البريد الإلكتروني</span>
                  <strong>{profileUser.email || "—"}</strong>
                  <small>معرّف تسجيل الدخول — لا يتغير من هذه الشاشة.</small>
                </div>
                <div>
                  <span>رقم الجوال</span>
                  <strong>{profileUser.phone || "—"}</strong>
                </div>
                <div>
                  <span>نوع الحساب</span>
                  <strong>{accountTypeLabel}</strong>
                </div>
                <div>
                  <span>الدور</span>
                  <strong>{getRoleLabel(profileUser.role)}</strong>
                </div>
                <div>
                  <span>الملاحظات</span>
                  <strong>{profileUser.notes || "لا توجد ملاحظات"}</strong>
                </div>
              </div>
            </article>

            <article className="account-console-v3__panel">
              <div className="account-console-v3__panelHead">
                <div>
                  <span className="account-console-v3__sectionLabel">الوصول</span>
                  <h2>الدور والصلاحيات</h2>
                  <p>حدد ما يستطيع الحساب الوصول إليه داخل لوحة التحكم.</p>
                </div>
                <button
                  type="button"
                  className="account-console-v3__textBtn"
                  disabled={!profileCanEditBasics}
                  onClick={() => {
                    setSelectedUserId(profileUser.uid);
                    openEditUser(profileUser);
                  }}
                >
                  إدارة الصلاحيات
                </button>
              </div>

              <div className="account-console-v3__accessSummary">
                <div>
                  <span>الدور الأساسي</span>
                  <strong>{getRoleLabel(profileUser.role)}</strong>
                </div>
                <div>
                  <span>الصلاحيات الفعلية</span>
                  <strong>{permissionsCount}</strong>
                </div>
                <div>
                  <span>حالة الدخول</span>
                  <strong>{getUserStateLabel(state)}</strong>
                </div>
              </div>

              {profileIsSelf ? (
                <div className="account-console-v3__notice">
                  يمكنك تعديل معلومات حسابك وظهوره في إدارة الموظفات. حمايةً للحساب الرئيسي، لا يمكنك تعطيل حسابك أو تغيير دورك من نفس الجلسة.
                </div>
              ) : null}
            </article>
          </main>

          <aside className="account-console-v3__aside">
            <article className="account-console-v3__controlCard account-console-v3__controlCard--featured">
              <div className="account-console-v3__controlHead">
                <div>
                  <span>إدارة الموظفات</span>
                  <h3>{visibleInEmployees ? "ظاهر كموظفة تشغيلية" : "حساب دخول فقط"}</h3>
                </div>
                <button
                  type="button"
                  className={`account-console-v3__switch ${visibleInEmployees ? "is-on" : "is-off"}`}
                  disabled={!profileCanEditBasics || usersLoading || visibilitySavingUid === profileUser.uid}
                  aria-pressed={visibleInEmployees}
                  onClick={() =>
                    void updateEmployeeManagementVisibility(profileUser, !visibleInEmployees)
                  }
                >
                  <i aria-hidden="true" />
                  <span>
                    {visibilitySavingUid === profileUser.uid
                      ? "جار الحفظ..."
                      : visibleInEmployees
                        ? "ظاهر"
                        : "مخفي"}
                  </span>
                </button>
              </div>
              <p>
                {visibleInEmployees
                  ? "يظهر هذا الحساب داخل إدارة الموظفات لإدارة الخدمات، أوقات العمل، الحضور والملف التشغيلي."
                  : "لن يظهر هذا الحساب في إدارة الموظفات. سيبقى حسابًا إداريًا للدخول والصلاحيات فقط."}
              </p>

              {visibleInEmployees ? (
                <div className={`account-console-v3__linkState ${linked ? "is-linked" : "is-unlinked"}`}>
                  <strong>{linked ? "الملف التشغيلي مرتبط" : "الملف التشغيلي يحتاج إنشاء"}</strong>
                  <span>{linked ? `Employee ID: ${profileEmployeeId}` : "سيُنشأ تلقائيًا عند تفعيل الظهور."}</span>
                </div>
              ) : null}

              {linkedEmployeePath ? (
                <button
                  type="button"
                  className="account-console-v3__btn account-console-v3__btn--full"
                  onClick={() => navigate(linkedEmployeePath)}
                >
                  فتح إدارة الموظفة
                </button>
              ) : null}
            </article>

            <article className="account-console-v3__controlCard">
              <div className="account-console-v3__controlHead">
                <div>
                  <span>حالة الدخول</span>
                  <h3>{getUserStateLabel(state)}</h3>
                </div>
                <span className={`account-console-v3__stateDot is-${state}`} />
              </div>
              <p>التحكم في إمكانية تسجيل الدخول إلى النظام.</p>
              <button
                type="button"
                className="account-console-v3__btn account-console-v3__btn--full"
                disabled={!profileCanControl || usersLoading}
                onClick={() => {
                  if (rowCanRestore) {
                    void restoreUserAccount(profileUser.uid);
                    return;
                  }
                  void toggleUserActive(profileUser.uid, !(profileUser.active !== false));
                }}
              >
                {profileIsSelf
                  ? "لا يمكن تعطيل حسابك الحالي"
                  : rowCanRestore
                    ? "استعادة الحساب"
                    : profileUser.active !== false
                      ? "تعطيل تسجيل الدخول"
                      : "تفعيل تسجيل الدخول"}
              </button>
            </article>

            <article className="account-console-v3__controlCard">
              <div className="account-console-v3__controlHead">
                <div>
                  <span>إجراءات الحساب</span>
                  <h3>إدارة آمنة</h3>
                </div>
              </div>
              <div className="account-console-v3__stackActions">
                {profileIsSelf ? (
                  <button
                    type="button"
                    className="account-console-v3__btn account-console-v3__btn--full"
                    onClick={() => navigate("/employee/overview")}
                  >
                    فتح بوابتي
                  </button>
                ) : null}
                <button
                  type="button"
                  className="account-console-v3__btn account-console-v3__btn--full"
                  onClick={() => navigate("/admin/messages")}
                >
                  عرض الرسائل
                </button>
                <button
                  type="button"
                  className="account-console-v3__btn account-console-v3__btn--danger account-console-v3__btn--full"
                  disabled={!profileCanControl || usersLoading}
                  onClick={() => void deleteUserAccount(profileUser.uid)}
                >
                  حذف الحساب
                </button>
              </div>
            </article>

            <details className="account-console-v3__technical">
              <summary>البيانات التقنية</summary>
              <dl>
                <div><dt>UID</dt><dd>{profileUser.uid || "—"}</dd></div>
                <div><dt>Employee ID</dt><dd>{profileEmployeeId || "غير مرتبط"}</dd></div>
                <div><dt>المصدر</dt><dd>salons/main/users</dd></div>
              </dl>
            </details>
          </aside>
        </div>
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
                <h2>إنشاء حساب دخول جديد</h2>
                <p>أنشئ الحساب أولًا، ثم قرر بشكل مستقل هل يحتاج ملفًا تشغيليًا داخل إدارة الموظفات.</p>
              </div>

              <button type="button" className="accounts-modal__close" onClick={() => setCreateOpen(false)}>
                ×
              </button>
            </div>

            <div className="accounts-modal__body">
              <aside className="accounts-modal__sidebar">
                <article className="accounts-modal__sidebar-card accounts-modal__sidebar-card--dark">
                  <span className="accounts-kicker">ملخص الإنشاء</span>
                  <h3>حساب دخول جديد</h3>
                  <p>الحساب والصلاحيات منفصلان عن ملف الموظفة التشغيلي. الظهور في إدارة الموظفات خيار مستقل أدناه.</p>
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
                      <span>إدارة الموظفات</span>
                      <strong>{createForm.includeInEmployeeManagement ? "ظاهر" : "مخفي"}</strong>
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
                      onChange={(e) =>
                        setCreateForm((prev) => {
                          const role = e.target.value as UiRole;
                          return {
                            ...prev,
                            role,
                            includeInEmployeeManagement: defaultEmployeeManagementVisibility(role),
                          };
                        })
                      }
                    >
                      {isOwner ? <option value="owner">Owner</option> : null}
                      <option value="admin">Admin</option>
                      <option value="hr">HR</option>
                      <option value="reception">Reception</option>
                      <option value="staff">Staff</option>
                    </select>
                  </label>

                  <label className="accounts-field accounts-field--wide accounts-field--visibility">
                    <span>الظهور في إدارة الموظفات</span>
                    <div className="accounts-visibility-choice">
                      <div>
                        <strong>
                          {createForm.includeInEmployeeManagement
                            ? "إنشاء ملف موظفة تشغيلي"
                            : "حساب دخول فقط"}
                        </strong>
                        <small>
                          {createForm.includeInEmployeeManagement
                            ? "سيظهر لإدارة الخدمات وأوقات العمل والحضور."
                            : "لن يظهر ضمن قائمة الموظفات."}
                        </small>
                      </div>
                      <button
                        type="button"
                        className={`account-console-v3__switch ${
                          createForm.includeInEmployeeManagement ? "is-on" : "is-off"
                        }`}
                        onClick={() =>
                          setCreateForm((prev) => ({
                            ...prev,
                            includeInEmployeeManagement: !prev.includeInEmployeeManagement,
                          }))
                        }
                      >
                        <i aria-hidden="true" />
                        <span>{createForm.includeInEmployeeManagement ? "ظاهر" : "مخفي"}</span>
                      </button>
                    </div>
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
                  setCreateForm({
                    displayName: "",
                    email: "",
                    password: "",
                    phone: "",
                    notes: "",
                    role: "staff",
                    includeInEmployeeManagement: true,
                  });
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
        <div className="accounts-modal" role="dialog" aria-modal="true" aria-label="تعديل الحساب">
          <button
            type="button"
            className="accounts-modal__backdrop"
            aria-label="إغلاق"
            onClick={() => setEditDraft(null)}
          />

          <div className="account-editor-v4" dir="rtl">
            <header className="account-editor-v4__header">
              <div className="account-editor-v4__titleBlock">
                <span className="account-editor-v4__eyebrow">إدارة الحسابات / تعديل الحساب</span>
                <h2>{editDraft.displayName || editDraft.email || "الحساب"}</h2>
                <p>عدّل بيانات الدخول، ظهور الحساب في إدارة الموظفات، والدور والصلاحيات من مساحة واضحة واحدة.</p>
              </div>

              <button
                type="button"
                className="account-editor-v4__close"
                aria-label="إغلاق نافذة التعديل"
                onClick={() => setEditDraft(null)}
              >
                ×
              </button>
            </header>

            <section className="account-editor-v4__identity">
              <div className="account-editor-v4__identityMain">
                <div className="account-editor-v4__avatar">
                  {cleanText(editDraft.displayName || editDraft.email || editDraft.uid).slice(0, 1) || "?"}
                </div>
                <div>
                  <strong>{editDraft.displayName || "بدون اسم"}</strong>
                  <span>{editDraft.email || "بدون بريد"}</span>
                </div>
              </div>

              <div className="account-editor-v4__facts">
                <div>
                  <span>الدور</span>
                  <strong>{getRoleLabel(editDraft.role)}</strong>
                </div>
                <div>
                  <span>الحالة</span>
                  <strong className={editDraft.active ? "is-success" : "is-danger"}>
                    {editDraft.active ? "نشط" : "غير نشط"}
                  </strong>
                </div>
                <div>
                  <span>الصلاحيات</span>
                  <strong>{editDraft.permissions.length}</strong>
                </div>
                <div>
                  <span>إدارة الموظفات</span>
                  <strong className={editDraft.includeInEmployeeManagement ? "is-success" : "is-muted"}>
                    {editDraft.includeInEmployeeManagement ? "ظاهر" : "مخفي"}
                  </strong>
                </div>
              </div>
            </section>

            <nav className="account-editor-v4__tabs" aria-label="أقسام تعديل الحساب">
              <button
                type="button"
                className={editSection === "profile" ? "is-active" : ""}
                onClick={() => setEditSection("profile")}
              >
                <span>01</span>
                البيانات الأساسية
              </button>
              <button
                type="button"
                className={editSection === "employee" ? "is-active" : ""}
                onClick={() => setEditSection("employee")}
              >
                <span>02</span>
                الظهور في الموظفات
              </button>
              <button
                type="button"
                className={editSection === "access" ? "is-active" : ""}
                onClick={() => setEditSection("access")}
              >
                <span>03</span>
                الدور والصلاحيات
              </button>
            </nav>

            <div className="account-editor-v4__content">
              {editSection === "profile" ? (
                <section className="account-editor-v4__section">
                  <div className="account-editor-v4__sectionHead">
                    <div>
                      <span>المعلومات الأساسية</span>
                      <h3>بيانات الحساب وتسجيل الدخول</h3>
                      <p>هذه هي البيانات الأساسية للحساب الإداري. البريد للقراءة فقط لأنه معرّف تسجيل الدخول.</p>
                    </div>
                    {selectedIsSelf ? <b className="account-editor-v4__selfBadge">حسابك الحالي</b> : null}
                  </div>

                  <div className="account-editor-v4__formGrid">
                    <label className="account-editor-v4__field">
                      <span>الاسم</span>
                      <input
                        value={editDraft.displayName}
                        disabled={!selectedCanEditBasics}
                        onChange={(event) =>
                          setEditDraft((prev) => (prev ? { ...prev, displayName: event.target.value } : prev))
                        }
                        placeholder="اسم صاحب الحساب"
                      />
                    </label>

                    <label className="account-editor-v4__field">
                      <span>البريد الإلكتروني</span>
                      <input value={editDraft.email} readOnly />
                      <small>معرّف الدخول، لا يتم تغييره من هذه الشاشة.</small>
                    </label>

                    <label className="account-editor-v4__field">
                      <span>رقم الجوال</span>
                      <input
                        value={editDraft.phone}
                        disabled={!selectedCanEditBasics}
                        onChange={(event) =>
                          setEditDraft((prev) => (prev ? { ...prev, phone: event.target.value } : prev))
                        }
                        placeholder="05xxxxxxxx"
                      />
                    </label>

                    <label className="account-editor-v4__field account-editor-v4__field--wide">
                      <span>ملاحظات إدارية</span>
                      <textarea
                        value={editDraft.notes}
                        disabled={!selectedCanEditBasics}
                        onChange={(event) =>
                          setEditDraft((prev) => (prev ? { ...prev, notes: event.target.value } : prev))
                        }
                        placeholder="اكتب ملاحظات داخلية عن الحساب..."
                      />
                    </label>
                  </div>

                  <div className="account-editor-v4__notice">
                    <strong>فصل واضح:</strong>
                    <span>هذه الشاشة تعدّل حساب الدخول فقط. الخدمات، أوقات العمل، الحضور والعمليات اليومية تُدار من قسم إدارة الموظفات.</span>
                  </div>
                </section>
              ) : null}

              {editSection === "employee" ? (
                <section className="account-editor-v4__section">
                  <div className="account-editor-v4__sectionHead">
                    <div>
                      <span>الربط التشغيلي</span>
                      <h3>الظهور في إدارة الموظفات</h3>
                      <p>حدّد هل هذا الحساب يمثل موظفة تعمل داخل الصالون أم أنه حساب إداري للدخول فقط.</p>
                    </div>
                  </div>

                  <div className={`account-editor-v4__employeeToggle ${editDraft.includeInEmployeeManagement ? "is-on" : "is-off"}`}>
                    <div className="account-editor-v4__employeeIcon" aria-hidden="true">م</div>
                    <div className="account-editor-v4__employeeCopy">
                      <span>حالة الربط الحالية</span>
                      <h4>{editDraft.includeInEmployeeManagement ? "ظاهر ضمن الموظفات العاملات" : "حساب إداري فقط"}</h4>
                      <p>
                        {editDraft.includeInEmployeeManagement
                          ? "سيظهر في إدارة الموظفات لإسناد الخدمات، أوقات العمل، الحضور والملف التشغيلي."
                          : "لن يظهر في إدارة الموظفات، مع بقاء حساب الدخول والصلاحيات الإدارية فعّالة."}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="account-editor-v4__switch"
                      disabled={!selectedCanEditBasics}
                      aria-pressed={editDraft.includeInEmployeeManagement}
                      onClick={() =>
                        setEditDraft((prev) =>
                          prev
                            ? { ...prev, includeInEmployeeManagement: !prev.includeInEmployeeManagement }
                            : prev
                        )
                      }
                    >
                      <i aria-hidden="true" />
                      <span>{editDraft.includeInEmployeeManagement ? "ظاهر" : "مخفي"}</span>
                    </button>
                  </div>

                  <div className="account-editor-v4__compareGrid">
                    <article>
                      <span>عند الظهور</span>
                      <h4>ملف موظفة تشغيلي</h4>
                      <p>خدمات، جدول دوام، حضور، تقييم، راتب وملفات وظيفية.</p>
                    </article>
                    <article>
                      <span>عند الإخفاء</span>
                      <h4>حساب دخول فقط</h4>
                      <p>يبقى الاسم والبريد والدور والصلاحيات دون ظهوره بين العاملات.</p>
                    </article>
                  </div>
                </section>
              ) : null}

              {editSection === "access" ? (
                <section className="account-editor-v4__section account-editor-v4__section--access">
                  <div className="account-editor-v4__sectionHead">
                    <div>
                      <span>التحكم في الوصول</span>
                      <h3>الدور، حالة الدخول والصلاحيات</h3>
                      <p>اضبط مستوى الوصول للحساب ثم خصّص الاستثناءات عند الحاجة.</p>
                    </div>
                  </div>

                  <div className="account-editor-v4__accessGrid">
                    <label className="account-editor-v4__field">
                      <span>الدور الإداري</span>
                      <select
                        value={editDraft.role}
                        onChange={(event) =>
                          setEditDraft((prev) => {
                            if (!prev) return prev;
                            const role = event.target.value as UiRole;
                            if (!canAssignRole(role) && role !== prev.role) return prev;
                            return {
                              ...prev,
                              role,
                              active: role === "pending" ? false : prev.active,
                              permissions: getRoleAppPermissions(role as any),
                            };
                          })
                        }
                        disabled={!selectedCanControl}
                      >
                        {(["owner", "admin", "hr", "reception", "staff", "pending"] as UiRole[])
                          .filter((role) => role === editDraft.role || canAssignRole(role))
                          .map((role) => (
                            <option key={role} value={role}>{getRoleLabel(role)}</option>
                          ))}
                      </select>
                    </label>

                    <div className="account-editor-v4__statusControl">
                      <div>
                        <span>حالة تسجيل الدخول</span>
                        <strong>{editDraft.active ? "الحساب نشط" : "الحساب معطل"}</strong>
                        <small>{editDraft.active ? "يمكن لصاحب الحساب تسجيل الدخول." : "لن يتمكن صاحب الحساب من الدخول."}</small>
                      </div>
                      <button
                        type="button"
                        className={`account-editor-v4__switch ${editDraft.active ? "is-on" : "is-off"}`}
                        disabled={!selectedCanControl}
                        aria-pressed={editDraft.active}
                        onClick={() => setEditDraft((prev) => (prev ? { ...prev, active: !prev.active } : prev))}
                      >
                        <i aria-hidden="true" />
                        <span>{editDraft.active ? "نشط" : "معطل"}</span>
                      </button>
                    </div>
                  </div>

                  {selectedIsSelf ? (
                    <div className="account-editor-v4__warning">
                      حمايةً للحساب الحالي، يمكنك تعديل بياناتك الأساسية وظهورك في الموظفات، لكن لا يمكنك تغيير دورك أو تعطيل حسابك أو تعديل صلاحياتك من الجلسة نفسها.
                    </div>
                  ) : null}

                  <section className="account-editor-v4__permissions">
                    <div className="account-editor-v4__permissionsHead">
                      <div>
                        <span>الصلاحيات الفعلية</span>
                        <h4>مفاتيح الوصول</h4>
                        <p>فعّل أو أوقف أي صلاحية كاستثناء عن الدور الأساسي.</p>
                      </div>
                      <div className="account-editor-v4__permissionStats">
                        <b>الدور <strong>{editRoleDefaultPermissions.length}</strong></b>
                        <b>الفعلية <strong>{editDraft.permissions.length}</strong></b>
                        <b>الاستثناءات <strong>{editAddedPermissions + editDisabledDefaults}</strong></b>
                      </div>
                    </div>

                    <div className="account-editor-v4__permissionTools">
                      <label>
                        <span>بحث داخل الصلاحيات</span>
                        <input
                          value={permissionSearch}
                          onChange={(event) => setPermissionSearch(event.target.value)}
                          placeholder="اسم الصلاحية أو المفتاح..."
                        />
                      </label>
                      <label>
                        <span>القسم</span>
                        <select
                          value={permissionGroupFilter}
                          onChange={(event) =>
                            setPermissionGroupFilter(event.target.value as typeof permissionGroupFilter)
                          }
                        >
                          <option value="all">كل الأقسام</option>
                          {APP_PERMISSION_GROUPS.map((group) => (
                            <option key={group.key} value={group.key}>{group.label}</option>
                          ))}
                        </select>
                      </label>
                    </div>

                    {!selectedIsSelf && !canManagePermissions ? (
                      <div className="account-editor-v4__warning">
                        تعديل الاستثناءات التفصيلية يتطلب صلاحية <code>permissions.manage</code>.
                      </div>
                    ) : null}

                    <div className="account-editor-v4__permissionGroups">
                      {visiblePermissionGroups.map((group) => {
                        const groupKeys = group.permissions.map((permission) => permission.key);
                        const enabledCount = groupKeys.filter((key) => editPermissionSet.has(key)).length;
                        const canEnableWholeGroup = groupKeys.every(
                          (key) => isOwner || actorPermissions.includes(key)
                        );

                        return (
                          <section key={group.key} className="account-editor-v4__permissionGroup">
                            <div className="account-editor-v4__permissionGroupHead">
                              <div>
                                <h5>{group.label}</h5>
                                <p>{group.hint}</p>
                              </div>
                              <div>
                                <strong>{enabledCount}/{groupKeys.length}</strong>
                                <button
                                  type="button"
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

                            <div className="account-editor-v4__permissionGrid">
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
                                      "account-editor-v4__permission",
                                      isEnabled ? "is-on" : "is-off",
                                      isDefault ? "is-default" : "",
                                      isAdded ? "is-added" : "",
                                      isDisabledDefault ? "is-disabled-default" : "",
                                      permission.sensitive ? "is-sensitive" : "",
                                    ].filter(Boolean).join(" ")}
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
                                    <i aria-hidden="true" />
                                    <span>
                                      <strong>{permission.label}</strong>
                                      <small>{permission.key}</small>
                                      <em>{permission.hint}</em>
                                    </span>
                                    <b>
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
                                    </b>
                                  </button>
                                );
                              })}
                            </div>
                          </section>
                        );
                      })}
                    </div>

                    {!visiblePermissionGroups.length ? (
                      <div className="account-editor-v4__empty">لا توجد صلاحيات تطابق البحث الحالي.</div>
                    ) : null}

                    <div className="account-editor-v4__permissionFooter">
                      <button
                        type="button"
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
                </section>
              ) : null}
            </div>

            <footer className="account-editor-v4__footer">
              <div>
                <strong>تعديل حساب الدخول</strong>
                <span>لن تُحفظ التغييرات حتى تضغط حفظ التعديلات.</span>
              </div>
              <div>
                <button type="button" className="account-editor-v4__cancel" onClick={() => setEditDraft(null)}>
                  إلغاء
                </button>
                <button
                  type="button"
                  className="account-editor-v4__save"
                  disabled={usersLoading}
                  onClick={() => void saveEditedUser()}
                >
                  {usersLoading ? "جاري الحفظ..." : "حفظ التعديلات"}
                </button>
              </div>
            </footer>
          </div>
        </div>
      ) : null}
    </div>
    </div>
  );
}
